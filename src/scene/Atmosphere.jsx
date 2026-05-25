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
  const ambientRef = useRef()
  const hemiRef = useRef()
  const fogRef = useRef()
  const skyTick = useRef(-1)
  const [skySun, setSkySun] = useState(() => sunRef.current.toArray())

  const clouds = useMemo(() => {
    let seed = 404
    const rnd = () => {
      seed = (seed * 1664525 + 1013904223) & 0xffffffff
      return (seed >>> 0) / 4294967296
    }
    return Array.from({ length: 34 }, (_, i) => ({
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

    if (dirRef.current) {
      dirRef.current.position.set(sun.x * 300, sun.y * 300, sun.z * 300)
      dirRef.current.intensity = night ? 0.02 : 0.25 + day * 4.7
      dirRef.current.color.setRGB(1, 0.76 + day * 0.24, 0.5 + day * 0.44 + twilight * 0.12)
    }
    if (ambientRef.current) ambientRef.current.intensity = night ? 0.07 : 0.18 + day * 0.34
    if (hemiRef.current) hemiRef.current.intensity = night ? 0.05 : 0.44 + day * 0.55
    if (fogRef.current) {
      fogRef.current.color.set(night ? '#192133' : twilight > 0.45 ? '#8f7968' : '#6f8496')
      fogRef.current.near = 520 - weather.clouds * 120
      fogRef.current.far = 2240 - weather.clouds * 320
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
      <Sky sunPosition={skySun} distance={4700} turbidity={3.8} rayleigh={1.8} mieCoefficient={0.006} mieDirectionalG={0.9} />
      <Stars radius={2300} depth={90} count={9500} factor={5} fade speed={0.25} />
      <directionalLight
        ref={dirRef}
        castShadow
        position={[220, 260, 80]}
        intensity={4}
        shadow-mapSize-width={4096}
        shadow-mapSize-height={4096}
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
      <ambientLight ref={ambientRef} color="#9fb6d5" intensity={0.22} />
      <hemisphereLight ref={hemiRef} skyColor="#7fb1f0" groundColor="#31412a" intensity={0.7} />
      <fog ref={fogRef} attach="fog" args={['#6f8496', 520, 2240]} />
      <Environment preset="city" background={false} />
      {clouds.map((cloud, i) => (
        <Cloud
          key={i}
          ref={node => { cloudRefs.current[i] = node }}
          position={[cloud.x, cloud.y, cloud.z]}
          opacity={cloud.opacity}
          scale={[cloud.sx, cloud.sy, cloud.sz]}
          segments={18}
          speed={0}
          color="#eef4fb"
        />
      ))}
    </>
  )
}
