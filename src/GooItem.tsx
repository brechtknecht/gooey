'use client';

import {
  forwardRef,
  useCallback,
  useContext,
  useId,
  useRef,
  type CSSProperties,
  type HTMLAttributes,
  type PointerEvent,
} from 'react';
import type { ItemOptions } from './engine/engine.js';
import { GooContext, assignRef, useIsoLayoutEffect } from './hooks.js';

export interface GooItemProps extends Omit<HTMLAttributes<HTMLDivElement>, 'draggable'> {
  /** Lets other items merge into this one with `mergeInto`. */
  name?: string;
  /** Color of the blob. Any CSS color. Defaults to `#0f0f0f`. */
  fill?: string;
  /** Corner radius in px. Defaults to the element's CSS `border-radius`. */
  radius?: number;
  /** Width of an inner outline in px, drawn in `rimColor`. It melts into neighbors of that color. */
  rim?: number;
  /** Color of the rim. Defaults to `#0f0f0f`. */
  rimColor?: string;
  /**
   * Name of another item to melt into. The item leaves the layout flow, shrinks into the host
   * and takes its color. Clear it to bud back out.
   */
  mergeInto?: string | null;
  /** Lets the viewer drag and throw the item. */
  draggable?: boolean;
  /** Springs a dragged item back to its layout position on release instead of leaving it where it was dropped. */
  snapBack?: boolean;
  /** Clips the content to the blob's current shape. Defaults to true. */
  clip?: boolean;
}

/**
 * One shape in a `<Goo>`. Size and place it with normal CSS; set its color with `fill`.
 * Its children ride along with the blob.
 */
export const GooItem = forwardRef<HTMLDivElement, GooItemProps>(function GooItem(props, ref) {
  const {
    name,
    fill = '#0f0f0f',
    radius,
    rim = 0,
    rimColor = '#0f0f0f',
    mergeInto = null,
    draggable = false,
    snapBack = false,
    clip = true,
    style,
    onPointerDown,
    children,
    ...rest
  } = props;
  const engine = useContext(GooContext);
  if (!engine) throw new Error('<GooItem> has to be rendered inside <Goo>.');
  const id = useId();
  const elRef = useRef<HTMLDivElement | null>(null);
  const options: ItemOptions = { name, fill, radius, rim, rimColor, mergeInto, draggable, snapBack, clip };

  useIsoLayoutEffect(() => {
    engine.register(id, elRef.current!, options);
    return () => engine.unregister(id);
    // Later changes go through update() below.
  }, [engine, id]);

  useIsoLayoutEffect(() => {
    engine.update(id, options);
  });

  const setRef = useCallback(
    (node: HTMLDivElement | null) => {
      elRef.current = node;
      assignRef(ref, node);
    },
    [ref],
  );

  const handlePointerDown = (e: PointerEvent<HTMLDivElement>) => {
    onPointerDown?.(e);
    if (draggable && !e.defaultPrevented) engine.startDrag(id, e.nativeEvent);
  };

  const merged = mergeInto != null && mergeInto !== '';
  const itemStyle: CSSProperties = {
    ...(draggable && { touchAction: 'none', cursor: 'grab' }),
    ...style,
    ...(merged && { position: 'absolute', pointerEvents: 'none' }),
  };

  return (
    <div {...rest} ref={setRef} data-goo-item="" style={itemStyle} onPointerDown={handlePointerDown}>
      {children}
    </div>
  );
});
