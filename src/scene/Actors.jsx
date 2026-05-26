import { useEffect, useMemo, useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import * as THREE from 'three'
import { terrainHeight } from '../engine/cityEngine'
import { useCityStore } from '../engine/cityStore'
import { askLocalNPC, fallbackLine, llmStatus, matchRequestedPlace, planLocalNPCAction } from '../engine/localLLM'

const forward = new THREE.Vector3(0, 0, 1)

function formatTime(minutes) {
  return `${Math.floor(minutes / 60)}:${String(Math.floor(minutes % 60)).padStart(2, '0')}`
}

function smoothstep(t) {
  return t * t * (3 - 2 * t)
}

function scheduleFor(agent, timeMinutes) {
  const hour = timeMinutes / 60
  return agent.schedule.find(slot => hour >= slot.start && hour < slot.end) || agent.schedule[0]
}

function entranceTargetFor(destination) {
  const interior = destination?.interior
  if (!interior) {
    const x = destination.x
    const z = destination.z
    return {
      x,
      z,
      y: destination.y ?? terrainHeight(x, z),
      name: destination.name || 'destination',
      kind: destination.kind,
    }
  }

  const x = destination.x
  const z = destination.z - interior.depth / 2 - 4.8
  return {
    x,
    z,
    y: terrainHeight(x, z),
    name: `${destination.name || 'building'} entrance`,
    placeName: destination.name,
    kind: destination.kind,
    interiorId: destination.id,
  }
}

function scheduleTargetForPlace(place, offset = { x: 0, z: 0 }) {
  if (!place?.interior?.solidWalls) {
    const x = place.x + offset.x
    const z = place.z + offset.z
    return {
      x,
      z,
      y: terrainHeight(x, z),
      name: place.name,
    }
  }

  const entry = entranceTargetFor(place)
  const lateral = Math.max(-place.interior.doorWidth * 0.42, Math.min(place.interior.doorWidth * 0.42, offset.x * 0.18))
  const setback = 2.2 + Math.min(5.5, Math.abs(offset.z) * 0.18)
  const x = entry.x + lateral
  const z = entry.z - setback
  return {
    ...entry,
    x,
    z,
    y: terrainHeight(x, z),
    name: place.name,
  }
}

function targetFor(agent, places, timeMinutes) {
  const slot = scheduleFor(agent, timeMinutes)
  if (slot.target === 'home') {
    return { ...agent.home, activity: slot.activity }
  }
  const id = slot.target === 'work' ? agent.workId : agent.thirdId
  const place = places.get(id) || [...places.values()][0]
  return { ...scheduleTargetForPlace(place, agent.offset), activity: slot.activity }
}

function moveAgentToward(agent, target, delta, speed) {
  const dx = target.x - agent.pos.x
  const dz = target.z - agent.pos.z
  const distance = Math.hypot(dx, dz)
  if (distance <= 0.001) return 0

  const desired = Math.atan2(dx, dz)
  const turn = Math.atan2(Math.sin(desired - agent.heading), Math.cos(desired - agent.heading))
  agent.heading += turn * Math.min(1, delta * 3.5)
  const step = Math.min(distance, speed * delta)
  agent.pos.x += Math.sin(agent.heading) * step
  agent.pos.z += Math.cos(agent.heading) * step
  agent.pos.y = terrainHeight(agent.pos.x, agent.pos.z) + 0.95
  return distance
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
    this.glanceCooldown = 1 + Math.random() * 5
    this.mission = null
  }

  update(delta, timeMinutes, places) {
    this.socialCooldown = Math.max(0, this.socialCooldown - delta)
    this.playerCooldown = Math.max(0, this.playerCooldown - delta)
    this.glanceCooldown = Math.max(0, this.glanceCooldown - delta)
    if (this.talkTimer > 0 && !this.mission) {
      this.talkTimer -= delta
      return 'talking'
    }
    if (this.talkTimer > 0) this.talkTimer -= delta

    if (this.mission) return this.updateMission(delta)

    const target = targetFor(this, places, timeMinutes)
    this.activity = target.activity
    this.placeName = target.name

    const distance = Math.hypot(target.x - this.pos.x, target.z - this.pos.z)
    if (distance > 2.2) {
      const speed = (this.activity === 'commuting' ? 1.65 : 1.05) * this.pace
      moveAgentToward(this, target, delta, speed)
      return 'walking'
    }

    this.heading += Math.sin(timeMinutes * 0.02 + this.id.length) * delta * 0.2
    return 'dwelling'
  }

  updateMission(delta) {
    const store = useCityStore.getState()
    const mission = this.mission
    const destination = mission.destination
    this.placeName = destination.name

    if (mission.mode === 'taxi') {
      if (mission.phase === 'to_pickup') {
        this.activity = 'walking to taxi pickup'
        const distance = moveAgentToward(this, mission.pickup, delta, 1.9 * this.pace)
        if (distance < 2.6) {
          mission.phase = 'taxi_boarding'
          mission.boardingAt = performance.now()
          store.updateMission({ phase: 'taxi_boarding', summary: `${this.name} is hailing a taxi at the curb.` })
          store.showDialogue({
            speaker: this.name,
            role: this.job,
            text: '여기서 택시를 잡을게요. 바로 같이 타고 제 일터로 이동하죠.',
            agent: this.snapshot(),
          })
        }
        return 'walking'
      }

      if (mission.phase === 'taxi_boarding') {
        this.activity = 'boarding a taxi'
        if (performance.now() - mission.boardingAt > 1300) {
          const player = store.player
          mission.phase = 'taxi_ride'
          store.updateMission({ phase: 'taxi_ride', summary: `Taxi to ${destination.name}` })
          store.startRide({
            from: { x: player.x, z: player.z },
            to: { x: destination.x, z: destination.z },
            duration: Math.min(15, Math.max(7, Math.hypot(destination.x - player.x, destination.z - player.z) / 58)),
            label: `${this.name} and you are taking a taxi to ${destination.name}.`,
            destinationName: destination.name,
          })
        }
        return 'talking'
      }

      if (mission.phase === 'taxi_ride') {
        this.activity = 'riding with player'
        const ride = store.ride
        if (ride) {
          const t = Math.min(1, (performance.now() - ride.startedAt) / (ride.duration * 1000))
          const eased = smoothstep(t)
          this.pos.x = ride.from.x + (ride.to.x - ride.from.x) * eased + 1.2
          this.pos.z = ride.from.z + (ride.to.z - ride.from.z) * eased - 1.2
          this.pos.y = terrainHeight(this.pos.x, this.pos.z) + 0.95
          this.heading = Math.atan2(ride.to.x - ride.from.x, ride.to.z - ride.from.z)
          return 'riding'
        }
        this.pos.set(destination.x + 2.2, terrainHeight(destination.x, destination.z) + 0.95, destination.z + 2.2)
        store.finishMission(`${this.name} brought you to ${destination.name}.`)
        store.showDialogue({
          speaker: this.name,
          role: this.job,
          text: `도착했어요. 여기가 ${destination.name}입니다. 안으로 들어가려면 제가 먼저 안내할게요.`,
          agent: this.snapshot(),
        })
        this.mission = null
        return 'dwelling'
      }
    }

    this.activity = 'guiding player'
    const distance = moveAgentToward(this, destination, delta, 1.72 * this.pace)
    if (distance < 3.2) {
      this.pos.set(destination.x + 2.2, terrainHeight(destination.x, destination.z) + 0.95, destination.z + 2.2)
      store.finishMission(`${this.name} guided you to ${destination.name}.`)
      store.showDialogue({
        speaker: this.name,
        role: this.job,
        text: `도착했어요. 여기가 ${destination.name}입니다. 제가 일하는 곳이에요.`,
        agent: this.snapshot(),
      })
      this.mission = null
      return 'dwelling'
    }
    return 'walking'
  }

  talk(seconds = 6) {
    this.talkTimer = seconds
    this.socialCooldown = 20 + Math.random() * 20
  }

  snapshot(places) {
    const work = places?.get(this.workId)
    const third = places?.get(this.thirdId)
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
      workId: this.workId,
      workName: work?.name,
      thirdId: this.thirdId,
      thirdName: third?.name,
      x: this.pos.x,
      z: this.pos.z,
      mission: this.mission ? { mode: this.mission.mode, phase: this.mission.phase } : null,
    }
  }
}

function nearestRoadPickup(pos, roads) {
  let best = null
  let bestDistance = Infinity
  for (const road of roads) {
    const half = road.width * 0.58
    let x
    let z
    if (road.axis === 'x') {
      x = Math.max(road.from, Math.min(road.to, pos.x))
      z = road.z + (pos.z >= road.z ? half : -half)
    } else {
      x = road.x + (pos.x >= road.x ? half : -half)
      z = Math.max(road.from, Math.min(road.to, pos.z))
    }
    const distance = Math.hypot(pos.x - x, pos.z - z)
    if (distance < bestDistance) {
      bestDistance = distance
      best = { x, z, y: terrainHeight(x, z), name: `${road.tier === 'primary' ? 'main road' : 'street'} curb` }
    }
  }
  return best || { x: pos.x + 4, z: pos.z + 4, y: terrainHeight(pos.x + 4, pos.z + 4), name: 'curbside' }
}

function destinationFromPlan(plan, agent, places, request = '') {
  if (plan.destination === 'named_place') {
    const placeList = [...places.values()]
    const targetId = typeof plan.targetPlaceId === 'string' ? plan.targetPlaceId : ''
    const targetName = typeof plan.targetPlaceName === 'string' ? plan.targetPlaceName.toLowerCase() : ''
    const byId = targetId ? places.get(targetId) : null
    if (byId) return byId

    if (targetName) {
      const byName = placeList.find(place => [place.id, place.name, place.kind].some(value => String(value || '').toLowerCase().includes(targetName)))
      if (byName) return byName
    }

    const byRequest = matchRequestedPlace(request, placeList)
    if (byRequest) return byRequest
  }
  if (plan.destination === 'home') return { ...agent.home, name: agent.home.name || 'home' }
  if (plan.destination === 'third') {
    const third = places.get(agent.thirdId)
    if (third) return third
  }
  const work = places.get(agent.workId)
  return work || [...places.values()][0]
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

function hashValue(value) {
  let hash = 0
  const text = String(value || '')
  for (let i = 0; i < text.length; i += 1) hash = (hash * 31 + text.charCodeAt(i)) >>> 0
  return hash
}

function skinTone(agent) {
  const tones = ['#f0c49b', '#d8a17d', '#b98262', '#efd2b3', '#9f6a4f']
  return tones[hashValue(agent.id) % tones.length]
}

function hairTone(agent) {
  const tones = ['#17100b', '#2b1b12', '#4b3527', '#111318', '#6b5949']
  return tones[hashValue(`${agent.id}_hair`) % tones.length]
}

function trafficPose(car, tValue = car.t) {
  const t = car.direction > 0 ? tValue : 1 - tValue
  const span = car.road.to - car.road.from
  if (car.road.axis === 'x') {
    return {
      x: car.road.from + span * t,
      z: car.road.z + car.lane,
      yaw: car.direction > 0 ? Math.PI / 2 : -Math.PI / 2,
    }
  }
  return {
    x: car.road.x + car.lane,
    z: car.road.from + span * t,
    yaw: car.direction > 0 ? 0 : Math.PI,
  }
}

function shouldYieldToPedestrian(car, pose, pedestrians) {
  for (const pedestrian of pedestrians) {
    if (car.road.axis === 'x') {
      const lateral = Math.abs(pedestrian.z - car.road.z)
      const ahead = car.direction > 0 ? pedestrian.x - pose.x : pose.x - pedestrian.x
      if (lateral < car.road.width * 0.72 && ahead > -5 && ahead < 26) return pedestrian
    } else {
      const lateral = Math.abs(pedestrian.x - car.road.x)
      const ahead = car.direction > 0 ? pedestrian.z - pose.z : pose.z - pedestrian.z
      if (lateral < car.road.width * 0.72 && ahead > -5 && ahead < 26) return pedestrian
    }
  }
  return null
}

function Traffic({ cars }) {
  const bodyRef = useRef()
  const cabinRef = useRef()
  const wheelRef = useRef()
  const headlightRef = useRef()
  const tailLightRef = useRef()
  const taxiSignRef = useRef()
  const driverRef = useRef()
  const dummy = useMemo(() => new THREE.Object3D(), [])
  const color = useMemo(() => new THREE.Color(), [])
  const colorsReady = useRef(false)
  const yieldPulse = useRef(0)

  useFrame((state, delta) => {
    if (!bodyRef.current || !cabinRef.current || !wheelRef.current || !headlightRef.current || !tailLightRef.current || !taxiSignRef.current || !driverRef.current) return
    const dt = Math.min(delta, 0.05)
    const store = useCityStore.getState()
    const pedestrians = [
      { x: store.player.x, z: store.player.z, player: true },
      ...(store.pedestrianSamples || []),
    ]
    yieldPulse.current = Math.max(0, yieldPulse.current - dt)

    if (!colorsReady.current) {
      cars.forEach((car, i) => bodyRef.current.setColorAt(i, color.set(car.color)))
      if (bodyRef.current.instanceColor) bodyRef.current.instanceColor.needsUpdate = true
      colorsReady.current = true
    }

    for (let i = 0; i < cars.length; i += 1) {
      const car = cars[i]
      const currentPose = trafficPose(car)
      const hazard = shouldYieldToPedestrian(car, currentPose, pedestrians)
      car.brake = hazard
        ? Math.min(1, (car.brake || 0) + dt * (car.driverTemperament === 'hurried' ? 2.8 : 4.2))
        : Math.max(0, (car.brake || 0) - dt * 1.45)
      if (hazard?.player && yieldPulse.current <= 0) {
        yieldPulse.current = 5
        store.setPulse(`${car.kind === 'taxi' ? 'A taxi' : 'A driver'} yields as you step into the lane.`)
      }
      const wave = 0.82 + Math.sin(state.clock.elapsedTime * 0.23 + car.phase) * 0.18
      const speedFactor = Math.max(0, 1 - car.brake * 0.98)
      car.t = (car.t + (car.speed * wave * speedFactor * dt) / Math.max(1, car.road.to - car.road.from)) % 1
      const { x, z, yaw } = trafficPose(car)

      const y = terrainHeight(x, z) + 0.55
      const base = { x, y, z }
      setLocalPart(bodyRef.current, i, dummy, base, yaw, [0, 0, 0], [2.1, 0.72, 4.35])
      setLocalPart(cabinRef.current, i, dummy, base, yaw, [0, 0.72, -0.18], [1.56, 0.58, 1.82])
      setLocalPart(driverRef.current, i, dummy, base, yaw, [-0.34, 1.1, 0.04], [0.22, 0.26, 0.22])
      setLocalPart(wheelRef.current, i * 4, dummy, base, yaw, [-1.14, -0.36, 1.55], [0.34, 0.42, 0.72])
      setLocalPart(wheelRef.current, i * 4 + 1, dummy, base, yaw, [1.14, -0.36, 1.55], [0.34, 0.42, 0.72])
      setLocalPart(wheelRef.current, i * 4 + 2, dummy, base, yaw, [-1.14, -0.36, -1.55], [0.34, 0.42, 0.72])
      setLocalPart(wheelRef.current, i * 4 + 3, dummy, base, yaw, [1.14, -0.36, -1.55], [0.34, 0.42, 0.72])
      setLocalPart(headlightRef.current, i * 2, dummy, base, yaw, [-0.55, 0.08, 2.22], [0.24, 0.14, 0.08])
      setLocalPart(headlightRef.current, i * 2 + 1, dummy, base, yaw, [0.55, 0.08, 2.22], [0.24, 0.14, 0.08])
      setLocalPart(tailLightRef.current, i * 2, dummy, base, yaw, [-0.58, 0.05, -2.22], [0.22 + car.brake * 0.18, 0.12 + car.brake * 0.12, 0.08])
      setLocalPart(tailLightRef.current, i * 2 + 1, dummy, base, yaw, [0.58, 0.05, -2.22], [0.22 + car.brake * 0.18, 0.12 + car.brake * 0.12, 0.08])
      setLocalPart(taxiSignRef.current, i, dummy, base, yaw, [0, 1.2, -0.12], car.kind === 'taxi' ? [0.9, 0.18, 0.45] : [0.001, 0.001, 0.001])
    }

    bodyRef.current.instanceMatrix.needsUpdate = true
    cabinRef.current.instanceMatrix.needsUpdate = true
    driverRef.current.instanceMatrix.needsUpdate = true
    wheelRef.current.instanceMatrix.needsUpdate = true
    headlightRef.current.instanceMatrix.needsUpdate = true
    tailLightRef.current.instanceMatrix.needsUpdate = true
    taxiSignRef.current.instanceMatrix.needsUpdate = true
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
      <instancedMesh ref={driverRef} args={[undefined, undefined, cars.length]} castShadow frustumCulled={false}>
        <sphereGeometry args={[1, 10, 8]} />
        <meshStandardMaterial color="#d4a17d" roughness={0.7} />
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
      <instancedMesh ref={taxiSignRef} args={[undefined, undefined, cars.length]} frustumCulled={false}>
        <boxGeometry args={[1, 1, 1]} />
        <meshStandardMaterial color="#fff7b0" emissive="#ffd34d" emissiveIntensity={1.1} roughness={0.22} />
      </instancedMesh>
    </>
  )
}

function NPCs({ city }) {
  const places = useMemo(() => new Map(city.landmarks.map(place => [place.id, place])), [city.landmarks])
  const agents = useMemo(() => city.npcs.map((npc, i) => {
    const agent = new Agent(npc)
    const target = targetFor(agent, places, useCityStore.getState().timeMinutes)
    const spread = 2.4 + (i % 5) * 0.7
    const plazaAgent = i < 10
    const x = plazaAgent ? Math.sin(i * 1.9) * (8 + i * 1.1) : target.x + Math.sin(i * 2.13) * spread
    const z = plazaAgent ? 40 + Math.cos(i * 1.37) * (8 + i * 1.1) : target.z + Math.cos(i * 1.71) * spread
    agent.pos.set(x, terrainHeight(x, z) + 0.95, z)
    agent.activity = plazaAgent ? 'available for directions' : target.activity
    agent.placeName = plazaAgent ? 'Central Core plaza' : target.name
    agent.heading = plazaAgent ? Math.atan2(-x, 40 - z) : Math.atan2(target.x - agent.home.x, target.z - agent.home.z)
    return agent
  }), [city.npcs, places])
  const torsoRef = useRef()
  const headRef = useRef()
  const legRef = useRef()
  const armRef = useRef()
  const hairRef = useRef()
  const eyeRef = useRef()
  const noseRef = useRef()
  const mouthRef = useRef()
  const shoeRef = useRef()
  const chestRef = useRef()
  const bagRef = useRef()
  const dummy = useMemo(() => new THREE.Object3D(), [])
  const color = useMemo(() => new THREE.Color(), [])
  const colorsReady = useRef(false)
  const socialClock = useRef(0)
  const statsClock = useRef(0)
  const busy = useRef(false)
  const requestBusy = useRef(false)

  useEffect(() => {
    useCityStore.getState().setStats({ npcs: agents.length, cars: city.cars.length, tiles: city.tiles.length, llm: llmStatus() })
  }, [agents.length, city.cars.length, city.tiles.length])

  useFrame((state, delta) => {
    if (!torsoRef.current || !headRef.current || !legRef.current || !armRef.current || !hairRef.current || !eyeRef.current || !noseRef.current || !mouthRef.current || !shoeRef.current || !chestRef.current || !bagRef.current) return
    const dt = Math.min(delta, 0.05)
    const store = useCityStore.getState()
    const time = store.timeMinutes
    let talks = 0
    const player = new THREE.Vector3(store.player.x, store.player.y, store.player.z)

    if (!colorsReady.current) {
      agents.forEach((agent, i) => {
        torsoRef.current.setColorAt(i, color.set(agent.color))
        chestRef.current.setColorAt(i, color.set(agent.role === 'doctor' ? '#e8edf0' : agent.role === 'security' ? '#202833' : '#d9e2ea'))
        headRef.current.setColorAt(i, color.set(skinTone(agent)))
        hairRef.current.setColorAt(i, color.set(hairTone(agent)))
        armRef.current.setColorAt(i * 2, color.set(skinTone(agent)))
        armRef.current.setColorAt(i * 2 + 1, color.set(skinTone(agent)))
      })
      if (torsoRef.current.instanceColor) torsoRef.current.instanceColor.needsUpdate = true
      if (chestRef.current.instanceColor) chestRef.current.instanceColor.needsUpdate = true
      if (headRef.current.instanceColor) headRef.current.instanceColor.needsUpdate = true
      if (hairRef.current.instanceColor) hairRef.current.instanceColor.needsUpdate = true
      if (armRef.current.instanceColor) armRef.current.instanceColor.needsUpdate = true
      colorsReady.current = true
    }

    for (let i = 0; i < agents.length; i += 1) {
      const agent = agents[i]
      const agentState = agent.update(dt, time, places)
      if (agentState === 'talking') talks += 1
      const playerDistance = agent.pos.distanceTo(player)
      if (!agent.mission && agentState !== 'walking' && agent.talkTimer <= 0 && playerDistance < 8.5) {
        const desired = Math.atan2(store.player.x - agent.pos.x, store.player.z - agent.pos.z)
        const turn = Math.atan2(Math.sin(desired - agent.heading), Math.cos(desired - agent.heading))
        agent.heading += turn * Math.min(1, dt * 3.2)
        if (agent.glanceCooldown <= 0) {
          agent.glanceCooldown = 7 + Math.random() * 8
          if (playerDistance < 5.5) store.setPulse(`${agent.name} glances over as you pass through ${agent.placeName}.`)
        }
      }

      const walking = agentState === 'walking'
      const stride = Math.sin(state.clock.elapsedTime * (walking ? 7.6 : 1.2) * agent.pace + i * 0.83) * (walking ? 0.46 : 0.035)
      const base = agent.pos
      setLocalPart(torsoRef.current, i, dummy, base, agent.heading, [0, 0.04, 0], [0.22, walking ? 0.49 : 0.45, 0.17])
      setLocalPart(headRef.current, i, dummy, base, agent.heading, [0, 0.7, 0.025], [0.235, 0.235, 0.235])
      setLocalPart(hairRef.current, i, dummy, base, agent.heading, [0, 0.86, -0.02], [0.245, 0.105, 0.235])
      setLocalPart(eyeRef.current, i * 2, dummy, base, agent.heading, [-0.075, 0.73, 0.245], [0.022, 0.022, 0.012])
      setLocalPart(eyeRef.current, i * 2 + 1, dummy, base, agent.heading, [0.075, 0.73, 0.245], [0.022, 0.022, 0.012])
      setLocalPart(noseRef.current, i, dummy, base, agent.heading, [0, 0.675, 0.258], [0.025, 0.042, 0.026])
      setLocalPart(mouthRef.current, i, dummy, base, agent.heading, [0, 0.61, 0.248], [0.07, 0.011, 0.012])
      setLocalPart(chestRef.current, i, dummy, base, agent.heading, [0, 0.15, 0.177], [0.145, 0.18, 0.018])
      setLocalPart(bagRef.current, i, dummy, base, agent.heading, [0.19, 0.08, -0.13], [0.1, 0.22, 0.055])
      setLocalPart(legRef.current, i * 2, dummy, base, agent.heading, [-0.09, -0.43, 0], [0.055, 0.38, 0.055], stride)
      setLocalPart(legRef.current, i * 2 + 1, dummy, base, agent.heading, [0.09, -0.43, 0], [0.055, 0.38, 0.055], -stride)
      setLocalPart(armRef.current, i * 2, dummy, base, agent.heading, [-0.245, 0.13, 0.02], [0.047, 0.32, 0.047], -stride * 0.58)
      setLocalPart(armRef.current, i * 2 + 1, dummy, base, agent.heading, [0.245, 0.13, 0.02], [0.047, 0.32, 0.047], stride * 0.58)
      setLocalPart(shoeRef.current, i * 2, dummy, base, agent.heading, [-0.09, -0.84, 0.05], [0.065, 0.045, 0.105])
      setLocalPart(shoeRef.current, i * 2 + 1, dummy, base, agent.heading, [0.09, -0.84, 0.05], [0.065, 0.045, 0.105])
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
        if (a.pos.distanceTo(player) < 45) store.setPulse(`${a.name} and ${b.name} are talking near ${a.placeName}.`)
        break
      }
    }

    if (statsClock.current > 1.25) {
      statsClock.current = 0
      store.setStats({ talks })
      store.setPedestrianSamples(agents.map(agent => ({
        id: agent.id,
        x: agent.pos.x,
        z: agent.pos.z,
      })))
    }

    torsoRef.current.instanceMatrix.needsUpdate = true
    headRef.current.instanceMatrix.needsUpdate = true
    hairRef.current.instanceMatrix.needsUpdate = true
    eyeRef.current.instanceMatrix.needsUpdate = true
    noseRef.current.instanceMatrix.needsUpdate = true
    mouthRef.current.instanceMatrix.needsUpdate = true
    chestRef.current.instanceMatrix.needsUpdate = true
    bagRef.current.instanceMatrix.needsUpdate = true
    legRef.current.instanceMatrix.needsUpdate = true
    armRef.current.instanceMatrix.needsUpdate = true
    shoeRef.current.instanceMatrix.needsUpdate = true
  })

  useEffect(() => {
    const onKey = async (event) => {
      if (event.target?.closest?.('input, textarea, select, button')) return
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
      if (!best || bestDistance > 24 || best.playerCooldown > 0) {
        store.setPulse('No one is close enough to talk. Move nearer to a pedestrian and press E.')
        return
      }

      busy.current = true
      best.talk(6)
      best.playerCooldown = 2.2
      const agent = best.snapshot(places)
      store.openInteraction(agent)
      store.showDialogue({
        speaker: best.name,
        role: best.job,
        text: '말씀하세요. 제가 가능한 일인지 판단하고 움직일게요.',
        agent,
      })
      window.setTimeout(() => { busy.current = false }, 450)
    }

    const onNpcRequest = async (event) => {
      if (requestBusy.current) return
      const { agentId, text } = event.detail || {}
      const request = String(text || '').trim()
      if (!agentId || !request) return
      const best = agents.find(agent => agent.id === agentId)
      if (!best) return

      requestBusy.current = true
      const store = useCityStore.getState()
      const work = places.get(best.workId)
      const cityPlaces = [...places.values()].map(place => ({
        id: place.id,
        name: place.name,
        kind: place.kind,
        x: place.x,
        z: place.z,
      }))
      const distanceToWork = work ? Math.hypot(work.x - store.player.x, work.z - store.player.z) : 0
      const snapshot = best.snapshot(places)
      store.setInteraction({ status: 'thinking', request })
      store.showDialogue({ speaker: best.name, role: best.job, text: '잠깐 생각해볼게요...', agent: snapshot })

      const plan = await planLocalNPCAction(snapshot, request, {
        distanceToWork,
        timeLabel: `Day ${store.day}, ${formatTime(store.timeMinutes)}`,
        playerDistrict: store.player.district,
        player: { x: store.player.x, z: store.player.z },
        places: cityPlaces,
      })
      const updatedSnapshot = best.snapshot(places)

      if (plan.decision !== 'accept' || plan.mode === 'talk') {
        store.setInteraction({ status: 'done', plan })
        store.showDialogue({ speaker: best.name, role: best.job, text: plan.speech || fallbackLine(best), agent: updatedSnapshot })
        window.setTimeout(() => { requestBusy.current = false }, 700)
        return
      }

      const destination = destinationFromPlan(plan, best, places, request)
      const destinationTarget = entranceTargetFor(destination)
      const distance = Math.hypot(destinationTarget.x - store.player.x, destinationTarget.z - store.player.z)
      const mode = plan.mode === 'taxi' || distance > 420 ? 'taxi' : 'walk'
      const mission = {
        id: `${best.id}_${Date.now()}`,
        agentId: best.id,
        agentName: best.name,
        mode,
        phase: mode === 'taxi' ? 'to_pickup' : 'leading',
        destination: destinationTarget,
        pickup: nearestRoadPickup(best.pos, city.roads),
        steps: plan.steps,
        request,
      }

      best.mission = mission
      best.talk(2.4)
      store.setInteraction({ status: 'active', plan })
      store.startMission({
        agentId: best.id,
        agentName: best.name,
        mode,
        phase: mission.phase,
        destination: destinationTarget,
        steps: plan.steps,
        request,
        source: plan.source,
        summary: plan.speech,
      })
      store.showDialogue({ speaker: best.name, role: best.job, text: plan.speech, agent: updatedSnapshot })
      window.setTimeout(() => { requestBusy.current = false }, 700)
    }

    window.addEventListener('keydown', onKey)
    window.addEventListener('realcity:npc-request', onNpcRequest)
    return () => {
      window.removeEventListener('keydown', onKey)
      window.removeEventListener('realcity:npc-request', onNpcRequest)
    }
  }, [agents, city.roads, places])

  return (
    <>
      <instancedMesh ref={torsoRef} args={[undefined, undefined, agents.length]} castShadow frustumCulled={false}>
        <capsuleGeometry args={[1, 2, 4, 8]} />
        <meshStandardMaterial color="#ffffff" vertexColors roughness={0.82} metalness={0.02} />
      </instancedMesh>
      <instancedMesh ref={chestRef} args={[undefined, undefined, agents.length]} castShadow frustumCulled={false}>
        <boxGeometry args={[1, 1, 1]} />
        <meshStandardMaterial color="#ffffff" vertexColors roughness={0.64} metalness={0.04} />
      </instancedMesh>
      <instancedMesh ref={headRef} args={[undefined, undefined, agents.length]} castShadow frustumCulled={false}>
        <sphereGeometry args={[1, 10, 8]} />
        <meshStandardMaterial color="#efc29a" vertexColors roughness={0.72} />
      </instancedMesh>
      <instancedMesh ref={hairRef} args={[undefined, undefined, agents.length]} castShadow frustumCulled={false}>
        <sphereGeometry args={[1, 10, 6, 0, Math.PI * 2, 0, Math.PI * 0.56]} />
        <meshStandardMaterial color="#19130f" vertexColors roughness={0.9} />
      </instancedMesh>
      <instancedMesh ref={eyeRef} args={[undefined, undefined, agents.length * 2]} frustumCulled={false}>
        <sphereGeometry args={[1, 8, 6]} />
        <meshStandardMaterial color="#05070a" roughness={0.38} />
      </instancedMesh>
      <instancedMesh ref={noseRef} args={[undefined, undefined, agents.length]} castShadow frustumCulled={false}>
        <boxGeometry args={[1, 1, 1]} />
        <meshStandardMaterial color="#b98262" roughness={0.72} />
      </instancedMesh>
      <instancedMesh ref={mouthRef} args={[undefined, undefined, agents.length]} frustumCulled={false}>
        <boxGeometry args={[1, 1, 1]} />
        <meshStandardMaterial color="#6e2f2f" roughness={0.7} />
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
        <meshStandardMaterial color="#d7a17d" vertexColors roughness={0.7} />
      </instancedMesh>
      <instancedMesh ref={shoeRef} args={[undefined, undefined, agents.length * 2]} castShadow frustumCulled={false}>
        <boxGeometry args={[1, 1, 1]} />
        <meshStandardMaterial color="#10151c" roughness={0.82} />
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
