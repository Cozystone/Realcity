import { useRef, useMemo } from 'react'
import { useFrame } from '@react-three/fiber'
import { Sky, Stars, Cloud, Environment as DreiEnv } from '@react-three/drei'
import * as THREE from 'three'

// 1 real second = 1 in-game minute
const REAL_TO_GAME_MIN = 1

export default function Environment() {
  const dirRef  = useRef()
  const ambRef  = useRef()
  const hemiRef = useRef()
  const gameMin = useRef(11 * 60)  // Start at 11:00 AM

  // Sun position vector (normalized, for Sky component)
  const sunPos = useRef(new THREE.Vector3())

  useFrame((_, delta) => {
    gameMin.current = (gameMin.current + delta * REAL_TO_GAME_MIN) % (24 * 60)
    const hour = gameMin.current / 60  // 0..24

    // Angle: 6 AM = sun at horizon, 12 PM = zenith
    const angle = ((hour - 6) / 12) * Math.PI
    const sunY  = Math.sin(angle)
    const sunX  = -Math.cos(angle)

    sunPos.current.set(sunX, sunY, 0.4).normalize()

    const day      = Math.max(0, sunY)           // 0 night, 1 noon
    const golden   = day < 0.18 ? day / 0.18 : 0 // golden hour factor
    const isNight  = sunY < -0.05

    if (dirRef.current) {
      const d = dirRef.current
      d.position.set(sunX * 200, sunY * 200, 80)
      d.intensity = isNight ? 0.0 : day * 4.0 + 0.1

      if (golden > 0.1) {
        d.color.setRGB(1.0, 0.55 + golden * 0.3, 0.20 + golden * 0.2)
      } else {
        d.color.setRGB(1.0, 0.96 + day * 0.04, 0.88 + day * 0.12)
      }
    }
    if (ambRef.current) {
      ambRef.current.intensity = isNight ? 0.06 : 0.18 + day * 0.28
    }
    if (hemiRef.current) {
      hemiRef.current.intensity = isNight ? 0.04 : 0.5 + day * 0.4
    }
  })

  // Cloud data — static positions, move in wind direction
  const cloudData = useMemo(() => Array.from({ length: 22 }, () => ({
    x: (Math.random() - 0.5) * 3000,
    y: 280 + Math.random() * 220,
    z: (Math.random() - 0.5) * 3000,
    sx: 60 + Math.random() * 140,
    sy: 20 + Math.random() * 35,
    sz: 50 + Math.random() * 110,
    speed: 0.6 + Math.random() * 1.4,
    opacity: 0.18 + Math.random() * 0.38,
  })), [])

  const cloudRefs = useRef([])
  useFrame((_, delta) => {
    cloudRefs.current.forEach((ref, i) => {
      if (!ref) return
      ref.position.x += cloudData[i].speed * delta
      if (ref.position.x > 1800) ref.position.x = -1800
    })
  })

  return (
    <>
      {/* Atmospheric scattering sky */}
      <Sky
        sunPosition={sunPos.current}
        distance={4500}
        turbidity={3.5}       // cleaner atmosphere
        rayleigh={1.8}        // deeper blue
        mieCoefficient={0.006}
        mieDirectionalG={0.90}
        inclination={0.45}
        azimuth={0.25}
      />

      {/* Stars — visible at night */}
      <Stars radius={2000} depth={80} count={8000} factor={5} fade speed={0.3} />

      {/* Sun / key light */}
      <directionalLight
        ref={dirRef}
        position={[200, 200, 80]}
        intensity={4.0}
        color="#fff8e8"
        castShadow
        shadow-mapSize-width={4096}
        shadow-mapSize-height={4096}
        shadow-camera-near={1}
        shadow-camera-far={2500}
        shadow-camera-left={-650}
        shadow-camera-right={650}
        shadow-camera-top={650}
        shadow-camera-bottom={-650}
        shadow-bias={-0.00015}
        shadow-normalBias={0.05}
        shadow-radius={3}       /* PCF soft shadows */
      />

      {/* Ambient fill */}
      <ambientLight ref={ambRef} intensity={0.2} color="#a0c0d8" />

      {/* Sky / ground hemisphere */}
      <hemisphereLight
        ref={hemiRef}
        skyColor="#6090cc"
        groundColor="#3a4828"
        intensity={0.7}
      />

      {/* Distance fog — hides far terrain edge naturally */}
      <fog attach="fog" args={['#b8cce0', 500, 2400]} />

      {/* HDRI for PBR reflections */}
      <DreiEnv preset="city" background={false} />

      {/* Clouds */}
      {cloudData.map((c, i) => (
        <Cloud
          key={i}
          ref={r => { cloudRefs.current[i] = r }}
          position={[c.x, c.y, c.z]}
          speed={0}
          opacity={c.opacity}
          scale={[c.sx, c.sy, c.sz]}
          segments={16}
          color="#eaf0f8"
        />
      ))}
    </>
  )
}
