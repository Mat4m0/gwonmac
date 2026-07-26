/**
 * @typedef {{
 *   connect(destination: string): Promise<number>,
 *   send(socketId: number, data: Uint8Array): Promise<void>,
 *   close(socketId: number): Promise<void>,
 *   onEvent(callback: (event: import('../shared/contracts.js').SocketEvent) => void): () => void
 * }} NativeSockets
 */

/**
 * @param {{
 *   native: NativeSockets,
 *   diagnostics?: RendererDiagnostics,
 *   log(...values: unknown[]): void
 * }} options
 */
export function createSocketHost({ native, diagnostics, log }) {
  /** @type {Map<number, ReturnType<typeof makeSocket>>} */
  const sockets = new Map();
  /** @type {Map<number, import('../shared/contracts.js').SocketEvent[]>} */
  const earlyEvents = new Map();

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

  /** @param {string} destination */
  function makeSocket(destination) {
    /** @type {number | null} */
    let id = null;
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

    const socket = {
      /** @type {null | (() => void)} */
      onopen: null,
      /** @type {null | (() => void)} */
      onclose: null,
      /** @type {null | ((data: Uint8Array) => void)} */
      onmessage: null,
      /** @param {Uint8Array | ArrayBuffer} data */
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
      /** @param {import('../shared/contracts.js').SocketEvent} event */
      deliver(event) {
        if (closed) return;
        if (event.type === 'open') {
          opened = true;
          socket.onopen?.();
        } else if (event.type === 'data') {
          socket.onmessage?.(event.data);
        } else {
          if (event.type === 'error') log('socket error', event.code);
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
    }).catch((error) => {
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
    dispose() {
      unsubscribe();
      earlyEvents.clear();
      for (const socket of sockets.values()) socket.close();
      sockets.clear();
    },
  };
}
