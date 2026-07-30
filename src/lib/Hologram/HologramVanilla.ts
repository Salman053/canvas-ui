export interface HologramOptions {
  /** Overall intensity of the hologram effect (0 to 3). */
  intensity?: number;
  /** Speed of animation (0 to 3). */
  speed?: number;
  /** Density of vertical scanlines (1 to 40). */
  scanlines?: number;
  /** Chromatic RGB fringing in CSS pixels (0 to 20). */
  rgbShift?: number;
  /** Power fluctuation / flicker amount (0 to 1). */
  flicker?: number;
  /** Cyan/blue tint mix (0 to 1). */
  tint?: number;
  /** Overall opacity of the hologram overlay (0 to 1). */
  opacity?: number;
  /** Projection warp strength (0 to 20). */
  warp?: number;
  /** Glitch intensity on fast cursor movement (0 to 1). */
  glitch?: number;
  /** How smoothly the effect follows the cursor (0 to 1). 1 snaps. */
  follow?: number;
}

export interface HologramElements {
  source: HTMLCanvasElement;
  content: HTMLElement;
  output: HTMLCanvasElement;
}

export interface HologramInstance {
  setOptions: (options: HologramOptions) => void;
  resize: () => void;
  burst: () => void;
  destroy: () => void;
}

const DEFAULTS: Required<HologramOptions> = {
  intensity: 1,
  speed: 0.6,
  scanlines: 18,
  rgbShift: 3,
  flicker: 0.2,
  tint: 0.5,
  opacity: 0.8,
  warp: 6,
  glitch: 0.4,
  follow: 0.18,
};

type PaintableCanvas = HTMLCanvasElement & {
  onpaint?: (() => void) | null;
  requestPaint?: () => void;
};

type ElementImageContext = CanvasRenderingContext2D & {
  drawElementImage?: (element: Element, x: number, y: number) => void;
};

const VERT = `#version 300 es
precision highp float;
layout(location = 0) in vec2 aPos;
out vec2 vUv;
void main () {
  vUv = aPos * 0.5 + 0.5;
  gl_Position = vec4(aPos, 0.0, 1.0);
}`;

const FRAG = `#version 300 es
precision highp float;
in vec2 vUv;
out vec4 outColor;
uniform sampler2D uContent;
uniform sampler2D uMaterial;
uniform sampler2D uSelection;
uniform vec2 uResolution;
uniform vec2 uCursor;
uniform vec2 uCursorPx;
uniform vec4 uFocusRect;
uniform float uTime;
uniform float uPowerFlicker;
uniform float uGlitchSeed;
uniform float uGlitchActive;
uniform float uIntensity;
uniform float uSpeed;
uniform float uScanlines;
uniform float uRgbShift;
uniform float uFlicker;
uniform float uTint;
uniform float uOpacity;
uniform float uWarp;
uniform float uGlitch;
uniform float uPresence;
uniform float uViewAngle;
uniform float uFocusActive;
uniform float uMaxX;

float hash (vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}

float noise (vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  float a = hash(i);
  float b = hash(i + vec2(1.0, 0.0));
  float c = hash(i + vec2(0.0, 1.0));
  float d = hash(i + vec2(1.0, 1.0));
  return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
}

vec4 page (vec2 p) {
  p.x = clamp(p.x, 0.0005, uMaxX - 0.0005);
  p.y = clamp(p.y, 0.0005, 0.9995);
  return texture(uContent, vec2(p.x, 1.0 - p.y));
}

float luminance (vec3 c) {
  return dot(c, vec3(0.2126, 0.7152, 0.0722));
}

float edgeDetect (vec2 uv, vec2 res) {
  vec2 px = 1.0 / res;
  float c = luminance(page(uv).rgb);
  float t = luminance(page(uv + vec2(0.0, px.y)).rgb);
  float b = luminance(page(uv - vec2(0.0, px.y)).rgb);
  float l = luminance(page(uv - vec2(px.x, 0.0)).rgb);
  float r = luminance(page(uv + vec2(px.x, 0.0)).rgb);
  float dx = r - l;
  float dy = t - b;
  return clamp(length(vec2(dx, dy)) * 4.0, 0.0, 1.0);
}

int materialAt (vec2 uv) {
  vec4 m = texture(uMaterial, uv);
  if (m.r > 0.5) return 4;
  if (m.g > 0.5) return 2;
  if (m.b > 0.5) return 1;
  if (m.r > 0.3 && m.g > 0.3 && m.b < 0.1) return 5;
  if (m.g > 0.3 && m.b > 0.3 && m.r < 0.1) return 3;
  return 0;
}

float selectionAt (vec2 uv) {
  return texture(uSelection, uv).r;
}

bool inRect (vec2 uv, vec4 r) {
  return uv.x >= r.x && uv.x <= r.x + r.z && uv.y >= r.y && uv.y <= r.y + r.w;
}

void main () {
  vec2 uv = vUv;
  if (uv.x > uMaxX) {
    outColor = vec4(0.0);
    return;
  }

  float intensity = uIntensity;
  float presence = uPresence;
  if (intensity < 0.001 || presence < 0.001) {
    outColor = page(uv);
    return;
  }

  vec2 res = uResolution;
  vec2 cursor = uCursor;

  float dpr = res.x / max(uMaxX * res.x, 1.0);
  float aspect = res.x / res.y;

  vec2 suv = uv;
  vec2 toCursor = cursor - uv;
  float cursorDist = length(toCursor * vec2(aspect, 1.0));

  float warpStrength = uWarp * intensity * presence * 0.008;
  float warpFalloff = exp(-cursorDist * 3.5);
  vec2 warpOffset = toCursor * warpFalloff * warpStrength;
  suv += warpOffset;

  int matId = materialAt(uv);
  float selGlow = selectionAt(uv);

  float matScanMul = 1.0;
  vec3 matTint = vec3(0.0);
  float matGlow = 0.0;
  if (matId == 1) {
    matScanMul = 0.95;
    matTint = vec3(0.0, 0.4, 0.6) * 0.15;
  } else if (matId == 2) {
    matScanMul = 0.8;
    matTint = vec3(0.0, 0.7, 0.2) * 0.2;
    matGlow = 0.05;
  } else if (matId == 3) {
    matScanMul = 1.2;
    matTint = vec3(0.0, 0.2, 0.4) * 0.1;
  } else if (matId == 4) {
    matScanMul = 0.9;
    matTint = vec3(0.6, 0.2, 0.1) * 0.25;
    matGlow = 0.08;
  } else if (matId == 5) {
    matScanMul = 1.0;
    matTint = vec3(0.2, 0.5, 0.7) * 0.2;
    matGlow = 0.04;
  }

  float viewAngle = uViewAngle;
  float viewShift = viewAngle * 0.008 * intensity * (0.5 + 0.5 * length(uv - 0.5) * 2.0);

  float edge = edgeDetect(suv, res);
  float pseudoDepth = edge;

  float scanlineDensity = max(uScanlines, 1.0) * matScanMul;
  float scanlineRaw = suv.x * scanlineDensity * 3.14159 * 2.0;
  float scanline = sin(scanlineRaw);

  float interference = exp(-cursorDist * 8.0) * 0.3 * intensity;
  float scanlineWarp = sin(suy.y * 40.0 + cursorDist * 6.0 - uTime * 0.5) * interference;
  float scanlineMod = 1.0 - 0.18 * intensity * (0.5 - 0.5 * sin(scanlineRaw + scanlineWarp));

  float chromaShift = 1.0 + 2.0 * exp(-cursorDist * 4.0);
  float depthBoost = 1.0 + pseudoDepth * 1.5;
  float edgeShift = 0.3 + 0.7 * length(uv - 0.5) * 2.0;
  float rgbOffset = uRgbShift * intensity * dpr * chromaShift * depthBoost * edgeShift;
  float caR = rgbOffset * 1.2 + viewShift * res.x;
  float caB = -rgbOffset * 1.0 - viewShift * res.x;

  vec2 rUv = suv + vec2(caR / res.x, 0.0);
  vec2 bUv = suv + vec2(caB / res.x, 0.0);

  vec4 cR = page(rUv);
  vec4 cG = page(suv);
  vec4 cB = page(bUv);
  vec3 col = vec3(cR.r, cG.g, cB.b);
  float baseAlpha = cG.a;

  float luma = luminance(col);
  float lumaScanline = 0.5 + 0.5 * noise(suv * vec2(200.0, scanlineDensity * 20.0) + uTime * 0.2);
  float lumaMod = 1.0 - 0.08 * intensity * (1.0 - luma) * lumaScanline;

  vec3 holo = col * scanlineMod * lumaMod;

  float refreshLine = fract(uTime * 0.3);
  float linePos = refreshLine;
  float distToLine = abs(uv.y - linePos);
  float scanLineGlow = exp(-distToLine * distToLine * 20000.0 * intensity);
  vec3 lineColor = vec3(0.3, 0.85, 1.0);
  holo += lineColor * scanLineGlow * 0.25 * intensity;
  float scanBoost = exp(-distToLine * distToLine * 8000.0);
  holo *= (1.0 + 0.15 * intensity * scanBoost);

  float shadowSize = 0.04 + 0.03 * (1.0 - intensity * 0.2);
  float shadow = exp(-cursorDist * cursorDist * 800.0 * shadowSize);
  holo *= (1.0 - 0.35 * intensity * shadow * presence);

  float rainbowRings = exp(-cursorDist * cursorDist * 1500.0);
  float ringPhase = sin(cursorDist * 60.0 + uTime * 2.0) * 0.5 + 0.5;
  vec3 diffractionColor = vec3(
    0.3 + 0.7 * sin(cursorDist * 50.0 + uTime * 0.5),
    0.3 + 0.7 * sin(cursorDist * 50.0 + 2.094 + uTime * 0.5),
    0.3 + 0.7 * sin(cursorDist * 50.0 + 4.189 + uTime * 0.5)
  );
  float ringStrength = rainbowRings * ringPhase * 0.08 * intensity * presence;
  holo += diffractionColor * ringStrength;

  float screenDoor = sin(uv.x * res.x * 0.5) * sin(uv.y * res.y * 0.5);
  float gridPattern = abs(screenDoor);
  float gridMask = smoothstep(0.85, 0.95, gridPattern);
  holo *= (1.0 - 0.06 * intensity * gridMask);

  holo += matTint;

  float edgeGlow = edge * 0.08 * intensity;
  holo += vec3(0.2, 0.7, 1.0) * edgeGlow * (0.6 + 0.4 * sin(uTime * 0.5));
  holo += vec3(0.0, 0.8, 0.3) * matGlow * intensity;

  if (selGlow > 0.01) {
    float selPulse = 0.7 + 0.3 * sin(uTime * 2.0);
    holo += vec3(0.3, 0.8, 1.0) * selGlow * 0.15 * intensity * selPulse;
  }

  if (uFocusActive > 0.5 && inRect(uv, uFocusRect)) {
    vec2 fc = uv - uFocusRect.xy - uFocusRect.zw * 0.5;
    vec2 fHalf = uFocusRect.zw * 0.5;
    float outline = max(
      abs(abs(fc.x) - fHalf.x),
      abs(abs(fc.y) - fHalf.y)
    );
    float ring = exp(-outline * outline * 20000.0);
    float pulse = 0.6 + 0.4 * sin(uTime * 3.0);
    holo += vec3(0.2, 0.9, 1.0) * ring * 0.2 * intensity * pulse;
  }

  float distFromCursor = cursorDist;
  float projectionGlow = exp(-distFromCursor * 3.0) * 0.15 * intensity;
  vec3 glowColor = vec3(0.35, 0.75, 1.0);
  holo += glowColor * projectionGlow;

  vec3 cyan = vec3(0.15, 0.8, 0.92);
  vec3 blue = vec3(0.25, 0.45, 1.0);
  float tintMix = 0.5 + 0.5 * sin(uv.y * 12.0 + uTime * 0.4);
  vec3 tintColor = mix(cyan, blue, tintMix);
  float tintAmount = uTint * intensity * 0.2 * (0.7 + 0.3 * sin(uTime * 0.3));
  holo = mix(holo, tintColor, tintAmount);

  float powerFlicker = 1.0 - uFlicker * intensity * uPowerFlicker * 0.12;
  holo *= powerFlicker;

  float vignette = 1.0 - 0.3 * length(uv - 0.5) * 1.6;
  vignette = max(vignette, 0.0);
  float cone = 1.0 - 0.5 * pow(length((uv - cursor) * vec2(aspect, 1.0)), 1.5);
  cone = clamp(cone, 0.0, 1.0);
  float projectionMask = mix(vignette, cone, 0.5);
  holo *= (0.85 + 0.15 * projectionMask);

  float dustSeed = floor(uTime * 8.0 * uSpeed);
  for (int i = 0; i < 3; i++) {
    float fi = float(i);
    vec2 dPos = vec2(
      hash(vec2(dustSeed + fi * 7.0, 13.0)),
      hash(vec2(dustSeed + fi * 11.0, 17.0))
    );
    dPos += vec2(uTime * 0.01 * (0.3 + fi * 0.2), uTime * 0.005 * (0.5 + fi * 0.15));
    dPos = fract(dPos);
    vec2 dRel = (uv - dPos) * vec2(aspect, 1.0);
    float dDist = length(dRel);
    float dSize = 0.004 + fi * 0.002;
    float dust = smoothstep(dSize, 0.0, dDist) * 0.06 * intensity;
    float dFlicker = 0.5 + 0.5 * sin(uTime * 2.0 + fi * 3.0 + dPos.x * 100.0);
    holo += vec3(0.5, 0.85, 1.0) * dust * dFlicker;
  }

  float glitchAmount = uGlitch * intensity * uGlitchActive;
  if (glitchAmount > 0.01) {
    float gSeed = uGlitchSeed;
    float gLine = floor(suv.y * 40.0 * (0.5 + 0.5 * hash(vec2(gSeed, 0.0))));
    float gPick = hash(vec2(gLine, gSeed));
    float gThreshold = 0.15 * glitchAmount;
    if (gPick < gThreshold) {
      float gShift = (hash(vec2(gLine, gSeed + 5.0)) - 0.5) * 0.06 * glitchAmount;
      float gSplit = hash(vec2(gLine, gSeed + 9.0)) * 0.02 * glitchAmount;
      vec2 gUv = suv + vec2(gShift, 0.0);
      float gR = page(gUv + vec2(gSplit, 0.0)).r;
      float gG = page(gUv).g;
      float gB = page(gUv - vec2(gSplit, 0.0)).b;
      holo = mix(holo, vec3(gR, gG, gB), 0.8);
    }
    float noiseLine = hash(vec2(floor(suv.y * res.y * 0.5), gSeed));
    if (noiseLine < 0.04 * glitchAmount) {
      float nStrength = hash(vec2(gSeed, floor(suv.x * 20.0)));
      holo += (nStrength - 0.5) * 0.15 * glitchAmount;
    }
  }

  float alpha = uOpacity * (0.8 + 0.2 * projectionMask) * baseAlpha;

  outColor = vec4(clamp(holo, 0.0, 1.0) * alpha, alpha);
}`;

const MATERIAL_SIZE = 256;
const MATERIAL_TAG: Record<string, number> = {
  P: 1, SPAN: 1, A: 1, LI: 1, TD: 1, TH: 1, LABEL: 1,
  CODE: 2, PRE: 2, KBD: 2, SAMP: 2,
  IMG: 3, VIDEO: 3, SVG: 3, CANVAS: 3, FIGURE: 3,
  BUTTON: 4, INPUT: 4, SELECT: 4, TEXTAREA: 4, OPTION: 4,
  H1: 5, H2: 5, H3: 5, H4: 5, H5: 5, H6: 5,
};

const MATERIAL_COLORS: Record<number, [number, number, number]> = {
  0: [0, 0, 0],
  1: [0, 0, 1],
  2: [0, 1, 0],
  3: [0, 1, 1],
  4: [1, 0, 0],
  5: [1, 0, 1],
};

export function supportsHtmlInCanvas(): boolean {
  if (typeof document === "undefined") return false;
  const probe = document.createElement("canvas") as PaintableCanvas;
  const ctx = probe.getContext("2d") as ElementImageContext | null;
  return Boolean(
    ctx &&
    typeof ctx.drawElementImage === "function" &&
    typeof probe.requestPaint === "function",
  );
}

interface Rect { x: number; y: number; w: number; h: number; }

export function createHologram(
  elements: HologramElements,
  options: HologramOptions = {},
): HologramInstance | null {
  const config = { ...DEFAULTS, ...options };
  const { source, content, output } = elements;

  const gl = output.getContext("webgl2", {
    alpha: true,
    depth: false,
    stencil: false,
    antialias: false,
    premultipliedAlpha: true,
  });
  if (!gl || gl.isContextLost()) return null;

  const sourceCtx = source.getContext("2d") as ElementImageContext | null;
  const paintable = source as PaintableCanvas;
  const htmlInCanvas = Boolean(
    sourceCtx &&
    typeof sourceCtx.drawElementImage === "function" &&
    typeof paintable.requestPaint === "function",
  );

  let contentDirty = false;
  let wake = () => {};

  if (htmlInCanvas) {
    paintable.onpaint = () => {
      try {
        sourceCtx!.reset();
        sourceCtx!.drawElementImage!(content, 0, 0);
        contentDirty = true;
        materialDirty = true;
        wake();
      } catch {}
    };
  }

  function compile(type: number, text: string): WebGLShader {
    const shader = gl!.createShader(type)!;
    gl!.shaderSource(shader, text);
    gl!.compileShader(shader);
    if (!gl!.getShaderParameter(shader, gl!.COMPILE_STATUS)) {
      console.error("Hologram shader error:", gl!.getShaderInfoLog(shader));
    }
    return shader;
  }

  const vertexShader = compile(gl.VERTEX_SHADER, VERT);
  const fragmentShader = compile(gl.FRAGMENT_SHADER, FRAG);
  const program = gl.createProgram()!;
  gl.attachShader(program, vertexShader);
  gl.attachShader(program, fragmentShader);
  gl.linkProgram(program);

  const uniforms: Record<string, WebGLUniformLocation> = {};
  const count = gl.getProgramParameter(program, gl.ACTIVE_UNIFORMS);
  for (let i = 0; i < count; i++) {
    const info = gl.getActiveUniform(program, i)!;
    uniforms[info.name] = gl.getUniformLocation(program, info.name)!;
  }

  const quad = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, quad);
  gl.bufferData(
    gl.ARRAY_BUFFER,
    new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]),
    gl.STATIC_DRAW,
  );
  gl.enableVertexAttribArray(0);
  gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);

  function createTexture(width: number, height: number, data: Uint8Array | null): WebGLTexture {
    const tex = gl!.createTexture()!;
    gl!.bindTexture(gl!.TEXTURE_2D, tex);
    gl!.texParameteri(gl!.TEXTURE_2D, gl!.TEXTURE_MIN_FILTER, gl!.LINEAR);
    gl!.texParameteri(gl!.TEXTURE_2D, gl!.TEXTURE_MAG_FILTER, gl!.LINEAR);
    gl!.texParameteri(gl!.TEXTURE_2D, gl!.TEXTURE_WRAP_S, gl!.CLAMP_TO_EDGE);
    gl!.texParameteri(gl!.TEXTURE_2D, gl!.TEXTURE_WRAP_T, gl!.CLAMP_TO_EDGE);
    gl!.texImage2D(
      gl!.TEXTURE_2D, 0, gl!.RGBA,
      width, height, 0,
      gl!.RGBA, gl!.UNSIGNED_BYTE,
      data ?? new Uint8Array(width * height * 4),
    );
    return tex;
  }

  const contentTexture = createTexture(1, 1, new Uint8Array([0, 0, 0, 0]));
  const materialTexture = createTexture(MATERIAL_SIZE, MATERIAL_SIZE, null);
  const selectionTexture = createTexture(MATERIAL_SIZE, MATERIAL_SIZE, null);

  const materialCanvas = document.createElement("canvas");
  materialCanvas.width = MATERIAL_SIZE;
  materialCanvas.height = MATERIAL_SIZE;
  const materialCtx = materialCanvas.getContext("2d")!;

  const selectionCanvas = document.createElement("canvas");
  selectionCanvas.width = MATERIAL_SIZE;
  selectionCanvas.height = MATERIAL_SIZE;
  const selectionCtx = selectionCanvas.getContext("2d")!;

  let contentMaxX = 1;
  let materialDirty = true;
  let selectionDirty = true;
  let focusRect: Rect = { x: 0, y: 0, w: 0, h: 0 };
  let focusActive = false;
  function syncCanvasSize() {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const width = Math.max(1, Math.round(output.clientWidth * dpr));
    const height = Math.max(1, Math.round(output.clientHeight * dpr));
    if (output.width !== width || output.height !== height) {
      output.width = width;
      output.height = height;
    }
    contentMaxX = Math.min(
      1,
      Math.max(0.05, content.clientWidth / Math.max(output.clientWidth, 1)),
    );
    if (htmlInCanvas) {
      const cssWidth = Math.max(1, Math.round(source.clientWidth));
      const cssHeight = Math.max(1, Math.round(source.clientHeight));
      if (source.width !== cssWidth * dpr || source.height !== cssHeight * dpr) {
        source.width = cssWidth * dpr;
        source.height = cssHeight * dpr;
      }
      paintable.requestPaint!();
    }
  }

  syncCanvasSize();

  function uploadContent() {
    if (!htmlInCanvas || !contentDirty) return;
    contentDirty = false;
    gl!.bindTexture(gl!.TEXTURE_2D, contentTexture);
    gl!.texImage2D(
      gl!.TEXTURE_2D, 0, gl!.RGBA, gl!.RGBA, gl!.UNSIGNED_BYTE, source,
    );
  }

  function rebuildMaterialMap() {
    if (!materialDirty) return;
    materialDirty = false;
    const cssW = Math.max(output.clientWidth, 1);
    const cssH = Math.max(output.clientHeight, 1);
    materialCtx.clearRect(0, 0, MATERIAL_SIZE, MATERIAL_SIZE);

    const walker = document.createTreeWalker(content, NodeFilter.SHOW_ELEMENT, null);
    let node: Element | null;
    while ((node = walker.nextNode() as Element | null)) {
      const tag = node.tagName.toUpperCase();
      const matId = MATERIAL_TAG[tag];
      if (matId === undefined) continue;
      const rect = node.getBoundingClientRect();
      const contentRect = content.getBoundingClientRect();
      const x = (rect.left - contentRect.left) / cssW;
      const y = (rect.top - contentRect.top) / cssH;
      const w = rect.width / cssW;
      const h = rect.height / cssH;
      if (w < 0.001 || h < 0.001) continue;
      const col = MATERIAL_COLORS[matId];
      materialCtx.fillStyle = `rgb(${col[0] * 255},${col[1] * 255},${col[2] * 255})`;
      materialCtx.fillRect(
        x * MATERIAL_SIZE, y * MATERIAL_SIZE,
        Math.max(w * MATERIAL_SIZE, 1), Math.max(h * MATERIAL_SIZE, 1),
      );
    }
    gl!.bindTexture(gl!.TEXTURE_2D, materialTexture);
    gl!.texImage2D(
      gl!.TEXTURE_2D, 0, gl!.RGBA, gl!.RGBA, gl!.UNSIGNED_BYTE, materialCanvas,
    );
  }

  function rebuildSelectionMap() {
    if (!selectionDirty) return;
    selectionDirty = false;
    const cssW = Math.max(output.clientWidth, 1);
    const cssH = Math.max(output.clientHeight, 1);
    selectionCtx.clearRect(0, 0, MATERIAL_SIZE, MATERIAL_SIZE);

    const sel = document.getSelection();
    if (sel && !sel.isCollapsed && content.contains(sel.anchorNode)) {
      for (let i = 0; i < sel.rangeCount; i++) {
        const range = sel.getRangeAt(i);
        const rects = range.getClientRects();
        const contentRect = content.getBoundingClientRect();
        for (let j = 0; j < rects.length; j++) {
          const r = rects[j];
          const x = (r.left - contentRect.left) / cssW;
          const y = (r.top - contentRect.top) / cssH;
          const w = r.width / cssW;
          const h = r.height / cssH;
          if (w < 0.001 || h < 0.001) continue;
          selectionCtx.fillStyle = "white";
          selectionCtx.fillRect(
            x * MATERIAL_SIZE, y * MATERIAL_SIZE,
            Math.max(w * MATERIAL_SIZE, 1), Math.max(h * MATERIAL_SIZE, 1),
          );
        }
      }
    }
    gl!.bindTexture(gl!.TEXTURE_2D, selectionTexture);
    gl!.texImage2D(
      gl!.TEXTURE_2D, 0, gl!.RGBA, gl!.RGBA, gl!.UNSIGNED_BYTE, selectionCanvas,
    );
  }

  function updateFocusRect(el: Element | null) {
    if (!el || !content.contains(el)) {
      focusActive = false;
      return;
    }
    const cssW = Math.max(output.clientWidth, 1);
    const cssH = Math.max(output.clientHeight, 1);
    const r = el.getBoundingClientRect();
    const contentRect = content.getBoundingClientRect();
    focusRect = {
      x: (r.left - contentRect.left) / cssW,
      y: (r.top - contentRect.top) / cssH,
      w: r.width / cssW,
      h: r.height / cssH,
    };
    focusActive = true;
  }

  let time = 0;
  let posX = output.clientWidth / 2;
  let posY = output.clientHeight / 2;
  let targetX = posX;
  let targetY = posY;
  let prevTargetX = posX;
  let prevTargetY = posY;
  let presence = 0;
  let presenceTarget = 0;
  let hasPointer = false;
  let velX = 0;
  let velY = 0;
  let glitchSeed = 0;
  let glitchActive = 0;

  function hash1(n: number) {
    const s = Math.sin(n * 127.1) * 43758.5453;
    return s - Math.floor(s);
  }

  function updateFlicker(now: number) {
    const t = now / 1000;
    return (
      Math.sin(t * 47.3 * config.speed) * 0.3 +
      Math.sin(t * 31.7 * config.speed) * 0.2 +
      Math.sin(t * 103.1 * config.speed) * 0.15 +
      hash1(Math.floor(t * 60)) * 0.35
    );
  }

  function render() {
    uploadContent();
    rebuildMaterialMap();
    rebuildSelectionMap();
    const dpr = output.width / Math.max(output.clientWidth, 1);
    const cx = posX / Math.max(output.clientWidth, 1);
    const cy = 1 - posY / Math.max(output.clientHeight, 1);
    const powerFlicker = updateFlicker(performance.now());
    const viewAngle = (cx - 0.5) * 2.0;

    gl!.useProgram(program);
    gl!.activeTexture(gl!.TEXTURE0);
    gl!.bindTexture(gl!.TEXTURE_2D, contentTexture);
    gl!.uniform1i(uniforms.uContent, 0);
    gl!.activeTexture(gl!.TEXTURE1);
    gl!.bindTexture(gl!.TEXTURE_2D, materialTexture);
    gl!.uniform1i(uniforms.uMaterial, 1);
    gl!.activeTexture(gl!.TEXTURE2);
    gl!.bindTexture(gl!.TEXTURE_2D, selectionTexture);
    gl!.uniform1i(uniforms.uSelection, 2);
    gl!.uniform2f(uniforms.uResolution, output.width, output.height);
    gl!.uniform2f(uniforms.uCursor, cx, cy);
    gl!.uniform2f(uniforms.uCursorPx, posX * dpr, posY * dpr);
    gl!.uniform4f(uniforms.uFocusRect, focusRect.x, focusRect.y, focusRect.w, focusRect.h);
    gl!.uniform1f(uniforms.uTime, time);
    gl!.uniform1f(uniforms.uPowerFlicker, powerFlicker);
    gl!.uniform1f(uniforms.uGlitchSeed, glitchSeed);
    gl!.uniform1f(uniforms.uGlitchActive, glitchActive);
    gl!.uniform1f(uniforms.uIntensity, Math.max(config.intensity, 0));
    gl!.uniform1f(uniforms.uSpeed, Math.max(config.speed, 0.01));
    gl!.uniform1f(uniforms.uScanlines, Math.max(config.scanlines, 1));
    gl!.uniform1f(uniforms.uRgbShift, Math.max(config.rgbShift, 0) * dpr);
    gl!.uniform1f(uniforms.uFlicker, Math.min(Math.max(config.flicker, 0), 1));
    gl!.uniform1f(uniforms.uTint, Math.min(Math.max(config.tint, 0), 1));
    gl!.uniform1f(uniforms.uOpacity, Math.min(Math.max(config.opacity, 0), 1));
    gl!.uniform1f(uniforms.uWarp, Math.max(config.warp, 0));
    gl!.uniform1f(uniforms.uGlitch, Math.min(Math.max(config.glitch, 0), 1));
    gl!.uniform1f(uniforms.uPresence, presence);
    gl!.uniform1f(uniforms.uViewAngle, viewAngle);
    gl!.uniform1f(uniforms.uFocusActive, focusActive ? 1 : 0);
    gl!.uniform1f(uniforms.uMaxX, contentMaxX);
    gl!.bindFramebuffer(gl!.FRAMEBUFFER, null);
    gl!.viewport(0, 0, output.width, output.height);
    gl!.drawArrays(gl!.TRIANGLE_STRIP, 0, 4);
  }

  let raf = 0;
  let lastTime = performance.now();
  let destroyed = false;
  let running = false;
  let visible = true;

  const motionQuery = window.matchMedia("(prefers-reduced-motion: reduce)");
  let reducedMotion = motionQuery.matches;

  function frame(now: number) {
    if (destroyed) return;
    if (!visible) {
      running = false;
      return;
    }
    const delta = Math.min(Math.max((now - lastTime) / 1000, 0), 1 / 30);
    lastTime = now;

    if (!reducedMotion) {
      time += delta * config.speed;

      velX = targetX - prevTargetX;
      velY = targetY - prevTargetY;
      prevTargetX = targetX;
      prevTargetY = targetY;

      const speed = Math.sqrt(velX * velX + velY * velY);
      glitchActive = speed > 3 ? Math.min((speed - 3) / 100, 1) : 0;
      if (glitchActive > 0.01 && glitchSeed === 0) {
        glitchSeed = Math.floor(Math.random() * 1000);
      } else if (glitchActive < 0.01) {
        glitchSeed = 0;
        glitchActive = 0;
      }

      const follow = Math.min(Math.max(config.follow, 0.02), 1);
      const kPos = follow >= 1 ? 1 : 1 - Math.exp(-delta * (4 + follow * 26));
      posX += (targetX - posX) * kPos;
      posY += (targetY - posY) * kPos;
    }

    const kScale = reducedMotion ? 1 : 1 - Math.exp(-delta * 10);
    presence += (presenceTarget - presence) * kScale;

    render();

    const settled =
      reducedMotion ||
      (Math.abs(targetX - posX) < 0.1 &&
        Math.abs(targetY - posY) < 0.1 &&
        Math.abs(presenceTarget - presence) < 0.002 &&
        glitchActive < 0.01 &&
        !contentDirty && !materialDirty && !selectionDirty);
    if (settled) {
      posX = targetX;
      posY = targetY;
      presence = presenceTarget;
      running = false;
      return;
    }
    raf = requestAnimationFrame(frame);
  }

  function start() {
    if (destroyed || running || !visible) return;
    running = true;
    lastTime = performance.now();
    raf = requestAnimationFrame(frame);
  }

  wake = start;
  start();

  function onPointerMove(event: PointerEvent) {
    if (reducedMotion) return;
    const rect = output.getBoundingClientRect();
    targetX = event.clientX - rect.left;
    targetY = event.clientY - rect.top;
    if (!hasPointer) {
      posX = targetX;
      posY = targetY;
      prevTargetX = targetX;
      prevTargetY = targetY;
      hasPointer = true;
    }
    presenceTarget = 1;
    start();
  }

  function onPointerLeave() {
    presenceTarget = 0;
    hasPointer = false;
    start();
  }

  content.addEventListener("pointermove", onPointerMove, { passive: true });
  content.addEventListener("pointerleave", onPointerLeave, { passive: true });

  function onScroll() {
    if (htmlInCanvas) paintable.requestPaint?.();
    start();
  }
  content.addEventListener("scroll", onScroll, { passive: true });

  function onMotionChange() {
    reducedMotion = motionQuery.matches;
    start();
  }
  motionQuery.addEventListener("change", onMotionChange);

  function onSelectionChange() {
    selectionDirty = true;
    start();
  }
  document.addEventListener("selectionchange", onSelectionChange);

  function onFocusIn(e: FocusEvent) {
    updateFocusRect(e.target as Element);
    start();
  }
  function onFocusOut() {
    focusActive = false;
    start();
  }
  content.addEventListener("focusin", onFocusIn);
  content.addEventListener("focusout", onFocusOut);

  const mutationObserver = new MutationObserver(() => {
    materialDirty = true;
    start();
  });
  mutationObserver.observe(content, {
    childList: true,
    subtree: true,
    attributes: true,
  });

  const observer = new ResizeObserver(() => {
    syncCanvasSize();
    start();
  });
  observer.observe(output);
  observer.observe(content);

  const intersection = new IntersectionObserver((entries) => {
    visible = entries[entries.length - 1]?.isIntersecting ?? true;
    if (visible) start();
  });
  intersection.observe(output);

  return {
    setOptions(next) {
      Object.assign(config, next);
      start();
    },
    resize() {
      syncCanvasSize();
      start();
    },
    burst() {
      glitchSeed = Math.floor(Math.random() * 1000);
      glitchActive = 1;
      start();
    },
    destroy() {
      destroyed = true;
      cancelAnimationFrame(raf);
      content.removeEventListener("pointermove", onPointerMove);
      content.removeEventListener("pointerleave", onPointerLeave);
      content.removeEventListener("scroll", onScroll);
      content.removeEventListener("focusin", onFocusIn);
      content.removeEventListener("focusout", onFocusOut);
      document.removeEventListener("selectionchange", onSelectionChange);
      mutationObserver.disconnect();
      observer.disconnect();
      intersection.disconnect();
      motionQuery.removeEventListener("change", onMotionChange);
      gl!.deleteTexture(contentTexture);
      gl!.deleteTexture(materialTexture);
      gl!.deleteTexture(selectionTexture);
      gl!.deleteProgram(program);
      gl!.deleteShader(vertexShader);
      gl!.deleteShader(fragmentShader);
      gl!.deleteBuffer(quad);
      if (htmlInCanvas) paintable.onpaint = null;
    },
  };
}
