import { describe, expect, it } from 'vitest';
import { IDENTITY, containDepth, deformation, gapBetween, sdRoundBox } from '../src/engine/geometry.js';

describe('sdRoundBox', () => {
  const pill = { x: 0, y: 0, w: 76, h: 56, r: 28 };

  it('is negative inside, zero on the edge and positive outside', () => {
    expect(sdRoundBox(0, 0, pill)).toBeCloseTo(-28);
    expect(sdRoundBox(38, 0, pill)).toBeCloseTo(0);
    expect(sdRoundBox(48, 0, pill)).toBeCloseTo(10);
  });

  it('follows the rounded corner', () => {
    const square = { x: 0, y: 0, w: 64, h: 64, r: 18 };
    const corner = 32 - 18;
    const onArc = corner + 18 / Math.SQRT2;
    expect(sdRoundBox(onArc, onArc, square)).toBeCloseTo(0);
  });
});

describe('gapBetween', () => {
  it('measures the edge-to-edge gap of two pills side by side', () => {
    const icon = { x: 0, y: 0, w: 76, h: 56, r: 28 };
    const island = { x: 38 + 26 + 120, y: 0, w: 240, h: 64, r: 32 };
    expect(gapBetween(icon, island)).toBeCloseTo(26);
  });

  it('measures diagonal circles along their center line', () => {
    const a = { x: 0, y: 0, w: 56, h: 56, r: 28 };
    const b = { x: 60, y: 60, w: 56, h: 56, r: 28 };
    expect(gapBetween(a, b)).toBeCloseTo(Math.hypot(60, 60) - 56);
  });

  it('is zero when shapes overlap', () => {
    const a = { x: 0, y: 0, w: 56, h: 56, r: 28 };
    expect(gapBetween(a, { ...a, x: 20 })).toBe(0);
  });
});

describe('containDepth', () => {
  it('is positive when one shape sits inside the other', () => {
    const host = { x: 0, y: 0, w: 240, h: 64, r: 32 };
    expect(containDepth({ x: 0, y: 0, w: 0, h: 0, r: 0 }, host)).toBe(32);
  });

  it('is negative for shapes side by side', () => {
    const a = { x: 0, y: 0, w: 56, h: 56, r: 28 };
    expect(containDepth(a, { ...a, x: 100 })).toBeLessThan(0);
  });
});

describe('deformation', () => {
  it('is the identity at rest', () => {
    expect(deformation(0, 0, 56, 56)).toBe(IDENTITY);
  });

  it('stretches along the tensor axis and thins across it', () => {
    const d = deformation(20, 0, 56, 56);
    expect(d.f[0]).toBeGreaterThan(1);
    expect(d.f[3]).toBeLessThan(1);
    expect(d.f[1]).toBeCloseTo(0);
  });

  it('flips to the perpendicular axis when the tensor goes negative, so a stop becomes a squash', () => {
    const d = deformation(-20, 0, 56, 56);
    expect(d.f[0]).toBeLessThan(1);
    expect(d.f[3]).toBeGreaterThan(1);
  });

  it('keeps the inverse consistent with the forward matrix', () => {
    const { f, inv } = deformation(14, 9, 120, 48);
    const product = [
      f[0] * inv[0] + f[1] * inv[2],
      f[0] * inv[1] + f[1] * inv[3],
      f[2] * inv[0] + f[3] * inv[2],
      f[2] * inv[1] + f[3] * inv[3],
    ];
    expect(product[0]).toBeCloseTo(1);
    expect(product[1]).toBeCloseTo(0);
    expect(product[2]).toBeCloseTo(0);
    expect(product[3]).toBeCloseTo(1);
  });

  it('stretches long shapes less than small ones for the same speed', () => {
    const small = deformation(20, 0, 56, 56);
    const long = deformation(20, 0, 240, 64);
    expect(long.f[0]).toBeLessThan(small.f[0]);
  });
});
