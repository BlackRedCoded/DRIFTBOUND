export type ResKey = "wood" | "plank" | "rope" | "lemon" | "fish";
export const RES_KEYS: ResKey[] = ["wood", "plank", "rope", "lemon", "fish"];
export const RES_INFO: Record<ResKey, { name: string; icon: string }> = {
  wood: { name: "Wood", icon: "🪵" },
  plank: { name: "Planks", icon: "🟫" },
  rope: { name: "Rope", icon: "🪢" },
  lemon: { name: "Lemons", icon: "🍋" },
  fish: { name: "Fish", icon: "🐟" },
};

export type BuildKind = "floor" | "crate" | "bed" | "bench" | "rod";
export type ToolKind = BuildKind | "demolish";

export interface BuildingDef {
  name: string;
  icon: string;
  desc: string;
  cost: Partial<Record<ResKey, number>>;
  time: number;
  weight: number;
}

export const BUILDINGS: Record<BuildKind, BuildingDef> = {
  floor: {
    name: "Raft Floor",
    icon: "🛶",
    desc: "Extends the raft. +6 buoyancy. Must touch an existing floor.",
    cost: { plank: 2 },
    time: 2,
    weight: 0,
  },
  crate: {
    name: "Storage Crate",
    icon: "📦",
    desc: "Raises the storage limit of every resource by 60.",
    cost: { plank: 4 },
    time: 3,
    weight: 3,
  },
  bed: {
    name: "Bed",
    icon: "🛏️",
    desc: "A colonist ordered to rest here sleeps 2.5x faster.",
    cost: { plank: 5, rope: 2 },
    time: 4,
    weight: 2,
  },
  bench: {
    name: "Workbench",
    icon: "🔨",
    desc: "Assign a colonist here to saw 2 wood into 3 planks.",
    cost: { plank: 6, rope: 1 },
    time: 5,
    weight: 3,
  },
  rod: {
    name: "Fishing Rod",
    icon: "🎣",
    desc: "Place on the raft edge. Assign a colonist to catch fish (and rope).",
    cost: { plank: 3, rope: 3 },
    time: 3,
    weight: 1,
  },
};

export const STRUCT_NAMES: Record<string, string> = {
  tree: "Lemon Tree",
  crate: "Storage Crate",
  bed: "Bed",
  bench: "Workbench",
  rod: "Fishing Rod",
};

export const DAY_LENGTH = 240; // seconds per day at 1x

export interface ColonistSnap {
  id: number;
  name: string;
  status: string;
  hunger: number;
  energy: number;
  health: number;
  shirt: string;
  hair: string;
  swimming?: boolean;
  commanded?: boolean;
}

export interface SelectionSnap {
  kind: "colonist" | "struct" | "flotage" | "tile";
  id: number;
  title: string;
  lines: string[];
  canDemolish?: boolean;
  canMark?: boolean;
  marked?: boolean;
  canStop?: boolean;
  canAssign?: boolean;
  /** label for the assignment button, e.g. "Send Niall" */
  assignLabel?: string;
  hint?: string;
}

export interface Toast {
  id: number;
  text: string;
  at: number;
  bad?: boolean;
}

export interface Snapshot {
  res: Record<ResKey, number>;
  cap: number;
  day: number;
  tod: number;
  speed: number;
  buoy: number;
  load: number;
  colonists: ColonistSnap[];
  selection: SelectionSnap | null;
  tool: ToolKind | null;
  toasts: Toast[];
  flotageCount: number;
  over: boolean;
  floors: number;
  structs: { name: string; count: number }[];
  /** name of the colonist currently receiving orders */
  commanded: string | null;
}

export const HINTS = [
  "WASD · pan the camera",
  "Q / E / right-drag · rotate",
  "Wheel · zoom",
  "Click a colonist to take command",
  "Click a marked flotage to swim out",
  "Click a blueprint / tree / bench / rod",
  "Click a raft tile to walk there",
  "Salvage: select flotage, press Salvage",
  "Space · pause  ·  1 2 3 · speed",
  "RMB / Esc · cancel",
];
