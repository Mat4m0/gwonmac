#pragma once

#include <node_api.h>

napi_value GwonmacStartDictation(napi_env env, napi_callback_info info);
napi_value GwonmacPrepareDictation(napi_env env, napi_callback_info info);
napi_value GwonmacFinishDictation(napi_env env, napi_callback_info info);
napi_value GwonmacCancelDictation(napi_env env, napi_callback_info info);
void GwonmacCleanupDictation(void *data);
