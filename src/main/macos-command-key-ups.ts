/**
 * macOS Command-held key releases that AppKit consumes before Chromium sees
 * them. The focused game window receives one physical-key release through the
 * existing renderer command boundary.
 */
import { physicalCodeForMacKeyCode } from "./core/macos-key-code.js";
import type { NativeInputMonitor } from "./native-host.js";

export interface MacosCommandKeyUpRouting<T> {
  focusedGameTarget(): T | null;
  release(target: T, code: string): void;
}

export function installMacosCommandKeyUps<T>(
  nativeHost: NativeInputMonitor,
  routing: MacosCommandKeyUpRouting<T>,
): () => void {
  return nativeHost.monitorCommandKeyUps((keyCode) => {
    const code = physicalCodeForMacKeyCode(keyCode);
    if (!code) return false;
    const target = routing.focusedGameTarget();
    if (!target) return false;
    routing.release(target, code);
    return true;
  });
}
