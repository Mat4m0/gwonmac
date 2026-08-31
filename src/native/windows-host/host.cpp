/**
 * Windows-only native boundary for LocalAppData and Credential Manager.
 * Renderer code never loads this addon. Main supplies one closed application
 * identity and one closed secret slot to every asynchronous credential call.
 */
#define NAPI_VERSION 8

#include <node_api.h>
#include <windows.h>
#include <wincred.h>
#include <shlobj.h>

#include <cstdint>
#include <exception>
#include <new>
#include <string>
#include <vector>

namespace {

constexpr char kReleaseIdentity[] = "io.github.mat4m0.gwonmac";
constexpr char kPreviewIdentity[] = "io.github.mat4m0.gwonmac.preview";
constexpr char kDevelopmentIdentity[] = "io.github.mat4m0.gwonmac.dev";
constexpr char kCredentialsSlot[] = "arenaNetCredentials";
constexpr char kSteamSlot[] = "steamSession";
constexpr char kMultiPrefix[] = "multi.";

enum class Operation { kLoad, kSave, kClear };
enum class Result { kSuccess, kNotFound, kTooLarge, kUnavailable };

struct Work {
  napi_env env = nullptr;
  napi_async_work asyncWork = nullptr;
  napi_deferred deferred = nullptr;
  Operation operation = Operation::kLoad;
  std::wstring target;
  Result result = Result::kUnavailable;
  std::vector<std::uint8_t> input;
  std::vector<std::uint8_t> output;
};

void Zero(std::vector<std::uint8_t> &bytes) {
  if (!bytes.empty()) SecureZeroMemory(bytes.data(), bytes.size());
  bytes.clear();
}

bool IsLowerHex(char value) {
  return (value >= '0' && value <= '9') || (value >= 'a' && value <= 'f');
}

bool IsUuidV4(const std::string &value) {
  if (value.size() != 36 || value[8] != '-' || value[13] != '-' ||
      value[18] != '-' || value[23] != '-' || value[14] != '4' ||
      (value[19] != '8' && value[19] != '9' && value[19] != 'a' &&
       value[19] != 'b')) return false;
  for (std::size_t index = 0; index < value.size(); ++index) {
    if (index == 8 || index == 13 || index == 18 || index == 23) continue;
    if (!IsLowerHex(value[index])) return false;
  }
  return true;
}

bool ValidIdentity(const std::string &value) {
  return value == kReleaseIdentity || value == kPreviewIdentity ||
         value == kDevelopmentIdentity;
}

bool ValidSlot(const std::string &slot) {
  if (slot == kCredentialsSlot || slot == kSteamSlot) return true;
  const std::string prefix = kMultiPrefix;
  if (slot.rfind(prefix, 0) != 0) return false;
  const std::size_t separator = slot.find('.', prefix.size());
  if (separator == std::string::npos) return false;
  const std::string profile = slot.substr(prefix.size(), separator - prefix.size());
  const std::string kind = slot.substr(separator + 1);
  return IsUuidV4(profile) &&
         (kind == kCredentialsSlot || kind == kSteamSlot);
}

bool ReadAscii(napi_env env, napi_value value, std::string *output,
               std::size_t maximum) {
  std::size_t length = 0;
  if (napi_get_value_string_utf8(env, value, nullptr, 0, &length) != napi_ok ||
      length == 0 || length > maximum) return false;
  std::vector<char> bytes(length + 1, '\0');
  if (napi_get_value_string_utf8(env, value, bytes.data(), bytes.size(),
                                 &length) != napi_ok) return false;
  for (std::size_t index = 0; index < length; ++index) {
    if (static_cast<unsigned char>(bytes[index]) > 0x7f) return false;
  }
  output->assign(bytes.data(), length);
  return true;
}

std::wstring WidenAscii(const std::string &value) {
  return std::wstring(value.begin(), value.end());
}

Result Load(Work &work) {
  PCREDENTIALW credential = nullptr;
  if (!CredReadW(work.target.c_str(), CRED_TYPE_GENERIC, 0, &credential)) {
    return GetLastError() == ERROR_NOT_FOUND ? Result::kNotFound
                                             : Result::kUnavailable;
  }
  try {
    if (credential->CredentialBlobSize > 0) {
      const auto *begin = credential->CredentialBlob;
      work.output.assign(begin, begin + credential->CredentialBlobSize);
    }
  } catch (const std::exception &) {
    CredFree(credential);
    return Result::kUnavailable;
  }
  CredFree(credential);
  return Result::kSuccess;
}

Result Save(Work &work) {
  if (work.input.size() > CRED_MAX_CREDENTIAL_BLOB_SIZE) {
    return Result::kTooLarge;
  }
  CREDENTIALW credential{};
  credential.Type = CRED_TYPE_GENERIC;
  credential.TargetName = work.target.data();
  credential.CredentialBlobSize = static_cast<DWORD>(work.input.size());
  credential.CredentialBlob = work.input.data();
  credential.Persist = CRED_PERSIST_LOCAL_MACHINE;
  wchar_t label[] = L"Guild Wars Reforged";
  credential.UserName = label;
  return CredWriteW(&credential, 0) ? Result::kSuccess : Result::kUnavailable;
}

Result Clear(Work &work) {
  if (CredDeleteW(work.target.c_str(), CRED_TYPE_GENERIC, 0)) {
    return Result::kSuccess;
  }
  return GetLastError() == ERROR_NOT_FOUND ? Result::kSuccess
                                           : Result::kUnavailable;
}

void Execute(napi_env, void *data) {
  auto &work = *static_cast<Work *>(data);
  try {
    switch (work.operation) {
      case Operation::kLoad: work.result = Load(work); break;
      case Operation::kSave: work.result = Save(work); break;
      case Operation::kClear: work.result = Clear(work); break;
    }
  } catch (const std::exception &) {
    work.result = Result::kUnavailable;
  }
  Zero(work.input);
}

const char *ErrorCode(Result result) {
  return result == Result::kTooLarge ? "too_large" : "unavailable";
}

void Reject(Work &work) {
  napi_value message;
  napi_value error;
  napi_value code;
  if (napi_create_string_utf8(work.env, "Credential Manager unavailable",
                              NAPI_AUTO_LENGTH, &message) != napi_ok ||
      napi_create_error(work.env, nullptr, message, &error) != napi_ok ||
      napi_create_string_utf8(work.env, ErrorCode(work.result),
                              NAPI_AUTO_LENGTH, &code) != napi_ok ||
      napi_set_named_property(work.env, error, "code", code) != napi_ok) {
    napi_get_undefined(work.env, &error);
  }
  napi_reject_deferred(work.env, work.deferred, error);
}

void Complete(napi_env env, napi_status status, void *data) {
  auto *work = static_cast<Work *>(data);
  if (status != napi_ok) work->result = Result::kUnavailable;
  if (work->result == Result::kSuccess ||
      (work->operation == Operation::kLoad &&
       work->result == Result::kNotFound)) {
    napi_value value;
    napi_status valueStatus = napi_ok;
    if (work->operation == Operation::kLoad &&
        work->result == Result::kSuccess) {
      valueStatus = napi_create_buffer_copy(env, work->output.size(),
                                            work->output.data(), nullptr,
                                            &value);
    } else if (work->operation == Operation::kLoad) {
      valueStatus = napi_get_null(env, &value);
    } else {
      valueStatus = napi_get_undefined(env, &value);
    }
    if (valueStatus == napi_ok) napi_resolve_deferred(env, work->deferred, value);
    else Reject(*work);
  } else {
    Reject(*work);
  }
  Zero(work->input);
  Zero(work->output);
  napi_delete_async_work(env, work->asyncWork);
  delete work;
}

napi_value Queue(napi_env env, napi_callback_info info, Operation operation) {
  std::size_t argc = operation == Operation::kSave ? 3 : 2;
  napi_value argv[3];
  if (napi_get_cb_info(env, info, &argc, argv, nullptr, nullptr) != napi_ok ||
      argc != (operation == Operation::kSave ? 3U : 2U)) {
    napi_throw_type_error(env, nullptr, "invalid Credential Manager arguments");
    return nullptr;
  }
  std::string identity;
  std::string slot;
  if (!ReadAscii(env, argv[0], &identity, 64) || !ValidIdentity(identity) ||
      !ReadAscii(env, argv[1], &slot, 96) || !ValidSlot(slot)) {
    napi_throw_type_error(env, nullptr, "invalid Credential Manager slot");
    return nullptr;
  }
  auto *work = new (std::nothrow) Work();
  if (work == nullptr) {
    napi_throw_error(env, nullptr, "Credential Manager unavailable");
    return nullptr;
  }
  work->env = env;
  work->operation = operation;
  work->target = WidenAscii(identity + "/saved-login/" + slot);
  if (operation == Operation::kSave) {
    bool isBuffer = false;
    void *bytes = nullptr;
    std::size_t length = 0;
    if (napi_is_buffer(env, argv[2], &isBuffer) != napi_ok || !isBuffer ||
        napi_get_buffer_info(env, argv[2], &bytes, &length) != napi_ok) {
      delete work;
      napi_throw_type_error(env, nullptr, "credential value must be a Buffer");
      return nullptr;
    }
    try {
      const auto *begin = static_cast<const std::uint8_t *>(bytes);
      if (length > 0) work->input.assign(begin, begin + length);
    } catch (const std::exception &) {
      delete work;
      napi_throw_error(env, nullptr, "Credential Manager unavailable");
      return nullptr;
    }
  }
  napi_value promise;
  napi_value resourceName;
  if (napi_create_promise(env, &work->deferred, &promise) != napi_ok ||
      napi_create_string_utf8(env, "gwonmac.windowsCredentials",
                              NAPI_AUTO_LENGTH, &resourceName) != napi_ok ||
      napi_create_async_work(env, nullptr, resourceName, Execute, Complete,
                             work, &work->asyncWork) != napi_ok ||
      napi_queue_async_work(env, work->asyncWork) != napi_ok) {
    Zero(work->input);
    if (work->asyncWork != nullptr) napi_delete_async_work(env, work->asyncWork);
    delete work;
    napi_throw_error(env, nullptr, "Credential Manager unavailable");
    return nullptr;
  }
  return promise;
}

napi_value LoadCallback(napi_env env, napi_callback_info info) {
  return Queue(env, info, Operation::kLoad);
}
napi_value SaveCallback(napi_env env, napi_callback_info info) {
  return Queue(env, info, Operation::kSave);
}
napi_value ClearCallback(napi_env env, napi_callback_info info) {
  return Queue(env, info, Operation::kClear);
}

napi_value LocalAppDataCallback(napi_env env, napi_callback_info info) {
  std::size_t argc = 0;
  if (napi_get_cb_info(env, info, &argc, nullptr, nullptr, nullptr) != napi_ok ||
      argc != 0) {
    napi_throw_type_error(env, nullptr, "LocalAppData takes no arguments");
    return nullptr;
  }
  PWSTR knownFolder = nullptr;
  if (FAILED(SHGetKnownFolderPath(FOLDERID_LocalAppData, KF_FLAG_DEFAULT,
                                  nullptr, &knownFolder)) ||
      knownFolder == nullptr) {
    napi_throw_error(env, nullptr, "LocalAppData unavailable");
    return nullptr;
  }
  napi_value value;
  const napi_status status = napi_create_string_utf16(
      env, reinterpret_cast<const char16_t *>(knownFolder), NAPI_AUTO_LENGTH,
      &value);
  CoTaskMemFree(knownFolder);
  if (status != napi_ok) {
    napi_throw_error(env, nullptr, "LocalAppData unavailable");
    return nullptr;
  }
  return value;
}

napi_value Init(napi_env env, napi_value exports) {
  napi_property_descriptor properties[] = {
      {"load", nullptr, LoadCallback, nullptr, nullptr, nullptr, napi_default,
       nullptr},
      {"save", nullptr, SaveCallback, nullptr, nullptr, nullptr, napi_default,
       nullptr},
      {"clear", nullptr, ClearCallback, nullptr, nullptr, nullptr, napi_default,
       nullptr},
      {"localAppData", nullptr, LocalAppDataCallback, nullptr, nullptr, nullptr,
       napi_default, nullptr},
  };
  if (napi_define_properties(env, exports,
                             sizeof(properties) / sizeof(properties[0]),
                             properties) != napi_ok) {
    napi_throw_error(env, nullptr, "Windows native host initialization failed");
  }
  return exports;
}

}  // namespace

NAPI_MODULE(NODE_GYP_MODULE_NAME, Init)
