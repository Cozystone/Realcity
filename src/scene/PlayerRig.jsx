import { useEffect, useMemo, useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import * as THREE from 'three'
import { terrainHeight } from '../engine/cityEngine'
import { currentInterior, resolveBuildingCollision } from '../engine/collision'
import { useCityStore } from '../engine/cityStore'
import { sampleRoute, taxiPassengerDoorPoint } from '../engine/taxiRouting'
import { makeProceduralTexture } from './proceduralTextures'

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
const FLOOR_CHANGE_COOLDOWN = 0.42

function approach(current, target, speed, delta) {
  return current + (target - current) * (1 - Math.exp(-speed * delta))
}

function smoothstep(t) {
  return t * t * (3 - 2 * t)
}

function finiteNumber(value, fallback = 0) {
  const number = Number(value)
  return Number.isFinite(number) ? number : fallback
}

function finitePoint2(point) {
  return Number.isFinite(Number(point?.x)) && Number.isFinite(Number(point?.z))
}

function finiteRoute(points = []) {
  return points.filter(finitePoint2)
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
      if (['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'PageUp', 'PageDown'].includes(event.code)) event.preventDefault()
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

function vehicleLocal(sample, x, z) {
  const dx = x - sample.x
  const dz = z - sample.z
  const cos = Math.cos(sample.yaw || 0)
  const sin = Math.sin(sample.yaw || 0)
  return {
    x: dx * cos - dz * sin,
    z: dx * sin + dz * cos,
  }
}

function vehicleWorld(sample, localX, localZ) {
  const cos = Math.cos(sample.yaw || 0)
  const sin = Math.sin(sample.yaw || 0)
  return {
    x: sample.x + localX * cos + localZ * sin,
    z: sample.z - localX * sin + localZ * cos,
  }
}

function resolveCircleCollision(px, pz, sample, radius) {
  const dx = px - sample.x
  const dz = pz - sample.z
  const distance = Math.hypot(dx, dz)
  if (distance >= radius) return null
  const nx = distance > 0.001 ? dx / distance : 1
  const nz = distance > 0.001 ? dz / distance : 0
  return {
    x: sample.x + nx * radius,
    z: sample.z + nz * radius,
    penetration: radius - distance,
    nx,
    nz,
  }
}

function resolveVehicleCollision(px, pz, sample, playerRadius, padding) {
  const local = vehicleLocal(sample, px, pz)
  const halfW = (sample.width || 2.1) / 2 + playerRadius + padding * 0.42
  const halfL = (sample.length || 4.4) / 2 + playerRadius + padding * 0.34
  if (Math.abs(local.x) >= halfW || Math.abs(local.z) >= halfL) return null

  const pushX = halfW - Math.abs(local.x)
  const pushZ = halfL - Math.abs(local.z)
  const safeLocal = { ...local }
  if (pushX < pushZ) safeLocal.x = Math.sign(local.x || 1) * halfW
  else safeLocal.z = Math.sign(local.z || 1) * halfL
  const safe = vehicleWorld(sample, safeLocal.x, safeLocal.z)
  return {
    ...safe,
    penetration: Math.min(pushX, pushZ),
    nx: safe.x - px,
    nz: safe.z - pz,
  }
}

function emitCollisionOnce(cooldowns, key, cooldownMs, callback) {
  const now = performance.now()
  const last = cooldowns.get(key) || 0
  if (now - last < cooldownMs) return
  cooldowns.set(key, now)
  callback()
}

function indoorFloorInfo(place, floorIndex = 0) {
  if (!place) return null
  const directory = Array.isArray(place.floorDirectory) ? place.floorDirectory : []
  const entry = directory[Math.max(0, Math.min(directory.length - 1, floorIndex))]
  const level = floorIndex + 1
  const core = place.verticalCore === 'elevator'
    ? 'Elevator bank'
    : place.verticalCore === 'escalator'
      ? 'Escalator hall'
      : 'Stair core'
  return entry || {
    level,
    label: level === 1 ? 'Ground lobby' : `Floor ${level}`,
    zone: level === 1 ? 'lobby and entry hall' : 'upper floor rooms',
    access: place.publicAccess || 'building access',
    core,
    guide: `${core} connects to ${place.floorCount || 1} floors.`,
  }
}

function resolveDynamicCollision(store, previousX, previousZ, x, z, isRunning, cooldowns) {
  let px = x
  let pz = z
  const rules = store.collisionRules || {}
  const playerRadius = rules.playerRadius || 0.72
  const pedestrianRadius = playerRadius + (rules.pedestrianRadius || 0.82)
  const vehiclePadding = rules.vehiclePadding || 0.78
  const movement = Math.hypot(x - previousX, z - previousZ)

  for (const pedestrian of store.pedestrianSamples || []) {
    if (!pedestrian?.id) continue
    const radius = playerRadius + (pedestrian.radius || 0.82)
    const result = resolveCircleCollision(px, pz, pedestrian, Math.max(radius, pedestrianRadius))
    if (!result) continue
    px = result.x
    pz = result.z
    const impulse = Math.min(1.6, (isRunning ? 1.05 : 0.58) + movement * 5 + result.penetration * 0.7)
    emitCollisionOnce(cooldowns, `npc:${pedestrian.id}`, 520, () => {
      window.dispatchEvent(new CustomEvent('realcity:player-hit-npc', {
        detail: {
          id: pedestrian.id,
          playerX: previousX,
          playerZ: previousZ,
          x: px,
          z: pz,
          impulse,
        },
      }))
    })
  }

  const missionTaxi = store.mission?.taxi?.pose && !store.ride
    ? [{
        id: store.mission.taxi.id || 'mission-taxi',
        kind: 'taxi',
        x: store.mission.taxi.pose.x,
        z: store.mission.taxi.pose.z,
        yaw: store.mission.taxi.pose.heading ?? store.mission.taxi.pose.yaw ?? 0,
        width: 2.22,
        length: 4.75,
      }]
    : []

  for (const vehicle of [...(store.vehicleSamples || []), ...missionTaxi]) {
    if (!vehicle?.id) continue
    const result = resolveVehicleCollision(px, pz, vehicle, playerRadius, vehiclePadding)
    if (!result) continue
    px = result.x
    pz = result.z
    emitCollisionOnce(cooldowns, `vehicle:${vehicle.id}`, 900, () => {
      store.setPulse(`${vehicle.kind === 'taxi' ? 'The taxi' : 'The car'} brakes and you are pushed clear of its body.`)
    })
  }

  return [px, pz]
}

function Character({ moving, running }) {
  const leftLeg = useRef()
  const rightLeg = useRef()
  const leftArm = useRef()
  const rightArm = useRef()
  const phase = useRef(0)
  const textures = useMemo(() => ({
    fabric: makeProceduralTexture('city-fabric', { size: 128, seed: 31, repeatX: 2, repeatY: 2 }),
    skin: makeProceduralTexture('skin-pores', { size: 128, seed: 32, repeatX: 1.5, repeatY: 1.5 }),
    hair: makeProceduralTexture('hair-strands', { size: 128, seed: 33, repeatX: 2.4, repeatY: 1.2 }),
    rubber: makeProceduralTexture('rubber-tread', { size: 128, seed: 34, repeatX: 2, repeatY: 2 }),
    glass: makeProceduralTexture('glass-smudge', { size: 128, seed: 35, repeatX: 1.2, repeatY: 1.2 }),
  }), [])

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
        <meshStandardMaterial map={textures.fabric} color="#1c2541" roughness={0.8} />
      </mesh>
      <mesh castShadow position={[0, 1.2, 0]}>
        <capsuleGeometry args={[0.21, 0.52, 4, 10]} />
        <meshStandardMaterial map={textures.fabric} color="#2f6f9f" roughness={0.72} />
      </mesh>
      <mesh castShadow position={[0, 1.27, 0.18]}>
        <boxGeometry args={[0.28, 0.34, 0.035]} />
        <meshStandardMaterial map={textures.glass} color="#e8f1f4" roughness={0.58} metalness={0.02} />
      </mesh>
      <mesh castShadow position={[0, 1.5, 0.205]}>
        <boxGeometry args={[0.18, 0.035, 0.018]} />
        <meshStandardMaterial map={textures.fabric} color="#f2eadc" roughness={0.7} />
      </mesh>
      <mesh castShadow position={[-0.08, 1.31, 0.212]} rotation={[0, 0, -0.18]}>
        <boxGeometry args={[0.04, 0.23, 0.016]} />
        <meshStandardMaterial map={textures.fabric} color="#d5e3ed" roughness={0.72} />
      </mesh>
      <mesh castShadow position={[0.08, 1.31, 0.212]} rotation={[0, 0, 0.18]}>
        <boxGeometry args={[0.04, 0.23, 0.016]} />
        <meshStandardMaterial map={textures.fabric} color="#d5e3ed" roughness={0.72} />
      </mesh>
      <mesh castShadow position={[0.12, 1.38, 0.224]}>
        <boxGeometry args={[0.035, 0.048, 0.012]} />
        <meshStandardMaterial color="#c59b53" roughness={0.32} metalness={0.35} />
      </mesh>
      <mesh castShadow position={[0, 1.57, 0]}>
        <capsuleGeometry args={[0.075, 0.12, 4, 8]} />
        <meshStandardMaterial map={textures.skin} color="#d9a47f" roughness={0.66} />
      </mesh>
      <group ref={leftLeg} position={[-0.12, 0.74, 0]}>
        <mesh castShadow position={[0, -0.34, 0]}>
          <capsuleGeometry args={[0.065, 0.52, 4, 8]} />
          <meshStandardMaterial map={textures.fabric} color="#17203a" roughness={0.84} />
        </mesh>
        <mesh castShadow position={[0, -0.58, 0.045]}>
          <boxGeometry args={[0.08, 0.03, 0.08]} />
          <meshStandardMaterial map={textures.fabric} color="#0d1118" roughness={0.86} />
        </mesh>
        <mesh castShadow position={[0, -0.67, 0.045]}>
          <boxGeometry args={[0.11, 0.06, 0.18]} />
          <meshStandardMaterial map={textures.rubber} color="#0d1118" roughness={0.85} />
        </mesh>
      </group>
      <group ref={rightLeg} position={[0.12, 0.74, 0]}>
        <mesh castShadow position={[0, -0.34, 0]}>
          <capsuleGeometry args={[0.065, 0.52, 4, 8]} />
          <meshStandardMaterial map={textures.fabric} color="#17203a" roughness={0.84} />
        </mesh>
        <mesh castShadow position={[0, -0.58, 0.045]}>
          <boxGeometry args={[0.08, 0.03, 0.08]} />
          <meshStandardMaterial map={textures.fabric} color="#0d1118" roughness={0.86} />
        </mesh>
        <mesh castShadow position={[0, -0.67, 0.045]}>
          <boxGeometry args={[0.11, 0.06, 0.18]} />
          <meshStandardMaterial map={textures.rubber} color="#0d1118" roughness={0.85} />
        </mesh>
      </group>
      <group ref={leftArm} position={[-0.28, 1.34, 0]}>
        <mesh castShadow position={[0, -0.26, 0]}>
          <capsuleGeometry args={[0.055, 0.42, 4, 8]} />
          <meshStandardMaterial map={textures.skin} color="#d9a47f" roughness={0.68} />
        </mesh>
        <mesh castShadow position={[0, -0.51, 0.015]}>
          <sphereGeometry args={[0.065, 10, 8]} />
          <meshStandardMaterial map={textures.skin} color="#d9a47f" roughness={0.68} />
        </mesh>
      </group>
      <group ref={rightArm} position={[0.28, 1.34, 0]}>
        <mesh castShadow position={[0, -0.26, 0]}>
          <capsuleGeometry args={[0.055, 0.42, 4, 8]} />
          <meshStandardMaterial map={textures.skin} color="#d9a47f" roughness={0.68} />
        </mesh>
        <mesh castShadow position={[0, -0.51, 0.015]}>
          <sphereGeometry args={[0.065, 10, 8]} />
          <meshStandardMaterial map={textures.skin} color="#d9a47f" roughness={0.68} />
        </mesh>
      </group>
      <mesh castShadow position={[0, 1.72, 0]}>
        <sphereGeometry args={[0.205, 18, 14]} />
        <meshStandardMaterial map={textures.skin} color="#efc29a" roughness={0.64} />
      </mesh>
      <mesh castShadow position={[-0.088, 1.745, 0.188]}>
        <sphereGeometry args={[0.022, 8, 6]} />
        <meshStandardMaterial color="#05070a" roughness={0.34} />
      </mesh>
      <mesh castShadow position={[0.088, 1.745, 0.188]}>
        <sphereGeometry args={[0.022, 8, 6]} />
        <meshStandardMaterial color="#05070a" roughness={0.34} />
      </mesh>
      <mesh castShadow position={[-0.088, 1.785, 0.202]} rotation={[0, 0, -0.08]}>
        <boxGeometry args={[0.06, 0.01, 0.012]} />
        <meshStandardMaterial map={textures.hair} color="#17100b" roughness={0.9} />
      </mesh>
      <mesh castShadow position={[0.088, 1.785, 0.202]} rotation={[0, 0, 0.08]}>
        <boxGeometry args={[0.06, 0.01, 0.012]} />
        <meshStandardMaterial map={textures.hair} color="#17100b" roughness={0.9} />
      </mesh>
      <mesh castShadow position={[0, 1.69, 0.215]}>
        <boxGeometry args={[0.035, 0.055, 0.035]} />
        <meshStandardMaterial map={textures.skin} color="#c98f70" roughness={0.68} />
      </mesh>
      <mesh castShadow position={[-0.07, 1.67, 0.218]}>
        <sphereGeometry args={[0.028, 8, 6]} />
        <meshStandardMaterial map={textures.skin} color="#e2ad89" roughness={0.72} />
      </mesh>
      <mesh castShadow position={[0.07, 1.67, 0.218]}>
        <sphereGeometry args={[0.028, 8, 6]} />
        <meshStandardMaterial map={textures.skin} color="#e2ad89" roughness={0.72} />
      </mesh>
      <mesh castShadow position={[0, 1.625, 0.202]}>
        <boxGeometry args={[0.09, 0.012, 0.014]} />
        <meshStandardMaterial color="#78323a" roughness={0.7} />
      </mesh>
      <mesh castShadow position={[-0.215, 1.705, 0]}>
        <sphereGeometry args={[0.035, 8, 6]} />
        <meshStandardMaterial map={textures.skin} color="#d9a47f" roughness={0.68} />
      </mesh>
      <mesh castShadow position={[0.215, 1.705, 0]}>
        <sphereGeometry args={[0.035, 8, 6]} />
        <meshStandardMaterial map={textures.skin} color="#d9a47f" roughness={0.68} />
      </mesh>
      <mesh castShadow position={[0, 1.88, -0.02]}>
        <sphereGeometry args={[0.205, 12, 8, 0, Math.PI * 2, 0, Math.PI * 0.55]} />
        <meshStandardMaterial map={textures.hair} color="#17100b" roughness={0.92} />
      </mesh>
      <mesh castShadow position={[0, 1.72, -0.145]}>
        <boxGeometry args={[0.34, 0.22, 0.08]} />
        <meshStandardMaterial map={textures.hair} color="#17100b" roughness={0.92} />
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
  const floorLevel = useRef(0)
  const floorCooldown = useRef(0)
  const collisionCooldowns = useRef(new Map())

  useEffect(() => {
    if (!import.meta.env.DEV || typeof window === 'undefined') return undefined

    const debugPlace = (detail = {}) => {
      const x = Number(detail.x)
      const z = Number(detail.z)
      if (!Number.isFinite(x) || !Number.isFinite(z)) return false

      const place = currentInterior(city, x, z)
      const floorCount = place?.floorCount || 1
      const requestedFloor = Number.isFinite(Number(detail.floor)) ? Math.floor(Number(detail.floor)) : 0
      const nextFloor = place ? Math.max(0, Math.min(floorCount - 1, requestedFloor)) : 0
      const baseY = terrainHeight(x, z) + 1.1
      const y = Number.isFinite(Number(detail.y))
        ? Number(detail.y)
        : baseY + nextFloor * (place?.floorHeight || 3.6)

      floorLevel.current = nextFloor
      floorCooldown.current = 0
      heading.current = Number.isFinite(Number(detail.heading)) ? Number(detail.heading) : heading.current
      lookYaw.current = Number.isFinite(Number(detail.lookYaw)) ? Number(detail.lookYaw) : 0
      lookPitch.current = Number.isFinite(Number(detail.lookPitch)) ? Number(detail.lookPitch) : 0
      velocityY.current = 0
      grounded.current = true
      moving.current = false
      running.current = false
      lastPlace.current = null
      pos.current.set(x, y, z)
      if (root.current) {
        root.current.position.copy(pos.current)
        root.current.rotation.y = heading.current
      }
      if (typeof detail.pulse === 'string' && detail.pulse.trim()) {
        useCityStore.getState().setPulse(detail.pulse.trim())
      }
      return true
    }

    const onDebugPlace = event => debugPlace(event.detail || {})
    window.__REALCITY_PLAYER_RIG__ = { debugPlace }
    window.addEventListener('realcity:debug-place-player', onDebugPlace)
    return () => {
      window.removeEventListener('realcity:debug-place-player', onDebugPlace)
      if (window.__REALCITY_PLAYER_RIG__?.debugPlace === debugPlace) delete window.__REALCITY_PLAYER_RIG__
    }
  }, [city])

  useFrame((state, delta) => {
    const dt = Math.min(delta, 0.12)
    const store = useCityStore.getState()
    store.tick(dt)
    const ride = store.ride
    if (!Number.isFinite(pos.current.x) || !Number.isFinite(pos.current.y) || !Number.isFinite(pos.current.z)) {
      pos.current.set(0, terrainHeight(0, 40) + 1.1, 40)
      heading.current = Math.PI
      velocityY.current = 0
      store.setPulse('Recovered camera position after invalid movement data.')
    }

    if (ride) {
      floorLevel.current = 0
      const startedAt = finiteNumber(ride.startedAt, performance.now())
      const duration = Math.max(0.5, finiteNumber(ride.duration, 6))
      const t = Math.min(1, Math.max(0, (performance.now() - startedAt) / (duration * 1000)))
      if (ride.path?.length >= 2) {
        const path = finiteRoute(ride.path)
        const routeMeters = Math.max(1, finiteNumber(ride.routeMeters, 1))
        if (path.length < 2) {
          store.finishRide('Taxi ride stopped because route data was invalid.')
          return
        }
        const distance = routeMeters * t
        const pose = sampleRoute(path, distance)
        if (!finitePoint2(pose)) {
          store.finishRide('Taxi ride stopped because route position was invalid.')
          return
        }
        heading.current = finiteNumber(pose.heading, heading.current)
        pos.current.set(pose.x, terrainHeight(pose.x, pose.z) + 1.1, pose.z)
        ride.taxiPose = { x: pose.x, z: pose.z, heading: heading.current, yaw: heading.current }
        ride.progress = t
        moving.current = true
        running.current = false
        grounded.current = true
        velocityY.current = 0
        if (t >= 1) {
          if (finitePoint2(ride.exitPoint)) {
            pos.current.set(ride.exitPoint.x, terrainHeight(ride.exitPoint.x, ride.exitPoint.z) + 1.1, ride.exitPoint.z)
          }
          store.finishRide(`Arrived at ${ride.destinationName || 'destination'}.`)
        }
      } else {
        if (!finitePoint2(ride.from) || !finitePoint2(ride.to)) {
          store.finishRide('Taxi ride stopped because endpoints were invalid.')
          return
        }
        const eased = smoothstep(t)
        const x = ride.from.x + (ride.to.x - ride.from.x) * eased
        const z = ride.from.z + (ride.to.z - ride.from.z) * eased
        heading.current = finiteNumber(Math.atan2(ride.to.x - ride.from.x, ride.to.z - ride.from.z), heading.current)
        pos.current.set(x, terrainHeight(x, z) + 1.1, z)
        moving.current = true
        running.current = false
        grounded.current = true
        velocityY.current = 0
        if (t >= 1) {
          if (finitePoint2(ride.exitPoint)) {
            pos.current.set(ride.exitPoint.x, terrainHeight(ride.exitPoint.x, ride.exitPoint.z) + 1.1, ride.exitPoint.z)
          }
          store.finishRide(`Arrived at ${ride.destinationName || 'destination'}.`)
        }
      }
    } else if (store.mission?.mode === 'taxi' && store.mission.phase === 'taxi_boarding' && store.mission.taxi?.pose) {
      const mission = store.mission
      const taxi = mission.taxi
      const startedAt = mission.boardingStartedAt || performance.now()
      const t = smoothstep(Math.min(1, Math.max(0, (performance.now() - startedAt) / 1450)))
      const start = mission.boardingPlayerStart || { x: pos.current.x, z: pos.current.z }
      const door = taxiPassengerDoorPoint(taxi, 'player')
      const x = start.x + (door.x - start.x) * t
      const z = start.z + (door.z - start.z) * t
      heading.current = taxi.pose.heading ?? door.heading ?? heading.current
      pos.current.set(x, terrainHeight(x, z) + 1.1, z)
      moving.current = t < 0.98
      running.current = false
      grounded.current = true
      velocityY.current = 0
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
      let [safeX, safeZ] = resolveBuildingCollision(city, pos.current.x, pos.current.z, nextX, nextZ)
      ;[safeX, safeZ] = resolveDynamicCollision(store, pos.current.x, pos.current.z, safeX, safeZ, running.current, collisionCooldowns.current)
      const placeAtNext = currentInterior(city, safeX, safeZ)
      const floorOffset = placeAtNext ? floorLevel.current * (placeAtNext.floorHeight || 3.6) : 0
      const groundY = terrainHeight(safeX, safeZ) + 1.1 + floorOffset
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
    if (!Number.isFinite(camTarget.x) || !Number.isFinite(camTarget.y) || !Number.isFinite(camTarget.z)) {
      camTarget.set(pos.current.x, pos.current.y + CAMERA_HEIGHT + 2, pos.current.z + CAMERA_DISTANCE)
    }
    state.camera.position.lerp(camTarget, 0.12)
    lookAt.set(pos.current.x, pos.current.y + 1.2, pos.current.z)
    if (!Number.isFinite(lookAt.x) || !Number.isFinite(lookAt.y) || !Number.isFinite(lookAt.z)) {
      lookAt.set(0, terrainHeight(0, 40) + 2.3, 40)
    }
    state.camera.lookAt(lookAt)

    const district = city.districtAt(pos.current.x, pos.current.z).name
    const place = currentInterior(city, pos.current.x, pos.current.z)
    const storeNow = useCityStore.getState()
    if ((place?.id || null) !== lastPlace.current) {
      lastPlace.current = place?.id || null
      floorLevel.current = 0
      if (place) {
        const info = indoorFloorInfo(place, 0)
        storeNow.setPulse(`You entered ${place.name}. ${info.label}: ${info.zone}. ${info.core} is visible from the lobby.`)
      }
    }
    floorCooldown.current = Math.max(0, floorCooldown.current - dt)
    if (!place) {
      floorLevel.current = 0
    } else if ((place.floorCount || 1) > 1 && floorCooldown.current <= 0) {
      const floorDelta = (keys.current.PageUp || keys.current.KeyR ? 1 : 0) - (keys.current.PageDown || keys.current.KeyF ? 1 : 0)
      if (floorDelta) {
        const nextFloor = Math.max(0, Math.min((place.floorCount || 1) - 1, floorLevel.current + floorDelta))
        if (nextFloor !== floorLevel.current) {
          floorLevel.current = nextFloor
          floorCooldown.current = FLOOR_CHANGE_COOLDOWN
          velocityY.current = 0
          grounded.current = true
          pos.current.y = terrainHeight(pos.current.x, pos.current.z) + 1.1 + floorLevel.current * (place.floorHeight || 3.6)
          const info = indoorFloorInfo(place, floorLevel.current)
          storeNow.setPulse(`${info.core} to ${info.label} in ${place.name}: ${info.zone}.`)
        }
      }
    }
    const floorInfo = indoorFloorInfo(place, floorLevel.current)
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
      floor: place ? floorLevel.current + 1 : 0,
      floorCount: place?.floorCount || 0,
      verticalCore: place?.verticalCore || null,
      floorLabel: floorInfo?.label || null,
      floorZone: floorInfo?.zone || null,
      accessHint: floorInfo?.access || null,
      coreHint: floorInfo?.core || null,
    })
  })

  return (
    <group ref={root} position={pos.current.toArray()}>
      <Character moving={moving} running={running} />
    </group>
  )
}
