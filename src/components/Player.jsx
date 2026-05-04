import { useRef, useEffect } from 'react'
import { useFrame } from '@react-three/fiber'
import { RigidBody, CapsuleCollider, useRapier } from '@react-three/rapier'
import * as THREE from 'three'
import { useKeyboard } from '../hooks/useKeyboard'

const WALK  = 5.5
const RUN   = 12
const JUMP  = 8.5
const CAM_DIST   = 14
const CAM_HEIGHT = 3.2

const _fwd  = new THREE.Vector3()
const _rgt  = new THREE.Vector3()
const _mov  = new THREE.Vector3()
const _cam  = new THREE.Vector3()
const _look = new THREE.Vector3()

// ─── Detailed low-poly character ────────────────────────────────────────────
function Character({ isMoving, isRunning }) {
  const walk     = useRef(0)
  const lThigh   = useRef(), rThigh = useRef()
  const lShin    = useRef(), rShin  = useRef()
  const lArm     = useRef(), rArm   = useRef()
  const body     = useRef()

  useFrame((_, dt) => {
    const target = isMoving.current ? (isRunning.current ? 9 : 6) : 0
    walk.current += (target - walk.current) * Math.min(1, dt * 12)
    const w   = walk.current
    const t   = performance.now() / 1000
    const sw  = Math.sin(t * w) * 0.42

    if (lThigh.current)  lThigh.current.rotation.x  =  sw
    if (rThigh.current)  rThigh.current.rotation.x  = -sw
    if (lShin.current)   lShin.current.rotation.x   =  Math.max(0, sw) * 0.7
    if (rShin.current)   rShin.current.rotation.x   =  Math.max(0, -sw) * 0.7
    if (lArm.current)    lArm.current.rotation.x    = -sw * 0.5
    if (rArm.current)    rArm.current.rotation.x    =  sw * 0.5
    if (body.current)    body.current.position.y    = 0 + Math.abs(Math.sin(t * w * 2)) * 0.025
  })

  const skinColor  = '#f2c89a'
  const hairColor  = '#1a0e08'
  const shirtColor = '#1a3a90'
  const pantColor  = '#1a2050'
  const shoeColor  = '#1a1a1a'

  return (
    <group position={[0, -0.9, 0]}>
      {/* ── LEFT LEG ─ pivot at hip */}
      <group ref={lThigh} position={[-0.10, 0.88, 0]}>
        <mesh castShadow position={[0, -0.18, 0]}>
          <cylinderGeometry args={[0.085, 0.075, 0.38, 7]} />
          <meshStandardMaterial color={pantColor} roughness={0.85} />
        </mesh>
        <group ref={lShin} position={[0, -0.38, 0]}>
          <mesh castShadow position={[0, -0.18, 0]}>
            <cylinderGeometry args={[0.070, 0.058, 0.38, 7]} />
            <meshStandardMaterial color={pantColor} roughness={0.85} />
          </mesh>
          <mesh castShadow position={[0, -0.41, 0.055]}>
            <boxGeometry args={[0.13, 0.09, 0.26]} />
            <meshStandardMaterial color={shoeColor} roughness={0.6} metalness={0.1} />
          </mesh>
        </group>
      </group>

      {/* ── RIGHT LEG */}
      <group ref={rThigh} position={[0.10, 0.88, 0]}>
        <mesh castShadow position={[0, -0.18, 0]}>
          <cylinderGeometry args={[0.085, 0.075, 0.38, 7]} />
          <meshStandardMaterial color={pantColor} roughness={0.85} />
        </mesh>
        <group ref={rShin} position={[0, -0.38, 0]}>
          <mesh castShadow position={[0, -0.18, 0]}>
            <cylinderGeometry args={[0.070, 0.058, 0.38, 7]} />
            <meshStandardMaterial color={pantColor} roughness={0.85} />
          </mesh>
          <mesh castShadow position={[0, -0.41, 0.055]}>
            <boxGeometry args={[0.13, 0.09, 0.26]} />
            <meshStandardMaterial color={shoeColor} roughness={0.6} metalness={0.1} />
          </mesh>
        </group>
      </group>

      {/* ── PELVIS */}
      <mesh castShadow position={[0, 0.88, 0]}>
        <boxGeometry args={[0.30, 0.16, 0.19]} />
        <meshStandardMaterial color={pantColor} roughness={0.85} />
      </mesh>

      {/* ── TORSO + ARMS (body group bobs) */}
      <group ref={body} position={[0, 0.88, 0]}>
        {/* Torso */}
        <mesh castShadow position={[0, 0.27, 0]}>
          <boxGeometry args={[0.36, 0.42, 0.20]} />
          <meshStandardMaterial color={shirtColor} roughness={0.80} />
        </mesh>

        {/* LEFT ARM — pivot at shoulder */}
        <group ref={lArm} position={[-0.23, 0.22, 0]}>
          <mesh castShadow position={[0, -0.15, 0]}>
            <cylinderGeometry args={[0.065, 0.055, 0.32, 6]} />
            <meshStandardMaterial color={shirtColor} roughness={0.8} />
          </mesh>
          {/* forearm */}
          <mesh castShadow position={[0, -0.42, 0]}>
            <cylinderGeometry args={[0.050, 0.042, 0.28, 6]} />
            <meshStandardMaterial color={skinColor} roughness={0.7} />
          </mesh>
        </group>

        {/* RIGHT ARM */}
        <group ref={rArm} position={[0.23, 0.22, 0]}>
          <mesh castShadow position={[0, -0.15, 0]}>
            <cylinderGeometry args={[0.065, 0.055, 0.32, 6]} />
            <meshStandardMaterial color={shirtColor} roughness={0.8} />
          </mesh>
          <mesh castShadow position={[0, -0.42, 0]}>
            <cylinderGeometry args={[0.050, 0.042, 0.28, 6]} />
            <meshStandardMaterial color={skinColor} roughness={0.7} />
          </mesh>
        </group>

        {/* Backpack */}
        <mesh castShadow position={[0, 0.22, 0.175]}>
          <boxGeometry args={[0.26, 0.38, 0.13]} />
          <meshStandardMaterial color="#1a2840" roughness={0.88} />
        </mesh>
      </group>

      {/* ── NECK */}
      <mesh castShadow position={[0, 1.53, 0]}>
        <cylinderGeometry args={[0.075, 0.085, 0.14, 7]} />
        <meshStandardMaterial color={skinColor} roughness={0.7} />
      </mesh>

      {/* ── HEAD */}
      <mesh castShadow position={[0, 1.72, 0]}>
        <sphereGeometry args={[0.185, 12, 10]} />
        <meshStandardMaterial color={skinColor} roughness={0.65} />
      </mesh>

      {/* ── HAIR */}
      <mesh castShadow position={[0, 1.83, -0.01]}>
        <sphereGeometry args={[0.195, 10, 8, 0, Math.PI * 2, 0, Math.PI * 0.56]} />
        <meshStandardMaterial color={hairColor} roughness={0.92} />
      </mesh>

      {/* ── EARS */}
      {[-1, 1].map(side => (
        <mesh key={side} castShadow position={[side * 0.185, 1.70, 0]}>
          <sphereGeometry args={[0.048, 6, 6]} />
          <meshStandardMaterial color={skinColor} roughness={0.7} />
        </mesh>
      ))}
    </group>
  )
}

// ─── Player controller ───────────────────────────────────────────────────────
export default function Player() {
  const rb   = useRef()
  const keys = useKeyboard()
  const { world } = useRapier()

  const camAz  = useRef(0)
  const camEl  = useRef(0.28)
  const velY   = useRef(0)
  const lastJump  = useRef(0)
  const grounded  = useRef(true)
  const meshGrp   = useRef()
  const ctrlRef   = useRef()
  const isMoving  = useRef(false)
  const isRunning = useRef(false)
  const gameMin   = useRef(12 * 60 + 45)

  useEffect(() => {
    const ctrl = world.createCharacterController(0.05)
    ctrl.enableAutostep(0.75, 0.28, true)
    ctrl.enableSnapToGround(0.55)
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

    // Game time
    gameMin.current = (gameMin.current + dt * 60) % (24 * 60)
    if (window.__updateGameTime) {
      window.__updateGameTime(Math.floor(gameMin.current / 60), Math.floor(gameMin.current % 60))
    }

    // Camera angles
    const rs = 1.9 * dt
    if (keys.current.ArrowLeft)  camAz.current -= rs
    if (keys.current.ArrowRight) camAz.current += rs
    if (keys.current.ArrowUp)    camEl.current  = Math.min(camEl.current + rs, 1.35)
    if (keys.current.ArrowDown)  camEl.current  = Math.max(camEl.current - rs, -0.1)

    const pos = body.translation()

    // Movement
    const az = camAz.current
    _fwd.set(-Math.sin(az), 0, -Math.cos(az))
    _rgt.set( Math.cos(az), 0, -Math.sin(az))
    _mov.set(0, 0, 0)
    if (keys.current.KeyW) _mov.addScaledVector(_fwd,  1)
    if (keys.current.KeyS) _mov.addScaledVector(_fwd, -1)
    if (keys.current.KeyA) _mov.addScaledVector(_rgt, -1)
    if (keys.current.KeyD) _mov.addScaledVector(_rgt,  1)

    isRunning.current = !!(keys.current.ShiftLeft || keys.current.ShiftRight)
    isMoving.current  = _mov.length() > 0
    const speed = isRunning.current ? RUN : WALK
    if (isMoving.current) _mov.normalize().multiplyScalar(speed * dt)

    // Gravity
    velY.current -= 22 * dt
    if (velY.current < -30) velY.current = -30

    // Grounded check
    if (ctrlRef.current.computedGrounded()) {
      grounded.current = true
      if (velY.current < 0) velY.current = -0.8
    } else {
      grounded.current = false
    }

    // Jump
    const now = state.clock.elapsedTime
    if (keys.current.Space && grounded.current && now - lastJump.current > 0.45) {
      velY.current   = JUMP
      grounded.current = false
      lastJump.current = now
    }

    // Apply movement
    const desired = { x: _mov.x, y: velY.current * dt, z: _mov.z }
    const col = body.collider(0) != null ? world.getCollider(body.collider(0)) : null
    if (col) {
      ctrlRef.current.computeColliderMovement(col, desired)
      const c = ctrlRef.current.computedMovement()
      if (desired.y < 0 && Math.abs(c.y - desired.y) > 0.002) velY.current = 0
      body.setNextKinematicTranslation({ x: pos.x + c.x, y: pos.y + c.y, z: pos.z + c.z })
    } else {
      body.setNextKinematicTranslation({ x: pos.x + desired.x, y: pos.y + desired.y, z: pos.z + desired.z })
    }

    // Rotate mesh toward movement
    if (meshGrp.current && isMoving.current) {
      const yaw = Math.atan2(_mov.x, _mov.z)
      meshGrp.current.rotation.y += (yaw - meshGrp.current.rotation.y) * 0.18
    }

    // Camera
    const el = camEl.current
    const ce = Math.cos(el)
    _cam.set(
      pos.x + CAM_DIST * Math.sin(az) * ce,
      pos.y + CAM_DIST * Math.sin(el) + CAM_HEIGHT,
      pos.z + CAM_DIST * Math.cos(az) * ce,
    )
    state.camera.position.lerp(_cam, 0.1)
    _look.set(pos.x, pos.y + 1.4, pos.z)
    state.camera.lookAt(_look)

    // HUD
    if (window.__updateHUD) window.__updateHUD(pos, az)
  })

  return (
    <RigidBody
      ref={rb}
      type="kinematicPosition"
      colliders={false}
      position={[0, 8, 0]}
    >
      <CapsuleCollider args={[0.72, 0.38]} />
      <group ref={meshGrp}>
        <Character isMoving={isMoving} isRunning={isRunning} />
      </group>
    </RigidBody>
  )
}
