import { useEffect, useMemo, useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import * as THREE from 'three'
import { CITY_HALF, terrainHeight } from '../engine/cityEngine'
import { useCityStore } from '../engine/cityStore'

const WALK_SPEED = 6.2
const RUN_SPEED = 12.5
const GRAVITY = 23
const JUMP = 8.6
const CAMERA_DISTANCE = 10.5
const CAMERA_HEIGHT = 2.35

function useKeys() {
  const keys = useRef({})

  useEffect(() => {
    const down = (event) => {
      keys.current[event.code] = true
      if (['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(event.code)) event.preventDefault()
    }
    const up = (event) => {
      keys.current[event.code] = false
    }
    window.addEventListener('keydown', down, { passive: false })
    window.addEventListener('keyup', up)
    return () => {
      window.removeEventListener('keydown', down)
      window.removeEventListener('keyup', up)
    }
  }, [])

  return keys
}

function resolveBuildingCollision(city, x, z) {
  let px = x
  let pz = z
  const radius = 0.72
  const colliders = city.getNearbyBuildings(px, pz)

  for (const building of colliders) {
    if (building.h < 3) continue
    const hw = building.w / 2 + radius
    const hd = building.d / 2 + radius
    const dx = px - building.x
    const dz = pz - building.z
    if (Math.abs(dx) < hw && Math.abs(dz) < hd) {
      const pushX = hw - Math.abs(dx)
      const pushZ = hd - Math.abs(dz)
      if (pushX < pushZ) {
        px = building.x + Math.sign(dx || 1) * hw
      } else {
        pz = building.z + Math.sign(dz || 1) * hd
      }
    }
  }

  px = Math.max(-CITY_HALF + 15, Math.min(CITY_HALF - 15, px))
  pz = Math.max(-CITY_HALF + 15, Math.min(CITY_HALF - 15, pz))
  return [px, pz]
}

function Character({ moving, running }) {
  const leftLeg = useRef()
  const rightLeg = useRef()
  const leftArm = useRef()
  const rightArm = useRef()
  const phase = useRef(0)

  useFrame((_, delta) => {
    const rate = moving.current ? (running.current ? 10 : 6.5) : 0
    phase.current += delta * rate
    const swing = Math.sin(phase.current) * (moving.current ? 0.52 : 0.05)
    if (leftLeg.current) leftLeg.current.rotation.x = swing
    if (rightLeg.current) rightLeg.current.rotation.x = -swing
    if (leftArm.current) leftArm.current.rotation.x = -swing * 0.55
    if (rightArm.current) rightArm.current.rotation.x = swing * 0.55
  })

  return (
    <group position={[0, -0.9, 0]}>
      <mesh castShadow position={[0, 0.78, 0]}>
        <boxGeometry args={[0.34, 0.18, 0.22]} />
        <meshStandardMaterial color="#1c2541" roughness={0.8} />
      </mesh>
      <mesh castShadow position={[0, 1.2, 0]}>
        <boxGeometry args={[0.42, 0.62, 0.24]} />
        <meshStandardMaterial color="#2f6f9f" roughness={0.72} />
      </mesh>
      <group ref={leftLeg} position={[-0.12, 0.74, 0]}>
        <mesh castShadow position={[0, -0.34, 0]}>
          <capsuleGeometry args={[0.065, 0.52, 4, 8]} />
          <meshStandardMaterial color="#17203a" roughness={0.84} />
        </mesh>
      </group>
      <group ref={rightLeg} position={[0.12, 0.74, 0]}>
        <mesh castShadow position={[0, -0.34, 0]}>
          <capsuleGeometry args={[0.065, 0.52, 4, 8]} />
          <meshStandardMaterial color="#17203a" roughness={0.84} />
        </mesh>
      </group>
      <group ref={leftArm} position={[-0.28, 1.34, 0]}>
        <mesh castShadow position={[0, -0.26, 0]}>
          <capsuleGeometry args={[0.055, 0.42, 4, 8]} />
          <meshStandardMaterial color="#d9a47f" roughness={0.68} />
        </mesh>
      </group>
      <group ref={rightArm} position={[0.28, 1.34, 0]}>
        <mesh castShadow position={[0, -0.26, 0]}>
          <capsuleGeometry args={[0.055, 0.42, 4, 8]} />
          <meshStandardMaterial color="#d9a47f" roughness={0.68} />
        </mesh>
      </group>
      <mesh castShadow position={[0, 1.72, 0]}>
        <sphereGeometry args={[0.2, 16, 12]} />
        <meshStandardMaterial color="#efc29a" roughness={0.64} />
      </mesh>
      <mesh castShadow position={[0, 1.88, -0.02]}>
        <sphereGeometry args={[0.205, 12, 8, 0, Math.PI * 2, 0, Math.PI * 0.55]} />
        <meshStandardMaterial color="#17100b" roughness={0.92} />
      </mesh>
    </group>
  )
}

export default function PlayerRig({ city }) {
  const keys = useKeys()
  const root = useRef()
  const heading = useRef(0)
  const camAz = useRef(0)
  const camEl = useRef(0.12)
  const velocityY = useRef(0)
  const grounded = useRef(false)
  const pos = useRef(new THREE.Vector3(0, terrainHeight(0, 40) + 2.2, 40))
  const moving = useRef(false)
  const running = useRef(false)
  const forward = useMemo(() => new THREE.Vector3(), [])
  const right = useMemo(() => new THREE.Vector3(), [])
  const move = useMemo(() => new THREE.Vector3(), [])
  const camTarget = useMemo(() => new THREE.Vector3(), [])
  const lookAt = useMemo(() => new THREE.Vector3(), [])

  useFrame((state, delta) => {
    const dt = Math.min(delta, 0.05)
    useCityStore.getState().tick(dt)

    const rotationSpeed = 1.85 * dt
    if (keys.current.ArrowLeft) camAz.current += rotationSpeed
    if (keys.current.ArrowRight) camAz.current -= rotationSpeed
    if (keys.current.ArrowUp) camEl.current = Math.min(1.18, camEl.current + rotationSpeed)
    if (keys.current.ArrowDown) camEl.current = Math.max(-0.04, camEl.current - rotationSpeed)

    forward.set(-Math.sin(camAz.current), 0, -Math.cos(camAz.current))
    right.set(Math.cos(camAz.current), 0, -Math.sin(camAz.current))
    move.set(0, 0, 0)
    if (keys.current.KeyW) move.add(forward)
    if (keys.current.KeyS) move.sub(forward)
    if (keys.current.KeyA) move.sub(right)
    if (keys.current.KeyD) move.add(right)

    running.current = !!(keys.current.ShiftLeft || keys.current.ShiftRight)
    moving.current = move.lengthSq() > 0.001

    if (moving.current) {
      move.normalize().multiplyScalar((running.current ? RUN_SPEED : WALK_SPEED) * dt)
      heading.current = Math.atan2(move.x, move.z)
    }

    velocityY.current -= GRAVITY * dt
    if (keys.current.Space && grounded.current) {
      velocityY.current = JUMP
      grounded.current = false
    }

    const nextX = pos.current.x + move.x
    const nextZ = pos.current.z + move.z
    const [safeX, safeZ] = resolveBuildingCollision(city, nextX, nextZ)
    const groundY = terrainHeight(safeX, safeZ) + 1.1
    let nextY = pos.current.y + velocityY.current * dt
    if (nextY <= groundY) {
      nextY = groundY
      velocityY.current = 0
      grounded.current = true
    }

    pos.current.set(safeX, nextY, safeZ)
    if (root.current) {
      root.current.position.copy(pos.current)
      root.current.rotation.y += Math.atan2(Math.sin(heading.current - root.current.rotation.y), Math.cos(heading.current - root.current.rotation.y)) * 0.22
    }

    const ce = Math.cos(camEl.current)
    camTarget.set(
      pos.current.x + CAMERA_DISTANCE * Math.sin(camAz.current) * ce,
      pos.current.y + CAMERA_HEIGHT + CAMERA_DISTANCE * Math.sin(camEl.current),
      pos.current.z + CAMERA_DISTANCE * Math.cos(camAz.current) * ce,
    )
    state.camera.position.lerp(camTarget, 0.12)
    lookAt.set(pos.current.x, pos.current.y + 1.2, pos.current.z)
    state.camera.lookAt(lookAt)

    const district = city.districtAt(pos.current.x, pos.current.z).name
    useCityStore.getState().setPlayer({
      x: pos.current.x,
      y: pos.current.y,
      z: pos.current.z,
      heading: camAz.current,
      speed: moving.current ? (running.current ? RUN_SPEED : WALK_SPEED) : 0,
      district,
    })
  })

  return (
    <group ref={root} position={pos.current.toArray()}>
      <Character moving={moving} running={running} />
    </group>
  )
}
