import {
  BUILDINGS,
  BuildKind,
  DAY_LENGTH,
  RES_INFO,
  RES_KEYS,
  ResKey,
  STRUCT_NAMES,
  SelectionSnap,
  Snapshot,
  ToolKind,
  Toast,
} from "./data";

type RGB = [number, number, number];
type V3 = [number, number, number];
type V2 = [number, number];
interface Pt {
  x: number;
  y: number;
}

interface Tile {
  kind: "floor";
  x: number;
  y: number;
  bp: boolean;
  progress: number;
  claim: number | null;
  dead: boolean;
  pink: boolean;
}

interface Struct {
  id: number;
  kind: "tree" | BuildKind;
  x: number;
  y: number;
  bp: boolean;
  progress: number;
  claim: number | null;
  dead: boolean;
  fruit: number;
  fruitT: number;
}

type FlotageKind = "wood" | "planks" | "barrel" | "crate" | "survivor";
interface Flotage {
  id: number;
  x: number;
  y: number;
  kind: FlotageKind;
  marked: boolean;
  claim: number | null;
  stuck: boolean;
  age: number;
  retry: number;
}

type TaskType = "eat" | "sleep" | "build" | "craft" | "fish" | "harvest" | "collect" | "move";
type TaskPhase = "move" | "swim" | "work";
interface Task {
  type: TaskType;
  phase: TaskPhase;
  path: Pt[];
  t: number;
  re: number;
  struct?: Struct;
  tile?: Tile;
  fl?: Flotage;
  /** true while the colonist is in the water */
  swim: boolean;
}

interface Look {
  skin: RGB;
  hair: RGB;
  shirt: RGB;
  pants: RGB;
}

interface Colonist {
  id: number;
  name: string;
  x: number;
  y: number;
  hunger: number;
  energy: number;
  health: number;
  task: Task | null;
  idleT: number;
  /** current body heading, radians (0 = +x) */
  facing: number;
  /** desired heading, smoothly chased by `facing` */
  faceT: number;
  walk: number;
  lying: boolean;
  look: Look;
  moving: boolean;
  swimming: boolean;
}

type Sel = { kind: "colonist" | "struct" | "flotage" | "tile"; id: number; x?: number; y?: number } | null;

const key = (x: number, y: number) => x + "," + y;
const DIRS: [number, number][] = [
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
];
const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));
const norm = (a: number) => Math.atan2(Math.sin(a), Math.cos(a));
const rgb = (c: RGB, k = 1, a = 1) =>
  `rgba(${Math.round(clamp(c[0] * k, 0, 255))},${Math.round(clamp(c[1] * k, 0, 255))},${Math.round(
    clamp(c[2] * k, 0, 255)
  )},${a})`;
const tint = (c: RGB, k: number): RGB => [c[0] * k, c[1] * k, c[2] * k];
const hex = (h: string): RGB => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];
export const toCss = (c: RGB) => rgb(c);

const LOOKS: Look[] = [
  { skin: hex("#d9a6a6"), hair: hex("#f3d6f7"), shirt: hex("#f4a8d2"), pants: hex("#3a2347") },
  { skin: hex("#f0a89a"), hair: hex("#d9d9e0"), shirt: hex("#f08a82"), pants: hex("#f08a82") },
  { skin: hex("#c58c6a"), hair: hex("#2a1a14"), shirt: hex("#6ab5e8"), pants: hex("#2f4a7a") },
  { skin: hex("#e8c49a"), hair: hex("#b8672a"), shirt: hex("#9ad66a"), pants: hex("#4a5a2a") },
  { skin: hex("#8a5a3c"), hair: hex("#111111"), shirt: hex("#f2d25a"), pants: hex("#6a4a2a") },
  { skin: hex("#f1c9a8"), hair: hex("#7a3a8a"), shirt: hex("#c8c8d8"), pants: hex("#44445a") },
];
const NAMES = [
  "Niall Pascal",
  "Shontae Montoya",
  "Odalys Brandt",
  "Tobias Wren",
  "Maren Koa",
  "Ignacio Vale",
  "Priya Lindqvist",
  "Dov Okafor",
  "Sunniva Reyes",
  "Calloway Finch",
];

export function colorToHex(c: RGB) {
  return "#" + c.map((v) => Math.round(v).toString(16).padStart(2, "0")).join("");
}
export function lookColors(i: number) {
  const l = LOOKS[i % LOOKS.length];
  return { shirt: colorToHex(l.shirt), hair: colorToHex(l.hair) };
}

// ------------------------------------------------------------------ geometry
// Everything is a set of outward-CCW faces in world space. Faces are culled by
// their screen winding and painted far-to-near, so nothing ever shows through.

interface Face3 {
  v: V3[];
  col: RGB;
  a?: number;
}

const LIGHT: V3 = (() => {
  const l = Math.hypot(0.36, 0.46, 0.82);
  return [0.36 / l, 0.46 / l, 0.82 / l];
})();

/** ring of `n` points, counter-clockwise seen from above (+z) */
function ngon(r: number, n = 8, rot = Math.PI / 8): V2[] {
  const out: V2[] = [];
  for (let i = 0; i < n; i++) {
    const a = rot + (i * Math.PI * 2) / n;
    out.push([Math.cos(a) * r, Math.sin(a) * r]);
  }
  return out;
}

/** rounded (bevelled) rectangle ring, counter-clockwise from above */
function roundRect(hw: number, hd: number, bev = 0): V2[] {
  const b = Math.max(0, Math.min(bev, hw * 0.7, hd * 0.7));
  if (b < 0.004)
    return [
      [-hw, -hd],
      [hw, -hd],
      [hw, hd],
      [-hw, hd],
    ];
  return [
    [-hw + b, -hd],
    [hw - b, -hd],
    [hw, -hd + b],
    [hw, hd - b],
    [hw - b, hd],
    [-hw + b, hd],
    [-hw, hd - b],
    [-hw, -hd + b],
  ];
}

interface Ring {
  p: V2[];
  z: number;
}

/** stitch rings into a closed solid: quads between rings + both caps */
function stack(rings: Ring[]): V3[][] {
  const out: V3[][] = [];
  for (let i = 0; i + 1 < rings.length; i++) {
    const a = rings[i],
      b = rings[i + 1];
    const n = Math.min(a.p.length, b.p.length);
    for (let j = 0; j < n; j++) {
      const j2 = (j + 1) % n;
      out.push([
        [a.p[j][0], a.p[j][1], a.z],
        [a.p[j2][0], a.p[j2][1], a.z],
        [b.p[j2][0], b.p[j2][1], b.z],
        [b.p[j][0], b.p[j][1], b.z],
      ]);
    }
  }
  const top = rings[rings.length - 1];
  out.push(top.p.map((p) => [p[0], p[1], top.z] as V3));
  const bot = rings[0];
  out.push([...bot.p].reverse().map((p) => [p[0], p[1], bot.z] as V3));
  return out;
}

/** chamfered / tapered box */
function rbox(hw: number, hd: number, z0: number, z1: number, bev = 0.07, topScale = 1): V3[][] {
  const b = Math.min(bev, hw * 0.7, hd * 0.7);
  return stack([
    { p: roundRect(hw, hd, b), z: z0 },
    { p: roundRect(hw * topScale, hd * topScale, b * topScale), z: z1 },
  ]);
}

/** tapered n-gon column (barrel / trunk / limb / head) */
function rcyl(r0: number, r1: number, z0: number, z1: number, n = 8, rot = Math.PI / 8): V3[][] {
  return stack([
    { p: ngon(Math.max(r0, 0.001), n, rot), z: z0 },
    { p: ngon(Math.max(r1, 0.001), n, rot), z: z1 },
  ]);
}

/** rounded blob (octahedron) – fruit, hands, leaf puffs */
function blob(r: number, h: number): V3[][] {
  const e: V3 = [0, 0, h];
  const w: V3 = [0, 0, 0];
  const q: V3[] = [
    [r, 0, h * 0.5],
    [0, r, h * 0.5],
    [-r, 0, h * 0.5],
    [0, -r, h * 0.5],
  ];
  const out: V3[][] = [];
  for (let i = 0; i < 4; i++) {
    const a = q[i],
      b = q[(i + 1) % 4];
    out.push([w, b, a]);
    out.push([e, a, b]);
  }
  return out;
}

/** smooth lathe: rings derived from a radius profile */
function lathe(profile: [number, number][], n = 8, z0 = 0): V3[][] {
  return stack(profile.map(([r, z]) => ({ p: ngon(r, n), z: z0 + z })));
}

/** tapered limb hanging from the origin down -z (shoulder / hip pivot) */
function limb(r0: number, r1: number, len: number, n = 7): V3[][] {
  return stack([
    { p: ngon(r0, n), z: 0 },
    { p: ngon(r0 * 0.92 + r1 * 0.08, n), z: -len * 0.5 },
    { p: ngon(r1, n), z: -len },
  ]);
}

const translate = (faces: V3[][], x: number, y: number, z: number): V3[][] =>
  faces.map((f) => f.map((v) => [v[0] + x, v[1] + y, v[2] + z] as V3));

/** rotate about the local y axis (pitch, in the x/z plane) around a pivot */
const pitchFaces = (faces: V3[][], a: number, pivot: V3): V3[][] => {
  if (!a) return faces;
  const c = Math.cos(a),
    s = Math.sin(a);
  return faces.map((f) =>
    f.map((v) => {
      const x = v[0] - pivot[0],
        z = v[2] - pivot[2];
      return [pivot[0] + x * c + z * s, v[1], pivot[2] - x * s + z * c] as V3;
    })
  );
};


export class Game {
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private W = 800;
  private H = 600;
  private dpr = 1;
  private raf = 0;
  private last = 0;

  // camera
  private cam = { x: 0.5, y: 0.5 };
  private s = 58;
  private ang = 0;
  private angT = 0;
  private keys = new Set<string>();

  // world
  private tiles = new Map<string, Tile>();
  private structs = new Map<string, Struct>();
  private colonists: Colonist[] = [];
  private flotage: Flotage[] = [];
  private nextId = 1;
  private res: Record<ResKey, number> = { wood: 3, plank: 40, rope: 16, lemon: 5, fish: 0 };
  private time = DAY_LENGTH * 0.3;
  private realTime = 0;
  private speed = 1;
  private lastSpeed = 1;
  private cur: Pt;
  private spawnT = 6;
  private over = false;
  private toasts: Toast[] = [];
  private lookIdx = 0;

  // interaction
  private tool: ToolKind | null = null;
  private hover: Pt | null = null;
  private sel: Sel = null;
  /** colonist currently taking orders (RTS style) */
  private cmd: number | null = null;
  /** short-lived click feedback marker */
  private ping: { x: number; y: number; at: number; ok: boolean } | null = null;
  private mouse = { x: 0, y: 0, down: false, rdown: false, rmoved: 0 };
  private lastPaint = "";
  private pattern: CanvasPattern | null = null;
  private bgCanvas: HTMLCanvasElement;
  private cleanup: (() => void)[] = [];

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    this.ctx = canvas.getContext("2d")!;
    const a = Math.random() * Math.PI * 2;
    this.cur = { x: Math.cos(a), y: Math.sin(a) };
    this.bgCanvas = this.makeOcean();
    this.initWorld();
    this.bindEvents();
    this.resize();
    this.last = performance.now();
    const loop = (t: number) => {
      const dt = Math.min(0.05, (t - this.last) / 1000);
      this.last = t;
      this.frame(dt);
      this.raf = requestAnimationFrame(loop);
    };
    this.raf = requestAnimationFrame(loop);
  }

  destroy() {
    cancelAnimationFrame(this.raf);
    this.cleanup.forEach((f) => f());
  }

  // ---------------------------------------------------------------- setup
  private initWorld() {
    const add = (x: number, y: number, pink = false) =>
      this.tiles.set(key(x, y), { kind: "floor", x, y, bp: false, progress: 1, claim: null, dead: false, pink });
    add(0, 0, true);
    add(1, 0);
    add(0, 1);
    add(-1, 0);
    this.addStruct("tree", 0, 0, false).fruit = 3;
    this.addStruct("crate", 1, 0, false);
    this.addColonist(-1, 0);
    this.addColonist(0, 1);
  }

  private addStruct(kind: Struct["kind"], x: number, y: number, bp: boolean) {
    const s: Struct = {
      id: this.nextId++,
      kind,
      x,
      y,
      bp,
      progress: bp ? 0 : 1,
      claim: null,
      dead: false,
      fruit: 0,
      fruitT: 0,
    };
    this.structs.set(key(x, y), s);
    return s;
  }

  private addColonist(x: number, y: number, name?: string) {
    const idx = this.lookIdx++;
    const c: Colonist = {
      id: this.nextId++,
      name: name ?? NAMES[idx % NAMES.length],
      x,
      y,
      hunger: 85 - Math.random() * 15,
      energy: 90 - Math.random() * 15,
      health: 100,
      task: null,
      idleT: 3 + Math.random() * 4,
      facing: Math.random() * Math.PI * 2,
      faceT: Math.random() * Math.PI * 2,
      walk: Math.random() * 6,
      lying: false,
      look: LOOKS[idx % LOOKS.length],
      moving: false,
      swimming: false,
    };
    this.colonists.push(c);
    return c;
  }

  private makeOcean() {
    const N = 8;
    const cell = 64;
    const size = N * cell;
    const cv = document.createElement("canvas");
    cv.width = cv.height = size;
    const g = cv.getContext("2d")!;
    const pts: Pt[][] = [];
    for (let i = 0; i < N; i++) {
      pts[i] = [];
      for (let j = 0; j < N; j++) {
        pts[i][j] = {
          x: i * cell + (Math.random() - 0.5) * cell * 0.7,
          y: j * cell + (Math.random() - 0.5) * cell * 0.7,
        };
      }
    }
    const P = (i: number, j: number): Pt => {
      const ii = ((i % N) + N) % N;
      const jj = ((j % N) + N) % N;
      const p = pts[ii][jj];
      return { x: p.x + (i - ii) * cell, y: p.y + (j - jj) * cell };
    };
    const tri = (a: Pt, b: Pt, c: Pt) => {
      const l = Math.random();
      const col: RGB = [24 + l * 40, 130 + l * 50, 215 + l * 30];
      g.fillStyle = rgb(col);
      g.strokeStyle = rgb(col);
      g.lineWidth = 1;
      for (const ox of [-size, 0, size])
        for (const oy of [-size, 0, size]) {
          g.beginPath();
          g.moveTo(a.x + ox, a.y + oy);
          g.lineTo(b.x + ox, b.y + oy);
          g.lineTo(c.x + ox, c.y + oy);
          g.closePath();
          g.fill();
          g.stroke();
        }
    };
    for (let i = 0; i < N; i++)
      for (let j = 0; j < N; j++) {
        tri(P(i, j), P(i + 1, j), P(i, j + 1));
        tri(P(i + 1, j), P(i + 1, j + 1), P(i, j + 1));
      }
    return cv;
  }

  // ---------------------------------------------------------------- public api
  setTool(t: ToolKind | null) {
    this.tool = t;
    if (t) {
      this.sel = null;
      this.cmd = null;
    }
  }
  setSpeed(n: number) {
    if (n > 0) this.lastSpeed = n;
    this.speed = n;
  }
  togglePause() {
    this.setSpeed(this.speed === 0 ? this.lastSpeed : 0);
  }
  rotate(dir: number) {
    this.angT += (dir * Math.PI) / 2;
  }
  focusFlotage() {
    if (!this.flotage.length) return;
    let best = this.flotage[0];
    let bd = 1e9;
    for (const f of this.flotage) {
      const d = Math.hypot(f.x - this.cam.x, f.y - this.cam.y);
      if (d < bd && d > 0.5) {
        bd = d;
        best = f;
      }
    }
    this.cam.x = best.x;
    this.cam.y = best.y;
  }
  focusRaft() {
    const c = this.raftCenter();
    this.cam.x = c.x;
    this.cam.y = c.y;
  }
  /** Salvage / Cancel salvage – only ever called from the selection panel */
  toggleMark() {
    if (this.sel?.kind === "flotage") {
      const f = this.flotage.find((f) => f.id === this.sel!.id);
      if (f) this.markFlotage(f, !f.marked);
    }
  }
  demolishSelected() {
    if (this.sel?.kind === "struct") {
      const s = this.structById(this.sel.id);
      if (s) this.demolishAt(s.x, s.y, true);
      this.sel = null;
    }
  }
  clearSelection() {
    this.sel = null;
    this.cmd = null;
  }
  selectColonist(id: number) {
    this.sel = { kind: "colonist", id };
    this.tool = null;
    this.cmd = id;
    const c = this.colonistById(id);
    if (c) {
      this.cam.x = c.x;
      this.cam.y = c.y;
      this.toast(`${c.name} awaits orders – click a target.`);
    }
  }
  /** drop the current job of the commanded colonist */
  stopColonist() {
    const c = this.cmd != null ? this.colonistById(this.cmd) : null;
    if (c) {
      this.release(c);
      c.idleT = 3;
      this.toast(`${c.name} stops what they were doing.`);
    }
  }
  /** panel button: give the commanded colonist the currently selected target */
  assignSelected() {
    const c = this.cmd != null ? this.colonistById(this.cmd) : null;
    if (!c || !this.sel) return;
    if (this.sel.kind === "flotage") {
      const f = this.flotage.find((f) => f.id === this.sel!.id);
      if (!f) return;
      if (!f.marked) {
        this.toast("Mark it for salvage first.", true);
        return;
      }
      if (this.orderSalvage(c, f)) this.toast(`${c.name} swims out to the flotage.`);
    } else if (this.sel.kind === "struct") {
      const s = this.structById(this.sel.id);
      if (s) this.assignStruct(c, s);
    } else if (this.sel.kind === "tile") {
      const t = this.tileAt(this.sel.x!, this.sel.y!);
      if (!t) return;
      if (t.bp) {
        if (this.orderBuild(c, t)) this.toast(`${c.name} starts building.`);
      } else if (this.orderMove(c, t.x, t.y)) this.toast(`${c.name} heads over.`);
    }
  }

  // ---------------------------------------------------------------- helpers
  private pingAt(x: number, y: number, ok = true) {
    this.ping = { x, y, at: this.realTime, ok };
  }

  private toast(text: string, bad = false) {
    this.toasts.push({ id: this.nextId++, text, at: Date.now(), bad });
    if (this.toasts.length > 6) this.toasts.shift();
  }

  private structAt(x: number, y: number) {
    return this.structs.get(key(x, y));
  }
  private structById(id: number) {
    let found: Struct | null = null;
    this.structs.forEach((s) => {
      if (s.id === id) found = s;
    });
    return found as Struct | null;
  }
  private colonistById(id: number) {
    return this.colonists.find((c) => c.id === id) ?? null;
  }
  private tileAt(x: number, y: number) {
    return this.tiles.get(key(x, y));
  }
  private walkable(x: number, y: number) {
    const t = this.tileAt(x, y);
    return !!t && !t.bp && !this.structAt(x, y);
  }
  private inWater(x: number, y: number) {
    return !this.tileAt(Math.round(x), Math.round(y));
  }

  private raftCenter(): Pt {
    let sx = 0,
      sy = 0,
      n = 0;
    this.tiles.forEach((t) => {
      sx += t.x;
      sy += t.y;
      n++;
    });
    return n ? { x: sx / n, y: sy / n } : { x: 0, y: 0 };
  }

  private cap() {
    let crates = 0;
    this.structs.forEach((s) => {
      if (s.kind === "crate" && !s.bp) crates++;
    });
    return Math.max(1, crates) * 60;
  }
  private buoyancy() {
    let n = 0;
    this.tiles.forEach((t) => {
      if (!t.bp) n++;
    });
    return n * 6;
  }
  private load() {
    let l = 0;
    this.structs.forEach((s) => {
      l += s.kind === "tree" ? 6 : BUILDINGS[s.kind].weight;
    });
    l += this.colonists.length;
    l += RES_KEYS.reduce((a, k) => a + this.res[k], 0) * 0.1;
    return l;
  }

  private addRes(k: ResKey, n: number) {
    const room = this.cap() - this.res[k];
    const add = clamp(n, 0, Math.max(0, room));
    this.res[k] += add;
    return add;
  }

  private daylight() {
    const t = (this.time % DAY_LENGTH) / DAY_LENGTH;
    return clamp(0.5 + 0.8 * Math.sin(2 * Math.PI * (t - 0.25)), 0, 1);
  }

  // ---------------------------------------------------------------- building
  private canPlace(kind: BuildKind, x: number, y: number): string | null {
    const def = BUILDINGS[kind];
    for (const k of Object.keys(def.cost) as ResKey[]) {
      if (this.res[k] < (def.cost[k] ?? 0)) return `Not enough ${RES_INFO[k].name.toLowerCase()}`;
    }
    if (kind === "floor") {
      if (this.tileAt(x, y)) return "Tile occupied";
      const adj = DIRS.some(([dx, dy]) => {
        const t = this.tileAt(x + dx, y + dy);
        return t && !t.bp;
      });
      if (!adj) return "Must touch an existing floor";
      return null;
    }
    const t = this.tileAt(x, y);
    if (!t || t.bp) return "Needs a finished floor";
    if (this.structAt(x, y)) return "Tile occupied";
    if (this.colonists.some((c) => Math.hypot(c.x - x, c.y - y) < 0.8)) return "A colonist is in the way";
    if (this.load() + def.weight > this.buoyancy()) return "Not enough buoyancy – extend the raft";
    if (kind === "rod") {
      const edge = DIRS.some(([dx, dy]) => !this.tileAt(x + dx, y + dy));
      if (!edge) return "Must be on the raft edge";
    }
    if (!this.staysConnected(x, y)) return "Would block the walkway";
    return null;
  }

  private staysConnected(bx: number, by: number) {
    const open: Pt[] = [];
    this.tiles.forEach((t) => {
      if (!t.bp && !(t.x === bx && t.y === by) && !this.structAt(t.x, t.y)) open.push({ x: t.x, y: t.y });
    });
    if (open.length <= 1) return open.length === 1;
    const seen = new Set<string>([key(open[0].x, open[0].y)]);
    const q = [open[0]];
    while (q.length) {
      const p = q.pop()!;
      for (const [dx, dy] of DIRS) {
        const nx = p.x + dx,
          ny = p.y + dy;
        const k = key(nx, ny);
        if (seen.has(k)) continue;
        if (nx === bx && ny === by) continue;
        if (!this.walkable(nx, ny)) continue;
        seen.add(k);
        q.push({ x: nx, y: ny });
      }
    }
    return seen.size === open.length;
  }

  private place(kind: BuildKind, x: number, y: number, loud: boolean) {
    const err = this.canPlace(kind, x, y);
    if (err) {
      if (loud) this.toast(err, true);
      return;
    }
    const def = BUILDINGS[kind];
    (Object.keys(def.cost) as ResKey[]).forEach((k) => (this.res[k] -= def.cost[k] ?? 0));
    if (kind === "floor") {
      this.tiles.set(key(x, y), { kind: "floor", x, y, bp: true, progress: 0, claim: null, dead: false, pink: false });
    } else {
      this.addStruct(kind, x, y, true);
    }
  }

  private refund(cost: Partial<Record<ResKey, number>>, f: number) {
    (Object.keys(cost) as ResKey[]).forEach((k) => this.addRes(k, Math.floor((cost[k] ?? 0) * f)));
  }

  private demolishAt(x: number, y: number, loud: boolean) {
    const s = this.structAt(x, y);
    if (s) {
      if (s.kind === "tree") {
        if (loud) this.toast("The lemon tree is too precious to chop!", true);
        return;
      }
      s.dead = true;
      this.structs.delete(key(x, y));
      this.refund(BUILDINGS[s.kind].cost, s.bp ? 1 : 0.5);
      return;
    }
    const t = this.tileAt(x, y);
    if (t) {
      if (!t.bp) {
        let n = 0;
        this.tiles.forEach((tt) => {
          if (!tt.bp) n++;
        });
        if (n <= 1) return;
        if (this.colonists.some((c) => Math.round(c.x) === x && Math.round(c.y) === y)) {
          if (loud) this.toast("A colonist is standing there", true);
          return;
        }
        if (this.structAt(x, y)) return;
        this.tiles.delete(key(x, y));
        const ok = this.rafConnected();
        if (!ok) {
          this.tiles.set(key(x, y), t);
          if (loud) this.toast("That would split the raft", true);
          return;
        }
      } else {
        this.tiles.delete(key(x, y));
      }
      t.dead = true;
      this.refund(BUILDINGS.floor.cost, t.bp ? 1 : 0.5);
    }
  }

  private rafConnected() {
    const all: Tile[] = [];
    this.tiles.forEach((t) => {
      if (!t.bp) all.push(t);
    });
    if (!all.length) return false;
    const seen = new Set<string>([key(all[0].x, all[0].y)]);
    const q = [all[0]];
    while (q.length) {
      const p = q.pop()!;
      for (const [dx, dy] of DIRS) {
        const t = this.tileAt(p.x + dx, p.y + dy);
        if (t && !t.bp && !seen.has(key(t.x, t.y))) {
          seen.add(key(t.x, t.y));
          q.push(t);
        }
      }
    }
    return seen.size === all.length;
  }

  // ---------------------------------------------------------------- pathfinding
  private bfs<T>(sx: number, sy: number, goal: (x: number, y: number) => T | null): { path: Pt[]; target: T } | null {
    const q: Pt[] = [{ x: sx, y: sy }];
    const prev = new Map<string, string | null>();
    prev.set(key(sx, sy), null);
    let head = 0;
    while (head < q.length) {
      const p = q[head++];
      const g = goal(p.x, p.y);
      if (g) {
        const path: Pt[] = [];
        let k: string | null = key(p.x, p.y);
        while (k && prev.get(k) !== null && prev.get(k) !== undefined) {
          const [px, py] = k.split(",").map(Number);
          path.push({ x: px, y: py });
          k = prev.get(k)!;
        }
        path.reverse();
        return { path, target: g };
      }
      for (const [dx, dy] of DIRS) {
        const nx = p.x + dx,
          ny = p.y + dy;
        const k = key(nx, ny);
        if (prev.has(k) || !this.walkable(nx, ny)) continue;
        prev.set(k, key(p.x, p.y));
        q.push({ x: nx, y: ny });
      }
    }
    return null;
  }

  private pathTo(c: Colonist, tx: number, ty: number): Pt[] | null {
    if (Math.round(c.x) === tx && Math.round(c.y) === ty && this.walkable(tx, ty)) return [];
    if (!this.walkable(tx, ty)) return null;
    const r = this.bfs(Math.round(c.x), Math.round(c.y), (x, y) => (x === tx && y === ty ? true : null));
    return r ? r.path : null;
  }

  /** path that ends on a raft tile next to (tx,ty) – diagonals count, so a
   *  blueprint tucked between two structures is still reachable */
  private pathAdjacentTo(c: Colonist, tx: number, ty: number): Pt[] | null {
    const near = (x: number, y: number) =>
      Math.max(Math.abs(x - tx), Math.abs(y - ty)) === 1 && Math.abs(x - tx) + Math.abs(y - ty) <= 2;
    const here = Math.round(c.x),
      hereY = Math.round(c.y);
    // standing right next to it already?
    if (this.walkable(here, hereY) && near(here, hereY)) return [];
    const r = this.bfs(here, hereY, (x, y) => (this.walkable(x, y) && near(x, y) ? true : null));
    return r ? r.path : null;
  }

  private nearestRaftTile(x: number, y: number): Tile | null {
    let best: Tile | null = null;
    let bd = 1e9;
    this.tiles.forEach((t) => {
      if (t.bp) return;
      const d = Math.hypot(t.x - x, t.y - y);
      if (d < bd) {
        bd = d;
        best = t;
      }
    });
    return best;
  }

  private isEdgeTile(t: Tile) {
    return DIRS.some(([dx, dy]) => !this.tileAt(t.x + dx, t.y + dy));
  }

  /**
   * Pick the raft edge tile to dive from: the reachable edge tile closest to the
   * flotage. Also verifies the swim distance is sane.
   */
  private launchSpot(c: Colonist, f: Flotage): { tile: Tile; path: Pt[] } | null {
    const edges: Tile[] = [];
    this.tiles.forEach((t) => {
      if (!t.bp && !this.structAt(t.x, t.y) && this.isEdgeTile(t)) edges.push(t);
    });
    edges.sort((a, b) => Math.hypot(a.x - f.x, a.y - f.y) - Math.hypot(b.x - f.x, b.y - f.y));
    for (const t of edges) {
      if (Math.hypot(t.x - f.x, t.y - f.y) > 17) continue;
      const path = this.pathTo(c, t.x, t.y);
      if (path) return { tile: t, path };
    }
    return null;
  }

  private foodCount() {
    return this.res.lemon + this.res.fish;
  }

  private release(c: Colonist) {
    const t = c.task;
    if (t) {
      if (t.struct && t.struct.claim === c.id) t.struct.claim = null;
      if (t.tile && t.tile.claim === c.id) t.tile.claim = null;
      if (t.fl && t.fl.claim === c.id) t.fl.claim = null;
    }
    if (c.lying) c.lying = false;
    c.task = null;
    c.moving = false;
    c.swimming = false;
  }

  // ---------------------------------------------------------------- survival
  /**
   * Colonists only ever look after themselves. All work is player-ordered.
   */
  private pickSurvival(c: Colonist): Task | null {
    const mk = (type: TaskType, phase: TaskPhase, path: Pt[] = []): Task => ({
      type,
      phase,
      path,
      t: 0,
      re: 0,
      swim: false,
    });
    if (c.hunger < 45 && this.foodCount() > 0) return mk("eat", "work");

    const dl = this.daylight();
    if (c.energy < 25 || (dl < 0.3 && c.energy < 75)) {
      let best: Struct | null = null;
      let bd = 1e9;
      this.structs.forEach((s) => {
        if (s.kind !== "bed" || s.bp || s.claim) return;
        const d = Math.hypot(s.x - c.x, s.y - c.y);
        if (d < bd) {
          bd = d;
          best = s;
        }
      });
      if (best) {
        const bed = best as Struct;
        const path = this.pathAdjacentTo(c, bed.x, bed.y) ?? (this.walkable(bed.x, bed.y) ? [] : null);
        if (path) {
          bed.claim = c.id;
          const t = mk("sleep", path.length ? "move" : "work", path);
          t.struct = bed;
          return t;
        }
      }
      return mk("sleep", "work");
    }
    return null;
  }

  // ---------------------------------------------------------------- orders
  private orderMove(c: Colonist, tx: number, ty: number): boolean {
    const path = this.pathTo(c, tx, ty);
    if (!path) {
      this.toast("Can't reach that spot.", true);
      return false;
    }
    this.release(c);
    c.task = { type: "move", phase: "move", path, t: 0, re: 0, swim: false };
    return true;
  }

  private orderSalvage(c: Colonist, f: Flotage): boolean {
    if (!f.marked) {
      this.toast("Mark that flotage for salvage first.", true);
      return false;
    }
    if (f.claim != null && f.claim !== c.id) {
      const other = this.colonistById(f.claim);
      this.toast(`${other?.name ?? "Someone"} is already after it.`, true);
      return false;
    }
    this.release(c);
    const t: Task = { type: "collect", phase: "move", path: [], t: 0, re: 0, fl: f, swim: false };
    // already close enough to just dive in from here?
    if (Math.hypot(f.x - c.x, f.y - c.y) <= 2) {
      f.claim = c.id;
      t.phase = "swim";
      t.swim = true;
      c.task = t;
      return true;
    }
    const spot = this.launchSpot(c, f);
    if (!spot) {
      this.toast(`${c.name} can't swim to that one.`, true);
      return false;
    }
    f.claim = c.id;
    t.path = spot.path;
    c.task = t;
    return true;
  }

  private orderBuild(c: Colonist, target: Tile | Struct | null | undefined): boolean {
    if (!target) return false;
    const path = this.pathAdjacentTo(c, target.x, target.y);
    if (path === null) {
      this.toast("Can't reach that blueprint.", true);
      return false;
    }
    this.release(c);
    target.claim = c.id;
    const t: Task = { type: "build", phase: path.length ? "move" : "work", path, t: 0, re: 0, swim: false };
    if ("id" in target) t.struct = target;
    else t.tile = target;
    c.task = t;
    return true;
  }

  private orderStruct(c: Colonist, type: TaskType, s: Struct): boolean {
    const path = this.pathAdjacentTo(c, s.x, s.y) ?? (this.walkable(s.x, s.y) ? [] : null);
    if (path === null) {
      this.toast("Can't reach that.", true);
      return false;
    }
    this.release(c);
    s.claim = c.id;
    const t: Task = { type, phase: path.length ? "move" : "work", path, t: 0, re: 0, struct: s, swim: false };
    c.task = t;
    return true;
  }

  /** assign the commanded colonist to a structure / blueprint */
  private assignStruct(c: Colonist, s: Struct | null) {
    if (!s) return;
    if (s.bp) {
      if (this.orderBuild(c, s)) this.toast(`${c.name} starts building.`);
      return;
    }
    switch (s.kind) {
      case "bench":
        if (this.res.wood < 2) return this.toast("Sawing needs 2 wood.", true);
        if (this.orderStruct(c, "craft", s)) this.toast(`${c.name} saws planks.`);
        return;
      case "tree":
        if (s.fruit <= 0) return this.toast("No ripe lemons on that tree.", true);
        if (this.orderStruct(c, "harvest", s)) this.toast(`${c.name} picks lemons.`);
        return;
      case "rod":
        if (this.orderStruct(c, "fish", s)) this.toast(`${c.name} goes fishing.`);
        return;
      case "bed":
        if (s.claim) return this.toast("That bed is taken.", true);
        if (this.orderStruct(c, "sleep", s)) this.toast(`${c.name} goes to rest.`);
        return;
      default:
        this.sel = { kind: "struct", id: s.id };
    }
  }

  private valid(t: Task) {
    switch (t.type) {
      case "build":
        if (t.tile) return !t.tile.dead && t.tile.bp;
        return !!t.struct && !t.struct.dead && t.struct.bp;
      case "craft":
      case "fish":
      case "harvest":
        return !!t.struct && !t.struct.dead && !t.struct.bp;
      case "sleep":
        return !t.struct || !t.struct.dead;
      case "collect":
        return !!t.fl && this.flotage.includes(t.fl) && t.fl.marked;
      case "move":
        return true;
      default:
        return true;
    }
  }

  // ---------------------------------------------------------------- colonists
  private updateColonist(c: Colonist, dt: number) {
    // smooth turning – the body always interpolates towards the desired heading
    const turn = norm(c.faceT - c.facing);
    c.facing += turn * Math.min(1, dt * 11);

    const night = this.daylight() < 0.3;
    c.hunger = Math.max(0, c.hunger - 0.3 * dt);
    if (!(c.task && c.task.type === "sleep" && c.task.phase === "work"))
      c.energy = Math.max(0, c.energy - (night ? 0.28 : 0.2) * dt - (c.swimming ? 0.75 * dt : 0));
    if (c.hunger <= 0) c.health -= 0.9 * dt;
    else if (c.hunger > 35 && c.health < 100) c.health = Math.min(100, c.health + 0.6 * dt);
    if (c.energy <= 0) c.health -= 0.2 * dt;
    if (c.health <= 0) {
      this.release(c);
      this.colonists = this.colonists.filter((x) => x !== c);
      this.toast(`${c.name} has died.`, true);
      if (this.sel?.kind === "colonist" && this.sel.id === c.id) this.sel = null;
      if (this.cmd === c.id) this.cmd = null;
      if (!this.colonists.length) {
        this.over = true;
        this.speed = 0;
      }
      return;
    }

    c.moving = false;
    if (!c.task) {
      c.swimming = false;
      if (this.inWater(c.x, c.y)) {
        // safety net: never leave a colonist stranded in the sea
        const home = this.nearestRaftTile(c.x, c.y);
        if (home) {
          c.task = {
            type: "move",
            phase: "swim",
            path: [{ x: home.x, y: home.y }],
            t: 0,
            re: 0,
            swim: true,
          };
          c.swimming = true;
        }
        return;
      }
      if (c.idleT > 0) {
        c.idleT -= dt;
        this.idleMotion(c, dt);
        return;
      }
      const surv = this.pickSurvival(c);
      if (surv) {
        c.task = surv;
      } else {
        c.idleT = 30 + Math.random() * 30;
      }
      return;
    }

    const t = c.task;
    if (!this.valid(t)) {
      this.release(c);
      c.idleT = 0;
      return;
    }
    // needs interrupt work, but never other survival
    if (t.type !== "eat" && t.type !== "sleep") {
      if ((c.hunger < 20 && this.foodCount() > 0) || c.energy < 8) {
        this.release(c);
        c.idleT = 0;
        return;
      }
    }
    if (t.type === "sleep" && c.hunger < 15 && this.foodCount() > 0) {
      this.release(c);
      c.idleT = 0;
      return;
    }

    // ---- swimming leg (out to the flotage or back home)
    if (t.phase === "swim") {
      const target: Pt | null =
        t.type === "collect" ? (t.fl ? { x: t.fl.x, y: t.fl.y } : null) : t.path[0] ?? null;
      if (!target) {
        this.release(c);
        return;
      }
      c.swimming = true;
      const dx = target.x - c.x,
        dy = target.y - c.y;
      const d = Math.hypot(dx, dy);
      if (d <= 0.5) {
        if (t.type === "collect") {
          c.x = target.x;
          c.y = target.y;
          t.phase = "work";
          t.t = 0;
        } else {
          c.x = target.x;
          c.y = target.y;
          t.path.shift();
          if (!t.path.length) {
            this.release(c);
            c.idleT = 3;
          }
        }
        return;
      }
      const sp = 1.25;
      c.x += (dx / d) * sp * dt;
      c.y += (dy / d) * sp * dt;
      c.faceT = Math.atan2(dy, dx);
      c.moving = true;
      c.walk += dt * 7;
      return;
    }

    if (t.phase === "move") {
      // a drifting flotage needs a fresh dive spot now and then
      if (t.type === "collect") {
        t.re -= dt;
        if (t.re <= 0) {
          t.re = 0.6;
          if (!this.replanCollect(c, t)) {
            this.toast(`${c.name} lost sight of the salvage.`, true);
            this.release(c);
            return;
          }
        }
      }
      if (this.stepAlong(c, t, dt, 1.7)) {
        t.phase = "work";
        t.t = 0;
        if (t.type === "collect" && t.fl) {
          if (Math.hypot(t.fl.x - c.x, t.fl.y - c.y) > 2) {
            t.phase = "swim";
            t.swim = true;
            c.swimming = true;
            return;
          }
        }
        if (t.type === "sleep" && t.struct) {
          c.x = t.struct.x;
          c.y = t.struct.y;
          c.lying = true;
          c.faceT = t.struct.kind === "bed" ? c.facing : c.faceT;
        }
      }
      return;
    }

    // ---- work
    const done = (idle = 3) => {
      this.release(c);
      c.idleT = idle;
    };
    switch (t.type) {
      case "move":
        done();
        break;
      case "eat":
        t.t += dt;
        if (t.t >= 2) {
          if (this.res.fish > 0) {
            this.res.fish--;
            c.hunger = Math.min(100, c.hunger + 45);
          } else if (this.res.lemon > 0) {
            this.res.lemon--;
            c.hunger = Math.min(100, c.hunger + 30);
          }
          done(1);
        }
        break;
      case "sleep":
        if (t.struct && !c.lying) {
          // settle onto the bed even when we were already standing next to it
          c.x = t.struct.x;
          c.y = t.struct.y;
          c.lying = true;
        }
        c.energy = Math.min(100, c.energy + (t.struct ? 3 : 1.3) * dt);
        if (c.energy >= 99.5) {
          if (t.struct) {
            const out = DIRS.map(([dx, dy]) => ({ x: t.struct!.x + dx, y: t.struct!.y + dy })).find((p) =>
              this.walkable(p.x, p.y)
            );
            if (out) {
              c.x = out.x;
              c.y = out.y;
            }
          }
          done(2);
        }
        break;
      case "build": {
        const obj = (t.tile ?? t.struct)!;
        const kind: BuildKind = t.tile ? "floor" : (t.struct!.kind as BuildKind);
        c.faceT = Math.atan2(obj.y - c.y, obj.x - c.x);
        obj.progress += dt / BUILDINGS[kind].time;
        if (obj.progress >= 1) {
          obj.progress = 1;
          obj.bp = false;
          done();
        }
        break;
      }
      case "craft":
        c.faceT = Math.atan2(t.struct!.y - c.y, t.struct!.x - c.x);
        t.t += dt;
        if (t.t >= 4) {
          if (this.res.wood >= 2) {
            this.res.wood -= 2;
            this.addRes("plank", 3);
          }
          done();
        }
        break;
      case "fish":
        c.faceT = Math.atan2(t.struct!.y - c.y, t.struct!.x - c.x);
        t.t += dt;
        if (t.t >= 7) {
          this.addRes("fish", 1);
          if (Math.random() < 0.25) this.addRes("rope", 1);
          done();
        }
        break;
      case "harvest":
        c.faceT = Math.atan2(t.struct!.y - c.y, t.struct!.x - c.x);
        t.t += dt;
        if (t.t >= 2.5) {
          this.addRes("lemon", t.struct!.fruit);
          t.struct!.fruit = 0;
          t.struct!.fruitT = 0;
          done();
        }
        break;
      case "collect": {
        const f = t.fl!;
        c.swimming = true;
        c.faceT = Math.atan2(f.y - c.y, f.x - c.x);
        t.t += dt;
        if (t.t >= 0.9) {
          this.collect(f);
          // swim back to the raft
          const home = this.nearestRaftTile(c.x, c.y);
          t.fl = undefined;
          t.type = "move";
          t.phase = home ? "swim" : "work";
          t.path = home ? [{ x: home.x, y: home.y }] : [];
          t.swim = !!home;
          if (!home) done();
        }
        break;
      }
    }
  }

  private idleMotion(c: Colonist, dt: number) {
    c.walk += dt * 1.1;
    if (c.walk > 40) {
      c.walk = 0;
      c.faceT = c.facing + (Math.random() - 0.5) * 2.4;
    }
  }

  /** move along the path; true when the path is finished */
  private stepAlong(c: Colonist, t: Task, dt: number, speed: number) {
    if (!t.path.length) return true;
    const wp = t.path[0];
    const dx = wp.x - c.x,
      dy = wp.y - c.y;
    const d = Math.hypot(dx, dy);
    const step = speed * dt;
    if (d <= step) {
      c.x = wp.x;
      c.y = wp.y;
      t.path.shift();
      return t.path.length === 0;
    }
    c.x += (dx / d) * step;
    c.y += (dy / d) * step;
    c.faceT = Math.atan2(dy, dx);
    c.moving = true;
    c.walk += dt * 9;
    if (t.path.length > 1 && !this.walkable(t.path[1].x, t.path[1].y)) {
      this.release(c);
      c.idleT = 0.3;
      return false;
    }
    return false;
  }

  /** re-pick the dive spot as the flotage drifts */
  private replanCollect(c: Colonist, t: Task) {
    const f = t.fl!;
    if (Math.hypot(f.x - c.x, f.y - c.y) <= 1.9) return true;
    const spot = this.launchSpot(c, f);
    if (!spot) return false;
    const last = t.path[t.path.length - 1];
    if (last && last.x === spot.tile.x && last.y === spot.tile.y) return true; // already heading there
    t.path = spot.path;
    return true;
  }

  private collect(f: Flotage) {
    this.flotage = this.flotage.filter((x) => x !== f);
    if (this.sel?.kind === "flotage" && this.sel.id === f.id) this.sel = null;
    const r = (a: number, b: number) => a + Math.floor(Math.random() * (b - a + 1));
    const gain: [ResKey, number][] = [];
    switch (f.kind) {
      case "wood":
        gain.push(["wood", r(3, 6)]);
        break;
      case "planks":
        gain.push(["plank", r(4, 8)]);
        break;
      case "crate":
        gain.push(["wood", 2], ["plank", 3], ["rope", 2]);
        break;
      case "barrel": {
        const o = Math.random();
        if (o < 0.3) gain.push(["lemon", r(2, 4)]);
        else if (o < 0.55) gain.push(["fish", r(2, 3)]);
        else if (o < 0.8) gain.push(["rope", r(3, 5)]);
        else gain.push(["plank", r(2, 4)]);
        break;
      }
      case "survivor": {
        const open = [...this.tiles.values()].filter((t) => this.walkable(t.x, t.y));
        const p = open[0] ?? { x: 0, y: 0 };
        const c = this.addColonist(p.x, p.y);
        this.toast(`${c.name} was rescued and joined your raft!`);
        return;
      }
    }
    const parts: string[] = [];
    for (const [k, n] of gain) {
      const got = this.addRes(k, n);
      parts.push(`+${got} ${RES_INFO[k].name.toLowerCase()}`);
    }
    this.toast(`Salvaged: ${parts.join(", ")}`);
  }

  private markFlotage(f: Flotage, on: boolean) {
    f.marked = on;
    if (!on) {
      const c = f.claim != null ? this.colonistById(f.claim) : null;
      if (c && c.task?.fl === f) this.release(c);
      f.claim = null;
      this.toast("Salvage order cancelled.");
    } else {
      this.toast("Marked for salvage – select a colonist, then click it.");
    }
  }

  // ---------------------------------------------------------------- world sim
  private spawnFlotage() {
    const day = Math.floor(this.time / DAY_LENGTH);
    const weights: [FlotageKind, number][] = [
      ["wood", 30],
      ["planks", 25],
      ["barrel", 25],
      ["crate", 15],
      ["survivor", day >= 1 && this.colonists.length < 6 ? 6 : 0],
    ];
    const total = weights.reduce((a, w) => a + w[1], 0);
    let r = Math.random() * total;
    let kind: FlotageKind = "wood";
    for (const [k, w] of weights) {
      if ((r -= w) <= 0) {
        kind = k;
        break;
      }
    }
    const c = this.raftCenter();
    const off = (Math.random() - 0.5) * 12;
    const px = -this.cur.y,
      py = this.cur.x;
    const f: Flotage = {
      id: this.nextId++,
      x: c.x - this.cur.x * 13 + px * off,
      y: c.y - this.cur.y * 13 + py * off,
      kind,
      marked: false,
      claim: null,
      stuck: false,
      age: 0,
      retry: 0,
    };
    this.flotage.push(f);
    this.toast(
      kind === "survivor" ? "A survivor is drifting toward the raft!" : "Flotage spotted! Select it, then press Salvage."
    );
  }

  private step(dt: number) {
    this.time += dt;
    this.structs.forEach((s) => {
      if (s.kind === "tree" && s.fruit < 3) {
        s.fruitT += dt;
        if (s.fruitT >= 25) {
          s.fruit++;
          s.fruitT = 0;
        }
      }
    });
    this.spawnT -= dt;
    if (this.spawnT <= 0) {
      this.spawnFlotage();
      this.spawnT = 22 + Math.random() * 18;
    }
    const rc = this.raftCenter();
    for (const f of [...this.flotage]) {
      f.age += dt;
      if (!f.stuck) {
        const nx = f.x + this.cur.x * 0.55 * dt;
        const ny = f.y + this.cur.y * 0.55 * dt;
        if (this.tileAt(Math.round(nx), Math.round(ny))) f.stuck = true;
        else {
          f.x = nx;
          f.y = ny;
        }
      }
      const along = (f.x - rc.x) * this.cur.x + (f.y - rc.y) * this.cur.y;
      if (along > 20 || f.age > 150) {
        this.flotage = this.flotage.filter((x) => x !== f);
        if (this.sel?.kind === "flotage" && this.sel.id === f.id) this.sel = null;
        if (f.claim != null) {
          const c = this.colonistById(f.claim);
          if (c && c.task?.fl === f) {
            this.release(c);
          }
        }
      }
    }
    for (const c of [...this.colonists]) this.updateColonist(c, dt);
  }

  // ---------------------------------------------------------------- frame
  private frame(dt: number) {
    this.realTime += dt;
    const rate = dt * 7.5 * (58 / this.s);
    let vx = 0,
      vy = 0;
    if (this.keys.has("w")) (vx -= 1), (vy -= 1);
    if (this.keys.has("s")) (vx += 1), (vy += 1);
    if (this.keys.has("a")) (vx -= 1), (vy += 1);
    if (this.keys.has("d")) (vx += 1), (vy -= 1);
    if (vx || vy) {
      const l = Math.hypot(vx, vy);
      vx /= l;
      vy /= l;
      const c = Math.cos(this.ang),
        sn = Math.sin(this.ang);
      this.cam.x += (vx * c + vy * sn) * rate;
      this.cam.y += (-vx * sn + vy * c) * rate;
    }
    this.ang += (this.angT - this.ang) * Math.min(1, dt * 10);

    if (this.speed > 0 && !this.over) {
      let rem = dt * this.speed;
      while (rem > 0) {
        const d = Math.min(0.05, rem);
        this.step(d);
        rem -= d;
      }
    }
    if (this.mouse.down && this.tool && this.hover) {
      const k = this.tool + key(this.hover.x, this.hover.y);
      if (k !== this.lastPaint) {
        this.lastPaint = k;
        this.applyTool(this.hover.x, this.hover.y, false);
      }
    }
    this.render();
  }

  // ---------------------------------------------------------------- input
  private bindEvents() {
    const cv = this.canvas;
    const on = (el: HTMLElement | Window, ev: string, fn: (e: any) => void, opts?: any) => {
      el.addEventListener(ev, fn, opts);
      this.cleanup.push(() => el.removeEventListener(ev, fn, opts));
    };
    on(window, "resize", () => this.resize());
    on(window, "keydown", (e: KeyboardEvent) => {
      const k = e.key.toLowerCase();
      if (["w", "a", "s", "d"].includes(k)) this.keys.add(k);
      if (k === "q") this.rotate(-1);
      if (k === "e") this.rotate(1);
      if (k === " ") {
        this.togglePause();
        e.preventDefault();
      }
      if (k === "1") this.setSpeed(1);
      if (k === "2") this.setSpeed(2);
      if (k === "3") this.setSpeed(4);
      if (k === "escape") {
        this.tool = null;
        this.sel = null;
        this.cmd = null;
      }
    });
    on(window, "keyup", (e: KeyboardEvent) => this.keys.delete(e.key.toLowerCase()));
    on(window, "blur", () => this.keys.clear());
    on(cv, "contextmenu", (e: Event) => e.preventDefault());
    on(
      cv,
      "wheel",
      (e: WheelEvent) => {
        e.preventDefault();
        this.s = clamp(this.s * (e.deltaY < 0 ? 1.1 : 1 / 1.1), 26, 130);
      },
      { passive: false }
    );
    on(cv, "mousedown", (e: MouseEvent) => {
      this.mouse.x = e.offsetX;
      this.mouse.y = e.offsetY;
      if (e.button === 2 || e.button === 1) {
        this.mouse.rdown = true;
        this.mouse.rmoved = 0;
        return;
      }
      this.mouse.down = true;
      this.updateHover();
      if (this.tool) {
        if (this.hover) {
          this.lastPaint = this.tool + key(this.hover.x, this.hover.y);
          this.applyTool(this.hover.x, this.hover.y, true);
        }
      } else this.clickSelect();
    });
    on(window, "mouseup", (e: MouseEvent) => {
      if (e.button === 2 || e.button === 1) {
        if (this.mouse.rdown && this.mouse.rmoved < 5) {
          if (this.tool) this.tool = null;
          else {
            this.sel = null;
            this.cmd = null;
          }
        }
        this.mouse.rdown = false;
      } else {
        this.mouse.down = false;
        this.lastPaint = "";
      }
    });
    on(cv, "mousemove", (e: MouseEvent) => {
      const dx = e.offsetX - this.mouse.x;
      this.mouse.x = e.offsetX;
      this.mouse.y = e.offsetY;
      if (this.mouse.rdown) {
        this.mouse.rmoved += Math.abs(dx) + Math.abs(e.movementY || 0);
        this.angT += dx * 0.006;
        this.ang += dx * 0.006;
      }
      this.updateHover();
    });
  }

  private resize() {
    this.dpr = Math.min(2, window.devicePixelRatio || 1);
    this.W = window.innerWidth;
    this.H = window.innerHeight;
    this.canvas.width = this.W * this.dpr;
    this.canvas.height = this.H * this.dpr;
    this.canvas.style.width = this.W + "px";
    this.canvas.style.height = this.H + "px";
  }

  private ground(mx: number, my: number, z: number): Pt {
    const a = (mx - this.W / 2) / this.s;
    const b = (my - this.H / 2 + z * this.s * 0.85) / (this.s * 0.5);
    const rx = (a + b) / 2,
      ry = (b - a) / 2;
    const c = Math.cos(this.ang),
      sn = Math.sin(this.ang);
    return { x: this.cam.x + rx * c + ry * sn, y: this.cam.y - rx * sn + ry * c };
  }

  private updateHover() {
    const g = this.ground(this.mouse.x, this.mouse.y, 0.08);
    this.hover = { x: Math.round(g.x), y: Math.round(g.y) };
  }

  private applyTool(x: number, y: number, loud: boolean) {
    if (!this.tool) return;
    if (this.tool === "demolish") this.demolishAt(x, y, loud);
    else this.place(this.tool, x, y, loud);
  }

  // ---------------------------------------------------------------- picking
  private pickColonist(mx: number, my: number) {
    let best: Colonist | null = null;
    let bd = Math.max(18, this.s * 0.42);
    for (const c of this.colonists) {
      const p = this.P(c.x, c.y, c.swimming ? 0.3 : 0.6);
      const d = Math.hypot(p[0] - mx, p[1] - my);
      if (d < bd) {
        bd = d;
        best = c;
      }
    }
    return best;
  }

  private pickFlotage(mx: number, my: number) {
    let best: Flotage | null = null;
    let bd = Math.max(20, this.s * 0.62);
    for (const f of this.flotage) {
      const p = this.P(f.x, f.y, 0.1);
      const d = Math.hypot(p[0] - mx, p[1] - my);
      if (d < bd) {
        bd = d;
        best = f;
      }
    }
    return best;
  }

  private pickStruct(mx: number, my: number) {
    for (const z of [0.45, 1.35]) {
      const g = this.ground(mx, my, z);
      const s = this.structAt(Math.round(g.x), Math.round(g.y));
      if (s && (z < 1 || s.kind === "tree")) return s;
    }
    return null;
  }

  private clickSelect() {
    const mx = this.mouse.x,
      my = this.mouse.y;
    const picked = this.pickColonist(mx, my);
    if (picked) {
      this.sel = { kind: "colonist", id: picked.id };
      this.cmd = picked.id;
      return;
    }
    const f = this.pickFlotage(mx, my);
    const s = this.pickStruct(mx, my);
    const g = this.ground(mx, my, 0.08);
    const gx = Math.round(g.x),
      gy = Math.round(g.y);
    const tile = this.tileAt(gx, gy);
    const commander = this.cmd != null ? this.colonistById(this.cmd) : null;

    if (commander) {
      if (f) {
        if (!f.marked) {
          this.sel = { kind: "flotage", id: f.id };
          this.toast("Not marked yet – press Salvage in the panel below.", true);
          return;
        }
        if (f.claim != null && f.claim !== commander.id) {
          const other = this.colonistById(f.claim);
          this.toast(`${other?.name ?? "Someone"} is already swimming for it.`, true);
          return;
        }
        if (this.orderSalvage(commander, f)) {
      this.toast(`${commander.name} dives in after the salvage.`);
      this.pingAt(f.x, f.y);
    } else this.pingAt(f.x, f.y, false);
        return;
      }
      if (s) {
        this.assignStruct(commander, s);
        this.pingAt(s.x, s.y, !!commander.task);
        return;
      }
      if (tile) {
        if (tile.bp) {
          if (this.orderBuild(commander, tile)) this.toast(`${commander.name} starts building.`);
          return;
        }
        if (this.orderMove(commander, tile.x, tile.y)) {
          this.toast(`${commander.name} heads over.`);
          this.pingAt(tile.x, tile.y);
        } else this.pingAt(tile.x, tile.y, false);
        return;
      }
      this.toast("Nothing to do out there.", true);
      return;
    }

    // ---- inspection mode
    if (f) {
      this.sel = { kind: "flotage", id: f.id };
      return;
    }
    if (s) {
      this.sel = { kind: "struct", id: s.id };
      return;
    }
    this.sel = tile ? { kind: "tile", id: 0, x: tile.x, y: tile.y } : null;
  }

  // ---------------------------------------------------------------- snapshot
  snapshot(): Snapshot {
    const now = Date.now();
    const commander = this.cmd != null ? this.colonistById(this.cmd) : null;
    let selection: SelectionSnap | null = null;
    if (this.sel) {
      const sel = this.sel;
      if (sel.kind === "colonist") {
        const c = this.colonistById(sel.id);
        if (c)
          selection = {
            kind: "colonist",
            id: c.id,
            title: c.name,
            lines: [
              `Hunger ${Math.round(c.hunger)}%`,
              `Energy ${Math.round(c.energy)}%`,
              `Health ${Math.round(c.health)}%`,
              `Doing: ${this.status(c)}`,
            ],
            canStop: !!c.task,
            hint: "In command – click a marked flotage, blueprint, tree, bench, rod or raft tile.",
          };
      } else if (sel.kind === "struct") {
        const s = this.structById(sel.id);
        if (s) {
          const lines: string[] = [];
          if (s.bp) lines.push(`Under construction ${Math.round(s.progress * 100)}%`);
          else if (s.kind === "tree") lines.push(`Lemons ready: ${s.fruit}/3`);
          else lines.push(BUILDINGS[s.kind].desc);
          const job = s.bp || s.kind !== "crate";
          selection = {
            kind: "struct",
            id: s.id,
            title: STRUCT_NAMES[s.kind] + (s.bp ? " (blueprint)" : ""),
            lines,
            canDemolish: s.kind !== "tree",
            canAssign: !!commander && job,
            assignLabel: commander ? `Send ${commander.name.split(" ")[0]}` : undefined,
            hint: commander
              ? undefined
              : job
              ? "Select a colonist first, then click this to give the order."
              : "Storage only – nothing to assign.",
          };
        }
      } else if (sel.kind === "flotage") {
        const f = this.flotage.find((f) => f.id === sel.id);
        if (f)
          selection = {
            kind: "flotage",
            id: f.id,
            title: "Flotage",
            lines: [
              f.kind === "survivor" ? "Someone is clinging to a board!" : "Unknown salvage drifting by.",
              f.marked ? "Marked for salvage." : "Not marked yet.",
              f.stuck ? "Caught against the raft." : "Drifting with the current.",
            ],
            canMark: true,
            marked: f.marked,
            canAssign: !!commander && f.marked,
            assignLabel: commander ? `Send ${commander.name.split(" ")[0]}` : undefined,
            hint: f.marked
              ? "Select a colonist, then click the flotage to send them swimming."
              : "Press Salvage to mark it, then send a colonist.",
          };
      } else if (sel.kind === "tile") {
        const t = this.tileAt(sel.x!, sel.y!);
        if (t)
          selection = {
            kind: "tile",
            id: 0,
            title: t.bp ? "Blueprint Floor" : "Raft Floor",
            lines: [
              t.bp ? `Under construction ${Math.round(t.progress * 100)}%` : "Sturdy planks floating on the sea.",
            ],
            canAssign: !!commander,
            assignLabel: commander ? `Send ${commander.name.split(" ")[0]}` : undefined,
            hint: commander ? undefined : "Select a colonist, then click a tile to walk there.",
          };
      }
    }
    const counts = new Map<string, number>();
    this.structs.forEach((s) => {
      if (!s.bp) counts.set(STRUCT_NAMES[s.kind], (counts.get(STRUCT_NAMES[s.kind]) ?? 0) + 1);
    });
    let floors = 0;
    this.tiles.forEach((t) => {
      if (!t.bp) floors++;
    });
    return {
      res: { ...this.res },
      cap: this.cap(),
      day: Math.floor(this.time / DAY_LENGTH),
      tod: (this.time % DAY_LENGTH) / DAY_LENGTH,
      speed: this.speed,
      buoy: this.buoyancy(),
      load: this.load(),
      colonists: this.colonists.map((c, i) => {
        const li = LOOKS.indexOf(c.look);
        return {
          id: c.id,
          name: c.name,
          status: this.status(c),
          hunger: c.hunger,
          energy: c.energy,
          health: c.health,
          swimming: c.swimming,
          commanded: this.cmd === c.id,
          ...lookColors(li >= 0 ? li : i),
        };
      }),
      selection,
      tool: this.tool,
      toasts: this.toasts.filter((t) => now - t.at < 6000),
      flotageCount: this.flotage.length,
      over: this.over,
      floors,
      structs: [...counts.entries()].map(([name, count]) => ({ name, count })),
      commanded: commander ? commander.name : null,
    };
  }

  private status(c: Colonist) {
    if (c.swimming) return "Swimming";
    if (c.lying) return "Sleeping";
    if (!c.task) return "Idle";
    switch (c.task.type) {
      case "eat":
        return "Eating";
      case "sleep":
        return "Sleeping";
      case "build":
        return "Building";
      case "craft":
        return "Crafting";
      case "fish":
        return "Fishing";
      case "harvest":
        return "Harvesting";
      case "collect":
        return "Salvaging";
      default:
        return "Walking";
    }
  }

  // ---------------------------------------------------------------- projection
  private P(x: number, y: number, z: number): V2 {
    const dx = x - this.cam.x,
      dy = y - this.cam.y;
    const c = Math.cos(this.ang),
      sn = Math.sin(this.ang);
    const rx = dx * c - dy * sn,
      ry = dx * sn + dy * c;
    return [this.W / 2 + (rx - ry) * this.s, this.H / 2 + (rx + ry) * this.s * 0.5 - z * this.s * 0.85];
  }

  /** true 3D depth along the camera ray – larger means closer to the viewer */
  private dep(x: number, y: number, z: number) {
    const dx = x - this.cam.x,
      dy = y - this.cam.y;
    const c = Math.cos(this.ang),
      sn = Math.sin(this.ang);
    return 0.85 * (dx * c - dy * sn + dx * sn + dy * c) + z;
  }

  private poly(pts: V2[], fill: string) {
    const g = this.ctx;
    g.fillStyle = fill;
    g.strokeStyle = fill;
    g.lineWidth = 0.7;
    g.beginPath();
    g.moveTo(pts[0][0], pts[0][1]);
    for (let i = 1; i < pts.length; i++) g.lineTo(pts[i][0], pts[i][1]);
    g.closePath();
    g.fill();
    g.stroke();
  }

  /** deterministic 0..1 hash for a grid cell */
  private static hash2(x: number, y: number) {
    let h = Math.imul(x | 0, 374761393) + Math.imul(y | 0, 668265263);
    h = Math.imul(h ^ (h >>> 13), 1274126177);
    h ^= h >>> 16;
    return (h >>> 0) / 4294967296;
  }

  private static faceShade(v: V3[]) {
    const a = v[0],
      b = v[1],
      c = v[2];
    const ux = b[0] - a[0],
      uy = b[1] - a[1],
      uz = b[2] - a[2];
    const vx = c[0] - a[0],
      vy = c[1] - a[1],
      vz = c[2] - a[2];
    let nx = uy * vz - uz * vy,
      ny = uz * vx - ux * vz,
      nz = ux * vy - uy * vx;
    const l = Math.hypot(nx, ny, nz) || 1;
    nx /= l;
    ny /= l;
    nz /= l;
    const d = Math.max(0, nx * LIGHT[0] + ny * LIGHT[1] + nz * LIGHT[2]);
    return clamp(0.66 + 0.36 * d + 0.1 * Math.max(0, nz) - 0.12 * Math.max(0, -nz), 0.42, 1.14);
  }

  /**
   * Project, back-face cull and paint a bag of world-space faces far-to-near.
   * This is what makes limbs and hair opaque: every face is ordered by its true
   * depth along the camera ray, so nothing on the far side of a body is drawn
   * on top of it.
   */
  private drawFaces(faces: Face3[]) {
    if (!faces.length) return;
    const g = this.ctx;
    const items: { d: number; pts: V2[]; k: number; col: RGB; a: number }[] = [];
    for (const f of faces) {
      const n = f.v.length;
      const pts: V2[] = new Array(n);
      let dsum = 0;
      for (let i = 0; i < n; i++) {
        const v = f.v[i];
        pts[i] = this.P(v[0], v[1], v[2]);
        dsum += this.dep(v[0], v[1], v[2]);
      }
      const cr =
        (pts[1][0] - pts[0][0]) * (pts[2][1] - pts[0][1]) - (pts[1][1] - pts[0][1]) * (pts[2][0] - pts[0][0]);
      if (cr <= 0.0001) continue; // back-facing
      items.push({ d: dsum / n, pts, k: Game.faceShade(f.v), col: f.col, a: f.a ?? 1 });
    }
    items.sort((a, b) => a.d - b.d);
    for (const it of items) {
      if (it.a !== 1) {
        g.globalAlpha = it.a;
        this.poly(it.pts, rgb(it.col, it.k));
        g.globalAlpha = 1;
      } else this.poly(it.pts, rgb(it.col, it.k));
    }
  }

  private addPoly(out: Face3[], faces: V3[][], col: RGB, alpha = 1) {
    for (const f of faces) out.push({ v: f, col, a: alpha });
  }

  private line3(x1: number, y1: number, z1: number, x2: number, y2: number, z2: number, color: string, w = 1) {
    const g = this.ctx;
    const a = this.P(x1, y1, z1),
      b = this.P(x2, y2, z2);
    g.strokeStyle = color;
    g.lineWidth = w;
    g.beginPath();
    g.moveTo(a[0], a[1]);
    g.lineTo(b[0], b[1]);
    g.stroke();
  }

  // ---------------------------------------------------------------- render
  private render() {
    const g = this.ctx;
    g.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);

    // ---- ocean: the pattern is pinned to the world z=0 plane, so zooming
    // scales around the camera instead of sliding the texture sideways.
    if (!this.pattern) this.pattern = g.createPattern(this.bgCanvas, "repeat");
    // one ocean tile spans `tileWorld` world units at reference zoom 58
    const tileWorld = this.bgCanvas.width / 58;
    const driftX = ((this.realTime * 0.55) % tileWorld + tileWorld) % tileWorld;
    const driftY = ((this.realTime * 0.22) % tileWorld + tileWorld) % tileWorld;
    const o = this.P(driftX, driftY, 0);
    const k = this.s / 58;
    const ca = Math.cos(this.ang),
      sa = Math.sin(this.ang);
    if (this.pattern) {
      this.pattern.setTransform(
        new DOMMatrix([(ca - sa) * k, (ca + sa) * 0.5 * k, -(sa + ca) * k, (ca - sa) * 0.5 * k, o[0], o[1]])
      );
      g.fillStyle = this.pattern;
      g.fillRect(0, 0, this.W, this.H);
    }

    // ---- sparkles anchored to world positions (never to the screen)
    const cx = Math.round(this.cam.x),
      cy = Math.round(this.cam.y);
    for (let gx = cx - 16; gx <= cx + 16; gx++) {
      for (let gy = cy - 16; gy <= cy + 16; gy++) {
        const h = Game.hash2(gx, gy);
        if (h < 0.94) continue;
        const h2 = Game.hash2(gy + 7, gx + 3);
        const wx = gx + h2 * 0.9,
          wy = gy + Game.hash2(gx + 11, gy + 5) * 0.9;
        const [px, py] = this.P(wx + driftX, wy + driftY, 0.01);
        if (px < -12 || px > this.W + 12 || py < -12 || py > this.H + 12) continue;
        const tw = 0.5 + 0.5 * Math.sin(this.realTime * 2.2 + h * 40);
        const sz = clamp(this.s * 0.028, 1, 2.6);
        g.fillStyle = `rgba(255,255,255,${0.1 + tw * 0.18})`;
        g.beginPath();
        g.arc(px, py, sz * (0.6 + tw * 0.7), 0, Math.PI * 2);
        g.fill();
      }
    }

    const bob = Math.sin(this.realTime * 1.35) * 0.02;

    // ---- foam ring under the raft
    this.tiles.forEach((t) => {
      const scr: Face3[] = [];
      this.addPoly(scr, translate(rbox(0.66, 0.66, -0.36, -0.34, 0.3), t.x, t.y, bob), [206, 246, 252], t.bp ? 0.14 : 0.3);
      this.drawFaces(scr);
    });

    // ---- raft tiles
    const tiles = [...this.tiles.values()].sort((a, b) => this.dep(a.x, a.y, 0) - this.dep(b.x, b.y, 0));
    for (const t of tiles) {
      const a = t.bp ? 0.45 : 1;
      const scr: Face3[] = [];
      // rounded hull with a tapered lip
      this.addPoly(
        scr,
        translate(
          stack([
            { p: roundRect(0.34, 0.34, 0.16), z: -0.34 },
            { p: roundRect(0.47, 0.47, 0.24), z: -0.2 },
            { p: roundRect(0.47, 0.47, 0.16), z: -0.04 },
          ]),
          t.x,
          t.y,
          bob
        ),
        [84, 40, 74],
        a
      );
      // deck: plank surface with chamfered edges
      this.addPoly(
        scr,
        translate(
          stack([
            { p: roundRect(0.45, 0.45, 0.15), z: 0.04 },
            { p: roundRect(0.46, 0.46, 0.16), z: 0.1 },
            { p: roundRect(0.4, 0.4, 0.14), z: 0.13 },
          ]),
          t.x,
          t.y,
          bob
        ),
        [152, 106, 64],
        a
      );
      this.drawFaces(scr);
      g.globalAlpha = a;
      if (t.pink) {
        const scr2: Face3[] = [];
        this.addPoly(scr2, translate(rbox(0.33, 0.33, 0.132, 0.14, 0.12), t.x, t.y, bob), [216, 126, 136]);
        this.drawFaces(scr2);
      } else {
        const lc = "rgba(64,34,26,0.45)";
        for (const off of [-0.22, 0, 0.22])
          this.line3(t.x + off, t.y - 0.38, 0.14 + bob, t.x + off, t.y + 0.38, 0.14 + bob, lc, 1.1);
      }
      g.globalAlpha = 1;
      if (t.bp && t.progress > 0) this.progressBar(t.x, t.y, 0.34, t.progress);
    }

    // ---- props, depth sorted (far to near)
    type D = { d: number; fn: () => void };
    const list: D[] = [];
    this.structs.forEach((s) => list.push({ d: this.dep(s.x, s.y, 0.2), fn: () => this.drawStruct(s, bob) }));
    for (const c of this.colonists)
      list.push({ d: this.dep(c.x, c.y, c.swimming ? 0.05 : 0.4), fn: () => this.drawColonist(c, bob) });
    for (const f of this.flotage) list.push({ d: this.dep(f.x, f.y, 0), fn: () => this.drawFlotage(f) });
    list.sort((a, b) => a.d - b.d);
    for (const it of list) it.fn();

    if (this.tool && this.hover) this.drawGhost();

    const dark = 1 - this.daylight();
    if (dark > 0.02) {
      g.fillStyle = `rgba(8,18,60,${dark * 0.55})`;
      g.fillRect(0, 0, this.W, this.H);
    }

    this.drawOverlays(bob);
  }

  private progressBar(x: number, y: number, z: number, p: number) {
    const g = this.ctx;
    const [sx, sy] = this.P(x, y, z);
    g.fillStyle = "#1a0f08";
    this.roundRect(sx - 18, sy - 4, 36, 7, 3);
    g.fill();
    g.fillStyle = "#7be05a";
    this.roundRect(sx - 17, sy - 3, 34 * clamp(p, 0, 1), 5, 2);
    g.fill();
  }

  private drawGhost() {
    const { x, y } = this.hover!;
    const scr: Face3[] = [];
    if (this.tool === "demolish") {
      const has = this.structAt(x, y) || this.tileAt(x, y);
      this.addPoly(
        scr,
        translate(rbox(0.46, 0.46, 0.06, 0.8, 0.14), x, y, 0),
        has ? [240, 60, 50] : [210, 210, 220],
        has ? 0.34 : 0.12
      );
      this.drawFaces(scr);
      return;
    }
    const kind = this.tool as BuildKind;
    const err = this.canPlace(kind, x, y);
    const col: RGB = err ? [240, 70, 60] : [90, 240, 110];
    if (kind === "floor") this.addPoly(scr, translate(rbox(0.48, 0.48, -0.1, 0.12, 0.18), x, y, 0), col, 0.45);
    else this.addPoly(scr, translate(rbox(0.4, 0.4, 0.1, 0.72, 0.14), x, y, 0), col, 0.45);
    this.drawFaces(scr);
  }

  private drawStruct(s: Struct, bob: number) {
    const out: Face3[] = [];
    const alpha = s.bp ? 0.45 : 1;
    const x = s.x,
      y = s.y,
      z = bob;
    const put = (f: V3[][], col: RGB) => this.addPoly(out, translate(f, x, y, z), col, alpha);

    switch (s.kind) {
      case "tree": {
        // tapered trunk
        put(rcyl(0.16, 0.11, 0.05, 0.5, 7), [70, 40, 62]);
        put(rcyl(0.11, 0.085, 0.5, 1.0, 7), [78, 46, 66]);
        // three sloped canopy tiers
        put(lathe([[0.62, 0.82], [0.5, 1.12], [0.42, 1.3]], 8), [40, 118, 82]);
        put(lathe([[0.5, 1.2], [0.4, 1.55], [0.32, 1.75]], 8), [48, 134, 90]);
        put(lathe([[0.36, 1.66], [0.26, 2.0], [0.12, 2.2]], 8), [60, 152, 100]);
        // leaf puffs to break the silhouette
        for (let i = 0; i < 5; i++) {
          const a = i * 1.31;
          const r = 0.36 + (i % 2) * 0.16;
          put(translate(blob(0.19, 0.26), Math.cos(a) * r, Math.sin(a) * r, 1.0 + (i % 3) * 0.34), [42, 122, 84]);
        }
        // lemons
        for (let i = 0; i < s.fruit; i++) {
          const a = i * 2.2 + 0.5;
          put(translate(blob(0.11, 0.17), Math.cos(a) * 0.5, Math.sin(a) * 0.5, 1.02), [252, 208, 66]);
        }
        break;
      }
      case "crate": {
        put(rbox(0.4, 0.4, 0.06, 0.56, 0.1), [140, 78, 46]);
        put(rbox(0.42, 0.42, 0.3, 0.36, 0.11), [104, 56, 34]);
        put(rbox(0.42, 0.42, 0.52, 0.62, 0.12), [172, 104, 60]);
        put(rbox(0.34, 0.34, 0.62, 0.68, 0.1), [150, 88, 50]);
        break;
      }
      case "bed": {
        put(rbox(0.45, 0.33, 0.06, 0.24, 0.09), [118, 76, 46]);
        put(rbox(0.42, 0.3, 0.24, 0.4, 0.12), [234, 154, 184]);
        put(rbox(0.16, 0.26, 0.4, 0.5, 0.09), [252, 246, 246]);
        put(rbox(0.44, 0.06, 0.24, 0.36, 0.03), [206, 236, 244]);
        break;
      }
      case "bench": {
        for (const [ox, oy] of [
          [-0.3, -0.22],
          [0.3, -0.22],
          [-0.3, 0.22],
          [0.3, 0.22],
        ])
          put(translate(rcyl(0.055, 0.04, 0.06, 0.48, 6), ox, oy, 0), [94, 60, 36]);
        put(rbox(0.44, 0.31, 0.46, 0.58, 0.09), [180, 128, 74]);
        put(rbox(0.2, 0.05, 0.58, 0.63, 0.02), [200, 200, 210]);
        put(rbox(0.06, 0.05, 0.58, 0.62, 0.02), [70, 50, 30]);
        put(rcyl(0.04, 0.03, 0.58, 0.74, 6), [146, 96, 54]);
        put(rbox(0.09, 0.05, 0.72, 0.8, 0.03), [150, 150, 160]);
        break;
      }
      case "rod": {
        put(rcyl(0.05, 0.035, 0.06, 1.02, 6), [132, 90, 54]);
        break;
      }
    }
    this.drawFaces(out);

    if (s.kind === "rod") {
      const g = this.ctx;
      const d = DIRS.find(([dx, dy]) => !this.tileAt(x + dx, y + dy)) ?? [1, 0];
      const tx = x + d[0] * 1.25,
        ty = y + d[1] * 1.25;
      const wob = Math.sin(this.realTime * 3 + s.id) * 0.03;
      this.line3(x, y, 1.0 + z, tx, ty, 0.9 + z, "#e8d8b0", 2.5);
      this.line3(tx, ty, 0.9 + z, tx, ty, -0.18 + wob, "rgba(255,255,255,0.75)", 1);
      const b = this.P(tx, ty, -0.16 + wob);
      g.fillStyle = "#e84a3a";
      g.beginPath();
      g.ellipse(b[0], b[1], this.s * 0.07, this.s * 0.05, 0, 0, Math.PI * 2);
      g.fill();
    }
  }

  // ------------------------------------------------------------ characters
  /**
   * The whole body is built in the colonist's own frame (x forward, y right,
   * z up) as oriented 3D solids, then rotated by the smoothed heading. All the
   * faces of all the parts are depth sorted together, so back arms, back hair
   * and eyes can never be painted over the parts in front of them.
   */
  private drawColonist(c: Colonist, bob: number) {
    const L = c.look;
    const out: Face3[] = [];
    const ca = Math.cos(c.facing),
      sa = Math.sin(c.facing);

    // root pose: lean forward while walking, lie flat in bed, tip over in water
    const swim = c.swimming;
    const rootPitch = swim ? 1.15 : c.lying ? -Math.PI / 2 : c.moving ? 0.1 : 0;
    const pivotZ = swim ? 0.42 : 0;
    const lift = swim ? -0.42 : 0;

    const place = (v: V3): V3 => {
      // root pitch about the y axis through (0,0,pivotZ)
      let x = v[0],
        y = v[1],
        z = v[2];
      if (rootPitch) {
        const cp = Math.cos(rootPitch),
          sp = Math.sin(rootPitch);
        const dz = z - pivotZ;
        const nx = x * cp + dz * sp;
        const nz = pivotZ - x * sp + dz * cp;
        x = nx;
        z = nz;
      }
      z += lift;
      return [c.x + x * ca - y * sa, c.y + x * sa + y * ca, z + bob];
    };

    const add = (faces: V3[][], col: RGB, at: V3 = [0, 0, 0], pitch = 0, alpha = 1) => {
      let f = faces;
      if (pitch) f = pitchFaces(f, pitch, [0, 0, 0]);
      if (at[0] || at[1] || at[2]) f = translate(f, at[0], at[1], at[2]);
      for (const face of f) out.push({ v: face.map(place), col, a: alpha });
    };

    const walkSwing = c.moving ? Math.sin(c.walk) : Math.sin(c.walk * 0.35) * 0.12;
    const workPose =
      c.task && c.task.phase === "work" && (c.task.type === "build" || c.task.type === "craft" || c.task.type === "fish");
    const hammer = workPose ? Math.sin(this.realTime * 9) * 0.55 - 0.5 : 0;

    const hipZ = 0.44;
    const legLen = 0.44;

    // ---- legs ------------------------------------------------------------
    for (const side of [-1, 1]) {
      // swim: alternating flutter kick behind the body
      const legPitch = swim
        ? Math.sin(c.walk * 1.9 + (side > 0 ? 0 : Math.PI)) * 0.4 + 0.15
        : walkSwing * 0.62 * side;
      const hip: V3 = [0, side * 0.085, hipZ];
      add(limb(0.088, 0.062, legLen, 6), L.pants, hip, legPitch);
      // foot, translated down the limb in local space before the hip rotation
      add(translate(rbox(0.105, 0.055, -0.05, 0.02, 0.03), 0.045, 0, -legLen), tint(L.pants, 0.86), hip, legPitch);
    }

    // ---- hips + torso ----------------------------------------------------
    add(
      stack([
        { p: roundRect(0.135, 0.1, 0.045), z: 0 },
        { p: roundRect(0.14, 0.1, 0.045), z: 0.07 },
      ]),
      tint(L.pants, 1.05),
      [0, 0, hipZ - 0.06]
    );
    // tapered torso: narrow waist, wider chest, sloped shoulders
    add(
      stack([
        { p: roundRect(0.11, 0.085, 0.038), z: 0 },
        { p: roundRect(0.138, 0.098, 0.045), z: 0.14 },
        { p: roundRect(0.152, 0.104, 0.05), z: 0.26 },
        { p: roundRect(0.145, 0.1, 0.048), z: 0.32 },
        { p: roundRect(0.108, 0.082, 0.04), z: 0.36 },
      ]),
      L.shirt,
      [0, 0, hipZ + 0.01]
    );
    // collar
    add(
      stack([
        { p: roundRect(0.085, 0.07, 0.028), z: 0 },
        { p: roundRect(0.065, 0.058, 0.024), z: 0.045 },
      ]),
      tint(L.shirt, 1.12),
      [0, 0, hipZ + 0.34]
    );
    // neck
    add(rcyl(0.048, 0.045, 0, 0.075, 7), L.skin, [0, 0, hipZ + 0.36]);

    // ---- head ------------------------------------------------------------
    const headZ = hipZ + 0.425;
    // skull with a chin, and an exposed face wedge on the +x side
    add(
      lathe(
        [
          [0.05, 0],
          [0.086, 0.05],
          [0.102, 0.12],
          [0.098, 0.18],
          [0.07, 0.225],
          [0.022, 0.238],
        ],
        9,
        headZ
      ),
      L.skin
    );
    // hair: covers the crown and back, cut away over the face
    add(
      translate(
        lathe(
          [
            [0.105, 0.085],
            [0.11, 0.145],
            [0.096, 0.196],
            [0.052, 0.234],
            [0.008, 0.246],
          ],
          9,
          headZ
        ),
        -0.026,
        0,
        0
      ),
      L.hair
    );
    add(translate(rbox(0.06, 0.04, 0.14, 0.2, 0.03), -0.06, 0, headZ), tint(L.hair, 0.95));

    // eyes, brows, nose, smile – on the forward face only
    for (const side of [-1, 1]) {
      add(rbox(0.016, 0.018, 0.026, 0.046, 0.006), [48, 32, 40], [0.078, side * 0.046, headZ + 0.112]);
      add(rbox(0.012, 0.024, 0.016, 0.023, 0.004), tint(L.hair, 0.7), [0.076, side * 0.048, headZ + 0.156]);
    }
    add(blob(0.026, 0.042), tint(L.skin, 0.9), [0.086, 0, headZ + 0.1]);
    add(rbox(0.014, 0.03, 0.008, 0.014, 0.004), [146, 78, 78], [0.078, 0, headZ + 0.056]);

    // ---- arms ------------------------------------------------------------
    for (const side of [-1, 1]) {
      let armPitch: number;
      if (swim) {
        // alternating crawl stroke
        armPitch = Math.sin(c.walk * 1.7 + (side > 0 ? Math.PI : 0)) * 1.5 - 1.1;
      } else if (workPose) {
        armPitch = hammer + (side > 0 ? 0 : 0.15);
      } else {
        armPitch = -walkSwing * 0.55 * side;
      }
      const sh: V3 = [0, side * 0.132, hipZ + 0.28];
      add(limb(0.048, 0.04, 0.33, 6), tint(L.shirt, 0.96), sh, armPitch);
      // forearm + hand, hanging off the rotated shoulder
      add(translate(rcyl(0.043, 0.038, -0.075, 0, 6), 0, 0, -0.33), L.skin, sh, armPitch);
      add(translate(blob(0.052, 0.07), 0, 0, -0.39), L.skin, sh, armPitch);
      // rounded shoulder joint
      add(translate(blob(0.042, 0.038), -0.005, 0, -0.035), tint(L.shirt, 0.99), sh, armPitch);
    }

    this.drawFaces(out);

    // ---- shadow / waterline ---------------------------------------------
    const g = this.ctx;
    if (swim) {
      const [sx, sy] = this.P(c.x, c.y, 0.06);
      for (let i = 0; i < 3; i++) {
        const ph = ((this.realTime * 0.85 + i * 0.34) % 1 + 1) % 1;
        g.strokeStyle = `rgba(255,255,255,${0.34 * (1 - ph)})`;
        g.lineWidth = 1.6;
        g.beginPath();
        g.ellipse(sx, sy, this.s * (0.2 + ph * 0.5), this.s * (0.1 + ph * 0.26), 0, 0, Math.PI * 2);
        g.stroke();
      }
      // splash behind the swimmer
      const back = this.P(c.x - ca * 0.3, c.y - sa * 0.3, 0.05);
      g.fillStyle = "rgba(255,255,255,0.5)";
      g.beginPath();
      g.ellipse(back[0], back[1], this.s * 0.1, this.s * 0.05, 0, 0, Math.PI * 2);
      g.fill();
    } else if (!c.lying) {
      const [sx, sy] = this.P(c.x, c.y, 0.15 + bob);
      g.fillStyle = "rgba(16,8,26,0.22)";
      g.beginPath();
      g.ellipse(sx, sy, this.s * 0.17, this.s * 0.085, 0, 0, Math.PI * 2);
      g.fill();
    }
  }

  private drawFlotage(f: Flotage) {
    const g = this.ctx;
    const z = Math.sin(this.realTime * 2 + f.id) * 0.035 - 0.14;
    const x = f.x,
      y = f.y;
    const [rx, ry] = this.P(x, y, -0.24);
    g.strokeStyle = "rgba(255,255,255,0.38)";
    g.lineWidth = 1.5;
    g.beginPath();
    g.ellipse(rx, ry, this.s * 0.78, this.s * 0.39, 0, 0, Math.PI * 2);
    g.stroke();

    const out: Face3[] = [];
    const put = (faces: V3[][], col: RGB) => this.addPoly(out, translate(faces, x, y, z), col);

    switch (f.kind) {
      case "wood":
        put(pitchFaces(rcyl(0.1, 0.1, -0.46, 0.46, 7), Math.PI / 2, [0, 0, 0]), [140, 94, 58]);
        put(pitchFaces(rcyl(0.09, 0.09, -0.4, 0.4, 7), Math.PI / 2, [0, 0, 0]), [162, 112, 70]);
        put(pitchFaces(rcyl(0.08, 0.08, -0.34, 0.34, 7), Math.PI / 2, [0, 0, 0]), [124, 82, 50]);
        break;
      case "planks":
        for (let i = 0; i < 3; i++)
          put(rbox(0.42, 0.26, i * 0.075, i * 0.075 + 0.075, 0.05), [196, 150, 92]);
        put(rcyl(0.07, 0.06, 0.22, 0.3, 6), [94, 58, 36]);
        break;
      case "barrel":
        put(
          lathe(
            [
              [0.15, 0],
              [0.22, 0.12],
              [0.23, 0.3],
              [0.16, 0.44],
            ],
            8
          ),
          [152, 88, 52]
        );
        put(rcyl(0.235, 0.235, 0.16, 0.19, 8), [64, 42, 32]);
        put(rcyl(0.235, 0.235, 0.34, 0.37, 8), [64, 42, 32]);
        break;
      case "crate":
        put(rbox(0.34, 0.34, 0, 0.4, 0.1), [170, 106, 64]);
        put(rbox(0.36, 0.36, 0.4, 0.48, 0.11), [190, 126, 78]);
        break;
      case "survivor": {
        // long surfboard
        put(
          pitchFaces(
            stack([
              { p: roundRect(0.07, 0.46, 0.05), z: 0 },
              { p: roundRect(0.085, 0.5, 0.07), z: 0.05 },
              { p: roundRect(0.07, 0.46, 0.05), z: 0.1 },
            ]),
            Math.PI / 2,
            [0, 0, 0]
          ),
          [154, 104, 64]
        );
        // torso draped over the board, head up, arms paddling
        put(rcyl(0.13, 0.11, 0.06, 0.3, 7), [92, 142, 202]);
        put(translate(blob(0.095, 0.16), 0, 0, 0.3), [232, 192, 162]);
        put(rcyl(0.1, 0.08, 0.44, 0.54, 7), [64, 44, 34]);
        const w = Math.sin(this.realTime * 5) * 0.14;
        put(translate(pitchFaces(rcyl(0.045, 0.04, -0.2, 0.2, 5), 1.1, [0, 0, 0]), w, -0.2, 0.34), [232, 192, 162]);
        put(translate(pitchFaces(rcyl(0.045, 0.04, -0.2, 0.2, 5), -1.1, [0, 0, 0]), -w, 0.2, 0.34), [232, 192, 162]);
        break;
      }
    }
    this.drawFaces(out);

    if (f.marked) {
      const [sx, sy] = this.P(x, y, 0.2);
      g.strokeStyle = `rgba(255,230,90,${0.55 + 0.45 * Math.sin(this.realTime * 5)})`;
      g.lineWidth = 3;
      g.beginPath();
      g.ellipse(sx, sy + this.s * 0.14, this.s * 0.58, this.s * 0.3, 0, 0, Math.PI * 2);
      g.stroke();
    } else {
      const [sx, sy] = this.P(x, y, 0.75);
      g.fillStyle = `rgba(255,255,255,${0.45 + 0.45 * Math.sin(this.realTime * 4 + f.id)})`;
      g.beginPath();
      g.arc(sx, sy, Math.max(2, this.s * 0.04), 0, Math.PI * 2);
      g.fill();
    }
  }

  private roundRect(x: number, y: number, w: number, h: number, r: number) {
    const g = this.ctx;
    const rr = Math.min(r, w / 2, h / 2);
    g.beginPath();
    g.moveTo(x + rr, y);
    g.arcTo(x + w, y, x + w, y + h, rr);
    g.arcTo(x + w, y + h, x, y + h, rr);
    g.arcTo(x, y + h, x, y, rr);
    g.arcTo(x, y, x + w, y, rr);
    g.closePath();
  }

  private drawOverlays(bob: number) {
    const g = this.ctx;
    g.textAlign = "center";
    for (const c of this.colonists) {
      const [sx, sy] = this.P(c.x, c.y, c.swimming ? 0.62 : c.lying ? 0.85 : 1.5 + bob);
      const w = 64,
        h = 16;
      g.globalAlpha = 0.9;
      g.fillStyle = "#3b2a18";
      this.roundRect(sx - w / 2, sy - h, w, h, 6);
      g.fill();
      g.strokeStyle = this.cmd === c.id ? "#ffe27a" : "#a8854f";
      g.lineWidth = this.cmd === c.id ? 2.2 : 1.5;
      g.stroke();
      g.globalAlpha = 1;
      g.fillStyle = "#f6e3b4";
      g.font = '11px "Patrick Hand", sans-serif';
      g.fillText(this.status(c), sx, sy - 3.5);
    }

    if (this.sel) {
      let pos: V3 | null = null;
      let name = "";
      if (this.sel.kind === "colonist") {
        const c = this.colonistById(this.sel.id);
        if (c) (pos = [c.x, c.y, c.swimming ? 0.8 : 2.0]), (name = c.name);
      } else if (this.sel.kind === "struct") {
        const s = this.structById(this.sel.id);
        if (s) (pos = [s.x, s.y, s.kind === "tree" ? 2.5 : s.kind === "rod" ? 1.4 : 1.0]), (name = STRUCT_NAMES[s.kind]);
      } else if (this.sel.kind === "flotage") {
        const f = this.flotage.find((f) => f.id === this.sel!.id);
        if (f) (pos = [f.x, f.y, 0.9]), (name = "Flotage");
      } else if (this.sel.kind === "tile") {
        pos = [this.sel.x!, this.sel.y!, 0.75];
        name = "Raft Floor";
      }
      if (pos) {
        const [sx, sy] = this.P(pos[0], pos[1], pos[2] + bob);
        const hop = Math.abs(Math.sin(this.realTime * 3.5)) * 8;
        const ay = sy - hop;
        g.fillStyle = "#fdfdfd";
        g.strokeStyle = "rgba(0,0,0,0.35)";
        g.lineWidth = 2;
        g.beginPath();
        g.moveTo(sx - 9, ay - 24);
        g.lineTo(sx + 9, ay - 24);
        g.lineTo(sx + 9, ay - 10);
        g.lineTo(sx + 20, ay - 10);
        g.lineTo(sx, ay + 12);
        g.lineTo(sx - 20, ay - 10);
        g.lineTo(sx - 9, ay - 10);
        g.closePath();
        g.fill();
        g.stroke();
        g.font = '26px "Patrick Hand", sans-serif';
        g.lineWidth = 4;
        g.strokeStyle = "rgba(10,30,60,0.7)";
        g.strokeText(name, sx, ay - 34);
        g.fillStyle = "#fff";
        g.fillText(name, sx, ay - 34);
      }
    }

    // click feedback
    if (this.ping) {
      const age = this.realTime - this.ping.at;
      if (age > 0.85) this.ping = null;
      else {
        const [sx, sy] = this.P(this.ping.x, this.ping.y, 0.12);
        const k = age / 0.85;
        g.strokeStyle = this.ping.ok
          ? `rgba(150,255,170,${0.85 * (1 - k)})`
          : `rgba(255,120,110,${0.85 * (1 - k)})`;
        g.lineWidth = 2.5;
        g.beginPath();
        g.ellipse(sx, sy, this.s * (0.2 + k * 0.55), this.s * (0.1 + k * 0.27), 0, 0, Math.PI * 2);
        g.stroke();
      }
    }

    // command cursor
    if (this.cmd != null && this.hover) {
      const [sx, sy] = this.P(this.hover.x, this.hover.y, 0.12);
      g.strokeStyle = "rgba(255,236,140,0.85)";
      g.lineWidth = 2;
      g.beginPath();
      g.ellipse(sx, sy, this.s * 0.54, this.s * 0.27, 0, 0, Math.PI * 2);
      g.stroke();
    }
  }
}
