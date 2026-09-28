import { useEffect, useRef, useState, type RefObject } from 'react';
import {
  Goo,
  GooItem,
  gooDefaults,
  variants,
  type GooApi,
  type Motion,
  type Renderer,
  type Variant,
} from '@brechtknecht/gooey';

type Layout = 'split' | 'merged' | 'row' | 'cluster' | 'scatter';

const LAYOUTS: { id: Layout; label: string }[] = [
  { id: 'split', label: 'Split' },
  { id: 'merged', label: 'Merged' },
  { id: 'row', label: 'Row' },
  { id: 'cluster', label: 'Cluster' },
  { id: 'scatter', label: 'Scatter' },
];

// Items the island swallows in each layout.
const SWALLOWED: Record<Layout, readonly string[]> = {
  split: ['dot', 'tile', 'bead'],
  merged: ['icon', 'dot', 'tile', 'bead'],
  row: [],
  cluster: [],
  scatter: [],
};

// Shape sizes in the scatter layout; they match styles.css.
const SIZES: Record<string, [number, number]> = {
  icon: [76, 56],
  island: [180, 64],
  dot: [56, 56],
  tile: [64, 64],
  bead: [36, 36],
};

const VARIANT_INFO: Record<Variant, { title: string; key: string; summary: string }> = {
  liquid: { title: 'Liquid', key: 'L', summary: 'Distance field, springs, stretch, sticky necks' },
  classic: { title: 'Classic', key: 'C', summary: 'Blur + threshold, CSS ease, 1:1 drag' },
};

const playIntro =
  typeof window !== 'undefined' && !window.matchMedia('(prefers-reduced-motion: reduce)').matches;

interface Spot {
  x: number;
  y: number;
}

function scatter(stage: HTMLElement | null): Record<string, Spot> {
  if (!stage) return {};
  const width = stage.clientWidth;
  const height = stage.clientHeight;
  const pad = 16;
  const placed: { x: number; y: number; w: number; h: number }[] = [];
  const spots: Record<string, Spot> = {};
  for (const [name, [baseW, h]] of Object.entries(SIZES)) {
    const w = name === 'island' ? Math.min(baseW, width * 0.5) : baseW;
    let best = { x: pad, y: pad, w, h };
    let bestGap = -1;
    for (let attempt = 0; attempt < 80; attempt++) {
      const x = pad + Math.random() * Math.max(1, width - w - 2 * pad);
      const y = pad + Math.random() * Math.max(1, height - h - 2 * pad);
      let gap = Infinity;
      for (const p of placed) {
        const gx = Math.max(p.x - (x + w), x - (p.x + p.w), 0);
        const gy = Math.max(p.y - (y + h), y - (p.y + p.h), 0);
        gap = Math.min(gap, Math.hypot(gx, gy));
      }
      if (gap > bestGap) {
        bestGap = gap;
        best = { x, y, w, h };
      }
      if (gap > 36 && gap < 120) break;
    }
    placed.push(best);
    spots[name] = { x: Math.round(best.x), y: Math.round(best.y) };
  }
  return spots;
}

interface Settings {
  renderer: Renderer;
  motion: Motion;
  stretch: number;
  sticky: boolean;
  duration: number;
  bounce: number;
  reach: number;
}

/** The smallest set of `<Goo>` props that reproduces the current settings. */
function propsSnippet(s: Settings): string {
  const base: Variant = s.renderer === 'blur' && s.motion === 'ease' ? 'classic' : 'liquid';
  const v = variants[base];
  const props: string[] = [];
  if (base === 'classic') props.push('variant="classic"');
  if (s.renderer !== v.renderer) props.push(`renderer="${s.renderer}"`);
  if (s.motion !== v.motion) props.push(`motion="${s.motion}"`);
  if (s.stretch !== v.stretch) props.push(s.stretch === 0 ? 'stretch={false}' : `stretch={${s.stretch}}`);
  if (s.sticky !== v.sticky) props.push(`sticky={${s.sticky}}`);
  if (s.motion === 'spring' && (s.duration !== gooDefaults.spring.duration || s.bounce !== gooDefaults.spring.bounce)) {
    props.push(`spring={{ duration: ${s.duration}, bounce: ${s.bounce} }}`);
  }
  if (s.reach !== gooDefaults.reach) props.push(`reach={${s.reach}}`);
  if (props.length === 0) return '<Goo>';
  if (props.length === 1) return `<Goo ${props[0]}>`;
  return `<Goo\n  ${props.join('\n  ')}\n>`;
}

export function App() {
  const [layout, setLayout] = useState<Layout>(playIntro ? 'merged' : 'split');
  const [renderer, setRenderer] = useState<Renderer>(variants.liquid.renderer);
  const [motion, setMotion] = useState<Motion>(variants.liquid.motion);
  const [stretchOn, setStretchOn] = useState(true);
  const [sticky, setSticky] = useState<boolean>(variants.liquid.sticky);
  const [snapBack, setSnapBack] = useState(false);
  const [debug, setDebug] = useState(false);
  const [slow, setSlow] = useState(false);
  const [duration, setDuration] = useState<number>(gooDefaults.spring.duration);
  const [bounce, setBounce] = useState<number>(gooDefaults.spring.bounce);
  const [reach, setReach] = useState<number>(gooDefaults.reach);
  const [stretch, setStretch] = useState<number>(gooDefaults.stretch);
  const [spots, setSpots] = useState<Record<string, Spot>>({});
  const stageRef = useRef<HTMLDivElement>(null);
  const apiRef = useRef<GooApi>(null);

  const chooseLayout = (next: Layout) => {
    if (next === 'scatter') setSpots(scatter(stageRef.current));
    apiRef.current?.reset();
    setLayout(next);
  };

  const applyVariant = (name: Variant) => {
    const v = variants[name];
    setRenderer(v.renderer);
    setMotion(v.motion);
    setStretchOn(v.stretch > 0);
    setSticky(v.sticky);
  };

  const activeVariant = (Object.keys(variants) as Variant[]).find(name => {
    const v = variants[name];
    return v.renderer === renderer && v.motion === motion && v.stretch > 0 === stretchOn && v.sticky === sticky;
  });

  useEffect(() => {
    if (!playIntro) return;
    const timer = setTimeout(() => setLayout('split'), 900);
    return () => clearTimeout(timer);
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const tag = (e.target as HTMLElement | null)?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
      if (e.code === 'Space' && tag !== 'BUTTON') {
        e.preventDefault();
        apiRef.current?.reset();
        setLayout(current => (current === 'merged' ? 'split' : 'merged'));
      } else if (e.key.toLowerCase() === 'l') applyVariant('liquid');
      else if (e.key.toLowerCase() === 'c') applyVariant('classic');
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const effectiveStretch = stretchOn ? stretch : 0;
  const swallowed = SWALLOWED[layout];
  const item = (name: string) => ({
    name,
    draggable: true,
    snapBack,
    mergeInto: swallowed.includes(name) ? 'island' : null,
    style: layout === 'scatter' && spots[name] ? { left: spots[name].x, top: spots[name].y } : undefined,
  });
  const modeLabel = `${renderer === 'field' ? 'distance field' : 'blur threshold'} · ${motion === 'spring' ? 'spring' : 'ease-in-out 450ms'}`;
  const snippet = propsSnippet({ renderer, motion, stretch: effectiveStretch, sticky, duration, bounce, reach });

  return (
    <main className="wrap">
      <header className="head">
        <p className="eyebrow">@brechtknecht/gooey · playground</p>
        <h1>Gooey</h1>
        <p className="lede">
          Drag and throw the shapes. Switch between the liquid and classic variants to see where the smoothness comes
          from, then copy the props you like.
        </p>
      </header>

      <div className="bench">
        <section className="stage-col" aria-label="Playground">
          <div className="toolbar">
            <div className="seg" role="group" aria-label="Layout">
              {LAYOUTS.map(l => (
                <button key={l.id} type="button" aria-pressed={layout === l.id} onClick={() => chooseLayout(l.id)}>
                  {l.label}
                </button>
              ))}
            </div>
            <p className="hint">
              Drag or throw · <kbd>Space</kbd> merge · <kbd>L</kbd> <kbd>C</kbd> variant
            </p>
          </div>

          <Goo
            ref={stageRef}
            apiRef={apiRef}
            className="stage"
            data-layout={layout}
            aria-label="Goo playground. Drag the shapes with a mouse or finger."
            renderer={renderer}
            motion={motion}
            spring={{ duration, bounce }}
            reach={reach}
            stretch={effectiveStretch}
            sticky={sticky}
            debug={debug}
            timeScale={slow ? 0.25 : 1}
            reducedMotion="never"
          >
            <GooItem {...item('icon')} className="shape icon" fill="#ff3016" rim={4.5}>
              <Bubbles />
            </GooItem>
            <GooItem {...item('island')} className="shape island">
              <Timer />
              <Wave />
            </GooItem>
            <GooItem {...item('dot')} className="shape dot" />
            <GooItem {...item('tile')} className="shape tile" />
            <GooItem {...item('bead')} className="shape bead" />
            <div className="hud">
              <span className="hpill">{modeLabel}</span>
              <SpeedReadout apiRef={apiRef} />
            </div>
            {slow && <div className="hpill slowbadge">¼× slow motion</div>}
          </Goo>

          <ul className="tries">
            <li>
              <b>Merge and split.</b> Press Split and Merged under each variant, or hit Space. Press L or C halfway
              through to swap variants mid-motion.
            </li>
            <li>
              <b>Shape fidelity.</b> With the blur renderer, the tile loses its corners, the small bead shrinks and the
              icon's black rim bleeds into the red.
            </li>
            <li>
              <b>Pinch and recoil.</b> Pull a shape off a neighbor. With sticky necks the bridge stretches, thins,
              snaps, and both shapes wobble.
            </li>
            <li>
              <b>Real divs, chased.</b> Turn on layout boxes and slow motion. The dashed boxes are the laid-out divs.
              The goo springs after them.
            </li>
          </ul>
        </section>

        <aside className="rail" aria-label="Controls">
          <div className="group">
            <div className="glabel">Variant</div>
            <div className="recipes">
              {(Object.keys(VARIANT_INFO) as Variant[]).map(name => (
                <button
                  key={name}
                  type="button"
                  className="recipe"
                  data-variant={name}
                  aria-pressed={activeVariant === name}
                  onClick={() => applyVariant(name)}
                >
                  <span className="rdot" />
                  <span className="rt">{VARIANT_INFO[name].title}</span>
                  <kbd>{VARIANT_INFO[name].key}</kbd>
                  <span className="rs">{VARIANT_INFO[name].summary}</span>
                </button>
              ))}
            </div>
          </div>

          <Seg
            label="Renderer"
            value={renderer}
            options={[
              { value: 'blur', label: 'Blur threshold' },
              { value: 'field', label: 'Distance field' },
            ]}
            onChange={setRenderer}
          />
          <Seg
            label="Motion"
            value={motion}
            options={[
              { value: 'ease', label: 'CSS ease' },
              { value: 'spring', label: 'Spring' },
            ]}
            onChange={setMotion}
          />

          <div className="group">
            <div className="glabel">Behavior</div>
            <div className="toggles">
              <Toggle id="optStretch" label="Stretch with velocity" checked={stretchOn} onChange={setStretchOn} />
              <Toggle
                id="optSticky"
                label="Sticky necks"
                note="Distance field only"
                checked={sticky}
                disabled={renderer !== 'field'}
                onChange={setSticky}
              />
              <Toggle id="optSnap" label="Snap back on release" checked={snapBack} onChange={setSnapBack} />
              <Toggle id="optDebug" label="Show layout boxes" checked={debug} onChange={setDebug} />
              <Toggle id="optSlow" label="Slow motion ¼×" checked={slow} onChange={setSlow} />
            </div>
          </div>

          <div className="group">
            <div className="glabel">Tuning</div>
            <div className="sliders">
              <Slider
                id="sDur"
                label="Spring duration"
                value={duration}
                min={0.2}
                max={1}
                step={0.01}
                format={v => `${v.toFixed(2)} s`}
                dim={motion !== 'spring'}
                onChange={setDuration}
              />
              <Slider
                id="sBounce"
                label="Bounce"
                value={bounce}
                min={0}
                max={0.7}
                step={0.01}
                format={v => v.toFixed(2)}
                dim={motion !== 'spring'}
                onChange={setBounce}
              />
              <Slider
                id="sReach"
                label="Goo reach"
                value={reach}
                min={4}
                max={36}
                step={1}
                format={v => `${v} px`}
                onChange={setReach}
              />
              <Slider
                id="sStretch"
                label="Stretch amount"
                value={stretch}
                min={0}
                max={60}
                step={1}
                format={v => `${v} px`}
                dim={!stretchOn}
                onChange={setStretch}
              />
            </div>
          </div>

          <PropsSnippet code={snippet} />
        </aside>
      </div>
    </main>
  );
}

function Seg<T extends string>(props: {
  label: string;
  value: T;
  options: { value: T; label: string }[];
  onChange: (value: T) => void;
}) {
  const labelId = `lbl-${props.label.toLowerCase()}`;
  return (
    <div className="group">
      <div className="glabel" id={labelId}>
        {props.label}
      </div>
      <div className="seg seg-full" role="group" aria-labelledby={labelId}>
        {props.options.map(o => (
          <button key={o.value} type="button" aria-pressed={props.value === o.value} onClick={() => props.onChange(o.value)}>
            {o.label}
          </button>
        ))}
      </div>
    </div>
  );
}

function Toggle(props: {
  id: string;
  label: string;
  note?: string;
  checked: boolean;
  disabled?: boolean;
  onChange: (checked: boolean) => void;
}) {
  return (
    <label className={props.disabled ? 'tg is-off' : 'tg'} htmlFor={props.id}>
      <span>{props.label}</span>
      {props.note && <small>{props.note}</small>}
      <input
        id={props.id}
        type="checkbox"
        checked={props.checked}
        disabled={props.disabled}
        onChange={e => props.onChange(e.target.checked)}
      />
    </label>
  );
}

function Slider(props: {
  id: string;
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  format: (value: number) => string;
  dim?: boolean;
  onChange: (value: number) => void;
}) {
  return (
    <div className={props.dim ? 'sl is-off' : 'sl'}>
      <label htmlFor={props.id}>{props.label}</label>
      <output htmlFor={props.id}>{props.format(props.value)}</output>
      <input
        id={props.id}
        type="range"
        min={props.min}
        max={props.max}
        step={props.step}
        value={props.value}
        onChange={e => props.onChange(Number(e.target.value))}
      />
    </div>
  );
}

function PropsSnippet({ code }: { code: string }) {
  const [copied, setCopied] = useState(false);
  useEffect(() => setCopied(false), [code]);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
    } catch {
      setCopied(false);
    }
  };
  return (
    <div className="group">
      <div className="snippet-head">
        <div className="glabel">Props</div>
        <button type="button" className="copy" onClick={copy}>
          {copied ? 'Copied' : 'Copy'}
        </button>
      </div>
      <pre className="snippet">
        <code>{code}</code>
      </pre>
    </div>
  );
}

function SpeedReadout({ apiRef }: { apiRef: RefObject<GooApi | null> }) {
  const [speed, setSpeed] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setSpeed(Math.round((apiRef.current?.getPeakSpeed() ?? 0) / 10) * 10), 120);
    return () => clearInterval(id);
  }, [apiRef]);
  return <span className="hpill">{speed.toLocaleString('en-US')} px/s</span>;
}

function Timer() {
  const [seconds, setSeconds] = useState(42);
  useEffect(() => {
    const id = setInterval(() => setSeconds(s => s + 1), 1000);
    return () => clearInterval(id);
  }, []);
  return (
    <span className="timer">
      {Math.floor(seconds / 60)}:{String(seconds % 60).padStart(2, '0')}
    </span>
  );
}

function Wave() {
  return (
    <span className="wave" aria-hidden="true">
      <i />
      <i />
      <i />
      <i />
      <i />
    </span>
  );
}

function Bubbles() {
  return (
    <svg width="76" height="56" viewBox="0 0 76 56" fill="#ffffff" aria-hidden="true">
      <circle cx="25" cy="23" r="8.5" />
      <circle cx="52" cy="21" r="7.5" />
      <circle cx="39" cy="29.5" r="3.2" />
      <circle cx="31.5" cy="38.5" r="5" />
      <circle cx="46" cy="36" r="4" />
    </svg>
  );
}
