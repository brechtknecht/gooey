import { describe, expect, it } from 'vitest';
import { cubicBezier, springCoeffs } from '../src/engine/motion.js';

function simulate(duration: number, bounce: number, seconds: number) {
  const { k, c } = springCoeffs(duration, bounce);
  const h = 1 / 240;
  let x = 0;
  let v = 0;
  let peak = 0;
  for (let t = 0; t < seconds; t += h) {
    v += (-k * (x - 1) - c * v) * h;
    x += v * h;
    peak = Math.max(peak, x);
  }
  return { x, peak };
}

describe('springCoeffs', () => {
  it('settles on the target', () => {
    expect(simulate(0.36, 0.24, 2).x).toBeCloseTo(1, 3);
  });

  it('does not overshoot without bounce', () => {
    expect(simulate(0.36, 0, 2).peak).toBeLessThanOrEqual(1.0001);
  });

  it('overshoots more as bounce grows', () => {
    const low = simulate(0.36, 0.1, 2).peak;
    const high = simulate(0.36, 0.5, 2).peak;
    expect(low).toBeGreaterThan(1);
    expect(high).toBeGreaterThan(low);
  });
});

describe('cubicBezier', () => {
  const easeInOut = cubicBezier(0.42, 0, 0.58, 1);

  it('starts at 0 and ends at 1', () => {
    expect(easeInOut(0)).toBeCloseTo(0);
    expect(easeInOut(1)).toBeCloseTo(1);
  });

  it('is symmetric around the midpoint', () => {
    expect(easeInOut(0.5)).toBeCloseTo(0.5);
    expect(easeInOut(0.25) + easeInOut(0.75)).toBeCloseTo(1);
  });
});
