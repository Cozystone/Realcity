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
    const next = { x: Number(point.x.toFixed(3)), z: Number(point.z.toFixed(3)) }
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

export function nearestRoadProjection(pos, roads = []) {
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

  const points = [{ x: from.x, z: from.z }, { x: start.x, z: start.z }]
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

  points.push({ x: end.x, z: end.z }, { x: to.x, z: to.z })
  const cleaned = cleanRoute(points)
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

  if (road.axis === 'x') {
    const leftSpace = start.x - road.from
    const rightSpace = road.to - start.x
    const offset = leftSpace > rightSpace ? -distance : distance
    return pointOnRoadCenter(road, start.x + offset)
  }

  const backSpace = start.z - road.from
  const forwardSpace = road.to - start.z
  const offset = backSpace > forwardSpace ? -distance : distance
  return pointOnRoadCenter(road, start.z + offset)
}

export function sampleRoute(points = [], distance = 0) {
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
        heading: Math.atan2(b.x - a.x, b.z - a.z),
        t: distance / total,
        segmentIndex: i - 1,
      }
    }
    remaining -= segment
  }

  const a = points[points.length - 2]
  const b = points[points.length - 1]
  return {
    ...b,
    heading: Math.atan2(b.x - a.x, b.z - a.z),
    t: 1,
    segmentIndex: points.length - 2,
  }
}

export { routeDistance }
