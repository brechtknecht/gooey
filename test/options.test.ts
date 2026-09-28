import { describe, expect, it } from 'vitest';
import { resolveOptions, sameOptions, variants } from '../src/options.js';

describe('resolveOptions', () => {
  it('defaults to the liquid variant with the tuned spring', () => {
    const o = resolveOptions({});
    expect(o.renderer).toBe('field');
    expect(o.motion).toBe('spring');
    expect(o.spring).toEqual({ duration: 0.36, bounce: 0.24 });
    expect(o.reach).toBe(9);
    expect(o.stretch).toBe(7);
    expect(o.sticky).toBe(true);
  });

  it('switches everything for the classic variant', () => {
    const o = resolveOptions({ variant: 'classic' });
    expect(o).toMatchObject(variants.classic);
  });

  it('lets single props override the variant', () => {
    const o = resolveOptions({ variant: 'classic', motion: 'spring', stretch: true });
    expect(o.renderer).toBe('blur');
    expect(o.motion).toBe('spring');
    expect(o.stretch).toBe(7);
  });

  it('turns stretch off with false', () => {
    expect(resolveOptions({ stretch: false }).stretch).toBe(0);
  });

  it('drops stretch and bounce for reduced motion', () => {
    const o = resolveOptions({ stretch: 20, spring: { bounce: 0.5 } }, true);
    expect(o.stretch).toBe(0);
    expect(o.spring.bounce).toBe(0);
  });
});

describe('sameOptions', () => {
  it('compares nested spring settings', () => {
    const a = resolveOptions({});
    expect(sameOptions(a, resolveOptions({}))).toBe(true);
    expect(sameOptions(a, resolveOptions({ spring: { duration: 0.5 } }))).toBe(false);
  });
});
