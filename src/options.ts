/**
 * How the goo is drawn.
 * - `field`: a WebGL distance field. Shapes keep their exact size and corners, edges stay sharp,
 *   and necks can be sticky.
 * - `blur`: the classic SVG blur + threshold filter. Works everywhere, but rounds corners,
 *   shrinks small shapes and softens edges.
 */
export type Renderer = 'field' | 'blur';

/**
 * How shapes travel to their layout position.
 * - `spring`: physical springs that carry velocity, overshoot and settle.
 * - `ease`: a fixed-duration CSS-style tween, and 1:1 dragging.
 */
export type Motion = 'spring' | 'ease';

/**
 * A preset for the look and feel.
 * - `liquid`: distance field, springs, stretch with velocity, sticky necks.
 * - `classic`: blur + threshold filter, eased tweens, no stretch. The widely used CSS/SVG goo.
 */
export type Variant = 'liquid' | 'classic';

export interface SpringConfig {
  /** Perceived duration in seconds, like SwiftUI's `.spring(duration:bounce:)`. */
  duration: number;
  /** 0 settles without overshoot, higher values overshoot and wobble more. */
  bounce: number;
}

export interface EaseConfig {
  /** Tween duration in seconds. */
  duration: number;
  /** Cubic bezier control points, same as CSS `cubic-bezier()`. */
  curve: readonly [number, number, number, number];
}

export interface GooOptions {
  renderer: Renderer;
  motion: Motion;
  spring: SpringConfig;
  ease: EaseConfig;
  reach: number;
  stretch: number;
  sticky: boolean;
  shadow: number;
  timeScale: number;
  bleed: number;
  debug: boolean;
}

type VariantOptions = Pick<GooOptions, 'renderer' | 'motion' | 'stretch' | 'sticky'>;

export const variants = {
  liquid: { renderer: 'field', motion: 'spring', stretch: 7, sticky: true },
  classic: { renderer: 'blur', motion: 'ease', stretch: 0, sticky: false },
} as const satisfies Record<Variant, VariantOptions>;

export const gooDefaults = {
  spring: { duration: 0.36, bounce: 0.24 },
  ease: { duration: 0.45, curve: [0.42, 0, 0.58, 1] },
  reach: 9,
  stretch: 7,
  shadow: 0.15,
  timeScale: 1,
  bleed: 48,
} as const;

export interface GooOptionProps {
  /** Look-and-feel preset. Any prop below overrides it. Defaults to `liquid`. */
  variant?: Variant;
  /** How the goo is drawn. Falls back to `blur` when WebGL2 is unavailable. */
  renderer?: Renderer;
  /** How shapes travel to their layout position. */
  motion?: Motion;
  /** Spring used when `motion` is `spring`. Defaults to `{ duration: 0.36, bounce: 0.24 }`. */
  spring?: Partial<SpringConfig>;
  /** Tween used when `motion` is `ease`. Defaults to 0.45s ease-in-out. */
  ease?: Partial<EaseConfig>;
  /** Gap in px at which two shapes start to join. Defaults to 9. */
  reach?: number;
  /** How far shapes stretch along their direction of travel, in px. `true` is 7, `false` is off. */
  stretch?: number | boolean;
  /** Necks cling while shapes pull apart, then pinch off with a wobble. Field renderer only. */
  sticky?: boolean;
  /** Opacity of the soft drop shadow under the goo, 0 to 1. Defaults to 0.15. */
  shadow?: number;
  /** Playback speed. 0.25 is quarter-speed slow motion. */
  timeScale?: number;
  /** Extra px drawn around the container so overshoot and stretch aren't cut off. Defaults to 48. */
  bleed?: number;
  /** Outlines each item's layout box, the position the goo is chasing. */
  debug?: boolean;
}

export function resolveOptions(props: GooOptionProps, reduceMotion = false): GooOptions {
  const variant = variants[props.variant ?? 'liquid'];
  let stretch =
    props.stretch === true ? gooDefaults.stretch : props.stretch === false ? 0 : (props.stretch ?? variant.stretch);
  let bounce = props.spring?.bounce ?? gooDefaults.spring.bounce;
  if (reduceMotion) {
    stretch = 0;
    bounce = 0;
  }
  return {
    renderer: props.renderer ?? variant.renderer,
    motion: props.motion ?? variant.motion,
    spring: { duration: props.spring?.duration ?? gooDefaults.spring.duration, bounce },
    ease: {
      duration: props.ease?.duration ?? gooDefaults.ease.duration,
      curve: props.ease?.curve ?? gooDefaults.ease.curve,
    },
    reach: Math.max(0, props.reach ?? gooDefaults.reach),
    stretch: Math.max(0, stretch),
    sticky: props.sticky ?? variant.sticky,
    shadow: props.shadow ?? gooDefaults.shadow,
    timeScale: Math.max(0, props.timeScale ?? gooDefaults.timeScale),
    bleed: Math.max(0, props.bleed ?? gooDefaults.bleed),
    debug: props.debug ?? false,
  };
}

export function sameOptions(a: GooOptions, b: GooOptions): boolean {
  return (
    a.renderer === b.renderer &&
    a.motion === b.motion &&
    a.spring.duration === b.spring.duration &&
    a.spring.bounce === b.spring.bounce &&
    a.ease.duration === b.ease.duration &&
    a.ease.curve.every((v, i) => v === b.ease.curve[i]) &&
    a.reach === b.reach &&
    a.stretch === b.stretch &&
    a.sticky === b.sticky &&
    a.shadow === b.shadow &&
    a.timeScale === b.timeScale &&
    a.bleed === b.bleed &&
    a.debug === b.debug
  );
}
