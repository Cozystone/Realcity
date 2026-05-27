import { useEffect, useMemo, useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import * as THREE from 'three'
import { terrainHeight, trafficSignalForAxis } from '../engine/cityEngine'
import { useCityStore } from '../engine/cityStore'
import { fallbackLine, llmStatus, matchRequestedPlace, planLocalNPCAction, styleNpcSpeech } from '../engine/localLLM'
import { makeProceduralTexture } from './proceduralTextures'

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
      address: destination.address,
      roadName: destination.roadName,
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
    address: destination.address,
    roadName: destination.roadName,
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

function nearCrosswalk(x, z, road, roads) {
  const crossRoads = roads.filter(item => item.axis !== road.axis)
  for (const cross of crossRoads) {
    if (road.axis === 'x') {
      if (Math.abs(x - cross.x) < Math.max(road.width, cross.width) * 0.72) return true
    } else if (Math.abs(z - cross.z) < Math.max(road.width, cross.width) * 0.72) {
      return true
    }
  }
  return false
}

function enforcePedestrianNorms(previous, next, roads = []) {
  let x = next.x
  let z = next.z

  for (const road of roads) {
    if (road.axis === 'x') {
      if (x < road.from || x > road.to) continue
      const lateral = z - road.z
      if (Math.abs(lateral) >= road.width / 2 - 0.35) continue
      if (nearCrosswalk(x, z, road, roads)) continue
      const previousSide = previous.z >= road.z ? 1 : -1
      z = road.z + previousSide * (road.width / 2 + 3.2)
    } else {
      if (z < road.from || z > road.to) continue
      const lateral = x - road.x
      if (Math.abs(lateral) >= road.width / 2 - 0.35) continue
      if (nearCrosswalk(x, z, road, roads)) continue
      const previousSide = previous.x >= road.x ? 1 : -1
      x = road.x + previousSide * (road.width / 2 + 3.2)
    }
  }

  return { x, z }
}

function moveAgentToward(agent, target, delta, speed, roads) {
  const dx = target.x - agent.pos.x
  const dz = target.z - agent.pos.z
  const distance = Math.hypot(dx, dz)
  if (distance <= 0.001) return 0

  const desired = Math.atan2(dx, dz)
  const turn = Math.atan2(Math.sin(desired - agent.heading), Math.cos(desired - agent.heading))
  agent.heading += turn * Math.min(1, delta * 3.5)
  const step = Math.min(distance, speed * delta)
  const previous = { x: agent.pos.x, z: agent.pos.z }
  const next = {
    x: agent.pos.x + Math.sin(agent.heading) * step,
    z: agent.pos.z + Math.cos(agent.heading) * step,
  }
  const safe = roads?.length ? enforcePedestrianNorms(previous, next, roads) : next
  agent.pos.x = safe.x
  agent.pos.z = safe.z
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
    this.bumpVelocity = new THREE.Vector2()
    this.bumpTimer = 0
    this.fallTimer = 0
  }

  update(delta, timeMinutes, places, roads) {
    this.socialCooldown = Math.max(0, this.socialCooldown - delta)
    this.playerCooldown = Math.max(0, this.playerCooldown - delta)
    this.glanceCooldown = Math.max(0, this.glanceCooldown - delta)
    if (this.fallTimer > 0) {
      this.fallTimer = Math.max(0, this.fallTimer - delta)
      this.applyBump(delta * 0.42, roads)
      this.activity = this.fallTimer > 0.25 ? 'knocked down' : 'getting back up'
      return 'fallen'
    }
    if (this.bumpTimer > 0) {
      this.bumpTimer = Math.max(0, this.bumpTimer - delta)
      this.applyBump(delta, roads)
      this.activity = 'stumbling after contact'
      return 'stumbling'
    }
    if (this.talkTimer > 0 && !this.mission) {
      this.talkTimer -= delta
      return 'talking'
    }
    if (this.talkTimer > 0) this.talkTimer -= delta

    if (this.mission) return this.updateMission(delta, roads)

    const target = targetFor(this, places, timeMinutes)
    this.activity = target.activity
    this.placeName = target.name

    const distance = Math.hypot(target.x - this.pos.x, target.z - this.pos.z)
    if (distance > 2.2) {
      const speed = (this.activity === 'commuting' ? 1.65 : 1.05) * this.pace
      moveAgentToward(this, target, delta, speed, roads)
      return 'walking'
    }

    this.heading += Math.sin(timeMinutes * 0.02 + this.id.length) * delta * 0.2
    return 'dwelling'
  }

  updateMission(delta, roads) {
    const store = useCityStore.getState()
    const mission = this.mission
    const destination = mission.destination
    this.placeName = destination.name

    if (mission.mode === 'taxi') {
      if (mission.phase === 'to_pickup') {
        this.activity = 'walking to taxi pickup'
        const distance = moveAgentToward(this, mission.pickup, delta, 1.9 * this.pace, roads)
        if (distance < 2.6) {
          mission.phase = 'taxi_boarding'
          mission.boardingAt = performance.now()
          store.updateMission({ phase: 'taxi_boarding', summary: `${this.name} is hailing a taxi at the curb.` })
          store.showDialogue({
            speaker: this.name,
            role: this.job,
            text: styleNpcSpeech(this, '여기서 택시를 잡을게요. 바로 같이 타고 제 일터로 이동하죠.'),
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
            label: `${this.name} and you are taking a taxi to ${destination.name}${destination.address ? `, ${destination.address}` : ''}.`,
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
          text: styleNpcSpeech(this, `도착했어요. 여기가 ${destination.name}입니다. 안으로 들어가려면 제가 먼저 안내할게요.`),
          agent: this.snapshot(),
        })
        this.mission = null
        return 'dwelling'
      }
    }

    this.activity = 'guiding player'
    const distance = moveAgentToward(this, destination, delta, 1.72 * this.pace, roads)
    if (distance < 3.2) {
      this.pos.set(destination.x + 2.2, terrainHeight(destination.x, destination.z) + 0.95, destination.z + 2.2)
      store.finishMission(`${this.name} guided you to ${destination.name}.`)
      store.showDialogue({
        speaker: this.name,
        role: this.job,
        text: styleNpcSpeech(this, `도착했어요. 여기가 ${destination.name}입니다. 제가 일하는 곳이에요.`),
        agent: this.snapshot(),
      })
      this.mission = null
      return 'dwelling'
    }
    return 'walking'
  }

  applyBump(delta, roads) {
    if (this.bumpVelocity.lengthSq() < 0.002) return
    const previous = { x: this.pos.x, z: this.pos.z }
    const next = {
      x: this.pos.x + this.bumpVelocity.x * delta,
      z: this.pos.z + this.bumpVelocity.y * delta,
    }
    const safe = roads?.length ? enforcePedestrianNorms(previous, next, roads) : next
    this.pos.x = safe.x
    this.pos.z = safe.z
    this.pos.y = terrainHeight(this.pos.x, this.pos.z) + 0.95
    this.bumpVelocity.multiplyScalar(Math.exp(-delta * 4.5))
  }

  bumpFrom(sourceX, sourceZ, impulse = 0.7) {
    const dx = this.pos.x - sourceX
    const dz = this.pos.z - sourceZ
    const distance = Math.hypot(dx, dz)
    const nx = distance > 0.001 ? dx / distance : Math.sin(hashValue(this.id) * 0.1)
    const nz = distance > 0.001 ? dz / distance : Math.cos(hashValue(this.id) * 0.1)
    const force = 2.3 + impulse * 3.2
    this.bumpVelocity.x += nx * force
    this.bumpVelocity.y += nz * force
    this.bumpTimer = Math.max(this.bumpTimer, 0.42 + impulse * 0.18)
    if (impulse > 1.02) this.fallTimer = Math.max(this.fallTimer, 1.05 + Math.min(0.65, impulse * 0.28))
    this.talk(0.85)
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
      speechStyle: this.speechStyle,
      voice: this.voice,
      gestureStyle: this.gestureStyle,
      personaSignature: this.personaSignature,
      appearance: this.appearance,
      styleBrief: this.styleBrief,
      activity: this.activity,
      placeName: this.placeName,
      workId: this.workId,
      workName: work?.name,
      workAddress: work?.address,
      thirdId: this.thirdId,
      thirdName: third?.name,
      thirdAddress: third?.address,
      homeAddress: this.home?.address,
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
      best = { x, z, y: terrainHeight(x, z), name: `${road.name} curb`, roadName: road.name }
    }
  }
  return best || { x: pos.x + 4, z: pos.z + 4, y: terrainHeight(pos.x + 4, pos.z + 4), name: 'curbside' }
}

function normalizeRouteText(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/[^a-z0-9가-힣]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function placeMatchesText(place, text) {
  const normalized = normalizeRouteText(text)
  const raw = String(text || '').toLowerCase()
  return [place.id, place.name, place.kind, place.address, place.roadName, place.district, place.buildingType].some(value => {
    if (!value) return false
    const candidate = String(value).toLowerCase()
    const normalizedCandidate = normalizeRouteText(value)
    return raw.includes(candidate) || (normalizedCandidate && normalized.includes(normalizedCandidate))
  })
}

function routePlacesForRequest(request, city, player) {
  const landmarks = city.landmarks || []
  const addresses = city.addressBook || []
  const explicitAddresses = addresses.filter(place => placeMatchesText(place, request)).slice(0, 36)
  const nearbyAddresses = [...addresses]
    .sort((a, b) => Math.hypot(a.x - player.x, a.z - player.z) - Math.hypot(b.x - player.x, b.z - player.z))
    .slice(0, 18)
  const merged = new Map()

  for (const place of [...explicitAddresses, ...landmarks, ...nearbyAddresses]) {
    merged.set(place.id, {
      id: place.id,
      name: place.name,
      kind: place.kind,
      address: place.address,
      roadName: place.roadName,
      district: place.district,
      buildingType: place.buildingType,
      x: place.x,
      z: place.z,
    })
  }

  return [...merged.values()]
}

function destinationFromPlan(plan, agent, places, request = '', destinations = places) {
  if (plan.destination === 'named_place') {
    const placeList = [...destinations.values()]
    const targetId = typeof plan.targetPlaceId === 'string' ? plan.targetPlaceId : ''
    const targetName = typeof plan.targetPlaceName === 'string' ? plan.targetPlaceName : ''
    const byId = targetId ? (destinations.get(targetId) || places.get(targetId)) : null
    if (byId) return byId

    if (targetName) {
      const normalizedName = normalizeRouteText(targetName)
      const byName = placeList.find(place => [place.id, place.name, place.kind, place.address, place.roadName, place.district, place.buildingType].some(value => {
        const normalizedValue = normalizeRouteText(value)
        return normalizedValue && (normalizedValue.includes(normalizedName) || normalizedName.includes(normalizedValue))
      }))
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
  if (agent.appearance?.skinColor) return agent.appearance.skinColor
  const tones = ['#f0c49b', '#d8a17d', '#b98262', '#efd2b3', '#9f6a4f']
  return tones[hashValue(agent.id) % tones.length]
}

function hairTone(agent) {
  if (agent.appearance?.hairColor) return agent.appearance.hairColor
  const tones = ['#17100b', '#2b1b12', '#4b3527', '#111318', '#6b5949']
  return tones[hashValue(`${agent.id}_hair`) % tones.length]
}

function agentLook(agent) {
  return agent.appearance || {
    heightScale: 1,
    shoulderScale: 1,
    bodyScale: 1,
    legScale: 1,
    headScale: 1,
    walkStyle: { id: 'default', cadence: 1, stride: 1, armSwing: 1, speed: 1 },
    bodyArchetype: 'average_relaxed',
    outfitPattern: 'solid',
    outerwear: 'overshirt',
    accessory: 'none',
    glassesStyle: 'none',
    scarfStyle: 'none',
    hairStyle: 'short',
    hatStyle: 'none',
    bagStyle: 'backpack',
    bottomStyle: 'pants',
    topColor: agent.color || '#2f6f9f',
    jacketColor: '#d9e2ea',
    pantsColor: '#1f2937',
    shoeColor: '#10151c',
    accessoryColor: '#473120',
  }
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

function distanceToSignalStop(car, pose, roads) {
  const crossRoads = roads.filter(road => road.axis !== car.road.axis && road.main)
  let nearest = Infinity
  for (const cross of crossRoads) {
    if (car.road.axis === 'x') {
      if (cross.x < car.road.from || cross.x > car.road.to) continue
      const distance = car.direction > 0 ? cross.x - pose.x : pose.x - cross.x
      if (distance > 0 && distance < nearest) nearest = distance
    } else {
      if (cross.z < car.road.from || cross.z > car.road.to) continue
      const distance = car.direction > 0 ? cross.z - pose.z : pose.z - cross.z
      if (distance > 0 && distance < nearest) nearest = distance
    }
  }
  return nearest
}

function shouldStopForSignal(car, pose, roads, timeMinutes) {
  const signal = trafficSignalForAxis(car.road.axis, timeMinutes)
  if (signal === 'green') return null
  const stopDistance = distanceToSignalStop(car, pose, roads)
  if (stopDistance > 4 && stopDistance < 30) return { signal, stopDistance }
  return null
}

function pointInVehicleBody(pose, dim, point, padding = 0.72) {
  const dx = point.x - pose.x
  const dz = point.z - pose.z
  const cos = Math.cos(pose.yaw)
  const sin = Math.sin(pose.yaw)
  const localX = dx * cos - dz * sin
  const localZ = dx * sin + dz * cos
  return Math.abs(localX) < dim.width / 2 + padding && Math.abs(localZ) < dim.length / 2 + padding
}

function Traffic({ cars, roads }) {
  const bodyRef = useRef()
  const cabinRef = useRef()
  const windshieldRef = useRef()
  const sideWindowRef = useRef()
  const wheelRef = useRef()
  const wheelHubRef = useRef()
  const headlightRef = useRef()
  const tailLightRef = useRef()
  const bumperRef = useRef()
  const grilleRef = useRef()
  const mirrorRef = useRef()
  const licenseRef = useRef()
  const taxiSignRef = useRef()
  const driverRef = useRef()
  const dummy = useMemo(() => new THREE.Object3D(), [])
  const color = useMemo(() => new THREE.Color(), [])
  const colorsReady = useRef(false)
  const yieldPulse = useRef(0)
  const vehicleSampleClock = useRef(0)
  const textures = useMemo(() => ({
    paint: makeProceduralTexture('vehicle-paint', { size: 128, seed: 501, repeatX: 1.6, repeatY: 1.2 }),
    glass: makeProceduralTexture('glass-smudge', { size: 128, seed: 502, repeatX: 1.2, repeatY: 1.2 }),
    rubber: makeProceduralTexture('rubber-tread', { size: 128, seed: 503, repeatX: 1.8, repeatY: 1.8 }),
    metal: makeProceduralTexture('brushed-metal', { size: 128, seed: 504, repeatX: 2.2, repeatY: 0.8 }),
    skin: makeProceduralTexture('skin-pores', { size: 128, seed: 505, repeatX: 1.2, repeatY: 1.2 }),
    paper: makeProceduralTexture('paper-plate', { size: 128, seed: 506, repeatX: 1.1, repeatY: 1.1 }),
  }), [])

  useFrame((state, delta) => {
    if (!bodyRef.current || !cabinRef.current || !windshieldRef.current || !sideWindowRef.current || !wheelRef.current || !wheelHubRef.current || !headlightRef.current || !tailLightRef.current || !bumperRef.current || !grilleRef.current || !mirrorRef.current || !licenseRef.current || !taxiSignRef.current || !driverRef.current) return
    const dt = Math.min(delta, 0.05)
    const store = useCityStore.getState()
    const pedestrians = [
      { x: store.player.x, z: store.player.z, player: true },
      ...(store.pedestrianSamples || []),
    ]
    yieldPulse.current = Math.max(0, yieldPulse.current - dt)
    vehicleSampleClock.current += dt
    const vehicleSamples = []

    if (!colorsReady.current) {
      cars.forEach((car, i) => bodyRef.current.setColorAt(i, color.set(car.color)))
      if (bodyRef.current.instanceColor) bodyRef.current.instanceColor.needsUpdate = true
      colorsReady.current = true
    }

    for (let i = 0; i < cars.length; i += 1) {
      const car = cars[i]
      const dim = car.dimensions || { width: 2.05, height: 0.72, length: 4.35, cabinLength: 1.82, cabinHeight: 0.58 }
      const currentPose = trafficPose(car)
      const playerContact = pointInVehicleBody(currentPose, dim, store.player, 0.74)
      const hazard = shouldYieldToPedestrian(car, currentPose, pedestrians)
      const signalStop = shouldStopForSignal(car, currentPose, roads, store.timeMinutes)
      const shouldBrake = hazard || signalStop || playerContact
      car.brake = shouldBrake
        ? Math.min(1, (car.brake || 0) + dt * (playerContact || signalStop ? 5.2 : car.driverTemperament === 'hurried' ? 2.8 : 4.2))
        : Math.max(0, (car.brake || 0) - dt * 1.45)
      if (playerContact && yieldPulse.current <= 0) {
        yieldPulse.current = 3.5
        store.setPulse(`${car.kind === 'taxi' ? 'A taxi driver' : 'A driver'} hits the brakes as you crowd the lane.`)
      }
      if (hazard?.player && yieldPulse.current <= 0) {
        yieldPulse.current = 5
        store.setPulse(`${car.kind === 'taxi' ? 'A taxi' : 'A driver'} yields as you step into the lane.`)
      }
      if (signalStop && yieldPulse.current <= 0) {
        yieldPulse.current = 4
        store.setPulse(`${car.kind === 'taxi' ? 'A taxi' : 'Traffic'} stops for a ${signalStop.signal} light on ${car.road.name}.`)
      }
      const wave = 0.82 + Math.sin(state.clock.elapsedTime * 0.23 + car.phase) * 0.18
      const speedFactor = Math.max(0, 1 - car.brake * 0.98)
      car.t = (car.t + (car.speed * wave * speedFactor * dt) / Math.max(1, car.road.to - car.road.from)) % 1
      const { x, z, yaw } = trafficPose(car)

      vehicleSamples.push({
        id: car.id,
        kind: car.kind,
        bodyStyle: car.bodyStyle,
        x,
        z,
        yaw,
        width: dim.width,
        length: dim.length,
        speed: Number((car.speed * speedFactor).toFixed(3)),
        brake: Number((car.brake || 0).toFixed(3)),
      })

      const y = terrainHeight(x, z) + 0.55
      const base = { x, y, z }
      const front = dim.length / 2
      const rear = -dim.length / 2
      const wheelX = dim.width * 0.55
      const wheelZ = dim.length * 0.34
      const cabinZ = car.bodyStyle === 'van' || car.bodyStyle === 'minivan' ? -0.18 : car.bodyStyle === 'coupe' ? -0.34 : -0.12
      setLocalPart(bodyRef.current, i, dummy, base, yaw, [0, 0, 0], [dim.width, dim.height, dim.length])
      setLocalPart(cabinRef.current, i, dummy, base, yaw, [0, dim.height * 0.76, cabinZ], [dim.width * 0.72, dim.cabinHeight, dim.cabinLength])
      setLocalPart(windshieldRef.current, i * 2, dummy, base, yaw, [0, dim.height + dim.cabinHeight * 0.2, cabinZ + dim.cabinLength * 0.52], [dim.width * 0.56, dim.cabinHeight * 0.46, 0.04], -0.22)
      setLocalPart(windshieldRef.current, i * 2 + 1, dummy, base, yaw, [0, dim.height + dim.cabinHeight * 0.18, cabinZ - dim.cabinLength * 0.52], [dim.width * 0.5, dim.cabinHeight * 0.42, 0.04], 0.18)
      setLocalPart(sideWindowRef.current, i * 2, dummy, base, yaw, [-dim.width * 0.38, dim.height + dim.cabinHeight * 0.18, cabinZ], [0.045, dim.cabinHeight * 0.52, dim.cabinLength * 0.58])
      setLocalPart(sideWindowRef.current, i * 2 + 1, dummy, base, yaw, [dim.width * 0.38, dim.height + dim.cabinHeight * 0.18, cabinZ], [0.045, dim.cabinHeight * 0.52, dim.cabinLength * 0.58])
      setLocalPart(driverRef.current, i, dummy, base, yaw, [-dim.width * 0.16, dim.height + dim.cabinHeight * 0.48, cabinZ + 0.1], [0.2, 0.24, 0.2])
      setLocalPart(wheelRef.current, i * 4, dummy, base, yaw, [-wheelX, -0.34, wheelZ], [0.36, 0.22, 0.36], 0, Math.PI / 2)
      setLocalPart(wheelRef.current, i * 4 + 1, dummy, base, yaw, [wheelX, -0.34, wheelZ], [0.36, 0.22, 0.36], 0, Math.PI / 2)
      setLocalPart(wheelRef.current, i * 4 + 2, dummy, base, yaw, [-wheelX, -0.34, -wheelZ], [0.36, 0.22, 0.36], 0, Math.PI / 2)
      setLocalPart(wheelRef.current, i * 4 + 3, dummy, base, yaw, [wheelX, -0.34, -wheelZ], [0.36, 0.22, 0.36], 0, Math.PI / 2)
      setLocalPart(wheelHubRef.current, i * 4, dummy, base, yaw, [-wheelX - 0.012, -0.34, wheelZ], [0.19, 0.035, 0.19], 0, Math.PI / 2)
      setLocalPart(wheelHubRef.current, i * 4 + 1, dummy, base, yaw, [wheelX + 0.012, -0.34, wheelZ], [0.19, 0.035, 0.19], 0, Math.PI / 2)
      setLocalPart(wheelHubRef.current, i * 4 + 2, dummy, base, yaw, [-wheelX - 0.012, -0.34, -wheelZ], [0.19, 0.035, 0.19], 0, Math.PI / 2)
      setLocalPart(wheelHubRef.current, i * 4 + 3, dummy, base, yaw, [wheelX + 0.012, -0.34, -wheelZ], [0.19, 0.035, 0.19], 0, Math.PI / 2)
      setLocalPart(headlightRef.current, i * 2, dummy, base, yaw, [-dim.width * 0.27, 0.08, front + 0.035], [0.24, 0.14, 0.08])
      setLocalPart(headlightRef.current, i * 2 + 1, dummy, base, yaw, [dim.width * 0.27, 0.08, front + 0.035], [0.24, 0.14, 0.08])
      setLocalPart(tailLightRef.current, i * 2, dummy, base, yaw, [-dim.width * 0.28, 0.05, rear - 0.035], [0.22 + car.brake * 0.18, 0.12 + car.brake * 0.12, 0.08])
      setLocalPart(tailLightRef.current, i * 2 + 1, dummy, base, yaw, [dim.width * 0.28, 0.05, rear - 0.035], [0.22 + car.brake * 0.18, 0.12 + car.brake * 0.12, 0.08])
      setLocalPart(bumperRef.current, i * 2, dummy, base, yaw, [0, -0.04, front + 0.08], [dim.width * 0.84, 0.16, 0.11])
      setLocalPart(bumperRef.current, i * 2 + 1, dummy, base, yaw, [0, -0.04, rear - 0.08], [dim.width * 0.84, 0.16, 0.11])
      setLocalPart(grilleRef.current, i, dummy, base, yaw, [0, 0.11, front + 0.1], [dim.width * 0.42, 0.16, 0.035])
      setLocalPart(mirrorRef.current, i * 2, dummy, base, yaw, [-dim.width * 0.58, dim.height * 0.72, dim.length * 0.14], [0.075, 0.075, 0.18])
      setLocalPart(mirrorRef.current, i * 2 + 1, dummy, base, yaw, [dim.width * 0.58, dim.height * 0.72, dim.length * 0.14], [0.075, 0.075, 0.18])
      setLocalPart(licenseRef.current, i * 2, dummy, base, yaw, [0, 0.12, front + 0.125], [0.5, 0.13, 0.025])
      setLocalPart(licenseRef.current, i * 2 + 1, dummy, base, yaw, [0, 0.12, rear - 0.125], [0.5, 0.13, 0.025])
      setLocalPart(taxiSignRef.current, i, dummy, base, yaw, [0, dim.height + dim.cabinHeight + 0.05, cabinZ - 0.08], car.kind === 'taxi' ? [0.9, 0.18, 0.45] : [0.001, 0.001, 0.001])
    }

    if (vehicleSampleClock.current > 0.14) {
      vehicleSampleClock.current = 0
      store.setVehicleSamples(vehicleSamples)
    }

    bodyRef.current.instanceMatrix.needsUpdate = true
    cabinRef.current.instanceMatrix.needsUpdate = true
    windshieldRef.current.instanceMatrix.needsUpdate = true
    sideWindowRef.current.instanceMatrix.needsUpdate = true
    driverRef.current.instanceMatrix.needsUpdate = true
    wheelRef.current.instanceMatrix.needsUpdate = true
    wheelHubRef.current.instanceMatrix.needsUpdate = true
    headlightRef.current.instanceMatrix.needsUpdate = true
    tailLightRef.current.instanceMatrix.needsUpdate = true
    bumperRef.current.instanceMatrix.needsUpdate = true
    grilleRef.current.instanceMatrix.needsUpdate = true
    mirrorRef.current.instanceMatrix.needsUpdate = true
    licenseRef.current.instanceMatrix.needsUpdate = true
    taxiSignRef.current.instanceMatrix.needsUpdate = true
  })

  return (
    <>
      <instancedMesh ref={bodyRef} args={[undefined, undefined, cars.length]} castShadow frustumCulled={false}>
        <boxGeometry args={[1, 1, 1]} />
        <meshPhysicalMaterial map={textures.paint} color="#ffffff" vertexColors roughness={0.24} metalness={0.42} clearcoat={0.7} clearcoatRoughness={0.18} envMapIntensity={1.1} />
      </instancedMesh>
      <instancedMesh ref={cabinRef} args={[undefined, undefined, cars.length]} castShadow frustumCulled={false}>
        <boxGeometry args={[1, 1, 1]} />
        <meshPhysicalMaterial map={textures.glass} color="#111923" roughness={0.08} metalness={0.28} clearcoat={1} clearcoatRoughness={0.05} envMapIntensity={1.45} />
      </instancedMesh>
      <instancedMesh ref={windshieldRef} args={[undefined, undefined, cars.length * 2]} frustumCulled={false}>
        <boxGeometry args={[1, 1, 1]} />
        <meshPhysicalMaterial map={textures.glass} color="#9edcff" roughness={0.035} metalness={0.12} transparent opacity={0.72} clearcoat={1} clearcoatRoughness={0.03} envMapIntensity={1.8} />
      </instancedMesh>
      <instancedMesh ref={sideWindowRef} args={[undefined, undefined, cars.length * 2]} frustumCulled={false}>
        <boxGeometry args={[1, 1, 1]} />
        <meshPhysicalMaterial map={textures.glass} color="#83c7e7" roughness={0.04} metalness={0.16} transparent opacity={0.68} clearcoat={1} envMapIntensity={1.7} />
      </instancedMesh>
      <instancedMesh ref={driverRef} args={[undefined, undefined, cars.length]} castShadow frustumCulled={false}>
        <sphereGeometry args={[1, 14, 10]} />
        <meshStandardMaterial map={textures.skin} color="#d4a17d" roughness={0.7} />
      </instancedMesh>
      <instancedMesh ref={wheelRef} args={[undefined, undefined, cars.length * 4]} castShadow frustumCulled={false}>
        <cylinderGeometry args={[1, 1, 1, 18]} />
        <meshStandardMaterial map={textures.rubber} color="#08090b" roughness={0.56} metalness={0.18} />
      </instancedMesh>
      <instancedMesh ref={wheelHubRef} args={[undefined, undefined, cars.length * 4]} castShadow frustumCulled={false}>
        <cylinderGeometry args={[1, 1, 1, 16]} />
        <meshStandardMaterial map={textures.metal} color="#c8cdd0" roughness={0.24} metalness={0.72} />
      </instancedMesh>
      <instancedMesh ref={headlightRef} args={[undefined, undefined, cars.length * 2]} frustumCulled={false}>
        <boxGeometry args={[1, 1, 1]} />
        <meshStandardMaterial color="#fff8df" emissive="#ffe08a" emissiveIntensity={1.45} roughness={0.18} />
      </instancedMesh>
      <instancedMesh ref={tailLightRef} args={[undefined, undefined, cars.length * 2]} frustumCulled={false}>
        <boxGeometry args={[1, 1, 1]} />
        <meshStandardMaterial color="#ff2b2b" emissive="#ff1d18" emissiveIntensity={1.2} roughness={0.24} />
      </instancedMesh>
      <instancedMesh ref={bumperRef} args={[undefined, undefined, cars.length * 2]} castShadow frustumCulled={false}>
        <boxGeometry args={[1, 1, 1]} />
        <meshStandardMaterial map={textures.metal} color="#cfd4d8" roughness={0.26} metalness={0.7} />
      </instancedMesh>
      <instancedMesh ref={grilleRef} args={[undefined, undefined, cars.length]} frustumCulled={false}>
        <boxGeometry args={[1, 1, 1]} />
        <meshStandardMaterial map={textures.metal} color="#15191d" roughness={0.32} metalness={0.42} />
      </instancedMesh>
      <instancedMesh ref={mirrorRef} args={[undefined, undefined, cars.length * 2]} castShadow frustumCulled={false}>
        <boxGeometry args={[1, 1, 1]} />
        <meshStandardMaterial map={textures.glass} color="#12171d" roughness={0.18} metalness={0.36} />
      </instancedMesh>
      <instancedMesh ref={licenseRef} args={[undefined, undefined, cars.length * 2]} frustumCulled={false}>
        <boxGeometry args={[1, 1, 1]} />
        <meshStandardMaterial map={textures.paper} color="#f5f1df" roughness={0.42} metalness={0.08} />
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
  const destinations = useMemo(() => new Map([...city.landmarks, ...(city.addressBook || [])].map(place => [place.id, place])), [city.landmarks, city.addressBook])
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
  const neckRef = useRef()
  const headRef = useRef()
  const legRef = useRef()
  const armRef = useRef()
  const sleeveRef = useRef()
  const hairRef = useRef()
  const eyeRef = useRef()
  const browRef = useRef()
  const noseRef = useRef()
  const mouthRef = useRef()
  const shoeRef = useRef()
  const chestRef = useRef()
  const beltRef = useRef()
  const bagRef = useRef()
  const handRef = useRef()
  const earRef = useRef()
  const hatRef = useRef()
  const skirtRef = useRef()
  const glassesRef = useRef()
  const scarfRef = useRef()
  const dummy = useMemo(() => new THREE.Object3D(), [])
  const color = useMemo(() => new THREE.Color(), [])
  const colorsReady = useRef(false)
  const socialClock = useRef(0)
  const statsClock = useRef(0)
  const nearbyClock = useRef(0)
  const busy = useRef(false)
  const requestBusy = useRef(false)
  const textures = useMemo(() => ({
    fabric: makeProceduralTexture('city-fabric', { size: 128, seed: 701, repeatX: 2.1, repeatY: 2.1 }),
    skin: makeProceduralTexture('skin-pores', { size: 128, seed: 702, repeatX: 1.4, repeatY: 1.4 }),
    hair: makeProceduralTexture('hair-strands', { size: 128, seed: 703, repeatX: 2.4, repeatY: 1.2 }),
    rubber: makeProceduralTexture('rubber-tread', { size: 128, seed: 704, repeatX: 1.8, repeatY: 1.8 }),
    metal: makeProceduralTexture('brushed-metal', { size: 128, seed: 705, repeatX: 1.8, repeatY: 0.9 }),
    glass: makeProceduralTexture('glass-smudge', { size: 128, seed: 706, repeatX: 1.2, repeatY: 1.2 }),
  }), [])

  useEffect(() => {
    useCityStore.getState().setStats({ npcs: agents.length, cars: city.cars.length, tiles: city.tiles.length, llm: llmStatus() })
  }, [agents.length, city.cars.length, city.tiles.length])

  useFrame((state, delta) => {
    if (!torsoRef.current || !neckRef.current || !headRef.current || !legRef.current || !armRef.current || !sleeveRef.current || !hairRef.current || !eyeRef.current || !browRef.current || !noseRef.current || !mouthRef.current || !shoeRef.current || !chestRef.current || !beltRef.current || !bagRef.current || !handRef.current || !earRef.current || !hatRef.current || !skirtRef.current || !glassesRef.current || !scarfRef.current) return
    const dt = Math.min(delta, 0.05)
    const store = useCityStore.getState()
    const time = store.timeMinutes
    let talks = 0
    let nearestAgent = null
    let nearestDistance = Infinity
    const player = new THREE.Vector3(store.player.x, store.player.y, store.player.z)

    if (!colorsReady.current) {
      agents.forEach((agent, i) => {
        const look = agentLook(agent)
        torsoRef.current.setColorAt(i, color.set(look.topColor))
        chestRef.current.setColorAt(i, color.set(look.jacketColor))
        neckRef.current.setColorAt(i, color.set(skinTone(agent)))
        headRef.current.setColorAt(i, color.set(skinTone(agent)))
        hairRef.current.setColorAt(i, color.set(hairTone(agent)))
        armRef.current.setColorAt(i * 2, color.set(skinTone(agent)))
        armRef.current.setColorAt(i * 2 + 1, color.set(skinTone(agent)))
        sleeveRef.current.setColorAt(i * 2, color.set(look.topColor))
        sleeveRef.current.setColorAt(i * 2 + 1, color.set(look.topColor))
        handRef.current.setColorAt(i * 2, color.set(skinTone(agent)))
        handRef.current.setColorAt(i * 2 + 1, color.set(skinTone(agent)))
        earRef.current.setColorAt(i * 2, color.set(skinTone(agent)))
        earRef.current.setColorAt(i * 2 + 1, color.set(skinTone(agent)))
        browRef.current.setColorAt(i * 2, color.set(hairTone(agent)))
        browRef.current.setColorAt(i * 2 + 1, color.set(hairTone(agent)))
        legRef.current.setColorAt(i * 2, color.set(look.pantsColor))
        legRef.current.setColorAt(i * 2 + 1, color.set(look.pantsColor))
        shoeRef.current.setColorAt(i * 2, color.set(look.shoeColor))
        shoeRef.current.setColorAt(i * 2 + 1, color.set(look.shoeColor))
        beltRef.current.setColorAt(i, color.set(look.accessoryColor))
        bagRef.current.setColorAt(i, color.set(look.accessoryColor))
        hatRef.current.setColorAt(i, color.set(look.accessoryColor))
        skirtRef.current.setColorAt(i, color.set(look.pantsColor))
        scarfRef.current.setColorAt(i, color.set(look.accessoryColor))
      })
      if (torsoRef.current.instanceColor) torsoRef.current.instanceColor.needsUpdate = true
      if (chestRef.current.instanceColor) chestRef.current.instanceColor.needsUpdate = true
      if (neckRef.current.instanceColor) neckRef.current.instanceColor.needsUpdate = true
      if (headRef.current.instanceColor) headRef.current.instanceColor.needsUpdate = true
      if (hairRef.current.instanceColor) hairRef.current.instanceColor.needsUpdate = true
      if (armRef.current.instanceColor) armRef.current.instanceColor.needsUpdate = true
      if (sleeveRef.current.instanceColor) sleeveRef.current.instanceColor.needsUpdate = true
      if (handRef.current.instanceColor) handRef.current.instanceColor.needsUpdate = true
      if (earRef.current.instanceColor) earRef.current.instanceColor.needsUpdate = true
      if (browRef.current.instanceColor) browRef.current.instanceColor.needsUpdate = true
      if (legRef.current.instanceColor) legRef.current.instanceColor.needsUpdate = true
      if (shoeRef.current.instanceColor) shoeRef.current.instanceColor.needsUpdate = true
      if (beltRef.current.instanceColor) beltRef.current.instanceColor.needsUpdate = true
      if (bagRef.current.instanceColor) bagRef.current.instanceColor.needsUpdate = true
      if (hatRef.current.instanceColor) hatRef.current.instanceColor.needsUpdate = true
      if (skirtRef.current.instanceColor) skirtRef.current.instanceColor.needsUpdate = true
      if (scarfRef.current.instanceColor) scarfRef.current.instanceColor.needsUpdate = true
      colorsReady.current = true
    }

    for (let i = 0; i < agents.length; i += 1) {
      const agent = agents[i]
      const agentState = agent.update(dt, time, places, city.roads)
      if (agentState === 'talking') talks += 1
      const playerDistance = agent.pos.distanceTo(player)
      if (!agent.mission && playerDistance < nearestDistance) {
        nearestAgent = agent
        nearestDistance = playerDistance
      }
      if (!agent.mission && agentState !== 'walking' && agent.talkTimer <= 0 && playerDistance < 8.5) {
        const desired = Math.atan2(store.player.x - agent.pos.x, store.player.z - agent.pos.z)
        const turn = Math.atan2(Math.sin(desired - agent.heading), Math.cos(desired - agent.heading))
        agent.heading += turn * Math.min(1, dt * 3.2)
        if (agent.glanceCooldown <= 0) {
          agent.glanceCooldown = 7 + Math.random() * 8
          if (playerDistance < 5.5) store.setPulse(`${agent.name} glances over as you pass through ${agent.placeName}.`)
        }
      }

      const fallen = agentState === 'fallen'
      const stumbling = agentState === 'stumbling'
      const fallSide = hashValue(agent.id) % 2 === 0 ? 1 : -1
      const stumbleLean = stumbling ? Math.sin(state.clock.elapsedTime * 18 + i) * 0.22 : 0
      const base = fallen
        ? { x: agent.pos.x, y: agent.pos.y - 0.46, z: agent.pos.z }
        : agent.pos
      const bodyRotX = fallen ? 1.12 : 0
      const bodyRotZ = fallen ? fallSide * 0.72 : stumbleLean
      const look = agentLook(agent)
      const walking = agentState === 'walking'
      const walk = look.walkStyle || { cadence: 1, stride: 1, armSwing: 1 }
      const stride = Math.sin(state.clock.elapsedTime * (walking ? 7.6 : 1.2) * agent.pace * (walk.cadence || 1) + i * 0.83) * (walking ? 0.46 * (walk.stride || 1) : 0.035)
      const armSwing = walk.armSwing || 1
      const height = look.heightScale || 1
      const shoulder = look.shoulderScale || 1
      const bodyScale = look.bodyScale || 1
      const legScale = look.legScale || 1
      const headScale = look.headScale || 1
      const hairLong = look.hairStyle === 'long' || look.hairStyle === 'bob'
      const hairBun = look.hairStyle === 'bun'
      const hatVisible = (look.hatStyle && look.hatStyle !== 'none') || look.hairStyle === 'cap'
      const bagVisible = look.bagStyle && look.bagStyle !== 'none'
      const skirtVisible = look.bottomStyle === 'skirt'
      const glassesVisible = look.glassesStyle && look.glassesStyle !== 'none'
      const scarfVisible = look.scarfStyle && look.scarfStyle !== 'none'
      setLocalPart(torsoRef.current, i, dummy, base, agent.heading, [0, 0.04 * height, 0], [0.2 * shoulder, (walking ? 0.5 : 0.46) * height * bodyScale, 0.16 * bodyScale], bodyRotX, bodyRotZ)
      setLocalPart(neckRef.current, i, dummy, base, agent.heading, [0, 0.49 * height, 0.01], [0.075 * headScale, 0.105 * height, 0.075 * headScale], bodyRotX * 0.82, bodyRotZ)
      setLocalPart(headRef.current, i, dummy, base, agent.heading, [0, 0.72 * height, 0.025], [0.22 * headScale, 0.24 * headScale, 0.22 * headScale], bodyRotX * 0.68, bodyRotZ)
      setLocalPart(hairRef.current, i, dummy, base, agent.heading, [0, (hairLong ? 0.82 : 0.87) * height, hairLong ? -0.055 : -0.02], [0.245 * headScale, (hairBun ? 0.15 : hairLong ? 0.22 : 0.105) * headScale, 0.24 * headScale], bodyRotX * 0.68, bodyRotZ)
      setLocalPart(earRef.current, i * 2, dummy, base, agent.heading, [-0.22 * headScale, 0.72 * height, 0.02], [0.026, 0.038, 0.018])
      setLocalPart(earRef.current, i * 2 + 1, dummy, base, agent.heading, [0.22 * headScale, 0.72 * height, 0.02], [0.026, 0.038, 0.018])
      setLocalPart(eyeRef.current, i * 2, dummy, base, agent.heading, [-0.072 * headScale, 0.75 * height, 0.225], [0.021, 0.021, 0.012])
      setLocalPart(eyeRef.current, i * 2 + 1, dummy, base, agent.heading, [0.072 * headScale, 0.75 * height, 0.225], [0.021, 0.021, 0.012])
      setLocalPart(browRef.current, i * 2, dummy, base, agent.heading, [-0.072 * headScale, 0.792 * height, 0.231], [0.055, 0.008, 0.01], 0, -0.08)
      setLocalPart(browRef.current, i * 2 + 1, dummy, base, agent.heading, [0.072 * headScale, 0.792 * height, 0.231], [0.055, 0.008, 0.01], 0, 0.08)
      setLocalPart(noseRef.current, i, dummy, base, agent.heading, [0, 0.695 * height, 0.246], [0.024, 0.04, 0.024])
      setLocalPart(mouthRef.current, i, dummy, base, agent.heading, [0, 0.632 * height, 0.238], [0.068, 0.01, 0.012])
      setLocalPart(glassesRef.current, i * 2, dummy, base, agent.heading, [-0.072 * headScale, 0.752 * height, 0.242], glassesVisible ? [0.058, 0.014, 0.014] : [0.001, 0.001, 0.001])
      setLocalPart(glassesRef.current, i * 2 + 1, dummy, base, agent.heading, [0.072 * headScale, 0.752 * height, 0.242], glassesVisible ? [0.058, 0.014, 0.014] : [0.001, 0.001, 0.001])
      setLocalPart(chestRef.current, i, dummy, base, agent.heading, [0, 0.17 * height, 0.168], [0.15 * shoulder, 0.18 * height, 0.018], bodyRotX, bodyRotZ)
      setLocalPart(beltRef.current, i, dummy, base, agent.heading, [0, -0.17 * height, 0.158], [0.17 * shoulder, 0.02, 0.024])
      setLocalPart(bagRef.current, i, dummy, base, agent.heading, [0.19 * shoulder, 0.08 * height, -0.13], bagVisible ? [0.1, 0.22 * height, 0.055] : [0.001, 0.001, 0.001])
      setLocalPart(hatRef.current, i, dummy, base, agent.heading, [0, 0.94 * height, 0.006], hatVisible ? [0.2 * headScale, 0.08, 0.2 * headScale] : [0.001, 0.001, 0.001])
      setLocalPart(skirtRef.current, i, dummy, base, agent.heading, [0, -0.13 * height, 0], skirtVisible ? [0.19 * shoulder, 0.24 * height, 0.16] : [0.001, 0.001, 0.001])
      setLocalPart(scarfRef.current, i, dummy, base, agent.heading, [0, 0.445 * height, 0.155], scarfVisible ? [0.18 * shoulder, look.scarfStyle === 'wide' ? 0.05 : 0.032, 0.04] : [0.001, 0.001, 0.001])
      setLocalPart(legRef.current, i * 2, dummy, base, agent.heading, [-0.085 * shoulder, -0.45 * height, 0], [0.052, 0.38 * height * legScale, 0.052], fallen ? 0.55 : stride, bodyRotZ * 0.35)
      setLocalPart(legRef.current, i * 2 + 1, dummy, base, agent.heading, [0.085 * shoulder, -0.45 * height, 0], [0.052, 0.38 * height * legScale, 0.052], fallen ? -0.35 : -stride, bodyRotZ * 0.35)
      setLocalPart(armRef.current, i * 2, dummy, base, agent.heading, [-0.235 * shoulder, 0.14 * height, 0.02], [0.044, 0.31 * height, 0.044], fallen ? 0.92 : -stride * 0.58 * armSwing, bodyRotZ)
      setLocalPart(armRef.current, i * 2 + 1, dummy, base, agent.heading, [0.235 * shoulder, 0.14 * height, 0.02], [0.044, 0.31 * height, 0.044], fallen ? -0.72 : stride * 0.58 * armSwing, bodyRotZ)
      setLocalPart(sleeveRef.current, i * 2, dummy, base, agent.heading, [-0.225 * shoulder, 0.28 * height, 0.026], [0.056, 0.13 * height, 0.056], -stride * 0.38 * armSwing)
      setLocalPart(sleeveRef.current, i * 2 + 1, dummy, base, agent.heading, [0.225 * shoulder, 0.28 * height, 0.026], [0.056, 0.13 * height, 0.056], stride * 0.38 * armSwing)
      setLocalPart(handRef.current, i * 2, dummy, base, agent.heading, [-0.235 * shoulder, -0.2 * height, 0.035], [0.055, 0.055, 0.055])
      setLocalPart(handRef.current, i * 2 + 1, dummy, base, agent.heading, [0.235 * shoulder, -0.2 * height, 0.035], [0.055, 0.055, 0.055])
      setLocalPart(shoeRef.current, i * 2, dummy, base, agent.heading, [-0.085 * shoulder, -0.86 * height, 0.055], [0.064, 0.043, 0.11])
      setLocalPart(shoeRef.current, i * 2 + 1, dummy, base, agent.heading, [0.085 * shoulder, -0.86 * height, 0.055], [0.064, 0.043, 0.11])
    }

    socialClock.current += dt
    statsClock.current += dt
    nearbyClock.current += dt

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
    }

    if (nearbyClock.current > 0.22) {
      nearbyClock.current = 0
      store.setPedestrianSamples(agents.map(agent => ({
        id: agent.id,
        x: agent.pos.x,
        z: agent.pos.z,
        radius: 0.82,
        state: agent.fallTimer > 0 ? 'fallen' : agent.bumpTimer > 0 ? 'stumbling' : agent.activity,
      })))
      store.setNearbyAgent(nearestAgent && nearestDistance <= 24
        ? { ...nearestAgent.snapshot(places), distance: nearestDistance }
        : null)
    }

    torsoRef.current.instanceMatrix.needsUpdate = true
    neckRef.current.instanceMatrix.needsUpdate = true
    headRef.current.instanceMatrix.needsUpdate = true
    hairRef.current.instanceMatrix.needsUpdate = true
    eyeRef.current.instanceMatrix.needsUpdate = true
    browRef.current.instanceMatrix.needsUpdate = true
    noseRef.current.instanceMatrix.needsUpdate = true
    mouthRef.current.instanceMatrix.needsUpdate = true
    chestRef.current.instanceMatrix.needsUpdate = true
    beltRef.current.instanceMatrix.needsUpdate = true
    bagRef.current.instanceMatrix.needsUpdate = true
    handRef.current.instanceMatrix.needsUpdate = true
    earRef.current.instanceMatrix.needsUpdate = true
    hatRef.current.instanceMatrix.needsUpdate = true
    skirtRef.current.instanceMatrix.needsUpdate = true
    glassesRef.current.instanceMatrix.needsUpdate = true
    scarfRef.current.instanceMatrix.needsUpdate = true
    legRef.current.instanceMatrix.needsUpdate = true
    armRef.current.instanceMatrix.needsUpdate = true
    sleeveRef.current.instanceMatrix.needsUpdate = true
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
        text: styleNpcSpeech(best, '말씀하세요. 제가 가능한 일인지 판단하고 같이 움직일게요.'),
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
      const cityPlaces = routePlacesForRequest(request, city, store.player)
      const distanceToWork = work ? Math.hypot(work.x - store.player.x, work.z - store.player.z) : 0
      const snapshot = best.snapshot(places)
      store.setInteraction({ status: 'thinking', request })
      store.showDialogue({ speaker: best.name, role: best.job, text: styleNpcSpeech(best, '잠깐 생각해볼게요...'), agent: snapshot })

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

      const destination = destinationFromPlan(plan, best, places, request, destinations)
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

    const onNpcHit = (event) => {
      const { id, playerX, playerZ, impulse } = event.detail || {}
      if (!id) return
      const agent = agents.find(item => item.id === id)
      if (!agent) return
      agent.bumpFrom(playerX ?? agent.pos.x, playerZ ?? agent.pos.z, impulse)
      const store = useCityStore.getState()
      const distanceToPlayer = Math.hypot(agent.pos.x - store.player.x, agent.pos.z - store.player.z)
      if (distanceToPlayer < 18) {
        store.setPulse(impulse > 1.02
          ? `${agent.name} is knocked down and starts getting back up.`
          : `${agent.name} stumbles and steps back after the collision.`)
      }
    }

    window.addEventListener('keydown', onKey)
    window.addEventListener('realcity:npc-request', onNpcRequest)
    window.addEventListener('realcity:player-hit-npc', onNpcHit)
    return () => {
      window.removeEventListener('keydown', onKey)
      window.removeEventListener('realcity:npc-request', onNpcRequest)
      window.removeEventListener('realcity:player-hit-npc', onNpcHit)
    }
  }, [agents, city, city.roads, places, destinations])

  return (
    <>
      <instancedMesh ref={torsoRef} args={[undefined, undefined, agents.length]} castShadow frustumCulled={false}>
        <capsuleGeometry args={[1, 2, 8, 14]} />
        <meshStandardMaterial map={textures.fabric} color="#ffffff" vertexColors roughness={0.78} metalness={0.03} />
      </instancedMesh>
      <instancedMesh ref={chestRef} args={[undefined, undefined, agents.length]} castShadow frustumCulled={false}>
        <boxGeometry args={[1, 1, 1]} />
        <meshStandardMaterial map={textures.fabric} color="#ffffff" vertexColors roughness={0.64} metalness={0.04} />
      </instancedMesh>
      <instancedMesh ref={beltRef} args={[undefined, undefined, agents.length]} castShadow frustumCulled={false}>
        <boxGeometry args={[1, 1, 1]} />
        <meshStandardMaterial map={textures.metal} color="#473120" vertexColors roughness={0.62} metalness={0.12} />
      </instancedMesh>
      <instancedMesh ref={neckRef} args={[undefined, undefined, agents.length]} castShadow frustumCulled={false}>
        <cylinderGeometry args={[1, 1, 1, 12]} />
        <meshStandardMaterial map={textures.skin} color="#efc29a" vertexColors roughness={0.72} />
      </instancedMesh>
      <instancedMesh ref={headRef} args={[undefined, undefined, agents.length]} castShadow frustumCulled={false}>
        <sphereGeometry args={[1, 16, 12]} />
        <meshStandardMaterial map={textures.skin} color="#efc29a" vertexColors roughness={0.72} />
      </instancedMesh>
      <instancedMesh ref={hairRef} args={[undefined, undefined, agents.length]} castShadow frustumCulled={false}>
        <sphereGeometry args={[1, 16, 10, 0, Math.PI * 2, 0, Math.PI * 0.56]} />
        <meshStandardMaterial map={textures.hair} color="#19130f" vertexColors roughness={0.9} />
      </instancedMesh>
      <instancedMesh ref={eyeRef} args={[undefined, undefined, agents.length * 2]} frustumCulled={false}>
        <sphereGeometry args={[1, 8, 6]} />
        <meshStandardMaterial color="#05070a" roughness={0.38} />
      </instancedMesh>
      <instancedMesh ref={browRef} args={[undefined, undefined, agents.length * 2]} frustumCulled={false}>
        <boxGeometry args={[1, 1, 1]} />
        <meshStandardMaterial map={textures.hair} color="#19130f" vertexColors roughness={0.7} />
      </instancedMesh>
      <instancedMesh ref={glassesRef} args={[undefined, undefined, agents.length * 2]} frustumCulled={false}>
        <torusGeometry args={[1, 0.18, 6, 12]} />
        <meshStandardMaterial map={textures.glass} color="#07090d" roughness={0.28} metalness={0.42} />
      </instancedMesh>
      <instancedMesh ref={noseRef} args={[undefined, undefined, agents.length]} castShadow frustumCulled={false}>
        <boxGeometry args={[1, 1, 1]} />
        <meshStandardMaterial map={textures.skin} color="#b98262" roughness={0.72} />
      </instancedMesh>
      <instancedMesh ref={mouthRef} args={[undefined, undefined, agents.length]} frustumCulled={false}>
        <boxGeometry args={[1, 1, 1]} />
        <meshStandardMaterial color="#6e2f2f" roughness={0.7} />
      </instancedMesh>
      <instancedMesh ref={earRef} args={[undefined, undefined, agents.length * 2]} castShadow frustumCulled={false}>
        <sphereGeometry args={[1, 8, 6]} />
        <meshStandardMaterial map={textures.skin} color="#efc29a" vertexColors roughness={0.72} />
      </instancedMesh>
      <instancedMesh ref={bagRef} args={[undefined, undefined, agents.length]} castShadow frustumCulled={false}>
        <boxGeometry args={[1, 1, 1]} />
        <meshStandardMaterial map={textures.fabric} color="#473120" vertexColors roughness={0.78} />
      </instancedMesh>
      <instancedMesh ref={hatRef} args={[undefined, undefined, agents.length]} castShadow frustumCulled={false}>
        <cylinderGeometry args={[1, 1, 1, 12]} />
        <meshStandardMaterial map={textures.fabric} color="#27313d" vertexColors roughness={0.74} metalness={0.04} />
      </instancedMesh>
      <instancedMesh ref={skirtRef} args={[undefined, undefined, agents.length]} castShadow frustumCulled={false}>
        <coneGeometry args={[1, 1, 8]} />
        <meshStandardMaterial map={textures.fabric} color="#293241" vertexColors roughness={0.82} />
      </instancedMesh>
      <instancedMesh ref={scarfRef} args={[undefined, undefined, agents.length]} castShadow frustumCulled={false}>
        <boxGeometry args={[1, 1, 1]} />
        <meshStandardMaterial map={textures.fabric} color="#ffffff" vertexColors roughness={0.66} metalness={0.02} />
      </instancedMesh>
      <instancedMesh ref={legRef} args={[undefined, undefined, agents.length * 2]} castShadow frustumCulled={false}>
        <capsuleGeometry args={[1, 2, 6, 10]} />
        <meshStandardMaterial map={textures.fabric} color="#1f2937" vertexColors roughness={0.84} />
      </instancedMesh>
      <instancedMesh ref={armRef} args={[undefined, undefined, agents.length * 2]} castShadow frustumCulled={false}>
        <capsuleGeometry args={[1, 2, 6, 10]} />
        <meshStandardMaterial map={textures.skin} color="#d7a17d" vertexColors roughness={0.7} />
      </instancedMesh>
      <instancedMesh ref={sleeveRef} args={[undefined, undefined, agents.length * 2]} castShadow frustumCulled={false}>
        <capsuleGeometry args={[1, 2, 5, 10]} />
        <meshStandardMaterial map={textures.fabric} color="#ffffff" vertexColors roughness={0.78} metalness={0.03} />
      </instancedMesh>
      <instancedMesh ref={handRef} args={[undefined, undefined, agents.length * 2]} castShadow frustumCulled={false}>
        <sphereGeometry args={[1, 10, 8]} />
        <meshStandardMaterial map={textures.skin} color="#d7a17d" vertexColors roughness={0.72} />
      </instancedMesh>
      <instancedMesh ref={shoeRef} args={[undefined, undefined, agents.length * 2]} castShadow frustumCulled={false}>
        <boxGeometry args={[1, 1, 1]} />
        <meshStandardMaterial map={textures.rubber} color="#10151c" vertexColors roughness={0.82} />
      </instancedMesh>
    </>
  )
}

export default function Actors({ city }) {
  return (
    <>
      <Traffic cars={city.cars} roads={city.roads} />
      <NPCs city={city} />
    </>
  )
}
