/**
 * One short reminder tone. Calls closer than a second apart play once, so many
 * reminders arriving together sound like a single chime.
 */
const MIN_INTERVAL_MS = 1_000;

export function createReminderChime(now: () => number = () => performance.now()) {
  let audio: AudioContext | null = null;
  let last = -Infinity;
  return {
    /** Plays unless a chime already played within the last second; returns whether it played. */
    play(): boolean {
      const at = now();
      if (at - last < MIN_INTERVAL_MS || typeof AudioContext === "undefined") return false;
      last = at;
      audio ??= new AudioContext();
      const tone = audio.createOscillator(); const volume = audio.createGain();
      tone.frequency.setValueAtTime(880, audio.currentTime);
      volume.gain.setValueAtTime(0.08, audio.currentTime);
      volume.gain.exponentialRampToValueAtTime(0.001, audio.currentTime + 0.25);
      tone.connect(volume); volume.connect(audio.destination);
      tone.start(); tone.stop(audio.currentTime + 0.25);
      tone.onended = () => { tone.disconnect(); volume.disconnect(); };
      return true;
    },
    dispose() { void audio?.close().catch(() => {}); audio = null; },
  };
}
