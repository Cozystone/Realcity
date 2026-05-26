import { DISTRICT_BLUEPRINT, LANDMARK_BLUEPRINTS, ROAD_TIERS } from './cityBlueprint'

const TAU = Math.PI * 2

export const CITY_WORLD_SIZE = 2400
export const CITY_HALF = CITY_WORLD_SIZE / 2
export const CITY_GRID_HALF = 920
export const ROAD_SPACING = 76
export const ROAD_WIDTH = 11
export const TILE_SIZE = 240
export const DAY_MINUTES = 24 * 60
export const CITY_BASE_Y = 0
export const TRAFFIC_SIGNAL_CYCLE_SECONDS = 54
export const TRAFFIC_SIGNAL_YELLOW_SECONDS = 4.5

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
const EAST_WEST_STREETS = ['Harbor-ro', 'Depot-gil', 'Aster-daero', 'Market-ro', 'Station-daero', 'Mirae-ro', 'Hanbit-ro', 'Neon-gil', 'Hill-ro']
const NORTH_SOUTH_STREETS = ['Sunset-ro', 'River-ro', 'Civic-daero', 'Jungang-ro', 'Glass-ro', 'School-gil', 'Workshop-ro', 'Garden-ro', 'Coast-ro']

const FASHION_PALETTES = [
  { top: '#2f6f9f', jacket: '#e8f1f4', pants: '#17203a', shoes: '#0d1118', accessory: '#5a3f2f' },
  { top: '#6f3f8f', jacket: '#2b2633', pants: '#1f2937', shoes: '#111827', accessory: '#c59b53' },
  { top: '#3f7d55', jacket: '#d8e0d4', pants: '#2f3a2d', shoes: '#1b201b', accessory: '#704c33' },
  { top: '#ba6a3f', jacket: '#f0d4bd', pants: '#384252', shoes: '#1c1d21', accessory: '#7c3f2f' },
  { top: '#425e80', jacket: '#202833', pants: '#111827', shoes: '#05070a', accessory: '#46515c' },
  { top: '#b84f70', jacket: '#f3dce6', pants: '#3d2430', shoes: '#171217', accessory: '#8b5d35' },
]

const LANDMARK_INTERIORS = {
  transit: { width: 64, depth: 30, height: 7.2, doorWidth: 14, lobbyDepth: 25, verticalCore: 'escalator' },
  finance: { width: 30, depth: 30, height: 13.5, doorWidth: 9, lobbyDepth: 24, verticalCore: 'elevator' },
  cafe: { width: 28, depth: 22, height: 7.2, doorWidth: 6, lobbyDepth: 17, verticalCore: 'stairs' },
  hospital: { width: 42, depth: 30, height: 12.8, doorWidth: 12, lobbyDepth: 25, verticalCore: 'elevator' },
  workshop: { width: 30, depth: 24, height: 8.4, doorWidth: 8, lobbyDepth: 20, verticalCore: 'stairs' },
  retail: { width: 34, depth: 24, height: 8.2, doorWidth: 10, lobbyDepth: 20, verticalCore: 'escalator' },
  school: { width: 38, depth: 28, height: 8.6, doorWidth: 10, lobbyDepth: 22, verticalCore: 'stairs' },
  leisure: { width: 36, depth: 28, height: 9, doorWidth: 12, lobbyDepth: 23, verticalCore: 'escalator' },
  logistics: { width: 58, depth: 34, height: 10.8, doorWidth: 13, lobbyDepth: 28, verticalCore: 'stairs' },
}

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

function streetName(axis, index, isMain) {
  const names = axis === 'x' ? EAST_WEST_STREETS : NORTH_SOUTH_STREETS
  const base = names[index % names.length]
  if (isMain && !base.includes('daero')) return base.replace(/-ro|-gil/, '-daero')
  return base
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

export function trafficSignalForAxis(axis, timeMinutes = 0) {
  const second = (timeMinutes * 60) % TRAFFIC_SIGNAL_CYCLE_SECONDS
  const half = TRAFFIC_SIGNAL_CYCLE_SECONDS / 2
  const activeAxis = second < half ? 'x' : 'z'
  const phaseSecond = second < half ? second : second - half
  if (axis !== activeAxis) return 'red'
  return phaseSecond > half - TRAFFIC_SIGNAL_YELLOW_SECONDS ? 'yellow' : 'green'
}

function districtAt(x, z) {
  const context = { x, z, distance: Math.hypot(x, z) }
  const district = DISTRICT_BLUEPRINT.find(rule => rule.match(context)) || DISTRICT_BLUEPRINT[DISTRICT_BLUEPRINT.length - 1]
  return {
    id: district.id,
    name: district.name,
    type: district.type,
    activation: district.activation,
  }
}

function roadGrid() {
  const roads = []
  let index = 0
  for (let p = -CITY_GRID_HALF; p <= CITY_GRID_HALF + 1; p += ROAD_SPACING) {
    const isMain = Math.round((p + CITY_GRID_HALF) / ROAD_SPACING) % 4 === 0
    const tier = isMain ? ROAD_TIERS.primary : ROAD_TIERS.local
    roads.push({ id: `ew_${index}`, axis: 'x', z: p, from: -CITY_GRID_HALF, to: CITY_GRID_HALF, width: ROAD_WIDTH * tier.widthMultiplier, main: isMain, tier: tier.id, trafficWeight: tier.trafficWeight, name: streetName('x', index, isMain) })
    roads.push({ id: `ns_${index}`, axis: 'z', x: p, from: -CITY_GRID_HALF, to: CITY_GRID_HALF, width: ROAD_WIDTH * tier.widthMultiplier, main: isMain, tier: tier.id, trafficWeight: tier.trafficWeight, name: streetName('z', index, isMain) })
    index += 1
  }
  return roads
}

function roadDistanceToPoint(road, x, z) {
  if (road.axis === 'x') {
    const px = clamp(x, road.from, road.to)
    return Math.hypot(x - px, z - road.z)
  }
  const pz = clamp(z, road.from, road.to)
  return Math.hypot(x - road.x, z - pz)
}

function addressInfoForPoint(x, z, roads) {
  let best = roads[0]
  let bestDistance = Infinity
  for (const road of roads) {
    const distance = roadDistanceToPoint(road, x, z)
    if (distance < bestDistance) {
      bestDistance = distance
      best = road
    }
  }
  const along = best.axis === 'x' ? x : z
  const block = Math.max(1, Math.floor((along + CITY_GRID_HALF) / 18) + 1)
  const side = best.axis === 'x'
    ? z >= best.z ? 0 : 1
    : x >= best.x ? 0 : 1
  const number = block * 2 + side
  return {
    address: `${number} ${best.name}`,
    roadId: best.id,
    roadName: best.name,
    addressNumber: number,
  }
}

function pointInRoadReserve(x, z, roads, margin = 0) {
  return roads.some(road => {
    if (road.axis === 'x') {
      return x >= road.from - margin && x <= road.to + margin && Math.abs(z - road.z) <= road.width / 2 + margin
    }
    return z >= road.from - margin && z <= road.to + margin && Math.abs(x - road.x) <= road.width / 2 + margin
  })
}

function landmarkSet(roads) {
  return LANDMARK_BLUEPRINTS.map(place => ({
    ...place,
    y: terrainHeight(place.x, place.z),
    radius: 26 * place.scale,
    ...addressInfoForPoint(place.x, place.z, roads),
    interior: place.kind === 'park' ? null : {
      ...LANDMARK_INTERIORS[place.kind],
      entranceSide: 'front',
      solidWalls: true,
      entryRule: 'front-door-only',
    },
  }))
}

function createBuildings(rng, landmarks, roads) {
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
          ...addressInfoForPoint(bx, bz, roads),
          w,
          d,
          h: height,
          type,
          district: district.name,
          rot: rng() > 0.78 ? (rng() - 0.5) * 0.35 : 0,
          tint: rng(),
          form: createBuildingForm(type, rng, district),
        })
      }
    }
  }

  return buildings
}

function createBuildingForm(type, rng, district) {
  if (type === 'house') {
    const profile = pick(rng, ['cottage', 'duplex', 'rowhouse', 'villa', 'courtyard'])
    return {
      profile,
      roof: pick(rng, profile === 'rowhouse' ? ['flat', 'gable', 'shed'] : ['gable', 'hip', 'shed']),
      bodyRatio: 0.66 + rng() * 0.12,
      wing: profile === 'villa' || profile === 'courtyard' || rng() > 0.58,
      porch: rng() > 0.28,
      garage: rng() > 0.62,
      chimney: rng() > 0.36,
      facade: pick(rng, ['brick', 'stucco', 'timber', 'painted']),
    }
  }

  if (type === 'apartment') {
    return {
      profile: pick(rng, ['bar', 'terraced', 'l_block', 'balcony_stack']),
      roof: pick(rng, ['flat', 'terrace', 'utility']),
      podium: rng() > 0.52,
      wing: rng() > 0.42,
      balconies: true,
      bodyRatio: 0.82 + rng() * 0.1,
      facade: pick(rng, ['concrete', 'warm_panel', 'brick_base']),
    }
  }

  if (type === 'office') {
    return {
      profile: pick(rng, ['slab', 'podium_tower', 'atrium', 'offset_core']),
      roof: pick(rng, ['flat', 'green', 'mechanical']),
      podium: true,
      wing: rng() > 0.5,
      balconies: false,
      bodyRatio: 0.74 + rng() * 0.18,
      facade: pick(rng, ['stone_grid', 'glass_band', 'metal_panel']),
    }
  }

  return {
    profile: pick(rng, ['needle', 'setback', 'twin_core', 'crown']),
    roof: pick(rng, ['crown', 'antenna', 'mechanical']),
    podium: true,
    wing: rng() > 0.7,
    balconies: false,
    bodyRatio: 0.78 + rng() * 0.16,
    facade: pick(rng, ['blue_glass', 'silver_glass', 'dark_glass']),
    districtType: district.type,
  }
}

function createTrees(rng, landmarks, roads) {
  const trees = []
  for (let i = 0; i < 760; i += 1) {
    const angle = rng() * TAU
    const radius = 620 + rng() * 500
    const x = Math.cos(angle) * radius + (rng() - 0.5) * 120
    const z = Math.sin(angle) * radius + (rng() - 0.5) * 120
    const nearPlace = landmarks.some(place => place.kind !== 'park' && Math.hypot(x - place.x, z - place.z) < place.radius + 16)
    if (nearPlace || pointInRoadReserve(x, z, roads, 8)) continue
    trees.push({ id: `tree_${i}`, x, z, y: terrainHeight(x, z), scale: 0.65 + rng() * 1.55, tint: rng() })
  }
  return trees
}

function createTraffic(rng, roads) {
  const candidates = roads.filter(road => road.main)
  return Array.from({ length: 120 }, (_, i) => {
    const road = pick(rng, candidates)
    const direction = rng() > 0.5 ? 1 : -1
    const laneOffset = road.width * (road.main ? 0.27 : 0.22)
    const lane = road.axis === 'x' ? direction * laneOffset : -direction * laneOffset
    const taxi = rng() < 0.16
    const driverName = `${pick(rng, GIVEN_NAMES)} ${pick(rng, FAMILY_NAMES)}`
    return {
      id: `car_${i}`,
      kind: taxi ? 'taxi' : 'private',
      driverName,
      driverTemperament: pick(rng, ['calm', 'careful', 'hurried', 'patient']),
      roadId: road.id,
      road,
      direction,
      lane,
      laneRule: 'right-hand',
      t: rng(),
      speed: 7 + rng() * 10,
      brake: 0,
      phase: rng() * TAU,
      color: taxi ? '#f6c445' : pick(rng, ['#e8504f', '#f3f4f6', '#1f2937', '#3b82f6', '#16a34a', '#f59e0b', '#7c3aed', '#94a3b8']),
    }
  })
}

function createAppearance(rng, role, gender, age) {
  const palette = pick(rng, FASHION_PALETTES)
  const ageBand = age < 24 ? 'young' : age > 62 ? 'senior' : 'adult'
  const roleBag = ['courier', 'student', 'teacher', 'engineer'].includes(role)
  const formal = ['banker', 'security', 'doctor'].includes(role)
  return {
    heightScale: clamp(0.9 + rng() * 0.22 + (ageBand === 'senior' ? -0.04 : 0), 0.86, 1.16),
    shoulderScale: 0.88 + rng() * 0.28,
    bodyScale: 0.9 + rng() * 0.18,
    legScale: 0.9 + rng() * 0.2,
    headScale: 0.92 + rng() * 0.16,
    ageBand,
    hairStyle: pick(rng, gender === 'man' ? ['short', 'cap', 'swept', 'shaved'] : ['bob', 'long', 'bun', 'cap']),
    hatStyle: role === 'courier' || role === 'security' || rng() > 0.82 ? pick(rng, ['cap', 'beanie']) : 'none',
    bagStyle: roleBag || rng() > 0.6 ? pick(rng, ['backpack', 'shoulder', 'briefcase']) : 'none',
    bottomStyle: !formal && rng() > 0.72 ? 'skirt' : 'pants',
    topColor: formal ? role === 'doctor' ? '#e9f1f4' : role === 'security' ? '#1d2633' : '#2b3342' : palette.top,
    jacketColor: formal ? role === 'doctor' ? '#f7fbff' : role === 'security' ? '#202833' : '#d7dde5' : palette.jacket,
    pantsColor: formal ? '#18202c' : palette.pants,
    shoeColor: palette.shoes,
    accessoryColor: palette.accessory,
  }
}

function buildingTypeLabel(type) {
  if (type === 'skyscraper') return 'tower'
  if (type === 'apartment') return 'residence'
  if (type === 'house') return 'house'
  if (type === 'office') return 'office'
  return 'building'
}

function frontageForBuilding(building, roadsById) {
  const road = roadsById.get(building.roadId)
  const setback = 3.4
  if (!road) {
    return {
      x: building.x,
      z: building.z - building.d / 2 - setback,
      y: terrainHeight(building.x, building.z - building.d / 2 - setback),
    }
  }

  if (road.axis === 'x') {
    const side = road.z >= building.z ? 1 : -1
    const x = clamp(building.x, road.from + 4, road.to - 4)
    const z = building.z + side * (building.d / 2 + setback)
    return { x, z, y: terrainHeight(x, z) }
  }

  const side = road.x >= building.x ? 1 : -1
  const x = building.x + side * (building.w / 2 + setback)
  const z = clamp(building.z, road.from + 4, road.to - 4)
  return { x, z, y: terrainHeight(x, z) }
}

function createAddressBook(buildings, roads) {
  const roadsById = new Map(roads.map(road => [road.id, road]))
  return buildings
    .filter(building => building.address && building.roadName)
    .map(building => {
      const frontage = frontageForBuilding(building, roadsById)
      const typeLabel = buildingTypeLabel(building.type)
      return {
        id: `addr_${building.id}`,
        buildingId: building.id,
        name: `${building.address} ${typeLabel}`,
        kind: 'address',
        buildingType: building.type,
        district: building.district,
        address: building.address,
        roadId: building.roadId,
        roadName: building.roadName,
        addressNumber: building.addressNumber,
        x: frontage.x,
        z: frontage.z,
        y: frontage.y,
        entryRule: 'sidewalk-frontage',
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

  return Array.from({ length: 160 }, (_, i) => {
    const roleInfo = pick(rng, ROLE_LIBRARY)
    const home = pick(rng, homes)
    const work = byId.get(roleInfo.workplace) || landmarks[0]
    const third = pick(rng, socialPlaces)
    const gender = pick(rng, ['woman', 'man', 'nonbinary'])
    const name = `${pick(rng, GIVEN_NAMES)} ${pick(rng, FAMILY_NAMES)}`
    const hx = home.x + (rng() - 0.5) * home.w
    const hz = home.z + (rng() - 0.5) * home.d

    const age = 18 + Math.floor(rng() * 57)

    return {
      id: `npc_${i}`,
      name,
      gender,
      age,
      role: roleInfo.role,
      job: roleInfo.job,
      color: roleInfo.color,
      pace: roleInfo.pace,
      personality: pick(rng, PERSONALITIES),
      appearance: createAppearance(rng, roleInfo.role, gender, age),
      home: { x: hx, z: hz, y: terrainHeight(hx, hz), name: `${name.split(' ')[1]} residence`, address: home.address, buildingId: home.id },
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
        properties: { layer: 'road', id: road.id, name: road.name, tier: road.tier },
        geometry: {
          type: 'LineString',
          coordinates: road.axis === 'x'
            ? [worldToLngLat(road.from, road.z), worldToLngLat(road.to, road.z)]
            : [worldToLngLat(road.x, road.from), worldToLngLat(road.x, road.to)],
        },
      })),
      ...landmarks.map(place => ({
        type: 'Feature',
        properties: { layer: 'place', id: place.id, kind: place.kind, name: place.name, address: place.address },
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
  const landmarks = landmarkSet(roads)
  const buildings = createBuildings(rng, landmarks, roads)
  const trees = createTrees(rng, landmarks, roads)
  const cars = createTraffic(rng, roads)
  const npcs = createNPCs(rng, buildings, landmarks)
  const addressBook = createAddressBook(buildings, roads)
  const tiles = createTiles(buildings, landmarks)
  const geojson = createGeoJSON(roads, landmarks)
  const getNearbyBuildings = buildCollisionIndex(buildings)

  return {
    seed,
    roads,
    buildings,
    trees,
    landmarks,
    addressBook,
    cars,
    npcs,
    tiles,
    geojson,
    worldToLngLat,
    districtAt,
    getNearbyBuildings,
    socialNorms: {
      pedestrian: 'NPCs prefer sidewalks, building entrances, plazas, and crosswalks; drive lanes are avoided except at crossings.',
      traffic: 'Cars use right-hand lanes, obey alternating traffic lights at main intersections, yield near pedestrians, and taxis use named-road addresses for pickup and drop-off.',
      planting: 'Trees and planters stay outside the road reserve so streets remain drivable and readable.',
      addressSystem: 'Virtual road-name addresses use numbered lots on named roads, e.g. 83 Station-daero, and resolve to sidewalk frontage points.',
    },
    trafficRules: {
      drivingSide: 'right-hand',
      laneRule: 'Opposite lanes carry opposite directions; east-west positive traffic uses the south/right lane, north-south positive traffic uses the west/right lane.',
      signals: `Main intersections alternate east-west and north-south green phases every ${TRAFFIC_SIGNAL_CYCLE_SECONDS / 2} seconds with a ${TRAFFIC_SIGNAL_YELLOW_SECONDS} second yellow interval.`,
      yielding: 'Drivers brake for pedestrians in or near a lane and stop at red/yellow signal approaches.',
    },
    integrations: {
      mapLibre: 'live procedural GeoJSON layer',
      cesium3DTiles: `${tiles.length} procedural tiles with 3D Tiles-style metadata`,
      tripo3D: `${landmarks.length} landmark prompts ready for asset replacement`,
    },
  }
}
