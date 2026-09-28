export const MAX_FIELD_ITEMS = 16;
const MAX_PAIRS = (MAX_FIELD_ITEMS * (MAX_FIELD_ITEMS - 1)) / 2;

const VERTEX = `#version 300 es
in vec2 aPos;
void main() { gl_Position = vec4(aPos, 0.0, 1.0); }`;

// Each item is a rounded box sampled through its inverse stretch matrix. Every pair of items
// is joined with a smooth minimum whose radius comes from the engine, so necks can be sticky
// per pair. Color is a distance-weighted blend, so the deeper shape wins where two overlap.
const FRAGMENT = `#version 300 es
precision highp float;
#define MAX_ITEMS ${MAX_FIELD_ITEMS}
uniform vec2 uCanvas;
uniform float uDpr;
uniform float uBleed;
uniform int uN;
uniform vec4 uBox[MAX_ITEMS];
uniform vec4 uMat[MAX_ITEMS];
uniform vec4 uExtra[MAX_ITEMS];
uniform vec3 uFill[MAX_ITEMS];
uniform vec3 uRim[MAX_ITEMS];
uniform vec4 uK[${MAX_PAIRS / 4}];
uniform float uShadow;
out vec4 outColor;

float sdRoundBox(vec2 p, vec2 b, float r) {
  r = min(r, min(b.x, b.y));
  vec2 q = abs(p) - b + r;
  return min(max(q.x, q.y), 0.0) + length(max(q, 0.0)) - r;
}

float smin(float a, float b, float k) {
  float h = max(k - abs(a - b), 0.0) / k;
  return min(a, b) - h * h * k * 0.25;
}

float field(vec2 p, bool withColor, out vec3 col) {
  float ds[MAX_ITEMS];
  float d = 1e5;
  vec3 csum = vec3(0.0);
  float wsum = 0.0;
  for (int i = 0; i < MAX_ITEMS; i++) {
    if (i >= uN) break;
    vec4 box = uBox[i];
    vec4 m = uMat[i];
    vec4 ex = uExtra[i];
    vec2 q = p - box.xy;
    q = vec2(m.x * q.x + m.y * q.y, m.z * q.x + m.w * q.y);
    float di = sdRoundBox(q, box.zw, ex.x) * ex.y;
    ds[i] = di;
    d = min(d, di);
    if (withColor) {
      float w = exp(clamp(-di / 6.0, -40.0, 40.0));
      float rim = ex.z > 0.05 ? smoothstep(-ex.z - 0.7, -ex.z + 0.7, di) : 0.0;
      csum += w * mix(uFill[i], uRim[i], rim);
      wsum += w;
    }
  }
  int idx = 0;
  for (int i = 0; i < MAX_ITEMS; i++) {
    if (i >= uN) break;
    for (int j = 0; j < MAX_ITEMS; j++) {
      if (j <= i) continue;
      if (j >= uN) break;
      float k = uK[idx >> 2][idx & 3];
      idx++;
      if (k > 0.01) d = min(d, smin(ds[i], ds[j], k));
    }
  }
  col = withColor ? csum / max(wsum, 1e-8) : vec3(0.0);
  return d;
}

void main() {
  vec2 p = vec2(gl_FragCoord.x, uCanvas.y - gl_FragCoord.y) / uDpr - vec2(uBleed);
  vec3 col;
  float d = field(p, true, col);
  float aa = max(fwidth(d), 0.5 / uDpr);
  float a = clamp(0.5 - d / aa, 0.0, 1.0);
  float shadow = 0.0;
  if (uShadow > 0.001) {
    vec3 unused;
    float ds = field(p - vec2(0.0, 6.0), false, unused);
    shadow = uShadow * (1.0 - smoothstep(-6.0, 16.0, ds));
  }
  outColor = vec4(col * a, a) + vec4(0.0, 0.0, 0.0, shadow) * (1.0 - a);
}`;

const UNIFORMS = ['uCanvas', 'uDpr', 'uBleed', 'uN', 'uBox', 'uMat', 'uExtra', 'uFill', 'uRim', 'uK', 'uShadow'] as const;
type UniformName = (typeof UNIFORMS)[number];

/** Draws the goo as a signed distance field with WebGL2. The engine fills the typed arrays. */
export class FieldRenderer {
  readonly box = new Float32Array(MAX_FIELD_ITEMS * 4);
  readonly mat = new Float32Array(MAX_FIELD_ITEMS * 4);
  readonly extra = new Float32Array(MAX_FIELD_ITEMS * 4);
  readonly fill = new Float32Array(MAX_FIELD_ITEMS * 3);
  readonly rim = new Float32Array(MAX_FIELD_ITEMS * 3);
  readonly k = new Float32Array(MAX_PAIRS);

  private readonly canvas: HTMLCanvasElement;
  private readonly gl: WebGL2RenderingContext;
  private program: WebGLProgram | null = null;
  private vao: WebGLVertexArrayObject | null = null;
  private uniforms = {} as Record<UniformName, WebGLUniformLocation | null>;
  private cssHeight = 1;
  private lost = false;

  static create(canvas: HTMLCanvasElement): FieldRenderer | null {
    let gl: WebGL2RenderingContext | null = null;
    try {
      gl = canvas.getContext('webgl2', { premultipliedAlpha: true, antialias: false, alpha: true });
    } catch {
      gl = null;
    }
    if (!gl) return null;
    const renderer = new FieldRenderer(canvas, gl);
    return renderer.init() ? renderer : null;
  }

  private constructor(canvas: HTMLCanvasElement, gl: WebGL2RenderingContext) {
    this.canvas = canvas;
    this.gl = gl;
    canvas.addEventListener('webglcontextlost', e => {
      e.preventDefault();
      this.lost = true;
    });
    canvas.addEventListener('webglcontextrestored', () => {
      this.lost = !this.init();
    });
  }

  private init(): boolean {
    const gl = this.gl;
    const compile = (type: number, source: string) => {
      const shader = gl.createShader(type);
      if (!shader) return null;
      gl.shaderSource(shader, source);
      gl.compileShader(shader);
      if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
        console.error('[gooey] shader failed to compile:', gl.getShaderInfoLog(shader));
        return null;
      }
      return shader;
    };
    const vs = compile(gl.VERTEX_SHADER, VERTEX);
    const fs = compile(gl.FRAGMENT_SHADER, FRAGMENT);
    if (!vs || !fs) return false;
    const program = gl.createProgram();
    gl.attachShader(program, vs);
    gl.attachShader(program, fs);
    gl.linkProgram(program);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
      console.error('[gooey] shader failed to link:', gl.getProgramInfoLog(program));
      return false;
    }
    this.program = program;
    this.vao = gl.createVertexArray();
    gl.bindVertexArray(this.vao);
    gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer());
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
    const loc = gl.getAttribLocation(program, 'aPos');
    gl.enableVertexAttribArray(loc);
    gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
    for (const name of UNIFORMS) this.uniforms[name] = gl.getUniformLocation(program, name);
    return true;
  }

  resize(cssWidth: number, cssHeight: number, dpr: number): void {
    this.canvas.width = Math.max(1, Math.round(cssWidth * dpr));
    this.canvas.height = Math.max(1, Math.round(cssHeight * dpr));
    this.cssHeight = Math.max(1, cssHeight);
  }

  draw(count: number, bleed: number, shadow: number): void {
    const gl = this.gl;
    const u = this.uniforms;
    if (this.lost || !this.program) return;
    gl.viewport(0, 0, this.canvas.width, this.canvas.height);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);
    if (count === 0) return;
    gl.useProgram(this.program);
    gl.bindVertexArray(this.vao);
    gl.uniform2f(u.uCanvas, this.canvas.width, this.canvas.height);
    gl.uniform1f(u.uDpr, this.canvas.height / this.cssHeight);
    gl.uniform1f(u.uBleed, bleed);
    gl.uniform1i(u.uN, count);
    gl.uniform4fv(u.uBox, this.box);
    gl.uniform4fv(u.uMat, this.mat);
    gl.uniform4fv(u.uExtra, this.extra);
    gl.uniform3fv(u.uFill, this.fill);
    gl.uniform3fv(u.uRim, this.rim);
    gl.uniform4fv(u.uK, this.k);
    gl.uniform1f(u.uShadow, shadow);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  }
}
