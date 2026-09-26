/**
 * The result a host-driven native publish returns when the client's renderer
 * is flushing its queue or still holds the model it would change. Nothing
 * was changed; the host keeps its current state and retries on a later frame.
 * Main encodes it in the transforms and the renderer layers act on it, so
 * both read it here.
 */
export const NATIVE_PUBLISH_BUSY = 2;
