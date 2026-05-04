import { getTerrainHeight } from './noise'

function makePRNG(seed = 77771) {
  let s = seed
  return () => { s = (s * 1664525 + 1013904223) & 0xffffffff; return (s >>> 0) / 4294967295 }
}

const rng = makePRNG(42)

// City grid constants — 50m blocks, 10m roads = 60m cells
const CELL  = 60
const BLOCK = 50
const ROAD  = 10
const WORLD = 1800   // total city extent
const HALF  = WORLD / 2

function zone(dist) {
  if (dist < 160) return 'downtown'
  if (dist < 380) return 'midtown'
  if (dist < 620) return 'residential'
  return 'suburban'
}

function buildingsForBlock(cx, cz, z) {
  const out = []
  const margin = 5
  const avail = BLOCK - margin * 2  // 40m usable

  const cfgs = {
    downtown:    { count: [1, 3],  wRange: [14, 28], dRange: [14, 28], hRange: [80, 320],  type: 'skyscraper' },
    midtown:     { count: [2, 5],  wRange: [10, 22], dRange: [10, 22], hRange: [20,  90],  type: 'office'     },
    residential: { count: [3, 7],  wRange: [ 8, 16], dRange: [ 8, 16], hRange: [ 6,  28],  type: 'apartment'  },
    suburban:    { count: [4, 8],  wRange: [ 6, 12], dRange: [ 6, 12], hRange: [ 4,  14],  type: 'house'      },
  }

  const cfg = cfgs[z]
  const count = cfg.count[0] + Math.floor(rng() * (cfg.count[1] - cfg.count[0] + 1))

  for (let i = 0; i < count; i++) {
    const w = cfg.wRange[0] + rng() * (cfg.wRange[1] - cfg.wRange[0])
    const d = cfg.dRange[0] + rng() * (cfg.dRange[1] - cfg.dRange[0])
    const h = cfg.hRange[0] + rng() * (cfg.hRange[1] - cfg.hRange[0])

    const maxOffX = Math.max(0, (avail - w) / 2)
    const maxOffZ = Math.max(0, (avail - d) / 2)
    const x  = cx + (rng() * 2 - 1) * maxOffX
    const bz = cz + (rng() * 2 - 1) * maxOffZ

    const terrainH = getTerrainHeight(x, bz)
    const rot = rng() > 0.75 ? (rng() - 0.5) * 0.35 : 0

    out.push({
      x, z: bz,
      w: Math.max(5, w),
      h: Math.max(4, h),
      d: Math.max(5, d),
      terrainH,
      type: cfg.type,
      rot,
      colorIndex: Math.floor(rng() * 5),
      id: `b_${cx.toFixed(0)}_${cz.toFixed(0)}_${i}`,
    })
  }
  return out
}

function generateRoads() {
  const roads = []
  const numCells = Math.floor(WORLD / CELL)

  for (let zi = 0; zi <= numCells; zi++) {
    const z = -HALF + zi * CELL
    const main = zi % 2 === 0
    roads.push({ type: 'ew', z, x1: -HALF, x2: HALF, width: main ? ROAD : ROAD * 0.7, isMain: main })
  }
  for (let xi = 0; xi <= numCells; xi++) {
    const x = -HALF + xi * CELL
    const main = xi % 2 === 0
    roads.push({ type: 'ns', x, z1: -HALF, z2: HALF, width: main ? ROAD : ROAD * 0.7, isMain: main })
  }
  return roads
}

function generateStreetLights(roads) {
  const lights = []
  roads.filter(r => r.isMain).forEach(road => {
    const spacing = 35
    if (road.type === 'ew') {
      for (let x = road.x1 + spacing / 2; x < road.x2; x += spacing) {
        const h = getTerrainHeight(x, road.z)
        lights.push({ x, z: road.z + road.width / 2 + 1.2, y: h + 7.5 })
        lights.push({ x, z: road.z - road.width / 2 - 1.2, y: h + 7.5 })
      }
    } else {
      for (let z = road.z1 + spacing / 2; z < road.z2; z += spacing) {
        const h = getTerrainHeight(road.x, z)
        lights.push({ x: road.x + road.width / 2 + 1.2, z, y: h + 7.5 })
        lights.push({ x: road.x - road.width / 2 - 1.2, z, y: h + 7.5 })
      }
    }
  })
  return lights
}

function generateTrees() {
  const trees = []
  for (let i = 0; i < 3000; i++) {
    const x = (rng() * 2 - 1) * HALF
    const z = (rng() * 2 - 1) * HALF
    const dist = Math.sqrt(x * x + z * z)
    if (dist < 200 && rng() > 0.08) continue
    if (dist < 400 && rng() > 0.28) continue
    const h = getTerrainHeight(x, z)
    if (h < 2) continue
    trees.push({ x, z, y: h, scale: 0.6 + rng() * 1.5 })
  }
  return trees
}

const NPC_ROLES = {
  downtown:    ['banker', 'lawyer', 'executive', 'barista', 'security'],
  midtown:     ['teacher', 'doctor', 'engineer', 'shopkeeper', 'chef'],
  residential: ['student', 'parent', 'artist', 'nurse', 'jogger'],
  suburban:    ['retiree', 'gardener', 'deliverer', 'kid', 'dog walker'],
}

const PERSONALITIES = [
  'friendly and chatty', 'grumpy but helpful', 'nervous and distracted',
  'calm and thoughtful', 'enthusiastic and curious', 'reserved and polite',
  'sarcastic but kind', 'optimistic and energetic',
]

function buildCityData() {
  const buildings = []
  const numCells = Math.floor(WORLD / CELL)

  for (let xi = 0; xi < numCells; xi++) {
    for (let zi = 0; zi < numCells; zi++) {
      const cx = -HALF + xi * CELL + CELL / 2
      const cz = -HALF + zi * CELL + CELL / 2
      const dist = Math.sqrt(cx * cx + cz * cz)

      if (dist > HALF * 0.94) continue
      // Parks: skip ~20% of non-downtown blocks randomly
      if (dist > 200 && rng() > 0.82) continue

      const z = zone(dist)
      buildings.push(...buildingsForBlock(cx, cz, z))
    }
  }

  const roads  = generateRoads()
  const lights = generateStreetLights(roads)
  const trees  = generateTrees()

  // NPCs — one per ~4 buildings
  const npcs = buildings
    .filter((_, i) => i % 4 === 0)
    .map((b, idx) => {
      const dist = Math.sqrt(b.x * b.x + b.z * b.z)
      const z = zone(dist)
      const roles = NPC_ROLES[z]
      return {
        id: `npc_${idx}`,
        x: b.x + (rng() - 0.5) * 16,
        z: b.z + (rng() - 0.5) * 16,
        y: b.terrainH,
        role: roles[Math.floor(rng() * roles.length)],
        zone: z,
        personality: PERSONALITIES[Math.floor(rng() * PERSONALITIES.length)],
      }
    })

  return { buildings, roads, lights, trees, npcs }
}

export const CITY_DATA = buildCityData()
