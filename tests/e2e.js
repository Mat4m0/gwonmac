// End-to-end test: drives the real harness in headless Chromium.
//
// Everything ArenaNet-side is replaced by local fixtures, so this runs offline
// and deterministically:
//
//   * a synthetic snapshot, served by gw.py from a chunk cache
//   * a stand-in TCP server on localhost that speaks a tiny scripted protocol
//   * a mock Gw.js that drives Module.* the way the real glue does
//
// The mock glue is the point. It exercises the harness's actual wiring --
// Module adoption, image.open/fileSize/readAsync/close, dns.resolve,
// socket.connect and the onopen/onmessage/onclose contract -- which is where
// every harness bug so far has lived (const vs var, a missing fileSize, onread
// vs onmessage). What it cannot check is whether the real wasm is happy; that
// still needs artifacts and network.
//
//   node tests/e2e.js

const crypto = require('crypto');
const fs = require('fs');
const http = require('http');
const net = require('net');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');

const REPO = path.join(__dirname, '..');
const HTTP_PORT = 8110;
const FIXTURE_PORT = 8112;
const CHUNK = 4096;

// playwright-core pins a browser build number and refuses anything else, but
// the cache here may hold a different revision. Find whatever is actually on
// disk and point launch() at it rather than downloading a second copy.
function findChrome() {
  if (process.env.CHROME_PATH) return process.env.CHROME_PATH;
  const root = path.join(os.homedir(), '.cache', 'ms-playwright');
  if (!fs.existsSync(root)) return null;
  const candidates = [];
  for (const dir of fs.readdirSync(root)) {
    candidates.push(
      path.join(root, dir, 'chrome-linux64', 'chrome'),
      path.join(root, dir, 'chrome-headless-shell-linux64', 'chrome-headless-shell'),
      path.join(root, dir, 'chrome-linux', 'chrome'));
  }
  for (const c of candidates) if (fs.existsSync(c)) return c;
  return null;
}

const results = [];
const check = (name, cond, extra = '') => {
  results.push(cond);
  console.log(`  ${cond ? 'PASS' : 'FAIL'}  ${name}${cond ? '' : '  <- ' + extra}`);
};

// The scripted exchange: the client sends HELLO, the fixture answers WELCOME.
// Enough to prove bytes survive the round trip through framing in both
// directions, which a pure "did it connect" check would not.
const CLIENT_HELLO = Buffer.from('HELLO-FROM-WASM');
const SERVER_REPLY = Buffer.from('WELCOME-TO-TYRIA');

function makeFixtureDirs() {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'gw_in_browser-e2e-'));
  const dist = path.join(tmp, 'dist');
  const cache = path.join(tmp, 'cache');
  fs.mkdirSync(dist, { recursive: true });
  fs.mkdirSync(cache, { recursive: true });

  // Synthetic snapshot: three chunks, last one short, with recognisable bytes
  // at known offsets so a misaligned read is caught rather than merely a
  // failed one.
  const blobs = [
    Buffer.alloc(CHUNK, 0xAA),
    Buffer.alloc(CHUNK, 0xBB),
    Buffer.from('TAIL-MARKER'),
  ];
  const hashes = blobs.map((b) => {
    const h = crypto.createHash('sha256').update(b).digest('hex');
    fs.writeFileSync(path.join(cache, h), b);
    return h;
  });
  const size = blobs.reduce((n, b) => n + b.length, 0);

  fs.writeFileSync(path.join(dist, 'snapshot-chunks.json'), JSON.stringify({
    size, chunkSize: CHUNK, cache, chunkHashes: hashes,
  }));

  // gw.py copies the whole harness directory now, not one file.
  for (const f of fs.readdirSync(path.join(REPO, 'harness'))) {
    fs.copyFileSync(path.join(REPO, 'harness', f), path.join(dist, f));
  }

  // Both glues, so the browser's own feature detect chooses -- on Chrome that
  // is JSPI. Both builds ship with the same output basename, so Gw.jspi.js
  // also asks for "Gw.wasm"; locateFile has to redirect it, or the JSPI glue
  // silently pairs with the Asyncify binary whenever both are present.
  fs.writeFileSync(path.join(dist, 'Gw.js'), MOCK_GLUE);
  fs.writeFileSync(path.join(dist, 'Gw.jspi.js'), MOCK_GLUE);
  const stubWasm = Buffer.from([0, 0x61, 0x73, 0x6d, 1, 0, 0, 0]);
  fs.writeFileSync(path.join(dist, 'Gw.wasm'), stubWasm);
  fs.writeFileSync(path.join(dist, 'Gw.jspi.wasm'), stubWasm);

  return { tmp, dist, size };
}

// Stands in for the real Emscripten glue: adopts Module the same way, then
// drives the services the harness provides and records what came back.
const MOCK_GLUE = `
var Module = typeof Module != 'undefined' ? Module : {};
window.__e2e = { adopted: !!Module.image, steps: [], errors: [] };
const E = window.__e2e;
// Which wasm would this glue actually be handed? Emscripten asks locateFile,
// and both builds ask for "Gw.wasm" by name.
E.locateFile = Module.locateFile ? Module.locateFile('Gw.wasm') : null;
E.jspi = !/iPad|iPhone|iPod/.test(navigator.userAgent) && ('Suspending' in WebAssembly);
const note = (s, v) => E.steps.push(s + (v === undefined ? '' : '=' + v));

// The harness writes snapshot bytes straight into Module.HEAPU8, exactly as
// the real runtime does, so give it a heap to write into.
Module.HEAPU8 = new Uint8Array(1 << 20);

(async () => {
  try {
    const h = Module.image.open('app:/Gw.snapshot');
    note('open', h);
    note('fileSize', Module.image.fileSize(h));

    // Files other than the snapshot are not backed here, and must report
    // absence. Handing back a handle makes fileSize answer with the snapshot's
    // size, and the module aborts allocating a buffer that large for a small
    // ini file.
    E.openUnknown = Module.image.open('ChatFilter.ini');
    E.openOtherPath = Module.image.open('app:/Something.dat');

    // Nothing is resident before the first read. The glue defaults to "cached"
    // when isCached is absent, so a wrong answer here silently skips reads.
    E.cachedBeforeRead = Module.image.isCached(h, 0, 16);

    // Read across a chunk boundary: 8 bytes either side of offset 4096.
    await Module.image.readAsync(h, 4088, null, 0, 16);
    E.straddle = Array.from(Module.HEAPU8.subarray(0, 16));

    // Both chunks the read straddled are now resident, and a chunk it never
    // touched is not -- so residency tracks chunks, not whole files.
    E.cachedAfterRead = Module.image.isCached(h, 4088, 16);
    E.uncachedElsewhere = Module.image.isCached(h, 8192, 8);

    // cacheAsync must make a region resident and report bytes as they land.
    let progressed = 0;
    await Module.image.cacheAsync(h, 8192, 8, (n) => { progressed += n; });
    E.cacheAsyncProgress = progressed;
    E.cachedAfterPrefetch = Module.image.isCached(h, 8192, 8);

    // Drop the memory tier and ask again: the persistent store still holds
    // these chunks, so residency must still report true.
    if (window.gwEvictMemory) window.gwEvictMemory();
    E.cachedAfterEvict = Module.image.isCached(h, 8192, 8);

    // And the short final chunk.
    await Module.image.readAsync(h, 8192, null, 64, 11);
    E.tail = new TextDecoder().decode(Module.HEAPU8.subarray(64, 75));

    // Every host function the glue calls .then() on must return a thenable.
    // Returning undefined throws "Cannot read properties of undefined
    // (reading 'then')" and kills the frame mid-connect.
    E.notThenable = [];
    const asyncMethods = [
      ['image', 'cacheAsync', [h, 0, 16, () => {}]],
      ['secureStorage', 'getCredentials', []],
      ['secureStorage', 'storeCredentials', ['u', 'p']],
      ['secureStorage', 'clearCredentials', []],
      ['adProvider', 'showInterstitial', []],
      ['ageSignals', 'check', []],
      ['shop', 'initialize', []],
      ['shop', 'inAppPurchase', ['sku']],
    ];
    for (const [obj, meth, args] of asyncMethods) {
      const r = Module[obj][meth](...args);
      if (!r || typeof r.then !== 'function') E.notThenable.push(obj + '.' + meth);
      // Rejection is fine and expected -- getCredentials rejects when nothing
      // is stored. What matters is that a thenable came back at all.
      else await r.catch(() => {});
    }
    note('asyncContract');

    // Credentials must round-trip, and the module must be told "nothing
    // stored" by rejection rather than by a resolved empty object.
    await Module.secureStorage.clearCredentials();
    let rejected = false;
    await Module.secureStorage.getCredentials().catch(() => { rejected = true; });
    E.emptyRejects = rejected;
    await Module.secureStorage.storeCredentials('user@example.com', 'pw');
    const got = await Module.secureStorage.getCredentials();
    E.credRoundTrip = got && got.username === 'user@example.com' && got.password === 'pw';
    await Module.secureStorage.clearCredentials();
    E.hasProvider = Module.login.hasProvider('Steam');
    E.nativeAccountAbsent = Module.nativeAccount === undefined;

    const ip = await Module.dns.resolve('localhost');
    note('dns', ip);

    const sock = Module.socket.connect(ip + ':${FIXTURE_PORT}');
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('socket timeout')), 8000);
      sock.onopen = () => { note('onopen'); sock.send(new Uint8Array(${JSON.stringify([...CLIENT_HELLO])})); };
      sock.onmessage = (data) => {
        E.received = new TextDecoder().decode(data);
        E.receivedType = data instanceof Uint8Array ? 'Uint8Array' : typeof data;
        note('onmessage');
        clearTimeout(timer);
        resolve();
      };
      sock.onclose = () => { note('onclose'); clearTimeout(timer); reject(new Error('closed early')); };
    });

    // Concurrent readers of the same region must share one fetch per chunk.
    // Without dedup the module's overlapping cacheAsync calls fetched the same
    // chunk several times over: a real boot moved 932MB to deliver 227MB and
    // never finished starting.
    window.gwEvictMemory();
    const before = window.gwStats();
    await Promise.all([0, 1, 2, 3].map(
      () => Module.image.cacheAsync(h, 0, 8192, () => {})));
    const after = window.gwStats();
    E.dedupFetches = (after.chunksFromNetwork - before.chunksFromNetwork)
                   + (after.chunksFromCacheStore - before.chunksFromCacheStore);
    E.dedupCoalesced = after.chunksCoalesced - before.chunksCoalesced;

    Module.image.close(h);
    note('close');

    // The real module narrates its startup and ends on 'complete', which is
    // what dismisses the loading screen. Without this the overlay stays up and
    // swallows every click the input tests below try to make -- exactly what
    // would happen in the browser if the stage names ever changed.
    Module.setStartupProgress('connecting');
    Module.setStartupProgress('downloading', 50, 1024, 2048, 10);
    E.loadingDismissed = !!document.getElementById('loading')
      && !document.getElementById('loading').classList.contains('gone');
    Module.setStartupProgress('complete');
    E.loadingGone = document.getElementById('loading').classList.contains('gone');

    E.done = true;
  } catch (err) {
    E.errors.push(String(err && err.message || err));
    E.done = true;
  }
})();
`;

function startFixtureServer() {
  return new Promise((resolve) => {
    const srv = net.createServer((sock) => {
      sock.on('data', (buf) => {
        if (buf.equals(CLIENT_HELLO)) sock.write(SERVER_REPLY);
        else sock.write(Buffer.from('UNEXPECTED:' + buf.toString()));
      });
      sock.on('error', () => {});
    });
    srv.listen(FIXTURE_PORT, '127.0.0.1', () => resolve(srv));
  });
}

function waitFor(pred, timeout = 20000) {
  return new Promise((resolve) => {
    const end = Date.now() + timeout;
    (function tick() {
      Promise.resolve(pred()).then((ok) => {
        if (ok) return resolve(true);
        if (Date.now() > end) return resolve(false);
        setTimeout(tick, 200);
      }).catch(() => setTimeout(tick, 200));
    })();
  });
}

(async () => {
  const { chromium } = require('playwright-core');
  const { tmp, dist, size } = makeFixtureDirs();
  const fixture = await startFixtureServer();

  // localhost resolves through /etc/hosts, so this also confirms the relay
  // uses getaddrinfo -- a raw DNS query would not see it.
  const server = spawn('python3', [
    path.join(REPO, 'gw.py'), '-d', dist, '-p', String(HTTP_PORT),
    '--no-browser', '--offline', '--no-update',
  ], {
    // The fixture lives on loopback, which the address rule exists to forbid,
    // so the test has to say so explicitly.
    env: {
      ...process.env,
      GW_RELAY_DOMAINS: 'localhost',
      GW_RELAY_PORTS: String(FIXTURE_PORT),
      GW_RELAY_ALLOW_PRIVATE: '1',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  const serverLog = [];
  server.stdout.on('data', (d) => serverLog.push(String(d)));
  server.stderr.on('data', (d) => serverLog.push(String(d)));

  const up = await waitFor(() => new Promise((r) => {
    http.get({ host: '127.0.0.1', port: HTTP_PORT, path: '/index.html' },
             (res) => r(res.statusCode === 200)).on('error', () => r(false));
  }));
  check('gw.py serving', up);

  let browser;
  try {
    const exe = findChrome();
    if (!exe) {
      check('chromium available', false,
            'no browser in ~/.cache/ms-playwright; set CHROME_PATH or run: npx playwright install chromium');
      throw new Error('no chromium');
    }
    browser = await chromium.launch({ executablePath: exe, args: ['--no-sandbox'] });
    const page = await browser.newPage();
    const consoleLines = [];
    page.on('console', (m) => consoleLines.push(m.text()));
    page.on('pageerror', (e) => consoleLines.push('PAGEERROR: ' + e.message));

    await page.goto(`http://127.0.0.1:${HTTP_PORT}/`, { waitUntil: 'load' });

    const finished = await waitFor(() => page.evaluate(() => window.__e2e && window.__e2e.done));
    const e2e = await page.evaluate(() => window.__e2e || null);

    // Keyboard input only reaches the module while the canvas has focus.
    const input = await page.evaluate(() => {
      const c = document.getElementById('canvas');
      const logEl = document.getElementById('log');
      return {
        tabIndex: c.tabIndex,
        focused: document.activeElement === c,
        logInert: getComputedStyle(logEl).pointerEvents === 'none',
      };
    });
    // Text entry goes through the OSK fields, never through keydown on the
    // canvas. The module probes for Module.oskInput and concludes it has no
    // way to accept text if it is absent.
    const osk = await page.evaluate(() => {
      const m = window.Module || {};
      const keys = m.oskInput ? Object.keys(m.oskInput) : [];
      const el = m.oskInput && m.oskInput.text;
      return {
        keys,
        allPresent: keys.length > 0 && keys.every((k) => !!m.oskInput[k]),
        // Must be focusable: the glue gives up if focus() does not take.
        focusable: (() => {
          if (!el) return false;
          m.oskActiveInput = el;      // pretend the module opened it
          el.focus();
          const ok = document.activeElement === el;
          m.oskActiveInput = null;
          el.blur();
          return ok;
        })(),
        modalOnDesktop: m.oskIsModal,
      };
    });
    check('oskInput exposes all five field types',
          osk.keys.length === 5 && osk.allPresent, osk.keys.join(','));
    check('OSK field is focusable', osk.focusable === true,
          'hidden rather than parked behind the canvas?');
    check('OSK not modal on desktop', osk.modalOnDesktop === false, osk.modalOnDesktop);

    // Stray focus must bounce off, or the field swallows gameplay keys.
    const bounced = await page.evaluate(async () => {
      const el = window.Module.oskInput.text;
      window.Module.oskActiveInput = null;
      el.focus();
      await new Promise((r) => setTimeout(r, 50));
      return document.activeElement !== el;
    });
    check('unsolicited focus on an OSK field bounces off', bounced === true);

    // The context menu must be suppressed for right-drag camera control, but
    // shift+right-click has to still reach it or there is no right-click route
    // into devtools.
    const ctx = await page.evaluate(() => {
      const c = document.getElementById('canvas');
      const fire = (shiftKey) => {
        const e = new MouseEvent('contextmenu', { bubbles: true, cancelable: true, shiftKey });
        c.dispatchEvent(e);
        return e.defaultPrevented;
      };
      return { plain: fire(false), shifted: fire(true) };
    });
    check('right-click is suppressed for the game', ctx.plain === true);
    check('shift+right-click still opens the browser menu', ctx.shifted === false,
          'devtools would be unreachable by right-click');

    // Mouse-to-touch translation: the module does its own tap/double-tap
    // timing, so it needs to actually receive touch events.
    const touch = await page.evaluate(async () => {
      const c = document.getElementById('canvas');
      const seen = [];
      for (const t of ['touchstart', 'touchmove', 'touchend', 'touchcancel']) {
        c.addEventListener(t, (e) => seen.push(
          `${t}:${e.changedTouches.length}:${Math.round(e.changedTouches[0].clientX)}`), true);
      }
      let mouseSeen = 0;
      c.addEventListener('mousedown', () => { mouseSeen++; });

      const mouse = (type, x, y, button = 0) => c.dispatchEvent(
        new MouseEvent(type, { bubbles: true, cancelable: true,
                               clientX: x, clientY: y, button }));

      window.gwTouchMode('translate');
      mouse('mousedown', 100, 120); mouse('mousemove', 105, 120); mouse('mouseup', 105, 120);
      const translated = seen.slice();
      const mouseAfterTranslate = mouseSeen;

      // Right button must stay as mouse -- it turns the camera.
      seen.length = 0;
      mouse('mousedown', 200, 200, 2); mouse('mouseup', 200, 200, 2);
      const rightButton = seen.slice();

      window.gwTouchMode('augment');
      seen.length = 0;
      const beforeAugment = mouseSeen;
      mouse('mousedown', 400, 400); mouse('mouseup', 400, 400);
      const augmented = seen.slice();
      const mouseDuringAugment = mouseSeen - beforeAugment;

      // dbltap is the default, and the property that matters is that a SINGLE
      // click emits no touch at all. Emitting one double-handles: the game
      // reads the tap as select and the mouse click as move, the tap wins, and
      // click-to-move stops working.
      window.gwTouchMode('dbltap');
      seen.length = 0;
      mouse('mousedown', 700, 700); mouse('mouseup', 700, 700);
      await new Promise((r) => setTimeout(r, 150));
      const singleClick = seen.slice();

      // Separate coordinates and a wait past DBL_MS, or this pair reads as a
      // continuation of the click above -- three rapid clicks, where the third
      // cancels the queued taps by design.
      await new Promise((r) => setTimeout(r, 500));

      // A rapid second click near the first must emit both taps, since the
      // game never saw the first click as a tap.
      seen.length = 0;
      mouse('mousedown', 300, 250); mouse('mouseup', 300, 250);
      mouse('mousedown', 302, 251); mouse('mouseup', 302, 251);
      await new Promise((r) => setTimeout(r, 300));
      const doubleClick = seen.slice();

      window.gwTouchMode('off');
      seen.length = 0;
      mouse('mousedown', 300, 300); mouse('mouseup', 300, 300);
      const whenOff = seen.slice();

      window.gwTouchMode('dbltap');
      return { translated, rightButton, whenOff, mouseAfterTranslate,
               augmented, mouseDuringAugment, singleClick, doubleClick,
               hasTap: typeof window.gwTap === 'function' };
    });
    check('mousedown produces a touchstart',
          touch.translated.some((s) => s.startsWith('touchstart:1:100')), touch.translated);
    check('drag produces a touchmove',
          touch.translated.some((s) => s.startsWith('touchmove:1:105')), touch.translated);
    check('mouseup produces a touchend',
          touch.translated.some((s) => s.startsWith('touchend:1:105')), touch.translated);
    check('translate mode suppresses the mouse event',
          touch.mouseAfterTranslate === 0, touch.mouseAfterTranslate);
    check('right button is not translated', touch.rightButton.length === 0,
          touch.rightButton);
    check('off mode emits nothing', touch.whenOff.length === 0, touch.whenOff);

    check('augment still emits touch',
          touch.augmented.some((s) => s.startsWith('touchstart:1:400')), touch.augmented);
    check('augment does NOT suppress the mouse -- movement depends on it',
          touch.mouseDuringAugment === 1, touch.mouseDuringAugment);

    // The default. A single click must stay purely mouse, or the tap wins over
    // the click and click-to-move dies.
    check('dbltap emits no touch for a single click',
          touch.singleClick.length === 0, touch.singleClick);
    check('dbltap emits two taps for a rapid second click',
          touch.doubleClick.filter((s) => s.startsWith('touchstart')).length === 2,
          touch.doubleClick);

    // Ordering, not just presence. A tap landing between a mousedown and its
    // mouseup breaks the game's input state machine outright:
    //   ASSERTION FAILED: evt.buttonState  Engine/Frame/FrMouse.cpp:486
    const seq = touch.doubleClick;
    const lastMouse = seq.map((s, i) => (s.startsWith('mouse') ? i : -1))
                         .filter((i) => i >= 0).pop();
    const firstTouch = seq.findIndex((s) => s.startsWith('touch'));
    check('no touch lands inside the mouse stream',
          firstTouch === -1 || lastMouse === undefined || firstTouch > lastMouse,
          seq.join(' '));
    // Checked at the source, since the run above has already written
    // localStorage and can no longer observe a first-visit default.
    const harnessSrc = fs.readFileSync(
      path.join(REPO, 'harness', 'harness.js'), 'utf8');
    const defaultMode = (harnessSrc.match(
      /localStorage\.getItem\('gw\.touchMode'\)\s*\|\|\s*'(\w+)'/) || [])[1];
    check('dbltap is the default mode', defaultMode === 'dbltap', defaultMode);
    check('gwTap helper is exposed', touch.hasTap === true);

    // Pointer lock for right-drag camera. Whether the lock actually engages
    // cannot be tested here -- browsers require real user activation, which a
    // dispatched event does not carry -- so this covers the wiring and the
    // toggle, not the grab itself.
    const lock = await page.evaluate(async () => {
      const c = document.getElementById('canvas');
      // An earlier right-button dispatch may have engaged a real lock, and the
      // handler quite rightly does not re-request one it already holds. Clear
      // it first, and report it either way so a failure explains itself.
      if (document.pointerLockElement) {
        document.exitPointerLock();
        await new Promise((r) => setTimeout(r, 100));
      }
      const lockedBefore = !!document.pointerLockElement;

      let requested = 0;
      c.requestPointerLock = () => { requested++; };   // stand in for the grab
      const mouse = (type, button) => c.dispatchEvent(
        new MouseEvent(type, { bubbles: true, cancelable: true,
                               clientX: 50, clientY: 50, button }));

      // Held right button alone must NOT lock -- capturing the cursor on
      // mousedown costs the plain right-click. Only movement past the
      // threshold promotes it to a drag.
      //
      // Dispatched events are untrusted and the promotion path requires
      // isTrusted, so this covers the button gating only.
      mouse('mousedown', 2);
      const onRightDown = requested;
      mouse('mousedown', 0);
      const onLeft = requested - onRightDown;

      window.gwPointerLock(false);
      mouse('mousedown', 2);
      const whenDisabled = requested - onRightDown - onLeft;
      window.gwPointerLock(true);
      return { onRightDown, onLeft, whenDisabled, lockedBefore,
               hasToggle: typeof window.gwPointerLock === 'function' };
    });
    check('right mousedown alone does not lock -- that would kill right-click',
          lock.onRightDown === 0,
          `${lock.onRightDown} (lock held before test: ${lock.lockedBefore})`);
    check('left button does not lock', lock.onLeft === 0, lock.onLeft);
    check('gwPointerLock(false) suppresses it', lock.whenDisabled === 0,
          lock.whenDisabled);
    check('gwPointerLock toggle is exposed', lock.hasToggle === true);

    check('canvas is keyboard-focusable (tabindex 0)', input.tabIndex === 0, input.tabIndex);
    check('canvas holds focus after boot', input.focused === true,
          'nothing focused it, so key events never reach the module');
    check('log overlay does not swallow clicks', input.logInert === true,
          'it covers the lower canvas and would steal focus');

    // And focus must be re-asserted after a click lands elsewhere.
    await page.evaluate(() => document.getElementById('log').focus?.());
    await page.mouse.click(200, 200);
    const refocused = await page.evaluate(() =>
      document.activeElement === document.getElementById('canvas'));
    check('click on canvas restores focus', refocused === true);

    // Footer links. Each must open in a new tab without handing an external
    // site a window handle or the address of a server on the user's machine.
    const links = await page.evaluate(() =>
      [...document.querySelectorAll('#loading-links a')].map((a) => ({
        text: a.textContent.trim(), href: a.href,
        target: a.target, rel: a.rel,
      })));
    check('footer links are present', links.length === 3,
          links.map((l) => l.text).join(','));
    check('footer links open externally and safely',
          links.every((l) => l.target === '_blank'
                          && l.rel.includes('noopener')
                          && l.rel.includes('noreferrer')),
          JSON.stringify(links.map((l) => l.rel)));
    check('footer links point somewhere absolute',
          links.every((l) => /^https:\/\//.test(l.href)),
          links.map((l) => l.href).join(' '));

    // A page error means the harness failed to parse -- the const/var class of
    // bug -- so surface it before anything else.
    const pageErrors = consoleLines.filter((l) => l.startsWith('PAGEERROR:'));
    check('no page errors', pageErrors.length === 0, pageErrors.join('; '));
    check('mock glue ran to completion', finished, consoleLines.slice(-6).join(' | '));

    if (!e2e) {
      check('e2e state present', false, 'window.__e2e missing');
    } else {
      check('glue adopted harness Module', e2e.adopted === true);

      // On Chrome the detect picks JSPI, so locateFile must redirect the
      // wasm to match the glue that loaded.
      const wantWasm = e2e.jspi ? 'Gw.jspi.wasm' : 'Gw.wasm';
      check(`locateFile maps wasm to ${wantWasm}`, e2e.locateFile === wantWasm,
            `got ${e2e.locateFile} (jspi=${e2e.jspi})`);
      check('no errors in glue', e2e.errors.length === 0, e2e.errors.join('; '));
      check('image.open returned a handle', /open=\d+/.test(e2e.steps.join(',')), e2e.steps);
      check('image.open reports absence for non-snapshot files',
            e2e.openUnknown === 0 && e2e.openOtherPath === 0,
            `ChatFilter.ini->${e2e.openUnknown}, Something.dat->${e2e.openOtherPath}`);
      check('image.fileSize matches snapshot', e2e.steps.includes(`fileSize=${size}`),
            e2e.steps.join(','));

      // Straddling reads are where an off-by-one in chunk mapping shows up.
      const straddle = e2e.straddle || [];
      const wantStraddle = [...Array(8).fill(0xAA), ...Array(8).fill(0xBB)];
      check('read across chunk boundary is correct',
            JSON.stringify(straddle) === JSON.stringify(wantStraddle), straddle);
      check('read of short final chunk is correct', e2e.tail === 'TAIL-MARKER', e2e.tail);

      // Residency has to be reported honestly in both directions.
      check('nothing cached before first read', e2e.cachedBeforeRead === 0,
            e2e.cachedBeforeRead);
      check('straddled chunks cached after read', e2e.cachedAfterRead === 1,
            e2e.cachedAfterRead);
      check('untouched region reports uncached', e2e.uncachedElsewhere === 0,
            e2e.uncachedElsewhere);
      check('cacheAsync reports progress', e2e.cacheAsyncProgress > 0,
            e2e.cacheAsyncProgress);
      check('cacheAsync makes region resident', e2e.cachedAfterPrefetch === 1,
            e2e.cachedAfterPrefetch);

      // Residency has to survive eviction from the memory LRU. When isCached
      // consulted memory alone, every eviction read as a miss and the module
      // re-cached regions it already held -- 41,349 chunk fetches to serve
      // 1,450 reads of 82.7MB.
      check('residency survives memory eviction', e2e.cachedAfterEvict === 1,
            `${e2e.cachedAfterEvict} -- isCached is ignoring the persistent store`);

      check('every awaited host function returns a thenable',
            (e2e.notThenable || []).length === 0, (e2e.notThenable || []).join(', '));

      // Credential storage: the module's own login screen depends on this
      // storing what it is given and signalling "none" by rejecting.
      check('getCredentials rejects when nothing stored', e2e.emptyRejects === true);
      check('credentials round-trip through storage', e2e.credRoundTrip === true);
      check('login.hasProvider reports no federated auth', e2e.hasProvider === false,
            e2e.hasProvider);
      check('nativeAccount left undefined', e2e.nativeAccountAbsent === true,
            'defining it would advertise an OAuth route we cannot service');
      check('dns resolved via relay', /dns=127\.0\.0\.1/.test(e2e.steps.join(',')), e2e.steps);
      check('socket opened', e2e.steps.includes('onopen'), e2e.steps.join(','));
      check('server reply reached the module', e2e.received === SERVER_REPLY.toString(),
            e2e.received);
      check('onmessage receives a Uint8Array', e2e.receivedType === 'Uint8Array',
            e2e.receivedType);
      check('socket did not close early', !e2e.steps.includes('onclose'), e2e.steps.join(','));
      check('image.close called', e2e.steps.includes('close'), e2e.steps.join(','));

      // The loading screen must cover the canvas until the module says it is
      // done, then get out of the way completely.
      check('loading screen held until complete', e2e.loadingDismissed === true,
            String(e2e.loadingDismissed));
      check('loading screen dismissed on complete', e2e.loadingGone === true,
            String(e2e.loadingGone));

      // Four concurrent readers over the same two chunks: two fetches, not
      // eight. This is the single biggest performance property of the harness.
      check('concurrent reads coalesce to one fetch per chunk',
            e2e.dedupFetches === 2, `${e2e.dedupFetches} fetches for 2 chunks`);
      check('coalesced reads are counted', e2e.dedupCoalesced > 0,
            String(e2e.dedupCoalesced));
    }
  } finally {
    if (browser) await browser.close();
    fixture.close();
    server.kill();
    fs.rmSync(tmp, { recursive: true, force: true });
  }

  const failed = results.filter((r) => !r).length;
  if (failed) console.log('\n--- server/relay log ---\n' + serverLog.join(''));
  console.log(`\n${failed} failure(s)`);
  process.exit(failed ? 1 : 0);
})();
