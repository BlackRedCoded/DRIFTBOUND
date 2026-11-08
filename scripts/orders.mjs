// Interaction test: drives every ordered job through the engine API on a
// controlled four-tile raft.
import { build } from "esbuild";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

const ctx = new Proxy(
  {
    globalAlpha: 1,
    fillStyle: "#000",
    strokeStyle: "#000",
    lineWidth: 1,
    font: "",
    textAlign: "",
    measureText: () => ({ width: 8 }),
    createPattern: () => ({ setTransform() {} }),
  },
  {
    get(t, k) {
      return k in t ? t[k] : () => {};
    },
    set(t, k, v) {
      t[k] = v;
      return true;
    },
  }
);

function makeCanvas(w = 512, h = 512) {
  return { width: w, height: h, style: {}, getContext: () => ctx, addEventListener() {}, removeEventListener() {} };
}

const listeners = {};
globalThis.window = {
  innerWidth: 1280,
  innerHeight: 800,
  devicePixelRatio: 1,
  addEventListener(t, f) {
    (listeners[t] = listeners[t] || []).push(f);
  },
  removeEventListener() {},
};
globalThis.document = { createElement: () => makeCanvas() };
let pending = null;
globalThis.requestAnimationFrame = (fn) => {
  pending = fn;
  return 1;
};
globalThis.cancelAnimationFrame = () => {};
globalThis.performance = { now: () => Date.now() };
globalThis.DOMMatrix = class {};

const out = mkdtempSync(join(tmpdir(), "eng-"));
await build({
  entryPoints: ["src/game/engine.ts"],
  bundle: true,
  format: "esm",
  outfile: join(out, "engine.mjs"),
  logLevel: "error",
});
const { Game } = await import(pathToFileURL(join(out, "engine.mjs")).href);

let pass = 0,
  fail = 0;
function check(name, cond, extra = "") {
  if (cond) {
    pass++;
    console.log("  ok   ", name, extra);
  } else {
    fail++;
    console.log("  FAIL ", name, extra);
  }
}

const canvas = makeCanvas();
const g = new Game(canvas);
let t = 0;
const step = (sec) => {
  for (let i = 0; i < Math.round(sec * 60); i++) {
    t += 16.7;
    const fn = pending;
    pending = null;
    if (fn) fn(t);
  }
};
const status = (id) => g.snapshot().colonists.find((c) => c.id === id)?.status;

// calm daylight, plenty of stores
g.time = 240 * 0.4;
g.res.plank = 40;
g.res.rope = 20;
g.res.wood = 20;
g.spawnT = 1e9; // no flotage during the build tests

// --- a tidy 4-tile raft: (0,0) tree, (1,0) empty, (-1,0) empty, (0,1) empty
g.tiles.clear();
const TILES = [
  [0, 0],
  [1, 0],
  [0, 1],
  [1, 1],
  [0, 2],
  [1, 2],
];
for (const [x, y] of TILES)
  g.tiles.set(x + "," + y, { kind: "floor", x, y, bp: false, progress: 1, claim: null, dead: false, pink: x === 0 && y === 0 });
g.structs.clear();
g.structs.set("0,0", { id: 500, kind: "tree", x: 0, y: 0, bp: false, progress: 1, claim: null, dead: false, fruit: 3, fruitT: 0 });
const cols = g.colonists;
cols.length = 1;
const c = cols[0];
c.x = 0;
c.y = 1;
c.task = null;
c.idleT = 1e9;

console.log("\n# direct assignment");
g.selectColonist(c.id);
const snapSel = g.snapshot();
check("selecting a colonist enters command mode", snapSel.commanded === c.name);

// build the bench blueprint on (1,0)
g.place("bench", 1, 0, true);
check("blueprint placed", g.structAt(1, 0)?.bp === true);
const bench = g.structAt(1, 0);
check("order assigned", g.orderBuild(c, bench));
step(12);
check("bench finished", g.structAt(1, 0) && !g.structAt(1, 0).bp, `status=${status(c.id)}`);

// craft at the bench
const before = { ...g.res };
check("craft order accepted", g.orderStruct(c, "craft", g.structAt(1, 0)));
step(10);
check("planks crafted", g.res.plank - before.plank === 3 && before.wood - g.res.wood === 2);

// harvest from the tree
g.structAt(0, 0).fruit = 3;
check("harvest order accepted", g.orderStruct(c, "harvest", g.structAt(0, 0)));
step(8);
check("lemons harvested", g.structAt(0, 0).fruit === 0 && g.res.lemon > 0, `lemons=${g.res.lemon}`);

// fishing rod on the edge tile (1,2)
const rodErr = g.canPlace("rod", 1, 2);
g.place("rod", 1, 2, true);
check("rod blueprint placed", g.structAt(1, 2)?.bp === true, `err=${rodErr}`);
g.orderBuild(c, g.structAt(1, 2));
step(12);
check("rod finished", g.structAt(1, 2) && !g.structAt(1, 2).bp);
const fishBefore = g.res.fish;
g.orderStruct(c, "fish", g.structAt(1, 2));
step(12);
check("fished", g.res.fish > fishBefore, `fish=${g.res.fish}`);

// bed on (1,1) – move the colonist off the tile first
c.x = 0;
c.y = 1;
const bedErr = g.canPlace("bed", 1, 1);
g.place("bed", 1, 1, true);
check("bed blueprint placed", g.structAt(1, 1)?.bp === true, `err=${bedErr}`);
g.orderBuild(c, g.structAt(1, 1));
step(12);
check("bed finished", g.structAt(1, 1) && !g.structAt(1, 1).bp);
c.energy = 30;
g.orderStruct(c, "sleep", g.structAt(1, 1));
console.log("   dbg task:", JSON.stringify({ t: c.task?.type, ph: c.task?.phase, path: c.task?.path, pos: [c.x, c.y] }));
// wait until the colonist has actually walked over and lain down
for (let i = 0; i < 600 && !c.lying; i++) step(1 / 60);
check("sleeping in the bed", c.lying === true, `energy=${Math.round(c.energy)} bed=${g.structAt(1, 1).claim} col=${c.id}`);
step(30);
check("woke up rested", c.energy > 90 && !c.lying, `energy=${Math.round(c.energy)}`);

console.log("\n# no automatic work");
const idle0 = { ...g.res };
g.release(c);
c.idleT = 0;
step(40);
check(
  "idle colonist does no work",
  g.res.wood === idle0.wood && g.res.plank <= idle0.plank && g.res.fish <= idle0.fish + 1,
  `status=${status(c.id)} wood=${g.res.wood}/${idle0.wood} plank=${g.res.plank}/${idle0.plank}`
);

console.log("\n# flotage + swimming");
// marking happens only through the panel action
g.flotage.push({ id: 900, x: 3.2, y: 1.4, kind: "wood", marked: false, claim: null, stuck: true, age: 0, retry: 0 });
step(0.1);
check("flotage spawns unmarked", g.flotage[0].marked === false);
g.sel = { kind: "flotage", id: 900 };
let sel = g.snapshot().selection;
check("panel offers Salvage", sel?.canMark === true && sel?.marked === false);
g.toggleMark();
sel = g.snapshot().selection;
check("Salvage marks it", sel?.marked === true);

g.selectColonist(c.id);
check("order to salvage accepted", g.orderSalvage(c, g.flotage[0]));
step(1);
check("walks to the raft edge", !!c.task, `phase=${c.task?.phase}`);
step(10);
const wasSwimming = g.snapshot().colonists.find((x) => x.id === c.id)?.swimming === true || c.swimming === true;
check("enters the water", wasSwimming || g.flotage.length === 0, `swim=${c.swimming}`);
step(25);
check("salvage returned home", g.flotage.length === 0 && !c.swimming, `pos=${c.x.toFixed(1)},${c.y.toFixed(1)}`);
check("back on the raft", !!g.tileAt(Math.round(c.x), Math.round(c.y)));

// unmarked flotage must not be salvageable
g.flotage.push({ id: 901, x: -3.4, y: 0.2, kind: "barrel", marked: false, claim: null, stuck: true, age: 0, retry: 0 });
check("cannot order unmarked salvage", g.orderSalvage(c, g.flotage[g.flotage.length - 1]) === false);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
