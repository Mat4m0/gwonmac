#define __STDC_WANT_LIB_EXT1__ 1

#include <node_api.h>

#import <Foundation/Foundation.h>
#import <LocalAuthentication/LocalAuthentication.h>
#import <Security/Security.h>

#include <cstring>
#include <exception>
#include <new>
#include <string>
#include <vector>

namespace {

constexpr char kCredentialsSlot[] = "arenaNetCredentials";
constexpr char kSteamSlot[] = "steamSession";
NSString *const kCredentialsAccount = @"arena-net-credentials";
NSString *const kSteamAccount = @"steam-session";
NSString *const kReleaseBundle = @"io.github.mat4m0.gwonmac";
NSString *const kPreviewBundle = @"io.github.mat4m0.gwonmac.preview";
NSString *const kDevelopmentBundle = @"io.github.mat4m0.gwonmac.dev";

enum class Slot { kCredentials, kSteam };
enum class Operation { kLoad, kSave, kClear };
enum class Result {
  kSuccess,
  kNotFound,
  kInteractionNotAllowed,
  kMissingEntitlement,
  kUnavailable,
};

struct Work {
  napi_env env = nullptr;
  napi_async_work async_work = nullptr;
  napi_deferred deferred = nullptr;
  Operation operation = Operation::kLoad;
  Slot slot = Slot::kCredentials;
  Result result = Result::kUnavailable;
  std::vector<uint8_t> input;
  std::vector<uint8_t> output;
};

void Zero(std::vector<uint8_t> &bytes) {
  if (!bytes.empty()) {
    (void)memset_s(bytes.data(), bytes.size(), 0, bytes.size());
  }
  bytes.clear();
}

NSString *AccountForSlot(Slot slot) {
  return slot == Slot::kCredentials ? kCredentialsAccount : kSteamAccount;
}

NSString *ServiceForHostBundle() {
  NSString *bundle = NSBundle.mainBundle.bundleIdentifier;
  if ([bundle isEqualToString:kReleaseBundle] ||
      [bundle isEqualToString:kPreviewBundle] ||
      [bundle isEqualToString:kDevelopmentBundle]) {
    return bundle;
  }
  return nil;
}

NSString *LabelForService(NSString *service) {
  if ([service isEqualToString:kReleaseBundle])
    return @"Guild Wars Reforged saved login";
  if ([service isEqualToString:kPreviewBundle])
    return @"Guild Wars Reforged Preview saved login";
  return @"Guild Wars Reforged Dev saved login";
}

NSMutableDictionary *QueryForSlot(Slot slot) {
  NSString *service = ServiceForHostBundle();
  if (service == nil)
    return nil;
  LAContext *context = [[LAContext alloc] init];
  context.interactionNotAllowed = YES;
  return [@{
    (__bridge id)kSecClass : (__bridge id)kSecClassGenericPassword,
    (__bridge id)kSecAttrService : service,
    (__bridge id)kSecAttrAccount : AccountForSlot(slot),
    (__bridge id)kSecUseDataProtectionKeychain : @YES,
    (__bridge id)kSecUseAuthenticationContext : context,
  } mutableCopy];
}

Result ResultForStatus(OSStatus status) {
  if (status == errSecSuccess)
    return Result::kSuccess;
  if (status == errSecItemNotFound)
    return Result::kNotFound;
  if (status == errSecInteractionNotAllowed) {
    return Result::kInteractionNotAllowed;
  }
  if (status == errSecMissingEntitlement)
    return Result::kMissingEntitlement;
  return Result::kUnavailable;
}

Result Load(Work &work) {
  NSMutableDictionary *query = QueryForSlot(work.slot);
  if (query == nil)
    return Result::kUnavailable;
  query[(__bridge id)kSecReturnData] = @YES;
  query[(__bridge id)kSecMatchLimit] = (__bridge id)kSecMatchLimitOne;

  CFTypeRef copied = nullptr;
  OSStatus status =
      SecItemCopyMatching((__bridge CFDictionaryRef)query, &copied);
  if (status != errSecSuccess)
    return ResultForStatus(status);

  NSData *data = CFBridgingRelease(copied);
  if (![data isKindOfClass:[NSData class]])
    return Result::kUnavailable;
  if (data.length > 0) {
    const auto *begin = static_cast<const uint8_t *>(data.bytes);
    work.output.assign(begin, begin + data.length);
  }
  return Result::kSuccess;
}

Result Save(Work &work) {
  NSMutableDictionary *query = QueryForSlot(work.slot);
  if (query == nil)
    return Result::kUnavailable;
  NSData *data = [[NSData alloc] initWithBytesNoCopy:work.input.data()
                                              length:work.input.size()
                                        freeWhenDone:NO];
  NSDictionary *update = @{(__bridge id)kSecValueData : data};
  OSStatus status =
      SecItemUpdate((__bridge CFDictionaryRef)query,
                    (__bridge CFDictionaryRef)update);
  if (status == errSecSuccess)
    return Result::kSuccess;
  if (status != errSecItemNotFound)
    return ResultForStatus(status);

  NSMutableDictionary *item = QueryForSlot(work.slot);
  if (item == nil)
    return Result::kUnavailable;
  item[(__bridge id)kSecAttrAccessible] =
      (__bridge id)kSecAttrAccessibleWhenUnlockedThisDeviceOnly;
  item[(__bridge id)kSecAttrLabel] =
      LabelForService(item[(__bridge id)kSecAttrService]);
  item[(__bridge id)kSecValueData] = data;
  status = SecItemAdd((__bridge CFDictionaryRef)item, nullptr);
  if (status != errSecDuplicateItem)
    return ResultForStatus(status);

  status = SecItemUpdate((__bridge CFDictionaryRef)query,
                         (__bridge CFDictionaryRef)update);
  return ResultForStatus(status);
}

Result Clear(Work &work) {
  NSMutableDictionary *query = QueryForSlot(work.slot);
  if (query == nil)
    return Result::kUnavailable;
  OSStatus status = SecItemDelete((__bridge CFDictionaryRef)query);
  if (status == errSecItemNotFound)
    return Result::kSuccess;
  return ResultForStatus(status);
}

void Execute(napi_env, void *data) {
  auto &work = *static_cast<Work *>(data);
  try {
    @autoreleasepool {
      switch (work.operation) {
      case Operation::kLoad:
        work.result = Load(work);
        break;
      case Operation::kSave:
        work.result = Save(work);
        break;
      case Operation::kClear:
        work.result = Clear(work);
        break;
      }
    }
  } catch (const std::exception &) {
    work.result = Result::kUnavailable;
  }
  Zero(work.input);
}

const char *ErrorCode(Result result) {
  switch (result) {
  case Result::kInteractionNotAllowed:
    return "interaction_not_allowed";
  case Result::kMissingEntitlement:
    return "missing_entitlement";
  case Result::kSuccess:
  case Result::kNotFound:
  case Result::kUnavailable:
    return "unavailable";
  }
}

void Reject(Work &work) {
  napi_value message;
  napi_value error;
  napi_value code;
  if (napi_create_string_utf8(work.env, "Keychain operation unavailable",
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
  if (status != napi_ok)
    work->result = Result::kUnavailable;

  if (work->result == Result::kSuccess ||
      (work->operation == Operation::kLoad &&
       work->result == Result::kNotFound)) {
    napi_value value;
    napi_status value_status = napi_ok;
    if (work->operation == Operation::kLoad &&
        work->result == Result::kSuccess) {
      value_status = napi_create_buffer_copy(
          env, work->output.size(), work->output.data(), nullptr, &value);
    } else if (work->operation == Operation::kLoad) {
      value_status = napi_get_null(env, &value);
    } else {
      value_status = napi_get_undefined(env, &value);
    }
    if (value_status == napi_ok) {
      napi_resolve_deferred(env, work->deferred, value);
    } else {
      work->result = Result::kUnavailable;
      Reject(*work);
    }
  } else {
    Reject(*work);
  }

  Zero(work->input);
  Zero(work->output);
  napi_delete_async_work(env, work->async_work);
  delete work;
}

bool ReadSlot(napi_env env, napi_value value, Slot *slot) {
  size_t length = 0;
  if (napi_get_value_string_utf8(env, value, nullptr, 0, &length) != napi_ok ||
      length > sizeof(kCredentialsSlot)) {
    return false;
  }

  char text[sizeof(kCredentialsSlot)] = {};
  if (napi_get_value_string_utf8(env, value, text, sizeof(text), &length) !=
      napi_ok) {
    return false;
  }
  if (strcmp(text, kCredentialsSlot) == 0) {
    *slot = Slot::kCredentials;
    return true;
  }
  if (strcmp(text, kSteamSlot) == 0) {
    *slot = Slot::kSteam;
    return true;
  }
  return false;
}

napi_value Queue(napi_env env, napi_callback_info info, Operation operation) {
  size_t argc = operation == Operation::kSave ? 2 : 1;
  napi_value argv[2];
  if (napi_get_cb_info(env, info, &argc, argv, nullptr, nullptr) != napi_ok ||
      argc != (operation == Operation::kSave ? 2U : 1U)) {
    napi_throw_type_error(env, nullptr, "invalid Keychain arguments");
    return nullptr;
  }

  auto *work = new (std::nothrow) Work();
  if (work == nullptr) {
    napi_throw_error(env, nullptr, "Keychain operation unavailable");
    return nullptr;
  }
  work->env = env;
  work->operation = operation;
  if (!ReadSlot(env, argv[0], &work->slot)) {
    delete work;
    napi_throw_type_error(env, nullptr, "invalid Keychain slot");
    return nullptr;
  }

  if (operation == Operation::kSave) {
    bool is_buffer = false;
    void *bytes = nullptr;
    size_t length = 0;
    if (napi_is_buffer(env, argv[1], &is_buffer) != napi_ok || !is_buffer ||
        napi_get_buffer_info(env, argv[1], &bytes, &length) != napi_ok) {
      delete work;
      napi_throw_type_error(env, nullptr, "Keychain value must be a Buffer");
      return nullptr;
    }
    try {
      const auto *begin = static_cast<const uint8_t *>(bytes);
      if (length > 0)
        work->input.assign(begin, begin + length);
    } catch (const std::exception &) {
      delete work;
      napi_throw_error(env, nullptr, "Keychain operation unavailable");
      return nullptr;
    }
  }

  napi_value promise;
  napi_value resource_name;
  if (napi_create_promise(env, &work->deferred, &promise) != napi_ok ||
      napi_create_string_utf8(env, "gwonmac.keychain", NAPI_AUTO_LENGTH,
                              &resource_name) != napi_ok ||
      napi_create_async_work(env, nullptr, resource_name, Execute, Complete,
                             work, &work->async_work) != napi_ok ||
      napi_queue_async_work(env, work->async_work) != napi_ok) {
    Zero(work->input);
    if (work->async_work != nullptr) {
      napi_delete_async_work(env, work->async_work);
    }
    delete work;
    napi_throw_error(env, nullptr, "Keychain operation unavailable");
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

napi_value Init(napi_env env, napi_value exports) {
  napi_property_descriptor properties[] = {
      {"load", nullptr, LoadCallback, nullptr, nullptr, nullptr, napi_default,
       nullptr},
      {"save", nullptr, SaveCallback, nullptr, nullptr, nullptr, napi_default,
       nullptr},
      {"clear", nullptr, ClearCallback, nullptr, nullptr, nullptr, napi_default,
       nullptr},
  };
  if (napi_define_properties(env, exports,
                             sizeof(properties) / sizeof(properties[0]),
                             properties) != napi_ok) {
    napi_throw_error(env, nullptr, "Keychain module initialization failed");
    return nullptr;
  }
  return exports;
}

} // namespace

NAPI_MODULE(gwonmac_keychain, Init)
