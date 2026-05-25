const TAU = Math.PI * 2

export const CITY_WORLD_SIZE = 2400
export const CITY_HALF = CITY_WORLD_SIZE / 2
export const CITY_GRID_HALF = 920
export const ROAD_SPACING = 76
export const ROAD_WIDTH = 11
export const TILE_SIZE = 240
export const DAY_MINUTES = 24 * 60
export const CITY_BASE_Y = 0

const ROLE_LIBRARY = [
  { role: 'banker', job: 'Banker', workplace: 'aster_exchange', color: '#2c5f8a', pace: 1.05 },
  { role: 'doctor', job: 'ER Doctor', workplace: 'hanbit_hospital', color: '#e8f4ff', pace: 1.18 },
  { role: 'teacher', job: 'Teacher', workplace: 'mirae_school', color: '#6aa38f', pace: 0.98 },
  { role: 'courier', job: 'Courier', workplace: 'south_depot', color: '#f6b73c', pace: 1.35 },
  { role: 'barista', job: 'Barista', workplace: 'river_cafe', color: '#9b6648', pace: 1.08 },
  { role: 'engineer', job: 'Robotics Engineer', workplace: 'maker_yard', color: '#566d7e', pace: 1.0 },
  { role: 'artist', job: 'Artist', workplace: 'neon_square', color: '#d35f8d', pace: 0.9 },
  { role: 'security', job: 'Station Security', workplace: 'central_station', color: '#28395f', pace: 0.95 },
  { role: 'student', job: 'Student', workplace: 'mirae_school', color: '#536dfe', pace: 1.16 },
  { role: 'shopkeeper', job: 'Shopkeeper', workplace: 'market_lane', color: '#c77d3f', pace: 0.96 },
  { role: 'gardener', job: 'Park Gardener', workplace: 'hill_park', color: '#4f8a4f', pace: 0.86 },
  { role: 'retiree', job: 'Retiree', workplace: 'hill_park', color: '#b7a779', pace: 0.7 },
]

const GIVEN_NAMES = ['Minji', 'Hana', 'Joon', 'Sora', 'Doyun', 'Ara', 'Hyun', 'Yujin', 'Noel', 'Mina', 'Taeyang', 'Rin']
const FAMILY_NAMES = ['Kim', 'Park', 'Lee', 'Choi', 'Jung', 'Seo', 'Han', 'Kang', 'Lim']
const PERSONALITIES = ['warm', 'reserved', 'curious', 'direct', 'funny', 'tired', 'ambitious', 'careful', 'restless']

function mulberry32(seed) {
  let value = seed >>> 0
  return () => {
    value += 0x6d2b79f5
    let t = value
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

function pick(rng, list) {
  return list[Math.floor(rng() * list.length)]
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value))
}

function smoothstep(edge0, edge1, x) {
  const t = clamp((x - edge0) / (edge1 - edge0), 0, 1)
  return t * t * (3 - 2 * t)
}

function hashNoise(x, z) {
  const n = Math.sin(x * 127.1 + z * 311.7) * 43758.5453123
  return (n - Math.floor(n)) * 2 - 1
}

function fbm(x, z) {
  let value = 0
  let amp = 0.5
  let freq = 0.004
  for (let i = 0; i < 5; i += 1) {
    value += hashNoise(x * freq, z * freq) * amp
    freq *= 2.07
    amp *= 0.52
  }
  return value
}

export function terrainHeight(x, z) {
  const distance = Math.hypot(x, z)
  const cityBlend = smoothstep(900, 1160, distance)
  const cityFloor = CITY_BASE_Y + fbm(x * 0.1, z * 0.1) * 0.035
  const hills = 4 + Math.max(0, fbm(x + 450, z - 250) + 0.5) * 92
  const coastalDip = smoothstep(74, 0, Math.abs(z + 980 + Math.sin(x * 0.003) * 40)) * 6
  return cityFloor * (1 - cityBlend) + hills * cityBlend - coastalDip
}

export function terrainTone(x, z) {
  const h = terrainHeight(x, z)
  const distance = Math.hypot(x, z)
  const coastal = Math.abs(z + 980 + Math.sin(x * 0.003) * 40)
  if (coastal < 70) return [0.08, 0.18, 0.25]
  if (distance < 940) return [0.24, 0.245, 0.24]
  if (h > 70) return [0.29, 0.31, 0.28]
  return [0.19, 0.36, 0.22]
}

function districtAt(x, z) {
  const distance = Math.hypot(x, z)
  if (distance < 190) return { id: 'core', name: 'Central Core', type: 'skyscraper' }
  if (x < -120 && z < 180 && distance < 650) return { id: 'market', name: 'Market Ward', type: 'mixed' }
  if (x > 170 && z < 230 && distance < 720) return { id: 'medical', name: 'Medical Campus', type: 'office' }
  if (z > 220 && distance < 760) return { id: 'creative', name: 'Neon Arts District', type: 'apartment' }
  if (distance < 760) return { id: 'midtown', name: 'Midtown', type: 'office' }
  return { id: 'outer', name: 'Outer Hills', type: 'house' }
}

function roadGrid() {
  const roads = []
  let index = 0
  for (let p = -CITY_GRID_HALF; p <= CITY_GRID_HALF + 1; p += ROAD_SPACING) {
    const isMain = Math.round((p + CITY_GRID_HALF) / ROAD_SPACING) % 4 === 0
    roads.push({ id: `ew_${index}`, axis: 'x', z: p, from: -CITY_GRID_HALF, to: CITY_GRID_HALF, width: isMain ? ROAD_WIDTH * 1.55 : ROAD_WIDTH, main: isMain })
    roads.push({ id: `ns_${index}`, axis: 'z', x: p, from: -CITY_GRID_HALF, to: CITY_GRID_HALF, width: isMain ? ROAD_WIDTH * 1.55 : ROAD_WIDTH, main: isMain })
    index += 1
  }
  return roads
}

function landmarkSet() {
  const raw = [
    { id: 'central_station', name: 'Central Station', kind: 'transit', x: -148, z: 52, scale: 1.0, tripoPrompt: 'futuristic Korean central train station concourse' },
    { id: 'aster_exchange', name: 'Aster Exchange', kind: 'finance', x: 142, z: -132, scale: 1.12, tripoPrompt: 'glass financial exchange tower lobby' },
    { id: 'river_cafe', name: 'River Cafe', kind: 'cafe', x: -236, z: -236, scale: 0.72, tripoPrompt: 'warm riverside cafe terrace' },
    { id: 'hanbit_hospital', name: 'Hanbit Hospital', kind: 'hospital', x: 300, z: -198, scale: 1.0, tripoPrompt: 'modern hospital complex with emergency entrance' },
    { id: 'maker_yard', name: 'Maker Yard', kind: 'workshop', x: -332, z: 172, scale: 0.94, tripoPrompt: 'robotics workshop yard with modular containers' },
    { id: 'market_lane', name: 'Market Lane', kind: 'retail', x: -284, z: -314, scale: 0.9, tripoPrompt: 'dense open street market with covered stalls' },
    { id: 'mirae_school', name: 'Mirae School', kind: 'school', x: 366, z: 312, scale: 1.0, tripoPrompt: 'compact urban school campus' },
    { id: 'neon_square', name: 'Neon Square', kind: 'leisure', x: 72, z: 470, scale: 1.08, tripoPrompt: 'night entertainment plaza with digital signs' },
    { id: 'hill_park', name: 'Hill Park', kind: 'park', x: -612, z: 512, scale: 1.35, tripoPrompt: 'urban hill park pavilion and paths' },
    { id: 'south_depot', name: 'South Depot', kind: 'logistics', x: 588, z: -542, scale: 1.1, tripoPrompt: 'logistics depot with loading bays' },
  ]
  return raw.map(place => ({ ...place, y: terrainHeight(place.x, place.z), radius: 26 * place.scale }))
}

function createBuildings(rng, landmarks) {
  const buildings = []
  const landmarkMask = (x, z) => landmarks.some(place => Math.hypot(x - place.x, z - place.z) < place.radius + 34)
  let id = 0
  const slotSets = {
    1: [{ x: 0, z: 0 }],
    2: [{ x: -0.22, z: -0.16 }, { x: 0.22, z: 0.16 }],
    3: [{ x: -0.24, z: -0.22 }, { x: 0.24, z: -0.22 }, { x: 0, z: 0.24 }],
    4: [{ x: -0.24, z: -0.24 }, { x: 0.24, z: -0.24 }, { x: -0.24, z: 0.24 }, { x: 0.24, z: 0.24 }],
  }

  for (let x = -CITY_GRID_HALF + ROAD_SPACING / 2; x < CITY_GRID_HALF; x += ROAD_SPACING) {
    for (let z = -CITY_GRID_HALF + ROAD_SPACING / 2; z < CITY_GRID_HALF; z += ROAD_SPACING) {
      const distance = Math.hypot(x, z)
      if (distance > 900 || distance < 170 || landmarkMask(x, z)) continue

      const district = districtAt(x, z)
      const isParkPocket = distance > 360 && rng() > 0.83
      if (isParkPocket) continue

      const count = district.id === 'core' ? 1 + Math.floor(rng() * 2) : district.id === 'outer' ? 2 + Math.floor(rng() * 3) : 1 + Math.floor(rng() * 3)
      const footprint = ROAD_SPACING - ROAD_WIDTH - 18
      const slots = slotSets[Math.min(4, count)]

      for (let i = 0; i < count; i += 1) {
        const type = district.id === 'core' ? 'skyscraper' : district.type === 'house' ? 'house' : district.type === 'apartment' ? 'apartment' : rng() > 0.55 ? 'office' : 'apartment'
        const slot = slots[i] || slots[0]
        const slotSize = count === 1 ? footprint * 0.78 : footprint * 0.36
        const w = type === 'house' ? 7.5 + rng() * 6.5 : 12 + rng() * Math.max(8, slotSize)
        const d = type === 'house' ? 7.5 + rng() * 6.5 : 12 + rng() * Math.max(8, slotSize)
        const jitter = count === 1 ? footprint * 0.07 : footprint * 0.035
        const bx = x + slot.x * footprint + (rng() - 0.5) * jitter
        const bz = z + slot.z * footprint + (rng() - 0.5) * jitter
        const base = terrainHeight(bx, bz)
        const height = type === 'skyscraper'
          ? 44 + rng() * 92
          : type === 'office'
            ? 16 + rng() * 42
            : type === 'apartment'
              ? 10 + rng() * 24
              : 4.5 + rng() * 6.5

        buildings.push({
          id: `b${id++}`,
          x: bx,
          z: bz,
          y: base,
          w,
          d,
          h: height,
          type,
          district: district.name,
          rot: rng() > 0.78 ? (rng() - 0.5) * 0.35 : 0,
          tint: rng(),
        })
      }
    }
  }

  return buildings
}

function createTrees(rng, landmarks) {
  const trees = []
  for (let i = 0; i < 1300; i += 1) {
    const angle = rng() * TAU
    const radius = 620 + rng() * 500
    const x = Math.cos(angle) * radius + (rng() - 0.5) * 120
    const z = Math.sin(angle) * radius + (rng() - 0.5) * 120
    const nearPlace = landmarks.some(place => place.kind !== 'park' && Math.hypot(x - place.x, z - place.z) < place.radius + 16)
    if (nearPlace) continue
    trees.push({ id: `tree_${i}`, x, z, y: terrainHeight(x, z), scale: 0.65 + rng() * 1.55, tint: rng() })
  }
  return trees
}

function createTraffic(rng, roads) {
  const candidates = roads.filter(road => road.main)
  return Array.from({ length: 180 }, (_, i) => {
    const road = pick(rng, candidates)
    const direction = rng() > 0.5 ? 1 : -1
    const lane = (rng() > 0.5 ? 1 : -1) * (road.width * 0.24)
    return {
      id: `car_${i}`,
      roadId: road.id,
      road,
      direction,
      lane,
      t: rng(),
      speed: 7 + rng() * 10,
      phase: rng() * TAU,
      color: pick(rng, ['#e8504f', '#f3f4f6', '#1f2937', '#3b82f6', '#16a34a', '#f59e0b', '#7c3aed', '#94a3b8']),
    }
  })
}

function createSchedule(role) {
  if (role === 'doctor' || role === 'security' || role === 'courier') {
    return [
      { start: 0, end: 6.2, target: 'home', activity: 'resting' },
      { start: 6.2, end: 7.1, target: 'third', activity: 'commuting' },
      { start: 7.1, end: 18.5, target: 'work', activity: 'on shift' },
      { start: 18.5, end: 21.0, target: 'third', activity: 'errands' },
      { start: 21.0, end: 24, target: 'home', activity: 'home life' },
    ]
  }
  if (role === 'student' || role === 'teacher') {
    return [
      { start: 0, end: 7.0, target: 'home', activity: 'resting' },
      { start: 7.0, end: 8.2, target: 'third', activity: 'commuting' },
      { start: 8.2, end: 15.7, target: 'work', activity: 'class' },
      { start: 15.7, end: 19.4, target: 'third', activity: 'after school' },
      { start: 19.4, end: 24, target: 'home', activity: 'home life' },
    ]
  }
  if (role === 'barista' || role === 'shopkeeper') {
    return [
      { start: 0, end: 5.1, target: 'home', activity: 'resting' },
      { start: 5.1, end: 15.2, target: 'work', activity: 'serving customers' },
      { start: 15.2, end: 18.0, target: 'third', activity: 'break' },
      { start: 18.0, end: 22.2, target: 'work', activity: 'evening rush' },
      { start: 22.2, end: 24, target: 'home', activity: 'closing down' },
    ]
  }
  return [
    { start: 0, end: 6.7, target: 'home', activity: 'resting' },
    { start: 6.7, end: 8.4, target: 'third', activity: 'commuting' },
    { start: 8.4, end: 17.7, target: 'work', activity: 'working' },
    { start: 17.7, end: 21.6, target: 'third', activity: 'social time' },
    { start: 21.6, end: 24, target: 'home', activity: 'home life' },
  ]
}

function createNPCs(rng, buildings, landmarks) {
  const socialPlaces = landmarks.filter(place => ['cafe', 'park', 'retail', 'leisure', 'transit'].includes(place.kind))
  const byId = new Map(landmarks.map(place => [place.id, place]))
  const homes = buildings.filter(building => building.type === 'apartment' || building.type === 'house')

  return Array.from({ length: 220 }, (_, i) => {
    const roleInfo = pick(rng, ROLE_LIBRARY)
    const home = pick(rng, homes)
    const work = byId.get(roleInfo.workplace) || landmarks[0]
    const third = pick(rng, socialPlaces)
    const gender = pick(rng, ['woman', 'man', 'nonbinary'])
    const name = `${pick(rng, GIVEN_NAMES)} ${pick(rng, FAMILY_NAMES)}`
    const hx = home.x + (rng() - 0.5) * home.w
    const hz = home.z + (rng() - 0.5) * home.d

    return {
      id: `npc_${i}`,
      name,
      gender,
      age: 18 + Math.floor(rng() * 57),
      role: roleInfo.role,
      job: roleInfo.job,
      color: roleInfo.color,
      pace: roleInfo.pace,
      personality: pick(rng, PERSONALITIES),
      home: { x: hx, z: hz, y: terrainHeight(hx, hz), name: `${name.split(' ')[1]} residence` },
      workId: work.id,
      thirdId: third.id,
      schedule: createSchedule(roleInfo.role),
      offset: { x: (rng() - 0.5) * 30, z: (rng() - 0.5) * 30 },
    }
  })
}

function createTiles(buildings, landmarks) {
  const tiles = new Map()
  const placeInTile = (item) => `${Math.floor((item.x + CITY_HALF) / TILE_SIZE)}:${Math.floor((item.z + CITY_HALF) / TILE_SIZE)}`

  for (const building of buildings) {
    const key = placeInTile(building)
    if (!tiles.has(key)) tiles.set(key, { id: `tile_${key.replace(':', '_')}`, buildings: [], landmarks: [], bounds: null })
    tiles.get(key).buildings.push(building.id)
  }

  for (const landmark of landmarks) {
    const key = placeInTile(landmark)
    if (!tiles.has(key)) tiles.set(key, { id: `tile_${key.replace(':', '_')}`, buildings: [], landmarks: [], bounds: null })
    tiles.get(key).landmarks.push(landmark.id)
  }

  return [...tiles.values()].map(tile => ({
    ...tile,
    format: 'procedural-3d-tile',
    geometricError: tile.buildings.length > 30 ? 64 : 32,
  }))
}

function worldToLngLat(x, z) {
  const extent = 0.095
  return [(x / CITY_WORLD_SIZE) * extent, (-z / CITY_WORLD_SIZE) * extent]
}

function createGeoJSON(roads, landmarks) {
  return {
    type: 'FeatureCollection',
    features: [
      ...roads.filter(road => road.main).map(road => ({
        type: 'Feature',
        properties: { layer: 'road', id: road.id },
        geometry: {
          type: 'LineString',
          coordinates: road.axis === 'x'
            ? [worldToLngLat(road.from, road.z), worldToLngLat(road.to, road.z)]
            : [worldToLngLat(road.x, road.from), worldToLngLat(road.x, road.to)],
        },
      })),
      ...landmarks.map(place => ({
        type: 'Feature',
        properties: { layer: 'place', id: place.id, kind: place.kind, name: place.name },
        geometry: { type: 'Point', coordinates: worldToLngLat(place.x, place.z) },
      })),
    ],
  }
}

function buildCollisionIndex(buildings) {
  const cell = 120
  const map = new Map()
  for (const building of buildings) {
    const gx = Math.floor((building.x + CITY_HALF) / cell)
    const gz = Math.floor((building.z + CITY_HALF) / cell)
    const key = `${gx}:${gz}`
    if (!map.has(key)) map.set(key, [])
    map.get(key).push(building)
  }
  return (x, z) => {
    const gx = Math.floor((x + CITY_HALF) / cell)
    const gz = Math.floor((z + CITY_HALF) / cell)
    const nearby = []
    for (let dx = -1; dx <= 1; dx += 1) {
      for (let dz = -1; dz <= 1; dz += 1) {
        const group = map.get(`${gx + dx}:${gz + dz}`)
        if (group) nearby.push(...group)
      }
    }
    return nearby
  }
}

export function createRealCity(seed = 20260525) {
  const rng = mulberry32(seed)
  const roads = roadGrid()
  const landmarks = landmarkSet()
  const buildings = createBuildings(rng, landmarks)
  const trees = createTrees(rng, landmarks)
  const cars = createTraffic(rng, roads)
  const npcs = createNPCs(rng, buildings, landmarks)
  const tiles = createTiles(buildings, landmarks)
  const geojson = createGeoJSON(roads, landmarks)
  const getNearbyBuildings = buildCollisionIndex(buildings)

  return {
    seed,
    roads,
    buildings,
    trees,
    landmarks,
    cars,
    npcs,
    tiles,
    geojson,
    worldToLngLat,
    districtAt,
    getNearbyBuildings,
    integrations: {
      mapLibre: 'live procedural GeoJSON layer',
      cesium3DTiles: `${tiles.length} procedural tiles with 3D Tiles-style metadata`,
      tripo3D: `${landmarks.length} landmark prompts ready for asset replacement`,
    },
  }
}
