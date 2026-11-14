// Visual identity of each case tier: Fujitora (One Piece Marine Admiral Issho) × NEAR Web3 Hackathon.
// Combines gravitational physics, celestial meteorites, Marine justice (正義), and NEAR Protocol brand aesthetics.

export type Finish = "plain" | "brushed" | "textured";

export interface MaterialSpec {
  color: string;
  metalness: number;
  roughness: number;
  clearcoat?: number;
  clearcoatRoughness?: number;
  iridescence?: number;
  sheen?: number;
  finish?: Finish;
}

export interface TierVisual {
  id: string;
  number: string;
  name: string;
  tagline: string;
  description: string;
  kanji: string;
  /** Interface accent for this tier (dots, glow behind the stage) */
  ui: string;
  /** Shell, armour (corners, clasp plates), hardware (levers, screws, hinges), trim (ribs, inlays) */
  body: MaterialSpec;
  armor: MaterialSpec;
  hardware: MaterialSpec;
  trim: MaterialSpec;
  label: { plate: string; ink: string };
  /** Light integrated into the hardware, or null for unlit tiers */
  glow: string | null;
  gems: boolean;
  keyLight: string;
  rimLight: string;
  /** Length of the opening sequence; higher tiers take a little longer */
  openMs: number;
}

export const TIERS: Record<string, TierVisual> = {
  bronze: {
    id: "bronze",
    number: "01",
    name: "Gravity Blade",
    tagline: "Shikomizue · Kinetic Pulse",
    description:
      "Forged with the resonant frequency of Fujitora's cane-sword. Dark wisteria titanium housing foundational gravitational energy on NEAR Testnet.",
    kanji: "重力", // Gravity
    ui: "#9d4edd",
    body: {
      color: "#16132b",
      metalness: 0.15,
      roughness: 0.78,
      finish: "textured",
    },
    armor: {
      color: "#5b3794",
      metalness: 0.85,
      roughness: 0.38,
      finish: "brushed",
    },
    hardware: { color: "#6d5996", metalness: 0.9, roughness: 0.4 },
    trim: {
      color: "#0f0c20",
      metalness: 0.2,
      roughness: 0.85,
      finish: "textured",
    },
    label: { plate: "#181230", ink: "#c4b5fd" },
    glow: "#9d4edd",
    gems: false,
    keyLight: "#f3e8ff",
    rimLight: "#a855f7",
    openMs: 1700,
  },
  silver: {
    id: "silver",
    number: "02",
    name: "Meteor Strike",
    tagline: "Orbital Re-entry · NEAR Mint",
    description:
      "A dense atmospheric re-entry crate infused with NEAR Protocol mint emerald alloy. Captures meteoric debris pulled from high orbit.",
    kanji: "隕石", // Meteor
    ui: "#00EC97",
    body: {
      color: "#12202b",
      metalness: 0.85,
      roughness: 0.32,
      finish: "brushed",
    },
    armor: { color: "#1c3d3a", metalness: 0.8, roughness: 0.35 },
    hardware: {
      color: "#00EC97",
      metalness: 0.95,
      roughness: 0.18,
      finish: "brushed",
    },
    trim: { color: "#0a1816", metalness: 0.5, roughness: 0.5 },
    label: { plate: "#081f1b", ink: "#00EC97" },
    glow: "#00EC97",
    gems: false,
    keyLight: "#d1fae5",
    rimLight: "#00EC97",
    openMs: 1850,
  },
  gold: {
    id: "gold",
    number: "03",
    name: "Blind Justice",
    tagline: "Admiral's Moral Code",
    description:
      "Adorned in the royal purple and gold insignia of Admiral Issho. Encrypted with decentralized smart contracts that see past worldly deceit.",
    kanji: "正義", // Justice
    ui: "#f59e0b",
    body: {
      color: "#18122c",
      metalness: 0.6,
      roughness: 0.38,
      clearcoat: 0.6,
      clearcoatRoughness: 0.25,
    },
    armor: {
      color: "#d97706",
      metalness: 1,
      roughness: 0.22,
      finish: "brushed",
    },
    hardware: { color: "#fbbf24", metalness: 1, roughness: 0.12 },
    trim: { color: "#100b20", metalness: 0.5, roughness: 0.4 },
    label: { plate: "#281b04", ink: "#fef08a" },
    glow: "#f59e0b",
    gems: false,
    keyLight: "#fef3c7",
    rimLight: "#f59e0b",
    openMs: 2000,
  },
  platinum: {
    id: "platinum",
    number: "04",
    name: "Singularity Well",
    tagline: "Zushi Zushi · Event Horizon",
    description:
      "Pearl-violet ceramic suspension shell holding an artificial micro-singularity. Heavy gravitational curvature warps NEAR testnet transaction blocks.",
    kanji: "引力", // Attraction / Gravitation
    ui: "#c084fc",
    body: {
      color: "#e2daf5",
      metalness: 0.05,
      roughness: 0.28,
      clearcoat: 1,
      clearcoatRoughness: 0.06,
      sheen: 0.4,
    },
    armor: {
      color: "#4c2882",
      metalness: 1,
      roughness: 0.25,
      finish: "brushed",
    },
    hardware: { color: "#00EC97", metalness: 0.95, roughness: 0.12 },
    trim: { color: "#c4b5fd", metalness: 0.1, roughness: 0.4 },
    label: { plate: "#1f153a", ink: "#e9d5ff" },
    glow: "#a855f7",
    gems: false,
    keyLight: "#faf5ff",
    rimLight: "#9333ea",
    openMs: 2150,
  },
  diamond: {
    id: "diamond",
    number: "05",
    name: "Celestial Desolation",
    tagline: "Heaven's Descent · Omega Vault",
    description:
      "The pinnacle of Fujitora's gravity artifice. Pure obsidian void-matter embedded with lab-crystallized gravity gems and synchronized to the NEAR validator consensus.",
    kanji: "天降", // Heavenly Descent
    ui: "#00EC97",
    body: {
      color: "#060512",
      metalness: 0.5,
      roughness: 0.1,
      clearcoat: 1,
      clearcoatRoughness: 0.03,
    },
    armor: { color: "#251848", metalness: 1, roughness: 0.2, iridescence: 1 },
    hardware: {
      color: "#1a3a34",
      metalness: 1,
      roughness: 0.15,
      iridescence: 0.8,
    },
    trim: { color: "#0c081e", metalness: 0.6, roughness: 0.25 },
    label: { plate: "#080614", ink: "#00EC97" },
    glow: "#00EC97",
    gems: true,
    keyLight: "#f0fdf4",
    rimLight: "#00EC97",
    openMs: 2350,
  },
};

const CASE_VISUALS: Record<string, string> = {
  "bamboo-mist": "bronze",
  "dragon-tea": "silver",
  "moon-spirit": "gold",
  "phoenix-flame": "platinum",
  "uncles-secret-reserve": "diamond",
};

export const tierOf = (caseId: string): TierVisual =>
  TIERS[CASE_VISUALS[caseId] ?? caseId] ?? TIERS.bronze;

/** Drop rarity colors: Web3 Hackathon + Fujitora palette */
export const RARITY_COLOR: Record<string, string> = {
  Common: "#94a3b8",      // Meteoric Slate
  Uncommon: "#00EC97",    // NEAR Mint Green
  Rare: "#60a5fa",        // Atmospheric Plasma Blue
  Epic: "#c084fc",        // Fujitora Gravity Violet
  Legendary: "#f59e0b",   // Admiral Gold / Supernova
};
