// High-detail procedural hard case, built from three.js geometry:
//  · beveled extruded shell halves with a tongue-and-groove parting flange and a gasket
//  · armored corner guards with inset plates and hex-socket bolts
//  · two draw latches (bracket, hinge barrel, ribbed lever, wire bail, lid keeper)
//  · pressure-purge valve with knurled cap and an LED status ring
//  · piano hinge with alternating knuckles, tube carry handle with ribbed grip, bail side handles
//  · pick-and-pluck foam in the base, convoluted foam in the lid, rubber feet, engraved nameplate
// Geometry is shared by every tier and built once; tiers differ in materials and inlays.

import { useLayoutEffect, useMemo, useRef, type RefObject } from 'react'
import * as THREE from 'three'
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js'
import { mergeGeometries, toCreasedNormals } from 'three/examples/jsm/utils/BufferGeometryUtils.js'
import type { MaterialSpec, TierVisual } from '@/lib/tiers'

export const DIM = { W: 2.6, D: 1.7, HB: 1.0, HL: 0.52, BOTTOM: -0.78, R: 0.2 }
export const SEAM = DIM.BOTTOM + DIM.HB
const { W, D, HB, HL, BOTTOM, R } = DIM
const ZF = D / 2
/** hinge axis sits just behind the back face; the lid group pivots here */
const HINGE_Z = -ZF - 0.06

// =====================================================================
// geometry helpers
// =====================================================================

function roundedRect(w: number, h: number, r: number, path: THREE.Path = new THREE.Shape()) {
  const x = w / 2
  const y = h / 2
  const rr = Math.min(r, x, y)
  path.moveTo(-x + rr, -y)
  path.lineTo(x - rr, -y)
  path.absarc(x - rr, -y + rr, rr, -Math.PI / 2, 0, false)
  path.lineTo(x, y - rr)
  path.absarc(x - rr, y - rr, rr, 0, Math.PI / 2, false)
  path.lineTo(-x + rr, y)
  path.absarc(-x + rr, y - rr, rr, Math.PI / 2, Math.PI, false)
  path.lineTo(-x, -y + rr)
  path.absarc(-x + rr, -y + rr, rr, Math.PI, Math.PI * 1.5, false)
  return path
}

interface Hole {
  w: number
  h: number
  r: number
}

function extrude(w: number, h: number, depth: number, r: number, bevel: number, hole?: Hole, segs = 4) {
  const b = Math.min(bevel, depth / 2 - 0.0005)
  const shape = roundedRect(w - 2 * b, h - 2 * b, Math.max(0.002, r - b)) as THREE.Shape
  if (hole) shape.holes.push(roundedRect(hole.w + 2 * b, hole.h + 2 * b, hole.r + b, new THREE.Path()))
  const g = new THREE.ExtrudeGeometry(shape, {
    depth: Math.max(0.0005, depth - 2 * b),
    bevelEnabled: b > 0,
    bevelThickness: b,
    bevelSize: b,
    // detail scales with size: tiny bevels and corners don't need many segments to read as round
    bevelSegments: b < 0.015 ? Math.min(segs, 2) : segs,
    curveSegments: Math.max(4, Math.min(16, Math.round(r * 70))),
  })
  g.translate(0, 0, b) // spans z 0..depth
  return toCreasedNormals(g, 0.7)
}

/** Plan-view slab: rounded rect in XZ, extruded upward from y=0 to y=height */
function slab(w: number, d: number, height: number, r: number, bevel: number, hole?: Hole, segs?: number) {
  const g = extrude(w, d, height, r, bevel, hole, segs)
  g.rotateX(-Math.PI / 2)
  return g
}

/** Face plate: rounded rect in XY, extruded toward +z from z=0 */
const plate = extrude

function lathe(points: [number, number][], segments: number) {
  return new THREE.LatheGeometry(
    points.map(([r, y]) => new THREE.Vector2(r, y)),
    segments,
  )
}

function tube(points: [number, number, number][], radius: number, tubular = 64) {
  const curve = new THREE.CatmullRomCurve3(points.map((p) => new THREE.Vector3(...p)))
  return new THREE.TubeGeometry(curve, tubular, radius, 10, false)
}

// =====================================================================
// shared geometry (built once)
// =====================================================================

let GEO: ReturnType<typeof buildGeometry> | null = null
const geometry = () => (GEO ??= buildGeometry())

function buildGeometry() {
  const flangeHole = { w: W - 0.18, h: D - 0.18, r: R - 0.09 }
  const knurl = new THREE.CylinderGeometry(0.084, 0.084, 0.026, 28)
  knurl.rotateX(Math.PI / 2)
  const valve = lathe(
    [
      [0, 0],
      [0.074, 0],
      [0.078, 0.008],
      [0.078, 0.03],
      [0.068, 0.046],
      [0.04, 0.058],
      [0, 0.061],
    ],
    40,
  )
  valve.rotateX(Math.PI / 2)
  const pin = (len: number, r: number) => {
    const g = new THREE.CylinderGeometry(r, r, len, 20)
    g.rotateZ(Math.PI / 2)
    return g
  }
  // ribbed rubber grip along x
  const gripPts: [number, number][] = []
  for (let i = 0; i <= 60; i++) {
    const y = -0.31 + (i / 60) * 0.62
    const edge = Math.min(1, (0.31 - Math.abs(y)) / 0.04)
    gripPts.push([0.036 + edge * (0.016 + 0.005 * Math.cos(i * Math.PI * 0.5)), y])
  }
  const grip = lathe([[0.034, -0.32], ...gripPts, [0.034, 0.32]], 28)
  grip.rotateZ(Math.PI / 2)
  const gem = lathe(
    [
      [0, -0.07],
      [0.078, -0.004],
      [0.082, 0.006],
      [0.052, 0.03],
      [0, 0.03],
    ],
    8,
  )
  const rivet = new THREE.SphereGeometry(0.02, 16, 8, 0, Math.PI * 2, 0, Math.PI / 2)

  // convoluted (egg-crate) lid foam, facing down
  const crate = new THREE.PlaneGeometry(W - 0.24, D - 0.24, 90, 60)
  const pos = crate.attributes.position
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i)
    const y = pos.getY(i)
    pos.setZ(i, 0.022 * (Math.sin(x * 26) * Math.sin(y * 26) + 1))
  }
  crate.computeVertexNormals()
  crate.rotateX(Math.PI / 2)

  return {
    baseShell: slab(W, D, HB - 0.06, R, 0.07, undefined, 6),
    lidShell: slab(W, D, HL - 0.07, R, 0.07, undefined, 6),
    flange: slab(W + 0.05, D + 0.05, 0.075, R + 0.025, 0.022, flangeHole),
    gasket: slab(W + 0.012, D + 0.012, 0.014, R + 0.006, 0.004, flangeHole, 2),
    panelFrame: plate(1.9, 0.44, 0.028, 0.07, 0.012, { w: 1.7, h: 0.27, r: 0.04 }),
    panelRib: plate(1.6, 0.036, 0.022, 0.018, 0.008),
    sideRib: plate(0.06, 0.52, 0.026, 0.028, 0.01),
    topFrame: slab(W - 0.32, D - 0.32, 0.03, R - 0.12, 0.01, { w: W - 0.46, h: D - 0.46, r: 0.06 }),
    topChannel: slab(W - 0.5, D - 0.5, 0.008, 0.07, 0.002, { w: W - 0.54, h: D - 0.54, r: 0.05 }, 1),
    guard: new RoundedBoxGeometry(0.42, 0.4, 0.42, 4, 0.1),
    guardPlate: plate(0.26, 0.24, 0.016, 0.05, 0.007),
    washer: (() => {
      const g = new THREE.CylinderGeometry(0.044, 0.046, 0.01, 18)
      g.translate(0, 0.005, 0)
      return g
    })(),
    hexHead: (() => {
      const g = new THREE.CylinderGeometry(0.03, 0.034, 0.022, 6)
      g.translate(0, 0.021, 0)
      return g
    })(),
    socket: (() => {
      const g = new THREE.CylinderGeometry(0.013, 0.013, 0.004, 6)
      g.translate(0, 0.0325, 0)
      return g
    })(),
    bracket: plate(0.38, 0.3, 0.045, 0.06, 0.014),
    barrel: pin(0.3, 0.03),
    lever: plate(0.29, 0.5, 0.036, 0.08, 0.014),
    leverRib: plate(0.2, 0.018, 0.012, 0.008, 0.004),
    leverPin: pin(0.24, 0.016),
    bail: tube(
      [
        [-0.1, 0.36, 0.02],
        [-0.1, 0.52, 0.0],
        [-0.09, 0.6, -0.04],
        [-0.04, 0.62, -0.06],
        [0.04, 0.62, -0.06],
        [0.09, 0.6, -0.04],
        [0.1, 0.52, 0.0],
        [0.1, 0.36, 0.02],
      ],
      0.011,
    ),
    keeper: plate(0.26, 0.08, 0.045, 0.025, 0.012),
    keeperLip: plate(0.22, 0.03, 0.03, 0.012, 0.008),
    valveBezel: plate(0.34, 0.32, 0.05, 0.08, 0.016),
    valve,
    knurl,
    ledRing: new THREE.TorusGeometry(0.104, 0.007, 12, 64),
    knuckle: pin(0.2, 0.046),
    hingePin: pin(2.16, 0.014),
    hingeLeaf: plate(0.2, 0.13, 0.016, 0.02, 0.005),
    handleMount: slab(0.2, 0.2, 0.07, 0.06, 0.02),
    handleBar: tube(
      [
        [-0.55, 0.04, 0],
        [-0.52, 0.15, 0],
        [-0.42, 0.21, 0],
        [-0.3, 0.22, 0],
        [0.3, 0.22, 0],
        [0.42, 0.21, 0],
        [0.52, 0.15, 0],
        [0.55, 0.04, 0],
      ],
      0.032,
      96,
    ),
    grip,
    sideBail: tube(
      [
        [0.04, 0, -0.34],
        [0.085, -0.05, -0.31],
        [0.105, -0.11, -0.22],
        [0.11, -0.125, 0],
        [0.105, -0.11, 0.22],
        [0.085, -0.05, 0.31],
        [0.04, 0, 0.34],
      ],
      0.024,
    ),
    sideMount: new RoundedBoxGeometry(0.09, 0.13, 0.11, 3, 0.03),
    foot: new THREE.CylinderGeometry(0.09, 0.1, 0.045, 32),
    nameplate: slab(1.12, 0.36, 0.026, 0.05, 0.009),
    label: new THREE.PlaneGeometry(1.0, 0.25),
    rivet,
    gem,
    gemBezel: new THREE.TorusGeometry(0.084, 0.012, 10, 40),
    // ~300 instances: keep each block light
    pluck: new RoundedBoxGeometry(0.093, 0.06, 0.093, 1, 0.012),
    crate,
    cavityFloor: new THREE.PlaneGeometry(0.86, 0.62),
  }
}

// =====================================================================
// procedural surface maps
// =====================================================================

const maps: Record<string, THREE.Texture> = {}

/** Converts a grayscale height canvas to a tangent-space normal map */
function normalFromHeight(src: HTMLCanvasElement, strength: number) {
  const size = src.width
  const h = src.getContext('2d')!.getImageData(0, 0, size, size).data
  const out = document.createElement('canvas')
  out.width = out.height = size
  const ctx = out.getContext('2d')!
  const img = ctx.createImageData(size, size)
  const at = (x: number, y: number) => h[(((y + size) % size) * size + ((x + size) % size)) * 4] / 255
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const dx = (at(x + 1, y) - at(x - 1, y)) * strength
      const dy = (at(x, y + 1) - at(x, y - 1)) * strength
      const len = Math.hypot(dx, dy, 1)
      const i = (y * size + x) * 4
      img.data[i] = ((-dx / len) * 0.5 + 0.5) * 255
      img.data[i + 1] = ((dy / len) * 0.5 + 0.5) * 255
      img.data[i + 2] = ((1 / len) * 0.5 + 0.5) * 255
      img.data[i + 3] = 255
    }
  }
  ctx.putImageData(img, 0, 0)
  return out
}

function texture(canvas: HTMLCanvasElement, repeat: number) {
  const t = new THREE.CanvasTexture(canvas)
  t.wrapS = t.wrapT = THREE.RepeatWrapping
  t.repeat.set(repeat, repeat)
  t.anisotropy = 8
  return t
}

function canvas(size: number, draw: (g: CanvasRenderingContext2D) => void) {
  const c = document.createElement('canvas')
  c.width = c.height = size
  draw(c.getContext('2d')!)
  return c
}

/** Molded polymer stipple */
function stippleNormal() {
  if (maps.stipple) return maps.stipple
  const height = canvas(256, (g) => {
    const noise = g.createImageData(256, 256)
    for (let i = 0; i < noise.data.length; i += 4) {
      const v = Math.random() * 255
      noise.data[i] = noise.data[i + 1] = noise.data[i + 2] = v
      noise.data[i + 3] = 255
    }
    g.putImageData(noise, 0, 0)
    g.filter = 'blur(1.2px)'
    g.drawImage(g.canvas, 0, 0)
  })
  return (maps.stipple = texture(normalFromHeight(height, 2.2), 3))
}

/** Brushed-metal streaks: shared height used for normal and roughness */
function brushedCanvas() {
  return canvas(512, (g) => {
    g.fillStyle = 'rgb(128,128,128)'
    g.fillRect(0, 0, 512, 512)
    for (let i = 0; i < 6000; i++) {
      const v = 90 + Math.random() * 80
      g.fillStyle = `rgba(${v},${v},${v},0.35)`
      g.fillRect(Math.random() * 612 - 100, Math.random() * 512, 40 + Math.random() * 360, 1)
    }
  })
}
function brushedMaps() {
  if (maps.brushedRough) return { rough: maps.brushedRough, normal: maps.brushedNormal }
  const c = brushedCanvas()
  maps.brushedRough = texture(c, 2)
  maps.brushedNormal = texture(normalFromHeight(c, 0.9), 2)
  return { rough: maps.brushedRough, normal: maps.brushedNormal }
}

function makeMaterial(s: MaterialSpec) {
  const m = new THREE.MeshPhysicalMaterial({
    color: s.color,
    metalness: s.metalness,
    roughness: s.roughness,
    clearcoat: s.clearcoat ?? 0,
    clearcoatRoughness: s.clearcoatRoughness ?? 0.2,
    iridescence: s.iridescence ?? 0,
    iridescenceIOR: 1.6,
    iridescenceThicknessRange: [180, 720],
    sheen: s.sheen ?? 0,
    sheenColor: new THREE.Color('#ffffff'),
    sheenRoughness: 0.5,
  })
  if (s.finish === 'brushed') {
    const b = brushedMaps()
    m.roughnessMap = b.rough
    m.roughness = Math.min(1, s.roughness * 1.9)
    m.normalMap = b.normal
    m.normalScale.set(0.25, 0.25)
  }
  if (s.finish === 'textured') {
    m.normalMap = stippleNormal()
    m.normalScale.set(0.55, 0.55)
  }
  return m
}

function labelTexture(t: TierVisual) {
  const c = document.createElement('canvas')
  c.width = 1024
  c.height = 256
  const g = c.getContext('2d') as CanvasRenderingContext2D & { letterSpacing?: string }
  
  // Base plate
  g.fillStyle = t.label.plate
  g.fillRect(0, 0, 1024, 256)
  
  // Outer cybernetic border
  g.strokeStyle = t.label.ink
  g.globalAlpha = 0.4
  g.lineWidth = 3
  g.strokeRect(16, 16, 992, 224)
  
  // Inner hairline with cut corners
  g.lineWidth = 1.5
  g.globalAlpha = 0.25
  g.strokeRect(26, 26, 972, 204)
  
  // Tech ticks on bottom edge
  g.fillStyle = t.label.ink
  g.globalAlpha = 0.5
  for (let i = 0; i <= 48; i++) {
    g.fillRect(52 + i * 19.2, 210, 2, i % 6 === 0 ? 16 : 8)
  }
  
  // Subtle Kanji watermark in the background (Justice, Gravity, etc.)
  if (t.kanji) {
    g.save()
    g.textAlign = 'right'
    g.textBaseline = 'middle'
    g.font = '900 130px "Cinzel", "Noto Serif JP", serif'
    g.fillStyle = t.label.ink
    g.globalAlpha = 0.12
    g.fillText(t.kanji, 930, 128)
    g.restore()
  }

  const engrave = (text: string, x: number, y: number, size: number, weight: number, alpha: number, fontFam = 'Orbitron, sans-serif') => {
    g.font = `${weight} ${size}px ${fontFam}`
    g.globalAlpha = 0.6
    g.fillStyle = '#000000'
    g.fillText(text, x + 2, y + 2)
    g.globalAlpha = alpha
    g.fillStyle = t.label.ink
    g.fillText(text, x, y)
  }

  g.textBaseline = 'middle'
  
  // Top header: Fujitora Case Shop
  g.textAlign = 'left'
  g.letterSpacing = '4px'
  engrave('FUJITORA CASE SHOP', 52, 54, 22, 700, 0.75)
  
  // Center: Case name
  g.letterSpacing = '10px'
  engrave(t.name.toUpperCase(), 50, 118, 68, 800, 1)
  
  // Subline: Protocol series & Case reference
  g.letterSpacing = '4px'
  engrave(`FUJITORA · SERIES NCS-0${t.number} · Ⓝ VERIFIED`, 52, 178, 22, 600, 0.7)
  
  // Right side: Tier number badge
  g.textAlign = 'right'
  g.letterSpacing = '2px'
  engrave(t.number, 970, 70, 72, 300, 0.65)

  const tex = new THREE.CanvasTexture(c)
  tex.colorSpace = THREE.SRGBColorSpace
  tex.anisotropy = 8
  return tex
}

function buildTierMaterials(t: TierVisual) {
  const label = labelTexture(t)
  return {
    body: makeMaterial(t.body),
    armor: makeMaterial(t.armor),
    hardware: makeMaterial(t.hardware),
    trim: makeMaterial(t.trim),
    rubber: new THREE.MeshPhysicalMaterial({ color: '#121214', roughness: 0.78, metalness: 0, normalMap: stippleNormal(), normalScale: new THREE.Vector2(0.3, 0.3) }),
    foam: new THREE.MeshStandardMaterial({ color: '#0d0d10', roughness: 1, normalMap: stippleNormal(), normalScale: new THREE.Vector2(1.2, 1.2) }),
    cavity: new THREE.MeshStandardMaterial({ color: '#050506', roughness: 1 }),
    socket: new THREE.MeshStandardMaterial({ color: '#0a0a0a', roughness: 0.6, metalness: 0.5 }),
    label: new THREE.MeshPhysicalMaterial({ map: label, metalness: 0.45, roughness: 0.36, clearcoat: 0.5, clearcoatRoughness: 0.2 }),
    // faceted, highly reflective crystal; no transmission, which would add a full extra render pass per frame
    gem: new THREE.MeshPhysicalMaterial({
      color: '#cfc8ff',
      metalness: 0.15,
      roughness: 0.02,
      ior: 2.42,
      specularIntensity: 1,
      iridescence: 1,
      iridescenceIOR: 1.8,
      envMapIntensity: 2.5,
      emissive: new THREE.Color(t.glow ?? '#000000'),
      emissiveIntensity: 0.35,
      flatShading: true,
    }),
  }
}

/**
 * Materials are cached per tier for the whole session (five small sets). Keeping them alive keeps
 * their compiled shader programs alive too, so switching back to a tier never recompiles.
 */
const MATERIAL_CACHE = new Map<string, ReturnType<typeof buildTierMaterials>>()
function tierMaterials(t: TierVisual) {
  let m = MATERIAL_CACHE.get(t.id)
  if (!m) {
    m = buildTierMaterials(t)
    MATERIAL_CACHE.set(t.id, m)
  }
  return m
}
const useTierMaterials = (t: TierVisual) => tierMaterials(t)

/**
 * Compiles every tier's shaders in the background (KHR_parallel_shader_compile where available),
 * so the first switch to a tier doesn't stall for a few hundred milliseconds.
 */
export async function precompileTiers(gl: THREE.WebGLRenderer, camera: THREE.Camera, scene: THREE.Scene, tiers: TierVisual[]) {
  const probe = new THREE.Scene()
  const box = new THREE.BoxGeometry(0.01, 0.01, 0.01)
  for (const t of tiers) {
    for (const mat of Object.values(tierMaterials(t))) {
      const mesh = new THREE.Mesh(box, mat)
      mesh.position.set(0, -100, 0)
      probe.add(mesh)
    }
  }
  try {
    await gl.compileAsync(probe, camera, scene)
  } finally {
    box.dispose()
  }
}

type Mats = ReturnType<typeof useTierMaterials>
type Geo = ReturnType<typeof buildGeometry>
type V3 = [number, number, number]

// =====================================================================
// parts
// =====================================================================

/** Hex-socket bolt with washer; local +y points out of the surface */
function Bolt({ position, rotation, g, m }: { position: V3; rotation?: V3; g: Geo; m: Mats }) {
  return (
    <group position={position} rotation={rotation}>
      <mesh geometry={g.washer} material={m.hardware} />
      <mesh geometry={g.hexHead} material={m.hardware} />
      <mesh geometry={g.socket} material={m.socket} />
    </group>
  )
}

/** Orientation that turns local +y into the given outward axis */
const facing = {
  px: [0, 0, -Math.PI / 2] as V3,
  nx: [0, 0, Math.PI / 2] as V3,
  pz: [Math.PI / 2, 0, 0] as V3,
  nz: [-Math.PI / 2, 0, 0] as V3,
  py: [0, 0, 0] as V3,
  ny: [Math.PI, 0, 0] as V3,
}

/** Corner guard: rounded block, inset plate and bolt on each exposed face */
function Guard({ position, sx, sy, sz, g, m }: { position: V3; sx: number; sy: number; sz: number; g: Geo; m: Mats }) {
  const hx = 0.21
  const hy = 0.2
  const hz = 0.21
  return (
    <group position={position}>
      <mesh geometry={g.guard} material={m.armor} />
      {/* x face */}
      <group position={[sx * hx, 0, 0]} rotation={[0, (sx * Math.PI) / 2, 0]}>
        <mesh geometry={g.guardPlate} material={m.armor} />
        <Bolt position={[0, 0, 0.014]} rotation={facing.pz} g={g} m={m} />
      </group>
      {/* z face */}
      <group position={[0, 0, sz * hz]} rotation={[0, sz > 0 ? 0 : Math.PI, 0]}>
        <mesh geometry={g.guardPlate} material={m.armor} />
        <Bolt position={[0, 0, 0.014]} rotation={facing.pz} g={g} m={m} />
      </group>
      {/* y face */}
      <Bolt position={[0, sy * hy, 0]} rotation={sy > 0 ? facing.py : facing.ny} g={g} m={m} />
    </group>
  )
}

/** Pick-and-pluck foam blocks filling the base, with a cavity cut where the reward sits */
function PluckFoam({ g, m }: { g: Geo; m: Mats }) {
  const mesh = useMemo(() => {
    const cell = 0.1
    const nx = Math.floor((W - 0.24) / cell)
    const nz = Math.floor((D - 0.24) / cell)
    const cells: V3[] = []
    for (let i = 0; i < nx; i++) {
      for (let k = 0; k < nz; k++) {
        const x = (i - (nx - 1) / 2) * cell
        const z = (k - (nz - 1) / 2) * cell
        if (Math.abs(x) < 0.42 && Math.abs(z) < 0.3) continue
        cells.push([x, z, Math.random()])
      }
    }
    const inst = new THREE.InstancedMesh(g.pluck, m.foam, cells.length)
    const mtx = new THREE.Matrix4()
    cells.forEach(([x, z, r], i) => {
      mtx.makeScale(1, 0.92 + r * 0.08, 1)
      mtx.setPosition(x, SEAM - 0.04 + r * 0.004, z)
      inst.setMatrixAt(i, mtx)
    })
    inst.instanceMatrix.needsUpdate = true
    inst.raycast = noRaycast
    return inst
  }, [g, m])
  return <primitive object={mesh} />
}

// =====================================================================
// draw-call batching
// =====================================================================

const noRaycast = () => {}
const KEEP = new Set(['position', 'normal', 'uv'])

/** Reverses triangle winding of a non-indexed geometry (needed after mirroring with a negative scale) */
function flipWinding(g: THREE.BufferGeometry) {
  for (const attr of Object.values(g.attributes) as THREE.BufferAttribute[]) {
    const a = attr.array
    const s = attr.itemSize
    for (let tri = 0; tri < attr.count; tri += 3) {
      for (let k = 0; k < s; k++) {
        const i1 = (tri + 1) * s + k
        const i2 = (tri + 2) * s + k
        const t = a[i1]
        a[i1] = a[i2]
        a[i2] = t
      }
    }
  }
}

/**
 * The case is authored as ~300 small meshes for readability. At runtime every static mesh under
 * `root` is baked into one mesh per material (≈10 draw calls), skipping subtrees marked
 * `userData.dynamic` (lid, levers) and instanced foam. Returns an undo function.
 */
function mergeStatic(root: THREE.Object3D) {
  root.updateWorldMatrix(true, true)
  const toLocal = root.matrixWorld.clone().invert()
  const buckets = new Map<THREE.Material, THREE.BufferGeometry[]>()
  const hidden: THREE.Mesh[] = []
  const mtx = new THREE.Matrix4()

  const walk = (o: THREE.Object3D) => {
    if (o !== root && o.userData.dynamic) return
    const mesh = o as THREE.Mesh
    if (mesh.isMesh && !(o as THREE.InstancedMesh).isInstancedMesh && !Array.isArray(mesh.material) && mesh.visible) {
      const g = mesh.geometry.index ? mesh.geometry.toNonIndexed() : mesh.geometry.clone()
      for (const name of Object.keys(g.attributes)) if (!KEEP.has(name)) g.deleteAttribute(name)
      if (!g.attributes.uv) g.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array(g.attributes.position.count * 2), 2))
      mtx.multiplyMatrices(toLocal, mesh.matrixWorld)
      g.applyMatrix4(mtx)
      if (mtx.determinant() < 0) flipWinding(g)
      const list = buckets.get(mesh.material as THREE.Material) ?? []
      list.push(g)
      buckets.set(mesh.material as THREE.Material, list)
      mesh.visible = false
      mesh.raycast = noRaycast
      hidden.push(mesh)
    }
    o.children.forEach(walk)
  }
  walk(root)

  const merged: THREE.Mesh[] = []
  for (const [material, list] of buckets) {
    const geo = mergeGeometries(list, false)
    list.forEach((g) => g.dispose())
    if (!geo) continue
    const mesh = new THREE.Mesh(geo, material)
    mesh.raycast = noRaycast
    root.add(mesh)
    merged.push(mesh)
  }
  return () => {
    merged.forEach((m) => {
      root.remove(m)
      m.geometry.dispose()
    })
    hidden.forEach((h) => (h.visible = true))
  }
}

// =====================================================================
// the case
// =====================================================================

export interface CaseModelProps {
  tier: TierVisual
  lidRef: RefObject<THREE.Group | null>
  leverRefs: RefObject<(THREE.Group | null)[]>
  led: THREE.MeshStandardMaterial
  glow: THREE.MeshStandardMaterial
}

export function CaseModel({ tier, lidRef, leverRefs, led, glow }: CaseModelProps) {
  const g = geometry()
  const m = useTierMaterials(tier)
  const corners: [number, number][] = [
    [-1, -1],
    [1, -1],
    [-1, 1],
    [1, 1],
  ]
  const latchX = [-0.8, 0.8]
  const lidZ = -HINGE_Z // lid-local z of the case centre
  const knuckles = Array.from({ length: 9 }, (_, i) => -0.88 + i * 0.22)
  const baseRef = useRef<THREE.Group>(null)

  // bake static parts into a few draw calls once the tree is mounted
  useLayoutEffect(() => {
    const undoBase = mergeStatic(baseRef.current!)
    const undoLid = mergeStatic(lidRef.current!)
    return () => {
      undoBase()
      undoLid()
    }
  }, [m, lidRef])

  return (
    <group ref={baseRef} dispose={null}>
      {/* ================= base ================= */}
      <mesh geometry={g.baseShell} material={m.body} position={[0, BOTTOM, 0]} />
      <mesh geometry={g.flange} material={m.body} position={[0, SEAM - 0.08, 0]} />
      <mesh geometry={g.gasket} material={glow} position={[0, SEAM - 0.007, 0]} />

      {/* molded panels front and back */}
      {[1, -1].map((side) => (
        <group key={side} position={[0, BOTTOM + 0.34, side * ZF]} rotation={[0, side > 0 ? 0 : Math.PI, 0]}>
          <mesh geometry={g.panelFrame} material={m.trim} />
          {[-0.07, 0, 0.07].map((y) => (
            <mesh key={y} geometry={g.panelRib} material={m.trim} position={[0, y, 0]} />
          ))}
        </group>
      ))}

      {/* side ribs, bail handles */}
      {[-1, 1].map((s) => (
        <group key={s} position={[(s * W) / 2, 0, 0]} rotation={[0, (s * Math.PI) / 2, 0]}>
          {[-0.42, -0.14, 0.14, 0.42].map((z) => (
            <mesh key={z} geometry={g.sideRib} material={m.trim} position={[z, BOTTOM + 0.4, 0]} />
          ))}
        </group>
      ))}
      {[-1, 1].map((s) => (
        <group key={`h${s}`} position={[(s * W) / 2, SEAM - 0.17, 0]} scale={[s, 1, 1]}>
          {[-0.34, 0.34].map((z) => (
            <mesh key={z} geometry={g.sideMount} material={m.armor} position={[0.03, 0, z]} />
          ))}
          <mesh geometry={g.sideBail} material={m.hardware} />
        </group>
      ))}

      {/* rubber feet */}
      {corners.map(([sx, sz]) => (
        <mesh key={`f${sx}${sz}`} geometry={g.foot} material={m.rubber} position={[sx * (W / 2 - 0.42), BOTTOM - 0.012, sz * (ZF - 0.32)]} />
      ))}

      {/* lower corner guards */}
      {corners.map(([sx, sz]) => (
        <Guard key={`b${sx}${sz}`} position={[sx * (W / 2 - 0.15), BOTTOM + 0.17, sz * (ZF - 0.15)]} sx={sx} sy={-1} sz={sz} g={g} m={m} />
      ))}

      {/* interior: pluck foam with reward cavity */}
      <PluckFoam g={g} m={m} />
      <mesh geometry={g.cavityFloor} material={m.cavity} position={[0, SEAM - 0.058, 0]} rotation={[-Math.PI / 2, 0, 0]} />

      {/* draw latches */}
      {latchX.map((x, i) => (
        <group key={x}>
          <mesh geometry={g.bracket} material={m.armor} position={[x, SEAM - 0.24, ZF]} />
          {[-1, 1].map((sx) => (
            <Bolt key={sx} position={[x + sx * 0.12, SEAM - 0.33, ZF + 0.045]} rotation={facing.pz} g={g} m={m} />
          ))}
          <mesh geometry={g.barrel} material={m.hardware} position={[x, SEAM - 0.33, ZF + 0.075]} />
          <group
            ref={(el) => {
              leverRefs.current[i] = el
            }}
            position={[x, SEAM - 0.33, ZF + 0.075]}
            userData={{ dynamic: true }}
          >
            <mesh geometry={g.lever} material={m.hardware} position={[0, 0.22, 0.004]} />
            {[0.05, 0.085, 0.12, 0.155].map((y) => (
              <mesh key={y} geometry={g.leverRib} material={m.trim} position={[0, y, 0.04]} />
            ))}
            <mesh geometry={g.leverPin} material={m.hardware} position={[0, 0.36, 0.02]} />
            <mesh geometry={g.bail} material={m.hardware} />
          </group>
        </group>
      ))}

      {/* purge valve with LED status ring */}
      <mesh geometry={g.valveBezel} material={m.armor} position={[0, SEAM - 0.22, ZF]} />
      <mesh geometry={g.knurl} material={m.hardware} position={[0, SEAM - 0.22, ZF + 0.062]} />
      <mesh geometry={g.valve} material={m.hardware} position={[0, SEAM - 0.22, ZF + 0.075]} />
      <mesh geometry={g.ledRing} material={led} position={[0, SEAM - 0.22, ZF + 0.052]} />

      {/* piano hinge: base knuckles, leaves, pin */}
      <mesh geometry={g.hingePin} material={m.hardware} position={[0, SEAM, HINGE_Z]} />
      {knuckles
        .filter((_, i) => i % 2 === 0)
        .map((x) => (
          <group key={x}>
            <mesh geometry={g.knuckle} material={m.hardware} position={[x, SEAM, HINGE_Z]} />
            <mesh geometry={g.hingeLeaf} material={m.hardware} position={[x, SEAM - 0.1, -ZF]} rotation={[0, Math.PI, 0]} />
          </group>
        ))}

      {/* ================= lid ================= */}
      <group ref={lidRef} position={[0, SEAM, HINGE_Z]} userData={{ dynamic: true }}>
        <group position={[0, 0, lidZ]}>
          <mesh geometry={g.lidShell} material={m.body} position={[0, 0.07, 0]} />
          <mesh geometry={g.flange} material={m.body} position={[0, 0.005, 0]} />
          <mesh geometry={g.crate} material={m.foam} position={[0, 0.03, 0]} />

          {/* stacking frame and light channel on top */}
          <mesh geometry={g.topFrame} material={m.trim} position={[0, HL - 0.012, 0]} />
          {tier.glow && <mesh geometry={g.topChannel} material={glow} position={[0, HL - 0.004, 0]} />}

          {/* carry handle */}
          <group position={[0, HL, -0.28]}>
            {[-0.55, 0.55].map((x) => (
              <group key={x}>
                <mesh geometry={g.handleMount} material={m.armor} position={[x, -0.01, 0]} />
                <Bolt position={[x, 0.06, 0.06]} g={g} m={m} />
              </group>
            ))}
            <mesh geometry={g.handleBar} material={m.hardware} position={[0, 0.02, 0]} />
            <mesh geometry={g.grip} material={m.rubber} position={[0, 0.24, 0]} />
          </group>

          {/* engraved nameplate with rivets */}
          <group position={[0, HL - 0.004, 0.3]}>
            <mesh geometry={g.nameplate} material={m.armor} />
            <mesh geometry={g.label} material={m.label} position={[0, 0.0265, 0]} rotation={[-Math.PI / 2, 0, 0]} />
            {[-1, 1].map((sx) =>
              [-1, 1].map((sz) => <mesh key={`${sx}${sz}`} geometry={g.rivet} material={m.hardware} position={[sx * 0.52, 0.026, sz * 0.14]} />),
            )}
          </group>

          {/* latch keepers */}
          {latchX.map((x) => (
            <group key={x} position={[x, 0.17, ZF]}>
              <mesh geometry={g.keeper} material={m.armor} />
              <mesh geometry={g.keeperLip} material={m.hardware} position={[0, 0.03, 0.04]} />
            </group>
          ))}

          {/* upper corner guards */}
          {corners.map(([sx, sz]) => (
            <Guard key={`t${sx}${sz}`} position={[sx * (W / 2 - 0.15), HL - 0.17, sz * (ZF - 0.15)]} sx={sx} sy={1} sz={sz} g={g} m={m} />
          ))}

          {/* crystal inlays (diamond tier) */}
          {tier.gems && (
            <>
              {[-0.74, 0.74].map((x) => (
                <group key={x} position={[x, HL + 0.035, 0.3]}>
                  <mesh geometry={g.gemBezel} material={m.hardware} rotation={[Math.PI / 2, 0, 0]} />
                  <mesh geometry={g.gem} material={m.gem} />
                </group>
              ))}
              {[-0.34, -0.17, 0, 0.17, 0.34].map((x) => (
                <group key={x} position={[x, HL * 0.62, ZF + 0.012]} rotation={[Math.PI / 2, 0, 0]} scale={0.5}>
                  <mesh geometry={g.gemBezel} material={m.hardware} rotation={[Math.PI / 2, 0, 0]} />
                  <mesh geometry={g.gem} material={m.gem} />
                </group>
              ))}
            </>
          )}
        </group>

        {/* lid knuckles and leaves (rotate with the lid) */}
        {knuckles
          .filter((_, i) => i % 2 === 1)
          .map((x) => (
            <group key={x}>
              <mesh geometry={g.knuckle} material={m.hardware} position={[x, 0, 0]} />
              <mesh geometry={g.hingeLeaf} material={m.hardware} position={[x, 0.1, 0.06]} rotation={[0, Math.PI, 0]} />
            </group>
          ))}
      </group>
    </group>
  )
}
