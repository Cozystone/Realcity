import { CITY_HALF } from './cityEngine'

function pushOutOfBox(px, pz, cx, cz, hw, hd) {
  const dx = px - cx
  const dz = pz - cz
  const pushX = hw - Math.abs(dx)
  const pushZ = hd - Math.abs(dz)
  if (pushX < pushZ) return [cx + Math.sign(dx || 1) * hw, pz]
  return [px, cz + Math.sign(dz || 1) * hd]
}

export function resolveLandmarkCollision(city, previousX, previousZ, nextX, nextZ, radius = 0.72) {
  let px = nextX
  let pz = nextZ

  for (const place of city.landmarks || []) {
    const interior = place.interior
    if (!interior?.solidWalls) continue

    const hw = interior.width / 2 + radius
    const hd = interior.depth / 2 + radius
    const prev = { x: previousX - place.x, z: previousZ - place.z }
    const next = { x: px - place.x, z: pz - place.z }
    const prevInside = Math.abs(prev.x) < hw && Math.abs(prev.z) < hd
    const nextInside = Math.abs(next.x) < hw && Math.abs(next.z) < hd
    if (!prevInside && !nextInside) continue

    const doorHalf = interior.doorWidth / 2
    const atFrontDoor = Math.abs(next.x) < doorHalf && next.z <= -interior.depth / 2 + 2.4

    if (!prevInside && nextInside && !atFrontDoor) {
      ;[px, pz] = pushOutOfBox(px, pz, place.x, place.z, hw, hd)
      continue
    }

    if (prevInside && !nextInside) {
      const exitsThroughDoor = Math.abs(prev.x) < doorHalf && next.z < -interior.depth / 2 + 2.4
      if (!exitsThroughDoor) {
        px = Math.max(place.x - hw + radius, Math.min(place.x + hw - radius, px))
        pz = Math.max(place.z - hd + radius, Math.min(place.z + hd - radius, pz))
      }
    }
  }

  return [px, pz]
}

export function currentInterior(city, x, z) {
  for (const place of city.landmarks || []) {
    const interior = place.interior
    if (!interior) continue
    const localX = x - place.x
    const localZ = z - place.z
    if (Math.abs(localX) < interior.width / 2 && Math.abs(localZ) < interior.depth / 2) {
      return {
        id: place.id,
        name: place.name,
        kind: place.kind,
        verticalCore: interior.verticalCore,
      }
    }
  }
  return null
}

export function resolveBuildingCollision(city, previousX, previousZ, x, z, radius = 0.72) {
  let px = x
  let pz = z
  const colliders = city.getNearbyBuildings?.(px, pz) || city.buildings || []

  for (const building of colliders) {
    if (building.h < 3) continue
    const hw = building.w / 2 + radius
    const hd = building.d / 2 + radius
    const dx = px - building.x
    const dz = pz - building.z
    if (Math.abs(dx) < hw && Math.abs(dz) < hd) {
      ;[px, pz] = pushOutOfBox(px, pz, building.x, building.z, hw, hd)
    }
  }

  ;[px, pz] = resolveLandmarkCollision(city, previousX, previousZ, px, pz, radius)

  px = Math.max(-CITY_HALF + 15, Math.min(CITY_HALF - 15, px))
  pz = Math.max(-CITY_HALF + 15, Math.min(CITY_HALF - 15, pz))
  return [px, pz]
}

export function countSolidWallOverlaps(city, samples = [], radius = 0.72) {
  let overlaps = 0
  for (const sample of samples) {
    const buildings = city.getNearbyBuildings?.(sample.x, sample.z) || city.buildings || []
    const buildingHit = buildings.some(building => {
      if (building.h < 3) return false
      return Math.abs(sample.x - building.x) < building.w / 2 + radius &&
        Math.abs(sample.z - building.z) < building.d / 2 + radius
    })
    if (buildingHit) {
      overlaps += 1
      continue
    }

    const landmarkHit = (city.landmarks || []).some(place => {
      const interior = place.interior
      if (!interior?.solidWalls) return false
      return Math.abs(sample.x - place.x) < interior.width / 2 + radius &&
        Math.abs(sample.z - place.z) < interior.depth / 2 + radius
    })
    if (landmarkHit) overlaps += 1
  }
  return overlaps
}
