/**
 * Decorative Classic window frame shared by the DOM Hub and Vue tool windows.
 * One bitmap and integer device-pixel edges keep the translucent joins seamless.
 * The window owner retains geometry, input, theme settings and feature state.
 */
const bodyUrl = new URL('./frame/body.png', import.meta.url).href;
const headerUrl = new URL('./frame/header.png', import.meta.url).href;

export function attachClassicFrame(panel: HTMLElement): () => void {
  const canvas = panel.ownerDocument.createElement('canvas');
  canvas.className = 'ui-frame-artwork';
  canvas.setAttribute('aria-hidden', 'true');
  panel.classList.add('ui-art-frame');
  panel.prepend(canvas);
  const body = new Image();
  const header = new Image();
  body.src = bodyUrl;
  header.src = headerUrl;
  let disposed = false;
  let observer: ResizeObserver | undefined;
  let ratioQuery: MediaQueryList | undefined;

  function draw() {
    const bounds = canvas.getBoundingClientRect();
    if (!bounds.width || !bounds.height) return;
    const ratio = window.devicePixelRatio || 1;
    const pixel = (n: number) => Math.round(n * ratio);
    canvas.width = pixel(bounds.width);
    canvas.height = pixel(bounds.height);
    const context = canvas.getContext('2d');
    if (!context) return;
    const xs = [0, 28, 96, 128] as const;
    const ys = [0, 28, 98, 128] as const;
    const offset = pixel(2);
    const dx = [offset, offset + pixel(28 * 1.7), canvas.width + offset - pixel(32 * 1.7), canvas.width + offset];
    const top = pixel(24 * 1.7);
    const dy = [top, top + pixel(28 * 1.2), canvas.height - pixel(30 * 1.2), canvas.height];
    for (let row = 0; row < 3; row++) {
      for (let col = 0; col < 3; col++) {
        const sx = xs[col]!; const sy = ys[row]!;
        const sw = xs[col + 1]! - sx; const sh = ys[row + 1]! - sy;
        const height = dy[row + 1]! - dy[row]!;
        if (row === 0 && col !== 1) {
          const join = pixel(col === 0 ? -7 : -1);
          for (let line = 0; line < height; line++) {
            const shift = Math.round(join * (1 - line / Math.max(1, height - 1)));
            const start = dx[col]! + (col === 0 ? shift : 0);
            const end = dx[col + 1]! + (col === 2 ? shift : 0);
            context.drawImage(body, sx, sy + line * sh / height, sw, sh / height,
              start, dy[row]! + line, end - start, 1);
          }
        } else {
          context.drawImage(body, sx, sy, sw, sh, dx[col]!, dy[row]!, dx[col + 1]! - dx[col]!, height);
        }
      }
    }
    // The source contains a translucent black centre. Remove it so the existing
    // opacity/custom-colour projection paints exactly once behind the content.
    context.clearRect(pixel(18), pixel(46), canvas.width - pixel(36), canvas.height - pixel(62));
    const source = [0, 20, 108, 128];
    const dest = [0, pixel(34), canvas.width - pixel(34), canvas.width];
    for (let col = 0; col < 3; col++) {
      context.drawImage(header, source[col]!, 5, source[col + 1]! - source[col]!, 27,
        dest[col]!, 0, dest[col + 1]! - dest[col]!, pixel(27 * 1.7));
    }
  }

  function watchRatio() {
    ratioQuery?.removeEventListener('change', watchRatio);
    ratioQuery = window.matchMedia(`(resolution: ${window.devicePixelRatio}dppx)`);
    ratioQuery.addEventListener('change', watchRatio);
    draw();
  }

  void Promise.all([body.decode(), header.decode()]).then(() => {
    if (disposed) return;
    observer = new ResizeObserver(draw);
    observer.observe(canvas);
    window.addEventListener('resize', draw);
    watchRatio();
  }).catch(() => {
    // A missing decorative asset leaves the existing CSS frame and all controls.
    panel.classList.remove('ui-art-frame');
    canvas.remove();
  });
  return () => {
    disposed = true;
    observer?.disconnect();
    ratioQuery?.removeEventListener('change', watchRatio);
    window.removeEventListener('resize', draw);
    panel.classList.remove('ui-art-frame');
    canvas.remove();
  };
}
