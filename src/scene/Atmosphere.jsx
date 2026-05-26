import { useMemo, useRef, useState } from 'react'
import { useFrame } from '@react-three/fiber'
import { Cloud, Environment, Sky, Stars } from '@react-three/drei'
import * as THREE from 'three'
import { useCityStore } from '../engine/cityStore'

function sunFor(minutes) {
  const hour = minutes / 60
  const angle = ((hour - 6) / 12) * Math.PI
  return new THREE.Vector3(-Math.cos(angle), Math.sin(angle), 0.42).normalize()
}

export default function Atmosphere() {
  const sunRef = useRef(sunFor(useCityStore.getState().timeMinutes))
  const dirRef = useRef()
  const fillRef = useRef()
  const ambientRef = useRef()
  const hemiRef = useRef()
  const fogRef = useRef()
  const sunDiscRef = useRef()
  const moonDiscRef = useRef()
  const skyTick = useRef(-1)
  const skyReportTick = useRef(-1)
  const [skySun, setSkySun] = useState(() => sunRef.current.toArray())

  const clouds = useMemo(() => {
    let seed = 404
    const rnd = () => {
      seed = (seed * 1664525 + 1013904223) & 0xffffffff
      return (seed >>> 0) / 4294967296
    }
    return Array.from({ length: 16 }, (_, i) => ({
      x: (rnd() - 0.5) * 3400,
      y: 250 + rnd() * 260,
      z: (rnd() - 0.5) * 3400,
      sx: 45 + rnd() * 160,
      sy: 18 + rnd() * 42,
      sz: 50 + rnd() * 135,
      speed: 0.45 + rnd() * 1.35,
      phase: i * 0.51,
      opacity: 0.13 + rnd() * 0.34,
    }))
  }, [])

  const cloudRefs = useRef([])

  useFrame((state, delta) => {
    const { timeMinutes, weather } = useCityStore.getState()
    const sun = sunFor(timeMinutes)
    sunRef.current.copy(sun)
    const day = Math.max(0, sun.y)
    const night = sun.y < -0.08
    const twilight = Math.max(0, 1 - Math.abs(sun.y) * 4.5)

    const tick = Math.floor(timeMinutes * 1.2)
    if (tick !== skyTick.current) {
      skyTick.current = tick
      setSkySun(sun.toArray())
    }

    const phase = night ? 'night' : twilight > 0.35 ? (sun.y > 0 ? 'golden-hour' : 'dawn') : 'day'
    const reflection = night ? 0.35 : 0.72 + day * 0.72 + twilight * 0.25

    if (dirRef.current) {
      dirRef.current.position.set(sun.x * 300, sun.y * 300, sun.z * 300)
      dirRef.current.intensity = night ? 0.025 : 0.38 + day * 3.75 + twilight * 0.8
      dirRef.current.color.setRGB(1, 0.72 + day * 0.27, 0.46 + day * 0.48 + twilight * 0.16)
    }
    if (fillRef.current) {
      fillRef.current.position.set(-sun.x * 220, Math.max(70, sun.y * 120 + 80), -sun.z * 220)
      fillRef.current.intensity = night ? 0.1 : 0.24 + twilight * 0.4
    }
    if (ambientRef.current) ambientRef.current.intensity = night ? 0.14 : 0.62 + day * 0.46
    if (hemiRef.current) hemiRef.current.intensity = night ? 0.13 : 0.98 + day * 0.54
    if (fogRef.current) {
      fogRef.current.color.set(night ? '#192133' : twilight > 0.45 ? '#8f7968' : '#7f91a0')
      fogRef.current.near = 520 - weather.clouds * 120
      fogRef.current.far = 2240 - weather.clouds * 320
    }
    if (sunDiscRef.current) {
      sunDiscRef.current.visible = sun.y > -0.12
      sunDiscRef.current.position.set(sun.x * 1220, sun.y * 1220 + 120, sun.z * 1220)
      sunDiscRef.current.scale.setScalar(1 + twilight * 0.45)
    }
    if (moonDiscRef.current) {
      moonDiscRef.current.visible = sun.y < 0.22
      moonDiscRef.current.position.set(-sun.x * 1180, Math.max(120, -sun.y * 900 + 120), -sun.z * 1180)
    }

    if (tick !== skyReportTick.current) {
      skyReportTick.current = tick
      useCityStore.getState().setSky({
        phase,
        sunElevation: Number(sun.y.toFixed(3)),
        sunlight: Number((night ? 0.03 : 0.2 + day).toFixed(3)),
        reflection: Number(reflection.toFixed(3)),
      })
    }

    const wind = new THREE.Vector2(Math.cos(weather.windAngle), Math.sin(weather.windAngle))
    cloudRefs.current.forEach((cloud, i) => {
      if (!cloud) return
      const c = clouds[i]
      cloud.position.x += wind.x * weather.windSpeed * c.speed * delta
      cloud.position.z += wind.y * weather.windSpeed * c.speed * delta
      cloud.position.y = c.y + Math.sin(state.clock.elapsedTime * 0.08 + c.phase) * 3.4
      if (cloud.position.x > 1800) cloud.position.x = -1800
      if (cloud.position.x < -1800) cloud.position.x = 1800
      if (cloud.position.z > 1800) cloud.position.z = -1800
      if (cloud.position.z < -1800) cloud.position.z = 1800
    })
  })

  return (
    <>
      <Sky sunPosition={skySun} distance={4700} turbidity={2.9} rayleigh={1.25} mieCoefficient={0.0045} mieDirectionalG={0.84} />
      <Stars radius={2300} depth={90} count={2600} factor={4} fade speed={0.18} />
      <directionalLight
        ref={dirRef}
        castShadow
        position={[220, 260, 80]}
        intensity={4}
        shadow-mapSize-width={2048}
        shadow-mapSize-height={2048}
        shadow-camera-left={-760}
        shadow-camera-right={760}
        shadow-camera-top={760}
        shadow-camera-bottom={-760}
        shadow-camera-near={1}
        shadow-camera-far={2800}
        shadow-bias={-0.00012}
        shadow-normalBias={0.05}
        shadow-radius={3}
      />
      <directionalLight ref={fillRef} position={[-140, 150, -220]} intensity={0.28} color="#d7e9ff" />
      <ambientLight ref={ambientRef} color="#c6d2dc" intensity={0.68} />
      <hemisphereLight ref={hemiRef} skyColor="#a9d0f4" groundColor="#777164" intensity={1.02} />
      <fog ref={fogRef} attach="fog" args={['#6f8496', 520, 2240]} />
      <Environment preset="city" background={false} />
      <mesh ref={sunDiscRef} position={[900, 650, 300]} renderOrder={-1}>
        <sphereGeometry args={[22, 24, 16]} />
        <meshBasicMaterial color="#fff2b7" toneMapped={false} />
      </mesh>
      <mesh ref={moonDiscRef} position={[-900, 450, -300]} renderOrder={-1}>
        <sphereGeometry args={[13, 18, 12]} />
        <meshBasicMaterial color="#d9e5ff" toneMapped={false} />
      </mesh>
      {clouds.map((cloud, i) => (
        <Cloud
          key={i}
          ref={node => { cloudRefs.current[i] = node }}
          position={[cloud.x, cloud.y, cloud.z]}
          opacity={cloud.opacity}
          scale={[cloud.sx, cloud.sy, cloud.sz]}
          segments={10}
          speed={0}
          color="#eef4fb"
        />
      ))}
    </>
  )
}
