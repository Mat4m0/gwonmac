/**
 * Development-only virtual standard gamepad for opening and exercising the
 * real Guild Wars controller interface without connected hardware. It shadows
 * `getGamepads` only on this renderer's Navigator instance, preserves every
 * physical pad, and restores the original property when disposed.
 */

export interface VirtualGamepadController {
  connect(): void;
  activateUi(): void;
  press(button: number): void;
  release(button: number): void;
  tap(button: number): void;
  disconnect(): void;
  dispose(): void;
  state(): Readonly<{ connected: boolean; index: number | null }>;
}

type NavigatorWithGamepads = Pick<Navigator, "getGamepads">;
type Timer = ReturnType<typeof setTimeout>;

const BUTTON_COUNT = 17;
const AXIS_COUNT = 4;
const PULSE_MS = 140;

type MutableButton = {
  pressed: boolean;
  touched: boolean;
  value: number;
};

export function installVirtualGamepad({
  navigatorTarget = navigator,
  eventTarget = window,
  now = () => performance.now(),
  schedule = setTimeout,
  cancel = clearTimeout,
  log = console.info,
}: {
  navigatorTarget?: NavigatorWithGamepads;
  eventTarget?: Pick<Window, "dispatchEvent">;
  now?: () => number;
  schedule?: (callback: () => void, delay: number) => Timer;
  cancel?: (timer: Timer) => void;
  log?: (...values: unknown[]) => void;
} = {}): VirtualGamepadController {
  const originalDescriptor = Object.getOwnPropertyDescriptor(navigatorTarget, "getGamepads");
  const nativeGetGamepads = navigatorTarget.getGamepads?.bind(navigatorTarget)
    ?? (() => [] as (Gamepad | null)[]);
  const buttons: MutableButton[] = Array.from({ length: BUTTON_COUNT }, () => ({
    pressed: false,
    touched: false,
    value: 0,
  }));
  const axes = Array<number>(AXIS_COUNT).fill(0);
  const timers = new Set<Timer>();
  let connected = false;
  let index: number | null = null;
  let timestamp = now();
  let disposed = false;

  const touch = () => { timestamp = now(); };
  const snapshot = (): Gamepad => ({
    axes: [...axes],
    buttons: buttons.map((button) => ({ ...button })),
    connected,
    id: "GWonMac Development Virtual Controller",
    index: index ?? 0,
    mapping: "standard",
    timestamp,
    vibrationActuator: {
      playEffect: async () => "complete",
      reset: async () => "complete",
    },
  });

  const dispatch = (name: "gamepadconnected" | "gamepaddisconnected") => {
    const event = new Event(name) as Event & { gamepad: Gamepad };
    Object.defineProperty(event, "gamepad", { value: snapshot(), enumerable: true });
    eventTarget.dispatchEvent(event);
  };

  const readNative = () => Array.from(nativeGetGamepads() ?? []);
  const firstFreeIndex = (gamepads: readonly (Gamepad | null)[]) => {
    const free = gamepads.findIndex((gamepad) => gamepad === null);
    return free === -1 ? gamepads.length : free;
  };
  Object.defineProperty(navigatorTarget, "getGamepads", {
    configurable: true,
    value: () => {
      const physical = readNative();
      if (!connected || index === null) return physical;
      while (physical.length <= index) physical.push(null);
      // The virtual index is chosen after all connected hardware, so this must
      // normally be empty. If a real pad later claims it, append instead of
      // hiding hardware and update the virtual event identity on the next read.
      if (physical[index] !== null) index = firstFreeIndex(physical);
      physical[index] = snapshot();
      return physical;
    },
  });

  const clearState = () => {
    for (const timer of timers) cancel(timer);
    timers.clear();
    for (const button of buttons) {
      button.pressed = false;
      button.touched = false;
      button.value = 0;
    }
    axes.fill(0);
    touch();
  };

  const validButton = (button: number) => Number.isInteger(button)
    && button >= 0 && button < BUTTON_COUNT;

  const controller: VirtualGamepadController = Object.freeze({
    connect() {
      if (disposed || connected) return;
      const physical = readNative();
      index = firstFreeIndex(physical);
      connected = true;
      touch();
      dispatch("gamepadconnected");
    },
    activateUi() {
      if (disposed) return;
      controller.connect();
      axes[2] = 0.85;
      touch();
      const timer = schedule(() => {
        timers.delete(timer);
        axes[2] = 0;
        touch();
      }, PULSE_MS);
      timers.add(timer);
    },
    press(button: number) {
      if (disposed || !connected || !validButton(button)) return;
      const value = buttons[button]!;
      value.pressed = true;
      value.touched = true;
      value.value = 1;
      touch();
    },
    release(button: number) {
      if (disposed || !connected || !validButton(button)) return;
      const value = buttons[button]!;
      value.pressed = false;
      value.touched = false;
      value.value = 0;
      touch();
    },
    tap(button: number) {
      if (disposed || !validButton(button)) return;
      controller.connect();
      controller.press(button);
      const timer = schedule(() => {
        timers.delete(timer);
        controller.release(button);
      }, PULSE_MS);
      timers.add(timer);
    },
    disconnect() {
      if (disposed || !connected) return;
      clearState();
      connected = false;
      dispatch("gamepaddisconnected");
      index = null;
    },
    dispose() {
      if (disposed) return;
      if (connected) controller.disconnect();
      disposed = true;
      if (originalDescriptor) {
        Object.defineProperty(navigatorTarget, "getGamepads", originalDescriptor);
      } else {
        Reflect.deleteProperty(navigatorTarget, "getGamepads");
      }
    },
    state: () => Object.freeze({ connected, index }),
  });

  log(
    "Virtual controller ready. Run gwVirtualGamepad.activateUi() in DevTools; "
      + "button 0 is Cross, 1 Circle, 2 Square, and 3 Triangle.",
  );
  return controller;
}
