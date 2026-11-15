import { CaseModel, SEAM, type CaseModelProps } from './CaseModel'

/** Distinct silhouettes with low segment counts for mobile rendering. */
export function ThemedCaseModel(props: CaseModelProps) {
  const { tier, lidRef, led, glow } = props
  const brass = '#b89a63'
  const body = tier.body.color
  if (tier.id === 'silver') return <CaseModel {...props} />

  const bamboo = tier.id === 'bronze'
  const moon = tier.id === 'gold'
  const phoenix = tier.id === 'platinum'
  return (
    <group>
      {bamboo ? <>
        {/* An upright bamboo reliquary with individual hollow stalks and binding rings. */}
        {[-1, -.5, 0, .5, 1].map((x, i) => <group key={x} position={[x, -.18, 0]}>
          <mesh><cylinderGeometry args={[.25, .28, 1.25 + (i % 2) * .12, 10]} /><meshStandardMaterial color={i % 2 ? '#273d2b' : '#3e5134'} roughness={.6} /></mesh>
          {[-.4, .05, .45].map(y => <mesh key={y} position={[0, y, 0]} rotation={[Math.PI / 2, 0, 0]}><torusGeometry args={[.26, .025, 4, 10]} /><meshStandardMaterial color={brass} metalness={.8} roughness={.35} /></mesh>)}
        </group>)}
        {[-.57, .2].map(y => <mesh key={y} position={[0, y, 0]} scale={[1.4, .65, 1]} rotation={[Math.PI / 2, 0, 0]}><torusGeometry args={[.89, .045, 6, 24]} /><meshStandardMaterial color={brass} metalness={.8} roughness={.3} /></mesh>)}
      </> : moon ? <>
        {/* A lunar vessel held inside a tilted armillary frame. */}
        <mesh position={[0, SEAM - .1, 0]}><sphereGeometry args={[.91, 24, 16, 0, Math.PI * 2, Math.PI / 2, Math.PI / 2]} /><meshStandardMaterial color={body} metalness={.8} roughness={.24} /></mesh>
        {[0, Math.PI / 3, -Math.PI / 3].map(angle => <mesh key={angle} rotation={[.35, angle, .25]}><torusGeometry args={[1.15, .035, 6, 40]} /><meshStandardMaterial color={brass} metalness={.95} roughness={.25} /></mesh>)}
        <mesh position={[0, -.72, 0]}><cylinderGeometry args={[.56, .75, .18, 8]} /><meshStandardMaterial color={body} metalness={.7} roughness={.3} /></mesh>
      </> : phoenix ? <>
        {/* A tapered obsidian sarcophagus, flanked by stepped bronze wings. */}
        <mesh position={[0, -.2, 0]} rotation={[0, Math.PI / 4, 0]} scale={[1.4, 1, .85]}><cylinderGeometry args={[.86, .65, 1, 4]} /><meshStandardMaterial color='#211018' metalness={.75} roughness={.3} /></mesh>
        {[-1, 1].map(side => <group key={side} position={[side * .8, .02, 0]} rotation={[0, 0, side * -.45]}>
          {[0, 1, 2, 3].map(i => <mesh key={i} position={[side * i * .17, i * .13, -.06 * i]} rotation={[0, 0, side * -.15]}><coneGeometry args={[.17, .9 - i * .1, 4]} /><meshStandardMaterial color={i % 2 ? '#a95230' : brass} metalness={.85} roughness={.3} /></mesh>)}
        </group>)}
      </> : <>
        {/* A coopered reserve barrel with metal hoops and a hanging front seal. */}
        <mesh position={[0, -.16, 0]}><cylinderGeometry args={[.85, .74, 1.25, 16]} /><meshStandardMaterial color='#332014' roughness={.65} /></mesh>
        {[-.7, -.28, .32].map(y => <mesh key={y} position={[0, y, 0]}><cylinderGeometry args={[.87, .87, .095, 16, 1, true]} /><meshStandardMaterial color={brass} metalness={.9} roughness={.32} /></mesh>)}
        {Array.from({ length: 12 }, (_, i) => i * Math.PI / 6).map(angle => <mesh key={angle} position={[Math.cos(angle) * .8, -.17, Math.sin(angle) * .8]} rotation={[0, -angle, 0]}><boxGeometry args={[.035, 1.12, .035]} /><meshStandardMaterial color='#120b07' /></mesh>)}
        <mesh position={[0, -.08, .88]} rotation={[Math.PI / 2, 0, 0]}><cylinderGeometry args={[.18, .18, .07, 8]} /><meshStandardMaterial color='#844659' metalness={.25} roughness={.4} /></mesh>
      </>}
      <group ref={lidRef} position={[0, SEAM, -.85]}>
        <group position={[0, 0, .85]}>
          {bamboo ? <>
            <mesh position={[0, .16, 0]}><boxGeometry args={[2.7, .25, .68]} /><meshStandardMaterial color='#243126' roughness={.5} /></mesh>
            <mesh position={[0, .34, 0]} rotation={[0, 0, Math.PI / 2]}><torusGeometry args={[.2, .045, 6, 16, Math.PI]} /><meshStandardMaterial color={brass} metalness={.8} roughness={.3} /></mesh>
          </> : moon ? <>
            <mesh position={[0, -.1, 0]}><sphereGeometry args={[.91, 24, 16, 0, Math.PI * 2, 0, Math.PI / 2]} /><meshStandardMaterial color={body} metalness={.8} roughness={.24} /></mesh>
            <mesh position={[0, .58, 0]} material={glow}><octahedronGeometry args={[.14]} /></mesh>
          </> : phoenix ? <>
            <mesh position={[0, .15, 0]} rotation={[0, Math.PI / 4, 0]} scale={[1.4, 1, .85]}><coneGeometry args={[.92, .52, 4]} /><meshStandardMaterial color='#5b2735' metalness={.8} roughness={.25} /></mesh>
            <mesh position={[0, .43, 0]} material={glow}><octahedronGeometry args={[.16]} /></mesh>
          </> : <>
            <mesh position={[0, .12, 0]}><cylinderGeometry args={[.88, .88, .2, 16]} /><meshStandardMaterial color='#3b281b' roughness={.55} /></mesh>
            <mesh position={[0, .24, 0]} rotation={[Math.PI / 2, 0, 0]}><torusGeometry args={[.65, .025, 6, 24]} /><meshStandardMaterial color={brass} metalness={.9} roughness={.3} /></mesh>
          </>}
        </group>
      </group>
      <mesh position={[0, SEAM - .08, bamboo ? .28 : .8]} material={led}><octahedronGeometry args={[.075]} /></mesh>
    </group>
  )
}
