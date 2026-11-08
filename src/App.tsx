import { useEffect, useRef, useState } from "react";
import { Game } from "./game/engine";
import { BUILDINGS, BuildKind, RES_INFO, RES_KEYS, Snapshot, ToolKind } from "./game/data";

const TABS = [
  { id: "priority", label: "Priority", icon: "☰" },
  { id: "tech", label: "Tech", icon: "💡" },
  { id: "map", label: "Map", icon: "🗺️" },
  { id: "faction", label: "Faction", icon: "🚩" },
  { id: "buildings", label: "Building List", icon: "🏠" },
  { id: "rooms", label: "Room List", icon: "⬡" },
  { id: "pet", label: "Pet", icon: "🐱" },
  { id: "sail", label: "Sail", icon: "☸" },
  { id: "system", label: "System", icon: "⚙" },
] as const;

type TabId = (typeof TABS)[number]["id"];

function Bar({ v, color }: { v: number; color: string }) {
  return (
    <div className="bar w-full">
      <div style={{ width: `${Math.max(0, Math.min(100, v))}%`, background: color }} />
    </div>
  );
}

function costText(cost: Partial<Record<string, number>>) {
  return Object.entries(cost)
    .map(([k, v]) => `${v} ${RES_INFO[k as keyof typeof RES_INFO].icon}`)
    .join("  ");
}

export default function App() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const gameRef = useRef<Game | null>(null);
  const [snap, setSnap] = useState<Snapshot | null>(null);
  const [run, setRun] = useState(0);
  const [menu, setMenu] = useState(false);
  const [tab, setTab] = useState<TabId | null>(null);
  const [hint, setHint] = useState(true);
  const [note, setNote] = useState<string | null>(null);

  useEffect(() => {
    const g = new Game(canvasRef.current!);
    gameRef.current = g;
    setSnap(g.snapshot());
    const id = setInterval(() => setSnap(g.snapshot()), 120);
    return () => {
      clearInterval(id);
      g.destroy();
    };
  }, [run]);

  const game = gameRef.current;
  const say = (t: string) => {
    setNote(t);
    setTimeout(() => setNote(null), 2500);
  };
  const pickTool = (t: ToolKind | null) => {
    game?.setTool(t);
    setMenu(false);
  };

  const s = snap;
  const ratio = s ? s.load / Math.max(1, s.buoy) : 0;
  const buoyLabel = !s ? "" : ratio > 1 ? "Sinking!" : ratio > 0.85 ? "Low Buoyancy" : "Enough Buoyancy";
  const buoyColor = ratio > 1 ? "#ff7a6a" : ratio > 0.85 ? "#ffd36a" : "#f6e3b4";

  return (
    <div className="relative w-full h-full overflow-hidden" style={{ fontSize: 16 }}>
      <canvas ref={canvasRef} className="absolute inset-0" />

      {s && (
        <div className="absolute inset-0 pointer-events-none">
          {/* ---------------- top-left time panel ---------------- */}
          <div className="absolute left-2 top-2 flex gap-2 pointer-events-auto">
            <div className="wood p-2 w-[150px]">
              <div className="relative h-[26px] rounded bg-[#4a3220] border-2 border-[#2b1a10] overflow-hidden">
                <div
                  className="absolute inset-0"
                  style={{
                    background: "linear-gradient(90deg,#f6b44a,#ffe9a0 30%,#6ab4ff 50%,#1c2a60 75%,#f6b44a)",
                    opacity: 0.55,
                  }}
                />
                <div
                  className="absolute top-0 text-xl leading-[22px]"
                  style={{ left: `calc(${s.tod * 100}% - 10px)` }}
                >
                  {s.tod > 0.5 && s.tod < 0.9 ? "🌙" : "☀️"}
                </div>
              </div>
              <div className="text-center text-2xl my-1 bg-[#5d4128] rounded py-0.5 text-[#e9d3a2]">{s.day}Day</div>
              <div className="flex gap-1 justify-between">
                {[
                  { l: "⏸", v: 0 },
                  { l: "▶", v: 1 },
                  { l: "⏩", v: 2 },
                  { l: "⏭", v: 4 },
                ].map((b) => (
                  <button
                    key={b.v}
                    onClick={() => game?.setSpeed(b.v)}
                    className={`wood-btn flex-1 h-7 text-sm ${s.speed === b.v ? "active" : ""}`}
                  >
                    {b.l}
                  </button>
                ))}
              </div>
            </div>

            <div className="wood p-2 w-[176px]">
              <div className="flex gap-1">
                <div className="flex-1">
                  <div className="flex flex-col items-center">
                    <button className="wood-btn w-12 h-6 text-xs" onClick={() => say("Upper decks need the Scaffolding tech.")}>
                      ▲
                    </button>
                    <div className="text-xl text-[#fff0c8] leading-6">Floor 0</div>
                    <button className="wood-btn w-12 h-6 text-xs" onClick={() => say("The sea floor is not buildable.")}>
                      ▼
                    </button>
                  </div>
                </div>
                <div className="flex flex-col gap-1">
                  <button className="wood-btn w-8 h-8" title="Center on raft" onClick={() => game?.focusRaft()}>
                    ⌖
                  </button>
                  <button className="wood-btn w-8 h-8" title="Rotate view (Q/E)" onClick={() => game?.rotate(1)}>
                    ⟳
                  </button>
                </div>
              </div>
              <div className="text-center text-sm mt-1 rounded bg-[#5d4128] py-0.5 leading-4" style={{ color: buoyColor }}>
                {buoyLabel}
                <div className="text-xs opacity-80">
                  {s.load.toFixed(1)} / {s.buoy}
                </div>
              </div>
            </div>
          </div>

          {/* ---------------- toolbar ---------------- */}
          <div className="absolute left-[345px] top-2 flex gap-1 pointer-events-auto">
            {TABS.map((t) => (
              <button
                key={t.id}
                onClick={() => setTab(tab === t.id ? null : t.id)}
                className={`wood-btn w-[48px] h-[56px] flex flex-col items-center justify-center ${tab === t.id ? "active" : ""}`}
              >
                <span className="text-xl leading-6">{t.icon}</span>
                <span className="text-[9px] leading-3 text-[#cbb27c]">{t.label}</span>
              </button>
            ))}
          </div>

          {/* ---------------- resources ---------------- */}
          <div className="absolute left-4 top-[170px] w-[150px] flex flex-col gap-[2px] pointer-events-auto">
            {RES_KEYS.map((k) => (
              <div key={k} className="blue-strip flex items-center gap-2 pr-2 h-[30px]" title={`${RES_INFO[k].name} (limit ${s.cap})`}>
                <div className="w-[30px] h-[30px] bg-[#6a4c30] border border-[#3a2515] flex items-center justify-center text-lg">
                  {RES_INFO[k].icon}
                </div>
                <div className="text-2xl leading-6 tracking-wide">{s.res[k]}</div>
                <div className="ml-auto text-xs opacity-60">/{s.cap}</div>
              </div>
            ))}
          </div>

          {/* ---------------- help ---------------- */}
          {hint && (
            <div className="absolute right-[470px] top-0 w-[300px] text-[15px] leading-[19px] pointer-events-none">
              {[
                "WASD  Pan camera",
                "Q / E / Right-drag: Rotate camera",
                "Mouse wheel: Zoom",
                "Click flotage to mark it for salvage",
                "Click a colonist / object to inspect",
                "Hammer: build · RMB or Esc: cancel",
                "Space: pause · 1 2 3: speed",
              ].map((l) => (
                <div key={l} className="blue-strip px-1 border-b border-[#4a8cbb]">
                  {l}
                </div>
              ))}
              <div className="blue-strip px-1 pointer-events-auto cursor-pointer" onClick={() => setHint(false)}>
                (click to hide these key guides)
              </div>
            </div>
          )}

          {/* ---------------- toasts ---------------- */}
          <div className="absolute left-1/2 -translate-x-1/2 top-[84px] flex flex-col items-center gap-1">
            {note && <div className="toast wood px-3 py-1 text-lg">{note}</div>}
            {s.toasts.map((t) => (
              <div key={t.id} className="toast wood px-3 py-1 text-lg" style={t.bad ? { color: "#ffb0a0" } : undefined}>
                {t.text}
              </div>
            ))}
          </div>

          {/* ---------------- flotage tag ---------------- */}
          <button
            onClick={() => game?.focusFlotage()}
            className="absolute right-0 top-[560px] pointer-events-auto px-3 py-0.5 text-lg"
            style={{ background: "rgba(36,100,160,0.9)", color: "#e8f4ff", borderLeft: "3px solid #9fd2ff" }}
          >
            Flotage {s.flotageCount > 0 ? `(${s.flotageCount})` : ""}
          </button>

          {/* ---------------- selection panel ---------------- */}
          {s.selection && (
            <div className="absolute left-4 bottom-10 wood p-3 w-[270px] pointer-events-auto">
              <div className="text-2xl text-[#fff0c8]">{s.selection.title}</div>
              <div className="text-base mt-1 leading-5">
                {s.selection.lines.map((l, i) => (
                  <div key={i}>{l}</div>
                ))}
              </div>
              <div className="flex gap-2 mt-2">
                {s.selection.canMark && (
                  <button className="wood-btn px-3 py-1" onClick={() => game?.toggleMark()}>
                    {s.selection.marked ? "Cancel salvage" : "Salvage"}
                  </button>
                )}
                {s.selection.canDemolish && (
                  <button className="wood-btn px-3 py-1" onClick={() => game?.demolishSelected()}>
                    Demolish
                  </button>
                )}
                <button className="wood-btn px-3 py-1" onClick={() => game?.clearSelection()}>
                  Close
                </button>
              </div>
            </div>
          )}

          {/* ---------------- build menu ---------------- */}
          <div className="absolute left-1/2 -translate-x-1/2 bottom-2 flex flex-col items-center gap-2 pointer-events-auto">
            {s.tool && (
              <div className="wood px-3 py-1 text-lg">
                {s.tool === "demolish" ? "Demolishing" : `Placing ${BUILDINGS[s.tool as BuildKind].name}`} – LMB place (drag to paint) · RMB / Esc cancel
              </div>
            )}
            {menu && (
              <div className="wood p-2 flex gap-2">
                {(Object.keys(BUILDINGS) as BuildKind[]).map((k) => {
                  const b = BUILDINGS[k];
                  const can = (Object.keys(b.cost) as (keyof typeof b.cost)[]).every((r) => s.res[r!] >= (b.cost[r] ?? 0));
                  return (
                    <button
                      key={k}
                      onClick={() => pickTool(k)}
                      title={b.desc}
                      className={`wood-btn w-[104px] p-1 flex flex-col items-center ${s.tool === k ? "active" : ""}`}
                      style={can ? undefined : { opacity: 0.6 }}
                    >
                      <span className="text-3xl leading-9">{b.icon}</span>
                      <span className="text-sm leading-4">{b.name}</span>
                      <span className="text-xs" style={{ color: can ? "#d9f0a8" : "#ff9a8a" }}>
                        {costText(b.cost)}
                      </span>
                    </button>
                  );
                })}
                <button onClick={() => pickTool("demolish")} className={`wood-btn w-[104px] p-1 flex flex-col items-center ${s.tool === "demolish" ? "active" : ""}`}>
                  <span className="text-3xl leading-9">🧨</span>
                  <span className="text-sm leading-4">Demolish</span>
                  <span className="text-xs text-[#d9f0a8]">50% refund</span>
                </button>
              </div>
            )}
            <button
              onClick={() => setMenu(!menu)}
              className={`wood-btn w-[90px] h-[84px] text-5xl flex items-center justify-center ${menu || s.tool ? "active" : ""}`}
              style={{ borderWidth: 4 }}
              title="Build"
            >
              ⚒
            </button>
          </div>

          {/* ---------------- colonists ---------------- */}
          <div className="absolute right-2 bottom-1 flex gap-1 items-end pointer-events-auto">
            {s.colonists.map((c) => (
              <button
                key={c.id}
                onClick={() => game?.selectColonist(c.id)}
                className="text-left"
                title={`Hunger ${Math.round(c.hunger)} · Energy ${Math.round(c.energy)} · Health ${Math.round(c.health)}`}
              >
                <div className="bg-[#2b1a10] border-2 border-[#4a2f1a] rounded px-1 text-center text-xs text-[#f6e3b4] w-[112px] ml-auto">
                  {c.status}
                </div>
                <div className="wood flex items-center gap-1 p-1 w-[128px]">
                  <div className="w-9 h-9 rounded-sm relative border-2 border-[#3a2515]" style={{ background: c.shirt }}>
                    <div className="absolute left-0 right-0 top-0 h-3" style={{ background: c.hair }} />
                    <div className="absolute left-1 right-1 top-3 h-2 bg-[#f0c8b0]" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="text-[13px] leading-4 truncate">{c.name}</div>
                    <Bar v={c.hunger} color="#e8a03a" />
                    <Bar v={c.energy} color="#5aa8e8" />
                  </div>
                </div>
              </button>
            ))}
          </div>

          <div className="absolute left-3 bottom-1 text-white text-sm opacity-80">
            1.0.0 web edition · {s.floors} floors · {s.colonists.length} colonists
          </div>

          {/* ---------------- tab modal ---------------- */}
          {tab && (
            <div className="absolute left-1/2 -translate-x-1/2 top-[130px] wood p-4 w-[460px] pointer-events-auto max-h-[60vh] overflow-auto">
              <div className="flex justify-between items-center mb-2">
                <div className="text-2xl text-[#fff0c8]">{TABS.find((t) => t.id === tab)!.label}</div>
                <button className="wood-btn px-2" onClick={() => setTab(null)}>
                  ✕
                </button>
              </div>
              <div className="text-base leading-5">
                {tab === "priority" && (
                  <ol className="list-decimal pl-5">
                    <li>Eat when hungry (needs lemons or fish)</li>
                    <li>Sleep when exhausted or at night (beds are faster)</li>
                    <li>Salvage flotage you marked</li>
                    <li>Construct blueprints</li>
                    <li>Craft planks at a workbench</li>
                    <li>Harvest lemons</li>
                    <li>Fish from a fishing rod</li>
                  </ol>
                )}
                {tab === "tech" && (
                  <div>
                    <p>Researching is not available yet. Planned techs:</p>
                    <ul className="list-disc pl-5 opacity-80">
                      <li>Scaffolding – build upper floors 🔒</li>
                      <li>Cloth – sails and clothing 🔒</li>
                      <li>Stoves – cooked meals 🔒</li>
                    </ul>
                  </div>
                )}
                {tab === "map" && (
                  <div>
                    <p>Open ocean as far as the eye can see. The current carries flotage past your raft.</p>
                    <p className="mt-1">Flotage in sight: {s.flotageCount}</p>
                    <p>Day {s.day}</p>
                  </div>
                )}
                {tab === "faction" && (
                  <div className="flex flex-col gap-2">
                    {s.colonists.map((c) => (
                      <div key={c.id}>
                        <div>
                          {c.name} – {c.status}
                        </div>
                        <Bar v={c.hunger} color="#e8a03a" />
                        <Bar v={c.energy} color="#5aa8e8" />
                        <Bar v={c.health} color="#7be05a" />
                      </div>
                    ))}
                    <div className="opacity-70 text-sm">Bars: hunger · energy · health</div>
                  </div>
                )}
                {tab === "buildings" && (
                  <div>
                    <div className="mb-2">
                      Built: {s.floors} floors{s.structs.map((x) => `, ${x.count}× ${x.name}`).join("")}
                    </div>
                    {(Object.keys(BUILDINGS) as BuildKind[]).map((k) => (
                      <div key={k} className="mb-1">
                        {BUILDINGS[k].icon} <b>{BUILDINGS[k].name}</b> – {costText(BUILDINGS[k].cost)} · weight {BUILDINGS[k].weight}
                        <div className="opacity-75 text-sm">{BUILDINGS[k].desc}</div>
                      </div>
                    ))}
                  </div>
                )}
                {tab === "rooms" && <p>No enclosed rooms yet. Walls are not available in this version.</p>}
                {tab === "pet" && <p>No pets aboard. Maybe a cat will drift by one day…</p>}
                {tab === "sail" && <p>You have no sail. Without one, the raft goes wherever the current takes it.</p>}
                {tab === "system" && (
                  <div className="flex flex-col gap-2 items-start">
                    <button className="wood-btn px-3 py-1" onClick={() => setHint(!hint)}>
                      {hint ? "Hide" : "Show"} key guide
                    </button>
                    <button
                      className="wood-btn px-3 py-1"
                      onClick={() => {
                        setTab(null);
                        setRun((r) => r + 1);
                      }}
                    >
                      Restart game
                    </button>
                  </div>
                )}
              </div>
            </div>
          )}

          {s.over && (
            <div className="absolute inset-0 bg-black/60 flex items-center justify-center pointer-events-auto">
              <div className="wood p-6 text-center">
                <div className="text-4xl text-[#fff0c8]">The raft is empty…</div>
                <div className="text-xl my-2">Everyone is gone after {s.day} days at sea.</div>
                <button className="wood-btn px-4 py-2 text-xl" onClick={() => setRun((r) => r + 1)}>
                  Try again
                </button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
