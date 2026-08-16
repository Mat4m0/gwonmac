/**
 * Thresholded, identifier-free gamepad transitions for the input harness.
 * Sampling exists only while the player has the harness open.
 */
import type { InputTrace } from '../shared/input-trace.js';

export interface GamepadTraceController {
  setEnabled(enabled: boolean): void;
}

type Snapshot = {
  buttons: boolean[];
  axes: Array<-1 | 0 | 1>;
};

const axisDirection = (value: number): -1 | 0 | 1 =>
  value < -0.55 ? -1 : value > 0.55 ? 1 : 0;

export function installGamepadTrace(trace: InputTrace): GamepadTraceController {
  const previous = new Map<number, Snapshot>();
  let active = false;
  let frame = 0;

  const sample = () => {
    frame = 0;
    if (!active) return;
    const seen = new Set<number>();
    for (const gamepad of navigator.getGamepads?.() ?? []) {
      if (!gamepad) continue;
      seen.add(gamepad.index);
      const before = previous.get(gamepad.index);
      const next: Snapshot = {
        buttons: gamepad.buttons.map((button) => button.pressed),
        axes: gamepad.axes.map(axisDirection),
      };
      if (!before) {
        trace.record({ source: 'renderer', kind: 'gamepad', phase: 'connected' });
      } else {
        next.buttons.forEach((pressed, control) => {
          if (pressed === before.buttons[control]) return;
          trace.record({
            source: 'renderer', kind: 'gamepad',
            phase: pressed ? 'button-down' : 'button-up', control,
          });
        });
        next.axes.forEach((direction, control) => {
          if (direction === before.axes[control]) return;
          trace.record({
            source: 'renderer', kind: 'gamepad', phase: 'axis', control, direction,
          });
        });
      }
      previous.set(gamepad.index, next);
    }
    for (const index of previous.keys()) {
      if (seen.has(index)) continue;
      previous.delete(index);
      trace.record({ source: 'renderer', kind: 'gamepad', phase: 'disconnected' });
    }
    frame = requestAnimationFrame(sample);
  };

  return Object.freeze({
    setEnabled(enabled: boolean) {
      if (enabled === active) return;
      active = enabled;
      previous.clear();
      if (enabled) frame = requestAnimationFrame(sample);
      else if (frame) cancelAnimationFrame(frame);
      frame = 0;
    },
  });
}
