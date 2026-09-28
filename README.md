# gooey

Liquid metaball transitions between any React elements. Lay out plain divs with CSS, and the goo springs after them, stretches with velocity, and pinches off with a wobble.

```bash
npm install @brechtknecht/gooey
```

## Quick start

```tsx
import { Goo, GooItem } from '@brechtknecht/gooey';

function Island({ expanded }: { expanded: boolean }) {
  return (
    <Goo style={{ display: 'flex', alignItems: 'center', gap: 26 }}>
      <GooItem
        fill="#ff3016"
        rim={4.5}
        mergeInto={expanded ? 'island' : null}
        style={{ width: 76, height: 56, borderRadius: 999 }}
      >
        <Icon />
      </GooItem>
      <GooItem name="island" style={{ width: expanded ? 342 : 240, height: 64, borderRadius: 999 }}>
        <Timer />
      </GooItem>
    </Goo>
  );
}
```

Toggle `expanded` and the icon melts into the island; toggle it back and it buds out again.

## How it works

- Every `<GooItem>` is an ordinary div in your layout. Its size and corner radius come from CSS. Its color comes from `fill`.
- Each frame, `<Goo>` measures the items' layout boxes and springs a blob toward each one. It draws the blobs as goo behind your content, then moves each item's element along with its blob.
- Change the layout any way you like: props, class names, media queries, flex, grid. The goo follows.

## Variants

| | `liquid` (default) | `classic` |
| --- | --- | --- |
| Renderer | `field`: sharp edges, exact corners | `blur`: SVG blur + threshold filter |
| Motion | `spring` | `ease` (0.45s ease-in-out, 1:1 drag) |
| Stretch with velocity | 7px | off |
| Sticky necks | on | off |

```tsx
<Goo variant="classic">…</Goo>
<Goo variant="classic" motion="spring">…</Goo> {/* any prop overrides the variant */}
```

## `<Goo>`

A div that accepts every normal div prop, plus:

| Prop | Type | Default | |
| --- | --- | --- | --- |
| `variant` | `'liquid' \| 'classic'` | `'liquid'` | Look-and-feel preset. |
| `renderer` | `'field' \| 'blur'` | from variant | `field` needs WebGL2 and falls back to `blur`. |
| `motion` | `'spring' \| 'ease'` | from variant | |
| `spring` | `{ duration, bounce }` | `{ duration: 0.36, bounce: 0.24 }` | SwiftUI-style spring. |
| `ease` | `{ duration, curve }` | `{ duration: 0.45, curve: [0.42, 0, 0.58, 1] }` | Used when `motion="ease"`. |
| `reach` | `number` | `9` | Gap in px at which shapes start to join. |
| `stretch` | `number \| boolean` | `7` | Stretch along the direction of travel, in px. |
| `sticky` | `boolean` | from variant | Necks cling while shapes pull apart, then pinch off. Field renderer only. |
| `shadow` | `number` | `0.15` | Opacity of the soft shadow under the goo. |
| `timeScale` | `number` | `1` | `0.25` plays everything at quarter speed. |
| `bleed` | `number` | `48` | Extra px drawn around the container so overshoot isn't cut off. |
| `debug` | `boolean` | `false` | Outlines each item's layout box. |
| `reducedMotion` | `'user' \| 'never'` | `'user'` | `user` drops stretch and bounce when the viewer prefers reduced motion. |
| `apiRef` | `Ref<GooApi>` | | See below. |

`GooApi` has `reset()` to send dragged items home, `refresh()` to re-measure after DOM changes React doesn't know about, and `getPeakSpeed()` for the current speed in px/s.

## `<GooItem>`

A div that accepts every normal div prop, plus:

| Prop | Type | Default | |
| --- | --- | --- | --- |
| `name` | `string` | | Lets other items merge into this one. |
| `fill` | `string` | `'#0f0f0f'` | Any CSS color. |
| `radius` | `number` | CSS `border-radius` | Corner radius in px. |
| `rim` | `number` | `0` | Inner outline width in px. |
| `rimColor` | `string` | `'#0f0f0f'` | Rim color. It melts into neighbors of the same color. |
| `mergeInto` | `string \| null` | `null` | Name of an item to melt into. The item leaves the layout flow while merged. |
| `draggable` | `boolean` | `false` | Drag and throw the item. |
| `snapBack` | `boolean` | `false` | Return to the layout on release instead of staying where dropped. |
| `clip` | `boolean` | `true` | Clip the content to the blob's current shape. |

A dropped item stays where it was thrown until its layout box moves, or until `apiRef.current.reset()`.

## Good to know

- `<GooItem>` owns `transform`, `opacity` and `clip-path` on its element. Put your own transforms on an inner element.
- Leave items without a background; the blob is the fill.
- `<Goo>` sets `position: relative` and `isolation: isolate`. Keep the container positioned.
- The field renderer draws up to 16 items per `<Goo>`, and each `<Goo>` uses one WebGL2 context.
- Items nested inside other items aren't supported.
- The components ship with `'use client'`. On the server they render static markup, and the motion starts on mount.

## Playground

The playground is a Vite app in `playground/` that imports the library straight from `src/`.

```bash
npm install
npm run dev
```

Tune the springs, switch variants, and copy the resulting `<Goo>` props from the Props panel.

## Scripts

| Script | |
| --- | --- |
| `npm run dev` | Start the playground. |
| `npm run build` | Build the library into `dist/` (ESM + type declarations). |
| `npm run build:playground` | Build the playground as a static site into `playground/dist/`. |
| `npm test` | Run the unit tests. |
| `npm run typecheck` | Type-check the library, tests and playground. |
