function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value))
}

function pointDistance(a, b) {
  return Math.hypot(a.x - b.x, a.z - b.z)
}

function routeDistance(points = []) {
  let distance = 0
  for (let i = 1; i < points.length; i += 1) distance += pointDistance(points[i - 1], points[i])
  return distance
}

function pointOnRoadCenter(road, along) {
  if (road.axis === 'x') return { x: clamp(along, road.from, road.to), z: road.z }
  return { x: road.x, z: clamp(along, road.from, road.to) }
}

export function roadLaneOffset(road, direction = 1) {
  const laneOffset = road.width * (road.main ? 0.27 : 0.22)
  return road.axis === 'x' ? direction * laneOffset : -direction * laneOffset
}

export function pointOnRoadLane(road, along, direction = 1) {
  const lane = roadLaneOffset(road, direction)
  if (road.axis === 'x') return { x: clamp(along, road.from, road.to), z: road.z + lane, roadId: road.id, roadName: road.name, roadAxis: road.axis, laneDirection: direction }
  return { x: road.x + lane, z: clamp(along, road.from, road.to), roadId: road.id, roadName: road.name, roadAxis: road.axis, laneDirection: direction }
}

function roadContainsIntersection(road, cross) {
  if (road.axis === 'x') return cross.x >= road.from && cross.x <= road.to
  return cross.z >= road.from && cross.z <= road.to
}

function roadsIntersect(a, b) {
  const horizontal = a.axis === 'x' ? a : b
  const vertical = a.axis === 'z' ? a : b
  const point = { x: vertical.x, z: horizontal.z }
  if (!roadContainsIntersection(horizontal, point) || !roadContainsIntersection(vertical, point)) return null
  return point
}

function samePoint(a, b) {
  return Math.hypot(a.x - b.x, a.z - b.z) < 0.08
}

function cleanRoute(points) {
  const cleaned = []
  for (const point of points) {
    if (!point || !Number.isFinite(point.x) || !Number.isFinite(point.z)) continue
    const next = { ...point, x: Number(point.x.toFixed(3)), z: Number(point.z.toFixed(3)) }
    if (cleaned.length && samePoint(cleaned[cleaned.length - 1], next)) continue
    cleaned.push(next)
  }

  const simplified = []
  for (const point of cleaned) {
    const a = simplified[simplified.length - 2]
    const b = simplified[simplified.length - 1]
    const c = point
    if (a && b) {
      const collinearX = Math.abs(a.x - b.x) < 0.08 && Math.abs(b.x - c.x) < 0.08
      const collinearZ = Math.abs(a.z - b.z) < 0.08 && Math.abs(b.z - c.z) < 0.08
      if (collinearX || collinearZ) simplified.pop()
    }
    simplified.push(c)
  }
  return simplified
}

function roadForSegment(a, b, roads = []) {
  const dx = Math.abs(b.x - a.x)
  const dz = Math.abs(b.z - a.z)
  const axis = dx >= dz ? 'x' : 'z'
  const midpoint = { x: (a.x + b.x) / 2, z: (a.z + b.z) / 2 }
  let best = null
  let bestScore = Infinity
  for (const road of roads) {
    if (road.axis !== axis) continue
    const along = axis === 'x' ? midpoint.x : midpoint.z
    if (along < road.from - 2 || along > road.to + 2) continue
    const score = axis === 'x' ? Math.abs(midpoint.z - road.z) : Math.abs(midpoint.x - road.x)
    if (score < bestScore) {
      best = road
      bestScore = score
    }
  }
  return best
}

function directionForSegment(road, a, b) {
  const delta = road.axis === 'x' ? b.x - a.x : b.z - a.z
  return delta >= 0 ? 1 : -1
}

function lanePointForSegment(point, road, direction) {
  const along = road.axis === 'x' ? point.x : point.z
  return pointOnRoadLane(road, along, direction)
}

function laneRouteFromCenterRoute(points, roads = [], from, to) {
  if (points.length < 2) return cleanRoute(points)
  const lanePoints = []
  for (let i = 1; i < points.length; i += 1) {
    const a = points[i - 1]
    const b = points[i]
    const road = roadForSegment(a, b, roads)
    const direction = road ? directionForSegment(road, a, b) : 1
    const start = road ? lanePointForSegment(a, road, direction) : a
    const end = road ? lanePointForSegment(b, road, direction) : b
    if (!lanePoints.length || !samePoint(lanePoints[lanePoints.length - 1], start)) lanePoints.push(start)
    lanePoints.push(end)
  }

  if (from?.roadId && Number.isFinite(from.x) && Number.isFinite(from.z)) lanePoints[0] = { ...lanePoints[0], ...from }
  if (to?.roadId && Number.isFinite(to.x) && Number.isFinite(to.z)) lanePoints[lanePoints.length - 1] = { ...lanePoints[lanePoints.length - 1], ...to }
  return cleanRoute(lanePoints)
}

function smoothRouteCorners(points = [], radius = 12) {
  if (points.length < 3) return points
  const smoothed = [points[0]]
  for (let i = 1; i < points.length - 1; i += 1) {
    const prev = points[i - 1]
    const current = points[i]
    const next = points[i + 1]
    const inLen = pointDistance(prev, current)
    const outLen = pointDistance(current, next)
    if (inLen < 4 && outLen >= 4) {
      continue
    }
    if (inLen < 4 || outLen < 4) {
      smoothed.push(current)
      continue
    }

    const inDir = { x: (prev.x - current.x) / inLen, z: (prev.z - current.z) / inLen }
    const outDir = { x: (next.x - current.x) / outLen, z: (next.z - current.z) / outLen }
    const dot = clamp(inDir.x * outDir.x + inDir.z * outDir.z, -1, 1)
    const angle = Math.acos(dot)
    if (angle < 0.18 || Math.abs(Math.PI - angle) < 0.12) {
      smoothed.push(current)
      continue
    }

    const turnRadius = Math.min(radius, inLen * 0.42, outLen * 0.42)
    const start = { x: current.x + inDir.x * turnRadius, z: current.z + inDir.z * turnRadius }
    const end = { x: current.x + outDir.x * turnRadius, z: current.z + outDir.z * turnRadius }
    if (!samePoint(smoothed[smoothed.length - 1], start)) smoothed.push(start)
    for (let step = 1; step <= 4; step += 1) {
      const t = step / 5
      const inv = 1 - t
      smoothed.push({
        x: inv * inv * start.x + 2 * inv * t * current.x + t * t * end.x,
        z: inv * inv * start.z + 2 * inv * t * current.z + t * t * end.z,
      })
    }
    smoothed.push(end)
  }
  smoothed.push(points[points.length - 1])
  return cleanRoute(smoothed)
}

export function nearestRoadProjection(pos, roads = []) {
  const hintedRoad = pos?.road || (pos?.roadId ? roads.find(road => road.id === pos.roadId) : null)
  if (hintedRoad) {
    const point = hintedRoad.axis === 'x'
      ? { x: clamp(pos.x, hintedRoad.from, hintedRoad.to), z: hintedRoad.z }
      : { x: hintedRoad.x, z: clamp(pos.z, hintedRoad.from, hintedRoad.to) }
    return { ...point, road: hintedRoad, distance: pointDistance(pos, point) }
  }

  let best = null
  let bestDistance = Infinity

  for (const road of roads) {
    const point = road.axis === 'x'
      ? { x: clamp(pos.x, road.from, road.to), z: road.z }
      : { x: road.x, z: clamp(pos.z, road.from, road.to) }
    const distance = pointDistance(pos, point)
    if (distance < bestDistance) {
      bestDistance = distance
      best = { ...point, road, distance }
    }
  }

  return best
}

function chooseConnectorRoad(startRoad, endRoad, roads) {
  const candidates = roads.filter(road => road.axis !== startRoad.axis)
  const midpoint = startRoad.axis === 'x'
    ? (nearestCoord(startRoad, endRoad, 'x') || 0)
    : (nearestCoord(startRoad, endRoad, 'z') || 0)

  let best = null
  let bestScore = Infinity
  for (const road of candidates) {
    const first = roadsIntersect(startRoad, road)
    const second = roadsIntersect(endRoad, road)
    if (!first || !second) continue
    const coord = startRoad.axis === 'x' ? road.x : road.z
    const score = Math.abs(coord - midpoint) + (road.main ? -35 : 0)
    if (score < bestScore) {
      best = { road, first, second }
      bestScore = score
    }
  }
  return best
}

function nearestCoord(startRoad, endRoad, axis) {
  if (axis === 'x') {
    if (startRoad.axis === 'z') return startRoad.x
    if (endRoad.axis === 'z') return endRoad.x
    return (startRoad.from + startRoad.to + endRoad.from + endRoad.to) / 4
  }
  if (startRoad.axis === 'x') return startRoad.z
  if (endRoad.axis === 'x') return endRoad.z
  return (startRoad.from + startRoad.to + endRoad.from + endRoad.to) / 4
}

export function buildTaxiRoute(from, to, roads = []) {
  const start = nearestRoadProjection(from, roads)
  const end = nearestRoadProjection(to, roads)
  if (!start || !end) {
    const fallback = cleanRoute([from, to])
    return {
      points: fallback,
      routeMeters: routeDistance(fallback),
      directMeters: pointDistance(from, to),
      roadNames: [],
      turns: 0,
    }
  }

  const points = [{ x: start.x, z: start.z }]
  const roadNames = new Set([start.road.name, end.road.name].filter(Boolean))
  let turns = 0

  if (start.road.axis !== end.road.axis) {
    const intersection = roadsIntersect(start.road, end.road)
    if (intersection) {
      points.push(intersection)
      turns = 1
    } else {
      const connector = chooseConnectorRoad(start.road, end.road, roads)
      if (connector) {
        roadNames.add(connector.road.name)
        points.push(connector.first, connector.second)
        turns = 2
      }
    }
  } else if (start.road.id !== end.road.id) {
    const connector = chooseConnectorRoad(start.road, end.road, roads)
    if (connector) {
      roadNames.add(connector.road.name)
      points.push(connector.first, connector.second)
      turns = 2
    }
  }

  points.push({ x: end.x, z: end.z })
  const laneRoute = laneRouteFromCenterRoute(points, roads, from, to)
  const cleaned = smoothRouteCorners(laneRoute)
  return {
    points: cleaned,
    routeMeters: routeDistance(cleaned),
    directMeters: pointDistance(from, to),
    roadNames: [...roadNames],
    turns,
  }
}

export function taxiSpawnForPickup(pickup, roads = [], distance = 230) {
  const start = nearestRoadProjection(pickup, roads)
  if (!start) return { x: pickup.x - distance, z: pickup.z }
  const road = start.road
  const laneDirection = pickup.laneDirection || (road.axis === 'x'
    ? (pickup.z >= road.z ? 1 : -1)
    : (pickup.x >= road.x ? -1 : 1))

  if (road.axis === 'x') {
    const leftSpace = start.x - road.from
    const rightSpace = road.to - start.x
    const offset = leftSpace > rightSpace ? -distance : distance
    return pointOnRoadLane(road, start.x + offset, laneDirection)
  }

  const backSpace = start.z - road.from
  const forwardSpace = road.to - start.z
  const offset = backSpace > forwardSpace ? -distance : distance
  return pointOnRoadLane(road, start.z + offset, laneDirection)
}

function positionAtRouteDistance(points = [], distance = 0) {
  if (!points.length) return { x: 0, z: 0, heading: 0, t: 1 }
  if (points.length === 1) return { ...points[0], heading: 0, t: 1 }

  const total = Math.max(0.001, routeDistance(points))
  let remaining = clamp(distance, 0, total)

  for (let i = 1; i < points.length; i += 1) {
    const a = points[i - 1]
    const b = points[i]
    const segment = pointDistance(a, b)
    if (segment <= 0.001) continue
    if (remaining <= segment || i === points.length - 1) {
      const t = clamp(remaining / segment, 0, 1)
      const x = a.x + (b.x - a.x) * t
      const z = a.z + (b.z - a.z) * t
      return {
        x,
        z,
        t: distance / total,
        segmentIndex: i - 1,
        segmentHeading: Math.atan2(b.x - a.x, b.z - a.z),
      }
    }
    remaining -= segment
  }

  const a = points[points.length - 2]
  const b = points[points.length - 1]
  return {
    ...b,
    t: 1,
    segmentIndex: points.length - 2,
    segmentHeading: Math.atan2(b.x - a.x, b.z - a.z),
  }
}

export function sampleRoute(points = [], distance = 0) {
  const position = positionAtRouteDistance(points, distance)
  if (!points.length || points.length === 1) return position

  const total = Math.max(0.001, routeDistance(points))
  const lookDistance = Math.min(6, Math.max(2.4, total * 0.012))
  const behind = positionAtRouteDistance(points, Math.max(0, distance - lookDistance))
  const ahead = positionAtRouteDistance(points, Math.min(total, distance + lookDistance))
  const dx = ahead.x - behind.x
  const dz = ahead.z - behind.z
  const heading = Math.hypot(dx, dz) > 0.001
    ? Math.atan2(dx, dz)
    : position.segmentHeading || 0
  return { ...position, heading }
}

export function taxiPassengerDoorPoint(taxi, role = 'player') {
  const pose = taxi?.pose || taxi?.pickupStop || taxi?.dropoffStop
  const curb = taxi?.passengerPickup || taxi?.pickup || taxi?.dropoff || pose
  if (!pose) return { x: 0, z: 0 }

  const heading = pose.heading ?? pose.yaw ?? 0
  let sideX = (curb?.x || pose.x) - pose.x
  let sideZ = (curb?.z || pose.z) - pose.z
  const sideLength = Math.hypot(sideX, sideZ)
  if (sideLength > 0.001) {
    sideX /= sideLength
    sideZ /= sideLength
  } else {
    sideX = Math.cos(heading)
    sideZ = -Math.sin(heading)
  }
  const forwardX = Math.sin(heading)
  const forwardZ = Math.cos(heading)
  const foreAft = role === 'agent' ? -0.95 : 0.35
  const side = role === 'inside' ? 0.28 : 1.82
  return {
    x: pose.x + sideX * side + forwardX * foreAft,
    z: pose.z + sideZ * side + forwardZ * foreAft,
    heading,
  }
}

export { routeDistance }
