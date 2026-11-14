// Visual identity of each case tier: physical materials for the 3D model, interface accent
// and copy. Kept apart from cases.ts so game data and presentation can change independently.

export type Finish = 'plain' | 'brushed' | 'textured'

export interface MaterialSpec {
  color: string
  metalness: number
  roughness: number
  clearcoat?: number
  clearcoatRoughness?: number
  iridescence?: number
  sheen?: number
  finish?: Finish
}

export interface TierVisual {
  id: string
  number: string
  name: string
  tagline: string
  description: string
  /** Interface accent for this tier (dots, glow behind the stage) */
  ui: string
  /** Shell, armour (corners, clasp plates), hardware (levers, screws, hinges), trim (ribs, inlays) */
  body: MaterialSpec
  armor: MaterialSpec
  hardware: MaterialSpec
  trim: MaterialSpec
  label: { plate: string; ink: string }
  /** Light integrated into the hardware, or null for unlit tiers */
  glow: string | null
  gems: boolean
  keyLight: string
  rimLight: string
  /** Length of the opening sequence; higher tiers take a little longer */
  openMs: number
}

export const TIERS: Record<string, TierVisual> = {
  bronze: {
    id: 'bronze',
    number: '01',
    name: 'Bronze',
    tagline: 'Field-grade utility',
    description: 'Oxidized bronze armor over a textured polymer shell. Built to be dropped, stacked and opened again.',
    ui: '#c08a5b',
    body: { color: '#2b2620', metalness: 0.05, roughness: 0.82, finish: 'textured' },
    armor: { color: '#80522f', metalness: 1, roughness: 0.46, finish: 'brushed' },
    hardware: { color: '#55575a', metalness: 1, roughness: 0.5 },
    trim: { color: '#1d1a16', metalness: 0.1, roughness: 0.9, finish: 'textured' },
    label: { plate: '#3a2a1c', ink: '#dcae80' },
    glow: null,
    gems: false,
    keyLight: '#fff0de',
    rimLight: '#ffb27a',
    openMs: 1700,
  },
  silver: {
    id: 'silver',
    number: '02',
    name: 'Silver',
    tagline: 'Precision engineered',
    description: 'Satin aluminum shell with brushed titanium hardware, machined to tight tolerances and laser-etched.',
    ui: '#c7ccd3',
    body: { color: '#8f949a', metalness: 1, roughness: 0.34, finish: 'brushed' },
    armor: { color: '#3a3d42', metalness: 0.7, roughness: 0.48 },
    hardware: { color: '#dadde1', metalness: 1, roughness: 0.2, finish: 'brushed' },
    trim: { color: '#2a2c30', metalness: 0.5, roughness: 0.55 },
    label: { plate: '#1d1f22', ink: '#e3e7ec' },
    glow: null,
    gems: false,
    keyLight: '#ffffff',
    rimLight: '#cfe2ff',
    openMs: 1850,
  },
  gold: {
    id: 'gold',
    number: '03',
    name: 'Gold',
    tagline: 'Prestige series',
    description: 'Graphite body with champagne-gold clasps, hinges and an engraved nameplate. Heavier than it looks.',
    ui: '#d9b77e',
    body: { color: '#1d1e21', metalness: 0.55, roughness: 0.42, clearcoat: 0.5, clearcoatRoughness: 0.3 },
    armor: { color: '#c9a46a', metalness: 1, roughness: 0.24, finish: 'brushed' },
    hardware: { color: '#e6c991', metalness: 1, roughness: 0.13 },
    trim: { color: '#141518', metalness: 0.5, roughness: 0.5 },
    label: { plate: '#2a2316', ink: '#f2d6a0' },
    glow: null,
    gems: false,
    keyLight: '#fff4e2',
    rimLight: '#ffd598',
    openMs: 2000,
  },
  platinum: {
    id: 'platinum',
    number: '04',
    name: 'Platinum',
    tagline: 'Experimental hardware',
    description: 'Pearl ceramic over a gunmetal frame, with light channels machined into the hardware.',
    ui: '#d6e3f3',
    body: { color: '#e4e2dd', metalness: 0, roughness: 0.3, clearcoat: 1, clearcoatRoughness: 0.08, sheen: 0.3 },
    armor: { color: '#4b4e54', metalness: 1, roughness: 0.3, finish: 'brushed' },
    hardware: { color: '#e8e7e4', metalness: 1, roughness: 0.12 },
    trim: { color: '#cfcdc8', metalness: 0, roughness: 0.5 },
    label: { plate: '#ebe9e4', ink: '#3b3f46' },
    glow: '#9fd0ff',
    gems: false,
    keyLight: '#f4f8ff',
    rimLight: '#bfe0ff',
    openMs: 2150,
  },
  diamond: {
    id: 'diamond',
    number: '05',
    name: 'Diamond',
    tagline: 'One of one',
    description: 'Obsidian shell with iridescent armor and lab-grown crystal inlays, lit from within.',
    ui: '#a99bff',
    body: { color: '#0a0a0e', metalness: 0.4, roughness: 0.14, clearcoat: 1, clearcoatRoughness: 0.04 },
    armor: { color: '#262842', metalness: 1, roughness: 0.22, iridescence: 1 },
    hardware: { color: '#40435d', metalness: 1, roughness: 0.18, iridescence: 0.6 },
    trim: { color: '#121219', metalness: 0.5, roughness: 0.3 },
    label: { plate: '#0e0e14', ink: '#cdc4ff' },
    glow: '#7d6bff',
    gems: true,
    keyLight: '#eef0ff',
    rimLight: '#8f7dff',
    openMs: 2350,
  },
}

export const tierOf = (caseId: string) => TIERS[caseId] ?? TIERS.bronze

/** Drop rarity colors: desaturated so they read as labels, not as casino lights. */
export const RARITY_COLOR: Record<string, string> = {
  Common: '#8e8e93',
  Uncommon: '#8fd3a8',
  Rare: '#7fb0ff',
  Epic: '#b49bff',
  Legendary: '#f2c879',
}
