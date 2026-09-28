export type RGB = [number, number, number];

const cache = new Map<string, RGB>();
let probe: CanvasRenderingContext2D | null | undefined;

function parseHex(input: string): RGB | null {
  const m = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(input.trim());
  if (!m) return null;
  let hex = m[1];
  if (hex.length === 3) hex = hex.replace(/./g, ch => ch + ch);
  return [0, 2, 4].map(i => parseInt(hex.slice(i, i + 2), 16) / 255) as RGB;
}

/** Resolves any CSS color to 0..1 sRGB channels. Alpha is ignored. */
export function parseColor(input: string): RGB {
  const hit = cache.get(input);
  if (hit) return [hit[0], hit[1], hit[2]];
  let out = parseHex(input);
  if (!out && typeof document !== 'undefined') {
    if (probe === undefined) {
      const canvas = document.createElement('canvas');
      canvas.width = canvas.height = 1;
      probe = canvas.getContext('2d', { willReadFrequently: true });
    }
    if (probe) {
      probe.clearRect(0, 0, 1, 1);
      probe.fillStyle = '#000';
      probe.fillStyle = input;
      probe.fillRect(0, 0, 1, 1);
      const d = probe.getImageData(0, 0, 1, 1).data;
      out = [d[0] / 255, d[1] / 255, d[2] / 255];
    }
  }
  out ??= [0, 0, 0];
  cache.set(input, out);
  return [out[0], out[1], out[2]];
}

export const toCss = (c: RGB): string =>
  `rgb(${Math.round(c[0] * 255)},${Math.round(c[1] * 255)},${Math.round(c[2] * 255)})`;
