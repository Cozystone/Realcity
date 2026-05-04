import { getTerrainHeight } from './noise'

// Deterministic seeded PRNG
function makePRNG(seed = 77771) {
  let s = seed
  return () => {
    s = (s * 1664525 + 1013904223) & 0xffffffff
    return (s >>> 0) / 4294967295
  }
}

const rng = makePRNG(42)

const CELL = 92        // block 80m + road 12m
const BLOCK = 80
const ROAD = 12
const WORLD = 2048
const HALF = WORLD / 2

function zone(dist) {
  if (dist < 180) return 'downtown'
  if (dist < 420) return 'midtown'
  if (dist < 700) return 'residential'
  return 'suburban'
}

function buildingsForBlock(cx, cz, z) {
  const out = []
  const margin = 4
  const avail = BLOCK - margin * 2

  const configs = {
    downtown: { count: () => Math.floor(rng() * 2) + 1, hw: [18, 36], hh: [0, 36], height: [80, 260], type: 'skyscraper' },
    midtown:  { count: () => Math.floor(rng() * 3) + 2, hw: [12, 24], hh: [0, 24], height: [25, 90],  type: 'office' },
    residential: { count: () => Math.floor(rng() * 5) + 3, hw: [8, 18], hh: [0, 18], height: [8, 32],  type: 'apartment' },
    suburban: { count: () => Math.floor(rng() * 6) + 4, hw: [6, 12], hh: [0, 12], height: [4, 14],  type: 'house' },
  }

  const cfg = configs[z]
  const count = cfg.count()

  for (let i = 0; i < count; i++) {
    const w = cfg.hw[0] + rng() * (cfg.hw[1] - cfg.hw[0])
    const d = cfg.hh[0] + rng() * (cfg.hh[1] - cfg.hh[0]) || w
    const h = cfg.height[0] + rng() * (cfg.height[1] - cfg.height[0])

    const maxOffX = (avail - w) / 2
    const maxOffZ = (avail - d) / 2

    const x = cx + (rng() * 2 - 1) * maxOffX
    const bz = cz + (rng() * 2 - 1) * maxOffZ
    const terrainH = getTerrainHeight(x, bz)
    const rot = (rng() > 0.7) ? (rng() * 0.4 - 0.2) : 0

    out.push({
      x, z: bz,
      w: Math.max(4, w), h: Math.max(4, h), d: Math.max(4, d || w),
      terrainH,
      type: cfg.type,
      rot,
      id: `b_${Math.floor(cx)}_${Math.floor(bz)}_${i}`,
    })
  }
  return out
}

function generateRoads() {
  const roads = []
  const numCells = Math.floor(WORLD / CELL)

  // East-West roads
  for (let zi = 0; zi <= numCells; zi++) {
    const z = -HALF + zi * CELL
    roads.push({ type: 'ew', z, x1: -HALF, x2: HALF, width: ROAD, isMain: zi % 2 === 0 })
  }
  // North-South roads
  for (let xi = 0; xi <= numCells; xi++) {
    const x = -HALF + xi * CELL
    roads.push({ type: 'ns', x, z1: -HALF, z2: HALF, width: ROAD, isMain: xi % 2 === 0 })
  }
  return roads
}

function generateStreetLights(roads) {
  const lights = []
  const spacing = 40

  roads.forEach(road => {
    if (road.type === 'ew') {
      for (let x = road.x1; x < road.x2; x += spacing) {
        const h = getTerrainHeight(x, road.z)
        lights.push({ x, z: road.z + ROAD / 2 + 1.5, y: h + 8, rot: 0 })
        lights.push({ x, z: road.z - ROAD / 2 - 1.5, y: h + 8, rot: Math.PI })
      }
    } else {
      for (let z = road.z1; z < road.z2; z += spacing) {
        const h = getTerrainHeight(road.x, z)
        lights.push({ x: road.x + ROAD / 2 + 1.5, z, y: h + 8, rot: Math.PI / 2 })
        lights.push({ x: road.x - ROAD / 2 - 1.5, z, y: h + 8, rot: -Math.PI / 2 })
      }
    }
  })
  return lights
}

function generateTrees() {
  const trees = []
  const count = 2400

  for (let i = 0; i < count; i++) {
    const x = (rng() * 2 - 1) * HALF
    const z = (rng() * 2 - 1) * HALF
    const dist = Math.sqrt(x * x + z * z)
    // More trees in parks and outskirts
    if (dist < 200 && rng() > 0.15) continue  // sparse in downtown
    if (dist < 450 && rng() > 0.35) continue  // moderate in midtown
    const h = getTerrainHeight(x, z)
    if (h < 0.5) continue  // no trees in water
    trees.push({
      x, z,
      y: h,
      scale: 0.7 + rng() * 1.4,
      type: rng() > 0.3 ? 'deciduous' : 'conifer',
    })
  }
  return trees
}

// NPC roles assigned per zone
const NPC_ROLES = {
  downtown: ['banker', 'lawyer', 'executive', 'barista', 'security'],
  midtown: ['teacher', 'doctor', 'engineer', 'shopkeeper', 'chef'],
  residential: ['student', 'parent', 'artist', 'nurse', 'jogger'],
  suburban: ['retiree', 'gardener', 'deliverer', 'kid', 'dog walker'],
}

function generateNPCs(buildings) {
  const npcs = []
  buildings.forEach((b, idx) => {
    if (idx % 4 !== 0) return  // ~25% of buildings spawn an NPC
    const dist = Math.sqrt(b.x * b.x + b.z * b.z)
    const z = zone(dist)
    const roles = NPC_ROLES[z]
    const role = roles[Math.floor(rng() * roles.length)]
    npcs.push({
      id: `npc_${idx}`,
      x: b.x + (rng() - 0.5) * 20,
      z: b.z + (rng() - 0.5) * 20,
      y: b.terrainH,
      role,
      zone: z,
      homeBuilding: b.id,
      personality: pickPersonality(),
    })
  })
  return npcs
}

function pickPersonality() {
  const personalities = [
    'friendly and chatty',
    'grumpy but helpful',
    'nervous and distracted',
    'calm and thoughtful',
    'enthusiastic and curious',
    'reserved and polite',
    'sarcastic but kind',
    'optimistic and energetic',
  ]
  return personalities[Math.floor(rng() * personalities.length)]
}

// Generate everything once at module load (deterministic)
function buildCityData() {
  const buildings = []
  const numCells = Math.floor(WORLD / CELL)

  for (let xi = 0; xi < numCells; xi++) {
    for (let zi = 0; zi < numCells; zi++) {
      const cx = (-HALF + xi * CELL) + CELL / 2
      const cz = (-HALF + zi * CELL) + CELL / 2
      const dist = Math.sqrt(cx * cx + cz * cz)

      if (dist > HALF * 0.92) continue

      // Skip some cells for parks/plazas
      if (dist > 300 && rng() > 0.78) continue

      const z = zone(dist)
      const blockBuildings = buildingsForBlock(cx, cz, z)
      buildings.push(...blockBuildings)
    }
  }

  const roads = generateRoads()
  const lights = generateStreetLights(roads.filter(r => r.isMain))
  const trees = generateTrees()
  const npcs = generateNPCs(buildings)

  return { buildings, roads, lights, trees, npcs }
}

export const CITY_DATA = buildCityData()
