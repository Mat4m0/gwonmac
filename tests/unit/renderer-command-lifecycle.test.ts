import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { register } from "node:module";
import test from "node:test";

type CompletionListener = (
  event: { sender: { id: number } },
  id: unknown,
  outcome: unknown,
) => void;

register(
  `data:text/javascript,${encodeURIComponent(
    `export function resolve(specifier, context, next) {
       if (specifier === "electron") {
         return {
           url: "data:text/javascript," + encodeURIComponent(
             "export const ipcMain = { on(_channel, listener) { globalThis.__rendererCommandCompletion = listener; } };",
           ),
           format: "module",
           shortCircuit: true,
         };
       }
       if (specifier.endsWith("/diagnostics/recorder.js")) {
         return {
           url: "data:text/javascript,export function logEvent() {}",
           format: "module",
           shortCircuit: true,
         };
       }
       if (specifier.endsWith("/window-registry.js")) {
         return {
           url: "data:text/javascript,export const windowRegistry = {};",
           format: "module",
           shortCircuit: true,
         };
       }
       return next(specifier, context);
     }`,
  )}`,
);

const { sendRendererCommand } = await import(
  "../../src/main/renderer-commands.ts"
);

class FakeContents extends EventEmitter {
  readonly id = 41;
  sent: Array<[string, number, unknown]> = [];

  isDestroyed(): boolean { return false; }
  isCrashed(): boolean { return false; }
  send(channel: string, id: number, command: unknown): void {
    this.sent.push([channel, id, command]);
  }
}

function fakeWindow(contents: FakeContents): never {
  return {
    isDestroyed: () => false,
    webContents: contents,
  } as never;
}

test("a renderer handler may complete before the final load event", async () => {
  const contents = new FakeContents();
  const outcome = sendRendererCommand(fakeWindow(contents), {
    type: "input.reset",
  });
  const sent = contents.sent[0];
  assert.ok(sent);

  // Electron can emit this after DOMContentLoaded and after the renderer has
  // already installed and started handling the command.
  contents.emit("did-finish-load");
  const complete = (globalThis as {
    __rendererCommandCompletion?: CompletionListener;
  }).__rendererCommandCompletion;
  assert.ok(complete);
  complete({ sender: { id: contents.id } }, sent[1], "completed");

  assert.equal(await outcome, "completed");
});
