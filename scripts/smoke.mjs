// Headless smoke test: bundles the engine with esbuild, stubs a 2D canvas and
// runs several simulated minutes of game time to catch runtime errors.
import { build } from "esbuild";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

const calls = { fill: 0, stroke: 0, ellipse: 0, path: 0 };
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
    calls.path++;
  },
  moveTo() {},
  lineTo() {},
  closePath() {},
  fill() {
    calls.fill++;
  },
  stroke() {
    calls.stroke++;
  },
  rect() {},
  fillRect() {},
  strokeRect() {},
  arc() {},
  arcTo() {},
  ellipse() {
    calls.ellipse++;
  },
  fillText() {},
  strokeText() {},
  createPattern() {
    return { setTransform() {} };
  },
  createLinearGradient() {
    return { addColorStop() {} };
  },
  measureText() {
    return { width: 10 };
  },
};

function makeCanvas(w = 300, h = 150) {
  const el = {
    width: w,
    height: h,
    style: {},
    getContext: () => ctx,
    addEventListener(type, fn) {
      el._h = el._h || {};
      (el._h[type] = el._h[type] || []).push(fn);
    },
    removeEventListener() {},
    dispatch(type, ev) {
      ((el._h && el._h[type]) || []).forEach((f) => f(ev));
    },
  };
  return el;
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
globalThis.document = {
  createElement: (tag) => (tag === "canvas" ? makeCanvas(512, 512) : { style: {} }),
};
let pending = null;
globalThis.requestAnimationFrame = (fn) => {
  pending = fn;
  return 1;
};
globalThis.cancelAnimationFrame = () => {
  pending = null;
};
globalThis.performance = { now: () => Date.now() };
globalThis.DOMMatrix = class {
  constructor(m) {
    this.a = 1;
    this.b = 0;
    this.c = 0;
    this.d = 1;
    this.e = 0;
    this.f = 0;
    if (m) [this.a, this.b, this.c, this.d, this.e, this.f] = m;
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

const canvas = makeCanvas(1280, 800);
const game = new mod.Game(canvas);

let t = 0;
function tick(seconds, step = 1 / 60) {
  const n = Math.round(seconds / step);
  for (let i = 0; i < n; i++) {
    t += step * 1000;
    const fn = pending;
    pending = null;
    if (!fn) throw new Error("no frame scheduled");
    fn(t);
  }
}

function click(x, y) {
  canvas.dispatch("mousedown", { button: 0, offsetX: x, offsetY: y, movementY: 0 });
  (listeners["mouseup"] || []).forEach((f) => f({ button: 0 }));
}

game.setSpeed(4);
tick(150);

let snap = game.snapshot();
console.log("colonists:", snap.colonists.map((c) => c.name + "=" + c.status).join(", "));
console.log("flotage:", snap.flotageCount, "day:", snap.day, "res:", JSON.stringify(snap.res));

// find a flotage on screen by scanning
function findFlotage() {
  for (let x = 200; x <= 1080; x += 16) {
    for (let y = 160; y <= 700; y += 16) {
      click(x, y);
      const s2 = game.snapshot();
      if (s2.selection && s2.selection.kind === "flotage") return s2.selection;
    }
  }
  return null;
}

game.focusFlotage();
tick(0.5);
let sel = findFlotage();
console.log("selected flotage:", !!sel, sel ? "marked=" + sel.marked : "");
if (sel) {
  game.toggleMark();
  snap = game.snapshot();
  console.log("marked after Salvage:", snap.selection && snap.selection.marked);

  // command the first colonist, then assign the flotage through the panel
  const cid = snap.colonists[0].id;
  game.selectColonist(cid);
  snap = game.snapshot();
  console.log("commanding:", snap.commanded, "canAssign:", snap.selection && snap.selection.canAssign);
  // re-select the flotage in inspection mode by releasing command, then assign
  game.selectColonist(cid);
  for (let x = 200; x <= 1080; x += 16) {
    for (let y = 160; y <= 700; y += 16) {
      const p = game;
      // stop scanning once a collect order is running
      if (game.snapshot().colonists[0].status === "Salvaging") break;
      void p;
      void x;
      void y;
      break;
    }
    break;
  }
  // direct click order: click the flotage while commanding
  for (let x = 200; x <= 1080; x += 16) {
    for (let y = 160; y <= 700; y += 16) {
      click(x, y);
      const st = game.snapshot().colonists[0].status;
      if (st === "Salvaging") {
        x = 9999;
        y = 9999;
      }
    }
  }
  snap = game.snapshot();
  console.log(
    "after command:",
    snap.colonists.map((c) => c.name + "=" + c.status + (c.swimming ? "(wet)" : "")).join(", ")
  );
  game.setSpeed(6);
  tick(80);
  snap = game.snapshot();
  console.log(
    "after swim:",
    snap.colonists.map((c) => c.name + "=" + c.status + (c.swimming ? "(wet)" : "")).join(", "),
    "flotage left:",
    snap.flotageCount
  );
  const stranded = snap.colonists.filter((c) => c.swimming);
  console.log("still swimming:", stranded.length);
}

// zoom hard both ways, rotate, and build
for (let i = 0; i < 24; i++) {
  canvas.dispatch("wheel", { deltaY: i < 12 ? -120 : 120, preventDefault() {}, offsetX: 600, offsetY: 400 });
  tick(0.15);
}
game.rotate(1);
tick(1.5);
game.rotate(-1);
tick(1.5);

// assign harvest / craft / build orders to be sure those paths run
const s3 = game.snapshot();
const first = s3.colonists[0];
if (first) {
  game.selectColonist(first.id);
  click(640, 400);
  tick(2);
}
game.setTool("floor");
tick(0.2);
game.setTool(null);
tick(0.5);

console.log("draw fills:", calls.fill, "ellipses:", calls.ellipse);
console.log("OK");
