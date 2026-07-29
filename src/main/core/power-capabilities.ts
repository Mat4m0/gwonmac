export const NATIVE_CAPABILITY_UNAVAILABLE = "unavailable" as const;
export const NATIVE_CAPABILITY_UNKNOWN = "unknown" as const;

export interface NativePowerCapabilities {
  batteryState: boolean;
  batteryEvents: boolean;
  thermalState: boolean;
  cpuSpeedLimitEvents: boolean;
}

export function nativePowerCapabilities(
  platform: NodeJS.Platform,
): NativePowerCapabilities {
  if (platform === "darwin") {
    return {
      batteryState: true,
      batteryEvents: true,
      thermalState: true,
      cpuSpeedLimitEvents: true,
    };
  }
  if (platform === "win32") {
    return {
      batteryState: true,
      batteryEvents: true,
      thermalState: false,
      cpuSpeedLimitEvents: true,
    };
  }
  if (platform === "linux") {
    return {
      batteryState: true,
      batteryEvents: false,
      thermalState: false,
      cpuSpeedLimitEvents: false,
    };
  }
  return {
    batteryState: false,
    batteryEvents: false,
    thermalState: false,
    cpuSpeedLimitEvents: false,
  };
}

export function readNativeCapability<T>(
  available: boolean,
  read: () => T,
): T | typeof NATIVE_CAPABILITY_UNAVAILABLE {
  if (!available) return NATIVE_CAPABILITY_UNAVAILABLE;
  try {
    return read();
  } catch {
    return NATIVE_CAPABILITY_UNAVAILABLE;
  }
}
