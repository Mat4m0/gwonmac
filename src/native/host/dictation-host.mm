/** Node-API ownership for the single app-wide Apple Speech session. */

#include "dictation-host.hpp"

#import <Foundation/Foundation.h>

#include <cstdint>
#include <cstring>
#include <new>

extern "C" {
using GwonmacSpeechCallback = void (*)(void *, int32_t, const char *, double,
                                       int32_t);
bool GwonmacModernSpeechAvailable();
void GwonmacModernSpeechStart(GwonmacSpeechCallback callback, void *context);
void GwonmacModernSpeechPrepare(GwonmacSpeechCallback callback, void *context);
void GwonmacModernSpeechFinish();
void GwonmacModernSpeechCancel();
}

namespace {

struct DictationSession {
  napi_env env = nullptr;
  napi_ref callback = nullptr;
  napi_async_context async_context = nullptr;
  uintptr_t token = 0;
  bool finishing = false;
};

DictationSession *gSession = nullptr;
uintptr_t gNextToken = 0;

void ClearPendingException(napi_env env) {
  bool pending = false;
  if (napi_is_exception_pending(env, &pending) == napi_ok && pending) {
    napi_value ignored;
    napi_get_and_clear_last_exception(env, &ignored);
  }
}

void SetUtf8(napi_env env, napi_value object, const char *name,
             const char *value) {
  napi_value string;
  if (napi_create_string_utf8(env, value, NAPI_AUTO_LENGTH, &string) == napi_ok)
    napi_set_named_property(env, object, name, string);
}

void SetDouble(napi_env env, napi_value object, const char *name,
               double value) {
  napi_value number;
  if (napi_create_double(env, value, &number) == napi_ok)
    napi_set_named_property(env, object, name, number);
}

void Dispatch(DictationSession *session, const char *type,
              NSString *transcript = nil, bool final = false,
              const char *reason = nullptr, double progress = -1) {
  if (session == nullptr || session != gSession)
    return;
  napi_handle_scope scope = nullptr;
  napi_value callback;
  napi_value receiver;
  napi_value event;
  napi_value ignored;
  if (napi_open_handle_scope(session->env, &scope) != napi_ok ||
      napi_get_reference_value(session->env, session->callback, &callback) !=
          napi_ok ||
      napi_get_global(session->env, &receiver) != napi_ok ||
      napi_create_object(session->env, &event) != napi_ok) {
    ClearPendingException(session->env);
    if (scope != nullptr)
      napi_close_handle_scope(session->env, scope);
    return;
  }
  SetUtf8(session->env, event, "type", type);
  if (transcript != nil) {
    if (std::strcmp(type, "ready") == 0) {
      SetUtf8(session->env, event, "locale", transcript.UTF8String ?: "");
    } else {
      SetUtf8(session->env, event, "transcript", transcript.UTF8String ?: "");
      napi_value finalValue;
      if (napi_get_boolean(session->env, final, &finalValue) == napi_ok)
        napi_set_named_property(session->env, event, "final", finalValue);
    }
  }
  if (reason != nullptr)
    SetUtf8(session->env, event, "reason", reason);
  if (progress >= 0)
    SetDouble(session->env, event, "progress", progress);
  napi_make_callback(session->env, session->async_context, receiver, callback,
                     1, &event, &ignored);
  ClearPendingException(session->env);
  napi_close_handle_scope(session->env, scope);
}

void Cleanup(bool cancelTask) {
  DictationSession *session = gSession;
  if (session == nullptr)
    return;
  gSession = nullptr;
  if (cancelTask)
    GwonmacModernSpeechCancel();
  if (session->callback != nullptr)
    napi_delete_reference(session->env, session->callback);
  if (session->async_context != nullptr)
    napi_async_destroy(session->env, session->async_context);
  delete session;
}

void Receive(void *context, int32_t event, const char *text, double progress,
             int32_t final) {
  const auto token = reinterpret_cast<uintptr_t>(context);
  DictationSession *session = gSession;
  if (session == nullptr || session->token != token)
    return;
  switch (event) {
  case 0:
    Dispatch(session, "preparing");
    return;
  case 1:
    Dispatch(session, "preparing", nil, false, nullptr, progress);
    return;
  case 2:
    Dispatch(session, "ready", text == nullptr
      ? @"" : [NSString stringWithUTF8String:text]);
    Cleanup(false);
    return;
  case 3:
    Dispatch(session, "listening");
    return;
  case 4: {
    NSString *transcript = text == nullptr
                               ? @""
                               : [NSString stringWithUTF8String:text];
    Dispatch(session, "result", transcript ?: @"", final != 0);
    if (final != 0)
      Cleanup(false);
    return;
  }
  case 5:
    Dispatch(session, "error", nil, false,
             text == nullptr ? "recognition-failed" : text);
    Cleanup(false);
    return;
  default:
    Dispatch(session, "error", nil, false, "recognition-failed");
    Cleanup(false);
  }
}

napi_value Begin(napi_env env, napi_callback_info info, bool setup) {
  size_t argc = 1;
  napi_value argv[1];
  napi_valuetype type = napi_undefined;
  if (napi_get_cb_info(env, info, &argc, argv, nullptr, nullptr) != napi_ok ||
      argc != 1 || napi_typeof(env, argv[0], &type) != napi_ok ||
      type != napi_function || ![NSThread isMainThread]) {
    napi_throw_type_error(env, nullptr, "dictation callback is required");
    return nullptr;
  }
  Cleanup(true);
  auto *session = new (std::nothrow) DictationSession();
  if (session == nullptr) {
    napi_throw_error(env, nullptr, "dictation is unavailable");
    return nullptr;
  }
  session->env = env;
  session->token = ++gNextToken;
  if (session->token == 0)
    session->token = ++gNextToken;
  napi_value resource;
  napi_value resourceName;
  if (napi_create_reference(env, argv[0], 1, &session->callback) != napi_ok ||
      napi_create_object(env, &resource) != napi_ok ||
      napi_create_string_utf8(env, "gwonmac.dictation", NAPI_AUTO_LENGTH,
                              &resourceName) != napi_ok ||
      napi_async_init(env, resource, resourceName, &session->async_context) !=
          napi_ok) {
    if (session->callback != nullptr)
      napi_delete_reference(env, session->callback);
    if (session->async_context != nullptr)
      napi_async_destroy(env, session->async_context);
    delete session;
    napi_throw_error(env, nullptr, "dictation is unavailable");
    return nullptr;
  }
  gSession = session;
  if (!GwonmacModernSpeechAvailable()) {
    Dispatch(session, "error", nil, false, "unavailable");
    Cleanup(false);
  } else if (setup) {
    GwonmacModernSpeechPrepare(Receive,
      reinterpret_cast<void *>(session->token));
  } else {
    GwonmacModernSpeechStart(Receive,
      reinterpret_cast<void *>(session->token));
  }
  napi_value undefined;
  napi_get_undefined(env, &undefined);
  return undefined;
}

bool HasNoArguments(napi_env env, napi_callback_info info) {
  size_t argc = 0;
  return napi_get_cb_info(env, info, &argc, nullptr, nullptr, nullptr) == napi_ok
      && argc == 0;
}

} // namespace

napi_value GwonmacStartDictation(napi_env env, napi_callback_info info) {
  return Begin(env, info, false);
}

napi_value GwonmacPrepareDictation(napi_env env, napi_callback_info info) {
  return Begin(env, info, true);
}

napi_value GwonmacFinishDictation(napi_env env, napi_callback_info info) {
  if (!HasNoArguments(env, info)) {
    napi_throw_type_error(env, nullptr, "invalid dictation arguments");
    return nullptr;
  }
  if (gSession != nullptr && !gSession->finishing) {
    gSession->finishing = true;
    GwonmacModernSpeechFinish();
  }
  napi_value undefined;
  napi_get_undefined(env, &undefined);
  return undefined;
}

napi_value GwonmacCancelDictation(napi_env env, napi_callback_info info) {
  if (!HasNoArguments(env, info)) {
    napi_throw_type_error(env, nullptr, "invalid dictation arguments");
    return nullptr;
  }
  Cleanup(true);
  napi_value undefined;
  napi_get_undefined(env, &undefined);
  return undefined;
}

void GwonmacCleanupDictation(void *) { Cleanup(true); }
