import { clamp } from './geometry.js';

export interface SpringCoeffs {
  /** Stiffness. */
  k: number;
  /** Damping. */
  c: number;
}

/** Converts a SwiftUI-style spring (perceived duration, bounce) into stiffness and damping. */
export function springCoeffs(duration: number, bounce: number): SpringCoeffs {
  const omega = (2 * Math.PI) / Math.max(duration, 0.01);
  return { k: omega * omega, c: 2 * (1 - clamp(bounce, 0, 0.95)) * omega };
}

/** Returns an easing function for a CSS cubic-bezier curve. */
export function cubicBezier(x1: number, y1: number, x2: number, y2: number): (t: number) => number {
  const cx = 3 * x1;
  const bx = 3 * (x2 - x1) - cx;
  const ax = 1 - cx - bx;
  const cy = 3 * y1;
  const by = 3 * (y2 - y1) - cy;
  const ay = 1 - cy - by;
  const x = (u: number) => ((ax * u + bx) * u + cx) * u;
  const y = (u: number) => ((ay * u + by) * u + cy) * u;
  const dx = (u: number) => (3 * ax * u + 2 * bx) * u + cx;
  return (t: number) => {
    let u = t;
    for (let i = 0; i < 8; i++) {
      const err = x(u) - t;
      const slope = dx(u);
      if (Math.abs(err) < 1e-5 || Math.abs(slope) < 1e-6) break;
      u = clamp(u - err / slope, 0, 1);
    }
    return y(u);
  };
}
