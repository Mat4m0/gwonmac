// Checks that Gw.js can adopt the Module object the harness defines.
//
// Gw.js opens with the standard Emscripten handshake:
//     var Module = typeof Module != 'undefined' ? Module : {};
// which adopts a pre-existing Module -- but only if ours is a `var`. Declaring
// it with const/let creates a global lexical binding that the glue's `var`
// collides with, and in a browser Gw.js dies at parse time with
// "Identifier 'Module' has already been declared".
//
// Two <script> tags sharing one global scope are modelled with vm.runInContext
// against a single context.
//
//   node tests/test_harness.js

const vm = require('vm');
const fs = require('fs');
const path = require('path');

const harness = fs.readFileSync(
  path.join(__dirname, '..', 'harness', 'harness.js'), 'utf8');

const GLUE = "var Module = typeof Module != 'undefined' ? Module : {};" +
             "globalThis.__adopted = Module;";

function makeCtx() {
  // Rich enough for the harness to run headlessly: it wires listeners onto
  // the canvas and the OSK fields, and reads navigator to decide isMobile.
  const mkEl = () => ({
    style: {},
    textContent: '', scrollTop: 0, scrollHeight: 0, value: '',
    width: 0, height: 0, tabIndex: 0,
    addEventListener() {}, removeEventListener() {},
    focus() {}, blur() {},
    classList: { add() {}, remove() {} },
    parentElement: { classList: { add() {}, remove() {} } },
    getContext: () => null,
  });
  const el = mkEl();
  return vm.createContext({
    document: {
      getElementById: () => el,
      createElement: () => mkEl(),
      body: { appendChild: () => {} },
    },
    // The harness targets a browser and assigns its console helpers onto
    // window at module scope, so this has to exist or Module is never built.
    // gwLoading is stubbed to never resolve: boot() waits on it, and this test
    // is only interested in the Module built before that point.
    window: {
      addEventListener() {}, removeEventListener() {},
      gwLoading: { set() {}, fail() {}, done() {},
                   waitForClient: () => new Promise(() => {}) },
    },
    navigator: { userAgent: 'node-test', maxTouchPoints: 0, storage: undefined },
    // The relay is same-origin now, so socket.connect builds its URL from
    // location.host rather than a configured port.
    location: { host: '127.0.0.1:8080', origin: 'http://127.0.0.1:8080' },
    localStorage: {
      _v: new Map(),
      getItem(k) { return this._v.has(k) ? this._v.get(k) : null; },
      setItem(k, v) { this._v.set(k, v); },
      removeItem(k) { this._v.delete(k); },
    },
    caches: undefined,
    console, Proxy, WebAssembly,
    fetch: () => Promise.resolve({ ok: false, status: 404 }),
    WebSocket: function () {},
  });
}

function trial(script) {
  const ctx = makeCtx();
  try {
    vm.runInContext(script, ctx);   // <script> #1: harness
    vm.runInContext(GLUE, ctx);     // <script> #2: Gw.js
    return ctx.__adopted || null;
  } catch (e) {
    return null;
  }
}

const results = [];
const check = (name, cond) => {
  results.push(cond);
  console.log(`  ${cond ? 'PASS' : 'FAIL'}  ${name}`);
};

const m = trial(harness);
// Assert the glue got OUR object, not a fresh {} of its own -- the handshake
// silently falls back to {} when it cannot see ours, which looks like success.
check('glue adopts the harness Module', !!m && typeof m.image === 'object');

// Declaring Module lexically must NOT reach the glue, or the check above
// proves nothing. Two ways this fails depending on scope: at top level the
// glue's `var Module` collides and Gw.js dies at parse time; inside the IIFE
// it is merely invisible and the glue builds its own empty {}.
const broken = trial(
  harness.replace(/^var Module;/m, '').replace(/^Module = \{/m, 'const Module = {'));
check('lexically-declared Module does not reach the glue',
      !broken || typeof broken.image !== 'object');

// Every method the glue calls on Module.image, recovered from the EM_ASM
// bodies in Gw.js. A missing one surfaces as a TypeError mid-boot, so assert
// them up front rather than discovering them one reload at a time.
for (const meth of ['open', 'fileSize', 'close', 'readAsync', 'isCached', 'cacheAsync']) {
  check(`image.${meth}() present`, !!m && typeof m.image[meth] === 'function');
}

check('dns.resolve() present', !!m && typeof m.dns.resolve === 'function');
check('socket.connect() present', !!m && typeof m.socket.connect === 'function');

// The glue assigns onopen/onclose/onmessage on whatever connect() returns,
// and calls onmessage with the payload directly rather than an event.
if (m) {
  const sock = m.socket.connect('127.0.0.1:6112');
  for (const cb of ['onopen', 'onclose', 'onmessage']) {
    check(`socket exposes ${cb}`, cb in sock);
  }
  check('socket.send() present', typeof sock.send === 'function');
}

// Objects the glue touches that we only stub; each must read back callable,
// since call sites test `typeof Module.x.y === 'function'` first.
for (const obj of ['shop', 'adProvider', 'browser', 'events', 'ageSignals']) {
  check(`${obj} stub is callable`, !!m && typeof m[obj].anyMethod === 'function');
}

// Credentials are a real implementation, not a stub. All three methods must
// exist together: the glue's missing-method branches call the result callback
// without returning, so a partial object throws on the next line.
for (const meth of ['getCredentials', 'storeCredentials', 'clearCredentials']) {
  check(`secureStorage.${meth}() implemented`,
        !!m && typeof m.secureStorage[meth] === 'function');
}

// No federated auth: hasProvider says so directly, and getAuthToken is absent
// so the glue reports a clean "no token" rather than calling into nothing.
check('login.hasProvider returns false', !!m && m.login.hasProvider('Steam') === false);
check('login.getAuthToken is absent', !!m && m.login.getAuthToken === undefined);
check('nativeAccount is undefined', !!m && m.nativeAccount === undefined);

const failed = results.filter((r) => !r).length;
console.log(`\n${failed} failure(s)`);
process.exit(failed ? 1 : 0);
