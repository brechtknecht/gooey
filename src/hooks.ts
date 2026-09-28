import { createContext, useEffect, useLayoutEffect, useSyncExternalStore, type Ref } from 'react';
import type { GooEngine } from './engine/engine.js';

export const GooContext = createContext<GooEngine | null>(null);

export const useIsoLayoutEffect = typeof window === 'undefined' ? useEffect : useLayoutEffect;

const REDUCED_MOTION = '(prefers-reduced-motion: reduce)';

function subscribeReducedMotion(onChange: () => void): () => void {
  if (typeof window === 'undefined' || !window.matchMedia) return () => {};
  const query = window.matchMedia(REDUCED_MOTION);
  query.addEventListener('change', onChange);
  return () => query.removeEventListener('change', onChange);
}

export function usePrefersReducedMotion(): boolean {
  return useSyncExternalStore(
    subscribeReducedMotion,
    () => typeof window !== 'undefined' && !!window.matchMedia?.(REDUCED_MOTION).matches,
    () => false,
  );
}

export function assignRef<T>(ref: Ref<T> | undefined, value: T): void {
  if (typeof ref === 'function') ref(value);
  else if (ref) (ref as { current: T }).current = value;
}
