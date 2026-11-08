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

type TaskType = "eat" | "sleep" | "build" | "craft" | "fish" | "harvest" | "collect" | "wander";
interface Task {
  type: TaskType;
  phase: "move" | "work";
  path: Pt[];
  t: number;
  re: number;
  struct?: Struct;
  tile?: Tile;
  fl?: Flotage;
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
  fx: number;
  fy: number;
  walk: number;
  lying: boolean;
  look: Look;
  moving: boolean;
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
const rgb = (c: RGB, k = 1, a = 1) =>
  `rgba(${Math.round(clamp(c[0] * k, 0, 255))},${Math.round(clamp(c[1] * k, 0, 255))},${Math.round(
    clamp(c[2] * k, 0, 255)
  )},${a})`;
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
      idleT: 1,
      fx: 0,
      fy: 1,
      walk: 0,
      lying: false,
      look: LOOKS[idx % LOOKS.length],
      moving: false,
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
        pts[i][j] = { x: i * cell + (Math.random() - 0.5) * cell * 0.7, y: j * cell + (Math.random() - 0.5) * cell * 0.7 };
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
    if (t) this.sel = null;
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
  toggleMark() {
    if (this.sel?.kind === "flotage") {
      const f = this.flotage.find((f) => f.id === this.sel!.id);
      if (f) {
        f.marked = !f.marked;
        if (!f.marked) this.releaseFlotage(f);
      }
    }
  }
  demolishSelected() {
    if (this.sel?.kind === "struct") {
      const s = [...this.structs.values()].find((s) => s.id === this.sel!.id);
      if (s) this.demolishAt(s.x, s.y, true);
      this.sel = null;
    }
  }
  clearSelection() {
    this.sel = null;
  }
  selectColonist(id: number) {
    this.sel = { kind: "colonist", id };
    this.tool = null;
    const c = this.colonists.find((c) => c.id === id);
    if (c) {
      this.cam.x = c.x;
      this.cam.y = c.y;
    }
  }

  // ---------------------------------------------------------------- helpers
  private toast(text: string, bad = false) {
    this.toasts.push({ id: this.nextId++, text, at: Date.now(), bad });
    if (this.toasts.length > 6) this.toasts.shift();
  }

  private structAt(x: number, y: number) {
    return this.structs.get(key(x, y));
  }
  private tileAt(x: number, y: number) {
    return this.tiles.get(key(x, y));
  }
  private walkable(x: number, y: number) {
    const t = this.tileAt(x, y);
    return !!t && !t.bp && !this.structAt(x, y);
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
    // do not trap the raft: all walkable tiles must remain connected
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
        // keep raft connected & never remove last
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

  // ---------------------------------------------------------------- AI
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

  private findAdj<T>(c: Colonist, fn: (x: number, y: number) => T | null) {
    return this.bfs<T>(Math.round(c.x), Math.round(c.y), (x, y) => {
      for (const [dx, dy] of DIRS) {
        const t = fn(x + dx, y + dy);
        if (t) return t;
      }
      return null;
    });
  }

  private foodCount() {
    return this.res.lemon + this.res.fish;
  }

  private pickTask(c: Colonist): Task | null {
    const mk = (type: TaskType, phase: "move" | "work", path: Pt[]): Task => ({ type, phase, path, t: 0, re: 0 });
    if (c.hunger < 45 && this.foodCount() > 0) return mk("eat", "work", []);

    const dl = this.daylight();
    if (c.energy < 25 || (dl < 0.3 && c.energy < 75)) {
      const r = this.findAdj(c, (x, y) => {
        const s = this.structAt(x, y);
        return s && s.kind === "bed" && !s.bp && !s.claim ? s : null;
      });
      if (r) {
        r.target.claim = c.id;
        const t = mk("sleep", "move", r.path);
        t.struct = r.target;
        return t;
      }
      return mk("sleep", "work", []);
    }

    // flotage the player marked
    {
      let best: Flotage | null = null;
      let bd = 1e9;
      for (const f of this.flotage) {
        if (!f.marked || f.claim || f.retry > this.time) continue;
        const d = Math.hypot(f.x - c.x, f.y - c.y);
        if (d < bd) {
          bd = d;
          best = f;
        }
      }
      if (best) {
        best.claim = c.id;
        const t = mk("collect", "move", []);
        t.fl = best;
        t.re = 0;
        return t;
      }
    }

    // construction
    const b = this.findAdj<Tile | Struct>(c, (x, y) => {
      const t = this.tileAt(x, y);
      if (t && t.bp && !t.claim) return t;
      const s = this.structAt(x, y);
      if (s && s.bp && !s.claim) return s;
      return null;
    });
    if (b) {
      b.target.claim = c.id;
      const t = mk("build", "move", b.path);
      if ("id" in b.target) t.struct = b.target;
      else t.tile = b.target;
      return t;
    }

    const structJob = (type: TaskType, kind: Struct["kind"], extra: (s: Struct) => boolean) => {
      const r = this.findAdj(c, (x, y) => {
        const s = this.structAt(x, y);
        return s && s.kind === kind && !s.bp && !s.claim && extra(s) ? s : null;
      });
      if (!r) return null;
      r.target.claim = c.id;
      const t = mk(type, "move", r.path);
      t.struct = r.target;
      return t;
    };

    const cap = this.cap();
    if (this.res.wood >= 2 && this.res.plank < cap - 3) {
      const t = structJob("craft", "bench", () => true);
      if (t) return t;
    }
    if (this.res.lemon < cap / 2) {
      const t = structJob("harvest", "tree", (s) => s.fruit > 0);
      if (t) return t;
    }
    if (this.res.fish < 30) {
      const t = structJob("fish", "rod", () => true);
      if (t) return t;
    }
    return null;
  }

  private releaseFlotage(f: Flotage) {
    f.claim = null;
  }

  private release(c: Colonist) {
    const t = c.task;
    if (t) {
      if (t.struct && t.struct.claim === c.id) t.struct.claim = null;
      if (t.tile && t.tile.claim === c.id) t.tile.claim = null;
      if (t.fl && t.fl.claim === c.id) t.fl.claim = null;
    }
    if (c.lying) {
      c.lying = false;
    }
    c.task = null;
    c.moving = false;
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
      default:
        return true;
    }
  }

  private updateColonist(c: Colonist, dt: number) {
    const night = this.daylight() < 0.3;
    c.hunger = Math.max(0, c.hunger - 0.3 * dt);
    if (!(c.task && c.task.type === "sleep" && c.task.phase === "work")) c.energy = Math.max(0, c.energy - (night ? 0.28 : 0.2) * dt);
    if (c.hunger <= 0) c.health -= 0.9 * dt;
    else if (c.hunger > 35 && c.health < 100) c.health = Math.min(100, c.health + 0.6 * dt);
    if (c.energy <= 0) c.health -= 0.2 * dt;
    if (c.health <= 0) {
      this.release(c);
      this.colonists = this.colonists.filter((x) => x !== c);
      this.toast(`${c.name} has died.`, true);
      if (this.sel?.kind === "colonist" && this.sel.id === c.id) this.sel = null;
      if (!this.colonists.length) {
        this.over = true;
        this.speed = 0;
      }
      return;
    }

    c.moving = false;
    if (!c.task) {
      if (c.idleT > 0) {
        c.idleT -= dt;
        return;
      }
      const t = this.pickTask(c);
      if (t) {
        c.task = t;
      } else {
        // wander a little
        c.idleT = 2 + Math.random() * 4;
        const open: Pt[] = [];
        this.tiles.forEach((tl) => {
          if (this.walkable(tl.x, tl.y)) open.push(tl);
        });
        if (open.length && Math.random() < 0.6) {
          const g = open[Math.floor(Math.random() * open.length)];
          const r = this.bfs(Math.round(c.x), Math.round(c.y), (x, y) => (x === g.x && y === g.y ? true : null));
          if (r && r.path.length) c.task = { type: "wander", phase: "move", path: r.path, t: 0, re: 0 };
        }
      }
      return;
    }

    const t = c.task;
    if (!this.valid(t)) {
      this.release(c);
      c.idleT = 0.3;
      return;
    }
    const food = this.foodCount();
    if (t.type !== "eat" && t.type !== "sleep" && t.type !== "wander") {
      if ((c.hunger < 25 && food > 0) || c.energy < 10) {
        this.release(c);
        c.idleT = 0;
        return;
      }
    }
    if (t.type === "sleep" && c.hunger < 20 && food > 0) {
      this.release(c);
      c.idleT = 0;
      return;
    }

    if (t.phase === "move") {
      if (t.type === "collect") {
        t.re -= dt;
        if (t.re <= 0) {
          t.re = 0.5;
          if (!this.replanCollect(c, t)) {
            t.fl!.retry = this.time + 4;
            this.release(c);
            return;
          }
        }
      }
      if (!t.path.length) {
        t.phase = "work";
        t.t = 0;
        if (t.type === "sleep" && t.struct) {
          c.x = t.struct.x;
          c.y = t.struct.y;
          c.lying = true;
        }
        return;
      }
      const wp = t.path[0];
      const dx = wp.x - c.x,
        dy = wp.y - c.y;
      const d = Math.hypot(dx, dy);
      const step = 1.7 * dt;
      if (d <= step) {
        c.x = wp.x;
        c.y = wp.y;
        t.path.shift();
      } else {
        c.x += (dx / d) * step;
        c.y += (dy / d) * step;
      }
      if (d > 0.001) {
        c.fx = dx / d;
        c.fy = dy / d;
      }
      c.moving = true;
      c.walk += dt * 9;
      // path blocked by a new structure?
      if (t.path.length && !this.walkable(t.path[0].x, t.path[0].y)) {
        this.release(c);
        c.idleT = 0.2;
      }
      return;
    }

    // work phase
    const done = () => {
      this.release(c);
      c.idleT = 0.4;
    };
    switch (t.type) {
      case "wander":
        done();
        break;
      case "eat": {
        t.t += dt;
        if (t.t >= 2) {
          if (this.res.fish > 0) {
            this.res.fish--;
            c.hunger = Math.min(100, c.hunger + 45);
          } else if (this.res.lemon > 0) {
            this.res.lemon--;
            c.hunger = Math.min(100, c.hunger + 30);
          }
          done();
        }
        break;
      }
      case "sleep": {
        c.energy = Math.min(100, c.energy + (t.struct ? 3 : 1.3) * dt);
        if (c.energy >= 99.5) {
          if (t.struct) {
            // step out of bed
            const out = DIRS.map(([dx, dy]) => ({ x: t.struct!.x + dx, y: t.struct!.y + dy })).find((p) => this.walkable(p.x, p.y));
            if (out) {
              c.x = out.x;
              c.y = out.y;
            }
          }
          done();
        }
        break;
      }
      case "build": {
        const obj = (t.tile ?? t.struct)!;
        const kind: BuildKind = t.tile ? "floor" : (t.struct!.kind as BuildKind);
        const target = t.struct ?? t.tile!;
        const tx = target.x,
          ty = target.y;
        c.fx = Math.sign(tx - c.x) || c.fx;
        c.fy = Math.sign(ty - c.y) || c.fy;
        obj.progress += dt / BUILDINGS[kind].time;
        if (obj.progress >= 1) {
          obj.progress = 1;
          obj.bp = false;
          done();
        }
        break;
      }
      case "craft": {
        t.t += dt;
        if (t.t >= 4) {
          if (this.res.wood >= 2) {
            this.res.wood -= 2;
            this.addRes("plank", 3);
          }
          done();
        }
        break;
      }
      case "fish": {
        t.t += dt;
        if (t.t >= 7) {
          this.addRes("fish", 1);
          if (Math.random() < 0.25) this.addRes("rope", 1);
          done();
        }
        break;
      }
      case "harvest": {
        t.t += dt;
        if (t.t >= 2.5) {
          this.addRes("lemon", t.struct!.fruit);
          t.struct!.fruit = 0;
          t.struct!.fruitT = 0;
          done();
        }
        break;
      }
      case "collect": {
        const f = t.fl!;
        if (Math.hypot(f.x - c.x, f.y - c.y) > 1.8) {
          t.phase = "move";
          t.re = 0;
          break;
        }
        c.fx = f.x - c.x;
        c.fy = f.y - c.y;
        t.t += dt;
        if (t.t >= 0.8) {
          this.collect(f);
          done();
        }
        break;
      }
    }
  }

  private replanCollect(c: Colonist, t: Task) {
    const f = t.fl!;
    let best: Tile | null = null;
    let bd = 1e9;
    this.tiles.forEach((tl) => {
      if (!this.walkable(tl.x, tl.y)) return;
      const d = Math.hypot(tl.x - f.x, tl.y - f.y);
      if (d < bd) {
        bd = d;
        best = tl;
      }
    });
    if (!best || bd > 6) return false;
    const g = best as Tile;
    const r = this.bfs(Math.round(c.x), Math.round(c.y), (x, y) => (x === g.x && y === g.y ? true : null));
    if (!r) return false;
    // keep walking smoothly toward the first waypoint if we're mid-step
    t.path = r.path;
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
      x: c.x - this.cur.x * 15 + px * off,
      y: c.y - this.cur.y * 15 + py * off,
      kind,
      marked: false,
      claim: null,
      stuck: false,
      age: 0,
      retry: 0,
    };
    this.flotage.push(f);
    this.toast(kind === "survivor" ? "A survivor is drifting toward the raft!" : "Flotage spotted! Click it to salvage.");
  }

  private step(dt: number) {
    this.time += dt;
    // trees
    this.structs.forEach((s) => {
      if (s.kind === "tree" && s.fruit < 3) {
        s.fruitT += dt;
        if (s.fruitT >= 25) {
          s.fruit++;
          s.fruitT = 0;
        }
      }
    });
    // flotage
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
      }
    }
    for (const c of [...this.colonists]) this.updateColonist(c, dt);
  }

  // ---------------------------------------------------------------- frame
  private frame(dt: number) {
    this.realTime += dt;
    // camera
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
    // drag-paint
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
      }
    });
    on(window, "keyup", (e: KeyboardEvent) => this.keys.delete(e.key.toLowerCase()));
    on(window, "blur", () => this.keys.clear());
    on(cv, "contextmenu", (e: Event) => e.preventDefault());
    on(cv, "wheel", (e: WheelEvent) => {
      e.preventDefault();
      this.s = clamp(this.s * (e.deltaY < 0 ? 1.1 : 1 / 1.1), 26, 130);
    }, { passive: false });
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
          else this.sel = null;
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

  private clickSelect() {
    const mx = this.mouse.x,
      my = this.mouse.y;
    // colonists
    let best: Colonist | null = null;
    let bd = this.s * 0.5;
    for (const c of this.colonists) {
      const p = this.P(c.x, c.y, 0.55);
      const d = Math.hypot(p[0] - mx, p[1] - my);
      if (d < bd) {
        bd = d;
        best = c;
      }
    }
    if (best) {
      this.sel = { kind: "colonist", id: best.id };
      return;
    }
    let bf: Flotage | null = null;
    bd = this.s * 0.6;
    for (const f of this.flotage) {
      const p = this.P(f.x, f.y, 0.1);
      const d = Math.hypot(p[0] - mx, p[1] - my);
      if (d < bd) {
        bd = d;
        bf = f;
      }
    }
    if (bf) {
      this.sel = { kind: "flotage", id: bf.id };
      bf.marked = !bf.marked;
      if (!bf.marked) this.releaseFlotage(bf);
      return;
    }
    for (const z of [0.4, 1.3]) {
      const g = this.ground(mx, my, z);
      const s = this.structAt(Math.round(g.x), Math.round(g.y));
      if (s && (z < 1 || s.kind === "tree")) {
        this.sel = { kind: "struct", id: s.id };
        return;
      }
    }
    const g = this.ground(mx, my, 0.08);
    const t = this.tileAt(Math.round(g.x), Math.round(g.y));
    this.sel = t ? { kind: "tile", id: 0, x: t.x, y: t.y } : null;
  }

  // ---------------------------------------------------------------- snapshot
  snapshot(): Snapshot {
    const now = Date.now();
    let selection: SelectionSnap | null = null;
    if (this.sel) {
      const sel = this.sel;
      if (sel.kind === "colonist") {
        const c = this.colonists.find((c) => c.id === sel.id);
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
          };
      } else if (sel.kind === "struct") {
        const s = [...this.structs.values()].find((s) => s.id === sel.id);
        if (s) {
          const lines: string[] = [];
          if (s.bp) lines.push(`Under construction ${Math.round(s.progress * 100)}%`);
          else if (s.kind === "tree") lines.push(`Lemons ready: ${s.fruit}/3`, "Colonists harvest it automatically.");
          else lines.push(BUILDINGS[s.kind].desc);
          selection = {
            kind: "struct",
            id: s.id,
            title: STRUCT_NAMES[s.kind] + (s.bp ? " (blueprint)" : ""),
            lines,
            canDemolish: s.kind !== "tree",
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
              f.marked ? "Marked – a colonist will fetch it." : "Click it to mark for salvage.",
              f.stuck ? "Caught against the raft." : "Drifting with the current.",
            ],
            canMark: true,
            marked: f.marked,
          };
      } else if (sel.kind === "tile") {
        const t = this.tileAt(sel.x!, sel.y!);
        if (t) selection = { kind: "tile", id: 0, title: "Raft Floor", lines: [t.bp ? "Under construction" : "Sturdy planks floating on the sea."] };
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
      colonists: this.colonists.map((c, i) => ({
        id: c.id,
        name: c.name,
        status: this.status(c),
        hunger: c.hunger,
        energy: c.energy,
        health: c.health,
        ...lookColors(LOOKS.indexOf(c.look) >= 0 ? LOOKS.indexOf(c.look) : i),
      })),
      selection,
      tool: this.tool,
      toasts: this.toasts.filter((t) => now - t.at < 6000),
      flotageCount: this.flotage.length,
      over: this.over,
      floors,
      structs: [...counts.entries()].map(([name, count]) => ({ name, count })),
    };
  }

  private status(c: Colonist) {
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

  // ---------------------------------------------------------------- rendering
  private P(x: number, y: number, z: number): [number, number] {
    const dx = x - this.cam.x,
      dy = y - this.cam.y;
    const c = Math.cos(this.ang),
      sn = Math.sin(this.ang);
    const rx = dx * c - dy * sn,
      ry = dx * sn + dy * c;
    return [this.W / 2 + (rx - ry) * this.s, this.H / 2 + (rx + ry) * this.s * 0.5 - z * this.s * 0.85];
  }
  private depth(x: number, y: number) {
    const dx = x - this.cam.x,
      dy = y - this.cam.y;
    const c = Math.cos(this.ang),
      sn = Math.sin(this.ang);
    return dx * c - dy * sn + dx * sn + dy * c;
  }

  private poly(pts: [number, number][], fill: string) {
    const g = this.ctx;
    g.fillStyle = fill;
    g.strokeStyle = fill;
    g.lineWidth = 0.8;
    g.beginPath();
    g.moveTo(pts[0][0], pts[0][1]);
    for (let i = 1; i < pts.length; i++) g.lineTo(pts[i][0], pts[i][1]);
    g.closePath();
    g.fill();
    g.stroke();
  }

  private box(x: number, y: number, z0: number, z1: number, w: number, d: number, col: RGB, alpha = 1, zoff = 0) {
    const hw = w / 2,
      hd = d / 2;
    const c = Math.cos(this.ang),
      sn = Math.sin(this.ang);
    const g = this.ctx;
    const prevA = g.globalAlpha;
    g.globalAlpha = prevA * alpha;
    z0 += zoff;
    z1 += zoff;
    for (const [nx, ny] of DIRS) {
      const rx = nx * c - ny * sn,
        ry = nx * sn + ny * c;
      if (rx + ry <= 0.001) continue;
      let ax: number, ay: number, bx: number, by: number;
      if (nx !== 0) {
        ax = x + nx * hw;
        ay = y - hd;
        bx = ax;
        by = y + hd;
      } else {
        ay = y + ny * hd;
        ax = x - hw;
        bx = x + hw;
        by = ay;
      }
      const k = clamp(0.5 + 0.3 * rx + 0.14 * ry, 0.35, 0.95);
      this.poly([this.P(ax, ay, z0), this.P(bx, by, z0), this.P(bx, by, z1), this.P(ax, ay, z1)], rgb(col, k));
    }
    this.poly(
      [this.P(x - hw, y - hd, z1), this.P(x + hw, y - hd, z1), this.P(x + hw, y + hd, z1), this.P(x - hw, y + hd, z1)],
      rgb(col, 1.02)
    );
    g.globalAlpha = prevA;
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

  private render() {
    const g = this.ctx;
    g.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    // ocean
    if (!this.pattern) this.pattern = g.createPattern(this.bgCanvas, "repeat");
    const o = this.P(0, 0, 0);
    const k = this.s / 58;
    if (this.pattern) {
      const drift = this.realTime * 6;
      this.pattern.setTransform(new DOMMatrix().translate(o[0] * 0.9 + drift, o[1] * 0.9 + drift * 0.4).scale(k));
      g.fillStyle = this.pattern;
      g.fillRect(0, 0, this.W, this.H);
    }
    // sparkles on water
    g.fillStyle = "rgba(255,255,255,0.35)";
    for (let i = 0; i < 26; i++) {
      const px = ((i * 197 + this.realTime * (10 + (i % 5) * 3)) % (this.W + 40)) - 20;
      const py = (i * 131) % this.H;
      const tw = 0.5 + 0.5 * Math.sin(this.realTime * 2 + i);
      g.fillRect(px, py, 2 + tw * 3, 1.5);
    }

    const bob = Math.sin(this.realTime * 1.4) * 0.025;

    // foam under tiles
    this.tiles.forEach((t) => {
      const a = t.bp ? 0.25 : 0.55;
      g.globalAlpha = a;
      this.box(t.x, t.y, -0.3, -0.29, 1.2, 1.2, [200, 245, 250], 1, bob);
      g.globalAlpha = 1;
    });

    // tiles
    const tiles = [...this.tiles.values()].sort((a, b) => this.depth(a.x, a.y) - this.depth(b.x, b.y));
    for (const t of tiles) {
      const alpha = t.bp ? 0.45 : 1;
      this.box(t.x, t.y, -0.3, -0.17, 1, 1, [190, 240, 240], alpha, bob);
      this.box(t.x, t.y, -0.17, 0.08, 1, 1, [92, 42, 78], alpha, bob);
      g.globalAlpha = alpha;
      if (t.pink) this.box(t.x, t.y, 0.08, 0.1, 0.96, 0.96, [214, 122, 132], 1, bob);
      else {
        // plank lines
        const lc = "rgba(30,10,30,0.55)";
        for (const off of [-0.25, 0, 0.25]) this.line3(t.x + off, t.y - 0.5, 0.082 + bob, t.x + off, t.y + 0.5, 0.082 + bob, lc, 1.3);
      }
      g.globalAlpha = 1;
      if (t.bp && t.progress > 0) this.progressBar(t.x, t.y, 0.3, t.progress);
    }

    // ghost under cursor
    // objects
    type D = { d: number; fn: () => void };
    const list: D[] = [];
    this.structs.forEach((s) => list.push({ d: this.depth(s.x, s.y), fn: () => this.drawStruct(s, bob) }));
    for (const c of this.colonists) list.push({ d: this.depth(c.x, c.y) + 0.01, fn: () => this.drawColonist(c, bob) });
    for (const f of this.flotage) list.push({ d: this.depth(f.x, f.y), fn: () => this.drawFlotage(f) });
    list.sort((a, b) => a.d - b.d);
    for (const it of list) it.fn();

    // placement ghost
    if (this.tool && this.hover) this.drawGhost();

    // day/night
    const dl = this.daylight();
    const dark = 1 - dl;
    if (dark > 0.02) {
      g.fillStyle = `rgba(8,18,60,${dark * 0.55})`;
      g.fillRect(0, 0, this.W, this.H);
    }

    // labels
    this.drawOverlays(bob);
  }

  private progressBar(x: number, y: number, z: number, p: number) {
    const g = this.ctx;
    const [sx, sy] = this.P(x, y, z);
    g.fillStyle = "#1a0f08";
    g.fillRect(sx - 18, sy - 4, 36, 7);
    g.fillStyle = "#7be05a";
    g.fillRect(sx - 17, sy - 3, 34 * clamp(p, 0, 1), 5);
  }

  private drawGhost() {
    const { x, y } = this.hover!;
    const g = this.ctx;
    if (this.tool === "demolish") {
      const has = this.structAt(x, y) || this.tileAt(x, y);
      this.box(x, y, -0.3, 0.9, 1, 1, has ? [240, 60, 50] : [200, 200, 200], has ? 0.35 : 0.12);
      return;
    }
    const kind = this.tool as BuildKind;
    const err = this.canPlace(kind, x, y);
    const col: RGB = err ? [240, 70, 60] : [90, 240, 110];
    if (kind === "floor") this.box(x, y, -0.3, 0.08, 1, 1, col, 0.55);
    else this.box(x, y, 0.08, 0.7, 0.8, 0.8, col, 0.55);
    g.globalAlpha = 1;
  }

  private drawStruct(s: Struct, bob: number) {
    const g = this.ctx;
    const x = s.x,
      y = s.y;
    const alpha = s.bp ? 0.5 : 1;
    const z = bob;
    g.globalAlpha = alpha;
    switch (s.kind) {
      case "tree": {
        this.box(x, y, 0.1, 1.35, 0.3, 0.3, [58, 30, 56], 1, z);
        this.box(x, y, 1.05, 1.9, 1.05, 1.05, [38, 112, 78], 1, z);
        this.box(x, y, 1.9, 2.3, 0.85, 0.85, [52, 140, 92], 1, z);
        // leaf patches
        for (let i = 0; i < 5; i++) {
          const ox = ((i * 37) % 7) / 7 - 0.5;
          const oy = ((i * 53) % 7) / 7 - 0.5;
          this.box(x + ox * 0.5, y + oy * 0.5, 2.3, 2.34, 0.22, 0.22, [30, 96, 70], 1, z);
        }
        for (let i = 0; i < s.fruit; i++) {
          const a = i * 2.1 + 0.6;
          this.box(x + Math.cos(a) * 0.55, y + Math.sin(a) * 0.55, 1.15, 1.4, 0.22, 0.22, [250, 205, 60], 1, z);
        }
        break;
      }
      case "crate": {
        this.box(x, y, 0.1, 0.62, 0.86, 0.86, [138, 74, 48], 1, z);
        this.box(x, y, 0.62, 0.74, 0.92, 0.92, [168, 98, 60], 1, z);
        const lc = "rgba(50,20,10,0.6)";
        for (const off of [-0.27, -0.09, 0.09, 0.27])
          this.line3(x + off, y - 0.46, 0.742 + z, x + off, y + 0.46, 0.742 + z, lc, 1.2);
        break;
      }
      case "bed": {
        this.box(x, y, 0.1, 0.3, 0.8, 0.9, [120, 78, 48], 1, z);
        this.box(x, y, 0.3, 0.44, 0.7, 0.8, [232, 150, 180], 1, z);
        this.box(x, y - 0.28, 0.44, 0.52, 0.5, 0.2, [250, 245, 245], 1, z);
        break;
      }
      case "bench": {
        this.box(x - 0.3, y - 0.3, 0.1, 0.5, 0.1, 0.1, [90, 56, 34], 1, z);
        this.box(x + 0.3, y - 0.3, 0.1, 0.5, 0.1, 0.1, [90, 56, 34], 1, z);
        this.box(x - 0.3, y + 0.3, 0.1, 0.5, 0.1, 0.1, [90, 56, 34], 1, z);
        this.box(x + 0.3, y + 0.3, 0.1, 0.5, 0.1, 0.1, [90, 56, 34], 1, z);
        this.box(x, y, 0.5, 0.62, 0.9, 0.7, [176, 124, 72], 1, z);
        this.box(x - 0.15, y, 0.62, 0.68, 0.4, 0.12, [190, 190, 200], 1, z);
        this.box(x + 0.2, y + 0.1, 0.62, 0.76, 0.14, 0.14, [140, 90, 50], 1, z);
        break;
      }
      case "rod": {
        const d = DIRS.find(([dx, dy]) => !this.tileAt(x + dx, y + dy)) ?? [1, 0];
        const px = x + d[0] * 0.38,
          py = y + d[1] * 0.38;
        this.box(px, py, 0.1, 1.15, 0.12, 0.12, [130, 88, 52], 1, z);
        const tx = x + d[0] * 1.15,
          ty = y + d[1] * 1.15;
        this.line3(px, py, 1.12 + z, tx, ty, 1.0 + z, "#e8d8b0", 3);
        const wob = Math.sin(this.realTime * 3 + s.id) * 0.03;
        this.line3(tx, ty, 1.0 + z, tx, ty, -0.2 + wob, "rgba(255,255,255,0.8)", 1);
        const b = this.P(tx, ty, -0.18 + wob);
        g.fillStyle = "#e84a3a";
        g.beginPath();
        g.arc(b[0], b[1], this.s * 0.07, 0, Math.PI * 2);
        g.fill();
        break;
      }
    }
    g.globalAlpha = 1;
    if (s.bp && s.progress > 0) this.progressBar(x, y, 0.8, s.progress);
    if (s.claim && !s.bp && s.kind !== "tree") {
      /* occupied indicator not needed */
    }
  }

  private drawColonist(c: Colonist, bob: number) {
    const L = c.look;
    const x = c.x,
      y = c.y;
    const z = bob;
    if (c.lying) {
      const bz = 0.44;
      this.box(x, y, bz, bz + 0.14, 0.34, 0.7, L.shirt, 1, z);
      this.box(x, y - 0.3, bz, bz + 0.2, 0.28, 0.24, L.skin, 1, z);
      this.box(x, y - 0.32, bz + 0.2, bz + 0.26, 0.3, 0.26, L.hair, 1, z);
      return;
    }
    const fx = c.fx,
      fy = c.fy;
    const px = -fy,
      py = fx;
    const sw = c.moving ? Math.sin(c.walk) * 0.1 : 0;
    const bz = c.task && c.task.phase === "work" && (c.task.type === "build" || c.task.type === "craft") ? Math.abs(Math.sin(this.realTime * 8)) * 0.04 : 0;
    // shadow
    this.box(x, y, 0.08, 0.1, 0.4, 0.4, [20, 10, 30], 0.2, z);
    this.box(x + px * 0.09 + fx * sw, y + py * 0.09 + fy * sw, 0.1, 0.4, 0.12, 0.12, L.pants, 1, z);
    this.box(x - px * 0.09 - fx * sw, y - py * 0.09 - fy * sw, 0.1, 0.4, 0.12, 0.12, L.pants, 1, z);
    this.box(x, y, 0.4 + bz, 0.76 + bz, 0.34, 0.34, L.shirt, 1, z);
    this.box(x + px * 0.22 - fx * sw * 0.8, y + py * 0.22 - fy * sw * 0.8, 0.44 + bz, 0.72 + bz, 0.1, 0.1, L.skin, 1, z);
    this.box(x - px * 0.22 + fx * sw * 0.8, y - py * 0.22 + fy * sw * 0.8, 0.44 + bz, 0.72 + bz, 0.1, 0.1, L.skin, 1, z);
    this.box(x, y, 0.76 + bz, 1.04 + bz, 0.3, 0.3, L.skin, 1, z);
    this.box(x - fx * 0.02, y - fy * 0.02, 0.98 + bz, 1.1 + bz, 0.34, 0.34, L.hair, 1, z);
    this.box(x - fx * 0.12, y - fy * 0.12, 0.8 + bz, 1.0 + bz, 0.24, 0.24, L.hair, 1, z);
    for (const sgn of [1, -1])
      this.box(x + fx * 0.16 + px * 0.06 * sgn, y + fy * 0.16 + py * 0.06 * sgn, 0.9 + bz, 0.95 + bz, 0.04, 0.04, [20, 10, 20], 1, z);
  }

  private drawFlotage(f: Flotage) {
    const g = this.ctx;
    const z = Math.sin(this.realTime * 2 + f.id) * 0.04 - 0.12;
    const x = f.x,
      y = f.y;
    // water ripple
    const [rx, ry] = this.P(x, y, -0.25);
    g.strokeStyle = "rgba(255,255,255,0.45)";
    g.lineWidth = 1.5;
    g.beginPath();
    g.ellipse(rx, ry, this.s * 0.8, this.s * 0.4, 0, 0, Math.PI * 2);
    g.stroke();
    switch (f.kind) {
      case "wood":
        this.box(x - 0.15, y, 0, 0.22, 0.2, 0.9, [138, 92, 56], 1, z);
        this.box(x + 0.12, y + 0.05, 0, 0.22, 0.2, 0.9, [158, 108, 66], 1, z);
        this.box(x, y - 0.05, 0.22, 0.42, 0.2, 0.8, [128, 84, 50], 1, z);
        break;
      case "planks":
        for (let i = 0; i < 3; i++) this.box(x, y, i * 0.08, i * 0.08 + 0.08, 0.9 - i * 0.06, 0.5, [196, 150, 92], 1, z);
        this.box(x, y, 0.24, 0.3, 0.2, 0.52, [90, 56, 34], 1, z);
        break;
      case "barrel":
        this.box(x, y, 0, 0.55, 0.5, 0.5, [150, 84, 50], 1, z);
        this.box(x, y, 0.15, 0.2, 0.54, 0.54, [60, 40, 30], 1, z);
        this.box(x, y, 0.38, 0.43, 0.54, 0.54, [60, 40, 30], 1, z);
        break;
      case "crate":
        this.box(x, y, 0, 0.55, 0.7, 0.7, [168, 104, 62], 1, z);
        this.box(x, y, 0.55, 0.62, 0.74, 0.74, [188, 124, 76], 1, z);
        break;
      case "survivor": {
        this.box(x, y, 0, 0.1, 0.9, 0.5, [150, 100, 60], 1, z);
        this.box(x, y, 0.1, 0.28, 0.3, 0.3, [90, 140, 200], 1, z);
        this.box(x, y, 0.28, 0.5, 0.26, 0.26, [230, 190, 160], 1, z);
        this.box(x, y, 0.5, 0.58, 0.28, 0.28, [60, 40, 30], 1, z);
        break;
      }
    }
    if (f.marked) {
      const [sx, sy] = this.P(x, y, 0.2);
      g.strokeStyle = `rgba(255,230,90,${0.6 + 0.4 * Math.sin(this.realTime * 5)})`;
      g.lineWidth = 3;
      g.beginPath();
      g.ellipse(sx, sy + this.s * 0.15, this.s * 0.6, this.s * 0.32, 0, 0, Math.PI * 2);
      g.stroke();
    } else {
      // sparkle
      const [sx, sy] = this.P(x, y, 0.8);
      g.fillStyle = `rgba(255,255,255,${0.5 + 0.5 * Math.sin(this.realTime * 4 + f.id)})`;
      g.fillRect(sx - 2, sy - 2, 5, 5);
    }
  }

  private roundRect(x: number, y: number, w: number, h: number, r: number) {
    const g = this.ctx;
    g.beginPath();
    g.moveTo(x + r, y);
    g.arcTo(x + w, y, x + w, y + h, r);
    g.arcTo(x + w, y + h, x, y + h, r);
    g.arcTo(x, y + h, x, y, r);
    g.arcTo(x, y, x + w, y, r);
    g.closePath();
  }

  private drawOverlays(bob: number) {
    const g = this.ctx;
    g.textAlign = "center";
    g.font = `${Math.max(10, Math.round(this.s * 0.2))}px "Patrick Hand", sans-serif`;
    // colonist status bars
    for (const c of this.colonists) {
      const [sx, sy] = this.P(c.x, c.y, c.lying ? 0.9 : 1.35 + bob);
      const w = 54,
        h = 14;
      g.fillStyle = "#3b2a18";
      this.roundRect(sx - w / 2, sy - h, w, h, 3);
      g.fill();
      g.strokeStyle = "#a8854f";
      g.lineWidth = 1.5;
      g.stroke();
      g.fillStyle = "#f6e3b4";
      g.font = '11px "Patrick Hand", sans-serif';
      g.fillText(this.status(c), sx, sy - 3);
    }
    // selection marker
    if (this.sel) {
      let pos: [number, number, number] | null = null;
      let name = "";
      if (this.sel.kind === "colonist") {
        const c = this.colonists.find((c) => c.id === this.sel!.id);
        if (c) (pos = [c.x, c.y, 1.9]), (name = c.name);
      } else if (this.sel.kind === "struct") {
        const s = [...this.structs.values()].find((s) => s.id === this.sel!.id);
        if (s) (pos = [s.x, s.y, s.kind === "tree" ? 3.0 : s.kind === "rod" ? 1.9 : 1.3]), (name = STRUCT_NAMES[s.kind]);
      } else if (this.sel.kind === "flotage") {
        const f = this.flotage.find((f) => f.id === this.sel!.id);
        if (f) (pos = [f.x, f.y, 1.3]), (name = "Flotage");
      } else if (this.sel.kind === "tile") {
        pos = [this.sel.x!, this.sel.y!, 0.9];
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
        g.font = '28px "Patrick Hand", sans-serif';
        g.lineWidth = 4;
        g.strokeStyle = "rgba(10,30,60,0.7)";
        g.strokeText(name, sx, ay - 34);
        g.fillStyle = "#fff";
        g.fillText(name, sx, ay - 34);
      }
    }
    // blueprint tile outline hint for hover without tool
    if (!this.tool && this.hover) {
      /* none */
    }
  }
}
