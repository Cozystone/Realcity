import { useEffect, useMemo, useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import * as THREE from 'three'
import { terrainHeight, trafficSignalForAxis } from '../engine/cityEngine'
import { resolveBuildingCollision } from '../engine/collision'
import { useCityStore } from '../engine/cityStore'
import { fallbackLine, llmStatus, matchRequestedPlace, planLocalNPCAction, styleNpcSpeech } from '../engine/localLLM'
import { buildTaxiRoute, routeDistance, sampleRoute, taxiPassengerDoorPoint, taxiSpawnForPickup } from '../engine/taxiRouting'
import { makeProceduralTexture } from './proceduralTextures'

const forward = new THREE.Vector3(0, 0, 1)
const TAXI_DISPATCH_SPEED = 18
const TAXI_RIDE_SPEED = 24
const TAXI_MIN_RIDE_SECONDS = 14
const TAXI_MAX_RIDE_SECONDS = 120
const TAXI_BOARDING_SECONDS = 1.45
const TAXI_HAIL_RADIUS = 92
const NPC_TAXI_MAX_ACTIVE = 4
const NPC_TAXI_MIN_DISTANCE = 520
const NPC_TAXI_DISPATCH_SPEED = 16
const NPC_TAXI_RIDE_SPEED = 22
const NPC_GLANCE_RADIUS = 24
const NPC_GLANCE_PULSE_RADIUS = 12
const WALK_ROUTE_WAYPOINT_RADIUS = 1.8
const WALK_ROUTE_REPLAN_SECONDS = 2.35
const WALK_ROUTE_MAX_WAYPOINTS = 12

function formatTime(minutes) {
  return `${Math.floor(minutes / 60)}:${String(Math.floor(minutes % 60)).padStart(2, '0')}`
}

function smoothstep(t) {
  return t * t * (3 - 2 * t)
}

function clampValue(value, min, max) {
  return Math.max(min, Math.min(max, value))
}

function scheduleFor(agent, timeMinutes) {
  const hour = timeMinutes / 60
  return agent.schedule.find(slot => hour >= slot.start && hour < slot.end) || agent.schedule[0]
}

function nearestRoadForPlace(place, roads = []) {
  if (!place || !roads.length) return null
  const linked = roads.find(road => road.id === place.roadId)
  if (linked) return linked

  let best = null
  let bestDistance = Infinity
  for (const road of roads) {
    const along = road.axis === 'x'
      ? clampValue(place.x, road.from, road.to)
      : clampValue(place.z, road.from, road.to)
    const distance = road.axis === 'x'
      ? Math.hypot(place.x - along, place.z - road.z)
      : Math.hypot(place.x - road.x, place.z - along)
    if (distance < bestDistance) {
      best = road
      bestDistance = distance
    }
  }
  return best
}

function sidewalkAccessForPlace(place, offset = { x: 0, z: 0 }, roads = []) {
  const road = nearestRoadForPlace(place, roads)
  if (!road) return null

  const curbOffset = road.width / 2 + 4.9
  if (road.axis === 'x') {
    const side = place.z >= road.z ? 1 : -1
    const x = clampValue(place.x + offset.x * 0.22, road.from + 6, road.to - 6)
    const z = road.z + side * curbOffset
    return {
      x,
      z,
      y: terrainHeight(x, z),
      name: place.name || 'destination',
      kind: place.kind,
      address: place.address,
      roadName: road.name,
      roadId: road.id,
      roadAxis: road.axis,
      entryRule: 'road-sidewalk-access',
    }
  }

  const side = place.x >= road.x ? 1 : -1
  const x = road.x + side * curbOffset
  const z = clampValue(place.z + offset.z * 0.22, road.from + 6, road.to - 6)
  return {
    x,
    z,
    y: terrainHeight(x, z),
    name: place.name || 'destination',
    kind: place.kind,
    address: place.address,
    roadName: road.name,
    roadId: road.id,
    roadAxis: road.axis,
    entryRule: 'road-sidewalk-access',
  }
}

function entranceTargetFor(destination, roads = [], offset = { x: 0, z: 0 }) {
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

  const sidewalkAccess = sidewalkAccessForPlace(destination, offset, roads)
  if (sidewalkAccess) {
    return {
      ...sidewalkAccess,
      placeName: destination.name,
      interiorId: destination.id,
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

function scheduleTargetForPlace(place, offset = { x: 0, z: 0 }, roads = []) {
  if (!place?.interior?.solidWalls) {
    const x = place.x + offset.x
    const z = place.z + offset.z
    return pedestrianSafeTarget({
      x,
      z,
      y: terrainHeight(x, z),
      name: place.name,
    }, { x: place.x, z: place.z }, roads)
  }

  const entry = entranceTargetFor(place, roads, offset)
  if (entry.entryRule === 'road-sidewalk-access') {
    return {
      ...entry,
      name: place.name,
    }
  }

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

function targetFor(agent, places, timeMinutes, roads = []) {
  const slot = scheduleFor(agent, timeMinutes)
  if (slot.target === 'home') {
    return { ...pedestrianSafeTarget(agent.home, agent.pos || agent.home, roads), activity: slot.activity }
  }
  const id = slot.target === 'work' ? agent.workId : agent.thirdId
  const place = places.get(id) || [...places.values()][0]
  return { ...scheduleTargetForPlace(place, agent.offset, roads), activity: slot.activity }
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

function pedestrianSafeTarget(target, from = target, roads = []) {
  if (!target || !roads.length) return target
  let x = target.x
  let z = target.z
  let adjustedRoadName = null

  for (const road of roads) {
    if (road.axis === 'x') {
      if (x < road.from || x > road.to) continue
      const lateral = z - road.z
      if (Math.abs(lateral) >= road.width / 2 - 0.35) continue
      const reference = Math.abs(lateral) > 0.15 ? lateral : (from.z ?? z) - road.z
      const side = reference >= 0 ? 1 : -1
      z = road.z + side * (road.width / 2 + 4.4)
      adjustedRoadName = road.name
    } else {
      if (z < road.from || z > road.to) continue
      const lateral = x - road.x
      if (Math.abs(lateral) >= road.width / 2 - 0.35) continue
      const reference = Math.abs(lateral) > 0.15 ? lateral : (from.x ?? x) - road.x
      const side = reference >= 0 ? 1 : -1
      x = road.x + side * (road.width / 2 + 4.4)
      adjustedRoadName = road.name
    }
  }

  if (!adjustedRoadName) return target
  return {
    ...target,
    x,
    z,
    y: terrainHeight(x, z),
    adjustedRoadName,
  }
}

function roadSeparatesPoints(road, from, to) {
  if (road.axis === 'x') {
    const fromSide = from.z - road.z
    const toSide = to.z - road.z
    const crossesCenter = fromSide * toSide < 0
    const segmentMin = Math.min(from.x, to.x)
    const segmentMax = Math.max(from.x, to.x)
    return crossesCenter && segmentMax >= road.from && segmentMin <= road.to
  }
  const fromSide = from.x - road.x
  const toSide = to.x - road.x
  const crossesCenter = fromSide * toSide < 0
  const segmentMin = Math.min(from.z, to.z)
  const segmentMax = Math.max(from.z, to.z)
  return crossesCenter && segmentMax >= road.from && segmentMin <= road.to
}

function nearestCrosswalkForRoad(road, from, to, roads) {
  const crossRoads = roads.filter(item => item.axis !== road.axis)
  let best = null
  let bestScore = Infinity
  for (const cross of crossRoads) {
    const intersection = road.axis === 'x'
      ? { x: cross.x, z: road.z }
      : { x: road.x, z: cross.z }
    if (road.axis === 'x') {
      if (intersection.x < road.from || intersection.x > road.to) continue
      if (intersection.z < cross.from || intersection.z > cross.to) continue
    } else {
      if (intersection.z < road.from || intersection.z > road.to) continue
      if (intersection.x < cross.from || intersection.x > cross.to) continue
    }
    const score = Math.hypot(from.x - intersection.x, from.z - intersection.z) * 1.25 +
      Math.hypot(to.x - intersection.x, to.z - intersection.z) * 0.35 -
      (cross.main ? 14 : 0)
    if (score < bestScore) {
      best = { ...intersection, crossRoad: cross }
      bestScore = score
    }
  }
  return best
}

function pedestrianWaypoint(agent, target, roads = []) {
  const from = { x: agent.pos.x, z: agent.pos.z }
  const crossingRoad = roads
    .filter(road => roadSeparatesPoints(road, from, target))
    .sort((a, b) => {
      const da = a.axis === 'x' ? Math.abs(from.z - a.z) : Math.abs(from.x - a.x)
      const db = b.axis === 'x' ? Math.abs(from.z - b.z) : Math.abs(from.x - b.x)
      return da - db
    })[0]

  if (!crossingRoad) {
    agent.walkPlan = {
      mode: 'direct',
      targetName: target.name || 'destination',
      waypointName: target.name || 'destination',
      waypoint: { x: target.x, z: target.z },
      distanceToTarget: Math.hypot(target.x - from.x, target.z - from.z),
      distanceToWaypoint: Math.hypot(target.x - from.x, target.z - from.z),
    }
    return target
  }

  const crosswalk = nearestCrosswalkForRoad(crossingRoad, from, target, roads)
  if (!crosswalk) {
    agent.walkPlan = {
      mode: 'curb-avoidance',
      roadName: crossingRoad.name,
      targetName: target.name || 'destination',
      waypointName: target.name || 'destination',
      waypoint: { x: target.x, z: target.z },
      distanceToTarget: Math.hypot(target.x - from.x, target.z - from.z),
      distanceToWaypoint: Math.hypot(target.x - from.x, target.z - from.z),
    }
    return target
  }

  const curbOffset = crossingRoad.width / 2 + 4.2
  let approach
  let exit
  if (crossingRoad.axis === 'x') {
    const fromSide = from.z >= crossingRoad.z ? 1 : -1
    const toSide = target.z >= crossingRoad.z ? 1 : -1
    approach = { x: crosswalk.x, z: crossingRoad.z + fromSide * curbOffset, y: terrainHeight(crosswalk.x, crossingRoad.z + fromSide * curbOffset), name: `${crossingRoad.name} crosswalk approach` }
    exit = { x: crosswalk.x, z: crossingRoad.z + toSide * curbOffset, y: terrainHeight(crosswalk.x, crossingRoad.z + toSide * curbOffset), name: `${crossingRoad.name} crosswalk exit` }
  } else {
    const fromSide = from.x >= crossingRoad.x ? 1 : -1
    const toSide = target.x >= crossingRoad.x ? 1 : -1
    approach = { x: crossingRoad.x + fromSide * curbOffset, z: crosswalk.z, y: terrainHeight(crossingRoad.x + fromSide * curbOffset, crosswalk.z), name: `${crossingRoad.name} crosswalk approach` }
    exit = { x: crossingRoad.x + toSide * curbOffset, z: crosswalk.z, y: terrainHeight(crossingRoad.x + toSide * curbOffset, crosswalk.z), name: `${crossingRoad.name} crosswalk exit` }
  }

  const approachDistance = Math.hypot(from.x - approach.x, from.z - approach.z)
  const shouldCross = approachDistance < 2.8 || nearCrosswalk(from.x, from.z, crossingRoad, roads)
  agent.walkPlan = {
    mode: shouldCross ? 'crosswalk-crossing' : 'sidewalk-waypoint',
    roadName: crossingRoad.name,
    crosswalk: { x: crosswalk.x, z: crosswalk.z },
    waypointName: shouldCross ? exit.name : approach.name,
    waypoint: shouldCross ? { x: exit.x, z: exit.z } : { x: approach.x, z: approach.z },
    targetName: target.name || 'destination',
    distanceToTarget: Math.hypot(target.x - from.x, target.z - from.z),
    distanceToWaypoint: shouldCross ? Math.hypot(exit.x - from.x, exit.z - from.z) : approachDistance,
  }
  return shouldCross ? exit : approach
}

function pointDistance(a, b) {
  return Math.hypot((a?.x || 0) - (b?.x || 0), (a?.z || 0) - (b?.z || 0))
}

function nowMs() {
  return typeof performance !== 'undefined' ? performance.now() : Date.now()
}

function walkTargetKey(target) {
  return [
    target?.name || target?.id || 'destination',
    Number(target?.x || 0).toFixed(1),
    Number(target?.z || 0).toFixed(1),
    target?.activity || '',
    target?.interiorId || '',
  ].join(':')
}

function routePoint(point, mode, details = {}) {
  const x = point.x
  const z = point.z
  return {
    ...point,
    x,
    z,
    y: point.y ?? terrainHeight(x, z),
    routeMode: mode,
    routeRoadName: details.roadName || point.roadName || null,
    waypointName: details.name || point.name || details.roadName || 'waypoint',
    crosswalk: details.crosswalk || null,
  }
}

function pushRoutePoint(waypoints, point, mode, details = {}) {
  if (!point || !Number.isFinite(point.x) || !Number.isFinite(point.z)) return
  const previous = waypoints[waypoints.length - 1]
  if (previous && pointDistance(previous, point) < 0.9) {
    previous.routeMode = previous.routeMode === 'crosswalk-crossing' ? previous.routeMode : mode
    return
  }
  waypoints.push(routePoint(point, mode, details))
}

function crosswalkPairForRoad(road, from, to, roads) {
  const crosswalk = nearestCrosswalkForRoad(road, from, to, roads)
  if (!crosswalk) return null

  const curbOffset = road.width / 2 + 4.2
  if (road.axis === 'x') {
    const fromSide = from.z >= road.z ? 1 : -1
    const toSide = to.z >= road.z ? 1 : -1
    const approachZ = road.z + fromSide * curbOffset
    const exitZ = road.z + toSide * curbOffset
    return {
      roadName: road.name,
      crosswalk: { x: crosswalk.x, z: road.z },
      approach: {
        x: crosswalk.x,
        z: approachZ,
        y: terrainHeight(crosswalk.x, approachZ),
        name: `${road.name} crosswalk approach`,
      },
      exit: {
        x: crosswalk.x,
        z: exitZ,
        y: terrainHeight(crosswalk.x, exitZ),
        name: `${road.name} crosswalk exit`,
      },
    }
  }

  const fromSide = from.x >= road.x ? 1 : -1
  const toSide = to.x >= road.x ? 1 : -1
  const approachX = road.x + fromSide * curbOffset
  const exitX = road.x + toSide * curbOffset
  return {
    roadName: road.name,
    crosswalk: { x: road.x, z: crosswalk.z },
    approach: {
      x: approachX,
      z: crosswalk.z,
      y: terrainHeight(approachX, crosswalk.z),
      name: `${road.name} crosswalk approach`,
    },
    exit: {
      x: exitX,
      z: crosswalk.z,
      y: terrainHeight(exitX, crosswalk.z),
      name: `${road.name} crosswalk exit`,
    },
  }
}

function nearestSeparatingRoad(from, to, roads, crossedRoads = new Set()) {
  return roads
    .filter(road => roadSeparatesPoints(road, from, to))
    .sort((a, b) => {
      const da = a.axis === 'x' ? Math.abs(from.z - a.z) : Math.abs(from.x - a.x)
      const db = b.axis === 'x' ? Math.abs(from.z - b.z) : Math.abs(from.x - b.x)
      const crossedPenaltyA = crossedRoads.has(a.id) ? 10000 : 0
      const crossedPenaltyB = crossedRoads.has(b.id) ? 10000 : 0
      return da + crossedPenaltyA - (db + crossedPenaltyB)
    })[0] || null
}

function buildPedestrianRoute(from, target, roads = []) {
  const safeTarget = pedestrianSafeTarget(target, from, roads)
  const waypoints = []
  let cursor = { x: from.x, z: from.z, y: terrainHeight(from.x, from.z), name: 'current position' }
  const recovery = pedestrianSafeTarget({ ...cursor, name: 'nearest sidewalk' }, safeTarget, roads)

  if (recovery.adjustedRoadName && pointDistance(cursor, recovery) > 0.75) {
    pushRoutePoint(waypoints, recovery, 'sidewalk-recovery', {
      roadName: recovery.adjustedRoadName,
      name: `${recovery.adjustedRoadName} sidewalk`,
    })
    cursor = recovery
  }

  const crossedRoads = new Set()
  for (let guard = 0; guard < WALK_ROUTE_MAX_WAYPOINTS; guard += 1) {
    const road = nearestSeparatingRoad(cursor, safeTarget, roads, crossedRoads)
    if (!road) break
    const pair = crosswalkPairForRoad(road, cursor, safeTarget, roads)
    if (!pair) break
    if (pointDistance(cursor, pair.approach) > WALK_ROUTE_WAYPOINT_RADIUS) {
      pushRoutePoint(waypoints, pair.approach, 'sidewalk-waypoint', {
        roadName: pair.roadName,
        name: pair.approach.name,
        crosswalk: pair.crosswalk,
      })
    }
    pushRoutePoint(waypoints, pair.exit, 'crosswalk-crossing', {
      roadName: pair.roadName,
      name: pair.exit.name,
      crosswalk: pair.crosswalk,
    })
    cursor = pair.exit
    crossedRoads.add(road.id)
    if (pointDistance(cursor, safeTarget) < WALK_ROUTE_WAYPOINT_RADIUS) break
  }

  if (pointDistance(waypoints[waypoints.length - 1] || cursor, safeTarget) > 0.9 || waypoints.length === 0) {
    pushRoutePoint(waypoints, safeTarget, waypoints.length ? 'destination-approach' : 'direct', {
      roadName: safeTarget.roadName || safeTarget.adjustedRoadName,
      name: safeTarget.name || 'destination',
    })
  }

  return waypoints.slice(0, WALK_ROUTE_MAX_WAYPOINTS)
}

function ensureWalkRoute(agent, target, roads = [], force = false) {
  if (!roads.length) return null
  const key = walkTargetKey(target)
  const existing = agent.walkRoute
  if (!force && existing?.targetKey === key && existing.waypoints?.length) return existing

  const waypoints = buildPedestrianRoute(agent.pos, target, roads)
  agent.walkRoute = {
    targetKey: key,
    targetName: target.name || 'destination',
    activity: target.activity || agent.activity || 'walking',
    waypoints,
    index: 0,
    createdAt: nowMs(),
    replanCount: force ? (existing?.replanCount || 0) + 1 : existing?.replanCount || 0,
    final: { x: target.x, z: target.z },
  }
  agent.stuckTimer = 0
  agent.lastRouteDistance = pointDistance(agent.pos, target)
  agent.routeStatus = waypoints.length > 1
    ? `following ${waypoints.length} sidewalk waypoints to ${target.name || 'destination'}`
    : `walking to ${target.name || 'destination'}`
  return agent.walkRoute
}

function currentWalkWaypoint(agent, target, roads = []) {
  const route = ensureWalkRoute(agent, target, roads)
  if (!route?.waypoints?.length) {
    agent.walkPlan = {
      mode: 'direct',
      targetName: target.name || 'destination',
      waypointName: target.name || 'destination',
      waypoint: { x: target.x, z: target.z },
      distanceToTarget: pointDistance(agent.pos, target),
      distanceToWaypoint: pointDistance(agent.pos, target),
      stableRoute: false,
    }
    return target
  }

  while (
    route.index < route.waypoints.length - 1 &&
    pointDistance(agent.pos, route.waypoints[route.index]) < WALK_ROUTE_WAYPOINT_RADIUS
  ) {
    route.index += 1
  }

  const waypoint = route.waypoints[route.index] || target
  agent.walkPlan = {
    mode: waypoint.routeMode || 'direct',
    targetName: route.targetName || target.name || 'destination',
    waypointName: waypoint.waypointName || waypoint.name || route.targetName,
    waypoint: { x: waypoint.x, z: waypoint.z },
    crosswalk: waypoint.crosswalk,
    roadName: waypoint.routeRoadName || waypoint.roadName || null,
    routeIndex: route.index,
    routePoints: route.waypoints.length,
    stableRoute: true,
    replanCount: route.replanCount || 0,
    distanceToTarget: pointDistance(agent.pos, target),
    distanceToWaypoint: pointDistance(agent.pos, waypoint),
  }
  return waypoint
}

function updateWalkProgress(agent, previous, safe, target, delta, roads = []) {
  const moved = pointDistance(previous, safe)
  const remaining = pointDistance(safe, target)
  const madeProgress = agent.lastRouteDistance == null || remaining < agent.lastRouteDistance - 0.08
  if (madeProgress || moved > 0.035 || remaining < 2.2) {
    agent.stuckTimer = Math.max(0, (agent.stuckTimer || 0) - delta * 2.5)
  } else {
    agent.stuckTimer = (agent.stuckTimer || 0) + delta
  }
  agent.lastRouteDistance = remaining

  if (agent.stuckTimer <= WALK_ROUTE_REPLAN_SECONDS) return
  const recovery = pedestrianSafeTarget({ x: safe.x, z: safe.z, name: 'sidewalk recovery' }, target, roads)
  if (recovery.adjustedRoadName && pointDistance(safe, recovery) > 0.4 && pointDistance(safe, recovery) < 9) {
    agent.pos.x += (recovery.x - agent.pos.x) * 0.32
    agent.pos.z += (recovery.z - agent.pos.z) * 0.32
    agent.pos.y = terrainHeight(agent.pos.x, agent.pos.z) + 0.95
  }
  agent.walkRoute = null
  agent.routeStatus = `replanning sidewalk route to ${target.name || 'destination'}`
  agent.stuckTimer = 0
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

function resolveAgentMovement(agent, previous, next, target, cityOrRoads) {
  const city = Array.isArray(cityOrRoads) ? null : cityOrRoads
  const roads = Array.isArray(cityOrRoads) ? cityOrRoads : cityOrRoads?.roads
  let safe = roads?.length ? enforcePedestrianNorms(previous, next, roads) : next

  if (!city?.getNearbyBuildings) return safe

  const [fullX, fullZ] = resolveBuildingCollision(city, previous.x, previous.z, safe.x, safe.z, 0.68)
  const collided = Math.hypot(fullX - safe.x, fullZ - safe.z) > 0.03
  if (!collided) {
    agent.blockedContacts = 0
    return { x: fullX, z: fullZ }
  }

  const [xOnlyX, xOnlyZ] = resolveBuildingCollision(city, previous.x, previous.z, safe.x, previous.z, 0.68)
  const [zOnlyX, zOnlyZ] = resolveBuildingCollision(city, previous.x, previous.z, previous.x, safe.z, 0.68)
  const candidates = [
    { x: fullX, z: fullZ },
    { x: xOnlyX, z: xOnlyZ },
    { x: zOnlyX, z: zOnlyZ },
    previous,
  ]
  let best = candidates[0]
  let bestScore = Infinity
  for (const candidate of candidates) {
    const progress = Math.hypot(candidate.x - previous.x, candidate.z - previous.z)
    const score = Math.hypot(target.x - candidate.x, target.z - candidate.z) - progress * 0.35
    if (score < bestScore) {
      best = candidate
      bestScore = score
    }
  }
  agent.blockedContacts = (agent.blockedContacts || 0) + 1
  if (best === previous) agent.heading += 0.18
  else if (collided) agent.heading += Math.sin(agent.id.length + nowMs() * 0.001) * 0.08
  return best
}

function moveAgentToward(agent, target, delta, speed, cityOrRoads) {
  const roads = Array.isArray(cityOrRoads) ? cityOrRoads : cityOrRoads?.roads
  const safeTarget = roads?.length ? pedestrianSafeTarget(target, agent.pos, roads) : target
  const waypoint = roads?.length ? currentWalkWaypoint(agent, safeTarget, roads) : safeTarget
  const dx = waypoint.x - agent.pos.x
  const dz = waypoint.z - agent.pos.z
  const distance = Math.hypot(dx, dz)
  if (distance <= 0.001) return Math.hypot(safeTarget.x - agent.pos.x, safeTarget.z - agent.pos.z)

  const desired = Math.atan2(dx, dz)
  const turn = Math.atan2(Math.sin(desired - agent.heading), Math.cos(desired - agent.heading))
  agent.heading += turn * Math.min(1, delta * 3.5)
  const step = Math.min(distance, speed * delta)
  const previous = { x: agent.pos.x, z: agent.pos.z }
  const next = {
    x: agent.pos.x + Math.sin(agent.heading) * step,
    z: agent.pos.z + Math.cos(agent.heading) * step,
  }
  const safe = resolveAgentMovement(agent, previous, next, waypoint, cityOrRoads)
  agent.pos.x = safe.x
  agent.pos.z = safe.z
  agent.pos.y = terrainHeight(agent.pos.x, agent.pos.z) + 0.95
  if (roads?.length) updateWalkProgress(agent, previous, safe, safeTarget, delta, roads)
  return Math.hypot(safeTarget.x - agent.pos.x, safeTarget.z - agent.pos.z)
}

function advanceTaxi(taxi, delta) {
  const now = performance.now()
  const elapsed = taxi.lastAdvancedAt
    ? Math.min(0.5, Math.max(delta, (now - taxi.lastAdvancedAt) / 1000))
    : delta
  taxi.lastAdvancedAt = now
  taxi.progress = Math.min(taxi.routeMeters, (taxi.progress || 0) + taxi.speed * elapsed)
  const pose = sampleRoute(taxi.path, taxi.progress)
  taxi.pose = { x: pose.x, z: pose.z, heading: pose.heading, yaw: pose.heading }
  return pose
}

function roadLaneOffset(road, direction) {
  const laneOffset = road.width * (road.main ? 0.27 : 0.22)
  return road.axis === 'x' ? direction * laneOffset : -direction * laneOffset
}

function roadLanePoint(road, along, direction) {
  const lane = roadLaneOffset(road, direction)
  if (road.axis === 'x') return { x: Math.max(road.from, Math.min(road.to, along)), z: road.z + lane }
  return { x: road.x + lane, z: Math.max(road.from, Math.min(road.to, along)) }
}

function taxiLoopForCar(car, roads = [], index = 0) {
  const vertical = roads.filter(road => road.axis === 'z' && road.main).sort((a, b) => a.x - b.x)
  const horizontal = roads.filter(road => road.axis === 'x' && road.main).sort((a, b) => a.z - b.z)
  if (vertical.length < 2 || horizontal.length < 2) return null

  const maxRing = Math.max(1, Math.min(4, Math.floor(Math.min(vertical.length, horizontal.length) / 2) - 1))
  const ring = Math.min(maxRing, 1 + (hashValue(car.id || index) % maxRing))
  const west = vertical[ring]
  const east = vertical[vertical.length - 1 - ring]
  const south = horizontal[ring]
  const north = horizontal[horizontal.length - 1 - ring]
  if (!west || !east || !south || !north || west.x >= east.x || south.z >= north.z) return null

  const southStart = roadLanePoint(south, west.x, 1)
  const southEnd = roadLanePoint(south, east.x, 1)
  const eastStart = roadLanePoint(east, south.z, 1)
  const eastEnd = roadLanePoint(east, north.z, 1)
  const northStart = roadLanePoint(north, east.x, -1)
  const northEnd = roadLanePoint(north, west.x, -1)
  const westStart = roadLanePoint(west, north.z, -1)
  const westEnd = roadLanePoint(west, south.z, -1)
  const points = [southStart, southEnd, eastStart, eastEnd, northStart, northEnd, westStart, westEnd, southStart]
  return {
    points,
    routeMeters: routeDistance(points),
    ring,
    roads: [south, south, east, east, north, north, west, west],
    directions: [1, 1, 1, 1, -1, -1, -1, -1],
    roadNames: [south.name, east.name, north.name, west.name].filter(Boolean),
  }
}

function ensureTaxiCruise(car, roads = [], index = 0) {
  if (car.kind !== 'taxi') return null
  if (!car.cruiseLoop) {
    const loop = taxiLoopForCar(car, roads, index)
    if (loop?.points?.length >= 2) {
      car.cruiseLoop = loop
      car.cruisePath = loop.points
      car.cruiseMeters = loop.routeMeters
      car.cruiseProgress = (car.t || 0) * loop.routeMeters
      car.cruiseRouteMode = 'city-ring-loop'
      car.cruiseRoadNames = loop.roadNames
    }
  }
  return car.cruiseLoop || null
}

function taxiCruisePose(car, roads = [], index = 0) {
  const loop = ensureTaxiCruise(car, roads, index)
  if (!loop?.points?.length || !car.cruiseMeters) return null
  const pose = sampleRoute(loop.points, ((car.cruiseProgress || 0) % car.cruiseMeters + car.cruiseMeters) % car.cruiseMeters)
  const segment = Math.max(0, Math.min(loop.roads.length - 1, pose.segmentIndex || 0))
  car.activeRoad = loop.roads[segment] || car.road
  car.activeDirection = loop.directions[segment] || car.direction
  return { x: pose.x, z: pose.z, yaw: pose.heading, heading: pose.heading, road: car.activeRoad, direction: car.activeDirection }
}

function taxiPoseForCar(car, roads = [], index = 0) {
  return car.kind === 'taxi'
    ? taxiCruisePose(car, roads, index) || trafficPose(car)
    : trafficPose(car)
}

function assignedTaxiPose(car, store) {
  if (!car.assignment) return null
  const missionTaxi = store.mission?.taxi?.fleetCarId === car.id ? store.mission.taxi.pose : null
  const rideTaxi = store.ride?.taxiId === car.id ? store.ride.taxiPose : null
  const npcTaxi = car.npcTaxi?.pose || null
  const pose = rideTaxi || missionTaxi || npcTaxi
  return pose ? { x: pose.x, z: pose.z, yaw: pose.heading ?? pose.yaw ?? 0, heading: pose.heading ?? pose.yaw ?? 0 } : null
}

function nearestAvailableTaxi(pickup, cars = [], roads = [], maxDistance = Infinity) {
  let best = null
  let bestDistance = Infinity
  const pickupStop = taxiStopForPickup(pickup, roads)
  cars.forEach((car, index) => {
    if (car.kind !== 'taxi' || car.assignment) return
    const pose = taxiPoseForCar(car, roads, index)
    if (!pose) return
    const directDistance = Math.hypot(pose.x - pickupStop.x, pose.z - pickupStop.z)
    const route = buildTaxiRoute(pose, pickupStop, roads)
    const distance = route.routeMeters || directDistance
    if (distance < bestDistance && directDistance <= maxDistance) {
      best = { car, pose, route, distance, directDistance }
      bestDistance = distance
    }
  })
  return best
}

function releaseFleetTaxi(taxi, city, dropoff) {
  if (!taxi?.fleetCarId) return
  const car = city.cars?.find(item => item.id === taxi.fleetCarId)
  if (!car) return
  car.assignment = null
  car.assignmentTaxiId = null
  if (dropoff && car.cruiseMeters) {
    const pose = taxiCruisePose(car, city.roads || [], city.cars.indexOf(car))
    if (pose) car.cruiseProgress = (car.cruiseProgress || 0) + Math.hypot(dropoff.x - pose.x, dropoff.z - pose.z)
  }
}

function startTaxiRideFromMission(mission, store, roads) {
  const taxi = mission.taxi
  const destination = mission.destination
  if (!taxi || !destination) {
    store.setPulse('Choose a taxi destination first, then press F to board.')
    return false
  }

  const passengerPickup = taxi.passengerPickup || mission.pickup || nearestRoadPickup(store.player || destination, roads)
  const pickupStop = taxi.pickupStop || taxiStopForPickup(passengerPickup, roads)
  const fallbackDropoff = mission.dropoff || taxi.dropoff || nearestRoadPickup(destination, roads)
  const dropoffStop = taxi.dropoffStop || taxiStopForPickup(fallbackDropoff, roads)
  const route = taxi.destinationPath?.length >= 2
    ? { points: taxi.destinationPath, routeMeters: taxi.destinationMeters, roadNames: taxi.routeNames }
    : buildTaxiRoute(pickupStop, dropoffStop, roads)
  const routeMeters = Math.max(1, route.routeMeters || 0)
  const rideSpeed = TAXI_RIDE_SPEED
  mission.phase = 'taxi_ride'
  taxi.phase = 'ride'
  taxi.path = route.points
  taxi.routeMeters = routeMeters
  taxi.progress = 0
  taxi.routeNames = route.roadNames || taxi.routeNames || []
  store.updateMission({
    phase: 'taxi_ride',
    route: route.points,
    taxi,
    boardingRequested: true,
    summary: `Taxi to ${destination.name} via ${taxi.routeNames?.slice(0, 2).join(' / ') || 'city streets'}.`,
  })
  store.startRide({
    from: { x: pickupStop.x, z: pickupStop.z },
    to: { x: dropoffStop.x, z: dropoffStop.z },
    pickupPoint: { x: passengerPickup.x, z: passengerPickup.z },
    exitPoint: { x: fallbackDropoff.x, z: fallbackDropoff.z },
    path: route.points,
    routeMeters,
    routeNames: taxi.routeNames || [],
    duration: Math.min(TAXI_MAX_RIDE_SECONDS, Math.max(TAXI_MIN_RIDE_SECONDS, routeMeters / rideSpeed)),
    label: mission.agentName
      ? `${mission.agentName} and you are taking a taxi to ${destination.name}${destination.address ? `, ${destination.address}` : ''}.`
      : `You are taking a taxi to ${destination.name}${destination.address ? `, ${destination.address}` : ''}.`,
    destinationName: destination.name,
    taxiId: taxi.fleetCarId || taxi.id,
    taxiSource: taxi.source,
  })
  return true
}

function attachTaxiDestination(mission, destination, roads, store) {
  if (!mission?.taxi || !destination) return null
  const dropoff = nearestRoadPickup(destination, roads)
  const pickupStop = mission.taxi.pickupStop || taxiStopForPickup(mission.pickup, roads)
  const dropoffStop = taxiStopForPickup(dropoff, roads)
  const routeToDestination = buildTaxiRoute(pickupStop, dropoffStop, roads)
  mission.destination = destination
  mission.dropoff = dropoff
  mission.route = routeToDestination.points
  mission.taxi.dropoff = dropoff
  mission.taxi.dropoffStop = dropoffStop
  mission.taxi.destinationPath = routeToDestination.points
  mission.taxi.destinationMeters = routeToDestination.routeMeters
  mission.taxi.directMeters = routeToDestination.directMeters
  mission.taxi.routeNames = routeToDestination.roadNames
  store.updateMission({
    destination,
    dropoff,
    route: routeToDestination.points,
    taxi: mission.taxi,
    summary: `Destination set to ${destination.name}. Press F when the taxi is at the curb.`,
  })
  return dropoff
}

function beginTaxiDispatch(agent, mission, store, cityOrRoads) {
  const roads = Array.isArray(cityOrRoads) ? cityOrRoads : cityOrRoads.roads || []
  const cars = Array.isArray(cityOrRoads) ? [] : cityOrRoads.cars || []
  const pickup = mission.pickup
  const pickupStop = taxiStopForPickup(pickup, roads)
  const dropoff = mission.destination ? nearestRoadPickup(mission.destination, roads) : null
  const dropoffStop = dropoff ? taxiStopForPickup(dropoff, roads) : null
  const preferred = mission.preferredTaxiId
    ? cars
      .map((car, index) => {
        const pose = taxiPoseForCar(car, roads, index)
        const directDistance = pose ? Math.hypot(pose.x - pickupStop.x, pose.z - pickupStop.z) : Infinity
        const route = pose ? buildTaxiRoute(pose, pickupStop, roads) : null
        return {
          car,
          pose,
          route,
          distance: route ? route.routeMeters || directDistance : Infinity,
          directDistance,
        }
      })
      .find(item => item.car.id === mission.preferredTaxiId && item.car.kind === 'taxi' && !item.car.assignment && item.directDistance <= (mission.maxDispatchDistance ?? Infinity))
    : null
  const fleetTaxi = preferred || nearestAvailableTaxi(pickup, cars, roads, mission.maxDispatchDistance ?? Infinity)
  if (!fleetTaxi && mission.allowSpawnTaxi === false) {
    store.setPulse(`No passing taxi is close enough to hail. Move nearer to traffic or use the phone taxi app.`)
    return false
  }
  const spawn = fleetTaxi?.pose || taxiSpawnForPickup(pickupStop, roads)
  const routeToPickup = fleetTaxi?.route || buildTaxiRoute(spawn, pickupStop, roads)
  const routeToDestination = dropoffStop ? buildTaxiRoute(pickupStop, dropoffStop, roads) : { points: [], routeMeters: 0, directMeters: 0, roadNames: [] }
  const initialProgress = fleetTaxi ? Math.max(0, routeToPickup.routeMeters - 620) : 0
  const firstPose = sampleRoute(routeToPickup.points, initialProgress)
  const taxi = {
    id: `taxi_${mission.id}`,
    fleetCarId: fleetTaxi?.car.id || null,
    source: fleetTaxi ? 'fleet' : 'spawned',
    driverName: fleetTaxi?.car.driverName || 'Taxi driver',
    dispatchDistanceFromCruise: fleetTaxi?.distance || null,
    phase: 'driving_to_pickup',
    path: routeToPickup.points,
    destinationPath: routeToDestination.points,
    routeMeters: routeToPickup.routeMeters,
    destinationMeters: routeToDestination.routeMeters,
    directMeters: routeToDestination.directMeters,
    progress: initialProgress,
    initialProgress,
    approachMetersRemaining: Math.max(0, routeToPickup.routeMeters - initialProgress),
    speed: TAXI_DISPATCH_SPEED,
    pickup,
    passengerPickup: pickup,
    pickupStop,
    dropoff,
    dropoffStop,
    routeNames: routeToDestination.roadNames,
    pose: { x: firstPose.x, z: firstPose.z, heading: firstPose.heading, yaw: firstPose.heading },
    requestedAt: performance.now(),
  }

  if (fleetTaxi?.car) {
    fleetTaxi.car.assignment = mission.id
    fleetTaxi.car.assignmentTaxiId = taxi.id
  }

  mission.phase = 'taxi_dispatch'
  mission.taxi = taxi
  mission.dropoff = dropoff
  mission.route = routeToDestination.points
  mission.awaitingBoardKey = true
  store.updateMission({
    phase: 'taxi_dispatch',
    pickup,
    dropoff,
    route: routeToDestination.points,
    taxi,
    awaitingBoardKey: true,
    summary: `${agent?.name || 'You'} ${fleetTaxi ? `hailed ${taxi.driverName}'s passing taxi` : 'called a taxi'}. It is driving to the curb on ${routeToPickup.roadNames[0] || pickup.roadName || 'the road'}.`,
  })
  if (agent) {
    store.showDialogue({
      speaker: agent.name,
      role: agent.job,
      text: styleNpcSpeech(agent, `I called a passing taxi. We wait at the curb first, then press F to board for ${mission.destination?.name || 'the destination'}.`),
      agent: agent.snapshot(),
    })
  }
  return true
}

function activeNpcTaxiCount(cars = []) {
  return cars.filter(car => String(car.assignment || '').startsWith('npc_taxi_')).length
}

function shouldUseAutonomousTaxi(agent, target, city) {
  if (!target || agent.mission || agent.selfTaxi || agent.taxiCooldown > 0) return false
  if (activeNpcTaxiCount(city.cars || []) >= NPC_TAXI_MAX_ACTIVE) return false
  const distance = Math.hypot(target.x - agent.pos.x, target.z - agent.pos.z)
  if (distance < NPC_TAXI_MIN_DISTANCE) return false
  if (/resting|break|dwelling|available/i.test(target.activity || agent.activity || '')) return false
  const longTripRoles = new Set(['banker', 'doctor', 'teacher', 'courier', 'barista', 'engineer', 'student', 'shopkeeper'])
  return longTripRoles.has(agent.role) || distance > NPC_TAXI_MIN_DISTANCE * 1.35
}

function releaseAutonomousNpcTaxi(agent, city, dropoff) {
  const taxi = agent.selfTaxi
  if (!taxi) return
  const car = city.cars?.find(item => item.assignmentTaxiId === taxi.id || item.npcTaxi?.id === taxi.id)
  if (car) {
    car.assignment = null
    car.assignmentTaxiId = null
    car.npcTaxi = null
    if (dropoff && car.cruiseMeters) {
      const pose = taxiCruisePose(car, city.roads || [], city.cars.indexOf(car))
      if (pose) car.cruiseProgress = (car.cruiseProgress || 0) + Math.hypot(dropoff.x - pose.x, dropoff.z - pose.z)
    }
  }
  agent.selfTaxi = null
  agent.boardingTaxi = null
  agent.taxiCooldown = 55 + (hashValue(agent.id) % 35)
}

function startAutonomousNpcTaxi(agent, target, city) {
  const roads = city.roads || []
  const cars = city.cars || []
  if (!roads.length || !cars.length) return false
  const pickup = nearestRoadPickup(agent.pos, roads)
  const pickupStop = taxiStopForPickup(pickup, roads)
  const dropoff = nearestRoadPickup(target, roads)
  const dropoffStop = taxiStopForPickup(dropoff, roads)
  const fleetTaxi = nearestAvailableTaxi(pickup, cars, roads, Infinity)
  if (!fleetTaxi) return false

  const routeToPickup = fleetTaxi.route || buildTaxiRoute(fleetTaxi.pose, pickupStop, roads)
  const routeToDestination = buildTaxiRoute(pickupStop, dropoffStop, roads)
  if (routeToDestination.routeMeters < NPC_TAXI_MIN_DISTANCE * 0.45) return false

  const initialProgress = Math.max(0, routeToPickup.routeMeters - 520)
  const firstPose = sampleRoute(routeToPickup.points, initialProgress)
  const taxi = {
    id: `npc_taxi_${agent.id}_${Math.round(performance.now())}`,
    fleetCarId: fleetTaxi.car.id,
    source: 'fleet',
    driverName: fleetTaxi.car.driverName,
    phase: 'dispatch',
    path: routeToPickup.points,
    destinationPath: routeToDestination.points,
    routeMeters: routeToPickup.routeMeters,
    destinationMeters: routeToDestination.routeMeters,
    directMeters: routeToDestination.directMeters,
    progress: initialProgress,
    initialProgress,
    speed: NPC_TAXI_DISPATCH_SPEED,
    pickup,
    pickupStop,
    passengerPickup: pickup,
    dropoff,
    dropoffStop,
    targetName: target.name,
    routeNames: routeToDestination.roadNames,
    pose: { x: firstPose.x, z: firstPose.z, heading: firstPose.heading, yaw: firstPose.heading },
    requestedAt: performance.now(),
  }

  fleetTaxi.car.assignment = taxi.id
  fleetTaxi.car.assignmentTaxiId = taxi.id
  fleetTaxi.car.npcTaxi = taxi
  agent.selfTaxi = taxi
  agent.walkRoute = null
  agent.walkPlan = null
  agent.routeStatus = `${agent.name} called ${taxi.driverName}'s taxi for ${target.name}`
  agent.currentIntent = `taking a taxi to ${target.name}`
  agent.remember('mobility', `I called ${taxi.driverName}'s taxi to reach ${target.name}.`, agent.placeName, 0.68)

  useCityStore.getState().addCityEvent({
    id: `mobility_${taxi.id}`,
    kind: 'mobility',
    agentId: agent.id,
    agentName: agent.name,
    placeName: agent.placeName,
    topic: 'autonomous taxi commute',
    text: `${agent.name} books ${taxi.driverName}'s taxi for ${target.name} instead of walking ${Math.round(routeToDestination.routeMeters)}m.`,
  })
  return true
}

function updateAutonomousNpcTaxi(agent, target, delta, city) {
  const taxi = agent.selfTaxi
  if (!taxi) return false
  const car = city.cars?.find(item => item.assignmentTaxiId === taxi.id)
  if (!car) {
    agent.selfTaxi = null
    return false
  }
  car.npcTaxi = taxi

  if (taxi.phase === 'dispatch') {
    agent.activity = 'waiting for self-called taxi'
    agent.placeName = taxi.pickup.roadName || agent.placeName
    agent.currentIntent = `waiting at the curb for ${taxi.driverName}'s taxi to ${target.name}`
    const curbDistance = Math.hypot(agent.pos.x - taxi.passengerPickup.x, agent.pos.z - taxi.passengerPickup.z)
    if (curbDistance > 1.1) moveAgentToward(agent, taxi.passengerPickup, delta, 1.42 * agent.pace, city)
    advanceTaxi(taxi, delta)
    if (taxi.progress >= taxi.routeMeters - 0.2) {
      const pose = sampleRoute(taxi.path, taxi.routeMeters)
      taxi.progress = taxi.routeMeters
      taxi.pose = { x: pose.x, z: pose.z, heading: pose.heading, yaw: pose.heading }
      taxi.phase = 'boarding'
      taxi.boardingStartedAt = performance.now()
      agent.boardingTaxi = { missionId: taxi.id, x: agent.pos.x, z: agent.pos.z }
      agent.remember('mobility', `${taxi.driverName}'s taxi arrived at the curb.`, agent.placeName, 0.62)
    }
    return true
  }

  if (taxi.phase === 'boarding') {
    agent.activity = 'boarding self-called taxi'
    const elapsed = (performance.now() - (taxi.boardingStartedAt || performance.now())) / (TAXI_BOARDING_SECONDS * 1000)
    const t = smoothstep(clampValue(elapsed, 0, 1))
    const door = taxiPassengerDoorPoint(taxi, 'agent')
    const start = agent.boardingTaxi || { x: agent.pos.x, z: agent.pos.z }
    agent.pos.x = start.x + (door.x - start.x) * t
    agent.pos.z = start.z + (door.z - start.z) * t
    agent.pos.y = terrainHeight(agent.pos.x, agent.pos.z) + 0.95
    agent.heading = taxi.pose.heading ?? door.heading ?? agent.heading
    if (elapsed >= 1) {
      taxi.phase = 'ride'
      taxi.path = taxi.destinationPath
      taxi.routeMeters = taxi.destinationMeters
      taxi.progress = 0
      taxi.speed = NPC_TAXI_RIDE_SPEED
      agent.boardingTaxi = null
      useCityStore.getState().addCityEvent({
        id: `mobility_board_${taxi.id}`,
        kind: 'mobility',
        agentId: agent.id,
        agentName: agent.name,
        placeName: agent.placeName,
        topic: 'taxi boarding',
        text: `${agent.name} gets into ${taxi.driverName}'s taxi and heads toward ${target.name}.`,
      })
    }
    return true
  }

  if (taxi.phase === 'ride') {
    agent.activity = 'riding self-called taxi'
    agent.placeName = taxi.targetName || target.name
    agent.currentIntent = `riding through traffic to ${target.name}`
    advanceTaxi(taxi, delta)
    const seat = taxiPassengerDoorPoint({ pose: taxi.pose, passengerPickup: taxi.passengerPickup }, 'inside')
    agent.pos.x = seat.x
    agent.pos.z = seat.z
    agent.pos.y = terrainHeight(agent.pos.x, agent.pos.z) + 0.95
    agent.heading = taxi.pose.heading
    if (taxi.progress >= taxi.routeMeters - 0.2) {
      const exit = taxi.dropoff || target
      agent.pos.set(exit.x, terrainHeight(exit.x, exit.z) + 0.95, exit.z)
      agent.heading = taxi.pose.heading
      agent.remember('mobility', `I arrived by taxi at ${target.name}.`, target.name, 0.72)
      useCityStore.getState().addCityEvent({
        id: `mobility_arrive_${taxi.id}`,
        kind: 'mobility',
        agentId: agent.id,
        agentName: agent.name,
        placeName: target.name,
        topic: 'taxi arrival',
        text: `${agent.name} pays ${taxi.driverName} and continues from the curb toward ${target.name}.`,
      })
      releaseAutonomousNpcTaxi(agent, city, taxi.dropoff)
      agent.walkRoute = null
      agent.routeStatus = `taxi dropoff complete near ${target.name}`
    }
    return true
  }

  releaseAutonomousNpcTaxi(agent, city, taxi.dropoff)
  return false
}

class Agent {
  constructor(data) {
    Object.assign(this, data)
    const autonomy = data.autonomy || {}
    this.pos = new THREE.Vector3(data.home.x, data.home.y + 0.95, data.home.z)
    this.heading = Math.random() * Math.PI * 2
    this.activity = 'starting day'
    this.placeName = data.home.name
    this.autonomy = autonomy
    this.needs = {
      energy: autonomy.needProfile?.energy ?? 0.72,
      hunger: autonomy.needProfile?.hunger ?? 0.24,
      social: autonomy.needProfile?.social ?? 0.5,
      urgency: autonomy.needProfile?.urgency ?? 0.36,
    }
    this.currentIntent = autonomy.dailyGoal ? `Today: ${autonomy.dailyGoal}` : 'following schedule'
    this.memories = [{
      kind: 'goal',
      text: this.currentIntent,
      placeName: data.home.name,
      weight: 0.55,
    }]
    this.relationships = {}
    this.relationshipCount = 0
    this.lastInteraction = null
    this.talkTimer = 0
    this.socialCooldown = 4 + Math.random() * 11
    this.playerCooldown = 0
    this.glanceCooldown = 1 + Math.random() * 5
    this.socialReaction = null
    this.playerDistance = null
    this.facingPlayerAngle = null
    this.mission = null
    this.bumpVelocity = new THREE.Vector2()
    this.bumpTimer = 0
    this.fallTimer = 0
    this.walkRoute = null
    this.walkPlan = null
    this.selfTaxi = null
    this.taxiCooldown = 0
    this.stuckTimer = 0
    this.lastRouteDistance = null
    this.blockedContacts = 0
    this.routeStatus = 'scheduled route pending'
  }

  update(delta, timeMinutes, places, city) {
    const roads = city.roads || city
    this.socialCooldown = Math.max(0, this.socialCooldown - delta)
    this.playerCooldown = Math.max(0, this.playerCooldown - delta)
    this.glanceCooldown = Math.max(0, this.glanceCooldown - delta)
    this.taxiCooldown = Math.max(0, this.taxiCooldown - delta)
    this.updateNeeds(delta)
    if (this.fallTimer > 0) {
      this.fallTimer = Math.max(0, this.fallTimer - delta)
      this.applyBump(delta * 0.42, city)
      this.activity = this.fallTimer > 0.25 ? 'knocked down' : 'getting back up'
      return 'fallen'
    }
    if (this.bumpTimer > 0) {
      this.bumpTimer = Math.max(0, this.bumpTimer - delta)
      this.applyBump(delta, city)
      this.activity = 'stumbling after contact'
      return 'stumbling'
    }
    if (this.talkTimer > 0 && !this.mission) {
      this.talkTimer -= delta
      return 'talking'
    }
    if (this.talkTimer > 0) this.talkTimer -= delta

    if (this.mission) return this.updateMission(delta, city)

    const target = targetFor(this, places, timeMinutes, roads)
    if (this.selfTaxi) {
      updateAutonomousNpcTaxi(this, target, delta, city)
      return this.selfTaxi ? this.selfTaxi.phase : 'walking'
    }
    if (shouldUseAutonomousTaxi(this, target, city) && startAutonomousNpcTaxi(this, target, city)) {
      updateAutonomousNpcTaxi(this, target, delta, city)
      return 'taxi'
    }

    this.activity = target.activity
    this.placeName = target.name
    this.currentIntent = this.routeStatus && this.stuckTimer > 0
      ? this.routeStatus
      : this.intentFor(target, timeMinutes)

    const distance = Math.hypot(target.x - this.pos.x, target.z - this.pos.z)
    if (distance > 2.2) {
      const speed = (this.activity === 'commuting' ? 1.65 : 1.05) * this.pace
      moveAgentToward(this, target, delta, speed, city)
      return 'walking'
    }

    this.heading += Math.sin(timeMinutes * 0.02 + this.id.length) * delta * 0.2
    this.walkRoute = null
    this.walkPlan = {
      mode: 'dwelling',
      targetName: target.name,
      waypointName: target.name,
      waypoint: { x: target.x, z: target.z },
      distanceToTarget: distance,
      distanceToWaypoint: distance,
      stableRoute: true,
    }
    this.routeStatus = 'at scheduled destination'
    return 'dwelling'
  }

  updateMission(delta, city) {
    const roads = city.roads || city
    const store = useCityStore.getState()
    const mission = this.mission
    const destination = mission.destination
    this.placeName = destination.name
    this.currentIntent = `helping the player reach ${destination.name}`

    if (mission.mode === 'taxi') {
      if (mission.phase === 'to_pickup') {
        this.activity = 'walking to taxi pickup'
        const distance = moveAgentToward(this, mission.pickup, delta, 1.9 * this.pace, city)
        if (distance < 2.6) {
          beginTaxiDispatch(this, mission, store, city)
          return 'talking'
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

      if (mission.phase === 'taxi_dispatch') {
        this.activity = 'waiting for taxi'
        const curbDistance = Math.hypot(this.pos.x - mission.pickup.x, this.pos.z - mission.pickup.z)
        if (curbDistance > 2.2) moveAgentToward(this, mission.pickup, delta, 1.6 * this.pace, city)

        const taxi = mission.taxi
        if (taxi) {
          advanceTaxi(taxi, delta)
          if (taxi.progress >= taxi.routeMeters - 0.2) {
            const stopPose = sampleRoute(taxi.path, taxi.routeMeters)
            taxi.phase = 'waiting_at_pickup'
            taxi.progress = taxi.routeMeters
            taxi.pose = { x: stopPose.x, z: stopPose.z, heading: stopPose.heading, yaw: stopPose.heading }
            mission.phase = 'taxi_waiting'
            mission.boardingAt = performance.now()
            store.updateMission({
              phase: 'taxi_waiting',
              taxi,
              summary: `Taxi arrived at ${mission.pickup.roadName || mission.pickup.name || 'the curb'}. Press F to board.`,
            })
            store.showDialogue({
              speaker: this.name,
              role: this.job,
              text: styleNpcSpeech(this, 'The taxi is here. Press F when you are ready to get in.'),
              agent: this.snapshot(),
            })
          }
        }
        return 'talking'
      }

      if (mission.phase === 'taxi_waiting') {
        this.activity = 'waiting by taxi door'
        const taxi = mission.taxi
        const curb = taxi?.passengerPickup || mission.pickup
        if (curb) {
          const distance = Math.hypot(this.pos.x - curb.x, this.pos.z - curb.z)
          if (distance > 0.9) moveAgentToward(this, curb, delta, 1.35 * this.pace, city)
          this.heading = taxi?.pose?.heading ?? this.heading
        }

        if (taxi && mission.boardingRequested) {
          mission.phase = 'taxi_boarding'
          mission.boardingStartedAt = performance.now()
          this.boardingTaxi = null
          store.updateMission({
            phase: 'taxi_boarding',
            taxi,
            boardingStartedAt: mission.boardingStartedAt,
            summary: `${this.name} and you are getting into the taxi from the curb side.`,
          })
        }

        return 'talking'
      }

      if (mission.phase === 'taxi_boarding') {
        this.activity = 'stepping into taxi'
        const taxi = mission.taxi
        if (taxi?.pose) {
          if (!this.boardingTaxi || this.boardingTaxi.missionId !== mission.id) {
            this.boardingTaxi = {
              missionId: mission.id,
              x: this.pos.x,
              z: this.pos.z,
            }
          }
          const elapsed = (performance.now() - (mission.boardingStartedAt || performance.now())) / (TAXI_BOARDING_SECONDS * 1000)
          const t = smoothstep(clampValue(elapsed, 0, 1))
          const door = taxiPassengerDoorPoint(taxi, 'agent')
          const start = this.boardingTaxi
          this.pos.x = start.x + (door.x - start.x) * t
          this.pos.z = start.z + (door.z - start.z) * t
          this.pos.y = terrainHeight(this.pos.x, this.pos.z) + 0.95
          this.heading = taxi.pose.heading ?? door.heading ?? this.heading
          if (elapsed >= 1 && mission.boardingRequested) {
            this.boardingTaxi = null
            startTaxiRideFromMission(mission, store, roads)
          }
        }
        return 'boarding'
      }

      if (mission.phase === 'taxi_ride') {
        this.activity = 'riding with player'
        const ride = store.ride
        if (ride) {
          if (ride.path?.length >= 2) {
            const progress = Math.min(
              ride.routeMeters || 1,
              ((performance.now() - ride.startedAt) / (ride.duration * 1000)) * (ride.routeMeters || 1),
            )
            const pose = sampleRoute(ride.path, progress)
            const seat = taxiPassengerDoorPoint({ pose, passengerPickup: mission.pickup }, 'inside')
            this.pos.x = seat.x
            this.pos.z = seat.z
            this.pos.y = terrainHeight(this.pos.x, this.pos.z) + 0.95
            this.heading = pose.heading
            return 'riding'
          }
          const t = Math.min(1, (performance.now() - ride.startedAt) / (ride.duration * 1000))
          const eased = smoothstep(t)
          this.pos.x = ride.from.x + (ride.to.x - ride.from.x) * eased + 1.2
          this.pos.z = ride.from.z + (ride.to.z - ride.from.z) * eased - 1.2
          this.pos.y = terrainHeight(this.pos.x, this.pos.z) + 0.95
          this.heading = Math.atan2(ride.to.x - ride.from.x, ride.to.z - ride.from.z)
          return 'riding'
        }
        const dropoff = mission.dropoff || nearestRoadPickup(destination, roads)
        this.pos.set(dropoff.x + 1.4, terrainHeight(dropoff.x, dropoff.z) + 0.95, dropoff.z + 1.4)
        releaseFleetTaxi(mission.taxi, city, dropoff)
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
    const distance = moveAgentToward(this, destination, delta, 1.72 * this.pace, city)
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

  updateNeeds(delta) {
    const walking = /walking|commuting|guiding|pickup/.test(this.activity)
    const resting = /resting|home|break|dwelling/.test(this.activity)
    const working = /shift|class|working|customers|rush/.test(this.activity)
    this.needs.energy = clampValue(this.needs.energy + (resting ? 0.004 : walking ? -0.0045 : working ? -0.0025 : -0.001) * delta, 0, 1)
    this.needs.hunger = clampValue(this.needs.hunger + (/cafe|break|home/.test(this.placeName?.toLowerCase?.() || '') ? -0.006 : 0.0022) * delta, 0, 1)
    this.needs.social = clampValue(this.needs.social - (working ? 0.0016 : 0.0009) * delta, 0, 1)
    this.needs.urgency = clampValue(this.needs.urgency + (walking ? -0.003 : working ? 0.0012 : -0.0008) * delta, 0, 1)
  }

  intentFor(target, timeMinutes) {
    if (this.needs.hunger > 0.78) return `looking for food after ${target.activity}`
    if (this.needs.energy < 0.28) return `saving energy while ${target.activity}`
    if (this.needs.social < 0.22) return `hoping to talk with someone near ${target.name}`
    if (target.activity === 'commuting') return `commuting toward ${target.name}`
    if (target.activity === 'class') return `getting through class at ${target.name}`
    if (target.activity === 'working' || target.activity === 'on shift') return `working toward: ${this.autonomy?.dailyGoal || 'today schedule'}`
    if (timeMinutes > 18 * 60) return `wrapping up: ${this.autonomy?.dailyGoal || 'evening routine'}`
    return this.autonomy?.dailyGoal ? `today goal: ${this.autonomy.dailyGoal}` : `following ${target.activity}`
  }

  remember(kind, text, placeName = this.placeName, weight = 0.5) {
    if (!text) return
    this.memories = [
      { kind, text: String(text).slice(0, 150), placeName, weight, time: performance.now() },
      ...this.memories.filter(memory => memory.text !== text),
    ].slice(0, 7)
  }

  applyBump(delta, cityOrRoads) {
    if (this.bumpVelocity.lengthSq() < 0.002) return
    const previous = { x: this.pos.x, z: this.pos.z }
    const next = {
      x: this.pos.x + this.bumpVelocity.x * delta,
      z: this.pos.z + this.bumpVelocity.y * delta,
    }
    const safe = resolveAgentMovement(this, previous, next, next, cityOrRoads)
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
    this.remember('collision', `I was bumped near ${this.placeName}.`, this.placeName, 0.72)
    this.talk(0.85)
  }

  talk(seconds = 6, partner = null, topic = null, timeMinutes = 0) {
    this.talkTimer = seconds
    this.socialCooldown = 20 + Math.random() * 20
    this.needs.social = clampValue(this.needs.social + 0.12, 0, 1)
    if (partner) {
      const conversation = topic || conversationTopicFor(this, partner, timeMinutes)
      const existing = this.relationships[partner.id] || {
        agentId: partner.id,
        name: partner.name,
        job: partner.job,
        trust: 0.28 + (hashValue(`${this.id}_${partner.id}`) % 18) / 100,
        talks: 0,
        firstMetAt: performance.now(),
      }
      const delta = relationshipDeltaFor(this, partner, conversation)
      const nextTrust = clampValue(existing.trust + delta, 0, 1)
      const next = {
        ...existing,
        trust: nextTrust,
        talks: existing.talks + 1,
        lastTopic: conversation.label,
        lastTopicId: conversation.id,
        lastPlaceName: this.placeName,
        lastSpokenAt: performance.now(),
      }
      this.relationships = { ...this.relationships, [partner.id]: next }
      this.relationshipCount = Object.keys(this.relationships).length
      this.lastInteraction = {
        partnerId: partner.id,
        partnerName: partner.name,
        partnerJob: partner.job,
        topicId: conversation.id,
        topic: conversation.label,
        placeName: this.placeName,
        trust: Number(next.trust.toFixed(2)),
        delta: Number(delta.toFixed(3)),
        talks: next.talks,
        at: performance.now(),
      }
      this.currentIntent = `talking with ${partner.name} about ${conversation.label}`
      this.remember('social', conversation.memoryFor(this, partner), this.placeName, 0.66 + delta)
    }
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
      autonomy: this.autonomy,
      needs: this.needs,
      memories: this.memories,
      relationships: Object.values(this.relationships).slice(0, 5),
      relationshipCount: this.relationshipCount,
      lastInteraction: this.lastInteraction,
      currentIntent: this.currentIntent,
      activity: this.activity,
      placeName: this.placeName,
      socialReaction: this.socialReaction,
      playerDistance: this.playerDistance,
      facingPlayerAngle: this.facingPlayerAngle,
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
      selfTaxi: this.selfTaxi ? {
        id: this.selfTaxi.id,
        phase: this.selfTaxi.phase,
        driverName: this.selfTaxi.driverName,
        targetName: this.selfTaxi.targetName,
      } : null,
    }
  }
}

function autonomyEventFor(agent, timeMinutes) {
  const need = agent.needs || {}
  const route = agent.walkPlan?.mode && agent.walkPlan.mode !== 'direct'
    ? ` via ${agent.walkPlan.mode.replace('-', ' ')}`
    : ''
  const needText = need.hunger > 0.82
    ? 'is getting hungry'
    : need.energy < 0.24
      ? 'is visibly tired'
      : need.social < 0.2
        ? 'is looking for someone to talk to'
        : null
  const text = needText
    ? `${agent.name} ${needText} while ${agent.activity} near ${agent.placeName}.`
    : `${agent.name} is ${agent.activity} near ${agent.placeName}${route}; ${agent.currentIntent}.`
  return {
    id: `${agent.id}_${Math.floor(timeMinutes)}_${hashValue(text)}`,
    kind: needText ? 'need' : agent.walkPlan?.mode === 'crosswalk-crossing' ? 'crosswalk' : 'routine',
    agentId: agent.id,
    agentName: agent.name,
    placeName: agent.placeName,
    text,
  }
}

function strongestNeedPhrase(agent) {
  const needs = agent.needs || {}
  if (needs.hunger > 0.76) return 'finding food soon'
  if (needs.energy < 0.3) return 'saving energy'
  if (needs.social < 0.34) return 'catching up with someone'
  if (needs.urgency > 0.72) return 'keeping an urgent schedule'
  return agent.activity || 'staying on schedule'
}

function shortIntent(agent) {
  return String(agent.currentIntent || agent.autonomy?.dailyGoal || agent.activity || 'today routine')
    .replace(/^today:\s*/i, '')
    .replace(/^today goal:\s*/i, '')
    .slice(0, 72)
}

function conversationTopicFor(a, b, timeMinutes = 0) {
  const place = a.placeName || b.placeName || 'the block'
  const roadName = a.walkPlan?.roadName || b.walkPlan?.roadName || a.home?.roadName || b.home?.roadName || 'the nearest sidewalk'
  const targetA = a.walkPlan?.targetName || a.placeName || a.home?.name || 'the next stop'
  const targetB = b.walkPlan?.targetName || b.placeName || b.home?.name || 'the next stop'
  const hour = formatTime(timeMinutes || 0)
  const topics = [
    {
      id: 'schedule',
      label: `${hour} schedule around ${place}`,
      event: `${a.name} and ${b.name} compare schedules near ${place}; ${a.name} adjusts their next stop after hearing about ${targetB}.`,
      memoryFor: (self, partner) => `Talked with ${partner.name} about the ${hour} schedule and ${shortIntent(partner)}.`,
    },
    {
      id: 'route',
      label: `safe sidewalk route on ${roadName}`,
      event: `${a.name} and ${b.name} discuss the sidewalk route on ${roadName}; both keep to the curb rules before moving on.`,
      memoryFor: (self, partner) => `Checked the safer walking route on ${roadName} with ${partner.name}.`,
    },
    {
      id: 'neighborhood',
      label: `${place} street conditions`,
      event: `${a.name} and ${b.name} trade notes on traffic and crossings near ${place}.`,
      memoryFor: (self, partner) => `Noted ${place} street conditions after talking with ${partner.name}.`,
    },
    {
      id: 'needs',
      label: `${strongestNeedPhrase(a)} and ${strongestNeedPhrase(b)}`,
      event: `${a.name} notices ${b.name} is ${strongestNeedPhrase(b)}; they pause briefly near ${place}.`,
      memoryFor: (self, partner) => `Learned ${partner.name} is ${strongestNeedPhrase(partner)} near ${place}.`,
    },
    {
      id: 'work',
      label: `${a.job} work and ${b.job} work`,
      event: `${a.name} and ${b.name} talk about work routines near ${place}; the exchange changes how they remember each other.`,
      memoryFor: (self, partner) => `Talked with ${partner.name} about ${partner.job} work and ${shortIntent(self)}.`,
    },
  ]

  if (a.workId && a.workId === b.workId) {
    topics.unshift({
      id: 'same-workplace',
      label: `${a.workName || a.placeName || 'shared workplace'} coordination`,
      event: `${a.name} and ${b.name} coordinate a shared workplace errand near ${place}.`,
      memoryFor: (self, partner) => `Coordinated workplace timing with ${partner.name}.`,
    })
  }

  if (targetA === targetB && targetA) {
    topics.unshift({
      id: 'shared-destination',
      label: `shared destination ${targetA}`,
      event: `${a.name} and ${b.name} realize they are both heading toward ${targetA} and agree on a calmer route.`,
      memoryFor: (self, partner) => `Found out ${partner.name} is also heading toward ${targetA}.`,
    })
  }

  const index = hashValue(`${a.id}_${b.id}_${Math.floor((timeMinutes || 0) / 8)}_${place}`) % topics.length
  return topics[index]
}

function relationshipDeltaFor(a, b, topic) {
  const styleMatch = a.autonomy?.relationshipStyle && a.autonomy.relationshipStyle === b.autonomy?.relationshipStyle ? 0.012 : 0
  const sharedPlace = a.placeName && a.placeName === b.placeName ? 0.014 : 0
  const sharedWork = a.workId && a.workId === b.workId ? 0.018 : 0
  const socialNeed = a.needs?.social < 0.36 ? 0.016 : 0.006
  const practicalTopic = ['route', 'same-workplace', 'shared-destination'].includes(topic?.id) ? 0.012 : 0
  return clampValue(0.024 + styleMatch + sharedPlace + sharedWork + socialNeed + practicalTopic, 0.018, 0.084)
}

function conversationEventFor(a, b, topic, timeMinutes, prefix = 'talk') {
  const interaction = a.lastInteraction?.partnerId === b.id ? a.lastInteraction : null
  return {
    id: `${prefix}_${a.id}_${b.id}_${topic.id}_${Math.floor((timeMinutes || 0) * 10)}`,
    kind: 'conversation',
    agentId: a.id,
    agentName: a.name,
    partnerId: b.id,
    partnerName: b.name,
    placeName: a.placeName,
    topic: topic.label,
    relationshipTrust: interaction?.trust ?? null,
    relationshipDelta: interaction?.delta ?? null,
    text: topic.event,
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
      const side = pos.z >= road.z ? 1 : -1
      z = road.z + side * half
      const laneDirection = side
      const vehicleStop = roadLanePoint(road, x, laneDirection)
      const distance = Math.hypot(pos.x - x, pos.z - z)
      if (distance < bestDistance) {
        bestDistance = distance
        best = {
          x,
          z,
          y: terrainHeight(x, z),
          name: `${road.name} curb`,
          roadName: road.name,
          roadId: road.id,
          roadAxis: road.axis,
          curbSide: side,
          laneDirection,
          vehicleStop: { ...vehicleStop, y: terrainHeight(vehicleStop.x, vehicleStop.z), name: `${road.name} curb lane`, roadName: road.name, roadId: road.id, roadAxis: road.axis, curbSide: side, laneDirection },
        }
      }
      continue
    } else {
      const side = pos.x >= road.x ? 1 : -1
      x = road.x + side * half
      z = Math.max(road.from, Math.min(road.to, pos.z))
      const laneDirection = -side
      const vehicleStop = roadLanePoint(road, z, laneDirection)
      const distance = Math.hypot(pos.x - x, pos.z - z)
      if (distance < bestDistance) {
        bestDistance = distance
        best = {
          x,
          z,
          y: terrainHeight(x, z),
          name: `${road.name} curb`,
          roadName: road.name,
          roadId: road.id,
          roadAxis: road.axis,
          curbSide: side,
          laneDirection,
          vehicleStop: { ...vehicleStop, y: terrainHeight(vehicleStop.x, vehicleStop.z), name: `${road.name} curb lane`, roadName: road.name, roadId: road.id, roadAxis: road.axis, curbSide: side, laneDirection },
        }
      }
    }
  }
  return best || { x: pos.x + 4, z: pos.z + 4, y: terrainHeight(pos.x + 4, pos.z + 4), name: 'curbside' }
}

function taxiStopForPickup(pickup, roads = []) {
  if (!pickup) return null
  if (pickup.vehicleStop) return { ...pickup.vehicleStop, passengerCurb: { x: pickup.x, z: pickup.z } }
  const curb = nearestRoadPickup(pickup, roads)
  return curb.vehicleStop ? { ...curb.vehicleStop, passengerCurb: { x: curb.x, z: curb.z } } : curb
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

function trafficStateForCar(car, roads, index, store) {
  if (car.kind === 'taxi') ensureTaxiCruise(car, roads, index)
  const dim = car.dimensions || { width: 2.05, height: 0.72, length: 4.35, cabinLength: 1.82, cabinHeight: 0.58 }
  const assignedPose = assignedTaxiPose(car, store)
  const pose = assignedPose || taxiPoseForCar(car, roads, index)
  const road = car.activeRoad || car.road
  const direction = car.activeDirection ?? car.direction
  const laneOffset = road.axis === 'x' ? pose.z - road.z : pose.x - road.x
  const along = road.axis === 'x'
    ? clampValue(pose.x, road.from, road.to)
    : clampValue(pose.z, road.from, road.to)
  return {
    car,
    index,
    dim,
    assignedPose,
    pose,
    trafficCar: { ...car, road, direction },
    road,
    direction,
    along,
    laneOffset,
    laneKey: `${road.id}:${direction}:${laneOffset.toFixed(1)}`,
  }
}

function frontVehicleFor(state, trafficStates) {
  if (state.assignedPose) return null
  const span = Math.max(1, state.road.to - state.road.from)
  let best = null
  for (const other of trafficStates) {
    if (!other || other.index === state.index || other.assignedPose) continue
    if (other.laneKey !== state.laneKey) continue
    let distance = state.direction > 0
      ? other.along - state.along
      : state.along - other.along
    if (distance <= -2) distance += span
    if (distance <= 0.8 || distance > 140) continue
    if (!best || distance < best.distance) best = { state: other, distance }
  }
  if (!best) return null

  const temperamentGap = {
    careful: 18,
    patient: 16,
    calm: 14,
    hurried: 11,
  }[state.car.driverTemperament] || 14
  const desiredGap = temperamentGap + state.dim.length * 0.8 + Math.min(13, state.car.speed * 0.72)
  const cautionGap = desiredGap + 18
  if (best.distance >= cautionGap) {
    return {
      vehicleId: best.state.car.id,
      driverName: best.state.car.driverName,
      distance: Number(best.distance.toFixed(2)),
      desiredGap: Number(desiredGap.toFixed(2)),
      intensity: 0,
    }
  }

  const intensity = best.distance <= desiredGap
    ? clampValue(0.58 + (desiredGap - best.distance) / Math.max(1, desiredGap), 0.58, 1)
    : clampValue(((cautionGap - best.distance) / Math.max(1, cautionGap - desiredGap)) * 0.42, 0.04, 0.42)

  return {
    vehicleId: best.state.car.id,
    driverName: best.state.car.driverName,
    distance: Number(best.distance.toFixed(2)),
    desiredGap: Number(desiredGap.toFixed(2)),
    intensity,
  }
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

    const trafficStates = cars.map((car, index) => trafficStateForCar(car, roads, index, store))

    for (let i = 0; i < cars.length; i += 1) {
      const car = cars[i]
      const trafficState = trafficStates[i]
      const dim = trafficState.dim
      const assignedPose = trafficState.assignedPose
      const currentPose = trafficState.pose
      const trafficCar = trafficState.trafficCar
      const playerContact = pointInVehicleBody(currentPose, dim, store.player, 0.74)
      const hazard = assignedPose ? null : shouldYieldToPedestrian(trafficCar, currentPose, pedestrians)
      const signalStop = assignedPose ? null : shouldStopForSignal(trafficCar, currentPose, roads, store.timeMinutes)
      const follow = assignedPose ? null : frontVehicleFor(trafficState, trafficStates)
      const brakingReason = playerContact
        ? 'player-contact'
        : signalStop
          ? `${signalStop.signal}-signal`
          : hazard
            ? hazard.player ? 'player-yield' : 'pedestrian-yield'
            : follow?.intensity > 0.15
              ? 'following-vehicle'
              : null
      const shouldBrake = !assignedPose && !!brakingReason
      car.brake = shouldBrake
        ? Math.min(1, (car.brake || 0) + dt * (playerContact || signalStop ? 5.2 : follow ? 2.6 + follow.intensity * 2.8 : car.driverTemperament === 'hurried' ? 2.8 : 4.2))
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
      if (follow && follow.distance < follow.desiredGap * 0.62 && yieldPulse.current <= 0) {
        yieldPulse.current = 4.5
        store.setPulse(`${car.driverName} eases off behind ${follow.driverName || 'the car ahead'} to keep the lane gap.`)
      }
      const wave = 0.82 + Math.sin(state.clock.elapsedTime * 0.23 + car.phase) * 0.18
      const followFactor = follow ? clampValue(1 - follow.intensity * (car.driverTemperament === 'hurried' ? 0.52 : 0.68), 0.18, 1) : 1
      const speedFactor = Math.max(0, (1 - car.brake * 0.98) * followFactor)
      if (!assignedPose) {
        if (car.kind === 'taxi' && car.cruisePath?.length >= 2 && car.cruiseMeters > 0) {
          car.cruiseProgress = ((car.cruiseProgress || 0) + car.speed * wave * speedFactor * dt) % car.cruiseMeters
        } else {
          car.t = (car.t + (car.speed * wave * speedFactor * dt) / Math.max(1, car.road.to - car.road.from)) % 1
        }
      }
      const { x, z, yaw } = assignedPose || taxiPoseForCar(car, roads, i)

      vehicleSamples.push({
        id: car.id,
        kind: car.kind,
        bodyStyle: car.bodyStyle,
        driverName: car.driverName,
        driverTemperament: car.driverTemperament,
        routeMode: car.kind === 'taxi'
          ? (car.npcTaxi ? 'npc-autonomous-taxi' : car.assignment ? 'assigned-dispatch' : car.cruiseRouteMode || 'single-road')
          : 'traffic-lane',
        assignment: car.assignment || null,
        npcPassenger: car.npcTaxi?.id || null,
        npcTaxiPhase: car.npcTaxi?.phase || null,
        npcTaxiTarget: car.npcTaxi?.targetName || null,
        cruiseRoutePoints: car.cruisePath?.length || 0,
        activeRoadName: trafficState.road.name,
        laneKey: trafficState.laneKey,
        brakingReason,
        followingVehicleId: follow?.vehicleId || null,
        followDistance: follow?.distance ?? null,
        desiredGap: follow?.desiredGap ?? null,
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

function activeTaxiRoute(mission, ride) {
  if (mission?.phase === 'taxi_dispatch' && mission?.taxi?.path?.length >= 2) return mission.taxi.path
  if (ride?.path?.length >= 2) return ride.path
  if (mission?.phase === 'taxi_waiting' && mission?.taxi?.destinationPath?.length >= 2) return mission.taxi.destinationPath
  if (mission?.route?.length >= 2) return mission.route
  if (mission?.taxi?.destinationPath?.length >= 2) return mission.taxi.destinationPath
  if (mission?.taxi?.path?.length >= 2) return mission.taxi.path
  return []
}

function TaxiRouteRibbon() {
  const mission = useCityStore(state => state.mission)
  const ride = useCityStore(state => state.ride)
  const route = activeTaxiRoute(mission, ride)
  const geometry = useMemo(() => {
    if (!route.length) return null
    const points = route.map(point => new THREE.Vector3(point.x, terrainHeight(point.x, point.z) + 0.16, point.z))
    return new THREE.BufferGeometry().setFromPoints(points)
  }, [route, mission?.updatedAt, ride?.updatedAt])

  if (!geometry) return null
  return (
    <line geometry={geometry} renderOrder={6}>
      <lineBasicMaterial color="#ffd447" transparent opacity={0.94} depthWrite={false} />
    </line>
  )
}

function MissionTaxi() {
  const group = useRef()
  const textures = useMemo(() => ({
    paint: makeProceduralTexture('vehicle-paint', { size: 128, seed: 731, repeatX: 1.6, repeatY: 1.2 }),
    glass: makeProceduralTexture('glass-smudge', { size: 128, seed: 732, repeatX: 1.2, repeatY: 1.2 }),
    rubber: makeProceduralTexture('rubber-tread', { size: 128, seed: 733, repeatX: 1.8, repeatY: 1.8 }),
    metal: makeProceduralTexture('brushed-metal', { size: 128, seed: 734, repeatX: 2.2, repeatY: 0.8 }),
    skin: makeProceduralTexture('skin-pores', { size: 128, seed: 735, repeatX: 1.2, repeatY: 1.2 }),
  }), [])

  useFrame(() => {
    if (!group.current) return
    const store = useCityStore.getState()
    if (store.ride?.taxiSource === 'fleet' || store.mission?.taxi?.source === 'fleet') {
      group.current.visible = false
      return
    }
    const pose = store.ride?.taxiPose || store.mission?.taxi?.pose
    if (!pose) {
      group.current.visible = false
      return
    }
    group.current.visible = true
    group.current.position.set(pose.x, terrainHeight(pose.x, pose.z) + 0.58, pose.z)
    group.current.rotation.y = pose.heading ?? pose.yaw ?? 0
  })

  return (
    <group ref={group} visible={false}>
      <mesh castShadow receiveShadow position={[0, 0, 0]}>
        <boxGeometry args={[2.22, 0.72, 4.75]} />
        <meshPhysicalMaterial map={textures.paint} color="#f6c445" roughness={0.22} metalness={0.42} clearcoat={0.75} clearcoatRoughness={0.15} />
      </mesh>
      <mesh castShadow position={[0, 0.66, -0.18]}>
        <boxGeometry args={[1.55, 0.62, 1.92]} />
        <meshPhysicalMaterial map={textures.glass} color="#17202a" roughness={0.06} metalness={0.24} clearcoat={1} transparent opacity={0.92} />
      </mesh>
      <mesh position={[0, 0.86, 0.86]}>
        <boxGeometry args={[1.18, 0.34, 0.045]} />
        <meshPhysicalMaterial map={textures.glass} color="#9edcff" roughness={0.035} metalness={0.1} transparent opacity={0.72} clearcoat={1} />
      </mesh>
      <mesh position={[0, 0.82, -1.2]}>
        <boxGeometry args={[1.08, 0.3, 0.045]} />
        <meshPhysicalMaterial map={textures.glass} color="#83c7e7" roughness={0.04} metalness={0.16} transparent opacity={0.68} clearcoat={1} />
      </mesh>
      <mesh castShadow position={[-0.36, 1.04, 0.16]}>
        <sphereGeometry args={[0.2, 14, 10]} />
        <meshStandardMaterial map={textures.skin} color="#d4a17d" roughness={0.7} />
      </mesh>
      <mesh castShadow position={[0, 1.22, -0.2]}>
        <boxGeometry args={[0.92, 0.18, 0.44]} />
        <meshStandardMaterial color="#fff7b0" emissive="#ffd34d" emissiveIntensity={1.2} roughness={0.22} />
      </mesh>
      <mesh position={[0, 0.16, 2.44]}>
        <boxGeometry args={[0.78, 0.18, 0.08]} />
        <meshStandardMaterial color="#fff8df" emissive="#ffe08a" emissiveIntensity={1.3} roughness={0.18} />
      </mesh>
      <mesh position={[0, 0.12, -2.44]}>
        <boxGeometry args={[0.86, 0.14, 0.08]} />
        <meshStandardMaterial color="#ff2b2b" emissive="#ff1d18" emissiveIntensity={1.1} roughness={0.24} />
      </mesh>
      {[
        [-1.18, -0.38, 1.48],
        [1.18, -0.38, 1.48],
        [-1.18, -0.38, -1.42],
        [1.18, -0.38, -1.42],
      ].map(([x, y, z]) => (
        <mesh key={`${x}-${z}`} castShadow position={[x, y, z]} rotation={[0, 0, Math.PI / 2]}>
          <cylinderGeometry args={[0.34, 0.34, 0.24, 20]} />
          <meshStandardMaterial map={textures.rubber} color="#08090b" roughness={0.56} metalness={0.18} />
        </mesh>
      ))}
      {[
        [-1.31, -0.38, 1.48],
        [1.31, -0.38, 1.48],
        [-1.31, -0.38, -1.42],
        [1.31, -0.38, -1.42],
      ].map(([x, y, z]) => (
        <mesh key={`hub-${x}-${z}`} position={[x, y, z]} rotation={[0, 0, Math.PI / 2]}>
          <cylinderGeometry args={[0.18, 0.18, 0.035, 16]} />
          <meshStandardMaterial map={textures.metal} color="#c8cdd0" roughness={0.24} metalness={0.72} />
        </mesh>
      ))}
    </group>
  )
}

function PlayerTaxiController({ city }) {
  const completionPulse = useRef(false)

  useFrame((_, delta) => {
    const store = useCityStore.getState()
    const mission = store.mission
    if (!mission || !['player_taxi', 'street_hail'].includes(mission.source)) {
      completionPulse.current = false
      return
    }

    const taxi = mission.taxi
    if (mission.phase === 'taxi_dispatch' && taxi) {
      advanceTaxi(taxi, delta)
      if (taxi.progress >= taxi.routeMeters - 0.2) {
        const stopPose = sampleRoute(taxi.path, taxi.routeMeters)
        taxi.phase = 'waiting_at_pickup'
        taxi.progress = taxi.routeMeters
        taxi.pose = { x: stopPose.x, z: stopPose.z, heading: stopPose.heading, yaw: stopPose.heading }
        mission.phase = 'taxi_waiting'
        mission.boardingAt = performance.now()
        store.updateMission({
          phase: 'taxi_waiting',
          taxi,
          summary: mission.destination
            ? `Taxi arrived at ${mission.pickup.roadName || mission.pickup.name || 'the curb'}. Press F to board.`
            : `Taxi is waiting at the curb. Choose a destination in RealPhone Taxi, then press F.`,
        })
      }
      return
    }

    if (mission.phase === 'taxi_boarding' && mission.boardingRequested) {
      const elapsed = (performance.now() - (mission.boardingStartedAt || performance.now())) / 1000
      if (elapsed >= TAXI_BOARDING_SECONDS) startTaxiRideFromMission(mission, store, city.roads)
      return
    }

    if (mission.phase === 'taxi_ride' && !store.ride && !completionPulse.current) {
      completionPulse.current = true
      releaseFleetTaxi(mission.taxi, city, mission.dropoff)
      store.finishMission(`Taxi trip complete${mission.destination?.name ? ` at ${mission.destination.name}` : ''}.`)
    }
  })

  useEffect(() => {
    const startPlayerTaxiMission = (target, source = 'player_taxi') => {
      const store = useCityStore.getState()
      const player = store.player
      const destination = target ? entranceTargetFor(target) : null
      const pickup = nearestRoadPickup(player, city.roads)
      const mission = {
        id: `${source}_${Date.now()}`,
        mode: 'taxi',
        source,
        phase: 'taxi_dispatch',
        destination,
        pickup,
        steps: destination
          ? ['Nearest cruising taxi accepts the call', 'Taxi drives to your curb', 'Press F to board', `Ride to ${destination.name}`]
          : ['Raise your hand at the curb', 'Nearest passing taxi pulls over', 'Choose a destination in RealPhone', 'Press F to board'],
        request: destination ? `Taxi to ${destination.name}` : 'Street hail passing taxi',
      }
      store.startMission({
        ...mission,
        summary: destination
          ? `Calling the nearest passing taxi to ${destination.name}.`
          : 'Hailing the nearest passing taxi.',
      })
      const started = beginTaxiDispatch(null, mission, store, {
        ...city,
        cars: city.cars,
        roads: city.roads,
      })
      if (!started) store.finishMission('Taxi hail cancelled.')
      return started
    }

    const onPlayerTaxiRequest = (event) => {
      const target = event.detail?.target
      if (!target) return
      const store = useCityStore.getState()
      const mission = store.mission
      if (mission?.source === 'street_hail' && mission.taxi && !mission.destination) {
        const destination = entranceTargetFor(target)
        attachTaxiDestination(mission, destination, city.roads, store)
        store.setPulse(`Destination set. Press F when ${mission.taxi.driverName || 'the taxi driver'} reaches the curb.`)
        return
      }
      if (store.ride || mission) {
        store.setPulse('Finish the current plan before calling another taxi.')
        return
      }
      startPlayerTaxiMission(target, 'player_taxi')
    }

    const onKey = (event) => {
      if (event.target?.closest?.('input, textarea, select, button')) return
      const store = useCityStore.getState()
      if (event.code === 'KeyF') {
        const mission = store.mission
        if (!mission || mission.mode !== 'taxi' || mission.phase !== 'taxi_waiting') return
        event.preventDefault()
        const taxi = mission.taxi
        if (taxi?.pose) {
          const door = taxiPassengerDoorPoint(taxi, 'player')
          const distance = Math.hypot(store.player.x - door.x, store.player.z - door.z)
          if (distance > 18) {
            store.setPulse('Move closer to the taxi door before boarding.')
            return
          }
        }
        if (!mission.destination) {
          store.setPulse('Choose a destination in RealPhone Taxi first.')
          window.dispatchEvent(new CustomEvent('realcity:open-phone', { detail: { tab: 'taxi' } }))
          return
        }
        mission.boardingRequested = true
        mission.phase = 'taxi_boarding'
        mission.boardingStartedAt = performance.now()
        mission.boardingPlayerStart = { x: store.player.x, z: store.player.z }
        store.updateMission({
          phase: 'taxi_boarding',
          boardingRequested: true,
          boardingStartedAt: mission.boardingStartedAt,
          boardingPlayerStart: mission.boardingPlayerStart,
          summary: 'Boarding taxi from the curb side. The driver waits until the doors are clear.',
        })
        window.dispatchEvent(new CustomEvent('realcity:taxi-board-requested', {
          detail: { missionId: mission.id },
        }))
      }

      if (event.code === 'KeyH') {
        if (store.ride || store.mission) return
        event.preventDefault()
        const player = store.player
        const pickup = nearestRoadPickup(player, city.roads)
        const nearbyTaxi = nearestAvailableTaxi(pickup, city.cars, city.roads, TAXI_HAIL_RADIUS)
        if (!nearbyTaxi) {
          store.setPulse('No passing taxi is close enough to hail. Step toward a main road or use RealPhone Taxi.')
          return
        }
        const mission = {
          id: `street_hail_${Date.now()}`,
          mode: 'taxi',
          source: 'street_hail',
          phase: 'taxi_dispatch',
          destination: null,
          pickup,
          preferredTaxiId: nearbyTaxi.car.id,
          maxDispatchDistance: TAXI_HAIL_RADIUS,
          allowSpawnTaxi: false,
          steps: ['Raise hand toward traffic', `${nearbyTaxi.car.driverName} pulls over`, 'Choose destination in RealPhone Taxi', 'Press F to board'],
          request: 'Street hail passing taxi',
        }
        store.startMission({ ...mission, summary: `Hailing ${nearbyTaxi.car.driverName}'s passing taxi.` })
        beginTaxiDispatch(null, mission, store, city)
      }
    }

    window.addEventListener('realcity:player-taxi-request', onPlayerTaxiRequest)
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('realcity:player-taxi-request', onPlayerTaxiRequest)
      window.removeEventListener('keydown', onKey)
    }
  }, [city])

  return null
}

function NPCs({ city }) {
  const places = useMemo(() => new Map(city.landmarks.map(place => [place.id, place])), [city.landmarks])
  const destinations = useMemo(() => new Map([...city.landmarks, ...(city.addressBook || [])].map(place => [place.id, place])), [city.landmarks, city.addressBook])
  const agents = useMemo(() => city.npcs.map((npc, i) => {
    const agent = new Agent(npc)
    const target = targetFor(agent, places, useCityStore.getState().timeMinutes, city.roads)
    const spread = 2.4 + (i % 5) * 0.7
    const plazaAgent = i < 10
    const lateTaxiCommuter = i >= 10 && i < 18 && Math.hypot(target.x - agent.home.x, target.z - agent.home.z) > NPC_TAXI_MIN_DISTANCE
    const spawnAnchor = lateTaxiCommuter ? agent.home : target
    const x = plazaAgent
      ? 8 + (i % 5) * 5.5
      : lateTaxiCommuter
        ? agent.home.x + Math.sin(i * 1.73) * spread
        : target.x + Math.sin(i * 2.13) * spread
    const z = plazaAgent
      ? 30 + Math.floor(i / 5) * 20 + Math.sin(i * 1.7) * 2
      : lateTaxiCommuter
        ? agent.home.z + Math.cos(i * 1.61) * spread
        : target.z + Math.cos(i * 1.71) * spread
    const spawn = pedestrianSafeTarget({ x, z, y: terrainHeight(x, z), name: plazaAgent ? 'Central Core plaza' : lateTaxiCommuter ? agent.home.name : target.name }, spawnAnchor, city.roads)
    const [safeX, safeZ] = resolveBuildingCollision(city, spawn.x, spawn.z, spawn.x, spawn.z, 0.68)
    agent.pos.set(safeX, terrainHeight(safeX, safeZ) + 0.95, safeZ)
    agent.activity = plazaAgent ? 'available for directions' : target.activity
    agent.placeName = plazaAgent ? 'Central Core plaza' : lateTaxiCommuter ? agent.home.name : target.name
    agent.heading = plazaAgent ? Math.atan2(-x, 40 - z) : Math.atan2(target.x - agent.home.x, target.z - agent.home.z)
    agent.routeStatus = plazaAgent
      ? 'available near the central plaza'
      : lateTaxiCommuter
        ? `late commute from ${agent.home.name} to ${target.name}`
        : `starting from ${target.name}`
    if (lateTaxiCommuter) agent.remember('mobility', `I am late for ${target.name} and should use a taxi.`, agent.home.name, 0.7)
    return agent
  }), [city.npcs, places])
  const hipsRef = useRef()
  const torsoRef = useRef()
  const neckRef = useRef()
  const headRef = useRef()
  const hairBackRef = useRef()
  const faceMarkRef = useRef()
  const cheekRef = useRef()
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
  const collarRef = useRef()
  const lapelRef = useRef()
  const badgeRef = useRef()
  const beltRef = useRef()
  const cuffRef = useRef()
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
  const cityEventClock = useRef(0)
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
    const store = useCityStore.getState()
    store.setStats({ npcs: agents.length, cars: city.cars.length, tiles: city.tiles.length, llm: llmStatus() })
    agents.slice(0, 4).forEach((agent, index) => {
      const event = autonomyEventFor(agent, store.timeMinutes + index * 0.01)
      agent.remember(event.kind, event.text, event.placeName, 0.5)
      store.addCityEvent({ ...event, id: `initial_${event.id}_${index}` })
    })
    for (let index = 0; index < Math.min(8, agents.length - 1); index += 2) {
      const a = agents[index]
      const b = agents[index + 1]
      if (!a || !b) continue
      const topic = conversationTopicFor(a, b, store.timeMinutes + index * 0.04)
      a.talk(2.6, b, topic, store.timeMinutes)
      b.talk(2.6, a, topic, store.timeMinutes)
      store.addCityEvent(conversationEventFor(a, b, topic, store.timeMinutes, `initial_social_${index}`))
    }
  }, [agents.length, city.cars.length, city.tiles.length])

  useEffect(() => {
    if (typeof window === 'undefined') return
    const unique = selector => new Set(agents.map(agent => selector(agent)).filter(Boolean)).size
    window.__REALCITY_ACTOR_RENDERING__ = {
      npcBase: 'player-avatar-shared-humanoid',
      playerReference: 'PlayerRig.Character',
      rigScale: {
        npcBaseY: 0.95,
        playerBaseY: 1.1,
        playerCharacterOffsetY: -0.9,
        torsoCapsuleTotalHeight: 0.94,
        armCapsuleTotalHeight: 0.53,
        legCapsuleTotalHeight: 0.65,
      },
      bodyParts: [
        'hips',
        'torso',
        'chest',
        'neck',
        'head',
        'hairCap',
        'hairBack',
        'ears',
        'eyes',
        'brows',
        'nose',
        'mouth',
        'faceMarks',
        'cheeks',
        'arms',
        'sleeves',
        'hands',
        'legs',
        'shoes',
        'collar',
        'lapels',
        'badge',
        'cuffs',
        'belt',
        'bag',
        'hat',
        'scarf',
        'skirt',
        'glasses',
      ],
      variation: {
        count: agents.length,
        heightVariants: unique(agent => agent.appearance?.heightScale?.toFixed(2)),
        bodyVariants: unique(agent => agent.appearance?.bodyArchetype),
        ageBands: unique(agent => agent.appearance?.ageBand),
        ages: unique(agent => String(agent.age)),
        genders: unique(agent => agent.gender),
        hairStyles: unique(agent => agent.appearance?.hairStyle),
        outfitSignatures: unique(agent => agent.appearance?.signature),
        skinTones: unique(agent => agent.appearance?.skinColor),
        faceAccessoryVariants: unique(agent => `${agent.appearance?.glassesStyle}:${agent.appearance?.ageBand}:${agent.gender}`),
      },
      streetReadableDetails: ['collar', 'lapels', 'cheeks', 'front badge', 'pant cuffs'],
      samplePeople: agents.slice(0, 12).map(agent => ({
        id: agent.id,
        name: agent.name,
        age: agent.age,
        gender: agent.gender,
        heightScale: Number((agent.appearance?.heightScale ?? 1).toFixed(3)),
        bodyArchetype: agent.appearance?.bodyArchetype,
        hairStyle: agent.appearance?.hairStyle,
        outfit: agent.appearance?.styleBrief,
      })),
    }
  }, [agents])

  useFrame((state, delta) => {
    if (!hipsRef.current || !torsoRef.current || !neckRef.current || !headRef.current || !hairBackRef.current || !faceMarkRef.current || !cheekRef.current || !legRef.current || !armRef.current || !sleeveRef.current || !hairRef.current || !eyeRef.current || !browRef.current || !noseRef.current || !mouthRef.current || !shoeRef.current || !chestRef.current || !collarRef.current || !lapelRef.current || !badgeRef.current || !beltRef.current || !cuffRef.current || !bagRef.current || !handRef.current || !earRef.current || !hatRef.current || !skirtRef.current || !glassesRef.current || !scarfRef.current) return
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
        hipsRef.current.setColorAt(i, color.set(look.pantsColor))
        torsoRef.current.setColorAt(i, color.set(look.topColor))
        chestRef.current.setColorAt(i, color.set(look.jacketColor))
        neckRef.current.setColorAt(i, color.set(skinTone(agent)))
        headRef.current.setColorAt(i, color.set(skinTone(agent)))
        hairRef.current.setColorAt(i, color.set(hairTone(agent)))
        hairBackRef.current.setColorAt(i, color.set(hairTone(agent)))
        faceMarkRef.current.setColorAt(i * 2, color.set(agent.appearance?.ageBand === 'senior' ? '#7b5b4e' : hairTone(agent)))
        faceMarkRef.current.setColorAt(i * 2 + 1, color.set(agent.appearance?.ageBand === 'senior' ? '#6f5b52' : hairTone(agent)))
        cheekRef.current.setColorAt(i * 2, color.set(skinTone(agent)))
        cheekRef.current.setColorAt(i * 2 + 1, color.set(skinTone(agent)))
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
        collarRef.current.setColorAt(i, color.set(look.outerwear === 'hoodie' ? look.topColor : '#eee4d4'))
        lapelRef.current.setColorAt(i * 2, color.set(look.jacketColor))
        lapelRef.current.setColorAt(i * 2 + 1, color.set(look.jacketColor))
        badgeRef.current.setColorAt(i, color.set(look.accessoryColor))
        beltRef.current.setColorAt(i, color.set(look.accessoryColor))
        cuffRef.current.setColorAt(i * 2, color.set(look.shoeColor))
        cuffRef.current.setColorAt(i * 2 + 1, color.set(look.shoeColor))
        bagRef.current.setColorAt(i, color.set(look.accessoryColor))
        hatRef.current.setColorAt(i, color.set(look.accessoryColor))
        skirtRef.current.setColorAt(i, color.set(look.pantsColor))
        scarfRef.current.setColorAt(i, color.set(look.accessoryColor))
      })
      if (hipsRef.current.instanceColor) hipsRef.current.instanceColor.needsUpdate = true
      if (torsoRef.current.instanceColor) torsoRef.current.instanceColor.needsUpdate = true
      if (chestRef.current.instanceColor) chestRef.current.instanceColor.needsUpdate = true
      if (neckRef.current.instanceColor) neckRef.current.instanceColor.needsUpdate = true
      if (headRef.current.instanceColor) headRef.current.instanceColor.needsUpdate = true
      if (hairRef.current.instanceColor) hairRef.current.instanceColor.needsUpdate = true
      if (hairBackRef.current.instanceColor) hairBackRef.current.instanceColor.needsUpdate = true
      if (faceMarkRef.current.instanceColor) faceMarkRef.current.instanceColor.needsUpdate = true
      if (cheekRef.current.instanceColor) cheekRef.current.instanceColor.needsUpdate = true
      if (armRef.current.instanceColor) armRef.current.instanceColor.needsUpdate = true
      if (sleeveRef.current.instanceColor) sleeveRef.current.instanceColor.needsUpdate = true
      if (handRef.current.instanceColor) handRef.current.instanceColor.needsUpdate = true
      if (earRef.current.instanceColor) earRef.current.instanceColor.needsUpdate = true
      if (browRef.current.instanceColor) browRef.current.instanceColor.needsUpdate = true
      if (legRef.current.instanceColor) legRef.current.instanceColor.needsUpdate = true
      if (shoeRef.current.instanceColor) shoeRef.current.instanceColor.needsUpdate = true
      if (collarRef.current.instanceColor) collarRef.current.instanceColor.needsUpdate = true
      if (lapelRef.current.instanceColor) lapelRef.current.instanceColor.needsUpdate = true
      if (badgeRef.current.instanceColor) badgeRef.current.instanceColor.needsUpdate = true
      if (beltRef.current.instanceColor) beltRef.current.instanceColor.needsUpdate = true
      if (cuffRef.current.instanceColor) cuffRef.current.instanceColor.needsUpdate = true
      if (bagRef.current.instanceColor) bagRef.current.instanceColor.needsUpdate = true
      if (hatRef.current.instanceColor) hatRef.current.instanceColor.needsUpdate = true
      if (skirtRef.current.instanceColor) skirtRef.current.instanceColor.needsUpdate = true
      if (scarfRef.current.instanceColor) scarfRef.current.instanceColor.needsUpdate = true
      colorsReady.current = true
    }

    for (let i = 0; i < agents.length; i += 1) {
      const agent = agents[i]
      const agentState = agent.update(dt, time, places, city)
      if (agentState === 'talking') talks += 1
      const playerDistance = agent.pos.distanceTo(player)
      if (!agent.mission && playerDistance < nearestDistance) {
        nearestAgent = agent
        nearestDistance = playerDistance
      }
      agent.playerDistance = Number(playerDistance.toFixed(2))
      agent.facingPlayerAngle = null
      agent.socialReaction = null
      if (!agent.mission && agentState !== 'walking' && playerDistance < NPC_GLANCE_RADIUS) {
        const desired = Math.atan2(store.player.x - agent.pos.x, store.player.z - agent.pos.z)
        const turn = Math.atan2(Math.sin(desired - agent.heading), Math.cos(desired - agent.heading))
        agent.heading += turn * Math.min(1, dt * 3.8)
        const afterTurn = Math.atan2(Math.sin(desired - agent.heading), Math.cos(desired - agent.heading))
        agent.facingPlayerAngle = Number(Math.abs(afterTurn).toFixed(3))
        agent.socialReaction = Math.abs(afterTurn) < 0.72 ? 'glancing-at-player' : 'turning-toward-player'
        if (agent.glanceCooldown <= 0) {
          agent.glanceCooldown = 7 + Math.random() * 8
          if (playerDistance < NPC_GLANCE_PULSE_RADIUS) {
            store.setPulse(`${agent.name} glances over as you pass through ${agent.placeName}.`)
          }
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
      const longHair = look.hairStyle === 'long'
      const bobHair = look.hairStyle === 'bob'
      const hairLong = longHair || bobHair
      const hairBun = look.hairStyle === 'bun'
      const shaved = look.hairStyle === 'shaved'
      const hatVisible = (look.hatStyle && look.hatStyle !== 'none') || look.hairStyle === 'cap'
      const bagVisible = look.bagStyle && look.bagStyle !== 'none'
      const skirtVisible = look.bottomStyle === 'skirt'
      const glassesVisible = look.glassesStyle && look.glassesStyle !== 'none'
      const scarfVisible = look.scarfStyle && look.scarfStyle !== 'none'
      const seniorFace = look.ageBand === 'senior' || agent.age >= 60
      const facialHair = agent.gender === 'man' && (seniorFace || hashValue(`${agent.id}_face_hair`) % 4 === 0)
      const hipY = 0.03 * height
      const torsoY = 0.45 * height
      const chestY = 0.52 * height
      const shoulderY = 0.59 * height
      const neckY = 0.82 * height
      const headY = 0.97 * height
      const eyeY = 1.0 * height
      const browY = 1.04 * height
      const mouthY = 0.875 * height
      const hairY = (hairLong ? 1.02 : 1.13) * height
      const hairBackY = (longHair ? 0.78 : bobHair ? 0.9 : 0.97) * height
      const hairCapHeight = hairBun ? 0.15 : longHair ? 0.22 : bobHair ? 0.16 : 0.105
      setLocalPart(hipsRef.current, i, dummy, base, agent.heading, [0, hipY, 0], [0.38 * shoulder, 0.2 * height * bodyScale, 0.25 * bodyScale], bodyRotX, bodyRotZ)
      setLocalPart(torsoRef.current, i, dummy, base, agent.heading, [0, torsoY, 0], [0.21 * shoulder, (walking ? 0.25 : 0.235) * height * bodyScale, 0.16 * bodyScale], bodyRotX, bodyRotZ)
      setLocalPart(neckRef.current, i, dummy, base, agent.heading, [0, neckY, 0.01], [0.075 * headScale, 0.12 * height, 0.075 * headScale], bodyRotX * 0.82, bodyRotZ)
      setLocalPart(headRef.current, i, dummy, base, agent.heading, [0, headY, 0.025], [0.205 * headScale, 0.225 * headScale, 0.205 * headScale], bodyRotX * 0.68, bodyRotZ)
      setLocalPart(hairRef.current, i, dummy, base, agent.heading, [0, hairY, hairLong ? -0.055 : -0.02], shaved ? [0.16 * headScale, 0.035 * headScale, 0.17 * headScale] : [0.215 * headScale, hairCapHeight * headScale, 0.22 * headScale], bodyRotX * 0.68, bodyRotZ)
      setLocalPart(hairBackRef.current, i, dummy, base, agent.heading, [0, hairBackY, hairLong ? -0.16 : -0.145], shaved ? [0.001, 0.001, 0.001] : [0.33 * headScale, (longHair ? 0.42 : bobHair ? 0.26 : 0.14) * headScale, 0.075 * headScale], bodyRotX * 0.64, bodyRotZ)
      setLocalPart(earRef.current, i * 2, dummy, base, agent.heading, [-0.215 * headScale, 0.96 * height, 0.02], [0.03, 0.042, 0.02])
      setLocalPart(earRef.current, i * 2 + 1, dummy, base, agent.heading, [0.215 * headScale, 0.96 * height, 0.02], [0.03, 0.042, 0.02])
      setLocalPart(eyeRef.current, i * 2, dummy, base, agent.heading, [-0.086 * headScale, eyeY, 0.188], [0.022, 0.022, 0.014])
      setLocalPart(eyeRef.current, i * 2 + 1, dummy, base, agent.heading, [0.086 * headScale, eyeY, 0.188], [0.022, 0.022, 0.014])
      setLocalPart(browRef.current, i * 2, dummy, base, agent.heading, [-0.086 * headScale, browY, 0.2], [0.058, 0.009, 0.011], 0, -0.08)
      setLocalPart(browRef.current, i * 2 + 1, dummy, base, agent.heading, [0.086 * headScale, browY, 0.2], [0.058, 0.009, 0.011], 0, 0.08)
      setLocalPart(noseRef.current, i, dummy, base, agent.heading, [0, 0.94 * height, 0.215], [0.026, 0.052, 0.026])
      setLocalPart(mouthRef.current, i, dummy, base, agent.heading, [0, mouthY, 0.202], [0.088, 0.012, 0.014])
      setLocalPart(faceMarkRef.current, i * 2, dummy, base, agent.heading, [0, 0.915 * height, 0.222], facialHair ? [0.12 * headScale, 0.018, 0.012] : [0.001, 0.001, 0.001])
      setLocalPart(faceMarkRef.current, i * 2 + 1, dummy, base, agent.heading, [0, 1.025 * height, 0.21], seniorFace ? [0.13 * headScale, 0.008, 0.01] : [0.001, 0.001, 0.001])
      setLocalPart(cheekRef.current, i * 2, dummy, base, agent.heading, [-0.07 * headScale, 0.925 * height, 0.218], [0.033, 0.018, 0.011])
      setLocalPart(cheekRef.current, i * 2 + 1, dummy, base, agent.heading, [0.07 * headScale, 0.925 * height, 0.218], [0.033, 0.018, 0.011])
      setLocalPart(glassesRef.current, i * 2, dummy, base, agent.heading, [-0.086 * headScale, eyeY, 0.21], glassesVisible ? [0.06, 0.014, 0.014] : [0.001, 0.001, 0.001])
      setLocalPart(glassesRef.current, i * 2 + 1, dummy, base, agent.heading, [0.086 * headScale, eyeY, 0.21], glassesVisible ? [0.06, 0.014, 0.014] : [0.001, 0.001, 0.001])
      setLocalPart(chestRef.current, i, dummy, base, agent.heading, [0, chestY, 0.18], [0.28 * shoulder, 0.34 * height, 0.035], bodyRotX, bodyRotZ)
      setLocalPart(collarRef.current, i, dummy, base, agent.heading, [0, 0.75 * height, 0.205], [0.17 * shoulder, 0.03 * height, 0.018], bodyRotX, bodyRotZ)
      setLocalPart(lapelRef.current, i * 2, dummy, base, agent.heading, [-0.072 * shoulder, 0.52 * height, 0.206], [0.035, 0.2 * height, 0.015], bodyRotX, bodyRotZ - 0.16)
      setLocalPart(lapelRef.current, i * 2 + 1, dummy, base, agent.heading, [0.072 * shoulder, 0.52 * height, 0.206], [0.035, 0.2 * height, 0.015], bodyRotX, bodyRotZ + 0.16)
      setLocalPart(badgeRef.current, i, dummy, base, agent.heading, [0.105 * shoulder, 0.58 * height, 0.222], [0.028, 0.038, 0.012], bodyRotX, bodyRotZ)
      setLocalPart(beltRef.current, i, dummy, base, agent.heading, [0, 0.15 * height, 0.158], [0.19 * shoulder, 0.025, 0.032])
      setLocalPart(bagRef.current, i, dummy, base, agent.heading, [0.24 * shoulder, 0.38 * height, -0.13], bagVisible ? [0.1, 0.22 * height, 0.055] : [0.001, 0.001, 0.001])
      setLocalPart(hatRef.current, i, dummy, base, agent.heading, [0, 1.18 * height, 0.006], hatVisible ? [0.2 * headScale, 0.08, 0.2 * headScale] : [0.001, 0.001, 0.001])
      setLocalPart(skirtRef.current, i, dummy, base, agent.heading, [0, -0.05 * height, 0], skirtVisible ? [0.22 * shoulder, 0.3 * height, 0.18] : [0.001, 0.001, 0.001])
      setLocalPart(scarfRef.current, i, dummy, base, agent.heading, [0, 0.75 * height, 0.15], scarfVisible ? [0.19 * shoulder, look.scarfStyle === 'wide' ? 0.052 : 0.034, 0.044] : [0.001, 0.001, 0.001])
      setLocalPart(legRef.current, i * 2, dummy, base, agent.heading, [-0.12 * shoulder, -0.35 * height, 0], [0.065, 0.1625 * height * legScale, 0.065], fallen ? 0.55 : stride, bodyRotZ * 0.35)
      setLocalPart(legRef.current, i * 2 + 1, dummy, base, agent.heading, [0.12 * shoulder, -0.35 * height, 0], [0.065, 0.1625 * height * legScale, 0.065], fallen ? -0.35 : -stride, bodyRotZ * 0.35)
      setLocalPart(armRef.current, i * 2, dummy, base, agent.heading, [-0.28 * shoulder, 0.33 * height, 0.02], [0.055, 0.1325 * height, 0.055], fallen ? 0.92 : -stride * 0.55 * armSwing, bodyRotZ)
      setLocalPart(armRef.current, i * 2 + 1, dummy, base, agent.heading, [0.28 * shoulder, 0.33 * height, 0.02], [0.055, 0.1325 * height, 0.055], fallen ? -0.72 : stride * 0.55 * armSwing, bodyRotZ)
      setLocalPart(sleeveRef.current, i * 2, dummy, base, agent.heading, [-0.27 * shoulder, shoulderY, 0.026], [0.065, 0.065 * height, 0.065], -stride * 0.38 * armSwing)
      setLocalPart(sleeveRef.current, i * 2 + 1, dummy, base, agent.heading, [0.27 * shoulder, shoulderY, 0.026], [0.065, 0.065 * height, 0.065], stride * 0.38 * armSwing)
      setLocalPart(handRef.current, i * 2, dummy, base, agent.heading, [-0.28 * shoulder, 0.08 * height, 0.035], [0.065, 0.065, 0.065])
      setLocalPart(handRef.current, i * 2 + 1, dummy, base, agent.heading, [0.28 * shoulder, 0.08 * height, 0.035], [0.065, 0.065, 0.065])
      setLocalPart(shoeRef.current, i * 2, dummy, base, agent.heading, [-0.12 * shoulder, -0.68 * height, 0.055], [0.11, 0.06, 0.18])
      setLocalPart(shoeRef.current, i * 2 + 1, dummy, base, agent.heading, [0.12 * shoulder, -0.68 * height, 0.055], [0.11, 0.06, 0.18])
      setLocalPart(cuffRef.current, i * 2, dummy, base, agent.heading, [-0.12 * shoulder, -0.58 * height, 0.046], [0.075, 0.026, 0.078], fallen ? 0.55 : stride, bodyRotZ * 0.35)
      setLocalPart(cuffRef.current, i * 2 + 1, dummy, base, agent.heading, [0.12 * shoulder, -0.58 * height, 0.046], [0.075, 0.026, 0.078], fallen ? -0.35 : -stride, bodyRotZ * 0.35)
    }

    socialClock.current += dt
    statsClock.current += dt
    nearbyClock.current += dt
    cityEventClock.current += dt

    if (socialClock.current > 0.8) {
      socialClock.current = 0
      for (let tries = 0; tries < 18; tries += 1) {
        const a = agents[Math.floor(Math.random() * agents.length)]
        const b = agents[Math.floor(Math.random() * agents.length)]
        if (!a || !b || a === b || a.socialCooldown > 0 || b.socialCooldown > 0) continue
        if (a.pos.distanceTo(b.pos) > 4.4) continue
        const topic = conversationTopicFor(a, b, time)
        a.talk(5, b, topic, time)
        b.talk(5, a, topic, time)
        store.addCityEvent(conversationEventFor(a, b, topic, time))
        if (a.pos.distanceTo(player) < 45) store.setPulse(`${a.name} and ${b.name} discuss ${topic.label} near ${a.placeName}.`)
        break
      }
    }

    if (cityEventClock.current > 2.8) {
      cityEventClock.current = 0
      const index = Math.floor((state.clock.elapsedTime * 17 + time) % agents.length)
      const agent = agents[index]
      if (agent) {
        const event = autonomyEventFor(agent, time)
        agent.remember(event.kind, event.text, event.placeName, event.kind === 'need' ? 0.78 : 0.46)
        store.addCityEvent(event)
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
        socialReaction: agent.socialReaction || null,
        playerDistance: agent.playerDistance,
        facingPlayerAngle: agent.facingPlayerAngle,
        currentIntent: agent.currentIntent || null,
        autonomyGoal: agent.autonomy?.dailyGoal || null,
        relationshipStyle: agent.autonomy?.relationshipStyle || null,
        relationshipCount: agent.relationshipCount || 0,
        lastInteractionPartner: agent.lastInteraction?.partnerName || null,
        lastInteractionTopic: agent.lastInteraction?.topic || null,
        lastInteractionTrust: agent.lastInteraction?.trust ?? null,
        knownContacts: Object.values(agent.relationships || {}).slice(0, 3).map(contact => ({
          id: contact.agentId,
          name: contact.name,
          job: contact.job,
          trust: Number(contact.trust.toFixed(2)),
          talks: contact.talks,
          lastTopic: contact.lastTopic,
        })),
        memoryCount: agent.memories?.length || 0,
        lastMemory: agent.memories?.[0]?.text || null,
        energy: agent.needs ? Number(agent.needs.energy.toFixed(2)) : null,
        hunger: agent.needs ? Number(agent.needs.hunger.toFixed(2)) : null,
        socialNeed: agent.needs ? Number(agent.needs.social.toFixed(2)) : null,
        targetName: agent.walkPlan?.targetName || agent.placeName || null,
        travelMode: agent.selfTaxi ? 'taxi' : 'walk',
        taxiPhase: agent.selfTaxi?.phase || null,
        taxiDriverName: agent.selfTaxi?.driverName || null,
        taxiTargetName: agent.selfTaxi?.targetName || null,
        taxiRouteMeters: agent.selfTaxi?.routeMeters ? Number(agent.selfTaxi.routeMeters.toFixed(1)) : null,
        routeMode: agent.walkPlan?.mode || 'direct',
        routeRoadName: agent.walkPlan?.roadName || null,
        stableRoute: !!agent.walkPlan?.stableRoute,
        routeIndex: agent.walkPlan?.routeIndex ?? null,
        routePoints: agent.walkPlan?.routePoints ?? null,
        replanCount: agent.walkPlan?.replanCount ?? 0,
        blockedContacts: agent.blockedContacts || 0,
        waypointName: agent.walkPlan?.waypointName || null,
        waypointX: agent.walkPlan?.waypoint?.x ?? null,
        waypointZ: agent.walkPlan?.waypoint?.z ?? null,
        crosswalkX: agent.walkPlan?.crosswalk?.x ?? null,
        crosswalkZ: agent.walkPlan?.crosswalk?.z ?? null,
        distanceToTarget: agent.walkPlan?.distanceToTarget ? Number(agent.walkPlan.distanceToTarget.toFixed(2)) : null,
        distanceToWaypoint: agent.walkPlan?.distanceToWaypoint ? Number(agent.walkPlan.distanceToWaypoint.toFixed(2)) : null,
      })))
      store.setNearbyAgent(nearestAgent && nearestDistance <= 24
        ? { ...nearestAgent.snapshot(places), distance: nearestDistance }
        : null)
    }

    hipsRef.current.instanceMatrix.needsUpdate = true
    torsoRef.current.instanceMatrix.needsUpdate = true
    neckRef.current.instanceMatrix.needsUpdate = true
    headRef.current.instanceMatrix.needsUpdate = true
    hairRef.current.instanceMatrix.needsUpdate = true
    hairBackRef.current.instanceMatrix.needsUpdate = true
    faceMarkRef.current.instanceMatrix.needsUpdate = true
    cheekRef.current.instanceMatrix.needsUpdate = true
    eyeRef.current.instanceMatrix.needsUpdate = true
    browRef.current.instanceMatrix.needsUpdate = true
    noseRef.current.instanceMatrix.needsUpdate = true
    mouthRef.current.instanceMatrix.needsUpdate = true
    chestRef.current.instanceMatrix.needsUpdate = true
    collarRef.current.instanceMatrix.needsUpdate = true
    lapelRef.current.instanceMatrix.needsUpdate = true
    badgeRef.current.instanceMatrix.needsUpdate = true
    beltRef.current.instanceMatrix.needsUpdate = true
    cuffRef.current.instanceMatrix.needsUpdate = true
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
      best.remember('player-request', `Player asked: ${request}. ${plan.offer || plan.reasoning || plan.intent}.`, best.placeName, 0.84)
      store.addCityEvent({
        id: `request_${best.id}_${Date.now()}`,
        kind: 'request',
        agentId: best.id,
        agentName: best.name,
        placeName: best.placeName,
        topic: plan.reasoning || plan.intent,
        text: `${best.name} considers the player's request: ${plan.offer || plan.intent}. ${plan.safety || ''}`.slice(0, 180),
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
        source: plan.source,
        destination: destinationTarget,
        pickup: nearestRoadPickup(best.pos, city.roads),
        steps: plan.steps,
        reasoning: plan.reasoning,
        safety: plan.safety,
        offer: plan.offer,
        urgency: plan.urgency,
        request,
      }

      best.mission = mission
      best.talk(2.4)
      store.setInteraction({ status: 'active', plan })
      store.startMission({
        id: mission.id,
        agentId: best.id,
        agentName: best.name,
        mode,
        phase: mission.phase,
        destination: destinationTarget,
        pickup: mission.pickup,
        steps: plan.steps,
        reasoning: plan.reasoning,
        safety: plan.safety,
        offer: plan.offer,
        urgency: plan.urgency,
        request,
        source: plan.source,
        summary: plan.speech,
      })
      if (mode === 'taxi') {
        beginTaxiDispatch(best, mission, store, city)
      }
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

    const onTaxiBoardRequested = (event) => {
      const { missionId } = event.detail || {}
      if (!missionId) return
      const agent = agents.find(item => item.mission?.id === missionId)
      if (agent?.mission) {
        const storeMission = useCityStore.getState().mission
        agent.mission.boardingRequested = true
        agent.mission.phase = storeMission?.phase || 'taxi_boarding'
        agent.mission.boardingStartedAt = storeMission?.boardingStartedAt || performance.now()
        agent.mission.boardingPlayerStart = storeMission?.boardingPlayerStart || null
      }
    }

    window.addEventListener('keydown', onKey)
    window.addEventListener('realcity:npc-request', onNpcRequest)
    window.addEventListener('realcity:player-hit-npc', onNpcHit)
    window.addEventListener('realcity:taxi-board-requested', onTaxiBoardRequested)
    return () => {
      window.removeEventListener('keydown', onKey)
      window.removeEventListener('realcity:npc-request', onNpcRequest)
      window.removeEventListener('realcity:player-hit-npc', onNpcHit)
      window.removeEventListener('realcity:taxi-board-requested', onTaxiBoardRequested)
    }
  }, [agents, city, city.roads, places, destinations])

  return (
    <>
      <instancedMesh ref={hipsRef} args={[undefined, undefined, agents.length]} castShadow frustumCulled={false}>
        <boxGeometry args={[1, 1, 1]} />
        <meshStandardMaterial map={textures.fabric} color="#ffffff" vertexColors roughness={0.82} metalness={0.03} />
      </instancedMesh>
      <instancedMesh ref={torsoRef} args={[undefined, undefined, agents.length]} castShadow frustumCulled={false}>
        <capsuleGeometry args={[1, 2, 8, 14]} />
        <meshStandardMaterial map={textures.fabric} color="#ffffff" vertexColors roughness={0.78} metalness={0.03} />
      </instancedMesh>
      <instancedMesh ref={chestRef} args={[undefined, undefined, agents.length]} castShadow frustumCulled={false}>
        <boxGeometry args={[1, 1, 1]} />
        <meshStandardMaterial map={textures.fabric} color="#ffffff" vertexColors roughness={0.64} metalness={0.04} />
      </instancedMesh>
      <instancedMesh ref={collarRef} args={[undefined, undefined, agents.length]} castShadow frustumCulled={false}>
        <boxGeometry args={[1, 1, 1]} />
        <meshStandardMaterial map={textures.fabric} color="#eee4d4" vertexColors roughness={0.62} metalness={0.02} />
      </instancedMesh>
      <instancedMesh ref={lapelRef} args={[undefined, undefined, agents.length * 2]} castShadow frustumCulled={false}>
        <boxGeometry args={[1, 1, 1]} />
        <meshStandardMaterial map={textures.fabric} color="#ffffff" vertexColors roughness={0.68} metalness={0.03} />
      </instancedMesh>
      <instancedMesh ref={badgeRef} args={[undefined, undefined, agents.length]} castShadow frustumCulled={false}>
        <boxGeometry args={[1, 1, 1]} />
        <meshStandardMaterial map={textures.metal} color="#c49a4f" vertexColors roughness={0.38} metalness={0.36} />
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
      <instancedMesh ref={hairBackRef} args={[undefined, undefined, agents.length]} castShadow frustumCulled={false}>
        <boxGeometry args={[1, 1, 1]} />
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
      <instancedMesh ref={faceMarkRef} args={[undefined, undefined, agents.length * 2]} frustumCulled={false}>
        <boxGeometry args={[1, 1, 1]} />
        <meshStandardMaterial color="#4b2b22" vertexColors roughness={0.76} />
      </instancedMesh>
      <instancedMesh ref={cheekRef} args={[undefined, undefined, agents.length * 2]} frustumCulled={false}>
        <sphereGeometry args={[1, 8, 6]} />
        <meshStandardMaterial map={textures.skin} color="#efc29a" vertexColors roughness={0.7} />
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
      <instancedMesh ref={cuffRef} args={[undefined, undefined, agents.length * 2]} castShadow frustumCulled={false}>
        <boxGeometry args={[1, 1, 1]} />
        <meshStandardMaterial map={textures.rubber} color="#10151c" vertexColors roughness={0.78} />
      </instancedMesh>
    </>
  )
}

export default function Actors({ city }) {
  return (
    <>
      <Traffic cars={city.cars} roads={city.roads} />
      <PlayerTaxiController city={city} />
      <TaxiRouteRibbon />
      <MissionTaxi />
      <NPCs city={city} />
    </>
  )
}
