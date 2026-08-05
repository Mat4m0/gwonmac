/**
 * The renderer half of the game's TCP: one object per connection carrying the
 * three callbacks ArenaNet's glue assigns, multiplexed over the single native
 * event stream.
 *
 * The main process owns the handles, the destination checks and the
 * backpressure; this owns the demultiplexing and nothing else. An event that
 * arrives for a socket the caller has not finished creating is queued rather
 * than dropped — the connect round trip can complete first — and is delivered
 * in arrival order once the object exists.
 */
import type { GwNativeApi, SocketEvent } from '../shared/contracts.js';

// The bridge's own socket surface, named rather than restated: this host is the
// only renderer-side caller of it, and a second spelling of those four methods
// would be free to drift from the contract the preload actually exposes.
type NativeSockets = GwNativeApi['sockets'];

/**
 * One connection as ArenaNet's glue uses it: three assignable callbacks and
 * `send`/`close`. `deliver` is this host's own entry point — the demultiplexer
 * calls it, the client never does.
 */
type HostSocket = {
  onopen: (() => void) | null;
  onclose: (() => void) | null;
  onmessage: ((data: Uint8Array) => void) | null;
  send(data: Uint8Array | ArrayBuffer): Promise<void>;
  close(): void;
  deliver(event: SocketEvent): void;
};

type SocketHostOptions = {
  native: NativeSockets;
  diagnostics?: RendererDiagnostics;
  socketOpened?: () => void;
  log(...values: unknown[]): void;
};

export function createSocketHost({
  native,
  diagnostics,
  socketOpened,
  log,
}: SocketHostOptions) {
  const sockets = new Map<number, HostSocket>();
  const earlyEvents = new Map<number, SocketEvent[]>();

  const unsubscribe = native.onEvent((event) => {
    const socket = sockets.get(event.socketId);
    if (socket) {
      socket.deliver(event);
      return;
    }
    const pending = earlyEvents.get(event.socketId) ?? [];
    pending.push(event);
    earlyEvents.set(event.socketId, pending);
  });

  function makeSocket(destination: string): HostSocket {
    let id: number | null = null;
    let opened = false;
    let closed = false;
    let closeRequested = false;

    const finish = () => {
      if (closed) return;
      const finalId = id;
      id = null;
      opened = false;
      closed = true;
      if (finalId !== null) sockets.delete(finalId);
      socket.onclose?.();
    };

    const socket: HostSocket = {
      onopen: null,
      onclose: null,
      onmessage: null,
      send(data) {
        const source = data instanceof Uint8Array ? data : new Uint8Array(data);
        const bytes = Uint8Array.from(source);
        const started = performance.now();
        const pending =
          id !== null && opened && !closed
            ? native.send(id, bytes)
            : Promise.reject(new Error('socket is not open'));
        diagnostics?.socketSend(
          started,
          (performance.now() - started) * 1000,
          source.byteLength,
          source.buffer.byteLength,
          bytes.buffer.byteLength,
          pending,
        );
        return pending;
      },
      close() {
        if (closed || closeRequested) return;
        closeRequested = true;
        if (id !== null) {
          void native.close(id).catch(() => finish());
        }
      },
      deliver(event) {
        if (closed) return;
        if (event.type === 'open') {
          opened = true;
          socketOpened?.();
          socket.onopen?.();
        } else if (event.type === 'data') {
          socket.onmessage?.(event.data);
        } else if (event.type === 'error') {
          // Main always follows an error with the socket's one final close.
          // Keep the native identity until that close arrives; deleting it
          // here would queue the close forever as an "early" event.
          log('socket error', event.code);
        } else {
          // Clear native identity before the callback. Client close handlers
          // can synchronously call close() again.
          finish();
        }
      },
    };

    log('socket.connect', destination);
    void native.connect(destination).then((socketId) => {
      if (closed) {
        void native.close(socketId);
        return;
      }
      id = socketId;
      sockets.set(socketId, socket);
      const pending = earlyEvents.get(socketId);
      earlyEvents.delete(socketId);
      for (const event of pending ?? []) socket.deliver(event);
      if (closeRequested && !closed) {
        void native.close(socketId).catch(() => finish());
      }
    }).catch((error: unknown) => {
      log(
        'socket.connect failed',
        error instanceof Error ? error.message : String(error),
      );
      finish();
    });
    return socket;
  }

  return {
    socket: { connect: makeSocket },

    /** How many connections the client currently holds. */
    openCount: () => sockets.size,

    /**
     * Drop every connection but stay subscribed, so the client can reconnect
     * on this same page — which is what tells a disconnect apart from a
     * teardown. `dispose` is the teardown; this is not, and unsubscribing here
     * would silently break the reconnection it exists to allow.
     *
     * Only the close is requested. Each socket leaves the map and calls the
     * client's `onclose` when main confirms it, exactly as a reset from the
     * far end does — clearing the map here would strand those confirmations as
     * events for sockets nobody knows, and the client would never learn it had
     * been disconnected.
     */
    closeAll() {
      for (const socket of sockets.values()) socket.close();
    },

    dispose() {
      unsubscribe();
      earlyEvents.clear();
      for (const socket of sockets.values()) socket.close();
      sockets.clear();
    },
  };
}
