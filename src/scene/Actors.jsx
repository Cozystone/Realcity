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

function Traffic({ cars }) {
  const bodyRef = useRef()
  const cabinRef = useRef()
  const dummy = useMemo(() => new THREE.Object3D(), [])
  const color = useMemo(() => new THREE.Color(), [])
  const colorsReady = useRef(false)

  useFrame((state, delta) => {
    if (!bodyRef.current || !cabinRef.current) return
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
      dummy.position.set(x, y, z)
      dummy.rotation.set(0, yaw, 0)
      dummy.scale.set(2.1, 0.78, 4.35)
      dummy.updateMatrix()
      bodyRef.current.setMatrixAt(i, dummy.matrix)

      dummy.position.set(x, y + 0.76, z)
      dummy.scale.set(1.72, 0.58, 2.42)
      dummy.updateMatrix()
      cabinRef.current.setMatrixAt(i, dummy.matrix)
    }

    bodyRef.current.instanceMatrix.needsUpdate = true
    cabinRef.current.instanceMatrix.needsUpdate = true
  })

  return (
    <>
      <instancedMesh ref={bodyRef} args={[undefined, undefined, cars.length]} castShadow frustumCulled={false}>
        <boxGeometry args={[1, 1, 1]} />
        <meshStandardMaterial color="#ffffff" vertexColors roughness={0.28} metalness={0.48} />
      </instancedMesh>
      <instancedMesh ref={cabinRef} args={[undefined, undefined, cars.length]} castShadow frustumCulled={false}>
        <boxGeometry args={[1, 1, 1]} />
        <meshStandardMaterial color="#111827" roughness={0.14} metalness={0.25} />
      </instancedMesh>
    </>
  )
}

function NPCs({ city }) {
  const places = useMemo(() => new Map(city.landmarks.map(place => [place.id, place])), [city.landmarks])
  const agents = useMemo(() => city.npcs.map(npc => new Agent(npc)), [city.npcs])
  const bodyRef = useRef()
  const headRef = useRef()
  const dummy = useMemo(() => new THREE.Object3D(), [])
  const color = useMemo(() => new THREE.Color(), [])
  const colorsReady = useRef(false)
  const socialClock = useRef(0)
  const statsClock = useRef(0)
  const busy = useRef(false)

  useEffect(() => {
    useCityStore.getState().setStats({ npcs: agents.length, cars: city.cars.length, tiles: city.tiles.length, llm: llmStatus() })
  }, [agents.length, city.cars.length, city.tiles.length])

  useFrame((_, delta) => {
    if (!bodyRef.current || !headRef.current) return
    const dt = Math.min(delta, 0.05)
    const store = useCityStore.getState()
    const time = store.timeMinutes
    let talks = 0

    if (!colorsReady.current) {
      agents.forEach((agent, i) => bodyRef.current.setColorAt(i, color.set(agent.color)))
      if (bodyRef.current.instanceColor) bodyRef.current.instanceColor.needsUpdate = true
      colorsReady.current = true
    }

    for (let i = 0; i < agents.length; i += 1) {
      const agent = agents[i]
      const state = agent.update(dt, time, places)
      if (state === 'talking') talks += 1

      dummy.position.copy(agent.pos)
      dummy.rotation.y = agent.heading
      dummy.scale.set(0.23, state === 'walking' ? 0.58 : 0.54, 0.23)
      dummy.updateMatrix()
      bodyRef.current.setMatrixAt(i, dummy.matrix)

      dummy.position.set(agent.pos.x, agent.pos.y + 0.72, agent.pos.z)
      dummy.scale.set(0.245, 0.245, 0.245)
      dummy.updateMatrix()
      headRef.current.setMatrixAt(i, dummy.matrix)
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

    bodyRef.current.instanceMatrix.needsUpdate = true
    headRef.current.instanceMatrix.needsUpdate = true
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
      <instancedMesh ref={bodyRef} args={[undefined, undefined, agents.length]} castShadow frustumCulled={false}>
        <capsuleGeometry args={[1, 2, 4, 8]} />
        <meshStandardMaterial color="#ffffff" vertexColors roughness={0.82} metalness={0.02} />
      </instancedMesh>
      <instancedMesh ref={headRef} args={[undefined, undefined, agents.length]} castShadow frustumCulled={false}>
        <sphereGeometry args={[1, 10, 8]} />
        <meshStandardMaterial color="#efc29a" roughness={0.72} />
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
