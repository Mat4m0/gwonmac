/**
 * The one native macOS host boundary. It owns app-local Command key releases
 * and the fixed Data Protection Keychain operations that JavaScript cannot.
 */
#define __STDC_WANT_LIB_EXT1__ 1

#include <node_api.h>

#import <AppKit/AppKit.h>
#import <Foundation/Foundation.h>
#import <LocalAuthentication/LocalAuthentication.h>
#import <Security/Security.h>

#include <cstring>
#include <exception>
#include <new>
#include <string>
#include <vector>

namespace {

struct CommandKeyUpMonitor {
  napi_env env = nullptr;
  napi_ref callback = nullptr;
  napi_async_context async_context = nullptr;
  id token = nil;
  bool active = false;
};

CommandKeyUpMonitor *gCommandKeyUpMonitor = nullptr;

void StopCommandKeyUps(CommandKeyUpMonitor *monitor) {
  if (!monitor->active)
    return;
  monitor->active = false;
  if (monitor->token != nil) {
    [NSEvent removeMonitor:monitor->token];
    monitor->token = nil;
  }
  if (monitor->callback != nullptr) {
    napi_delete_reference(monitor->env, monitor->callback);
    monitor->callback = nullptr;
  }
  if (monitor->async_context != nullptr) {
    napi_async_destroy(monitor->env, monitor->async_context);
    monitor->async_context = nullptr;
  }
  if (gCommandKeyUpMonitor == monitor)
    gCommandKeyUpMonitor = nullptr;
}

void CleanupCommandKeyUps(void *data) {
  auto *monitor = static_cast<CommandKeyUpMonitor *>(data);
  StopCommandKeyUps(monitor);
  delete monitor;
}

bool DispatchCommandKeyUp(CommandKeyUpMonitor *monitor, unsigned short keyCode) {
  napi_handle_scope scope = nullptr;
  napi_value callback;
  napi_value receiver;
  napi_value argument;
  napi_value result;
  bool handled = false;
  const napi_status status =
      napi_open_handle_scope(monitor->env, &scope) == napi_ok &&
              napi_get_reference_value(monitor->env, monitor->callback,
                                       &callback) == napi_ok &&
              napi_get_global(monitor->env, &receiver) == napi_ok &&
              napi_create_uint32(monitor->env, keyCode, &argument) == napi_ok &&
              napi_make_callback(monitor->env, monitor->async_context, receiver,
                                 callback, 1, &argument, &result) == napi_ok &&
              napi_get_value_bool(monitor->env, result, &handled) == napi_ok
          ? napi_ok
          : napi_generic_failure;
  if (status != napi_ok) {
    bool pending = false;
    if (napi_is_exception_pending(monitor->env, &pending) == napi_ok && pending) {
      napi_value ignored;
      napi_get_and_clear_last_exception(monitor->env, &ignored);
    }
    handled = false;
  }
  if (scope != nullptr)
    napi_close_handle_scope(monitor->env, scope);
  return handled;
}

napi_value StopCommandKeyUpsCallback(napi_env env, napi_callback_info info) {
  size_t argc = 0;
  void *data = nullptr;
  if (napi_get_cb_info(env, info, &argc, nullptr, nullptr, &data) != napi_ok ||
      argc != 0 || data == nullptr) {
    napi_throw_type_error(env, nullptr, "invalid input monitor arguments");
    return nullptr;
  }
  StopCommandKeyUps(static_cast<CommandKeyUpMonitor *>(data));
  napi_value undefined;
  napi_get_undefined(env, &undefined);
  return undefined;
}

napi_value MonitorCommandKeyUpsCallback(napi_env env, napi_callback_info info) {
  size_t argc = 1;
  napi_value argv[1];
  napi_valuetype type = napi_undefined;
  if (napi_get_cb_info(env, info, &argc, argv, nullptr, nullptr) != napi_ok ||
      argc != 1 || napi_typeof(env, argv[0], &type) != napi_ok ||
      type != napi_function) {
    napi_throw_type_error(env, nullptr, "input monitor callback is required");
    return nullptr;
  }
  if (![NSThread isMainThread] || gCommandKeyUpMonitor != nullptr) {
    napi_throw_error(env, nullptr, "input monitor is unavailable");
    return nullptr;
  }

  auto *monitor = new (std::nothrow) CommandKeyUpMonitor();
  if (monitor == nullptr) {
    napi_throw_error(env, nullptr, "input monitor is unavailable");
    return nullptr;
  }
  monitor->env = env;
  napi_value resource;
  napi_value resource_name;
  if (napi_create_reference(env, argv[0], 1, &monitor->callback) != napi_ok ||
      napi_create_object(env, &resource) != napi_ok ||
      napi_create_string_utf8(env, "gwonmac.commandKeyUps", NAPI_AUTO_LENGTH,
                              &resource_name) != napi_ok ||
      napi_async_init(env, resource, resource_name, &monitor->async_context) !=
          napi_ok ||
      napi_add_env_cleanup_hook(env, CleanupCommandKeyUps, monitor) != napi_ok) {
    if (monitor->callback != nullptr)
      napi_delete_reference(env, monitor->callback);
    if (monitor->async_context != nullptr)
      napi_async_destroy(env, monitor->async_context);
    delete monitor;
    napi_throw_error(env, nullptr, "input monitor is unavailable");
    return nullptr;
  }

  monitor->active = true;
  gCommandKeyUpMonitor = monitor;
  monitor->token = [NSEvent
      addLocalMonitorForEventsMatchingMask:NSEventMaskKeyUp
                                  handler:^NSEvent *(NSEvent *event) {
    const NSEventModifierFlags modifiers =
        event.modifierFlags & NSEventModifierFlagDeviceIndependentFlagsMask;
    if (!monitor->active ||
        (modifiers & NSEventModifierFlagCommand) == 0) {
      return event;
    }
    return DispatchCommandKeyUp(monitor, event.keyCode) ? nil : event;
  }];
  if (monitor->token == nil) {
    StopCommandKeyUps(monitor);
    napi_throw_error(env, nullptr, "input monitor is unavailable");
    return nullptr;
  }

  napi_value stop;
  if (napi_create_function(env, "stopCommandKeyUps", NAPI_AUTO_LENGTH,
                           StopCommandKeyUpsCallback, monitor, &stop) != napi_ok) {
    StopCommandKeyUps(monitor);
    napi_throw_error(env, nullptr, "input monitor is unavailable");
    return nullptr;
  }
  return stop;
}

constexpr char kCredentialsSlot[] = "arenaNetCredentials";
constexpr char kSteamSlot[] = "steamSession";
constexpr char kMultiPrefix[] = "multi.";
NSString *const kCredentialsAccount = @"arena-net-credentials";
NSString *const kSteamAccount = @"steam-session";
NSString *const kReleaseBundle = @"io.github.mat4m0.gwonmac";
NSString *const kPreviewBundle = @"io.github.mat4m0.gwonmac.preview";
NSString *const kDevelopmentBundle = @"io.github.mat4m0.gwonmac.dev";

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
  std::string slot;
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

bool IsLowerHex(char value) {
  return (value >= '0' && value <= '9') || (value >= 'a' && value <= 'f');
}

bool IsUuidV4(const std::string &value) {
  if (value.size() != 36 || value[8] != '-' || value[13] != '-' ||
      value[18] != '-' || value[23] != '-' || value[14] != '4' ||
      (value[19] != '8' && value[19] != '9' && value[19] != 'a' &&
       value[19] != 'b'))
    return false;
  for (size_t i = 0; i < value.size(); ++i) {
    if (i == 8 || i == 13 || i == 18 || i == 23)
      continue;
    if (!IsLowerHex(value[i]))
      return false;
  }
  return true;
}

NSString *AccountForSlot(const std::string &slot) {
  if (slot == kCredentialsSlot)
    return kCredentialsAccount;
  if (slot == kSteamSlot)
    return kSteamAccount;
  const std::string prefix = kMultiPrefix;
  if (slot.rfind(prefix, 0) != 0)
    return nil;
  const size_t separator = slot.find('.', prefix.size());
  if (separator == std::string::npos)
    return nil;
  const std::string profile = slot.substr(prefix.size(), separator - prefix.size());
  const std::string kind = slot.substr(separator + 1);
  if (!IsUuidV4(profile) ||
      (kind != kCredentialsSlot && kind != kSteamSlot))
    return nil;
  NSString *base = kind == kCredentialsSlot ? kCredentialsAccount : kSteamAccount;
  return [NSString stringWithFormat:@"%@.multi.%s", base, profile.c_str()];
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

NSMutableDictionary *QueryForSlot(const std::string &slot) {
  NSString *service = ServiceForHostBundle();
  NSString *account = AccountForSlot(slot);
  if (service == nil || account == nil)
    return nil;
  LAContext *context = [[LAContext alloc] init];
  context.interactionNotAllowed = YES;
  return [@{
    (__bridge id)kSecClass : (__bridge id)kSecClassGenericPassword,
    (__bridge id)kSecAttrService : service,
    (__bridge id)kSecAttrAccount : account,
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

bool ReadSlot(napi_env env, napi_value value, std::string *slot) {
  size_t length = 0;
  if (napi_get_value_string_utf8(env, value, nullptr, 0, &length) != napi_ok ||
      length == 0 || length > 96) {
    return false;
  }

  std::vector<char> text(length + 1, '\0');
  if (napi_get_value_string_utf8(env, value, text.data(), text.size(), &length) !=
      napi_ok) {
    return false;
  }
  const std::string candidate(text.data(), length);
  if (AccountForSlot(candidate) == nil)
    return false;
  *slot = candidate;
  return true;
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
  // NSTextInputClient asks this process default before it schedules a held
  // key. Electron otherwise inherits macOS press-and-hold, which waits for an
  // accent choice and emits no repeat keydowns to the game's hidden proxy.
  // Registration is process-local and non-persistent: it changes neither the
  // player's global keyboard preference nor another application. This policy
  // belongs to native input initialization, not the Command-release monitor.
  [NSUserDefaults.standardUserDefaults
      registerDefaults:@{ @"ApplePressAndHoldEnabled" : @NO }];

  napi_property_descriptor properties[] = {
      {"load", nullptr, LoadCallback, nullptr, nullptr, nullptr, napi_default,
       nullptr},
      {"save", nullptr, SaveCallback, nullptr, nullptr, nullptr, napi_default,
       nullptr},
      {"clear", nullptr, ClearCallback, nullptr, nullptr, nullptr, napi_default,
       nullptr},
      {"monitorCommandKeyUps", nullptr, MonitorCommandKeyUpsCallback, nullptr,
       nullptr, nullptr, napi_default, nullptr},
  };
  if (napi_define_properties(env, exports,
                             sizeof(properties) / sizeof(properties[0]),
                             properties) != napi_ok) {
    napi_throw_error(env, nullptr, "native host module initialization failed");
    return nullptr;
  }
  return exports;
}

} // namespace

NAPI_MODULE(gwonmac_host, Init)
