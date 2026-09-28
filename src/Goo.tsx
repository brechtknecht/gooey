'use client';

import {
  forwardRef,
  useCallback,
  useId,
  useImperativeHandle,
  useRef,
  useState,
  type HTMLAttributes,
  type Ref,
} from 'react';
import { GooEngine } from './engine/engine.js';
import { GooContext, assignRef, useIsoLayoutEffect, usePrefersReducedMotion } from './hooks.js';
import { resolveOptions, type GooOptionProps } from './options.js';

export interface GooApi {
  /** Sends every dragged item back to its place in the layout. */
  reset(): void;
  /** Re-measures the layout. Only needed after DOM changes React doesn't know about. */
  refresh(): void;
  /** Speed of the fastest visible item, in px/s. */
  getPeakSpeed(): number;
}

export interface GooProps extends GooOptionProps, HTMLAttributes<HTMLDivElement> {
  /**
   * `user` (default) drops the stretch and bounce when the viewer asks for reduced motion.
   * `never` always plays the full motion.
   */
  reducedMotion?: 'user' | 'never';
  /** Imperative handle for resetting drags and reading the current speed. */
  apiRef?: Ref<GooApi>;
}

/**
 * A container whose `<GooItem>` children melt into each other. Lay the items out with any CSS
 * you like; the goo springs after their layout boxes.
 */
export const Goo = forwardRef<HTMLDivElement, GooProps>(function Goo(props, ref) {
  const {
    variant,
    renderer,
    motion,
    spring,
    ease,
    reach,
    stretch,
    sticky,
    shadow,
    timeScale,
    bleed,
    debug,
    reducedMotion = 'user',
    apiRef,
    style,
    children,
    ...rest
  } = props;
  const prefersReduced = usePrefersReducedMotion();
  const options = resolveOptions(
    { variant, renderer, motion, spring, ease, reach, stretch, sticky, shadow, timeScale, bleed, debug },
    reducedMotion === 'user' && prefersReduced,
  );
  const [engine] = useState(() => new GooEngine(options));
  const containerRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const blurRef = useRef<HTMLDivElement>(null);
  const debugRef = useRef<HTMLDivElement>(null);
  const filterId = `goo-${useId().replace(/[^\w-]/g, '')}`;

  useIsoLayoutEffect(() => {
    engine.setOptions(options);
  });

  useIsoLayoutEffect(() => {
    engine.mount({
      container: containerRef.current!,
      canvas: canvasRef.current!,
      blurLayer: blurRef.current!,
      debugLayer: debugRef.current!,
    });
    return () => engine.unmount();
  }, [engine]);

  useImperativeHandle(
    apiRef,
    () => ({
      reset: () => engine.reset(),
      refresh: () => engine.wake(),
      getPeakSpeed: () => engine.peakSpeed,
    }),
    [engine],
  );

  const setRef = useCallback(
    (node: HTMLDivElement | null) => {
      containerRef.current = node;
      assignRef(ref, node);
    },
    [ref],
  );

  const dropShadow = options.shadow > 0 ? ` drop-shadow(0 6px 8px rgba(0,0,0,${options.shadow}))` : '';

  return (
    <GooContext.Provider value={engine}>
      <div {...rest} ref={setRef} data-goo="" style={{ position: 'relative', isolation: 'isolate', ...style }}>
        <div
          aria-hidden="true"
          style={{ position: 'absolute', inset: -options.bleed, zIndex: -1, pointerEvents: 'none' }}
        >
          <canvas ref={canvasRef} style={{ position: 'absolute', inset: 0, width: '100%', height: '100%' }} />
          <div ref={blurRef} style={{ position: 'absolute', inset: 0, filter: `url(#${filterId})${dropShadow}` }} />
          <svg width="0" height="0" focusable="false" style={{ position: 'absolute' }}>
            <filter id={filterId} x="-10%" y="-10%" width="120%" height="120%" colorInterpolationFilters="sRGB">
              <feGaussianBlur in="SourceGraphic" stdDeviation={options.reach * 0.75} />
              <feColorMatrix mode="matrix" values="1 0 0 0 0  0 1 0 0 0  0 0 1 0 0  0 0 0 25 -15" />
            </filter>
          </svg>
        </div>
        {children}
        <div
          ref={debugRef}
          aria-hidden="true"
          style={{ position: 'absolute', inset: 0, zIndex: 2147483000, pointerEvents: 'none' }}
        />
      </div>
    </GooContext.Provider>
  );
});
