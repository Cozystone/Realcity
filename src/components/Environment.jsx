import { useRef, useMemo } from 'react'
import { useFrame } from '@react-three/fiber'
import { Sky, Stars, Cloud, Environment as DreiEnv } from '@react-three/drei'
import * as THREE from 'three'

const DAY_SPEED = 1 / 240  // 1 real minute = 1 game hour cycle

export default function Environment() {
  const dirLightRef = useRef()
  const ambientRef  = useRef()
  const skyRef = useRef()
  const gameMinutes = useRef(12 * 60 + 45) // Start at 12:45 PM

  const sunPos = useRef(new THREE.Vector3(1, 1, -0.5).normalize())

  useFrame((_, delta) => {
    gameMinutes.current = (gameMinutes.current + delta * 60) % (24 * 60)
    const hour = gameMinutes.current / 60  // 0..24

    // Sun angle: 12:00 = noon (top), 0:00 = midnight (bottom)
    const sunAngle = ((hour - 6) / 12) * Math.PI  // 0 at 6am, π at 6pm
    const sunX = Math.cos(sunAngle - Math.PI / 2)
    const sunY = Math.sin(sunAngle - Math.PI / 2)

    sunPos.current.set(sunX * 500, sunY * 300, -200)

    const dayFactor = Math.max(0, Math.sin(sunAngle))  // 0 at night, 1 at noon
    const goldenHour = dayFactor < 0.15 ? dayFactor / 0.15 : 1 - Math.min(1, (dayFactor - 0.85) / 0.15)
    const isNight = sunY < -0.08

    if (dirLightRef.current) {
      const l = dirLightRef.current
      l.position.copy(sunPos.current)
      l.intensity = isNight ? 0 : dayFactor * 3.8 + 0.05
      if (goldenHour > 0.6) {
        l.color.setRGB(1.0, 0.65, 0.25)
      } else {
        l.color.setRGB(1.0, 0.97, 0.9)
      }
    }
    if (ambientRef.current) {
      ambientRef.current.intensity = isNight ? 0.08 : 0.2 + dayFactor * 0.25
    }
  })

  const cloudData = useMemo(() => {
    const clouds = []
    for (let i = 0; i < 28; i++) {
      clouds.push({
        x: (Math.random() - 0.5) * 3200,
        y: 260 + Math.random() * 200,
        z: (Math.random() - 0.5) * 3200,
        sx: 70 + Math.random() * 130,
        sy: 25 + Math.random() * 30,
        sz: 55 + Math.random() * 100,
        speed: 0.5 + Math.random() * 1.5,
        opacity: 0.2 + Math.random() * 0.4,
      })
    }
    return clouds
  }, [])

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
      {/* Atmospheric sky */}
      <Sky
        ref={skyRef}
        sunPosition={sunPos.current}
        distance={4500}
        turbidity={7}
        rayleigh={0.8}
        mieCoefficient={0.007}
        mieDirectionalG={0.88}
      />

      <Stars radius={2200} depth={90} count={7000} factor={5} fade speed={0.3} />

      {/* Sun / directional light */}
      <directionalLight
        ref={dirLightRef}
        position={[200, 200, -150]}
        intensity={3.5}
        color="#fff8e0"
        castShadow
        shadow-mapSize-width={4096}
        shadow-mapSize-height={4096}
        shadow-camera-near={1}
        shadow-camera-far={2800}
        shadow-camera-left={-700}
        shadow-camera-right={700}
        shadow-camera-top={700}
        shadow-camera-bottom={-700}
        shadow-bias={-0.0002}
        shadow-normalBias={0.04}
      />

      {/* Ambient / fill */}
      <ambientLight ref={ambientRef} intensity={0.22} color="#9ab8d4" />
      <hemisphereLight skyColor="#5a90d0" groundColor="#3a5030" intensity={0.75} />

      {/* Fog for distance culling */}
      <fog attach="fog" args={['#c8d8e8', 400, 2200]} />

      {/* HDR reflections */}
      <DreiEnv preset="city" background={false} />

      {/* Clouds */}
      {cloudData.map((c, i) => (
        <Cloud
          key={i}
          ref={(r) => { cloudRefs.current[i] = r }}
          position={[c.x, c.y, c.z]}
          speed={0}
          opacity={c.opacity}
          scale={[c.sx, c.sy, c.sz]}
          segments={18}
          color="#e8f0f8"
        />
      ))}
    </>
  )
}
