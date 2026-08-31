/**
 * Resolve Node-API imports from the executable that loaded this addon.
 * Electron applications are renamed for distribution, so loading NODE.EXE
 * by name would map a second executable into the process instead of using
 * Electron's exported Node-API functions.
 */
#define WIN32_LEAN_AND_MEAN

#include <windows.h>
#include <delayimp.h>

#include <cstring>

namespace {

FARPROC WINAPI ResolveNodeHost(unsigned int event, DelayLoadInfo *info) {
  if (event != dliNotePreLoadLibrary ||
      _stricmp(info->szDll, "NODE.EXE") != 0) {
    return nullptr;
  }
  return reinterpret_cast<FARPROC>(GetModuleHandleW(nullptr));
}

}  // namespace

decltype(__pfnDliNotifyHook2) __pfnDliNotifyHook2 = ResolveNodeHost;
