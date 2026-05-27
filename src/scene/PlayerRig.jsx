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
const CAMERA_BASE_ELEVATION = 0.12
const TURN_SPEED = 2.35
const FREE_LOOK_YAW = 1.18
const FREE_LOOK_PITCH_UP = 0.72
const FREE_LOOK_PITCH_DOWN = -0.22
const FREE_LOOK_IN_SPEED = 8.5
const FREE_LOOK_RETURN_SPEED = 16.5

function approach(current, target, speed, delta) {
  return current + (target - current) * (1 - Math.exp(-speed * delta))
}

function smoothstep(t) {
  return t * t * (3 - 2 * t)
}

function isTypingTarget(target) {
  return !!target?.closest?.('input, textarea, select, button')
}

function useKeys() {
  const keys = useRef({})

  useEffect(() => {
    const down = (event) => {
      if (isTypingTarget(event.target)) return
      keys.current[event.code] = true
      if (['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(event.code)) event.preventDefault()
    }
    const up = (event) => {
      keys.current[event.code] = false
    }
    const clear = () => {
      keys.current = {}
    }
    window.addEventListener('keydown', down, { passive: false })
    window.addEventListener('keyup', up)
    window.addEventListener('blur', clear)
    return () => {
      window.removeEventListener('keydown', down)
      window.removeEventListener('keyup', up)
      window.removeEventListener('blur', clear)
    }
  }, [])

  return keys
}

function pushOutOfBox(px, pz, cx, cz, hw, hd) {
  const dx = px - cx
  const dz = pz - cz
  const pushX = hw - Math.abs(dx)
  const pushZ = hd - Math.abs(dz)
  if (pushX < pushZ) return [cx + Math.sign(dx || 1) * hw, pz]
  return [px, cz + Math.sign(dz || 1) * hd]
}

function resolveLandmarkCollision(city, previousX, previousZ, nextX, nextZ) {
  let px = nextX
  let pz = nextZ
  const radius = 0.72

  for (const place of city.landmarks) {
    const interior = place.interior
    if (!interior?.solidWalls) continue

    const hw = interior.width / 2 + radius
    const hd = interior.depth / 2 + radius
    const prev = { x: previousX - place.x, z: previousZ - place.z }
    const next = { x: px - place.x, z: pz - place.z }
    const prevInside = Math.abs(prev.x) < hw && Math.abs(prev.z) < hd
    const nextInside = Math.abs(next.x) < hw && Math.abs(next.z) < hd
    if (!prevInside && !nextInside) continue

    const doorHalf = interior.doorWidth / 2
    const atFrontDoor = Math.abs(next.x) < doorHalf && next.z <= -interior.depth / 2 + 2.4

    if (!prevInside && nextInside && !atFrontDoor) {
      ;[px, pz] = pushOutOfBox(px, pz, place.x, place.z, hw, hd)
      continue
    }

    if (prevInside && !nextInside) {
      const exitsThroughDoor = Math.abs(prev.x) < doorHalf && next.z < -interior.depth / 2 + 2.4
      if (!exitsThroughDoor) {
        px = Math.max(place.x - hw + radius, Math.min(place.x + hw - radius, px))
        pz = Math.max(place.z - hd + radius, Math.min(place.z + hd - radius, pz))
      }
    }
  }

  return [px, pz]
}

function currentInterior(city, x, z) {
  for (const place of city.landmarks) {
    const interior = place.interior
    if (!interior) continue
    const localX = x - place.x
    const localZ = z - place.z
    if (Math.abs(localX) < interior.width / 2 && Math.abs(localZ) < interior.depth / 2) {
      return {
        id: place.id,
        name: place.name,
        kind: place.kind,
        verticalCore: interior.verticalCore,
      }
    }
  }
  return null
}

function resolveBuildingCollision(city, previousX, previousZ, x, z) {
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
      ;[px, pz] = pushOutOfBox(px, pz, building.x, building.z, hw, hd)
    }
  }

  ;[px, pz] = resolveLandmarkCollision(city, previousX, previousZ, px, pz)

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
        <boxGeometry args={[0.38, 0.2, 0.25]} />
        <meshStandardMaterial color="#1c2541" roughness={0.8} />
      </mesh>
      <mesh castShadow position={[0, 1.2, 0]}>
        <capsuleGeometry args={[0.21, 0.52, 4, 10]} />
        <meshStandardMaterial color="#2f6f9f" roughness={0.72} />
      </mesh>
      <mesh castShadow position={[0, 1.27, 0.18]}>
        <boxGeometry args={[0.28, 0.34, 0.035]} />
        <meshStandardMaterial color="#e8f1f4" roughness={0.58} metalness={0.02} />
      </mesh>
      <mesh castShadow position={[0, 1.57, 0]}>
        <capsuleGeometry args={[0.075, 0.12, 4, 8]} />
        <meshStandardMaterial color="#d9a47f" roughness={0.66} />
      </mesh>
      <group ref={leftLeg} position={[-0.12, 0.74, 0]}>
        <mesh castShadow position={[0, -0.34, 0]}>
          <capsuleGeometry args={[0.065, 0.52, 4, 8]} />
          <meshStandardMaterial color="#17203a" roughness={0.84} />
        </mesh>
        <mesh castShadow position={[0, -0.67, 0.045]}>
          <boxGeometry args={[0.11, 0.06, 0.18]} />
          <meshStandardMaterial color="#0d1118" roughness={0.85} />
        </mesh>
      </group>
      <group ref={rightLeg} position={[0.12, 0.74, 0]}>
        <mesh castShadow position={[0, -0.34, 0]}>
          <capsuleGeometry args={[0.065, 0.52, 4, 8]} />
          <meshStandardMaterial color="#17203a" roughness={0.84} />
        </mesh>
        <mesh castShadow position={[0, -0.67, 0.045]}>
          <boxGeometry args={[0.11, 0.06, 0.18]} />
          <meshStandardMaterial color="#0d1118" roughness={0.85} />
        </mesh>
      </group>
      <group ref={leftArm} position={[-0.28, 1.34, 0]}>
        <mesh castShadow position={[0, -0.26, 0]}>
          <capsuleGeometry args={[0.055, 0.42, 4, 8]} />
          <meshStandardMaterial color="#d9a47f" roughness={0.68} />
        </mesh>
        <mesh castShadow position={[0, -0.51, 0.015]}>
          <sphereGeometry args={[0.065, 10, 8]} />
          <meshStandardMaterial color="#d9a47f" roughness={0.68} />
        </mesh>
      </group>
      <group ref={rightArm} position={[0.28, 1.34, 0]}>
        <mesh castShadow position={[0, -0.26, 0]}>
          <capsuleGeometry args={[0.055, 0.42, 4, 8]} />
          <meshStandardMaterial color="#d9a47f" roughness={0.68} />
        </mesh>
        <mesh castShadow position={[0, -0.51, 0.015]}>
          <sphereGeometry args={[0.065, 10, 8]} />
          <meshStandardMaterial color="#d9a47f" roughness={0.68} />
        </mesh>
      </group>
      <mesh castShadow position={[0, 1.72, 0]}>
        <sphereGeometry args={[0.205, 18, 14]} />
        <meshStandardMaterial color="#efc29a" roughness={0.64} />
      </mesh>
      <mesh castShadow position={[-0.088, 1.745, 0.188]}>
        <sphereGeometry args={[0.022, 8, 6]} />
        <meshStandardMaterial color="#05070a" roughness={0.34} />
      </mesh>
      <mesh castShadow position={[0.088, 1.745, 0.188]}>
        <sphereGeometry args={[0.022, 8, 6]} />
        <meshStandardMaterial color="#05070a" roughness={0.34} />
      </mesh>
      <mesh castShadow position={[0, 1.69, 0.215]}>
        <boxGeometry args={[0.035, 0.055, 0.035]} />
        <meshStandardMaterial color="#c98f70" roughness={0.68} />
      </mesh>
      <mesh castShadow position={[0, 1.625, 0.202]}>
        <boxGeometry args={[0.09, 0.012, 0.014]} />
        <meshStandardMaterial color="#78323a" roughness={0.7} />
      </mesh>
      <mesh castShadow position={[-0.215, 1.705, 0]}>
        <sphereGeometry args={[0.035, 8, 6]} />
        <meshStandardMaterial color="#d9a47f" roughness={0.68} />
      </mesh>
      <mesh castShadow position={[0.215, 1.705, 0]}>
        <sphereGeometry args={[0.035, 8, 6]} />
        <meshStandardMaterial color="#d9a47f" roughness={0.68} />
      </mesh>
      <mesh castShadow position={[0, 1.88, -0.02]}>
        <sphereGeometry args={[0.205, 12, 8, 0, Math.PI * 2, 0, Math.PI * 0.55]} />
        <meshStandardMaterial color="#17100b" roughness={0.92} />
      </mesh>
      <mesh castShadow position={[0, 1.72, -0.145]}>
        <boxGeometry args={[0.34, 0.22, 0.08]} />
        <meshStandardMaterial color="#17100b" roughness={0.92} />
      </mesh>
    </group>
  )
}

export default function PlayerRig({ city }) {
  const keys = useKeys()
  const root = useRef()
  const heading = useRef(Math.PI)
  const lookYaw = useRef(0)
  const lookPitch = useRef(0)
  const velocityY = useRef(0)
  const grounded = useRef(false)
  const pos = useRef(new THREE.Vector3(0, terrainHeight(0, 40) + 2.2, 40))
  const moving = useRef(false)
  const running = useRef(false)
  const move = useMemo(() => new THREE.Vector3(), [])
  const camTarget = useMemo(() => new THREE.Vector3(), [])
  const lookAt = useMemo(() => new THREE.Vector3(), [])
  const lastPlace = useRef(null)

  useFrame((state, delta) => {
    const dt = Math.min(delta, 0.05)
    const store = useCityStore.getState()
    store.tick(dt)
    const ride = store.ride

    if (ride) {
      const t = Math.min(1, (performance.now() - ride.startedAt) / (ride.duration * 1000))
      const eased = smoothstep(t)
      const x = ride.from.x + (ride.to.x - ride.from.x) * eased
      const z = ride.from.z + (ride.to.z - ride.from.z) * eased
      heading.current = Math.atan2(ride.to.x - ride.from.x, ride.to.z - ride.from.z)
      pos.current.set(x, terrainHeight(x, z) + 1.1, z)
      moving.current = true
      running.current = false
      grounded.current = true
      velocityY.current = 0
      if (t >= 1) store.finishRide(`Arrived at ${ride.destinationName || 'destination'}.`)
    } else {
      if (keys.current.KeyA) heading.current += TURN_SPEED * dt
      if (keys.current.KeyD) heading.current -= TURN_SPEED * dt

      const targetLookYaw = keys.current.ArrowLeft
        ? FREE_LOOK_YAW
        : keys.current.ArrowRight
          ? -FREE_LOOK_YAW
          : 0
      const targetLookPitch = keys.current.ArrowUp
        ? FREE_LOOK_PITCH_UP
        : keys.current.ArrowDown
          ? FREE_LOOK_PITCH_DOWN
          : 0
      const lookSpeed = targetLookYaw || targetLookPitch ? FREE_LOOK_IN_SPEED : FREE_LOOK_RETURN_SPEED
      lookYaw.current = approach(lookYaw.current, targetLookYaw, lookSpeed, dt)
      lookPitch.current = approach(lookPitch.current, targetLookPitch, lookSpeed, dt)

      // Vehicle-style keyboard control: WASD drives the body's heading; arrows are temporary free-look only.
      const forwardX = Math.sin(heading.current)
      const forwardZ = Math.cos(heading.current)
      const throttle = (keys.current.KeyW ? 1 : 0) - (keys.current.KeyS ? 1 : 0)
      move.set(0, 0, 0)

      running.current = !!(keys.current.ShiftLeft || keys.current.ShiftRight)
      moving.current = Math.abs(throttle) > 0.001

      if (moving.current) {
        const distance = throttle * (running.current ? RUN_SPEED : WALK_SPEED) * dt
        move.set(forwardX * distance, 0, forwardZ * distance)
      }

      velocityY.current -= GRAVITY * dt
      if (keys.current.Space && grounded.current) {
        velocityY.current = JUMP
        grounded.current = false
      }

      const nextX = pos.current.x + move.x
      const nextZ = pos.current.z + move.z
      const [safeX, safeZ] = resolveBuildingCollision(city, pos.current.x, pos.current.z, nextX, nextZ)
      const groundY = terrainHeight(safeX, safeZ) + 1.1
      let nextY = pos.current.y + velocityY.current * dt
      if (nextY <= groundY) {
        nextY = groundY
        velocityY.current = 0
        grounded.current = true
      }

      pos.current.set(safeX, nextY, safeZ)
    }

    if (root.current) {
      root.current.position.copy(pos.current)
      root.current.rotation.y += Math.atan2(Math.sin(heading.current - root.current.rotation.y), Math.cos(heading.current - root.current.rotation.y)) * 0.22
    }

    const viewHeading = heading.current + lookYaw.current
    const cameraOrbit = viewHeading + Math.PI
    const cameraElevation = CAMERA_BASE_ELEVATION + lookPitch.current
    const ce = Math.cos(cameraElevation)
    camTarget.set(
      pos.current.x + CAMERA_DISTANCE * Math.sin(cameraOrbit) * ce,
      pos.current.y + CAMERA_HEIGHT + CAMERA_DISTANCE * Math.sin(cameraElevation),
      pos.current.z + CAMERA_DISTANCE * Math.cos(cameraOrbit) * ce,
    )
    state.camera.position.lerp(camTarget, 0.12)
    lookAt.set(pos.current.x, pos.current.y + 1.2, pos.current.z)
    state.camera.lookAt(lookAt)

    const district = city.districtAt(pos.current.x, pos.current.z).name
    const place = currentInterior(city, pos.current.x, pos.current.z)
    const storeNow = useCityStore.getState()
    if ((place?.id || null) !== lastPlace.current) {
      lastPlace.current = place?.id || null
      if (place) {
        storeNow.setPulse(`You entered ${place.name}. ${place.verticalCore === 'elevator' ? 'Elevators' : place.verticalCore === 'escalator' ? 'Escalators' : 'Stairs'} are visible from the lobby.`)
      }
    }
    storeNow.setPlayer({
      x: pos.current.x,
      y: pos.current.y,
      z: pos.current.z,
      heading: heading.current,
      viewHeading,
      speed: moving.current ? (running.current ? RUN_SPEED : WALK_SPEED) : 0,
      district,
      placeId: place?.id || null,
      placeName: place?.name || null,
      indoors: !!place,
    })
  })

  return (
    <group ref={root} position={pos.current.toArray()}>
      <Character moving={moving} running={running} />
    </group>
  )
}
