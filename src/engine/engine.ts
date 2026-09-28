import { parseColor, toCss, type RGB } from './color.js';
import { FieldRenderer, MAX_FIELD_ITEMS } from './field.js';
import { clamp, containDepth, deformation, gapBetween, smoothstep, type Deform, type Shape } from './geometry.js';
import { cubicBezier, springCoeffs } from './motion.js';
import { sameOptions, type GooOptions, type Renderer } from '../options.js';

export interface ItemOptions {
  name: string | undefined;
  fill: string;
  radius: number | undefined;
  rim: number;
  rimColor: string;
  mergeInto: string | null | undefined;
  draggable: boolean;
  snapBack: boolean;
  clip: boolean;
}

export interface EngineDom {
  container: HTMLElement;
  canvas: HTMLCanvasElement;
  blurLayer: HTMLElement;
  debugLayer: HTMLElement;
}

interface Vec {
  x: number;
  y: number;
}

interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

interface Body {
  id: string;
  order: number;
  el: HTMLElement | null;
  opts: ItemOptions;
  fillRGB: RGB;
  rimRGB: RGB;
  cssRadius: { value: number; percent: boolean };
  /** Layout box of the element, center-based, in container coordinates. */
  slot: Rect | null;
  x: number;
  y: number;
  w: number;
  h: number;
  vx: number;
  vy: number;
  vw: number;
  vh: number;
  tx: number;
  ty: number;
  tw: number;
  th: number;
  /** Previous position and the velocity derived from it, used when motion is `ease`. */
  px: number;
  py: number;
  pvx: number;
  pvy: number;
  /** Velocity that drives stretch and necks. */
  ux: number;
  uy: number;
  speed: number;
  /** Deformation tensor, its velocity and its target. */
  da: number;
  db: number;
  vda: number;
  vdb: number;
  dTa: number;
  dTb: number;
  col: RGB;
  rimCur: number;
  /** Content opacity. */
  cop: number;
  z: number;
  override: Vec | null;
  overrideSlot: Rect | null;
  tween: { from: Rect; to: Rect; t0: number } | null;
  twTo: Rect | null;
  host: Body | null;
  /** Where a merged item sits inside its host, -1..1 on each axis. */
  anchor: Vec | null;
  /** Content scales with the blob while it grows in or shrinks away. */
  grow: boolean;
  exiting: boolean;
  placed: boolean;
  blobEl: HTMLDivElement | null;
  debugEl: HTMLDivElement | null;
}

interface Pair {
  a: Body;
  b: Body;
  k: number;
  vk: number;
  kEff: number;
  conn: boolean;
  hold: number;
}

interface Drag {
  body: Body;
  el: HTMLElement;
  pointerId: number;
  ox: number;
  oy: number;
  cursor: string;
  samples: { t: number; x: number; y: number }[];
}

interface Visual {
  body: Body;
  index: number;
  w: number;
  h: number;
  r: number;
  deform: Deform;
}

/** How far a neck can stretch, as a multiple of its resting reach. */
const STICKY = 2.6;
/** Seconds a neck keeps clinging once the shapes stop pulling apart. */
const HOLD_TAU = 0.3;
/** Seconds of release velocity projected into the drop point of a throw. */
const THROW = 0.12;
const SUBSTEP = 1 / 240;
const WOBBLE = springCoeffs(0.3, 0.6);
const NECK = springCoeffs(0.24, 0.15);

const px = (v: number) => `${v.toFixed(2)}px`;
const n4 = (v: number) => v.toFixed(4);

const warned = new Set<string>();
function warnOnce(message: string) {
  if (warned.has(message)) return;
  warned.add(message);
  console.warn(`[gooey] ${message}`);
}

function offsetRect(el: HTMLElement, root: HTMLElement): Rect | null {
  let x = 0;
  let y = 0;
  let node: HTMLElement | null = el;
  while (node && node !== root) {
    x += node.offsetLeft;
    y += node.offsetTop;
    const parent = node.offsetParent as HTMLElement | null;
    if (parent && parent !== root) {
      x += parent.clientLeft - parent.scrollLeft;
      y += parent.clientTop - parent.scrollTop;
    }
    node = parent;
  }
  if (node !== root) return null;
  const w = el.offsetWidth;
  const h = el.offsetHeight;
  return { x: x + w / 2, y: y + h / 2, w, h };
}

const differs = (a: Rect, b: Rect, eps: number) =>
  Math.abs(a.x - b.x) > eps || Math.abs(a.y - b.y) > eps || Math.abs(a.w - b.w) > eps || Math.abs(a.h - b.h) > eps;

function sameItemOptions(a: ItemOptions, b: ItemOptions): boolean {
  return (
    a.name === b.name &&
    a.fill === b.fill &&
    a.radius === b.radius &&
    a.rim === b.rim &&
    a.rimColor === b.rimColor &&
    (a.mergeInto || null) === (b.mergeInto || null) &&
    a.draggable === b.draggable &&
    a.snapBack === b.snapBack &&
    a.clip === b.clip
  );
}

function createBody(id: string, el: HTMLElement, opts: ItemOptions, order: number): Body {
  return {
    id,
    order,
    el,
    opts,
    fillRGB: parseColor(opts.fill),
    rimRGB: parseColor(opts.rimColor),
    cssRadius: { value: 0, percent: false },
    slot: null,
    x: 0, y: 0, w: 0, h: 0,
    vx: 0, vy: 0, vw: 0, vh: 0,
    tx: 0, ty: 0, tw: 0, th: 0,
    px: 0, py: 0, pvx: 0, pvy: 0,
    ux: 0, uy: 0, speed: 0,
    da: 0, db: 0, vda: 0, vdb: 0, dTa: 0, dTb: 0,
    col: [0, 0, 0],
    rimCur: 0,
    cop: 1,
    z: 0,
    override: null,
    overrideSlot: null,
    tween: null,
    twTo: null,
    host: null,
    anchor: null,
    grow: false,
    exiting: false,
    placed: false,
    blobEl: null,
    debugEl: null,
  };
}

/**
 * Drives the goo for one `<Goo>` container. Items are laid out by CSS as usual; every frame the
 * engine measures their layout boxes, springs a blob toward each one, draws the blobs as goo
 * behind the content, and moves each item's element along with its blob using a transform.
 */
export class GooEngine {
  /** Speed of the fastest visible item in px/s, updated every frame. */
  peakSpeed = 0;

  private o: GooOptions;
  private dom: EngineDom | null = null;
  private bodies = new Map<string, Body>();
  private list: Body[] = [];
  private pairs: Pair[] = [];
  private grid: Pair[][] = [];
  private pairMap = new Map<string, Pair>();
  private field: FieldRenderer | null = null;
  private fieldFailed = false;
  private active: Renderer = 'blur';
  private observer: ResizeObserver | null = null;
  private raf = 0;
  private last = 0;
  private simT = 0;
  private awake = 0;
  private order = 0;
  private zSeq = 0;
  private drag: Drag | null = null;
  private width = 0;
  private height = 0;
  private ease: (t: number) => number;
  private easeKey = '';

  constructor(options: GooOptions) {
    this.o = options;
    this.ease = cubicBezier(...options.ease.curve);
    this.easeKey = options.ease.curve.join();
  }

  // ---- Lifecycle, called by the React components ----------------------------

  setOptions(next: GooOptions): void {
    const prev = this.o;
    if (sameOptions(prev, next)) return;
    if (next.motion !== prev.motion) {
      for (const b of this.list) {
        if (next.motion === 'spring') {
          b.vx = b.pvx;
          b.vy = b.pvy;
          b.vw = 0;
          b.vh = 0;
        }
        b.tween = null;
        b.twTo = null;
      }
    }
    const key = next.ease.curve.join();
    if (key !== this.easeKey) {
      this.easeKey = key;
      this.ease = cubicBezier(...next.ease.curve);
    }
    this.o = next;
    if (this.dom) {
      if (next.renderer !== prev.renderer) this.applyRenderer();
      if (next.bleed !== prev.bleed) this.resize();
      if (next.debug !== prev.debug) this.syncDebug();
    }
    this.wake();
  }

  mount(dom: EngineDom): void {
    this.dom = dom;
    this.observer = new ResizeObserver(this.onResize);
    this.observer.observe(dom.container);
    for (const b of this.list) {
      if (!b.el) continue;
      this.observer.observe(b.el);
      this.readCss(b);
    }
    this.applyRenderer();
    this.resize();
    this.syncDebug();
    this.snapAll();
    this.render();
  }

  unmount(): void {
    if (this.raf) cancelAnimationFrame(this.raf);
    this.raf = 0;
    this.endDrag(null);
    this.observer?.disconnect();
    this.observer = null;
    this.dom = null;
  }

  register(id: string, el: HTMLElement, opts: ItemOptions): void {
    let b = this.bodies.get(id);
    if (b) {
      b.el = el;
      b.exiting = false;
      this.applyItemOptions(b, opts);
    } else {
      b = createBody(id, el, opts, this.order++);
      this.bodies.set(id, b);
      this.rebuild();
    }
    this.observer?.observe(el);
    this.readCss(b);
    if (this.dom && !b.placed) this.enter(b);
    this.wake();
  }

  unregister(id: string): void {
    const b = this.bodies.get(id);
    if (!b) return;
    if (this.drag?.body === b) this.endDrag(null);
    if (b.el) this.observer?.unobserve(b.el);
    b.el = null;
    if (!this.dom || !b.placed) {
      this.remove(b);
      return;
    }
    // Keep the blob around as a ghost that shrinks away, then drop it.
    b.exiting = true;
    b.anchor = null;
    b.override = null;
    this.wake();
  }

  update(id: string, opts: ItemOptions): void {
    const b = this.bodies.get(id);
    if (!b) return;
    const changed = !sameItemOptions(b.opts, opts);
    if (changed) this.applyItemOptions(b, opts);
    const radiusChanged = this.readCss(b);
    let moved = false;
    if (this.dom && b.el) {
      const r = offsetRect(b.el, this.dom.container);
      if (r) {
        moved = !b.slot || differs(r, b.slot, 0.5);
        b.slot = r;
      }
    }
    if (changed || radiusChanged || moved) this.wake();
  }

  /** Sends every dragged item back to its layout position. */
  reset(): void {
    for (const b of this.list) b.override = null;
    this.wake();
  }

  /** Runs the frame loop for at least a few frames, re-measuring the layout. */
  wake(): void {
    this.awake = 30;
    if (this.raf || !this.dom) return;
    this.last = performance.now();
    this.raf = requestAnimationFrame(this.step);
  }

  startDrag(id: string, e: PointerEvent): void {
    const b = this.bodies.get(id);
    if (!b || !b.el || !this.dom || this.drag || b.host || b.exiting || !b.opts.draggable) return;
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    e.preventDefault();
    const p = this.local(e);
    try {
      b.el.setPointerCapture(e.pointerId);
    } catch {
      // The pointer may already be gone; the drag still works until pointerup.
    }
    const drag: Drag = {
      body: b,
      el: b.el,
      pointerId: e.pointerId,
      ox: p.x - b.x,
      oy: p.y - b.y,
      cursor: b.el.style.cursor,
      samples: [{ t: e.timeStamp, x: p.x, y: p.y }],
    };
    this.drag = drag;
    b.override = this.clampPos(b, p.x - drag.ox, p.y - drag.oy);
    b.overrideSlot = b.slot ? { ...b.slot } : null;
    b.z = ++this.zSeq;
    b.el.style.zIndex = String(b.z);
    b.el.style.cursor = 'grabbing';
    b.el.addEventListener('pointermove', this.onPointerMove);
    b.el.addEventListener('pointerup', this.onPointerUp);
    b.el.addEventListener('pointercancel', this.onPointerUp);
    b.el.addEventListener('lostpointercapture', this.onPointerUp);
    this.wake();
  }

  // ---- Events -------------------------------------------------------------------

  private onResize = (entries: ResizeObserverEntry[]) => {
    for (const entry of entries) {
      if (entry.target === this.dom?.container) this.resize();
      else {
        const b = this.list.find(item => item.el === entry.target);
        if (b) this.readCss(b);
      }
    }
    this.wake();
  };

  private onPointerMove = (e: PointerEvent) => {
    const d = this.drag;
    if (!d || e.pointerId !== d.pointerId) return;
    const p = this.local(e);
    d.body.override = this.clampPos(d.body, p.x - d.ox, p.y - d.oy);
    d.samples.push({ t: e.timeStamp, x: p.x, y: p.y });
    while (d.samples.length > 2 && e.timeStamp - d.samples[0].t > 90) d.samples.shift();
    this.wake();
  };

  private onPointerUp = (e: PointerEvent) => {
    if (this.drag && e.pointerId === this.drag.pointerId) this.endDrag(e);
  };

  private endDrag(e: PointerEvent | null): void {
    const d = this.drag;
    if (!d) return;
    this.drag = null;
    d.el.removeEventListener('pointermove', this.onPointerMove);
    d.el.removeEventListener('pointerup', this.onPointerUp);
    d.el.removeEventListener('pointercancel', this.onPointerUp);
    d.el.removeEventListener('lostpointercapture', this.onPointerUp);
    d.el.style.cursor = d.cursor;
    const b = d.body;
    let vx = 0;
    let vy = 0;
    const first = d.samples[0];
    const lastSample = d.samples[d.samples.length - 1];
    const span = (lastSample.t - first.t) / 1000;
    if (e && span > 0.008 && e.timeStamp - lastSample.t < 70) {
      vx = (lastSample.x - first.x) / span;
      vy = (lastSample.y - first.y) / span;
    }
    if (b.opts.snapBack) b.override = null;
    else if (this.o.motion === 'spring' && b.override) {
      b.override = this.clampPos(b, b.override.x + vx * THROW, b.override.y + vy * THROW);
    }
    this.wake();
  }

  private local(e: PointerEvent): Vec {
    const c = this.dom!.container;
    const r = c.getBoundingClientRect();
    return { x: e.clientX - r.left - c.clientLeft, y: e.clientY - r.top - c.clientTop };
  }

  private clampPos(b: Body, x: number, y: number): Vec {
    const hw = b.slot ? b.slot.w / 2 : 0;
    const hh = b.slot ? b.slot.h / 2 : 0;
    const m = 4;
    return {
      x: clamp(x, hw + m, Math.max(hw + m, this.width - hw - m)),
      y: clamp(y, hh + m, Math.max(hh + m, this.height - hh - m)),
    };
  }

  // ---- Bookkeeping --------------------------------------------------------------

  private applyItemOptions(b: Body, opts: ItemOptions): void {
    if (opts.fill !== b.opts.fill) b.fillRGB = parseColor(opts.fill);
    if (opts.rimColor !== b.opts.rimColor) b.rimRGB = parseColor(opts.rimColor);
    if ((opts.mergeInto || null) !== (b.opts.mergeInto || null)) b.anchor = null;
    b.opts = opts;
  }

  /** Reads the element's CSS border radius. Returns true when it changed. */
  private readCss(b: Body): boolean {
    if (!b.el || b.opts.radius != null || typeof getComputedStyle === 'undefined') return false;
    const raw = getComputedStyle(b.el).borderTopLeftRadius.split(' ')[0] || '0';
    const value = parseFloat(raw) || 0;
    const percent = raw.endsWith('%');
    const changed = value !== b.cssRadius.value || percent !== b.cssRadius.percent;
    b.cssRadius = { value, percent };
    return changed;
  }

  private rebuild(): void {
    this.list = [...this.bodies.values()].sort((a, b) => a.order - b.order);
    const n = this.list.length;
    const nextMap = new Map<string, Pair>();
    this.pairs = [];
    this.grid = this.list.map(() => new Array<Pair>(n));
    for (let i = 0; i < n; i++) {
      for (let j = i + 1; j < n; j++) {
        const a = this.list[i];
        const b = this.list[j];
        const key = `${a.id}\u0000${b.id}`;
        const k = 2 * this.o.reach;
        const pair = this.pairMap.get(key) ?? { a, b, k, vk: 0, kEff: k, conn: false, hold: 0 };
        nextMap.set(key, pair);
        this.pairs.push(pair);
        this.grid[i][j] = pair;
        this.grid[j][i] = pair;
      }
    }
    this.pairMap = nextMap;
  }

  private remove(b: Body): void {
    this.bodies.delete(b.id);
    b.blobEl?.remove();
    b.debugEl?.remove();
    this.rebuild();
  }

  private resize(): void {
    const dom = this.dom;
    if (!dom) return;
    this.width = dom.container.clientWidth;
    this.height = dom.container.clientHeight;
    const bleed = this.o.bleed;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    this.field?.resize(this.width + 2 * bleed, this.height + 2 * bleed, dpr);
  }

  private applyRenderer(): void {
    const dom = this.dom;
    if (!dom) return;
    let renderer = this.o.renderer;
    if (renderer === 'field' && !this.ensureField()) renderer = 'blur';
    this.active = renderer;
    dom.canvas.style.display = renderer === 'field' ? '' : 'none';
    dom.blurLayer.style.display = renderer === 'blur' ? '' : 'none';
    if (renderer !== 'blur') {
      for (const b of this.list) {
        b.blobEl?.remove();
        b.blobEl = null;
      }
    }
  }

  private ensureField(): boolean {
    if (this.field) return true;
    if (this.fieldFailed || !this.dom) return false;
    this.field = FieldRenderer.create(this.dom.canvas);
    if (!this.field) {
      this.fieldFailed = true;
      warnOnce('WebGL2 is unavailable, so the blur renderer is used instead.');
      return false;
    }
    this.resize();
    return true;
  }

  private syncDebug(): void {
    if (this.o.debug) return;
    for (const b of this.list) {
      b.debugEl?.remove();
      b.debugEl = null;
    }
  }

  // ---- Placement ----------------------------------------------------------------

  private measure(): void {
    const root = this.dom!.container;
    for (const b of this.list) {
      if (!b.el) continue;
      const r = offsetRect(b.el, root);
      if (r) b.slot = r;
      else warnOnce('Could not measure an item. Keep <GooItem> inside the <Goo> container and keep the container positioned.');
    }
  }

  private byName(name: string): Body | null {
    for (const b of this.list) if (b.opts.name === name && !b.exiting) return b;
    return null;
  }

  private resolveHosts(): void {
    for (const b of this.list) {
      b.host = null;
      const target = b.opts.mergeInto;
      if (!target || b.exiting) continue;
      let host = this.byName(target);
      for (let guard = 0; host?.opts.mergeInto && guard < 8; guard++) host = this.byName(host.opts.mergeInto);
      if (host && host !== b) b.host = host;
      else warnOnce(`No <GooItem name="${target}"> to merge into.`);
    }
  }

  private mergeTarget(b: Body): Vec {
    const h = b.host!;
    const a = b.anchor ?? { x: 0, y: 0 };
    const hw = Math.max(h.w, 0) / 2;
    const hh = Math.max(h.h, 0) / 2;
    const inset = Math.min(hw, hh);
    return {
      x: clamp(h.x + a.x * hw, h.x - hw + inset, h.x + hw - inset),
      y: clamp(h.y + a.y * hh, h.y - hh + inset, h.y + hh - inset),
    };
  }

  private place(b: Body, x: number, y: number, w: number, h: number): void {
    b.x = b.px = b.tx = x;
    b.y = b.py = b.ty = y;
    b.w = b.tw = w;
    b.h = b.th = h;
    b.vx = b.vy = b.vw = b.vh = b.pvx = b.pvy = 0;
    b.da = b.db = b.vda = b.vdb = 0;
    const fill = b.host ? b.host.fillRGB : b.fillRGB;
    b.col = [fill[0], fill[1], fill[2]];
    b.rimCur = b.host ? 0 : b.opts.rim;
    b.cop = b.host ? 0 : 1;
    b.tween = null;
    b.twTo = { x, y, w, h };
    b.grow = !!b.host;
    b.placed = true;
  }

  /** Puts every item at rest in its layout position, with no animation. */
  private snapAll(): void {
    this.measure();
    this.resolveHosts();
    for (const b of this.list) {
      if (b.exiting || !b.slot || b.host) continue;
      this.place(b, b.slot.x, b.slot.y, b.slot.w, b.slot.h);
    }
    for (const b of this.list) {
      if (b.exiting || !b.slot || !b.host) continue;
      b.anchor = { x: 0, y: 0 };
      const t = this.mergeTarget(b);
      this.place(b, t.x, t.y, 0, 0);
    }
    for (const p of this.pairs) {
      p.k = p.kEff = 2 * this.o.reach;
      p.vk = 0;
      p.conn = false;
      p.hold = 0;
    }
  }

  /** Grows an item that mounted after the container from nothing. */
  private enter(b: Body): void {
    if (!this.dom || !b.el) return;
    b.slot = offsetRect(b.el, this.dom.container);
    if (!b.slot) return;
    this.resolveHosts();
    if (b.host) {
      b.anchor = { x: 0, y: 0 };
      const t = this.mergeTarget(b);
      this.place(b, t.x, t.y, 0, 0);
    } else {
      this.place(b, b.slot.x, b.slot.y, 0, 0);
      b.cop = 0;
      b.grow = true;
    }
  }

  // ---- Frame loop ---------------------------------------------------------------

  private step = (now: number): void => {
    this.raf = 0;
    if (!this.dom) return;
    let dt = clamp((now - this.last) / 1000, 0, 1 / 24);
    this.last = now;
    dt *= this.o.timeScale;
    this.simT += dt;

    this.measure();
    this.resolveHosts();
    for (const b of this.list) if (!b.placed && b.slot && b.el) this.enter(b);
    this.computeTargets();
    this.integrate(dt);
    this.updateNecks(dt);
    this.render();
    this.sweep();

    if (this.energy() > 0.03 || this.drag || this.awake > 0) {
      if (this.awake > 0) this.awake--;
      this.raf = requestAnimationFrame(this.step);
    } else {
      this.peakSpeed = 0;
    }
  };

  private computeTargets(): void {
    for (const b of this.list) {
      if (!b.placed) continue;
      if (b.exiting) {
        b.tx = b.x;
        b.ty = b.y;
        b.tw = 0;
        b.th = 0;
        b.grow = true;
        continue;
      }
      if (!b.slot) continue;
      if (b.host) {
        const h = b.host;
        if (!b.anchor) {
          b.anchor = {
            x: clamp((b.x - h.x) / Math.max(h.w / 2, 1), -1, 1),
            y: clamp((b.y - h.y) / Math.max(h.h / 2, 1), -1, 1),
          };
        }
        const t = this.mergeTarget(b);
        b.tx = t.x;
        b.ty = t.y;
        b.tw = 0;
        b.th = 0;
        b.grow = true;
        b.override = null;
      } else {
        b.anchor = null;
        // A layout change takes back control from a dropped item.
        if (b.override && this.drag?.body !== b && b.overrideSlot && differs(b.slot, b.overrideSlot, 1)) {
          b.override = null;
        }
        b.tx = b.override ? b.override.x : b.slot.x;
        b.ty = b.override ? b.override.y : b.slot.y;
        b.tw = b.slot.w;
        b.th = b.slot.h;
      }
    }
  }

  private stepEase(b: Body): void {
    const t: Rect = { x: b.tx, y: b.ty, w: b.tw, h: b.th };
    if (this.drag?.body === b) {
      b.x = t.x;
      b.y = t.y;
      b.w = t.w;
      b.h = t.h;
      b.tween = null;
      b.twTo = t;
      return;
    }
    if (!b.twTo || differs(b.twTo, t, 0.5)) {
      b.tween = { from: { x: b.x, y: b.y, w: b.w, h: b.h }, to: t, t0: this.simT };
      b.twTo = t;
    }
    if (!b.tween) {
      b.x = t.x;
      b.y = t.y;
      b.w = t.w;
      b.h = t.h;
      return;
    }
    const u = clamp((this.simT - b.tween.t0) / Math.max(this.o.ease.duration, 0.001), 0, 1);
    const e = this.ease(u);
    const { from, to } = b.tween;
    b.x = from.x + (to.x - from.x) * e;
    b.y = from.y + (to.y - from.y) * e;
    b.w = from.w + (to.w - from.w) * e;
    b.h = from.h + (to.h - from.h) * e;
    if (u >= 1) b.tween = null;
  }

  private integrate(dt: number): void {
    const o = this.o;
    const list = this.list;
    const steps = Math.max(1, Math.ceil(dt / SUBSTEP));
    const h = dt / steps;

    if (o.motion === 'spring') {
      const main = springCoeffs(o.spring.duration, o.spring.bounce);
      const grab = springCoeffs(o.spring.duration * 0.45, o.spring.bounce);
      for (let s = 0; s < steps; s++) {
        for (const b of list) {
          if (!b.placed) continue;
          const sp = this.drag?.body === b ? grab : main;
          b.vx += (-sp.k * (b.x - b.tx) - sp.c * b.vx) * h;
          b.x += b.vx * h;
          b.vy += (-sp.k * (b.y - b.ty) - sp.c * b.vy) * h;
          b.y += b.vy * h;
          b.vw += (-main.k * (b.w - b.tw) - main.c * b.vw) * h;
          b.w += b.vw * h;
          b.vh += (-main.k * (b.h - b.th) - main.c * b.vh) * h;
          b.h += b.vh * h;
        }
      }
    } else {
      for (const b of list) if (b.placed) this.stepEase(b);
    }

    // Velocity sets the stretch target: longer along the direction of travel, thinner across it.
    const smoothing = 1 - Math.exp(-dt * 30);
    for (const b of list) {
      if (!b.placed) continue;
      if (dt > 0) {
        b.pvx += ((b.x - b.px) / dt - b.pvx) * smoothing;
        b.pvy += ((b.y - b.py) / dt - b.pvy) * smoothing;
      }
      b.px = b.x;
      b.py = b.y;
      b.ux = o.motion === 'spring' ? b.vx : b.pvx;
      b.uy = o.motion === 'spring' ? b.vy : b.pvy;
      b.speed = Math.hypot(b.ux, b.uy);
      b.dTa = 0;
      b.dTb = 0;
      if (o.stretch > 0 && b.speed > 1) {
        const amount = o.stretch * (1 - Math.exp(-b.speed / 750));
        const angle = Math.atan2(b.uy, b.ux);
        b.dTa = amount * Math.cos(2 * angle);
        b.dTb = amount * Math.sin(2 * angle);
      }
    }
    for (let s = 0; s < steps; s++) {
      for (const b of list) {
        b.vda += (-WOBBLE.k * (b.da - b.dTa) - WOBBLE.c * b.vda) * h;
        b.da += b.vda * h;
        b.vdb += (-WOBBLE.k * (b.db - b.dTb) - WOBBLE.c * b.vdb) * h;
        b.db += b.vdb * h;
      }
    }

    const fade = 1 - Math.exp(-dt * 9);
    let peak = 0;
    for (const b of list) {
      if (!b.placed) continue;
      const fill = b.host ? b.host.fillRGB : b.fillRGB;
      for (let c = 0; c < 3; c++) b.col[c] += (fill[c] - b.col[c]) * fade;
      b.rimCur += ((b.host ? 0 : b.opts.rim) - b.rimCur) * fade;
      const hidden = b.host !== null || b.exiting;
      b.cop += ((hidden ? 0 : 1) - b.cop) * (1 - Math.exp(-dt * (hidden ? 16 : 7)));
      if (b.grow && !hidden && b.slot && b.w >= b.slot.w * 0.995 && b.h >= b.slot.h * 0.995) b.grow = false;
      if (!hidden) peak = Math.max(peak, b.speed);
    }
    this.peakSpeed = peak;
  }

  private shape(b: Body): Shape {
    const w = Math.max(b.w, 0);
    const h = Math.max(b.h, 0);
    return { x: b.x, y: b.y, w, h, r: this.radiusOf(b, w, h) };
  }

  private radiusOf(b: Body, w: number, h: number): number {
    const half = Math.max(0, Math.min(w, h)) / 2;
    const slotMin = b.slot ? Math.min(b.slot.w, b.slot.h) : 0;
    const scale = slotMin > 0 ? Math.min(1, (2 * half) / slotMin) : 1;
    let r: number;
    if (b.opts.radius != null) r = b.opts.radius * scale;
    else if (b.cssRadius.percent) r = (b.cssRadius.value / 100) * 2 * half;
    else r = b.cssRadius.value * scale;
    return clamp(r, 0, half);
  }

  /** Decides how far each pair of shapes blends, with hysteresis when necks are sticky. */
  private updateNecks(dt: number): void {
    const o = this.o;
    const kBase = 2 * o.reach;
    const kSticky = kBase * STICKY;
    const sticky = o.sticky && this.active === 'field';
    const steps = Math.max(1, Math.ceil(dt / SUBSTEP));
    const h = dt / steps;
    for (const p of this.pairs) {
      const A = p.a;
      const B = p.b;
      if (!A.placed || !B.placed) {
        p.kEff = 0;
        continue;
      }
      const sa = this.shape(A);
      const sb = this.shape(B);
      const gap = gapBetween(sa, sb);
      const depth = containDepth(sa, sb);
      if (sticky) {
        if (!p.conn && gap < o.reach * 0.85) {
          p.conn = true;
          p.hold = 1;
        }
        if (p.conn) {
          const dx = B.x - A.x;
          const dy = B.y - A.y;
          const len = Math.hypot(dx, dy) || 1;
          const separating = ((B.ux - A.ux) * dx + (B.uy - A.uy) * dy) / len;
          p.hold = Math.max(p.hold * Math.exp(-dt / HOLD_TAU), clamp(separating / 450, 0, 1));
          if (gap > Math.max(p.k * 0.49, o.reach)) {
            p.conn = false;
            this.kick(A, B, clamp((p.k - kBase) / (kSticky - kBase), 0.25, 1));
          }
        }
      } else {
        p.conn = false;
        p.hold = 0;
      }
      const target = p.conn ? kBase + (kSticky - kBase) * p.hold : kBase;
      for (let s = 0; s < steps; s++) {
        p.vk += (-NECK.k * (p.k - target) - NECK.c * p.vk) * h;
        p.k += p.vk * h;
      }
      const k = Math.max(p.k, 0);
      // Pairs too far apart to touch are skipped by the shader; shapes deep inside another stop bulging it.
      p.kEff = gap > k * 1.5 ? 0 : k * (1 - smoothstep(4, 26, depth));
    }
  }

  /** When a neck pinches off, both shapes recoil into a squash along the neck. */
  private kick(a: Body, b: Body, strength: number): void {
    if (this.o.stretch <= 0) return;
    const angle = Math.atan2(b.y - a.y, b.x - a.x);
    const c2 = Math.cos(2 * angle);
    const s2 = Math.sin(2 * angle);
    for (const body of [a, b]) {
      const size = Math.min(body.w, body.h);
      if (size < 8) continue;
      const impulse = 320 * strength * clamp(56 / size, 0.45, 1.25) * (this.o.stretch / 28);
      body.vda -= impulse * c2;
      body.vdb -= impulse * s2;
    }
  }

  private sweep(): void {
    const gone = this.list.filter(b => b.exiting && b.w < 0.5 && b.h < 0.5);
    for (const b of gone) this.remove(b);
  }

  private energy(): number {
    let e = 0;
    for (const b of this.list) {
      if (!b.placed) continue;
      e += Math.abs(b.vx) + Math.abs(b.vy) + Math.abs(b.vw) + Math.abs(b.vh) + Math.abs(b.vda) + Math.abs(b.vdb);
      e += Math.abs(b.x - b.tx) + Math.abs(b.y - b.ty) + Math.abs(b.w - b.tw) + Math.abs(b.h - b.th);
      e += Math.abs(b.da) + Math.abs(b.db) + (b.tween ? 1 : 0);
      const fill = b.host ? b.host.fillRGB : b.fillRGB;
      e += (Math.abs(fill[0] - b.col[0]) + Math.abs(fill[1] - b.col[1]) + Math.abs(fill[2] - b.col[2])) * 10;
      e += Math.abs(b.cop - (b.host || b.exiting ? 0 : 1)) * 10;
    }
    for (const p of this.pairs) e += Math.abs(p.vk);
    return e;
  }

  // ---- Drawing ------------------------------------------------------------------

  private render(): void {
    if (!this.dom) return;
    const visuals: Visual[] = [];
    this.list.forEach((body, index) => {
      if (!body.placed) return;
      const w = Math.max(body.w, 0);
      const h = Math.max(body.h, 0);
      visuals.push({ body, index, w, h, r: this.radiusOf(body, w, h), deform: deformation(body.da, body.db, w, h) });
    });
    if (this.active === 'field' && this.field) this.drawField(visuals);
    else this.drawBlur(visuals);
    this.drawItems(visuals);
    if (this.o.debug) this.drawDebug();
  }

  private drawField(visuals: Visual[]): void {
    const f = this.field!;
    if (visuals.length > MAX_FIELD_ITEMS) {
      warnOnce(`The field renderer draws up to ${MAX_FIELD_ITEMS} items per <Goo>; the rest are skipped.`);
    }
    const n = Math.min(visuals.length, MAX_FIELD_ITEMS);
    for (let i = 0; i < n; i++) {
      const { body: b, w, h, r, deform } = visuals[i];
      const o4 = i * 4;
      const o3 = i * 3;
      f.box[o4] = b.x;
      f.box[o4 + 1] = b.y;
      f.box[o4 + 2] = w / 2;
      f.box[o4 + 3] = h / 2;
      f.mat.set(deform.inv, o4);
      f.extra[o4] = r;
      f.extra[o4 + 1] = deform.dist;
      f.extra[o4 + 2] = b.rimCur;
      f.extra[o4 + 3] = 0;
      f.fill.set(b.col, o3);
      f.rim.set(b.rimRGB, o3);
    }
    let idx = 0;
    for (let i = 0; i < n; i++) {
      for (let j = i + 1; j < n; j++) f.k[idx++] = this.grid[visuals[i].index][visuals[j].index].kEff;
    }
    f.draw(n, this.o.bleed, this.o.shadow);
  }

  private drawBlur(visuals: Visual[]): void {
    const layer = this.dom!.blurLayer;
    const bleed = this.o.bleed;
    for (const { body: b, w, h, r, deform } of visuals) {
      let el = b.blobEl;
      if (!el) {
        el = document.createElement('div');
        el.style.cssText = 'position:absolute;left:0;top:0;transform-origin:50% 50%;will-change:transform';
        layer.appendChild(el);
        b.blobEl = el;
      }
      const f = deform.f;
      el.style.width = px(w);
      el.style.height = px(h);
      el.style.borderRadius = px(r);
      el.style.transform = `translate(${px(b.x - w / 2 + bleed)},${px(b.y - h / 2 + bleed)}) matrix(${n4(f[0])},${n4(f[2])},${n4(f[1])},${n4(f[3])},0,0)`;
      el.style.background = toCss(b.col);
      el.style.boxShadow = b.rimCur > 0.3 ? `inset 0 0 0 ${px(b.rimCur)} ${toCss(b.rimRGB)}` : 'none';
      el.style.zIndex = String(b.z);
    }
  }

  /** Moves each item's element with its blob, so content rides along with the goo. */
  private drawItems(visuals: Visual[]): void {
    for (const { body: b, w, h, r, deform } of visuals) {
      const el = b.el;
      const slot = b.slot;
      if (!el || !slot) continue;
      const ratio = clamp(Math.min(w / Math.max(slot.w, 1), h / Math.max(slot.h, 1)), 0, 1);
      const s = b.grow ? ratio : 1;
      // Content takes half the stretch so it feels attached without smearing.
      const f = deform.f;
      const g0 = 1 + (f[0] - 1) / 2;
      const g1 = f[1] / 2;
      const g3 = 1 + (f[3] - 1) / 2;
      el.style.transform = `translate(${px(b.x - slot.x)},${px(b.y - slot.y)}) matrix(${n4(g0)},${n4(g1)},${n4(g1)},${n4(g3)},0,0) scale(${n4(s)})`;
      const opacity = b.cop * (b.grow ? smoothstep(0.25, 0.7, ratio) : 1);
      el.style.opacity = opacity > 0.999 ? '' : opacity.toFixed(3);
      if (b.opts.clip && s > 0.001) {
        const insetX = Math.max(0, (slot.w - w / s) / 2);
        const insetY = Math.max(0, (slot.h - h / s) / 2);
        el.style.clipPath = `inset(${px(insetY)} ${px(insetX)} round ${px(r / s)})`;
      } else {
        el.style.clipPath = '';
      }
    }
  }

  private drawDebug(): void {
    const layer = this.dom!.debugLayer;
    for (const b of this.list) {
      const slot = b.slot;
      if (!b.el || !slot || b.host || b.exiting) {
        if (b.debugEl) b.debugEl.style.display = 'none';
        continue;
      }
      let el = b.debugEl;
      if (!el) {
        el = document.createElement('div');
        el.style.cssText = 'position:absolute;left:0;top:0;box-sizing:border-box;border:1.5px dashed #2d6bff';
        layer.appendChild(el);
        b.debugEl = el;
      }
      el.style.display = '';
      el.style.width = px(slot.w);
      el.style.height = px(slot.h);
      el.style.borderRadius = px(this.radiusOf(b, slot.w, slot.h));
      el.style.transform = `translate(${px(slot.x - slot.w / 2)},${px(slot.y - slot.h / 2)})`;
    }
  }
}
