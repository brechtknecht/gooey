/** A rounded box described by its center, size and corner radius. */
export interface Shape {
  x: number;
  y: number;
  w: number;
  h: number;
  r: number;
}

/** Row-major 2x2 matrix: [m00, m01, m10, m11]. */
export type Mat2 = [number, number, number, number];

export interface Deform {
  /** Forward matrix, applied to the shape around its center. */
  f: Mat2;
  /** Inverse matrix, used to sample the undeformed distance field. */
  inv: Mat2;
  /** Factor that keeps field distances roughly in pixels after deforming. */
  dist: number;
}

export const IDENTITY: Deform = { f: [1, 0, 0, 1], inv: [1, 0, 0, 1], dist: 1 };

export const clamp = (v: number, lo: number, hi: number): number => (v < lo ? lo : v > hi ? hi : v);

export function smoothstep(edge0: number, edge1: number, x: number): number {
  const t = clamp((x - edge0) / (edge1 - edge0), 0, 1);
  return t * t * (3 - 2 * t);
}

/** Signed distance from a point to a rounded box: negative inside, zero on the edge. */
export function sdRoundBox(px: number, py: number, s: Shape): number {
  const hw = Math.max(s.w, 0) / 2;
  const hh = Math.max(s.h, 0) / 2;
  const r = clamp(s.r, 0, Math.min(hw, hh));
  const qx = Math.abs(px - s.x) - hw + r;
  const qy = Math.abs(py - s.y) - hh + r;
  return Math.min(Math.max(qx, qy), 0) + Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) - r;
}

function closestPoint(px: number, py: number, s: Shape): [number, number] {
  const hw = Math.max(s.w, 0) / 2;
  const hh = Math.max(s.h, 0) / 2;
  const r = clamp(s.r, 0, Math.min(hw, hh));
  const ix = clamp(px, s.x - (hw - r), s.x + (hw - r));
  const iy = clamp(py, s.y - (hh - r), s.y + (hh - r));
  const dx = px - ix;
  const dy = py - iy;
  const len = Math.hypot(dx, dy);
  if (len <= r || len < 1e-6) return [px, py];
  return [ix + (dx / len) * r, iy + (dy / len) * r];
}

/** Edge-to-edge distance between two shapes, 0 when they touch or overlap. */
export function gapBetween(a: Shape, b: Shape): number {
  const [ax, ay] = closestPoint(b.x, b.y, a);
  const [bx, by] = closestPoint(a.x, a.y, b);
  return Math.max(0, Math.min(sdRoundBox(ax, ay, b), sdRoundBox(bx, by, a)));
}

/** How far one shape sits inside the other, in px. Negative when neither contains the other. */
export function containDepth(a: Shape, b: Shape): number {
  const dx = Math.abs(a.x - b.x);
  const dy = Math.abs(a.y - b.y);
  const aw = Math.max(a.w, 0) / 2;
  const ah = Math.max(a.h, 0) / 2;
  const bw = Math.max(b.w, 0) / 2;
  const bh = Math.max(b.h, 0) / 2;
  return Math.max(Math.min(bw - aw - dx, bh - ah - dy), Math.min(aw - bw - dx, ah - bh - dy));
}

/**
 * Turns a deformation tensor into a stretch matrix.
 *
 * The tensor (da, db) is traceless: its angle is the stretch axis and its length is the
 * stretch in px. Springing it through zero flips the axis by 90 degrees, which is what turns
 * a sudden stop into a squash.
 */
export function deformation(da: number, db: number, w: number, h: number): Deform {
  const m = Math.hypot(da, db);
  if (m < 0.05) return IDENTITY;
  const phi = Math.atan2(db, da) / 2;
  const c = Math.cos(phi);
  const s = Math.sin(phi);
  const ww = Math.max(w, 10);
  const hh = Math.max(h, 10);
  const along = Math.abs(c) * ww + Math.abs(s) * hh;
  const across = Math.abs(s) * ww + Math.abs(c) * hh;
  const sa = Math.min(1 + m / along, 1.9);
  const sp = 1 - Math.min(m * 0.42, across * 0.3) / across;
  const cc = c * c;
  const ss = s * s;
  const cs = c * s;
  const isa = 1 / sa;
  const isp = 1 / sp;
  return {
    f: [cc * sa + ss * sp, cs * (sa - sp), cs * (sa - sp), ss * sa + cc * sp],
    inv: [cc * isa + ss * isp, cs * (isa - isp), cs * (isa - isp), ss * isa + cc * isp],
    dist: Math.min(sa, sp),
  };
}
