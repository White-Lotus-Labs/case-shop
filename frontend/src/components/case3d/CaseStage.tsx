// The hero stage: studio lighting, the floating case, its shadow, and the opening sequence.
// Every animated value is damped inside one frame loop, so idle → hover → opening → open
// blend continuously instead of jumping between states.

import { ContactShadows, Environment, Lightformer, PerformanceMonitor } from '@react-three/drei'
import { Canvas, useFrame, useThree } from '@react-three/fiber'
import { useEffect, useMemo, useRef, useState } from 'react'
import * as THREE from 'three'
import { TIERS, type TierVisual } from '@/lib/tiers'
import { CaseModel, DIM, SEAM, precompileTiers } from './CaseModel'

/** Once the studio is lit, compile the other tiers' shaders in the background */
function PrecompileTiers() {
  const { gl, camera, scene } = useThree()
  useEffect(() => {
    const id = setTimeout(() => void precompileTiers(gl, camera, scene, Object.values(TIERS)).catch(() => {}), 600)
    return () => clearTimeout(id)
  }, [gl, camera, scene])
  return null
}

export type StagePhase = 'idle' | 'sealed' | 'opening' | 'open'

interface StageProps {
  tier: TierVisual
  phase: StagePhase
  /** Color of the best revealed item; shows the reward core rising out of the case */
  rewardColor: string | null
  reducedMotion: boolean
  /** Clicking the case triggers this (used to open sealed cases) */
  onActivate?: () => void
}

const { damp, clamp, smoothstep } = THREE.MathUtils

// stable reference: a new object each render makes the Canvas re-apply it and undo our framing
const CAMERA = { position: [0, 2, 10] as [number, number, number], fov: 30 }
// alpha stays on: the contact-shadow buffer relies on a transparent clear colour
const GL = { antialias: true, alpha: true, powerPreference: 'high-performance' as const }
const HIT_MATERIAL = new THREE.MeshBasicMaterial({ colorWrite: false, depthWrite: false })
const easeOut = (x: number) => 1 - Math.pow(1 - x, 3)
const easeInOut = (x: number) => (x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2)

const hasWebGL = () => {
  try {
    const c = document.createElement('canvas')
    return Boolean(c.getContext('webgl2') || c.getContext('webgl'))
  } catch {
    return false
  }
}

/**
 * Product-photography studio rendered into the environment map (no HDR download):
 * an overhead softbox, two strip lights, a front ring for catchlights and a floor bounce.
 */
let glowTex: THREE.CanvasTexture | null = null
function radialTexture() {
  if (glowTex) return glowTex
  const c = document.createElement('canvas')
  c.width = c.height = 256
  const g = c.getContext('2d')!
  const grad = g.createRadialGradient(128, 128, 0, 128, 128, 128)
  grad.addColorStop(0, 'rgba(255,255,255,1)')
  grad.addColorStop(0.45, 'rgba(255,255,255,0.35)')
  grad.addColorStop(1, 'rgba(255,255,255,0)')
  g.fillStyle = grad
  g.fillRect(0, 0, 256, 256)
  glowTex = new THREE.CanvasTexture(c)
  return glowTex
}

/** Dark cosmic backdrop with a soft pool of tier-colored gravity light behind the case */
function Backdrop({ tier }: { tier: TierVisual }) {
  const mat = useMemo(
    () => new THREE.MeshBasicMaterial({ map: radialTexture(), transparent: true, depthWrite: false, toneMapped: false, opacity: 0.22 }),
    [],
  )
  useEffect(() => void mat.color.set(tier.ui), [tier, mat])
  useEffect(() => () => mat.dispose(), [mat])
  return (
    <>
      <color attach="background" args={['#060818']} />
      <mesh material={mat} position={[0, 0.2, -6]} scale={[32, 20, 1]}>
        <planeGeometry />
      </mesh>
    </>
  )
}

function Studio({ tier, reducedMotion }: { tier: TierVisual; reducedMotion: boolean }) {
  const { scene } = useThree()
  // slow orbit of the reflections so surfaces never look frozen
  useFrame((state) => {
    if (!reducedMotion) scene.environmentRotation.y = Math.sin(state.clock.elapsedTime * 0.08) * 0.6
  })
  return (
    <>
      <Environment resolution={256} frames={1}>
        <Lightformer form="rect" intensity={4.5} color={tier.keyLight} position={[0, 5, 1]} rotation={[Math.PI / 2, 0, 0]} scale={[7, 3.5, 1]} />
        <Lightformer form="rect" intensity={3} color="#ffffff" position={[-5, 1.6, 1.5]} rotation={[0, Math.PI / 2, 0]} scale={[5, 0.8, 1]} />
        <Lightformer form="rect" intensity={3.6} color={tier.rimLight} position={[5, 1.2, -1.5]} rotation={[0, -Math.PI / 2, 0]} scale={[5, 0.6, 1]} />
        <Lightformer form="rect" intensity={1.8} color={tier.rimLight} position={[0, 2, -5]} scale={[6, 1, 1]} />
        <Lightformer form="rect" intensity={1.6} color="#ffffff" position={[0, 1.2, 6]} scale={[6, 2.2, 1]} />
        <Lightformer form="ring" intensity={1.4} color="#ffffff" position={[1.5, 1.5, 6]} scale={1.6} />
        <Lightformer form="rect" intensity={0.4} color="#ffffff" position={[0, -4, 0]} rotation={[-Math.PI / 2, 0, 0]} scale={[8, 8, 1]} />
      </Environment>
      <ambientLight intensity={0.15} />
      <directionalLight position={[-3, 5, 4]} intensity={2.2} color={tier.keyLight} />
      <directionalLight position={[4.5, 2.5, -4]} intensity={3} color={tier.rimLight} />
    </>
  )
}

function CaseRig({ tier, phase, rewardColor, reducedMotion, onActivate }: StageProps) {
  const root = useRef<THREE.Group>(null)
  const lid = useRef<THREE.Group>(null)
  const levers = useRef<(THREE.Group | null)[]>([])
  const interior = useRef<THREE.PointLight>(null)
  const core = useRef<THREE.Mesh>(null)
  const hovered = useRef(false)
  const s = useRef({ clasp: 0, lid: 0, lift: 0, hover: 0, core: 0, tiltX: 0, tiltY: 0, mounted: performance.now(), openStart: 0 })
  const { scene, camera, size } = useThree()
  const finePointer = useMemo(() => window.matchMedia('(hover: hover) and (pointer: fine)').matches, [])

  const led = useMemo(() => new THREE.MeshStandardMaterial({ color: '#111', emissive: '#ffb340', emissiveIntensity: 2 }), [])
  const glow = useMemo(
    () => new THREE.MeshStandardMaterial({ color: '#0c0c0e', roughness: 0.6, emissive: tier.glow ?? '#000', emissiveIntensity: tier.glow ? 2.2 : 0 }),
    [tier],
  )
  const coreMat = useMemo(
    () => new THREE.MeshPhysicalMaterial({ color: '#fff', metalness: 0.2, roughness: 0.12, clearcoat: 1, emissiveIntensity: 0.9, flatShading: true }),
    [],
  )
  useEffect(() => () => [led, glow, coreMat].forEach((m) => m.dispose()), [led, glow, coreMat])
  useEffect(() => {
    if (rewardColor) {
      coreMat.color.set(rewardColor)
      coreMat.emissive.set(rewardColor)
    }
  }, [rewardColor, coreMat])
  useEffect(() => {
    if (phase === 'opening') s.current.openStart = performance.now()
  }, [phase])

  // The stage fills the whole viewport. Keep the case framed: pull back on narrow screens so it
  // fits the width, and shift the view so it sits in the space left between the overlaid UI.
  useEffect(() => {
    const persp = camera as THREE.PerspectiveCamera
    const aspect = size.width / size.height
    const narrow = aspect < 0.9
    const halfFov = Math.tan(THREE.MathUtils.degToRad(persp.fov / 2))
    // case is ~3.3 units wide and ~2 tall: aim for ~72% of the width on phones, ~34% on desktop
    const fitWidth = (share: number) => 3.3 / (share * 2 * halfFov * aspect)
    const dist = narrow ? Math.max(9, fitWidth(0.72)) : Math.max(10, fitWidth(0.34))
    camera.position.set(0, (1.3 * dist) / 6.6, dist)
    camera.lookAt(0, -0.08, 0)
    persp.setViewOffset(size.width, size.height, 0, size.height * (narrow ? 0.075 : 0.03), size.width, size.height)
    persp.updateProjectionMatrix()  }, [size, camera])

  useEffect(() => () => void (document.body.style.cursor = ''), [])

  const amber = useMemo(() => new THREE.Color('#ffb340'), [])
  const ready = useMemo(() => new THREE.Color(tier.glow ?? tier.ui), [tier])

  useFrame((state, dt) => {
    const v = s.current
    const now = performance.now()
    const t = state.clock.elapsedTime
    const rm = reducedMotion

    // entrance when switching tiers
    const e = rm ? 1 : easeOut(clamp((now - v.mounted) / 750, 0, 1))

    // opening timeline: unlock clasps → lift lid → light the interior
    let claspT = 0
    let lidT = 0
    let liftT = 0
    let p = 0
    if (phase === 'opening') {
      p = rm ? 1 : clamp((now - v.openStart) / tier.openMs, 0, 1)
      claspT = smoothstep(p, 0.08, 0.36)
      lidT = easeInOut(clamp((p - 0.36) / 0.52, 0, 1))
      liftT = smoothstep(p, 0, 0.3)
    } else if (phase === 'open') {
      claspT = lidT = liftT = 1
    } else if (phase === 'sealed') {
      liftT = 0.3
    }
    const k = phase === 'opening' ? 18 : 5
    v.clasp = damp(v.clasp, claspT, k, dt)
    v.lid = damp(v.lid, lidT, k, dt)
    v.lift = damp(v.lift, liftT, 4, dt)
    v.hover = damp(v.hover, hovered.current ? 1 : 0, 6, dt)
    v.core = damp(v.core, rewardColor && v.lid > 0.85 ? 1 : 0, 4, dt)

    const px = rm || !finePointer ? 0 : state.pointer.x
    const py = rm || !finePointer ? 0 : state.pointer.y
    v.tiltY = damp(v.tiltY, px * 0.26, 2.5, dt)
    v.tiltX = damp(v.tiltX, -py * 0.08, 2.5, dt)

    const float = rm ? 0 : Math.sin(t * 0.9) * 0.05
    const drift = rm ? 0 : Math.sin(t * 0.2) * 0.12

    const g = root.current
    if (g) {
      // settle lower as the lid opens so the raised lid stays clear of the tier picker
      g.position.y = float + v.hover * 0.09 + v.lift * 0.16 - v.lid * 0.75 - 0.4 * (1 - e)
      g.rotation.y = -0.62 + drift * (1 - v.lift) + v.tiltY + v.lift * 0.3 + 0.9 * (1 - e)
      g.rotation.x = 0.03 + v.tiltX + v.hover * 0.025 - v.lift * 0.03
      g.rotation.z = -v.hover * 0.015
      g.scale.setScalar(0.86 + 0.14 * e)
    }
    if (lid.current) lid.current.rotation.x = -v.lid * 1.95
    for (const l of levers.current) if (l) l.rotation.x = v.clasp * 1.85

    // status light: amber while sealed or unlocking, tier color once open
    const unlocked = phase === 'open' || (phase === 'opening' && p > 0.36)
    if (unlocked) {
      led.emissive.copy(ready)
      led.emissiveIntensity = 2.4
    } else if (phase === 'sealed' || phase === 'opening') {
      led.emissive.copy(amber)
      led.emissiveIntensity = phase === 'opening' ? 1.4 + Math.sin(t * 22) * 1.2 : 1.4 + Math.sin(t * 2.4) * 0.6
    } else {
      led.emissive.copy(ready)
      led.emissiveIntensity = 0.5
    }
    if (tier.glow) glow.emissiveIntensity = 2.2 + v.lid * 1.6 + v.hover * 0.4

    if (interior.current) interior.current.intensity = v.lid * 5
    if (core.current) {
      core.current.visible = v.core > 0.01
      core.current.position.y = SEAM + 0.08 + v.core * 0.62 + (rm ? 0 : Math.sin(t * 1.6) * 0.03 * v.core)
      core.current.scale.setScalar(0.2 + 0.8 * v.core)
      if (!rm) core.current.rotation.y += dt * 0.7
    }

    // hover brightens edge reflections
    scene.environmentIntensity = 1.15 + v.hover * 0.35 + v.lid * 0.1
  })

  return (
    <group
      ref={root}
      // events come from the whole page (eventSource), so only react when the pointer is
      // actually over the canvas, not over a panel or button that overlaps the case
      onPointerOver={(ev) => {
        ev.stopPropagation()
        if (!(ev.nativeEvent.target as Element | null)?.closest?.('[data-stage]')) return
        hovered.current = true
        if (onActivate) document.body.style.cursor = 'pointer'
      }}
      onPointerOut={() => {
        hovered.current = false
        document.body.style.cursor = ''
      }}
      onClick={(ev) => {
        ev.stopPropagation()
        if (!(ev.nativeEvent.target as Element | null)?.closest?.('[data-stage]')) return
        onActivate?.()
      }}
    >
      <CaseModel tier={tier} lidRef={lid} leverRefs={levers} led={led} glow={glow} />
      {/* single invisible box for hover/click hit-testing; the case parts themselves don't raycast */}
      <mesh material={HIT_MATERIAL} position={[0, -0.02, 0]}>
        <boxGeometry args={[2.95, 1.9, 2.05]} />
      </mesh>
      <pointLight ref={interior} position={[0, SEAM + 0.35, 0.1]} color={tier.glow ?? '#fff2e0'} intensity={0} distance={3.5} decay={2} />
      <mesh ref={core} material={coreMat} visible={false}>
        <icosahedronGeometry args={[0.2, 0]} />
      </mesh>
    </group>
  )
}

export function CaseStage(props: StageProps) {
  const [webgl] = useState(hasWebGL)
  // the canvas covers the whole viewport, so cap the pixel ratio; drop to 1 if frames start missing
  const [dpr, setDpr] = useState(1.5)

  if (!webgl) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-2 text-center">
        <div className="text-[22px] font-semibold">{props.tier.name} Case</div>
        <div className="text-[13px] text-fg-3">3D preview needs WebGL, which this browser has turned off.</div>
      </div>
    )
  }

  return (
    <Canvas
      dpr={[1, dpr]}
      camera={CAMERA}
      gl={GL}
      onCreated={({ gl }) => {
        gl.toneMapping = THREE.ACESFilmicToneMapping
        gl.toneMappingExposure = 1.05
      }}
      // pointer tracking across the whole page, so the case tilts even when the cursor is over the UI
      eventSource={document.getElementById('root') ?? undefined}
      eventPrefix="client"
      style={{ touchAction: 'pan-y' }}
      aria-label={`${props.tier.name} case, 3D view`}
      role="img"
    >
      <PerformanceMonitor onDecline={() => setDpr(1)} />
      <Backdrop tier={props.tier} />
      <Studio tier={props.tier} reducedMotion={props.reducedMotion} />
      <CaseRig key={props.tier.id} {...props} />
      <PrecompileTiers />
      {/* The shadow re-renders the whole case from below, so only refresh it while something
          moves (tier entrance, opening, closing); the idle float is too small to notice. */}
      <ContactShadows
        key={`${props.tier.id}-${props.phase}`}
        position={[0, DIM.BOTTOM - 0.42, 0]}
        opacity={0.65}
        scale={9}
        blur={2.6}
        far={2.4}
        resolution={256}
        color="#000000"
        frames={props.reducedMotion ? 1 : 150}
      />
    </Canvas>
  )
}
