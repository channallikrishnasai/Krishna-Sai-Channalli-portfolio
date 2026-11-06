/* Freefall: scroll engine for the Krishna Sai Channalli portfolio.
   One requestAnimationFrame loop reads the scroll position and drives
   both films, the 3D type world and every section after it. */
(() => {
  'use strict';

  // ---------- helpers ----------
  const $ = (s, el = document) => el.querySelector(s);
  const $$ = (s, el = document) => Array.from(el.querySelectorAll(s));
  const clamp = (v, a = 0, b = 1) => (v < a ? a : v > b ? b : v);
  const lerp = (a, b, t) => a + (b - a) * t;
  const norm = (v, a, b) => clamp((v - a) / (b - a));
  const sstep = (a, b, v) => { const t = norm(v, a, b); return t * t * (3 - 2 * t); };
  const fract = (v) => v - Math.floor(v);
  const easeOut = (t) => 1 - Math.pow(1 - t, 3);
  const easeInOut = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
  // 0 → 1 → 0 across [a, b] with the top at `peak`
  const bell = (v, a, peak, b) => (v <= a || v >= b ? 0 : v < peak ? sstep(a, peak, v) : 1 - sstep(peak, b, v));
  const rng = (seed) => () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const f1 = (v) => v.toFixed(1);
  const f2 = (v) => v.toFixed(2);

  const html = document.documentElement;
  const fine = matchMedia('(hover: hover) and (pointer: fine)').matches;
  const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;

  const S = {
    W: innerWidth, H: innerHeight, y: 0, vel: 0,
    mx: 0, my: 0, smx: 0, smy: 0, cx: innerWidth / 2, cy: innerHeight / 2,
    t: 0, entered: false, lastP: 0,
  };

  if ('scrollRestoration' in history) history.scrollRestoration = 'manual';
  scrollTo(0, 0);

  // ---------- frame sequences ----------
  const FALL_N = 465;   // 15.5 s at 30 fps
  const PORTAL_N = 240; // 10 s at 24 fps

  class Seq {
    constructor(dir, count, options = {}) {
      this.count = count;
      this.urls = Array.from({ length: count }, (_, i) => options.fileName
        ? `${dir}/${options.fileName(i)}`
        : `${dir}/${String(i).padStart(3, '0')}.webp`);
      this.imgs = new Array(count);
      this.ok = new Uint8Array(count);
      this.state = new Uint8Array(count); // 0 idle, 1 queued/loading, 2 loaded, 3 failed
      this.everLoaded = new Uint8Array(count);
      this.loaded = 0;
      this.maxCached = options.maxCached ?? Infinity;
      this.anchorStride = Number.isFinite(this.maxCached)
        ? Math.ceil(count / Math.max(2, Math.floor(this.maxCached / 2)))
        : count;
      this.lru = [];
      this.queue = [];
      this.queued = new Map();
      this.active = 0;
      this.maxConcurrent = 2;
      this.initialSettled = new Uint8Array(count);
      this.initialDone = 0;
      this.onTick = null;
      this.resolveGate = null;
      this.started = false;
      // Coarse-to-fine order, so scrubbing works before every frame has arrived
      const seen = new Uint8Array(count);
      this.order = [];
      const push = (i) => { if (!seen[i]) { seen[i] = 1; this.order.push(i); } };
      push(0);
      for (const s of [32, 16, 8]) for (let i = 0; i < count; i += s) push(i);
      push(count - 1);
      this.gate = this.order.length;
      for (const s of [4, 2, 1]) for (let i = 0; i < count; i += s) push(i);
    }
    load(conc, onTick) {
      this.maxConcurrent = Math.max(1, conc);
      this.onTick = onTick;
      this.started = true;
      const gateP = new Promise((resolve) => { this.resolveGate = resolve; });
      this.order.forEach((i, rank) => this.enqueue(i, -rank, rank < this.gate));
      this.pump();
      return gateP;
    }
    enqueue(i, priority, initial = false) {
      if (this.ok[i] || this.state[i] === 1 || this.state[i] === 3) return;
      if (this.state[i] === 2 && !this.imgs[i]) this.state[i] = 0; // evicted from the decoded cache
      const task = { i, priority, initial };
      this.state[i] = 1;
      this.queued.set(i, task);
      this.queue.push(task);
    }
    ensure(i) {
      i = clamp(Math.round(i), 0, this.count - 1);
      if (this.ok[i]) { this.touch(i); return; }
      if (this.state[i] === 1) {
        const queued = this.queued.get(i);
        if (queued) { queued.priority = 1000; this.pump(); }
        return;
      }
      if (this.state[i] === 3) return;
      this.enqueue(i, 1000, false);
      this.pump();
    }
    pump() {
      while (this.active < this.maxConcurrent && this.queue.length) {
        this.queue.sort((a, b) => b.priority - a.priority);
        const task = this.queue.shift();
        const { i } = task;
        this.queued.delete(i);
        if (this.ok[i]) { this.settled(task); continue; }
        const img = new Image();
        img.decoding = 'async';
        img.loading = 'eager';
        img.fetchPriority = task.priority >= 1000 ? 'high' : 'low';
        this.active++;
        let finished = false;
        const fin = (ok) => {
          if (finished) return;
          finished = true;
          this.active--;
          this.state[i] = ok ? 2 : 3;
          if (ok) {
            if (!this.everLoaded[i]) { this.everLoaded[i] = 1; this.loaded++; }
            this.remember(i, img);
          }
          this.settled(task);
          this.pump();
        };
        img.onload = () => {
          // Decode only a small number of full-resolution frames at a time.
          if (img.decode) img.decode().then(() => fin(true), () => fin(true));
          else fin(true);
        };
        img.onerror = () => fin(false);
        img.src = this.urls[i];
      }
    }
    settled(task) {
      if (!task.initial || this.initialSettled[task.i]) return;
      this.initialSettled[task.i] = 1;
      this.initialDone++;
      if (this.onTick) this.onTick(Math.min(1, this.initialDone / this.gate));
      if (this.initialDone >= this.gate && this.resolveGate) {
        this.resolveGate();
        this.resolveGate = null;
      }
    }
    touch(i) {
      const at = this.lru.indexOf(i);
      if (at >= 0) this.lru.splice(at, 1);
      this.lru.push(i);
    }
    remember(i, img) {
      this.imgs[i] = img;
      this.ok[i] = 1;
      this.touch(i);
      while (this.lru.length > this.maxCached) {
        const at = this.lru.findIndex((frame) => !this.isAnchor(frame));
        if (at < 0) break;
        const [old] = this.lru.splice(at, 1);
        this.imgs[old] = null;
        this.ok[old] = 0;
      }
    }
    isAnchor(i) { return i === 0 || i === this.count - 1 || i % this.anchorStride === 0; }
    has(i) { return this.ok[i] === 1; }
    get(i) {
      i = clamp(Math.round(i), 0, this.count - 1);
      if (this.ok[i]) { this.touch(i); return this.imgs[i]; }
      this.ensure(i);
      for (let d = 1; d < this.count; d++) {
        if (i - d >= 0 && this.ok[i - d]) { this.touch(i - d); return this.imgs[i - d]; }
        if (i + d < this.count && this.ok[i + d]) { this.touch(i + d); return this.imgs[i + d]; }
      }
      return null;
    }
  }

  function drawCover(ctx, img, w, h, ax, ay) {
    const iw = img.naturalWidth, ih = img.naturalHeight;
    const s = Math.max(w / iw, h / ih);
    const dw = iw * s, dh = ih * s;
    ctx.drawImage(img, (w - dw) * ax, (h - dh) * ay, dw, dh);
  }

  // Draws a fractional frame: frame n, then frame n+1 on top at the leftover alpha
  class Film {
    constructor(canvas, seq, ax, ay, maxDpr) {
      this.c = canvas; this.ctx = canvas.getContext('2d', { alpha: false });
      this.seq = seq; this.ax = ax; this.ay = ay; this.maxDpr = maxDpr; this.key = '';
    }
    resize() {
      const r = this.c.getBoundingClientRect();
      const d = Math.min(devicePixelRatio || 1, this.maxDpr);
      this.c.width = Math.max(2, Math.round(r.width * d));
      this.c.height = Math.max(2, Math.round(r.height * d));
      this.key = '';
    }
    render(f, interpolate = true, fallback = null) {
      const { seq, ctx, c } = this;
      const i0 = interpolate ? Math.floor(f) : Math.round(f);
      const fr = interpolate ? f - i0 : 0;
      const a = seq.get(i0);
      if (!a) {
        if (!fallback || !fallback.complete || !fallback.naturalWidth) return null;
        const key = `fallback:${fallback.src}`;
        if (key !== this.key) {
          this.key = key;
          ctx.globalAlpha = 1;
          drawCover(ctx, fallback, c.width, c.height, this.ax, this.ay);
        }
        return fallback;
      }
      const i1 = Math.min(i0 + 1, seq.count - 1);
      const blend = fr > 0.03 && i1 !== i0 && seq.has(i0) && seq.has(i1);
      const key = a.src + (blend ? '|' + fr.toFixed(2) : '');
      if (key === this.key) return a;
      this.key = key;
      ctx.globalAlpha = 1;
      drawCover(ctx, a, c.width, c.height, this.ax, this.ay);
      if (blend) {
        ctx.globalAlpha = fr;
        drawCover(ctx, seq.imgs[i1], c.width, c.height, this.ax, this.ay);
        ctx.globalAlpha = 1;
      }
      return a;
    }
  }

  // Tiny blurred copy of the current frame stretched behind everything
  class Ambient {
    constructor(canvas) { this.c = canvas; this.ctx = canvas.getContext('2d'); this.img = null; }
    resize() { this.c.width = 72; this.c.height = Math.max(2, Math.round(72 * S.H / S.W)); this.img = null; }
    draw(img) {
      if (!img || img === this.img) return;
      this.img = img;
      const { ctx, c } = this;
      ctx.filter = 'blur(3px)';
      ctx.fillStyle = '#000';
      ctx.fillRect(0, 0, c.width, c.height);
      // scale the frame up so its golden core spreads to the screen edges
      const s = 1.6;
      ctx.save();
      ctx.translate(c.width / 2, c.height / 2);
      ctx.scale(s, 1.1);
      ctx.translate(-c.width / 2, -c.height / 2);
      drawCover(ctx, img, c.width, c.height, 0.5, 0.5);
      ctx.restore();
      ctx.filter = 'none';
    }
  }

  const compactMemory = matchMedia('(max-width: 760px)').matches;
  const fall = new Seq('assets/fall', FALL_N, { maxCached: compactMemory ? 8 : 16 });
  const portal = new Seq('assets/portal-scroll', PORTAL_N, {
    fileName: (i) => `frame_${String(i + 1).padStart(4, '0')}.jpg`,
    maxCached: compactMemory ? 6 : 12,
  });
  const filmFall = new Film($('#filmCanvas'), fall, 0.5, 0.5, 1.75);
  const filmPortal = new Film($('#portalCanvas'), portal, 0.5, 0.45, 1.5);
  const portalFallback = new Image();
  portalFallback.decoding = 'async';
  portalFallback.src = 'assets/portal/238.webp';
  // Start the portal in parallel with the opening film; only 2 frames decode at once.
  portal.load(2);
  const ambient = new Ambient($('#ambient'));

  // ---------- story timeline (in story progress 0..1) ----------
  const CUT = 0.47;     // hard cut from the shaft to the impact sequence, hidden in the flash
  const SHOCK = 0.585;  // fire ring leaves the figure
  const FRAME_KEYS = [[0, 0], [0.42, 205], [CUT, 217], [0.58, 270], [0.67, 312], [0.86, 464], [1, 464]];
  const frameAt = (p) => {
    for (let i = 1; i < FRAME_KEYS.length; i++) {
      const [p1, v1] = FRAME_KEYS[i];
      if (p <= p1) { const [p0, v0] = FRAME_KEYS[i - 1]; return lerp(v0, v1, (p - p0) / (p1 - p0)); }
    }
    return FALL_N - 1;
  };

  // ---------- 3D type world ----------
  const WORLD = {
    fall: {
      back: [
        ['Build', 'xl ghost'], ['trust the drop', 'serif'], ['CSE student', 'tag'], ['Let go', 'xl'],
        ['ideas in motion', 'serif molten'], ['Gravity', 'l ghost molten'], ['Software engineering', 'tag'],
        ['No net', 'xl molten'], ['curiosity first', 'serif'], ['AI & full-stack', 'tag'], ['Light', 'l ghost'],
      ],
      front: [['Fall', 'xxl ghost'], ['Deeper', 'xxl ghost']],
    },
    crowd: {
      back: [
        ['too much input', 'serif ash'], ['Noise', 'xl ghost ash'], ['find the signal', 'serif ash'],
        ['filter the noise', 'serif ash'], ['Focus', 'l ash'], ['one thing at a time', 'serif ash'], ['keep moving', 'm ash'],
        ['look closer', 'serif ash'], ['Patterns', 'l ghost ash'], ['make sense of it', 'serif ash'], ['keep learning', 'm ash'],
      ],
      front: [['Noise', 'xxl ghost']],
    },
    rise: {
      back: [
        ['Build', 'xl ghost ember'], ['learn by doing', 'serif'], ['Glow', 'xl molten'], ['keep exploring', 'serif molten'],
        ['Create', 'l ghost'], ['solve real problems', 'serif'], ['Keep going', 'l ember'],
      ],
      front: [],
    },
  };
  const LINES = [
    ['Every idea begins as a fall.', 0.035, 0.17, -0.1],
    ['No map yet. Just curiosity and a first step.', 0.13, 0.27, 0.12],
    ['You learn the shape of things by building.', 0.24, 0.38, -0.08],
    ['Then the light gets louder.', 0.34, 0.47, 0.06],
    ['And you land in the noise.', 0.485, 0.6, 0],
    ['The noise clears. Something is still glowing.', 0.62, 0.74, 0],
    ['Build what helps someone move forward.', 0.765, 0.88, 0],
  ];
  const CTAS = [
    ['See the work', 'work', 'fall', -0.3], ['Say hello', 'contact', 'fall', 0.32],
    ['See the work', 'work', 'rise', 0.3], ['Say hello', 'contact', 'rise', -0.28],
  ];

  const P = 900; // must match .world perspective
  const items = [];
  const rand = rng(11);

  function makeItem(cam, text, kind, o) {
    const el = document.createElement(o.jump ? 'a' : 'div');
    el.className = 'wi ' + kind;
    const span = document.createElement('span');
    span.textContent = text;
    el.appendChild(span);
    if (o.jump) {
      el.href = '#' + o.jump;
      el.dataset.jump = o.jump;
      el.dataset.cursor = 'Go';
    }
    cam.appendChild(el);
    items.push(Object.assign({ el, vis: false, ry: 0 }, o));
  }

  function buildWorld() {
    const back = $('.world--back .cam'), front = $('.world--front .cam'), ui = $('.world--ui .cam');
    for (const [set, def] of Object.entries(WORLD)) {
      def.back.forEach(([text, kind], i, arr) => {
        const side = i % 2 ? 1 : -1;
        const depth = rand();
        makeItem(back, text, kind, {
          set, loop: true, depth,
          xs: side * (0.16 + rand() * 0.28),
          z: -120 - depth * 1300, zIn: 260, zOut: -700,
          rate: lerp(1.15, 0.6, depth), phase: i / arr.length + rand() * 0.03,
          ry: Math.round((rand() * 22 + 6) * -side),
        });
      });
      // big outlined words that rush past the lens, mostly off the figure
      def.front.forEach(([text, kind], i, arr) => {
        makeItem(front, text, kind, {
          set, loop: true, depth: 0,
          xs: (i % 2 ? 1 : -1) * (0.12 + rand() * 0.12),
          z: 60, zIn: 320, zOut: -260,
          rate: 2.2, phase: i / arr.length + 0.17, cap: 0.75,
          ry: Math.round((rand() - 0.5) * 20),
        });
      });
    }
    LINES.forEach(([text, p0, p1, xs]) => {
      makeItem(front, text, 'line', { set: 'line', loop: false, p0, p1, xs, z: 0, zIn: 180, zOut: -420 });
    });
    CTAS.forEach(([text, jump, set, xs], i) => {
      makeItem(ui, text, 'cta', {
        set: 'ui-' + set, loop: true, jump, xs,
        z: -60, zIn: 200, zOut: -420, rate: 0.55, phase: i * 0.5 + 0.12,
        ry: xs > 0 ? -14 : 14,
      });
    });
  }

  function placeWorld(p, travel, alpha, shockT) {
    const { W, H } = S;
    const stretch = 1 + Math.min(Math.abs(S.vel), 70) * 0.004;
    const skew = clamp(S.vel * 0.05, -5, 5);
    for (const it of items) {
      let a = alpha[it.set] || 0;
      let t;
      if (it.loop) t = fract(it.phase + travel * it.rate);
      else { t = (p - it.p0) / (it.p1 - it.p0); if (t <= 0 || t >= 1) a = 0; }
      if (a > 0) a *= sstep(0, 0.1, t) * (1 - sstep(0.86, 1, t)) * (it.cap || 1) * (1 - (it.depth || 0) * 0.55);

      let z = it.z + lerp(it.zIn, it.zOut, t);
      let xs = it.xs, rz = 0;
      if (it.set === 'crowd' && shockT > 0) {
        // the fire ring blows the ambient voices out of frame
        const dir = xs >= 0 ? 1 : -1;
        const e = easeOut(shockT);
        xs += dir * (0.35 + Math.abs(xs)) * e * 1.2;
        z += e * 650;
        rz = dir * e * 38;
        a *= 1 - shockT;
      }
      if (a <= 0.004) {
        if (it.vis) { it.el.style.visibility = 'hidden'; it.vis = false; }
        continue;
      }
      if (!it.vis) { it.el.style.visibility = 'visible'; it.vis = true; }
      z = Math.min(z, P - 140);
      const k = (P - z) / P;
      const x = xs * W * k;
      const y = lerp(0.72, -0.72, t) * H * k;
      const rx = lerp(-16, 34, t);
      it.el.style.opacity = f2(a);
      it.el.style.transform =
        `translate3d(${f1(x)}px,${f1(y)}px,${f1(z)}px) rotateX(${f2(rx)}deg) rotateY(${it.ry}deg) rotateZ(${f2(rz)}deg) skewY(${f2(skew)}deg) scaleY(${stretch.toFixed(3)})`;
    }
  }

  // ---------- DOM refs ----------
  const stageInner = $('.stage-inner');
  const filmEl = $('#film');
  const vignette = $('.vignette');
  const ambientEl = $('#ambient');
  const cams = $$('.world .cam');
  const hero = $('#hero');
  const flash = $('.flash:not(.flash--ember)');
  const flashWord = $('.flash b');
  const flashEmber = $('.flash--ember');
  const shock = $('.shock');
  const riseEls = $$('.rise span');
  const riseSeeds = riseEls.map((_, i) => ({
    x: (i - 1.5) * 0.5 + (rand() - 0.5) * 0.3, y: (rand() - 0.5) * 1.2, rx: (rand() - 0.5) * 160, ry: (rand() - 0.5) * 120,
  }));
  const indexName = $('.index-name');
  const tilesEl = $('#tiles');
  const tiles = $$('.tile', tilesEl).map((el) => ({
    el, x: +el.dataset.x, y: +el.dataset.y, s: +el.dataset.s, ar: +el.dataset.ar, z: +el.dataset.z, d: +el.dataset.d, vis: false,
  }));
  const hud = $('.hud');
  const hudNum = $('.hud-num'), hudName = $('.hud-name'), hudRead = $('.hud-read'), hudBar = $('.hud-bar i');

  const screens = $$('.screen').map((el) => ({
    el, title: $('.screen-title span', el), face: $('.disc-face', el), ring: $('.disc-ring', el), vis: true,
  }));
  const portalCanvas = $('#portalCanvas');
  const tunnelCam = $('.tunnel-cam');
  const portalLines = $$('.portal-line').map((el) => {
    const [a, b] = el.dataset.w.split(',').map(Number);
    return { el, a, b };
  });
  const portalCta = $('.portal-cta');

  const layout = {};
  let baseFeather = 18;

  // ---------- arches for the portal tunnel ----------
  const arches = [];
  (() => {
    const words = ['step through', '', 'this way', '', 'come in', '', 'step through', '', 'almost there', ''];
    words.forEach((w) => {
      const el = document.createElement('div');
      el.className = 'arch';
      if (w) { const s = document.createElement('span'); s.textContent = w; el.appendChild(s); }
      tunnelCam.appendChild(el);
      arches.push({ el });
    });
  })();

  // ---------- manifesto words ----------
  const manifesto = $('#manifesto');
  const words = [];
  $$('.manifesto-copy', manifesto).forEach((paragraph) => {
    const text = paragraph.textContent.trim().split(/\s+/);
    paragraph.replaceChildren();
    text.forEach((word, index) => {
      const span = document.createElement('span');
      span.className = 'w';
      span.textContent = word;
      paragraph.appendChild(span);
      if (index < text.length - 1) paragraph.appendChild(document.createTextNode(' '));
      words.push({ el: span, o: -1 });
    });
  });

  const aboutShowcase = $('#aboutShowcase');
  const educationFeature = $('.education-feature');
  if (!reduce && 'IntersectionObserver' in window) {
    const aboutMotionObserver = new IntersectionObserver((entries) => {
      for (const entry of entries) entry.target.classList.toggle('is-active', entry.isIntersecting);
    }, { rootMargin: '120px 0px', threshold: 0 });
    if (aboutShowcase) aboutMotionObserver.observe(aboutShowcase);
    if (educationFeature) aboutMotionObserver.observe(educationFeature);
  } else if (!reduce) {
    aboutShowcase?.classList.add('is-active');
    educationFeature?.classList.add('is-active');
  }

  // ---------- marquee ----------
  const marquees = $$('.marquee-row').map((row) => {
    const track = $('.marquee-track', row);
    const clone = track.innerHTML;
    track.insertAdjacentHTML('beforeend', clone);
    $$('span', track).slice(track.children.length / 2).forEach((s) => s.setAttribute('aria-hidden', 'true'));
    return { track, dir: +row.dataset.dir, x: 0, half: 0 };
  });

  // ---------- services preview ----------
  const svcPreview = $('.svc-preview');
  const svcImg = $('img', svcPreview);
  const pv = { x: S.W / 2, y: S.H / 2, on: false, s: 0.6 };
  $$('.svc').forEach((li) => {
    li.addEventListener('mouseenter', () => { svcImg.src = li.dataset.img; pv.on = true; svcPreview.classList.add('is-on'); Sound.tick(); });
  });
  $('.svc-list').addEventListener('mouseleave', () => { pv.on = false; svcPreview.classList.remove('is-on'); });

  // The archive stays inside the existing render architecture: IntersectionObserver
  // gates its canvas work and the main RAF loop advances the atmosphere only in view.
  const experienceArchive = $('#experienceArchive');
  const archiveCanvas = $('#experienceAtmosphere');
  const archiveCtx = archiveCanvas?.getContext('2d', { alpha: true });
  const archiveFX = { visible: false, time: 0, width: 0, height: 0, dpr: 1, particles: [] };
  function resizeArchiveFX() {
    if (!archiveCanvas || !archiveCtx || !experienceArchive) return;
    if (!archiveFX.visible) return;
    const rect = experienceArchive.getBoundingClientRect();
    const dpr = Math.min(devicePixelRatio || 1, innerWidth < 761 ? 1 : 1.25);
    archiveFX.width = Math.max(1, rect.width);
    archiveFX.height = Math.max(1, rect.height);
    archiveFX.dpr = dpr;
    archiveCanvas.width = Math.round(archiveFX.width * dpr);
    archiveCanvas.height = Math.round(archiveFX.height * dpr);
    archiveCtx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const random = rng(945434);
    const count = innerWidth < 761 ? 22 : 46;
    archiveFX.particles = Array.from({ length: count }, () => ({
      x: random() * archiveFX.width, y: random() * archiveFX.height,
      radius: 0.45 + random() * 1.4, speed: 3 + random() * 13,
      drift: (random() - 0.5) * 9, phase: random() * Math.PI * 2,
      hue: random() > 0.22 ? 28 : 244,
    }));
    drawArchiveFX(0, true);
  }
  function drawArchiveFX(dt, still = false) {
    if (!archiveCtx || !archiveFX.width) return;
    const ctx = archiveCtx, w = archiveFX.width, h = archiveFX.height;
    ctx.clearRect(0, 0, w, h);
    const cx = w * 0.5, cy = h * 0.235;
    const core = ctx.createRadialGradient(cx, cy, 2, cx, cy, Math.min(w * 0.34, 390));
    core.addColorStop(0, 'rgba(255,201,137,.13)');
    core.addColorStop(.18, 'rgba(255,111,42,.08)');
    core.addColorStop(1, 'rgba(255,91,26,0)');
    ctx.fillStyle = core;
    ctx.fillRect(0, 0, w, h * .64);
    if (!still && !reduce) archiveFX.time += Math.min(dt, 50) / 1000;
    const t = archiveFX.time;
    ctx.globalCompositeOperation = 'lighter';
    for (const p of archiveFX.particles) {
      if (!still && !reduce) {
        p.y -= p.speed * Math.min(dt, 50) / 1000;
        p.x += Math.sin(t * .42 + p.phase) * p.drift * Math.min(dt, 50) / 1000;
        if (p.y < -4) { p.y = h + 4; p.x = fract(p.x / w) * w; }
        if (p.x < -4) p.x = w + 4;
        if (p.x > w + 4) p.x = -4;
      }
      const shimmer = reduce || still ? .62 : .35 + (Math.sin(t * 1.8 + p.phase) + 1) * .25;
      ctx.globalAlpha = shimmer;
      ctx.fillStyle = p.hue === 28 ? 'rgba(255,177,103,.9)' : 'rgba(169,163,255,.8)';
      ctx.beginPath(); ctx.arc(p.x, p.y, p.radius, 0, Math.PI * 2); ctx.fill();
    }
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';
  }

  // One observer reveals/pause-gates the archive and reveals technology groups.
  if (!reduce && 'IntersectionObserver' in window) {
    const revealObserver = new IntersectionObserver((entries) => {
      entries.forEach((entry) => {
        if (entry.target === experienceArchive) {
          archiveFX.visible = entry.isIntersecting;
          entry.target.classList.toggle('is-visible', entry.isIntersecting);
          if (entry.isIntersecting) {
            if (!archiveFX.width) resizeArchiveFX();
            else drawArchiveFX(0);
          } else if (archiveCanvas) {
            archiveCanvas.width = 0;
            archiveCanvas.height = 0;
            archiveFX.width = archiveFX.height = 0;
            archiveFX.particles = [];
          }
          return;
        }
        if (!entry.isIntersecting) return;
        entry.target.classList.add('is-visible');
        revealObserver.unobserve(entry.target);
      });
    }, { threshold: 0.14, rootMargin: '0px 0px -6% 0px' });
    [experienceArchive, ...$$('.svc')].filter(Boolean).forEach((el) => {
      el.classList.add('is-cinematic');
      revealObserver.observe(el);
    });
  }

  if (experienceArchive) {
    resizeArchiveFX();
    if (reduce) experienceArchive.classList.add('is-visible');
    if (fine && !reduce) {
      experienceArchive.addEventListener('pointermove', (event) => {
        const bounds = experienceArchive.getBoundingClientRect();
        const x = (event.clientX - bounds.left) / bounds.width;
        const y = (event.clientY - bounds.top) / bounds.height;
        experienceArchive.style.setProperty('--archive-x', `${(x * 100).toFixed(1)}%`);
        experienceArchive.style.setProperty('--archive-y', `${(y * 100).toFixed(1)}%`);
        $$('.experience-card', experienceArchive).forEach((card) => {
          const r = card.getBoundingClientRect();
          const px = clamp((event.clientX - (r.left + r.width / 2)) / (r.width / 2), -1, 1);
          const py = clamp((event.clientY - (r.top + r.height / 2)) / (r.height / 2), -1, 1);
          card.style.setProperty('--tilt-x', `${(-py * 2.2).toFixed(2)}deg`);
          card.style.setProperty('--tilt-y', `${(px * 2.8).toFixed(2)}deg`);
        });
      }, { passive: true });
      experienceArchive.addEventListener('pointerleave', () => {
        experienceArchive.style.setProperty('--archive-x', '50%');
        experienceArchive.style.setProperty('--archive-y', '45%');
        $$('.experience-card', experienceArchive).forEach((card) => {
          card.style.setProperty('--tilt-x', '0deg');
          card.style.setProperty('--tilt-y', '0deg');
        });
      }, { passive: true });
    }
    $$('[data-experience-target]', experienceArchive).forEach((button) => {
      button.addEventListener('click', () => {
        const target = document.getElementById(button.dataset.experienceTarget);
        if (!target) return;
        if (lenis) lenis.scrollTo(target, { offset: -innerHeight * .35, duration: .9, force: true });
        else target.scrollIntoView({ behavior: reduce ? 'auto' : 'smooth', block: 'center' });
        target.focus({ preventScroll: true });
        Sound.tick();
      });
    });
  }

  // ---------- measure ----------
  function measure() {
    S.W = innerWidth; S.H = innerHeight;
    for (const id of ['story', 'work', 'about', 'achievements', 'services', 'portal', 'contact']) {
      const el = document.getElementById(id);
      const r = el.getBoundingClientRect();
      layout[id] = { top: r.top + scrollY, h: r.height };
    }
    filmFall.resize(); filmPortal.resize(); ambient.resize(); resizeArchiveFX();
    baseFeather = S.W / S.H < 0.8 ? 0 : 22;

    const base = Math.min(S.H, S.W * 1.25);
    tiles.forEach((tl) => {
      const w = tl.s * base;
      tl.el.style.width = f1(w) + 'px';
      tl.el.style.height = f1(w / tl.ar) + 'px';
    });

    // the fire ring sits at the figure's landing point (43% down the frame)
    const fw = Math.min(S.W, S.H * 0.72), fh = S.H;
    const sc = Math.max(fw / 720, fh / 1280);
    const dh = 1280 * sc;
    shock.style.top = f1((fh - dh) / 2 + 0.43 * dh) + 'px';

    // the portal's centre in the walk-out shot
    const ps = Math.max(S.W / 1600, S.H / 900);
    const pdh = 900 * ps;
    tunnelCam.style.top = f1((S.H - pdh) * 0.45 + 0.44 * pdh) + 'px';

    marquees.forEach((m) => { m.half = m.track.scrollWidth / 2; });
  }

  // ---------- story update ----------
  function updateStory() {
    const L = layout.story;
    if (S.y > L.top + L.h) return;
    const p = clamp((S.y - L.top) / (L.h - S.H));
    const { W, H } = S;

    // film + ambient
    const img = filmFall.render(frameAt(p));
    if (img) ambient.draw(img);

    // camera follows the pointer
    const camT = `rotateX(${f2(-S.smy * 7)}deg) rotateY(${f2(S.smx * 10)}deg)`;
    for (const c of cams) c.style.transform = camT;

    // the type world
    const travel = (S.y - L.top) / H * 0.2 + S.t * 0.004;
    const shockT = norm(p, SHOCK, 0.64);
    const alpha = {
      fall: sstep(0.02, 0.06, p) * (1 - sstep(CUT - 0.03, CUT, p)),
      crowd: sstep(CUT, CUT + 0.03, p),
      rise: sstep(0.655, 0.7, p) * (1 - sstep(0.84, 0.875, p)),
      line: 1,
      'ui-fall': sstep(0.04, 0.07, p) * (1 - sstep(0.42, 0.45, p)),
      'ui-rise': sstep(0.68, 0.71, p) * (1 - sstep(0.84, 0.87, p)),
    };
    placeWorld(p, travel, alpha, shockT);

    // hero tips backwards into the shaft
    const he = sstep(0, 0.05, p);
    hero.style.transform = `perspective(900px) translate3d(0,${f1(-he * 26)}vh,${f1(-he * 700)}px) rotateX(${f1(he * 48)}deg)`;
    hero.style.opacity = f2(1 - sstep(0.012, 0.05, p));
    hero.style.visibility = p > 0.06 ? 'hidden' : 'visible';

    // impact flash at the cut
    const fl = bell(p, 0.435, CUT, 0.51);
    flash.style.opacity = f2(fl);
    if (fl > 0) {
      flashWord.style.opacity = f2(bell(p, 0.452, CUT, 0.492));
      flashWord.style.transform = `scale(${f2(lerp(0.72, 1.28, norm(p, 0.44, 0.51)))})`;
      stageInner.style.transform = fl > 0.2 && !reduce
        ? `translate(${f1((Math.random() - 0.5) * 18 * fl)}px,${f1((Math.random() - 0.5) * 18 * fl)}px)` : '';
    } else if (stageInner.style.transform) stageInner.style.transform = '';

    // fire ring shockwave
    flashEmber.style.opacity = f2(bell(p, SHOCK - 0.004, SHOCK + 0.01, 0.625) * 0.42);
    if (shockT > 0 && shockT < 1) {
      const e = easeOut(shockT);
      shock.style.opacity = f2((1 - shockT) * sstep(0, 0.06, shockT));
      shock.style.transform = `scale(${f2(lerp(0.12, 7.5, e))}, ${f2(lerp(0.12, 7.5, e) * 0.5)})`;
    } else shock.style.opacity = '0';

    // R I S E assembles out of the depth, then tips back and away
    const rq = norm(p, 0.685, 0.8), ex = sstep(0.815, 0.865, p);
    riseEls.forEach((el, i) => {
      const lt = easeOut(norm(rq, i * 0.1, i * 0.1 + 0.6));
      if (lt <= 0 || ex >= 1) { el.style.opacity = '0'; return; }
      const r = riseSeeds[i];
      const tx = lerp(r.x * W, 0, lt), ty = lerp(r.y * H, 0, lt) - ex * H * 0.5;
      const tz = lerp(-2600, 0, lt) - ex * 1600;
      el.style.transform = `translate3d(${f1(tx)}px,${f1(ty)}px,${f1(tz)}px) rotateX(${f1(lerp(r.rx, 0, lt) + ex * 55)}deg) rotateY(${f1(lerp(r.ry, 0, lt))}deg)`;
      el.style.opacity = f2(lt * (1 - ex));
    });

    // index: the film shrinks into one tile among the work
    const iq = easeInOut(norm(p, 0.86, 0.97));
    const drift = norm(p, 0.975, 1);
    filmEl.style.transform = `translateX(-50%) translate3d(${f1(S.smx * -14 * iq)}px,${f1(-drift * H * 0.08)}px,0) scale(${(lerp(1, 0.36, iq)).toFixed(4)})`;
    filmEl.style.setProperty('--f', f1(lerp(baseFeather, 0, iq)) + '%');
    vignette.style.opacity = f2(1 - iq * 0.7);
    ambientEl.style.opacity = f2(0.5 * (1 - iq * 0.75));

    const q = norm(p, 0.865, 0.975);
    indexName.style.opacity = f2(q * 0.9);
    if (q > 0) indexName.style.transform = `translate(-50%,-50%) translate3d(${f1(S.smx * -26)}px,${f1(S.smy * -14 - drift * H * 0.1)}px,0) scale(${f2(lerp(1.35, 1, easeOut(q)))})`;
    tilesEl.classList.toggle('is-live', q > 0.7);
    const TP = 1200;
    for (const tl of tiles) {
      const tq = easeOut(norm(q, tl.d, tl.d + 0.55));
      if (tq <= 0) { if (tl.vis) { tl.el.style.opacity = '0'; tl.vis = false; } continue; }
      tl.vis = true;
      const z = lerp(-3200, tl.z, tq) + drift * 500 * (1 + tl.d);
      const k = (TP - z) / TP;
      const x = tl.x * W * k + S.smx * (30 + tl.d * 90);
      const y = (tl.y * H - drift * H * (0.12 + tl.d * 0.2)) * k + S.smy * (20 + tl.d * 60);
      tl.el.style.opacity = f2(tq);
      tl.el.style.transform = `translate(-50%,-50%) translate3d(${f1(x)}px,${f1(y)}px,${f1(z)}px) rotateY(${f2(S.smx * -9)}deg) rotateX(${f2(S.smy * 7)}deg)`;
    }

    // one-shot hits when crossing the cut and the shockwave going down
    if (S.lastP < CUT && p >= CUT && p - S.lastP < 0.05) impact(1);
    if (S.lastP < SHOCK && p >= SHOCK && p - S.lastP < 0.05) impact(0.7);
    S.lastP = p;
    S.storyP = p;
  }

  function impact(power) {
    if (!reduce) {
      stageInner.classList.remove('is-shake');
      void stageInner.offsetWidth;
      stageInner.classList.add('is-shake');
    }
    hud.classList.remove('is-pulse');
    void hud.offsetWidth;
    hud.classList.add('is-pulse');
    Sound.boom(power);
  }

  // ---------- work: stacked screens that slide in and recede backwards ----------
  function updateWork() {
    const L = layout.work;
    if (S.y + S.H < L.top || S.y > L.top + L.h) return;
    const w = clamp((S.y - L.top) / (L.h - S.H));
    const n = screens.length;
    const k = norm(w, 0, 0.88) * (n - 1);
    S.workCase = Math.round(k);
    screens.forEach((sc, i) => {
      const d = k - i;
      if (d < -1 || d > 2.4) {
        if (sc.vis) { sc.el.style.visibility = 'hidden'; sc.vis = false; }
        return;
      }
      if (!sc.vis) { sc.el.style.visibility = 'visible'; sc.vis = true; }
      let ty = 0, tz = 0, rx = 0, rz = 0, dim = 0;
      const side = i % 2 ? 1 : -1;
      if (d < 0) {
        const e = easeOut(d + 1);
        ty = (1 - e) * 115; rx = (1 - e) * 24; rz = (1 - e) * 7 * side;
      } else {
        const r = d;
        tz = -r * 420; ty = -r * 6; rz = -r * 2.6 * side; rx = r * 5;
        dim = Math.min(r, 1.4) * 0.6;
      }
      sc.el.style.transform = `translate3d(0,${f2(ty)}%,${f1(tz)}px) rotateX(${f2(rx)}deg) rotateZ(${f2(rz)}deg)`;
      sc.el.style.setProperty('--dim', f2(dim));
      const local = clamp((d + 1) / 2.4);
      sc.title.style.transform = `translate3d(${f2(lerp(4, -42, local))}%,0,0) skewX(${f2(clamp(-S.vel * 0.12, -12, 12))}deg)`;
      sc.face.style.transform = `rotate(${f1(S.y * 0.09 + i * 50)}deg)`;
      sc.ring.style.transform = `rotate(${f1(-S.y * 0.05)}deg)`;
    });
  }

  // ---------- about ----------
  function updateAbout() {
    const L = layout.about;
    if (S.y + S.H < L.top || S.y > L.top + L.h) return;
    const m = norm(S.y, L.top - S.H * 0.7, L.top + L.h * 0.5 - S.H * 0.35);
    const N = words.length;
    const head = m * (N + 5);
    for (let i = 0; i < N; i++) {
      const o = Math.round(lerp(0.76, 1, clamp((head - i) / 5)) * 50) / 50;
      if (o !== words[i].o) { words[i].o = o; words[i].el.style.opacity = o; }
    }
  }

  // ---------- marquee: speeds up and flips with your scroll ----------
  let marqueeDir = 1;
  function updateMarquee(dt) {
    if (Math.abs(S.vel) > 0.5) marqueeDir = S.vel > 0 ? 1 : -1;
    const speed = (reduce ? 0 : 0.7) + Math.min(Math.abs(S.vel), 80) * 0.35;
    for (const m of marquees) {
      if (!m.half) continue;
      m.x += speed * m.dir * marqueeDir * (dt / 16.67);
      if (m.x <= -m.half) m.x += m.half;
      if (m.x > 0) m.x -= m.half;
      m.track.style.transform = `translate3d(${f1(m.x)}px,0,0)`;
    }
  }

  // ---------- services hover preview ----------
  function updateServices() {
    if (!fine) return;
    const L = layout.services;
    if (S.y + S.H < L.top || S.y > L.top + L.h) return;
    const px = pv.x;
    pv.x = lerp(pv.x, S.cx, 0.14);
    pv.y = lerp(pv.y, S.cy, 0.14);
    pv.s = lerp(pv.s, pv.on ? 1 : 0.6, 0.12);
    const rot = clamp((pv.x - px) * 0.6, -14, 14);
    const w = svcPreview.offsetWidth, h = svcPreview.offsetHeight;
    svcPreview.style.transform = `translate3d(${f1(pv.x - w / 2)}px,${f1(pv.y - h / 2)}px,0) rotate(${f2(rot)}deg) scale(${f2(pv.s)})`;
  }

  // ---------- portal: he walks out, the tunnel flies past you ----------
  function updatePortal() {
    const L = layout.portal;
    if (S.y + S.H < L.top || S.y > L.top + L.h) { S.portalOpen = 0; return; }
    const w = clamp((S.y - L.top) / (L.h - S.H));
    const frameProgress = reduce ? 1 : norm(w, 0.02, 0.76);
    filmPortal.render(frameProgress * (PORTAL_N - 1), false, portalFallback);

    const push = sstep(0.76, 1, w);
    portalCanvas.style.transform = `scale(${(1 + push * 0.32).toFixed(4)}) translate3d(${f1(S.smx * -10)}px,${f1(S.smy * -8)}px,0)`;

    // the tunnel shows while the door opens, steps aside while he walks out,
    // then returns and speeds up as you push through the door yourself
    const open = Math.max(sstep(0.1, 0.24, w) * (1 - sstep(0.4, 0.52, w)), sstep(0.78, 0.9, w));
    S.portalOpen = Math.max(open, sstep(0.1, 0.3, w) * (1 - sstep(0.9, 1, w)));
    const rush = w * 2.4 + push * 3 + (reduce ? 0 : S.t * 0.012);
    for (let i = 0; i < arches.length; i++) {
      const a = arches[i];
      const z = -3600 + fract(i / arches.length + rush + S.t * 0.012) * 4300;
      const o = open * sstep(-3600, -2300, z) * (1 - sstep(220, 680, z));
      a.el.style.opacity = f2(o);
      if (o > 0) a.el.style.transform = `translate3d(${f1(S.smx * -40)}px,${f1(S.smy * -26)}px,${f1(z)}px)`;
    }

    for (const l of portalLines) {
      const t = norm(w, l.a, l.b);
      const o = sstep(0, 0.25, t) * (1 - sstep(0.75, 1, t));
      l.el.style.opacity = f2(o);
      l.el.style.transform = `translate3d(-50%,${f1(lerp(50, -50, t))}px,0)`;
    }

    const c = sstep(0.8, 0.9, w);
    portalCta.style.opacity = f2(c);
    portalCta.style.transform = `translateY(${f1((1 - c) * 50)}px)`;
    portalCta.classList.toggle('is-live', c > 0.5);
  }

  // ---------- HUD ----------
  const CHAPTERS = ['The leap', 'Impact', 'The noise', 'Rise', 'Index', 'Selected work', 'About', 'Achievements', 'Skills', 'The portal', 'Contact'];
  const NAV_CHAPTER_KEYS = ['story:0', 'story:0', 'story:.53', 'story:.77', 'work', 'work', 'about', 'achievements', 'services', 'portal', 'contact'];
  const navLinks = $$('.menu-list a[data-nav-key]');
  let activeNavKey = '';
  function setActiveNav(chapter) {
    const key = NAV_CHAPTER_KEYS[chapter];
    if (!key || key === activeNavKey) return;
    activeNavKey = key;
    navLinks.forEach((link) => {
      const active = link.dataset.navKey === key;
      link.classList.toggle('is-active', active);
      if (active) link.setAttribute('aria-current', 'location');
      else link.removeAttribute('aria-current');
    });
  }
  const hudState = { ch: -1, read: '', bar: -1 };
  function updateHud() {
    const L = layout.story;
    const mid = S.y + S.H * 0.5;
    const p = clamp((S.y - L.top) / (L.h - S.H));
    let ch;
    if (mid < L.top + L.h) ch = p < 0.44 ? 0 : p < 0.5 ? 1 : p < 0.66 ? 2 : p < 0.86 ? 3 : 4;
    else if (mid < layout.about.top) ch = 5;
    else if (mid < layout.achievements.top) ch = 6;
    else if (mid < layout.services.top) ch = 7;
    else if (mid < layout.portal.top) ch = 8;
    else if (mid < layout.contact.top) ch = 9;
    else ch = 10;

    if (ch !== hudState.ch) {
      hudState.ch = ch;
      hudNum.textContent = String(ch + 1).padStart(2, '0');
      hudName.textContent = CHAPTERS[ch];
    }
    setActiveNav(ch);
    const total = document.documentElement.scrollHeight - S.H;
    const pct = clamp(S.y / total);
    let read;
    if (ch <= 1) read = 'In motion';
    else if (ch <= 3) read = 'Ground level';
    else if (ch === 4) read = 'Index of work';
    else if (ch === 5) read = `Project ${(S.workCase || 0) + 1} of ${screens.length}`;
    else read = `${Math.round(pct * 100)}% down`;
    if (read !== hudState.read) { hudState.read = read; hudRead.textContent = read; }
    const b = Math.round(pct * 1000);
    if (b !== hudState.bar) { hudState.bar = b; hudBar.style.transform = `scaleX(${b / 1000})`; }
  }

  // ---------- cursor ----------
  const cursor = $('.cursor');
  const cDot = $('.cursor-dot'), cRing = $('.cursor-ring'), cLabel = $('.cursor-ring span');
  const ring = { x: S.cx, y: S.cy };
  let cursorTarget = null;
  addEventListener('pointermove', (e) => {
    if (fine && S.entered) html.classList.add('has-cursor');
    S.cx = e.clientX; S.cy = e.clientY;
    S.mx = (e.clientX / S.W) * 2 - 1;
    S.my = (e.clientY / S.H) * 2 - 1;
  }, { passive: true });
  document.addEventListener('pointerover', (e) => {
    const t = e.target.closest && e.target.closest('[data-cursor], [data-detail]');
    if (t === cursorTarget) return;
    cursorTarget = t;
    if (t) { cLabel.textContent = t.dataset.cursor || 'Open'; cursor.classList.add('is-label'); Sound.tick(); }
    else cursor.classList.remove('is-label');
  });
  addEventListener('pointerleave', () => {
    if (!fine) return;
    html.classList.remove('has-cursor');
    cursor.classList.remove('is-label', 'is-down');
    cursorTarget = null;
  });
  addEventListener('pointerdown', () => cursor.classList.add('is-down'));
  addEventListener('pointerup', () => cursor.classList.remove('is-down'));
  function updateCursor() {
    if (!fine) return;
    ring.x = lerp(ring.x, S.cx, 0.2);
    ring.y = lerp(ring.y, S.cy, 0.2);
    cDot.style.transform = `translate3d(${f1(S.cx)}px,${f1(S.cy)}px,0)`;
    cRing.style.transform = `translate3d(${f1(ring.x)}px,${f1(ring.y)}px,0)`;
  }

  // ---------- magnetic buttons ----------
  if (fine) {
    $$('.magnet').forEach((el) => {
      el.addEventListener('pointermove', (e) => {
        const r = el.getBoundingClientRect();
        const x = e.clientX - (r.left + r.width / 2), y = e.clientY - (r.top + r.height / 2);
        el.classList.add('is-pull');
        el.style.transform = `translate(${f1(x * 0.22)}px,${f1(y * 0.34)}px)`;
      });
      el.addEventListener('pointerleave', () => { el.classList.remove('is-pull'); el.style.transform = ''; });
    });
  }

  // ---------- sound: synthesised, so it can follow your scroll ----------
  const Sound = {
    ctx: null, on: false,
    init() {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return false;
      const c = (this.ctx = new AC());
      this.master = c.createGain();
      this.master.gain.value = 0;
      this.master.connect(c.destination);

      const len = c.sampleRate * 2;
      const buf = c.createBuffer(1, len, c.sampleRate);
      const d = buf.getChannelData(0);
      for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
      this.noise = buf;

      const src = c.createBufferSource();
      src.buffer = buf; src.loop = true;
      this.windF = c.createBiquadFilter();
      this.windF.type = 'bandpass'; this.windF.frequency.value = 400; this.windF.Q.value = 0.8;
      this.windG = c.createGain(); this.windG.gain.value = 0;
      src.connect(this.windF).connect(this.windG).connect(this.master);
      src.start();

      this.droneLP = c.createBiquadFilter();
      this.droneLP.type = 'lowpass'; this.droneLP.frequency.value = 300;
      this.droneG = c.createGain(); this.droneG.gain.value = 0;
      [55, 55.6, 82.4, 110.3].forEach((f) => {
        const o = c.createOscillator();
        o.type = 'sawtooth'; o.frequency.value = f;
        o.connect(this.droneLP); o.start();
      });
      this.droneLP.connect(this.droneG).connect(this.master);
      return true;
    },
    set(on) {
      if (on && !this.ctx && !this.init()) return;
      this.on = on;
      if (this.ctx) {
        if (on) this.ctx.resume();
        this.master.gain.setTargetAtTime(on ? 0.8 : 0, this.ctx.currentTime, 0.25);
      }
      const btn = $('#soundBtn');
      btn.setAttribute('aria-pressed', String(on));
      $('span', btn).textContent = on ? 'Sound on' : 'Sound off';
      html.classList.toggle('sound-on', on);
    },
    update() {
      if (!this.on) return;
      const t = this.ctx.currentTime;
      const v = Math.min(Math.abs(S.vel), 80) / 80;
      const st = layout.story;
      const inStory = S.y < st.top + st.h;
      const p = S.storyP || 0;
      let wind = 0.02 + v * 0.35, freq = 260 + v * 900;
      if (inStory && p < CUT) { wind = 0.06 + v * 0.6; freq = 380 + v * 1500 + p * 600; }
      else if (inStory && p < 0.86) { wind = 0.04 + v * 0.3; freq = 180 + v * 400; }
      this.windG.gain.setTargetAtTime(wind, t, 0.08);
      this.windF.frequency.setTargetAtTime(freq, t, 0.12);
      const open = S.portalOpen || 0;
      this.droneG.gain.setTargetAtTime(open * 0.09, t, 0.4);
      this.droneLP.frequency.setTargetAtTime(220 + open * 900, t, 0.4);
    },
    boom(power) {
      if (!this.on) return;
      const c = this.ctx, t = c.currentTime;
      const o = c.createOscillator();
      o.type = 'sine';
      o.frequency.setValueAtTime(150, t);
      o.frequency.exponentialRampToValueAtTime(30, t + 1.2);
      const g = c.createGain();
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(0.9 * power, t + 0.02);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 1.7);
      o.connect(g).connect(this.master);
      o.start(t); o.stop(t + 1.8);
      const n = c.createBufferSource();
      n.buffer = this.noise;
      const f = c.createBiquadFilter();
      f.type = 'lowpass';
      f.frequency.setValueAtTime(4000, t);
      f.frequency.exponentialRampToValueAtTime(120, t + 1);
      const ng = c.createGain();
      ng.gain.setValueAtTime(0.5 * power, t);
      ng.gain.exponentialRampToValueAtTime(0.0001, t + 1.1);
      n.connect(f).connect(ng).connect(this.master);
      n.start(t); n.stop(t + 1.2);
    },
    tick() {
      if (!this.on) return;
      const c = this.ctx, t = c.currentTime;
      const o = c.createOscillator();
      o.type = 'triangle';
      o.frequency.setValueAtTime(1800, t);
      o.frequency.exponentialRampToValueAtTime(900, t + 0.05);
      const g = c.createGain();
      g.gain.setValueAtTime(0.05, t);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 0.07);
      o.connect(g).connect(this.master);
      o.start(t); o.stop(t + 0.08);
    },
  };
  $('#soundBtn').addEventListener('click', () => Sound.set(!Sound.on));

  // ---------- smooth scroll ----------
  const lenis = !reduce && typeof window.Lenis === 'function'
    ? new window.Lenis({
      duration: 1.3,
      easing: (t) => Math.min(1, 1.001 - Math.pow(2, -10 * t)),
      smoothWheel: !reduce,
      wheelMultiplier: 0.85,
      touchMultiplier: 1.4,
    })
    : null;
  if (lenis) lenis.stop();
  // handy from the console: freefall.jump('work'), freefall.step() renders one frame
  window.freefall = { lenis, jump: (key) => jump(key), step: () => step(performance.now()) };

  // ---------- navigation ----------
  const menu = $('#menu');
  const menuBtn = $('#menuBtn');
  const menuImg = $('.menu-preview img');
  function setMenu(open) {
    html.classList.toggle('menu-open', open);
    menuBtn.setAttribute('aria-expanded', String(open));
    menu.setAttribute('aria-hidden', String(!open));
    menu.inert = !open;
    menuBtn.textContent = open ? 'Close' : 'Menu';
    if (lenis && S.entered) open ? lenis.stop() : lenis.start();
    if (open) requestAnimationFrame(() => $('.menu-list a')?.focus());
    else if (menu.contains(document.activeElement)) menuBtn.focus();
  }
  menuBtn.addEventListener('click', () => setMenu(!html.classList.contains('menu-open')));
  addEventListener('keydown', (e) => { if (e.key === 'Escape' && html.classList.contains('menu-open')) setMenu(false); });
  $$('.menu-list a').forEach((a) => a.addEventListener('pointerenter', () => { menuImg.src = a.dataset.img; }));

  function targetY(key) {
    if (key === 'top') return 0;
    if (key.startsWith('story:')) {
      const L = layout.story;
      return L.top + parseFloat(key.slice(6)) * (L.h - S.H);
    }
    if (key.startsWith('case:')) {
      const L = layout.work;
      const i = +key.slice(5);
      return L.top + (i / (screens.length - 1)) * 0.88 * (L.h - S.H);
    }
    if (key === 'contact') return document.documentElement.scrollHeight - S.H;
    return layout[key] ? layout[key].top : 0;
  }
  function jump(key) {
    if (!S.entered) return;
    const y = targetY(key);
    const dist = Math.abs(y - scrollY);
    if (lenis) lenis.scrollTo(y, { duration: clamp((dist / S.H) * 0.22, 1.2, 5), easing: easeInOut, force: true });
    else scrollTo({ top: y, behavior: reduce ? 'auto' : 'smooth' });
  }

  // ---------- project, experience, achievement and skill details ----------
  const detailDialog = $('#detailDialog');
  const detailClose = $('#detailClose');
  const detailEyebrow = $('#detailEyebrow');
  const detailTitle = $('#detailTitle');
  const detailSummary = $('#detailSummary');
  const detailSections = $('#detailSections');
  const detailPreviews = $('#detailPreviews');
  const detailLinks = $('#detailLinks');
  const detailVisual = $('#detailVisual');
  let detailReturnFocus = null;

  const DETAIL_DATA = {
    project: {
      opero: {
        eyebrow: 'AI work-operator workflow', title: 'OPERO', accent: '#ffb23f',
        summary: 'A workflow for turning natural-language intent into investigated, verified actions. The public OPERO repository documents a Phase 0 full-stack foundation.',
        sections: [
          ['Problem', 'Make natural-language work requests actionable through a governed workflow.'],
          ['Solution', 'A web foundation with an operations dashboard and database-backed values. The documented workflow is Speak → Understand → Investigate → Decide → Act → Verify → Report.'],
          ['Technology', 'Next.js 16, React 19, TypeScript, Tailwind CSS, Next.js API routes, Node.js, PostgreSQL and Prisma.'],
          ['Key features', 'Dashboard, API routes and a Prisma-backed data foundation are documented in the repository.'],
          ['Implementation details', 'The repository describes Phase 0 as complete and explicitly says voice integration is not implemented yet. A related desktop operator is documented in The-Opero.'],
        ],
        links: [
          ['OPERO workflow foundation', 'https://github.com/channallikrishnasai/OPERO'],
          ['Related desktop voice operator', 'https://github.com/channallikrishnasai/The-Opero'],
        ],
      },
      proofline: {
        eyebrow: 'Open-source digital forensics · AI agent activity', title: 'Proofline', accent: '#9abaff',
        summary: 'Proofline is an open-source digital forensics and incident-response project for investigating activity from AI coding agents. It collects, preserves and analyzes evidence so responders can distinguish an agent’s narrative from actions supported by records.',
        sections: [
          ['Problem', 'AI agents can run commands, edit files and use tools or MCP servers, while the evidence is scattered across transcripts, configuration and endpoint logs. A model saying an action happened does not prove that it did.'],
          ['Solution', 'A Go command-line tool collects agent artifacts into a sealed case package and analyzes them in a local browser-based case explorer. Independent endpoint, cloud and gateway logs can be added as corroborating witnesses.'],
          ['Technology', 'Go 1.22 or newer · zero runtime dependencies · CLI · local browser-based case explorer · hash-chained evidence packages.'],
          ['Key features', 'The README documents agent discovery and collection, case analysis, incident hunting, repository scanning, payload decoding, transcript tamper monitoring, mitigation previews and human-readable or structured reports. Evidence is labeled from ASKED or CLAIMED through RECORDED and corroborated states; insufficient evidence remains UNKNOWN.'],
          ['Implementation details', 'The `agentdfir` CLI creates and analyzes `.adfir` evidence packages. The project supports local artifact collection and imports from endpoint or forensic sources, with a browser explorer and exports for formats including PDF, HTML, OCSF, SARIF and Timesketch.'],
          ['Project lineage', 'The repository README describes Proofline as derived from AgentDFIR; attribution and license notices are retained in the repository.'],
        ], previews: [['Proofline repository · case explorer', 'assets/projects/proofline-hero-app.webp', 'Screenshot from the Proofline repository showing its local case explorer interface.']], links: [['Proofline source repository', 'https://github.com/channallikrishnasai/proofline']],
      },
      vaultiq: {
        eyebrow: 'AI-assisted personal finance', title: 'VaultIQ AI', accent: '#efe7da',
        summary: 'A personal-finance application that brings budgeting, goals, investment planning, documents and scenario workflows together.',
        sections: [
          ['Problem', 'Keep personal-finance information and planning workflows together in one application.'],
          ['Solution', 'An AI-assisted finance platform with dashboard modules for budgeting, expenses, goals, investments, documents and scenarios.'],
          ['Technology', 'Next.js 16, React 19, TypeScript, Tailwind CSS 4, Prisma 7, SQLite and Supabase PostgreSQL.'],
          ['Key features', 'The repository documents expense intelligence, financial goals, investment planning, document handling, and financial scenario tools.'],
          ['Implementation details', 'Next.js App Router and API routes; Prisma-backed core data; Supabase PostgreSQL for chat storage; multiple documented AI provider integrations.'],
        ],
        links: [['GitHub repository', 'https://github.com/channallikrishnasai/vaultiq-ai']],
      },
      infravision: {
        eyebrow: 'AI · infrastructure image analysis', title: 'InfraVision', accent: '#8c8cff',
        summary: 'An AI-based infrastructure damage-detection and image-analysis system.',
        sections: [
          ['Problem', 'Identify infrastructure damage from imagery.'],
          ['Solution', 'An AI-based damage-detection and image-analysis system, as described in the supplied project information.'],
          ['Recognition', 'The Inventra 2026 RNSIT Project Open House Panorama certificate names a Best Project award for an AI-based infrastructure image-analysis system.'],
          ['Technology', 'Project-specific technologies have not been provided.'],
          ['Key features', 'A feature list was not available in the materials reviewed.'],
          ['Implementation details', 'Model and implementation details are not verified.'],
        ], previews: [['Inventra 2026 Best Project certificate', 'assets/certificates/inventra-2026-best-project-infrastructure-image-analysis.jpg', 'Inventra 2026 Best Project certificate for AI-based infrastructure image analysis.']], links: [],
      },
      odin: {
        eyebrow: 'Local-first Android assistant', title: 'ODIN', accent: '#91baff',
        summary: 'An Android assistant prototype that combines voice and text requests, local or configured assistant providers, device tools, and routines.',
        sections: [
          ['Problem', 'Bring assistant requests, Android actions and configurable smart-home workflows into one native mobile experience.'],
          ['Solution', 'A Kotlin and Compose app routes requests through assistant providers and tool capabilities, with explicit permission and setup boundaries.'],
          ['Technology', 'Kotlin 2.1, Jetpack Compose, Material 3, Hilt, Room, DataStore, OkHttp, LiteRT-LM, MediaPipe, ML Kit text recognition, Vosk and MQTT integrations.'],
          ['Key features', 'Documented capabilities include chat and local memory, routines and tool calls, speech input, text-to-speech fallback, camera OCR, fast paths for common actions, and configurable Home Assistant, MQTT, SwitchBot and Matter provider boundaries.'],
          ['Architecture and implementation', 'The repository separates assistant providers, tools and routines, device providers, voice and Room-backed persistence. Requests can use a local model when configured or a selected remote provider.'],
          ['Validation boundary', 'Model assets and smart-home credentials require configuration. OCR, speech and offline inference need target-device validation; the documented Matter dispatcher does not perform native cluster control. Example routines are configurable workflows, not verified live automations.'],
        ], links: [['ODIN Android repository', 'https://github.com/channallikrishnasai/odin-android']],
      },
    },
    experience: {
      codomax: {
        eyebrow: 'Completed internship', title: 'Codomax Digital Solutions', accent: '#ffb23f',
        summary: 'Full Stack Web Development Intern.',
        sections: [
          ['Company and role', 'Codomax Digital Solutions — Full Stack Web Development Intern.'],
          ['Duration', 'Internship dates or duration were not provided.'],
          ['Responsibilities', 'The completion certificate confirms assigned tasks were completed, but does not describe them in detail.'],
          ['Certificate', 'Certificate ID CDM/CERT/945434, issued 16 September 2026.'],
        ],
        previews: [
          ['Internship completion certificate', 'assets/certificates/codomax-completion-preview-1.png', 'Codomax Digital Solutions Full Stack Web Development internship completion certificate.'],
          ['Letter of recommendation · page 1', 'assets/certificates/codomax-recommendation-preview-1.png', 'Codomax Digital Solutions letter of recommendation, page 1 of 2, dated 16 September 2026.'],
          ['Letter of recommendation · page 2', 'assets/certificates/codomax-recommendation-preview-2.jpg', 'Codomax Digital Solutions letter of recommendation, page 2 of 2.'],
        ],
        links: [],
      },
      stoxra: {
        eyebrow: 'Completed internship · certificate verified', title: 'Stoxra Technologies', accent: '#8c8cff',
        summary: 'Growth and Business Development · SEO & Web Development Intern · 20 August–20 October 2026.',
        sections: [
          ['Company and role', 'Stoxra Technologies — SEO & Web Development Intern in the Growth and Business Development program.'],
          ['Internship dates', 'Started 20 August 2026 and completed 20 October 2026, as stated on the completion certificate.'],
          ['Areas of contribution', 'Webpage development, SEO optimization, and website management.'],
          ['Certificate', 'Certificate ID STX-CERT-2026-A4BCED62A7 · issued 23 October 2026.'],
        ],
        previews: [
          ['Internship completion certificate', 'assets/certificates/stoxra-internship-completion-preview-1.png', 'Stoxra Technologies certificate of internship completion for Krishna Sai Channalli, SEO and Web Development Intern.'],
        ],
        links: [],
      },
      gemini: {
        eyebrow: 'Campus ambassador', title: 'Google Gemini Student Ambassador', accent: '#a9a1ff',
        summary: 'A campus-facing student ambassador role focused on helping peers discover and use Gemini and Google AI.',
        sections: [
          ['Role', 'Google Gemini Student Ambassador · campus ambassador.'],
          ['Program', 'Google describes its India student ambassador program as a way to build practical AI experience and campus impact.'],
          ['Campus focus', 'The program overview describes leading campus activations, building a student community, and helping students explore practical uses of Gemini.'],
        ],
        links: [],
      },
    },
    achievement: {
      'certified-participation': {
        eyebrow: 'Participation certificates', title: 'Hackathon record', accent: '#efe7da',
        summary: 'Six supplied certificates document event participation. They do not claim a win or ranking.',
        sections: [
          ['ET AI Hackathon 2.0', 'Certificate of participation · issued 26 August 2026.'],
          ['DECODE SIH 2026', 'Participation certificate from OSCode.'],
          ['The HIVE', 'Participation in a 24-hour AI hackathon organized by Applybee AI.'],
          ['StoxraHack 2026', 'Certificate of participation · issued 10 September 2026.'],
          ['Agents That Act', 'TrueFoundry × Polaris hackathon · 26 September 2026 · Bengaluru.'],
          ['TVS Credit E.P.I.C 8.0', 'Participation in the IT Challenge · certificate dated 10 October 2026.'],
        ],
        previews: [
          ['ET AI Hackathon 2.0 certificate', 'assets/certificates/et-ai-hackathon-2-participation-preview-01.jpg', 'ET AI Hackathon 2.0 participation certificate.'],
          ['DECODE SIH 2026 certificate', 'assets/certificates/decode-sih-2026-participation-preview-01.jpg', 'DECODE SIH 2026 participation certificate.'],
          ['The HIVE certificate', 'assets/certificates/hive-24-hour-ai-hackathon-participation-preview-01.jpg', 'The HIVE 24-hour AI Hackathon participation certificate.'],
          ['StoxraHack 2026 certificate', 'assets/certificates/stoxrahack-2026-participation-preview-01.jpg', 'StoxraHack 2026 participation certificate.'],
          ['Agents That Act certificate', 'assets/certificates/truefoundry-polaris-agents-that-act-participation-preview-01.jpg', 'TrueFoundry Polaris Agents That Act participation certificate.'],
          ['TVS Credit E.P.I.C 8.0 certificate', 'assets/certificates/tvs-credit-epic-8-it-challenge-participation-preview-01.jpg', 'TVS Credit E.P.I.C 8.0 IT Challenge participation certificate.'],
        ], links: [],
      },
      inventra: {
        eyebrow: 'Project award · RNSIT', title: 'Inventra 2026', accent: '#ffb23f',
        summary: 'The supplied RNS Institute of Technology certificate records a Best Project award at the Inventra 2026 Project Open House Panorama.',
        sections: [['Awarded project', 'AI-based image analysis system for infrastructure. The certificate identifies it as a Best Project award.']],
        previews: [['Inventra 2026 Best Project certificate', 'assets/certificates/inventra-2026-best-project-infrastructure-image-analysis.jpg', 'Inventra 2026 Best Project certificate for AI-based infrastructure image analysis.']], links: [],
      },
      moss: {
        eyebrow: 'Certificate of achievement · 2026', title: 'Moss: The Zero-Latency Builder Sprint', accent: '#ffb23f',
        summary: 'A HiDevs × AI House certificate recognizes participation and contribution to the builder sprint. No ranking is stated.',
        sections: [['Recognition', 'The certificate describes creativity, technical work, innovation and execution using Moss; it does not state a placement.']],
        previews: [['Moss builder sprint certificate', 'assets/certificates/moss-zero-latency-builder-sprint-achievement-preview-01.jpg', 'Moss Zero-Latency Builder Sprint certificate of achievement.']], links: [],
      },
      learning: {
        eyebrow: 'Course and workshop records', title: 'Learning & assessments', accent: '#ffb23f',
        summary: 'Eight supplied records cover course completion, assessment, workshop participation and an aptitude-test participation certificate.',
        sections: [
          ['Python Fundamentals', 'Infosys Springboard · completed 10 December 2025.'],
          ['Digital Engineering', 'FutureSkills Prime / NASSCOM assessment · Gold category · 82% · issued 5 May 2026.'],
          ['C programming course', 'Infosys Springboard · completed 19 May 2025.'],
          ['C Training', 'EduPyramids, SINE, IIT Bombay · 11 May 2026 · 95%.'],
          ['C++ Training', 'EduPyramids, SINE, IIT Bombay · 11 May 2026 · 82.5%.'],
          ['Ethical Hacking & Cybersecurity Workshop', 'VaultofCodes · two-hour workshop assessment · 70/100 · 15 September 2026.'],
          ['Recent Trends and Tools in AI for Researchers', 'One-day FDP participation · Bangalore Technological Institute, IEEE Bangalore Section and PencilBitz · 8 August 2026.'],
          ['Internship Common Aptitude Test', 'Participation certificate · 17 August 2026. This records participation, not an internship offer or placement.'],
        ],
        previews: [
          ['Python Fundamentals certificate', 'assets/certificates/python-fundamentals-infosys-preview-01.jpg', 'Infosys Springboard Python Fundamentals certificate.'],
          ['Digital Engineering assessment certificate · page 1', 'assets/certificates/digital-engineering-nasscom-gold-assessment-preview-01.jpg', 'NASSCOM Digital Engineering Gold assessment certificate, page 1.'],
          ['Digital Engineering assessment certificate · page 2', 'assets/certificates/digital-engineering-nasscom-gold-assessment-preview-02.jpg', 'NASSCOM Digital Engineering Gold assessment certificate, page 2.'],
          ['C programming course certificate', 'assets/certificates/c-programming-infosys.jpg', 'Infosys Springboard C programming course certificate.'],
          ['C Training certificate', 'assets/certificates/c-training-edupyramids-sine-iit-bombay-preview-01.jpg', 'EduPyramids SINE IIT Bombay C Training certificate.'],
          ['C++ Training certificate', 'assets/certificates/cpp-training-edupyramids-sine-iit-bombay-preview-01.jpg', 'EduPyramids SINE IIT Bombay C++ Training certificate.'],
          ['Ethical Hacking & Cybersecurity Workshop · page 1', 'assets/certificates/ethical-hacking-cybersecurity-workshop-assessment-preview-01.jpg', 'Ethical Hacking and Cybersecurity Workshop assessment certificate, page 1.'],
          ['Ethical Hacking & Cybersecurity Workshop · page 2', 'assets/certificates/ethical-hacking-cybersecurity-workshop-assessment-preview-02.jpg', 'Ethical Hacking and Cybersecurity Workshop assessment certificate, page 2.'],
          ['AI for Researchers FDP certificate', 'assets/certificates/ai-for-researchers-fdp-participation.jpg', 'AI for Researchers FDP participation certificate.'],
          ['Internship Common Aptitude Test certificate', 'assets/certificates/icat-participation-preview-01.jpg', 'Internship Common Aptitude Test participation certificate.'],
        ], links: [],
      },
      paytm: {
        eyebrow: 'Hackathon build · ArthiX', title: 'Paytm Hackathon', accent: '#ff5a1e',
        summary: 'Top 15 selection among 2,000+ teams. The hackathon build was ArthiX: a connected, self-hostable business workspace that brings operational tools and event-driven workflows together.',
        sections: [
          ['Recognition', 'Top 15 among 2,000+ teams, as stated in the supplied portfolio record. This is the reported ranking; no additional award is implied.'],
          ['What I built', 'ArthiX is a modular business workspace for CRM, finance, people, projects, service and operations. The public repository also documents a browser-based admin workspace, API, marketing site, plugin marketplace, shared packages and official integration plugins.'],
          ['How it works', 'The workspace organizes business records in domain modules. API services and shared core packages connect those areas; configurable event-driven workflows handle routine steps such as finance approvals. PostgreSQL and Redis support the documented deployment. Optional AI and integrations require configuration.'],
          ['Technology', 'Next.js admin workspace, Hono API on Node.js, shared TypeScript packages, PostgreSQL 16 with pgvector, Redis 7, Docker Compose and pnpm 9.'],
          ['Build boundary', 'The feature map and stack are verified against the public ArthiX repository. The detailed flow below visualizes the documented architecture; it does not claim every workflow or integration was enabled in the hackathon demo.'],
        ],
        previews: Array.from({length:10}, (_,i) => [`ArthiX overview · page ${i+1} of 10`, `assets/project-documents/arthix-overview-preview-${String(i+1).padStart(2,'0')}.jpg`, `ArthiX project overview document, page ${i+1} of 10.`]),
        links: [['ArthiX source repository', 'https://github.com/channallikrishnasai/ArthiX']],
      },
    },
  };

  const SKILL_PROJECTS = {
    'react': [['OPERO', 'https://github.com/channallikrishnasai/OPERO'], ['VaultIQ AI', 'https://github.com/channallikrishnasai/vaultiq-ai'], ['KAVACH', 'https://github.com/channallikrishnasai/KAVACH'], ['LifeOS AI', 'https://github.com/channallikrishnasai/LifeOS-AI'], ['SocialMediaPlatform', 'https://github.com/channallikrishnasai/SocialMediaPlatform']],
    'next.js': [['OPERO', 'https://github.com/channallikrishnasai/OPERO'], ['VaultIQ AI', 'https://github.com/channallikrishnasai/vaultiq-ai']],
    'typescript': [['OPERO', 'https://github.com/channallikrishnasai/OPERO'], ['VaultIQ AI', 'https://github.com/channallikrishnasai/vaultiq-ai'], ['KAVACH', 'https://github.com/channallikrishnasai/KAVACH'], ['LifeOS AI', 'https://github.com/channallikrishnasai/LifeOS-AI'], ['SocialMediaPlatform', 'https://github.com/channallikrishnasai/SocialMediaPlatform']],
    'javascript': [['Krishna Sai portfolio', 'https://github.com/channallikrishnasai/Krishna-Sai-Channalli-portfolio'], ['Project Management Tool', 'https://github.com/channallikrishnasai/project-management-tool']],
    'html5': [['Krishna Sai portfolio', 'https://github.com/channallikrishnasai/Krishna-Sai-Channalli-portfolio']],
    'css3': [['Krishna Sai portfolio', 'https://github.com/channallikrishnasai/Krishna-Sai-Channalli-portfolio']],
    'tailwind css': [['OPERO', 'https://github.com/channallikrishnasai/OPERO'], ['VaultIQ AI', 'https://github.com/channallikrishnasai/vaultiq-ai'], ['LifeOS AI', 'https://github.com/channallikrishnasai/LifeOS-AI']],
    'python': [['The-Opero', 'https://github.com/channallikrishnasai/The-Opero'], ['LifeOS AI', 'https://github.com/channallikrishnasai/LifeOS-AI'], ['KAVACH', 'https://github.com/channallikrishnasai/KAVACH'], ['Ecommerce Store', 'https://github.com/channallikrishnasai/Ecommerce_Store']],
    'fastapi': [['The-Opero', 'https://github.com/channallikrishnasai/The-Opero'], ['LifeOS AI', 'https://github.com/channallikrishnasai/LifeOS-AI'], ['KAVACH', 'https://github.com/channallikrishnasai/KAVACH']],
    'node.js': [['OPERO', 'https://github.com/channallikrishnasai/OPERO']],
    'go': [['Proofline', 'https://github.com/channallikrishnasai/proofline']],
    'postgresql': [['OPERO', 'https://github.com/channallikrishnasai/OPERO'], ['VaultIQ AI', 'https://github.com/channallikrishnasai/vaultiq-ai'], ['LifeOS AI', 'https://github.com/channallikrishnasai/LifeOS-AI'], ['SocialMediaPlatform', 'https://github.com/channallikrishnasai/SocialMediaPlatform']],
    'prisma': [['OPERO', 'https://github.com/channallikrishnasai/OPERO'], ['VaultIQ AI', 'https://github.com/channallikrishnasai/vaultiq-ai']],
    'redis': [['LifeOS AI', 'https://github.com/channallikrishnasai/LifeOS-AI'], ['SocialMediaPlatform', 'https://github.com/channallikrishnasai/SocialMediaPlatform']],
    'supabase': [['VaultIQ AI', 'https://github.com/channallikrishnasai/vaultiq-ai'], ['LifeOS AI', 'https://github.com/channallikrishnasai/LifeOS-AI']],
    'rest apis': [['OPERO', 'https://github.com/channallikrishnasai/OPERO'], ['LifeOS AI', 'https://github.com/channallikrishnasai/LifeOS-AI'], ['SocialMediaPlatform', 'https://github.com/channallikrishnasai/SocialMediaPlatform'], ['KAVACH', 'https://github.com/channallikrishnasai/KAVACH']],
    'onnx': [['KAVACH', 'https://github.com/channallikrishnasai/KAVACH']],
    'opencv': [['KAVACH', 'https://github.com/channallikrishnasai/KAVACH']],
    'computer vision': [['KAVACH', 'https://github.com/channallikrishnasai/KAVACH']],
    'face recognition': [],
    'ai application development': [['OPERO', 'https://github.com/channallikrishnasai/OPERO'], ['VaultIQ AI', 'https://github.com/channallikrishnasai/vaultiq-ai'], ['LifeOS AI', 'https://github.com/channallikrishnasai/LifeOS-AI'], ['The-Opero', 'https://github.com/channallikrishnasai/The-Opero']],
    'kotlin': [['ODIN Android assistant', 'https://github.com/channallikrishnasai/odin-android']],
    'android': [['ODIN Android assistant', 'https://github.com/channallikrishnasai/odin-android']],
    'three.js': [['OPERO', 'https://github.com/channallikrishnasai/OPERO'], ['VaultIQ AI', 'https://github.com/channallikrishnasai/vaultiq-ai']],
    'react three fiber': [['OPERO', 'https://github.com/channallikrishnasai/OPERO'], ['VaultIQ AI', 'https://github.com/channallikrishnasai/vaultiq-ai']],
    'framer motion': [['OPERO', 'https://github.com/channallikrishnasai/OPERO'], ['VaultIQ AI', 'https://github.com/channallikrishnasai/vaultiq-ai'], ['LifeOS AI', 'https://github.com/channallikrishnasai/LifeOS-AI']],
    'git': [['OPERO', 'https://github.com/channallikrishnasai/OPERO'], ['SocialMediaPlatform', 'https://github.com/channallikrishnasai/SocialMediaPlatform']],
    'github': [['OPERO', 'https://github.com/channallikrishnasai/OPERO'], ['SocialMediaPlatform', 'https://github.com/channallikrishnasai/SocialMediaPlatform']],
    'docker': [['LifeOS AI', 'https://github.com/channallikrishnasai/LifeOS-AI'], ['SocialMediaPlatform', 'https://github.com/channallikrishnasai/SocialMediaPlatform'], ['KAVACH', 'https://github.com/channallikrishnasai/KAVACH']],
    'gemini': [['The-Opero', 'https://github.com/channallikrishnasai/The-Opero'], ['KAVACH (optional advisory)', 'https://github.com/channallikrishnasai/KAVACH']],
    'sqlite': [['VaultIQ AI', 'https://github.com/channallikrishnasai/vaultiq-ai']],
    'playwright': [['OPERO', 'https://github.com/channallikrishnasai/OPERO']],
    'litert-lm': [['ODIN Android assistant', 'https://github.com/channallikrishnasai/odin-android']],
    'mediapipe': [['ODIN Android assistant', 'https://github.com/channallikrishnasai/odin-android']],
    'vosk': [['ODIN Android assistant', 'https://github.com/channallikrishnasai/odin-android']],
    'ml kit ocr': [['ODIN Android assistant', 'https://github.com/channallikrishnasai/odin-android']],
    'jetpack compose': [['ODIN Android assistant', 'https://github.com/channallikrishnasai/odin-android']],
    'material 3': [['ODIN Android assistant', 'https://github.com/channallikrishnasai/odin-android']],
    'hilt': [['ODIN Android assistant', 'https://github.com/channallikrishnasai/odin-android']],
    'room': [['ODIN Android assistant', 'https://github.com/channallikrishnasai/odin-android']],
    'datastore': [['ODIN Android assistant', 'https://github.com/channallikrishnasai/odin-android']],
    'mqtt': [['ODIN Android assistant', 'https://github.com/channallikrishnasai/odin-android']],
    'okhttp': [['ODIN Android assistant', 'https://github.com/channallikrishnasai/odin-android']],
    'home assistant': [['ODIN Android assistant', 'https://github.com/channallikrishnasai/odin-android']],
    'switchbot': [['ODIN Android assistant', 'https://github.com/channallikrishnasai/odin-android']],
    'matter': [['ODIN Android assistant', 'https://github.com/channallikrishnasai/odin-android']],
  };

  const SKILL_META = {
    'react': ['Frontend engineering', 'used', 'React is listed in OPERO, VaultIQ AI, and KAVACH project documentation.'],
    'next.js': ['Frontend engineering', 'used', 'Next.js is listed in the OPERO and VaultIQ project stacks.'],
    'typescript': ['Frontend engineering', 'used', 'TypeScript is listed in OPERO, VaultIQ AI, and KAVACH project documentation.'],
    'javascript': ['Frontend engineering', 'used', 'JavaScript powers this portfolio and is used in the documented web projects.'],
    'html5': ['Frontend engineering', 'used', 'HTML structures this portfolio.'],
    'css3': ['Frontend engineering', 'used', 'CSS styles this portfolio.'],
    'tailwind css': ['Frontend engineering', 'used', 'Tailwind CSS is listed in the OPERO and VaultIQ project stacks.'],
    'c programming': ['Programming foundations', 'explored', 'Completed a C programming course with Infosys Springboard and C training through EduPyramids, SINE and IIT Bombay. No project implementation is claimed here.'],
    'c++': ['Programming foundations', 'explored', 'Completed C++ training through EduPyramids, SINE and IIT Bombay. No project implementation is claimed here.'],
    'python': ['Backend engineering', 'used', 'Python is used by The-Opero and documented in related project sources.'],
    'fastapi': ['Backend engineering', 'used', 'FastAPI is documented in KAVACH and related project sources.'],
    'node.js': ['Backend engineering', 'used', 'Node.js is used for the OPERO API foundation.'],
    'go': ['Programming languages', 'used', 'Go is used in the Proofline command-line forensics and case-analysis project.'],
    'rest apis': ['Backend engineering', 'used', 'API routes and service endpoints are documented in OPERO and related projects.'],
    'ai application development': ['AI & machine learning', 'used', 'AI application work is documented in VaultIQ AI and The-Opero.'],
    'gemini': ['AI & machine learning', 'used', 'The-Opero documents Gemini integration. KAVACH documents Gemini as an optional advisory that cannot approve or dispatch. This is separate from the public OPERO Phase 0 repository.'],
    'onnx': ['Computer vision', 'used', 'KAVACH includes a local ONNX Runtime road-damage provider; compatible model weights require separate configuration.'],
    'opencv': ['Computer vision', 'used', 'KAVACH uses OpenCV for image and video frame processing.'],
    'face recognition': ['Computer vision', 'explored', 'Explored as a technical area; no verified project implementation is currently linked.'],
    'kotlin': ['Mobile development', 'used', 'Kotlin is used by the ODIN Android assistant repository.'],
    'android': ['Mobile development', 'used', 'ODIN is documented as a native Android assistant.'],
    'postgresql': ['Databases & infrastructure', 'used', 'PostgreSQL is listed in the OPERO and VaultIQ project documentation.'],
    'prisma': ['Databases & infrastructure', 'used', 'Prisma is documented in OPERO and VaultIQ.'],
    'sqlite': ['Databases & infrastructure', 'used', 'SQLite is listed as the development database in VaultIQ documentation.'],
    'supabase': ['Databases & infrastructure', 'used', 'Supabase PostgreSQL and Supabase services are documented in VaultIQ.'],
    'redis': ['Databases & infrastructure', 'used', 'Redis is linked to the LifeOS AI and SocialMediaPlatform repositories in the existing technology evidence.'],
    'docker': ['Developer tools', 'used', 'Docker is linked to related project repositories in the existing technology evidence.'],
    'three.js': ['3D & creative development', 'used', 'Three.js is listed in the OPERO and VaultIQ project manifests and documentation.'],
    'react three fiber': ['3D & creative development', 'used', 'React Three Fiber is listed in the OPERO and VaultIQ project manifests.'],
    'framer motion': ['3D & creative development', 'used', 'Framer Motion is listed in the OPERO and VaultIQ project stacks.'],
    'git': ['Developer tools', 'used', 'Git is used to version the portfolio and documented software projects.'],
    'github': ['Developer tools', 'used', 'GitHub hosts the public repositories linked from this portfolio.'],
    'playwright': ['Developer tools', 'used', 'Playwright is listed as a development dependency in OPERO.'],
    'litert-lm': ['AI & machine learning', 'used', 'LiteRT-LM is documented as a selectable local-model runtime; using it depends on model compatibility and downloaded assets.'],
    'mediapipe': ['AI & machine learning', 'used', 'MediaPipe libraries are included in ODIN for supported model and text-processing paths; exact runtime varies by model family.'],
    'vosk': ['AI & machine learning', 'used', 'Vosk is included as a speech-recognition option in ODIN; microphone permissions and device validation apply.'],
    'whisper': ['AI & machine learning', 'explored', 'Whisper is marked explored; a specific verified Whisper implementation in the featured project was not established.'],
    'ml kit ocr': ['Computer vision', 'used', 'ODIN documents ML Kit Latin text recognition for camera OCR; it is not a claim of universal-language OCR.'],
    'jetpack compose': ['Mobile development', 'used', 'ODIN uses Jetpack Compose for its native Android UI.'],
    'material 3': ['Mobile development', 'used', 'ODIN uses Material 3 components in its Compose interface.'],
    'hilt': ['Mobile development', 'used', 'Hilt is included for dependency injection in ODIN.'],
    'room': ['Databases & infrastructure', 'used', 'Room is used for ODIN local persistence.'],
    'datastore': ['Databases & infrastructure', 'used', 'DataStore preferences are included in the ODIN Android app.'],
    'mqtt': ['Mobile development', 'used', 'ODIN documents MQTT-based provider integration; device connectivity requires configuration.'],
    'okhttp': ['Backend engineering', 'used', 'ODIN includes OkHttp for network requests and event-stream support.'],
    'home assistant': ['Mobile development', 'used', 'Home Assistant is a configurable ODIN device-provider integration, not a guarantee of connected devices.'],
    'switchbot': ['Mobile development', 'used', 'SwitchBot appears as a configurable ODIN device-provider integration.'],
    'matter': ['Mobile development', 'used', 'ODIN includes a Matter provider boundary; its repository notes native cluster dispatch is not implemented.'],
  };

  const PROJECT_FLOWS = {
    opero: {
      title: 'OPERO / DOCUMENTED WORKFLOW', badge: 'REQUEST → VERIFIED ACTION', color: 'opero',
      foot: 'Documented OPERO sequence · voice integration is not implemented in the Phase 0 repository',
      steps: [
        ['Speak', '01 / SPEAK', 'A person expresses a work request. The OPERO repository documents the stage; voice integration is not implemented in its Phase 0 foundation.'],
        ['Understand', '02 / UNDERSTAND', 'The documented workflow moves from request understanding into the investigation and decision stages.'],
        ['Investigate', '03 / INVESTIGATE', 'Investigate is a named stage in the documented request-to-action workflow.'],
        ['Decide', '04 / DECIDE', 'The workflow records a decision stage before action.'],
        ['Act', '05 / ACT', 'Act is followed by verification in the documented sequence.'],
        ['Verify', '06 / VERIFY', 'The workflow includes verification before reporting the result.'],
        ['Report', '07 / REPORT', 'The final documented stage reports the outcome.'],
      ],
    },
    proofline: {
      title: 'PROOFLINE / EVIDENCE TO INVESTIGATION', badge: 'CLAIM → RECORD → CORROBORATE', color: 'proofline',
      foot: 'Flow follows the public Proofline README · AI-generated narrative alone is not treated as proof',
      steps: [
        ['Discover', '01 / DISCOVER AGENTS', 'The CLI detects supported AI-agent installations and gathers locally available agent artifacts without launching the agents.'],
        ['Preserve', '02 / SEAL EVIDENCE', 'Collected artifacts are preserved in a case package with hash-chained evidence and provenance.'],
        ['Analyze', '03 / RECONSTRUCT ACTIVITY', 'The analysis correlates agent transcripts, recorded tool calls and related artifacts into findings with source references.'],
        ['Corroborate', '04 / ADD A SECOND WITNESS', 'Endpoint, cloud-audit or MCP-gateway logs can strengthen, disprove or leave a claim unresolved.'],
        ['Report', '05 / EXPLAIN THE RESULT', 'The local case explorer presents findings and evidence states; reports can also be exported to supported structured formats.'],
      ],
    },
    vaultiq: {
      title: 'VAULTIQ AI / APPLICATION ARCHITECTURE', badge: 'PLAN · STORE · ANALYZE', color: 'vault',
      foot: 'Repository-backed architecture map · no automated financial transactions are implied',
      steps: [
        ['Finance UI', '01 / FINANCE MODULES', 'The application documents dashboard modules for expenses, budgets, goals, investments, documents and scenarios.'],
        ['App Router', '02 / NEXT.JS ROUTES', 'The repository uses the Next.js App Router and API routes as the application and service boundary.'],
        ['Prisma', '03 / DATA ACCESS', 'Prisma is documented for core application data access.'],
        ['Databases', '04 / STORAGE', 'SQLite is documented for local development; Supabase PostgreSQL is documented for hosted chat storage.'],
        ['AI providers', '05 / AI INTEGRATIONS', 'The repository documents multiple AI provider integrations for assistant features. Provider configuration is required.'],
      ],
    },
    infravision: {
      title: 'INFRAVISION / CONCEPT FLOW', badge: 'ILLUSTRATIVE · DETAILS UNVERIFIED', color: 'infra',
      foot: 'Illustrative from the supplied project description · implementation flow, model and stack are unverified',
      steps: [
        ['Image input', '01 / IMAGE INPUT', 'An infrastructure image is the input suggested by the supplied project description; no capture or upload implementation was verified.'],
        ['Damage analysis', '02 / ANALYSIS CONCEPT', 'AI-based damage detection and image analysis are described, but the model and processing steps are unavailable.'],
        ['Review', '03 / REVIEW CONCEPT', 'A review output is shown only as a conceptual endpoint. No specific report or decision feature was verified.'],
      ],
    },
    paytm: {
      title: 'ARTHIX / BUSINESS WORKFLOW ARCHITECTURE', badge: 'CONNECTED WORKSPACE · CONFIGURABLE FLOWS', color: 'opero',
      foot: 'Architecture visualization based on the public ArthiX repository and supplied overview · workflow availability depends on configuration',
      steps: [
        ['Workspace', '01 / ADMIN WORKSPACE', 'The repository documents a browser-based Next.js admin workspace for interacting with the platform.'],
        ['Business modules', '02 / DOMAIN MODULES', 'CRM, finance, people, projects, service and operations organize the main business domains.'],
        ['API + core', '03 / SHARED SERVICES', 'The Hono API and shared core packages provide service and business-entity boundaries in the repository structure.'],
        ['Workflow rules', '04 / EVENT-DRIVEN STEPS', 'Configurable business workflows connect events to routine steps; finance approval flows are among the documented use cases.'],
        ['Data + integrations', '05 / PLUGINS & DATA', 'PostgreSQL, Redis and official integration plugins support configured deployments. Optional AI requires a supported provider and credentials.'],
      ],
    },
    odin: {
      title: 'ODIN / REQUEST TO DEVICE RESULT', badge: 'LOCAL-FIRST · CAPABILITY CHECKED', color: 'odin',
      foot: 'Repository-documented provider boundaries · examples require configured permissions, providers and devices',
      steps: [
        ['Request', '01 / REQUEST', 'A request can arrive by typed chat or supported speech input. Speech engines and permissions need device setup.'],
        ['Route', '02 / ROUTE REQUEST', 'The app can handle documented fast paths or select a configured assistant provider; local models need downloaded assets.'],
        ['Capability', '03 / CHECK CAPABILITY', 'Tool and device-provider boundaries determine whether an action is available in the configured environment.'],
        ['Permission', '04 / SETUP + PERMISSION', 'Unavailable providers or missing permissions return an explicit setup or capability result; actions must not be reported as completed.'],
        ['Result', '05 / REPORT RESULT', 'The documented flow reports a confirmed action or a failure/unavailable result. Voice output can use the configured TTS path.'],
      ],
    },
  };

  const projectArt = Object.fromEntries(Object.entries(PROJECT_FLOWS).map(([key, flow]) => [key,
    `<div class="project-art project-art--${flow.color}" data-flow-kind="${key}"><div class="art-caption"><span>${flow.title}</span><b>${flow.badge}</b></div><div class="flow-visual flow-visual--${flow.color}" aria-hidden="true"><span class="flow-orbit flow-orbit--a"></span><span class="flow-orbit flow-orbit--b"></span><span class="flow-core"></span><span class="flow-spark flow-spark--a"></span><span class="flow-spark flow-spark--b"></span></div><div class="automation-graph-scroll" tabindex="0" aria-label="Scroll horizontally through the ${key} flow"><div class="automation-graph" role="group" aria-label="${flow.title}">${flow.steps.map(([label], index) => `${index ? '<span class="flow-edge" aria-hidden="true"></span>' : ''}<button type="button" class="flow-node${index === 0 ? ' is-active' : ''}" data-flow-step="${index}" aria-pressed="${index === 0}"><i>${String(index + 1).padStart(2, '0')}</i><b>${label}</b><small>Select to inspect</small></button>`).join('')}</div></div><div class="flow-inspector" aria-live="polite"><b class="flow-inspector-title">${flow.steps[0][1]}</b><p class="flow-inspector-copy">${flow.steps[0][2]}</p></div><p class="art-foot">${flow.foot}</p></div>`
  ]));

  $$('.skill-chip').forEach((chip) => {
    const level = chip.dataset.level || 'explored';
    chip.title = `${level === 'used' ? 'Used in projects' : level === 'explored' ? 'Explored' : 'Familiar with'} — open for context`;
    chip.setAttribute('aria-description', level === 'used' ? 'Used in projects' : level === 'explored' ? 'Explored' : 'Familiar with');
  });

  function skillDetail(name) {
    const matches = SKILL_PROJECTS[name.toLowerCase()] || [];
    const meta = SKILL_META[name.toLowerCase()] || ['Developer stack', 'familiar', 'Included in the technology list supplied by Krishna Sai. No featured-project connection is claimed unless a verified repository or implementation is linked.'];
    const notes = {
      onnx: 'KAVACH implements a local ONNX Runtime road-damage provider. Compatible model weights and a verified model license must be configured separately.',
      opencv: 'KAVACH uses OpenCV for image and video frame processing. Its non-classifying contrast cues are not presented as damage detections; model detections require a compatible configured ONNX model.',
    };
    const levelName = meta[1] === 'used' ? 'Used in projects' : meta[1] === 'explored' ? 'Explored' : 'Familiar with';
    const sections = [
      ['Experience', levelName + ' · ' + meta[0] + '. ' + meta[2]],
      [matches.length ? 'Project connections' : 'Project evidence', matches.length
        ? matches.map(([project]) => project).join(' · ') + '. Repository links are included where available.'
        : 'No verified repository or implementation connection is available in the reviewed sources.'],
    ];
    if (notes[name.toLowerCase()]) sections.push(['Implementation note', notes[name.toLowerCase()]]);
    const links = matches.filter(([, url]) => url).map(([project, url]) => [project + ' repository', url]);
    const skillCertificates = {
      'c programming': [
        ['C programming course certificate', 'assets/certificates/c-programming-infosys.jpg'],
        ['C Training certificate', 'assets/certificates/c-training-edupyramids-sine-iit-bombay-preview-01.jpg'],
      ],
      'c++': [['C++ Training certificate', 'assets/certificates/cpp-training-edupyramids-sine-iit-bombay-preview-01.jpg']],
    };
    const skillPreviews = (skillCertificates[name.toLowerCase()] || []).map(([heading,src]) => [heading,src,heading]);
    return {
      eyebrow: 'Technical skill', title: name, accent: '#ffb23f',
      summary: 'Project connections are shown only where a repository manifest, source file or project documentation supports the technology.',
      sections,
      previews: skillPreviews,
      links,
    };
  }

  function renderDetail(detail, trigger) {
    detailDialog.scrollTop = 0;
    detailDialog.dataset.detailKind = (trigger?.dataset.detail || '').split(':')[0] || '';
    detailEyebrow.textContent = detail.eyebrow;
    detailTitle.textContent = detail.title;
    detailSummary.textContent = detail.summary;
    detailDialog.style.setProperty('--detail-accent', detail.accent || '#ffb23f');
    const detailType = (trigger?.dataset.detail || '').split(':');
    const art = detailType[0] === 'project' ? projectArt[detailType[1]] : detailType[0] === 'achievement' ? projectArt[detailType[1]] : '';
    detailVisual.replaceChildren();
    detailVisual.hidden = !art;
    if (art) {
      detailVisual.innerHTML = art;
      const flowTitle = $('.flow-inspector-title', detailVisual);
      const flowCopy = $('.flow-inspector-copy', detailVisual);
      $$('[data-flow-step]', detailVisual).forEach((node) => node.addEventListener('click', () => {
        const index = Number(node.dataset.flowStep);
        const flow = PROJECT_FLOWS[detailType[0] === 'achievement' ? detailType[1] : detailType[1]];
        const item = flow?.steps[index]?.slice(1);
        if (!item) return;
        $$('[data-flow-step]', detailVisual).forEach((other) => {
          const active = other === node;
          other.classList.toggle('is-active', active);
          other.setAttribute('aria-pressed', String(active));
        });
        flowTitle.textContent = item[0];
        flowCopy.textContent = item[1];
      }));
      const pause = document.createElement('button');
      pause.className = 'art-motion-toggle';
      pause.type = 'button';
      pause.textContent = 'Pause visual motion';
      pause.setAttribute('aria-pressed', 'false');
      pause.addEventListener('click', () => {
        const paused = detailVisual.classList.toggle('is-paused');
        pause.textContent = paused ? 'Resume visual motion' : 'Pause visual motion';
        pause.setAttribute('aria-pressed', String(paused));
      });
      detailVisual.appendChild(pause);
    }
    detailSections.replaceChildren();
    detail.sections.forEach(([heading, body]) => {
      const section = document.createElement('section');
      section.className = 'detail-section';
      const h = document.createElement('h3');
      h.textContent = heading;
      section.appendChild(h);
      if (heading === 'Technology' && !/not provided|not been provided/i.test(body)) {
        const tags = document.createElement('ul');
        tags.className = 'detail-tags';
        body.replace(/\.$/, '').split(/,\s*/).forEach((technology) => {
          const tag = document.createElement('li');
          tag.textContent = technology;
          tags.appendChild(tag);
        });
        section.appendChild(tags);
      } else {
        const p = document.createElement('p');
        p.textContent = body;
        section.appendChild(p);
      }
      detailSections.appendChild(section);
    });
    detailPreviews.replaceChildren();
    const previews = detail.previews || [];
    detailPreviews.hidden = !previews.length;
    previews.forEach(([heading, src, alt]) => {
      const section = document.createElement('section');
      section.className = 'detail-preview';
      const title = document.createElement('h3');
      title.textContent = heading;
      const image = document.createElement('img');
      image.src = src;
      image.alt = alt;
      image.loading = 'lazy';
      image.decoding = 'async';
      section.append(title, image);
      detailPreviews.appendChild(section);
    });
    detailLinks.replaceChildren();
    if (detail.links.length) {
      detail.links.forEach(([label, href]) => {
        const link = document.createElement('a');
        link.className = 'detail-link';
        link.href = href;
        link.target = '_blank';
        link.rel = 'noopener noreferrer';
        link.textContent = label + ' ↗';
        detailLinks.appendChild(link);
      });
    } else if (!previews.length) {
      const note = document.createElement('p');
      note.className = 'detail-no-links';
      note.textContent = 'No external link is available for this item.';
      detailLinks.appendChild(note);
    }
    detailReturnFocus = trigger;
    html.classList.add('detail-open');
    if (!detailDialog.open) detailDialog.showModal();
    requestAnimationFrame(() => detailClose.focus());
  }

  function openDetail(trigger) {
    const value = trigger.dataset.detail || '';
    const split = value.indexOf(':');
    const kind = value.slice(0, split);
    const key = value.slice(split + 1);
    const detail = kind === 'skill' ? skillDetail(key) : DETAIL_DATA[kind]?.[key];
    if (detail) renderDetail(detail, trigger);
  }

  detailClose.addEventListener('click', () => detailDialog.close());
  detailDialog.addEventListener('close', () => {
    html.classList.remove('detail-open');
    if (detailReturnFocus?.isConnected) detailReturnFocus.focus();
  });
  detailDialog.addEventListener('click', (e) => { if (e.target === detailDialog) detailDialog.close(); });

  document.addEventListener('click', (e) => {
    const detailTrigger = e.target.closest('[data-detail]');
    if (detailTrigger) { openDetail(detailTrigger); return; }
    if (e.target.closest('#copyEmail')) { copyEmail(); return; }
    const go = e.target.closest('[data-go]');
    const a = e.target.closest('[data-jump]');
    if (!go && !a) return;
    e.preventDefault();
    if (html.classList.contains('menu-open')) setMenu(false);
    if (go) {
      const g = go.dataset.go;
      jump(/^\d+$/.test(g) ? 'case:' + g : g);
    } else jump(a.dataset.jump);
  });
  document.addEventListener('keydown', (e) => {
    if (e.repeat || !['Enter', ' '].includes(e.key)) return;
    const card = e.target.closest?.('.screen[data-detail]');
    if (card) { e.preventDefault(); openDetail(card); }
  });

  // copy email
  const copyBtn = $('#copyEmail');
  const copyFeedback = $('#copyFeedback');
  let copyResetTimer = 0;
  async function copyEmail() {
    const email = copyBtn.dataset.email;
    let copied = false;
    copyBtn.textContent = 'Copying…';
    copyFeedback.textContent = 'Copying email address…';
    try {
      if (navigator.clipboard?.writeText) {
        let timeoutId;
        const result = await Promise.race([
          navigator.clipboard.writeText(email).then(() => true),
          new Promise((resolve) => { timeoutId = setTimeout(() => resolve(false), 800); }),
        ]);
        clearTimeout(timeoutId);
        copied = result === true;
      }
    } catch {}
    if (!copied) {
      const field = document.createElement('textarea');
      field.value = email;
      field.setAttribute('readonly', '');
      field.style.position = 'fixed';
      field.style.opacity = '0';
      document.body.appendChild(field);
      field.select();
      try { copied = document.execCommand('copy'); } catch {}
      field.remove();
    }
    copyBtn.textContent = copied ? 'Copied!' : 'Copy unavailable';
    copyFeedback.textContent = copied ? 'Email address copied to clipboard.' : 'Could not copy automatically. Select the email address shown in Contact.';
    clearTimeout(copyResetTimer);
    copyResetTimer = setTimeout(() => {
      copyBtn.textContent = 'Copy email';
      copyFeedback.textContent = '';
    }, 2600);
  }

  // Bengaluru local clock
  const clock = $('#clock');
  const tick = () => {
    try { clock.textContent = new Intl.DateTimeFormat('en-GB', { hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Kolkata' }).format(new Date()); }
    catch { clock.textContent = new Date().toTimeString().slice(0, 5); }
  };
  tick(); setInterval(tick, 15000);

  // ---------- loader + enter ----------
  const loader = $('#loader');
  const loadPct = $('#loadPct'), loadFill = $('#loadFill');
  const loadStatus = $('.loader-status');
  $$('.hn').forEach((el, i) => { el.style.transitionDelay = `${0.25 + i * 0.055}s`; });

  function enter(withSound) {
    if (S.entered) return;
    S.entered = true;
    if (fine) html.classList.add('has-cursor');
    if (withSound) Sound.set(true);
    $('header.nav').inert = false;
    menu.inert = true;
    $('#top').inert = false;
    loader.classList.add('is-out');
    loader.setAttribute('aria-hidden', 'true');
    document.body.classList.remove('is-locked');
    html.classList.add('is-entered');
    if (lenis) lenis.start();
    measure();
    setTimeout(() => loader.remove(), 1300);
  }
  $$('[data-enter]').forEach((b) => b.addEventListener('click', () => enter(b.dataset.enter === 'sound')));

  const showEntry = () => {
    if (S.entered || !loader.isConnected) return;
    loader.classList.add('is-ready');
    const first = $('[data-enter="sound"]');
    if (first) first.focus({ preventScroll: true });
  };
  const loaderFallback = setTimeout(() => {
    if (S.entered || !loader.isConnected) return;
    loadStatus.setAttribute('role', 'status');
    loadStatus.removeAttribute('aria-valuemin');
    loadStatus.removeAttribute('aria-valuemax');
    loadStatus.textContent = 'The story is ready to enter; remaining frames can finish loading as you explore.';
    showEntry();
  }, 12000);
  fall.load(compactMemory ? 4 : 8, (r) => {
    const v = Math.round(r * 100);
    loadPct.textContent = v;
    loadStatus.setAttribute('aria-valuenow', String(v));
    loadFill.style.height = v + '%';
  }).then(() => {
    clearTimeout(loaderFallback);
    if (S.entered) return;
    loadStatus.setAttribute('role', 'progressbar');
    loadStatus.setAttribute('aria-valuemin', '0');
    loadStatus.setAttribute('aria-valuemax', '100');
    loadStatus.innerHTML = '<span id="loadPct">100</span>% of the story loaded';
    showEntry();
  });

  // ---------- main loop ----------
  buildWorld();
  measure();
  addEventListener('resize', () => { clearTimeout(measure.t); measure.t = setTimeout(measure, 120); });
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(measure);
  addEventListener('load', measure);

  let last = performance.now();
  let rafId = 0;
  function loop(now) {
    rafId = 0;
    step(now);
    if (!document.hidden) rafId = requestAnimationFrame(loop);
  }
  function step(now) {
    const dt = Math.min(64, now - last);
    last = now;
    if (lenis) lenis.raf(now);
    const y = window.scrollY;
    S.vel = lerp(S.vel, y - S.y, 0.3);
    S.y = y;
    S.t = now / 1000;
    if (!S.entered) return;
    if (!fine) { S.mx = Math.sin(S.t * 0.4) * 0.35; S.my = Math.cos(S.t * 0.3) * 0.25; }
    S.smx = lerp(S.smx, S.mx, 0.06);
    S.smy = lerp(S.smy, S.my, 0.06);

    updateStory();
    updateWork();
    updateAbout();
    if (archiveFX.visible && !reduce) drawArchiveFX(dt);
    updateMarquee(dt);
    updateServices();
    updatePortal();
    updateHud();
    updateCursor();
    Sound.update();
  }
  function startLoop() {
    if (!rafId && !document.hidden) rafId = requestAnimationFrame(loop);
  }
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) {
      if (rafId) cancelAnimationFrame(rafId);
      rafId = 0;
    } else {
      last = performance.now();
      startLoop();
    }
  });
  startLoop();
})();
