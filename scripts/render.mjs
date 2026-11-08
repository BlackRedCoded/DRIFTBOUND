// Software rasteriser harness: renders real frames of the game to PNG so the
// 3D art can be inspected without a browser.
import { build } from "esbuild";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { deflateSync } from "node:zlib";

const W = 1280,
  H = 800;
const buf = new Uint8Array(W * H * 3);

function parseColor(c) {
  if (typeof c !== "string") return null;
  if (c[0] === "#") {
    const h = c.slice(1);
    const n = h.length === 3 ? h.split("").map((x) => parseInt(x + x, 16)) : [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16));
    return [n[0], n[1], n[2], 1];
  }
  const m = c.match(/rgba?\(([^)]+)\)/);
  if (!m) return [250, 0, 250, 1];
  const p = m[1].split(",").map(Number);
  return [p[0], p[1], p[2], p.length > 3 ? p[3] : 1];
}

const bigShapes = [];
const allShapes = [];
const strokes = [];
const traceAll = [];
const shadow = new Uint8Array(W * H);
function markShadow(pts) {
  if (!pts.length) return;
  let minY = Infinity, maxY = -Infinity;
  for (const p of pts) { minY = Math.min(minY, p[1]); maxY = Math.max(maxY, p[1]); }
  for (let y = Math.max(0, Math.ceil(minY)); y <= Math.min(H - 1, Math.floor(maxY)); y++) {
    const xs = [];
    for (let i = 0; i < pts.length; i++) {
      const a = pts[i], b = pts[(i + 1) % pts.length];
      if (a[1] === b[1]) continue;
      const yc = y + 0.5;
      if (yc >= Math.min(a[1], b[1]) && yc < Math.max(a[1], b[1])) xs.push(a[0] + ((yc - a[1]) / (b[1] - a[1])) * (b[0] - a[0]));
    }
    xs.sort((p, q) => p - q);
    for (let i = 0; i + 1 < xs.length; i += 2)
      for (let x = Math.max(0, Math.ceil(xs[i] - 0.5)); x <= Math.min(W - 1, Math.floor(xs[i + 1] - 0.5)); x++) shadow[y * W + x] = 1;
  }
}
function fillPoly(pts, color, alpha) {
  const n = pts.length;
  if (n < 3 || !color) return;
  if (process.env.SHADOW_MAP) markShadow(pts);
  if (process.env.SHADOW_MAP) {
  for (let y = 0; y < H; y += 4) {
    let mn = W, mx = -1;
    for (let x = 0; x < W; x++) if (shadow[y * W + x]) { mn = Math.min(mn, x); mx = x; }
    if (mx >= 0) console.log("row", y, mn, mx, "width", mx - mn);
  }
}
if (process.env.TRACE_ARC) {
  const a = globalThis.__arcs || [];
  console.log("arcs:", a.length, JSON.stringify(a.slice(0, 6)), "maxR:", Math.max(...a.map((x) => x[2])));
}
if (process.env.DEBUG_SHAPES) {
    allShapes.push({ n, pts: pts.slice(0, 16), color: JSON.stringify(color), a: alpha });
  }
  if (process.env.DEBUG_SHAPES) {
    let mnx = Infinity, mxx = -Infinity, mny = Infinity, mxy = -Infinity;
    for (const p of pts) { mnx = Math.min(mnx, p[0]); mxx = Math.max(mxx, p[0]); mny = Math.min(mny, p[1]); mxy = Math.max(mxy, p[1]); }
    if (mxx - mnx > 120 || mxy - mny > 120) bigShapes.push({ n, w: Math.round(mxx - mnx), h: Math.round(mxy - mny), color: JSON.stringify(color), a: alpha.toFixed(2) });
  }
  let minY = Infinity,
    maxY = -Infinity;
  for (const p of pts) {
    if (p[1] < minY) minY = p[1];
    if (p[1] > maxY) maxY = p[1];
  }
  const y0 = Math.max(0, Math.ceil(minY)),
    y1 = Math.min(H - 1, Math.floor(maxY));
  for (let y = y0; y <= y1; y++) {
    const xs = [];
    for (let i = 0; i < n; i++) {
      const a = pts[i],
        b = pts[(i + 1) % n];
      if (a[1] === b[1]) continue;
      const yc = y + 0.5;
      if (yc >= Math.min(a[1], b[1]) && yc < Math.max(a[1], b[1])) {
        xs.push(a[0] + ((yc - a[1]) / (b[1] - a[1])) * (b[0] - a[0]));
      }
    }
    xs.sort((p, q) => p - q);
    for (let i = 0; i + 1 < xs.length; i += 2) {
      const xa = Math.max(0, Math.ceil(xs[i] - 0.5));
      const xb = Math.min(W - 1, Math.floor(xs[i + 1] - 0.5));
      for (let x = xa; x <= xb; x++) {
        const o = (y * W + x) * 3;
        const a = alpha;
        buf[o] = buf[o] * (1 - a) + color[0] * a;
        buf[o + 1] = buf[o + 1] * (1 - a) + color[1] * a;
        buf[o + 2] = buf[o + 2] * (1 - a) + color[2] * a;
      }
    }
  }
}

let path = [];
let alpha = 1;
const ctx = {
  globalAlpha: 1,
  fillStyle: "#000",
  strokeStyle: "#000",
  lineWidth: 1,
  font: "",
  textAlign: "",
  setTransform() {},
  save() {},
  restore() {},
  beginPath() {
    path = [];
  },
  moveTo(x, y) {
    path.push([x, y]);
  },
  lineTo(x, y) {
    path.push([x, y]);
  },
  closePath() {},
  fill() {
    const c = parseColor(this.fillStyle);
    if (process.env.TRACE_ALL) {
      const xs0 = path.map((p) => p[0]), ys0 = path.map((p) => p[1]);
      const bx = [Math.min(...xs0), Math.min(...ys0), Math.max(...xs0), Math.max(...ys0)];
      traceAll.push({ bx, c, a: this.globalAlpha, n: path.length });
    }
    if (process.env.TRACE_LONG) {
      const xs0 = path.map((p) => p[0]), ys0 = path.map((p) => p[1]);
      const w = Math.max(...xs0) - Math.min(...xs0), h = Math.max(...ys0) - Math.min(...ys0);
      if (w > 20) {
        globalThis.__l = (globalThis.__l || 0) + 1;
        if (globalThis.__l < 4)
          console.log("LONG FILL", path.length, JSON.stringify(c), this.globalAlpha, "w/h", Math.round(w), Math.round(h),
            "pts", JSON.stringify(path.slice(0, 4).map((p) => p.map((v) => Math.round(v)))));
      }
    }
    if (c && process.env.TRACE_WHITE && c[0] > 200 && c[1] > 200 && c[2] > 200) {
      globalThis.__n = (globalThis.__n || 0) + 1;
      if (globalThis.__n < 3) {
        const xs = path.map((p) => Math.round(p[0])), ys = path.map((p) => Math.round(p[1]));
        console.log("WHITE FILL", path.length, JSON.stringify(c), this.globalAlpha, "bbox", Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys));
      }
    }
    if (c) fillPoly(path, c, (c[3] ?? 1) * this.globalAlpha * alpha);
  },
  stroke() {
    const c = parseColor(this.strokeStyle);
    if (c && process.env.TRACE_WHITE && c[0] > 240 && c[1] > 240 && c[2] > 240 && !globalThis.__traced) {
      globalThis.__traced = true;
      console.log("WHITE STROKE TRACE", path.length, this.globalAlpha, new Error().stack.split("\n").slice(1, 8).join("\n"));
    }
    if (process.env.DEBUG_SHAPES) {
      const xs = path.map((p) => p[0]), ys = path.map((p) => p[1]);
      strokes.push({
        n: path.length,
        box: [Math.round(Math.min(...xs)), Math.round(Math.min(...ys)), Math.round(Math.max(...xs)), Math.round(Math.max(...ys))],
        color: JSON.stringify(c),
        a: this.globalAlpha.toFixed(2),
      });
    }
    if (c) fillPoly(path, c, (c[3] ?? 1) * this.globalAlpha * alpha * 0.8);
  },
  rect() {},
  strokeRect() {},
  arc(x, y, r) {
    if (process.env.TRACE_ARC) {
      globalThis.__arcs = globalThis.__arcs || [];
      globalThis.__arcs.push([Math.round(x), Math.round(y), Math.round(r)]);
    }
    path = [];
    for (let i = 0; i < 12; i++) {
      const a = (i / 12) * Math.PI * 2;
      path.push([x + Math.cos(a) * r, y + Math.sin(a) * r]);
    }
  },
  arcTo(x1, y1, x2, y2) {
    path.push([x2, y2]);
  },
  ellipse(x, y, rx, ry) {
    path = [];
    for (let i = 0; i < 16; i++) {
      const a = (i / 16) * Math.PI * 2;
      path.push([x + Math.cos(a) * rx, y + Math.sin(a) * ry]);
    }
  },
  fillText() {},
  strokeText() {},
  fillRect(x, y, w, h) {
    if (typeof this.fillStyle !== "string") return;
    const c = parseColor(this.fillStyle);
    if (!c) return;
    fillPoly([[x, y], [x + w, y], [x + w, y + h], [x, y + h]], c, (c[3] ?? 1) * this.globalAlpha);
  },
  createPattern() {
    return { setTransform() {} };
  },
  measureText() {
    return { width: 10 };
  },
};

const sink = Object.create(ctx);
let silent = 0;
for (const k of Object.keys(ctx)) {
  if (typeof ctx[k] === "function") sink[k] = () => {};
}
sink.fillRect = () => {};

function makeCanvas(w = 512, h = 512, primary = false) {
  return {
    width: w,
    height: h,
    style: {},
    getContext: () => (primary ? ctx : sink),
    addEventListener() {},
    removeEventListener() {},
  };
}
void silent;

const listeners = {};
globalThis.window = {
  innerWidth: W,
  innerHeight: H,
  devicePixelRatio: 1,
  addEventListener(t, f) {
    (listeners[t] = listeners[t] || []).push(f);
  },
  removeEventListener() {},
};
globalThis.document = { createElement: (tag) => makeCanvas() };
let pending = null;
globalThis.requestAnimationFrame = (fn) => {
  pending = fn;
  return 1;
};
globalThis.cancelAnimationFrame = () => {};
globalThis.performance = { now: () => Date.now() };
globalThis.DOMMatrix = class {
  constructor(m) {
    if (m) this.m = m;
  }
};

const out = mkdtempSync(join(tmpdir(), "eng-"));
await build({
  entryPoints: ["src/game/engine.ts"],
  bundle: true,
  format: "esm",
  outfile: join(out, "engine.mjs"),
  logLevel: "error",
});
const mod = await import(pathToFileURL(join(out, "engine.mjs")).href);

// background = deep sea
for (let i = 0; i < buf.length; i += 3) {
  buf[i] = 34;
  buf[i + 1] = 128;
  buf[i + 2] = 202;
}

const game = new mod.Game(makeCanvas(W, H, true));
let t = 0;
function tick(seconds, step = 1 / 60) {
  const n = Math.round(seconds / step);
  for (let i = 0; i < n; i++) {
    t += step * 1000;
    const fn = pending;
    pending = null;
    if (fn) {
      allShapes.length = 0;
      strokes.length = 0;
      for (let i = 0; i < buf.length; i += 3) {
        buf[i] = 34;
        buf[i + 1] = 128;
        buf[i + 2] = 202;
      }
      fn(t);
    }
  }
}

game.setSpeed(1);
game.time = 240 * 0.35; // fixed daytime for screenshots
tick(4);
if (process.env.CHAR_ONLY) {
  game.tiles.clear();
  game.structs.clear();
  game.flotage.length = 0;
  for (const c of game.colonists) {
    c.x = 0;
    c.y = 0;
    c.task = null;
    c.idleT = 1e9;
    c.moving = false;
    c.facing = Number(process.env.FACE ?? 0.6);
    c.faceT = c.facing;
  }
  game.colonists.length = 1;
  if (process.env.SWIM) {
    const c = game.colonists[0];
    c.x = 0.6;
    c.y = 0.4;
    c.swimming = true;
    c.moving = true;
    c.walk = 1.2;
    game.flotage.push({ id: 99, x: 2.6, y: 1.4, kind: process.env.SWIM, marked: true, claim: c.id, stuck: false, age: 0, retry: 0 });
    c.task = { type: "collect", phase: "swim", path: [], t: 0, re: 0, fl: game.flotage[0], swim: true };
  }
}

// zoom in close on the raft
game.s = Number(process.argv[2] ?? 120);
if (process.argv[4]) {
  const [cx, cy] = process.argv[4].split(",").map(Number);
  game.cam.x = cx;
  game.cam.y = cy;
} else game.focusRaft();
tick(0.5);
if (process.argv[5]) {
  const snap = game.snapshot();
  const first = snap.colonists[0];
  if (first) game.selectColonist(first.id);
  game.cam.x = Number(process.argv[6] ?? game.cam.x);
  game.cam.y = Number(process.argv[7] ?? game.cam.y);
}
tick(0.3);

// render one more frame into the raster
pending && pending((t += 17));

function png(w, h, rgb) {
  const raw = Buffer.alloc((w * 3 + 1) * h);
  for (let y = 0; y < h; y++) {
    raw[y * (w * 3 + 1)] = 0;
    Buffer.from(rgb.buffer, y * w * 3, w * 3).copy(raw, y * (w * 3 + 1) + 1);
  }
  const idat = deflateSync(raw);
  const chunks = [];
  const chunk = (type, data) => {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length);
    const td = Buffer.concat([Buffer.from(type), data]);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(td) >>> 0);
    chunks.push(len, td, crc);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8;
  ihdr[9] = 2;
  chunk("IHDR", ihdr);
  chunk("IDAT", idat);
  chunk("IEND", Buffer.alloc(0));
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), ...chunks]);
}

let table = null;
function crc32(b) {
  if (!table) {
    table = new Int32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      table[n] = c;
    }
  }
  let c = -1;
  for (let i = 0; i < b.length; i++) c = table[(c ^ b[i]) & 0xff] ^ (c >>> 8);
  return c ^ -1;
}

const file = process.argv[3] ?? "shot.png";
if (process.env.DEBUG_SHAPES) {
  const seen = new Map();
  for (const b of bigShapes) {
    const k = b.w + "x" + b.h + b.color + "a" + b.a;
    seen.set(k, (seen.get(k) || 0) + 1);
  }
  console.log("big shapes:", [...seen.entries()].slice(0, 25));
  // whitish shapes
  const whites = allShapes.filter((s2) => !Array.isArray(s2.color) && false);
  void whites;
  const summary = new Map();
  for (const s2 of allShapes) {
    const xs = s2.pts.map((p) => Math.round(p[0])), ys = s2.pts.map((p) => Math.round(p[1]));
    const key2 = s2.n + "|" + s2.color + "|" + s2.a;
    const e = summary.get(key2) || { count: 0, sample: [] };
    e.count++;
    if (e.sample.length < 2) e.sample.push([xs, ys]);
    summary.set(key2, e);
  }
  const tall = allShapes.filter((s2) => {
    const xs = s2.pts.map((p) => p[0]), ys = s2.pts.map((p) => p[1]);
    const w = Math.max(...xs) - Math.min(...xs), h = Math.max(...ys) - Math.min(...ys);
    return w > 30 && h > 60;
  });
  const buckets = new Map();
  for (const t of tall) {
    const k2 = t.n + "|" + t.color + "|" + t.a.toFixed(2);
    const b = buckets.get(k2) || [];
    if (b.length < 1) b.push(t.pts.map((p) => p.map((v) => Math.round(v))));
    buckets.set(k2, b);
  }
  console.log("tall shapes:", tall.length, JSON.stringify([...buckets.entries()].slice(0, 6)));
  let P0 = (process.env.POINT || "").split(",").map(Number);
  if (isNaN(P0[0])) {
    P0 = [0, 0];
  }
  for (let y = 0; y < H && !P0[0]; y += 3) {
    for (let x = 0; x < W; x += 1) {
      const o = (y * W + x) * 3;
      if (buf[o] > 150 && buf[o + 1] > 150 && buf[o + 2] > 150) {
        P0 = [x, y];
        break;
      }
    }
  }
  if (process.env.POINT) {
    const o = (P0[1] * W + P0[0]) * 3;
    console.log("pixel", P0, buf[o], buf[o + 1], buf[o + 2]);
  }
  console.log("streak pixel:", P0, "rgb:", buf[(P0[1] * W + P0[0]) * 3], buf[(P0[1] * W + P0[0]) * 3 + 1], buf[(P0[1] * W + P0[0]) * 3 + 2]);
  const hits = allShapes.filter((s2) => {
    const xs = s2.pts.map((p) => p[0]), ys = s2.pts.map((p) => p[1]);
    return P0[0] >= Math.min(...xs) && P0[0] <= Math.max(...xs) && P0[1] >= Math.min(...ys) && P0[1] <= Math.max(...ys);
  });
  console.log("shapes at point:", hits.length, JSON.stringify(hits.slice(0, 5)));
  const sh = strokes.filter((st) => P0[0] >= st.box[0] && P0[0] <= st.box[2] && P0[1] >= st.box[1] && P0[1] <= st.box[3]);
  console.log("strokes at point:", sh.length, JSON.stringify(sh.slice(0, 5)));
  if (process.env.TRACE_ALL) {
    const hits2 = traceAll.filter((t2) => P0[0] >= t2.bx[0] && P0[0] <= t2.bx[2] && P0[1] >= t2.bx[1] && P0[1] <= t2.bx[3]);
    console.log("fills at point:", hits2.length, JSON.stringify(hits2.slice(-6)));
  // chain trace: consecutive white fills drifting diagonally = repeated strokes
  const whites = traceAll.filter((t2) => t2.c[0] > 250 && t2.c[1] > 250 && t2.c[2] > 250 && t2.n === 12);
  console.log("white small fills:", whites.length, JSON.stringify(whites.slice(0, 3)));
  console.log("white bbox spread:", whites.length ? JSON.stringify([Math.min(...whites.map((w2) => w2.bx[0])), Math.min(...whites.map((w2) => w2.bx[1])), Math.max(...whites.map((w2) => w2.bx[2])), Math.max(...whites.map((w2) => w2.bx[3]))]) : "none");
  }
  const sb = new Map();
  for (const st of strokes) {
    const k2 = st.n + "|" + st.color + "|" + st.a;
    const b = sb.get(k2) || [];
    if (b.length < 3) b.push(st.box);
    sb.set(k2, b);
  }
  console.log("strokes:", strokes.length, JSON.stringify([...sb.entries()].slice(0, 10)));
}
writeFileSync(file, png(W, H, buf));
console.log("wrote", file);
