import AVFoundation
import Foundation
import Speech

typealias GwonmacSpeechCallback = @convention(c) (
  UnsafeMutableRawPointer?,
  Int32,
  UnsafePointer<CChar>?,
  Double,
  Int32
) -> Void

private enum SpeechEvent: Int32 {
  case preparing = 0
  case downloading = 1
  case ready = 2
  case listening = 3
  case result = 4
  case error = 5
}

private enum SpeechOperation {
  case setup
  case capture
}

@available(macOS 26.0, *)
@MainActor
private final class ModernDictation {
  private let callback: GwonmacSpeechCallback
  private let context: UnsafeMutableRawPointer?
  private let operation: SpeechOperation
  private var analyzer: SpeechAnalyzer?
  private var engine: AVAudioEngine?
  private var inputContinuation: AsyncStream<AnalyzerInput>.Continuation?
  private var resultsTask: Task<Void, Never>?
  private var workTask: Task<Void, Never>?
  private var finalizedText = ""
  private var volatileText = ""
  private var finishing = false

  init(
    operation: SpeechOperation,
    callback: @escaping GwonmacSpeechCallback,
    context: UnsafeMutableRawPointer?
  ) {
    self.operation = operation
    self.callback = callback
    self.context = context
  }

  func start() {
    emit(.preparing)
    workTask = Task { [weak self] in await self?.run() }
  }

  func finish() {
    guard !finishing else { return }
    finishing = true
    workTask?.cancel()
    workTask = Task { [weak self] in
      guard let self else { return }
      self.stopCapture()
      if let analyzer = self.analyzer {
        try? await analyzer.finalizeAndFinishThroughEndOfInput()
      }
      await self.resultsTask?.value
      self.emit(.result, text: self.currentText, final: true)
      self.clear()
    }
  }

  func cancel() {
    workTask?.cancel()
    resultsTask?.cancel()
    stopCapture()
    if let analyzer {
      Task { await analyzer.cancelAndFinishNow() }
    }
    clear()
  }

  private func run() async {
    guard let locale = await preferredLocale() else {
      fail("model-unavailable")
      return
    }

    let transcriber = DictationTranscriber(
      locale: locale,
      preset: .progressiveShortDictation
    )
    do {
      if operation == .setup {
        if let request = try await AssetInventory.assetInstallationRequest(
          supporting: [transcriber]
        ) {
          let progressTask = Task { [weak self] in
            while !Task.isCancelled {
              self?.emit(.downloading, progress: request.progress.fractionCompleted)
              try? await Task.sleep(for: .milliseconds(200))
            }
          }
          defer { progressTask.cancel() }
          try await request.downloadAndInstall()
        }
        try Task.checkCancellation()
        emit(.ready, text: locale.localizedString(forIdentifier: locale.identifier)
          ?? locale.identifier)
        clear()
        return
      }

      guard await AssetInventory.status(forModules: [transcriber]) == .installed else {
        fail("setup-required")
        return
      }

      try await listen(with: transcriber)
    } catch is CancellationError {
      return
    } catch {
      fail(operation == .setup ? "model-download-failed" : "recognition-failed")
    }
  }

  private func listen(with transcriber: DictationTranscriber) async throws {
    let analyzer = SpeechAnalyzer(modules: [transcriber])
    let engine = AVAudioEngine()
    let input = engine.inputNode
    let naturalFormat = input.outputFormat(forBus: 0)
    guard naturalFormat.sampleRate > 0,
          let analyzerFormat = await SpeechAnalyzer.bestAvailableAudioFormat(
            compatibleWith: [transcriber],
            considering: naturalFormat
          ) else {
      fail("audio-unavailable")
      return
    }
    let converter = naturalFormat == analyzerFormat
      ? nil
      : AVAudioConverter(from: naturalFormat, to: analyzerFormat)
    guard naturalFormat == analyzerFormat || converter != nil else {
      fail("audio-unavailable")
      return
    }
    let (inputs, continuation) = AsyncStream.makeStream(of: AnalyzerInput.self)

    self.analyzer = analyzer
    self.engine = engine
    self.inputContinuation = continuation
    observe(transcriber)
    try await analyzer.start(inputSequence: inputs)
    input.installTap(onBus: 0, bufferSize: 1024, format: naturalFormat) {
      buffer, _ in
      if converter == nil {
        continuation.yield(AnalyzerInput(buffer: buffer))
        return
      }
      let ratio = analyzerFormat.sampleRate / naturalFormat.sampleRate
      let capacity = AVAudioFrameCount(ceil(Double(buffer.frameLength) * ratio)) + 1
      guard let output = AVAudioPCMBuffer(
        pcmFormat: analyzerFormat,
        frameCapacity: capacity
      ) else { return }
      var supplied = false
      var conversionError: NSError?
      let status = converter!.convert(to: output, error: &conversionError) {
        _, inputStatus in
        guard !supplied else {
          inputStatus.pointee = .noDataNow
          return nil
        }
        supplied = true
        inputStatus.pointee = .haveData
        return buffer
      }
      if status == .haveData && conversionError == nil {
        continuation.yield(AnalyzerInput(buffer: output))
      }
    }
    engine.prepare()
    try engine.start()
    try Task.checkCancellation()
    emit(.listening)
  }

  private func preferredLocale() async -> Locale? {
    var identifiers = Locale.preferredLanguages
    identifiers.append(Locale.current.identifier)
    identifiers.append("en-US")
    var seen = Set<String>()
    for identifier in identifiers where seen.insert(identifier).inserted {
      if let locale = await DictationTranscriber.supportedLocale(
        equivalentTo: Locale(identifier: identifier)
      ) {
        return locale
      }
    }
    return nil
  }

  private func observe(_ transcriber: DictationTranscriber) {
    resultsTask = Task { [weak self] in
      do {
        for try await result in transcriber.results {
          guard let self, !Task.isCancelled else { return }
          let text = String(result.text.characters).trimmingCharacters(in: .whitespacesAndNewlines)
          if result.isFinal {
            self.appendFinal(text)
            self.volatileText = ""
          } else {
            self.volatileText = text
          }
          self.emit(.result, text: self.currentText)
        }
      } catch is CancellationError {
        return
      } catch {
        self?.fail("recognition-failed")
      }
    }
  }

  private func appendFinal(_ text: String) {
    guard !text.isEmpty else { return }
    finalizedText += finalizedText.isEmpty ? text : " \(text)"
  }

  private var currentText: String {
    guard !volatileText.isEmpty else { return finalizedText }
    return finalizedText.isEmpty ? volatileText : "\(finalizedText) \(volatileText)"
  }

  private func fail(_ reason: String) {
    guard !finishing else { return }
    emit(.error, text: reason)
    cancel()
  }

  private func stopCapture() {
    if let engine {
      engine.inputNode.removeTap(onBus: 0)
      engine.stop()
    }
    inputContinuation?.finish()
    inputContinuation = nil
  }

  private func clear() {
    workTask = nil
    resultsTask = nil
    analyzer = nil
    engine = nil
    inputContinuation = nil
    if modernDictation === self {
      modernDictation = nil
    }
  }

  private func emit(
    _ event: SpeechEvent,
    text: String? = nil,
    progress: Double = -1,
    final: Bool = false
  ) {
    if let text {
      text.withCString {
        callback(context, event.rawValue, $0, progress, final ? 1 : 0)
      }
    } else {
      callback(context, event.rawValue, nil, progress, final ? 1 : 0)
    }
  }
}

@available(macOS 26.0, *)
@MainActor
private var modernDictation: ModernDictation?

@_cdecl("GwonmacModernSpeechAvailable")
func GwonmacModernSpeechAvailable() -> Bool {
  if #available(macOS 26.0, *) { return true }
  return false
}

@_cdecl("GwonmacModernSpeechStart")
func GwonmacModernSpeechStart(
  _ callback: GwonmacSpeechCallback?,
  _ context: UnsafeMutableRawPointer?
) {
  guard let callback else { return }
  if #available(macOS 26.0, *) {
    Task { @MainActor in
      modernDictation?.cancel()
      let dictation = ModernDictation(
        operation: .capture,
        callback: callback,
        context: context
      )
      modernDictation = dictation
      dictation.start()
    }
  }
}

@_cdecl("GwonmacModernSpeechPrepare")
func GwonmacModernSpeechPrepare(
  _ callback: GwonmacSpeechCallback?,
  _ context: UnsafeMutableRawPointer?
) {
  guard let callback else { return }
  if #available(macOS 26.0, *) {
    Task { @MainActor in
      modernDictation?.cancel()
      let dictation = ModernDictation(
        operation: .setup,
        callback: callback,
        context: context
      )
      modernDictation = dictation
      dictation.start()
    }
  }
}

@_cdecl("GwonmacModernSpeechFinish")
func GwonmacModernSpeechFinish() {
  if #available(macOS 26.0, *) {
    Task { @MainActor in modernDictation?.finish() }
  }
}

@_cdecl("GwonmacModernSpeechCancel")
func GwonmacModernSpeechCancel() {
  if #available(macOS 26.0, *) {
    Task { @MainActor in modernDictation?.cancel() }
  }
}
