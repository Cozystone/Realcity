import { useRef, useEffect } from 'react'
import { useFrame } from '@react-three/fiber'
import { RigidBody, CapsuleCollider, useRapier } from '@react-three/rapier'
import * as THREE from 'three'
import { useKeyboard } from '../hooks/useKeyboard'

const WALK_SPEED = 6
const RUN_SPEED = 14
const JUMP_VEL = 9
const CAMERA_DIST = 15
const CAMERA_HEIGHT = 3.5

const _forward = new THREE.Vector3()
const _right   = new THREE.Vector3()
const _move    = new THREE.Vector3()
const _camTarget = new THREE.Vector3()
const _lookAt  = new THREE.Vector3()

export default function Player() {
  const rb = useRef()
  const keys = useKeyboard()
  const { world } = useRapier()

  const camAz  = useRef(0)
  const camEl  = useRef(0.28)
  const velY   = useRef(0)
  const lastJump = useRef(0)
  const grounded = useRef(true)
  const meshRef  = useRef()
  const ctrlRef  = useRef()

  // Game-time tracking for HUD
  const gameMinutes = useRef(12 * 60 + 45)

  useEffect(() => {
    const ctrl = world.createCharacterController(0.05)
    ctrl.enableAutostep(0.8, 0.3, true)
    ctrl.enableSnapToGround(0.5)
    ctrl.setSlideEnabled(true)
    ctrl.setMaxSlopeClimbAngle((46 * Math.PI) / 180)
    ctrl.setMinSlopeSlideAngle((25 * Math.PI) / 180)
    ctrlRef.current = ctrl
    return () => world.removeCharacterController(ctrl)
  }, [world])

  useFrame((state, delta) => {
    const body = rb.current
    if (!body || !ctrlRef.current) return

    const dt = Math.min(delta, 0.05)

    // Update game time (1 real second = 1 game minute)
    gameMinutes.current = (gameMinutes.current + dt) % (24 * 60)
    const gh = Math.floor(gameMinutes.current / 60)
    const gm = Math.floor(gameMinutes.current % 60)
    if (window.__updateGameTime) window.__updateGameTime(gh, gm)

    // Camera rotation
    const rotSpeed = 1.8 * dt
    if (keys.current.ArrowLeft)  camAz.current -= rotSpeed
    if (keys.current.ArrowRight) camAz.current += rotSpeed
    if (keys.current.ArrowUp)    camEl.current = Math.min(camEl.current + rotSpeed, 1.35)
    if (keys.current.ArrowDown)  camEl.current = Math.max(camEl.current - rotSpeed, -0.12)

    const pos = body.translation()

    // Movement
    const az = camAz.current
    _forward.set(-Math.sin(az), 0, -Math.cos(az))
    _right.set(Math.cos(az), 0, -Math.sin(az))
    _move.set(0, 0, 0)

    if (keys.current.KeyW) _move.addScaledVector(_forward,  1)
    if (keys.current.KeyS) _move.addScaledVector(_forward, -1)
    if (keys.current.KeyA) _move.addScaledVector(_right,   -1)
    if (keys.current.KeyD) _move.addScaledVector(_right,    1)

    const isRunning = keys.current.ShiftLeft || keys.current.ShiftRight
    const speed = isRunning ? RUN_SPEED : WALK_SPEED
    if (_move.length() > 0) _move.normalize().multiplyScalar(speed * dt)

    // Gravity
    velY.current -= 24 * dt
    if (velY.current < -32) velY.current = -32

    // Ground check via character controller
    if (ctrlRef.current.computedGrounded()) {
      grounded.current = true
      if (velY.current < 0) velY.current = -1
    } else {
      grounded.current = false
    }

    // Jump
    const now = state.clock.elapsedTime
    if (keys.current.Space && grounded.current && now - lastJump.current > 0.5) {
      velY.current = JUMP_VEL
      grounded.current = false
      lastJump.current = now
    }

    // Compute and apply movement
    const desired = { x: _move.x, y: velY.current * dt, z: _move.z }
    const collider = body.collider(0) ? world.getCollider(body.collider(0)) : null

    if (collider) {
      ctrlRef.current.computeColliderMovement(collider, desired)
      const c = ctrlRef.current.computedMovement()

      // If corrected y differs significantly from desired, reset velY
      if (Math.abs(c.y - desired.y) > 0.001 && desired.y < 0) velY.current = 0

      body.setNextKinematicTranslation({
        x: pos.x + c.x,
        y: pos.y + c.y,
        z: pos.z + c.z,
      })
    } else {
      body.setNextKinematicTranslation({
        x: pos.x + desired.x,
        y: pos.y + desired.y,
        z: pos.z + desired.z,
      })
    }

    // Rotate mesh toward movement direction
    if (meshRef.current && _move.length() > 0.001) {
      const targetYaw = Math.atan2(_move.x, _move.z)
      meshRef.current.rotation.y += (targetYaw - meshRef.current.rotation.y) * 0.15
    }

    // Camera follow
    const el  = camEl.current
    const cosEl = Math.cos(el)
    _camTarget.set(
      pos.x + CAMERA_DIST * Math.sin(az) * cosEl,
      pos.y + CAMERA_DIST * Math.sin(el) + CAMERA_HEIGHT,
      pos.z + CAMERA_DIST * Math.cos(az) * cosEl,
    )
    state.camera.position.lerp(_camTarget, 0.1)
    _lookAt.set(pos.x, pos.y + 1.6, pos.z)
    state.camera.lookAt(_lookAt)

    // Report to HUD
    if (window.__updateHUD) {
      window.__updateHUD(pos, camAz.current)
    }
  })

  return (
    <RigidBody
      ref={rb}
      type="kinematicPosition"
      colliders={false}
      position={[0, 60, 5]}
    >
      <CapsuleCollider args={[0.75, 0.4]} />
      <group ref={meshRef}>
        {/* Body */}
        <mesh castShadow>
          <capsuleGeometry args={[0.38, 1.5, 4, 8]} />
          <meshStandardMaterial color="#1a3a80" roughness={0.7} metalness={0.1} />
        </mesh>
        {/* Head */}
        <mesh castShadow position={[0, 1.15, 0]}>
          <sphereGeometry args={[0.28, 10, 10]} />
          <meshStandardMaterial color="#f0c888" roughness={0.6} />
        </mesh>
        {/* Backpack */}
        <mesh castShadow position={[0, 0.25, 0.3]}>
          <boxGeometry args={[0.5, 0.72, 0.26]} />
          <meshStandardMaterial color="#1a2a40" roughness={0.85} />
        </mesh>
        {/* Hair */}
        <mesh castShadow position={[0, 1.36, 0]}>
          <sphereGeometry args={[0.3, 8, 8]} />
          <meshStandardMaterial color="#1a1008" roughness={0.9} />
        </mesh>
      </group>
    </RigidBody>
  )
}
