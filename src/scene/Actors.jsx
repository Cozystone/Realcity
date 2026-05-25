import { useEffect, useMemo, useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import * as THREE from 'three'
import { terrainHeight } from '../engine/cityEngine'
import { useCityStore } from '../engine/cityStore'
import { askLocalNPC, fallbackLine, llmStatus } from '../engine/localLLM'

const forward = new THREE.Vector3(0, 0, 1)

function scheduleFor(agent, timeMinutes) {
  const hour = timeMinutes / 60
  return agent.schedule.find(slot => hour >= slot.start && hour < slot.end) || agent.schedule[0]
}

function targetFor(agent, places, timeMinutes) {
  const slot = scheduleFor(agent, timeMinutes)
  if (slot.target === 'home') {
    return { ...agent.home, activity: slot.activity }
  }
  const id = slot.target === 'work' ? agent.workId : agent.thirdId
  const place = places.get(id) || [...places.values()][0]
  return {
    x: place.x + agent.offset.x,
    z: place.z + agent.offset.z,
    y: place.y,
    name: place.name,
    activity: slot.activity,
  }
}

class Agent {
  constructor(data) {
    Object.assign(this, data)
    this.pos = new THREE.Vector3(data.home.x, data.home.y + 0.95, data.home.z)
    this.heading = Math.random() * Math.PI * 2
    this.activity = 'starting day'
    this.placeName = data.home.name
    this.talkTimer = 0
    this.socialCooldown = 4 + Math.random() * 11
    this.playerCooldown = 0
  }

  update(delta, timeMinutes, places) {
    this.socialCooldown = Math.max(0, this.socialCooldown - delta)
    this.playerCooldown = Math.max(0, this.playerCooldown - delta)
    if (this.talkTimer > 0) {
      this.talkTimer -= delta
      return 'talking'
    }

    const target = targetFor(this, places, timeMinutes)
    this.activity = target.activity
    this.placeName = target.name

    const dx = target.x - this.pos.x
    const dz = target.z - this.pos.z
    const distance = Math.hypot(dx, dz)
    if (distance > 2.2) {
      const desired = Math.atan2(dx, dz)
      const turn = Math.atan2(Math.sin(desired - this.heading), Math.cos(desired - this.heading))
      this.heading += turn * Math.min(1, delta * 3)
      const speed = (this.activity === 'commuting' ? 1.65 : 1.05) * this.pace
      this.pos.x += Math.sin(this.heading) * speed * delta
      this.pos.z += Math.cos(this.heading) * speed * delta
      this.pos.y = terrainHeight(this.pos.x, this.pos.z) + 0.95
      return 'walking'
    }

    this.heading += Math.sin(timeMinutes * 0.02 + this.id.length) * delta * 0.2
    return 'dwelling'
  }

  talk(seconds = 6) {
    this.talkTimer = seconds
    this.socialCooldown = 20 + Math.random() * 20
  }

  snapshot() {
    return {
      id: this.id,
      name: this.name,
      age: this.age,
      gender: this.gender,
      job: this.job,
      role: this.role,
      personality: this.personality,
      activity: this.activity,
      placeName: this.placeName,
    }
  }
}

function setLocalPart(mesh, index, dummy, base, yaw, local, scale, rotX = 0, rotZ = 0) {
  const cos = Math.cos(yaw)
  const sin = Math.sin(yaw)
  dummy.position.set(
    base.x + local[0] * cos + local[2] * sin,
    base.y + local[1],
    base.z - local[0] * sin + local[2] * cos,
  )
  dummy.rotation.set(rotX, yaw, rotZ)
  dummy.scale.set(scale[0], scale[1], scale[2])
  dummy.updateMatrix()
  mesh.setMatrixAt(index, dummy.matrix)
}

function Traffic({ cars }) {
  const bodyRef = useRef()
  const cabinRef = useRef()
  const wheelRef = useRef()
  const headlightRef = useRef()
  const tailLightRef = useRef()
  const dummy = useMemo(() => new THREE.Object3D(), [])
  const color = useMemo(() => new THREE.Color(), [])
  const colorsReady = useRef(false)

  useFrame((state, delta) => {
    if (!bodyRef.current || !cabinRef.current || !wheelRef.current || !headlightRef.current || !tailLightRef.current) return
    const dt = Math.min(delta, 0.05)

    if (!colorsReady.current) {
      cars.forEach((car, i) => bodyRef.current.setColorAt(i, color.set(car.color)))
      if (bodyRef.current.instanceColor) bodyRef.current.instanceColor.needsUpdate = true
      colorsReady.current = true
    }

    for (let i = 0; i < cars.length; i += 1) {
      const car = cars[i]
      const wave = 0.82 + Math.sin(state.clock.elapsedTime * 0.23 + car.phase) * 0.18
      car.t = (car.t + (car.speed * wave * dt) / Math.max(1, car.road.to - car.road.from)) % 1
      const t = car.direction > 0 ? car.t : 1 - car.t
      const span = car.road.to - car.road.from
      let x
      let z
      let yaw

      if (car.road.axis === 'x') {
        x = car.road.from + span * t
        z = car.road.z + car.lane
        yaw = car.direction > 0 ? Math.PI / 2 : -Math.PI / 2
      } else {
        x = car.road.x + car.lane
        z = car.road.from + span * t
        yaw = car.direction > 0 ? 0 : Math.PI
      }

      const y = terrainHeight(x, z) + 0.55
      const base = { x, y, z }
      setLocalPart(bodyRef.current, i, dummy, base, yaw, [0, 0, 0], [2.1, 0.72, 4.35])
      setLocalPart(cabinRef.current, i, dummy, base, yaw, [0, 0.72, -0.18], [1.56, 0.58, 1.82])
      setLocalPart(wheelRef.current, i * 4, dummy, base, yaw, [-1.14, -0.36, 1.55], [0.34, 0.42, 0.72])
      setLocalPart(wheelRef.current, i * 4 + 1, dummy, base, yaw, [1.14, -0.36, 1.55], [0.34, 0.42, 0.72])
      setLocalPart(wheelRef.current, i * 4 + 2, dummy, base, yaw, [-1.14, -0.36, -1.55], [0.34, 0.42, 0.72])
      setLocalPart(wheelRef.current, i * 4 + 3, dummy, base, yaw, [1.14, -0.36, -1.55], [0.34, 0.42, 0.72])
      setLocalPart(headlightRef.current, i * 2, dummy, base, yaw, [-0.55, 0.08, 2.22], [0.24, 0.14, 0.08])
      setLocalPart(headlightRef.current, i * 2 + 1, dummy, base, yaw, [0.55, 0.08, 2.22], [0.24, 0.14, 0.08])
      setLocalPart(tailLightRef.current, i * 2, dummy, base, yaw, [-0.58, 0.05, -2.22], [0.22, 0.12, 0.08])
      setLocalPart(tailLightRef.current, i * 2 + 1, dummy, base, yaw, [0.58, 0.05, -2.22], [0.22, 0.12, 0.08])
    }

    bodyRef.current.instanceMatrix.needsUpdate = true
    cabinRef.current.instanceMatrix.needsUpdate = true
    wheelRef.current.instanceMatrix.needsUpdate = true
    headlightRef.current.instanceMatrix.needsUpdate = true
    tailLightRef.current.instanceMatrix.needsUpdate = true
  })

  return (
    <>
      <instancedMesh ref={bodyRef} args={[undefined, undefined, cars.length]} castShadow frustumCulled={false}>
        <boxGeometry args={[1, 1, 1]} />
        <meshStandardMaterial color="#ffffff" vertexColors roughness={0.28} metalness={0.48} />
      </instancedMesh>
      <instancedMesh ref={cabinRef} args={[undefined, undefined, cars.length]} castShadow frustumCulled={false}>
        <boxGeometry args={[1, 1, 1]} />
        <meshStandardMaterial color="#101820" roughness={0.1} metalness={0.32} />
      </instancedMesh>
      <instancedMesh ref={wheelRef} args={[undefined, undefined, cars.length * 4]} castShadow frustumCulled={false}>
        <boxGeometry args={[1, 1, 1]} />
        <meshStandardMaterial color="#08090b" roughness={0.56} metalness={0.18} />
      </instancedMesh>
      <instancedMesh ref={headlightRef} args={[undefined, undefined, cars.length * 2]} frustumCulled={false}>
        <boxGeometry args={[1, 1, 1]} />
        <meshStandardMaterial color="#fff8df" emissive="#ffe08a" emissiveIntensity={1.45} roughness={0.18} />
      </instancedMesh>
      <instancedMesh ref={tailLightRef} args={[undefined, undefined, cars.length * 2]} frustumCulled={false}>
        <boxGeometry args={[1, 1, 1]} />
        <meshStandardMaterial color="#ff2b2b" emissive="#ff1d18" emissiveIntensity={1.2} roughness={0.24} />
      </instancedMesh>
    </>
  )
}

function NPCs({ city }) {
  const places = useMemo(() => new Map(city.landmarks.map(place => [place.id, place])), [city.landmarks])
  const agents = useMemo(() => city.npcs.map(npc => new Agent(npc)), [city.npcs])
  const torsoRef = useRef()
  const headRef = useRef()
  const legRef = useRef()
  const armRef = useRef()
  const hairRef = useRef()
  const bagRef = useRef()
  const dummy = useMemo(() => new THREE.Object3D(), [])
  const color = useMemo(() => new THREE.Color(), [])
  const colorsReady = useRef(false)
  const socialClock = useRef(0)
  const statsClock = useRef(0)
  const busy = useRef(false)

  useEffect(() => {
    useCityStore.getState().setStats({ npcs: agents.length, cars: city.cars.length, tiles: city.tiles.length, llm: llmStatus() })
  }, [agents.length, city.cars.length, city.tiles.length])

  useFrame((state, delta) => {
    if (!torsoRef.current || !headRef.current || !legRef.current || !armRef.current || !hairRef.current || !bagRef.current) return
    const dt = Math.min(delta, 0.05)
    const store = useCityStore.getState()
    const time = store.timeMinutes
    let talks = 0

    if (!colorsReady.current) {
      agents.forEach((agent, i) => torsoRef.current.setColorAt(i, color.set(agent.color)))
      if (torsoRef.current.instanceColor) torsoRef.current.instanceColor.needsUpdate = true
      colorsReady.current = true
    }

    for (let i = 0; i < agents.length; i += 1) {
      const agent = agents[i]
      const agentState = agent.update(dt, time, places)
      if (agentState === 'talking') talks += 1

      const walking = agentState === 'walking'
      const stride = Math.sin(state.clock.elapsedTime * (walking ? 7.6 : 1.2) * agent.pace + i * 0.83) * (walking ? 0.46 : 0.035)
      const base = agent.pos
      setLocalPart(torsoRef.current, i, dummy, base, agent.heading, [0, 0.04, 0], [0.22, walking ? 0.49 : 0.45, 0.17])
      setLocalPart(headRef.current, i, dummy, base, agent.heading, [0, 0.7, 0.025], [0.235, 0.235, 0.235])
      setLocalPart(hairRef.current, i, dummy, base, agent.heading, [0, 0.86, -0.02], [0.245, 0.105, 0.235])
      setLocalPart(bagRef.current, i, dummy, base, agent.heading, [0.19, 0.08, -0.13], [0.1, 0.22, 0.055])
      setLocalPart(legRef.current, i * 2, dummy, base, agent.heading, [-0.09, -0.43, 0], [0.055, 0.38, 0.055], stride)
      setLocalPart(legRef.current, i * 2 + 1, dummy, base, agent.heading, [0.09, -0.43, 0], [0.055, 0.38, 0.055], -stride)
      setLocalPart(armRef.current, i * 2, dummy, base, agent.heading, [-0.245, 0.13, 0.02], [0.047, 0.32, 0.047], -stride * 0.58)
      setLocalPart(armRef.current, i * 2 + 1, dummy, base, agent.heading, [0.245, 0.13, 0.02], [0.047, 0.32, 0.047], stride * 0.58)
    }

    socialClock.current += dt
    statsClock.current += dt

    if (socialClock.current > 0.8) {
      socialClock.current = 0
      for (let tries = 0; tries < 18; tries += 1) {
        const a = agents[Math.floor(Math.random() * agents.length)]
        const b = agents[Math.floor(Math.random() * agents.length)]
        if (!a || !b || a === b || a.socialCooldown > 0 || b.socialCooldown > 0) continue
        if (a.pos.distanceTo(b.pos) > 4.4) continue
        a.talk(5)
        b.talk(5)
        const player = new THREE.Vector3(store.player.x, store.player.y, store.player.z)
        if (a.pos.distanceTo(player) < 45) store.setPulse(`${a.name} and ${b.name} are talking near ${a.placeName}.`)
        break
      }
    }

    if (statsClock.current > 1.25) {
      statsClock.current = 0
      store.setStats({ talks })
    }

    torsoRef.current.instanceMatrix.needsUpdate = true
    headRef.current.instanceMatrix.needsUpdate = true
    hairRef.current.instanceMatrix.needsUpdate = true
    bagRef.current.instanceMatrix.needsUpdate = true
    legRef.current.instanceMatrix.needsUpdate = true
    armRef.current.instanceMatrix.needsUpdate = true
  })

  useEffect(() => {
    const onKey = async (event) => {
      if (event.code !== 'KeyE' || busy.current) return
      const store = useCityStore.getState()
      const player = new THREE.Vector3(store.player.x, store.player.y, store.player.z)
      let best = null
      let bestDistance = Infinity
      for (const agent of agents) {
        const distance = agent.pos.distanceTo(player)
        if (distance < bestDistance) {
          best = agent
          bestDistance = distance
        }
      }
      if (!best || bestDistance > 7 || best.playerCooldown > 0) return

      busy.current = true
      best.talk(8)
      best.playerCooldown = 8
      store.showDialogue({ speaker: best.name, role: best.job, text: '...', agent: best.snapshot() })

      const reply = await askLocalNPC(best, `Day ${store.day}, ${Math.floor(store.timeMinutes / 60)}:${String(Math.floor(store.timeMinutes % 60)).padStart(2, '0')}, ${store.player.district}`)
      store.showDialogue({ speaker: best.name, role: best.job, text: reply || fallbackLine(best), agent: best.snapshot() })
      window.setTimeout(() => { busy.current = false }, 1200)
    }

    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [agents])

  return (
    <>
      <instancedMesh ref={torsoRef} args={[undefined, undefined, agents.length]} castShadow frustumCulled={false}>
        <capsuleGeometry args={[1, 2, 4, 8]} />
        <meshStandardMaterial color="#ffffff" vertexColors roughness={0.82} metalness={0.02} />
      </instancedMesh>
      <instancedMesh ref={headRef} args={[undefined, undefined, agents.length]} castShadow frustumCulled={false}>
        <sphereGeometry args={[1, 10, 8]} />
        <meshStandardMaterial color="#efc29a" roughness={0.72} />
      </instancedMesh>
      <instancedMesh ref={hairRef} args={[undefined, undefined, agents.length]} castShadow frustumCulled={false}>
        <sphereGeometry args={[1, 10, 6, 0, Math.PI * 2, 0, Math.PI * 0.56]} />
        <meshStandardMaterial color="#19130f" roughness={0.9} />
      </instancedMesh>
      <instancedMesh ref={bagRef} args={[undefined, undefined, agents.length]} castShadow frustumCulled={false}>
        <boxGeometry args={[1, 1, 1]} />
        <meshStandardMaterial color="#473120" roughness={0.78} />
      </instancedMesh>
      <instancedMesh ref={legRef} args={[undefined, undefined, agents.length * 2]} castShadow frustumCulled={false}>
        <capsuleGeometry args={[1, 2, 4, 7]} />
        <meshStandardMaterial color="#1f2937" roughness={0.84} />
      </instancedMesh>
      <instancedMesh ref={armRef} args={[undefined, undefined, agents.length * 2]} castShadow frustumCulled={false}>
        <capsuleGeometry args={[1, 2, 4, 7]} />
        <meshStandardMaterial color="#d7a17d" roughness={0.7} />
      </instancedMesh>
    </>
  )
}

export default function Actors({ city }) {
  return (
    <>
      <Traffic cars={city.cars} />
      <NPCs city={city} />
    </>
  )
}
