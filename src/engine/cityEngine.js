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
export const BUILDING_ROAD_SETBACK = 8.5

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

const GIVEN_NAMES = [
  'Minji', 'Hana', 'Joon', 'Sora', 'Doyun', 'Ara', 'Hyun', 'Yujin', 'Noel', 'Mina', 'Taeyang', 'Rin',
  'Eun', 'Garam', 'Iseul', 'Jae', 'Nari', 'Seojin', 'Yuna', 'Haru', 'Dami', 'Ian', 'Miso', 'Rowoon',
]
const FAMILY_NAMES = [
  'Kim', 'Park', 'Lee', 'Choi', 'Jung', 'Seo', 'Han', 'Kang', 'Lim', 'Shin', 'Yoon', 'Moon',
  'Baek', 'Kwon', 'Nam', 'Oh', 'Ryu', 'Hong',
]
const PERSONALITIES = [
  'warm', 'reserved', 'curious', 'direct', 'funny', 'tired', 'ambitious', 'careful', 'restless',
  'patient', 'dry-humored', 'formal', 'soft-spoken', 'street-smart', 'optimistic', 'skeptical',
]
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

const BODY_ARCHETYPES = [
  { id: 'tall_narrow', height: 0.09, shoulder: -0.04, body: -0.03, leg: 0.08, head: -0.02 },
  { id: 'compact_sturdy', height: -0.07, shoulder: 0.08, body: 0.08, leg: -0.04, head: 0.03 },
  { id: 'average_relaxed', height: 0, shoulder: 0, body: 0.03, leg: 0, head: 0 },
  { id: 'long_legged', height: 0.04, shoulder: -0.01, body: -0.02, leg: 0.11, head: -0.01 },
  { id: 'broad_shouldered', height: 0.02, shoulder: 0.13, body: 0.05, leg: -0.02, head: 0 },
  { id: 'slight_quick', height: -0.03, shoulder: -0.08, body: -0.06, leg: 0.05, head: 0.02 },
  { id: 'soft_round', height: -0.02, shoulder: 0.04, body: 0.13, leg: -0.03, head: 0.04 },
]

const WALK_STYLES = [
  { id: 'brisk', cadence: 1.14, stride: 1.08, armSwing: 1.2, speed: 1.06 },
  { id: 'measured', cadence: 0.9, stride: 0.88, armSwing: 0.78, speed: 0.94 },
  { id: 'bouncy', cadence: 1.22, stride: 0.96, armSwing: 1.1, speed: 1.02 },
  { id: 'careful', cadence: 0.82, stride: 0.8, armSwing: 0.66, speed: 0.9 },
  { id: 'long_stride', cadence: 0.96, stride: 1.22, armSwing: 0.95, speed: 1.08 },
  { id: 'hurried', cadence: 1.35, stride: 1.04, armSwing: 1.34, speed: 1.16 },
  { id: 'easygoing', cadence: 0.78, stride: 0.92, armSwing: 0.7, speed: 0.88 },
]

const DAILY_GOALS = {
  banker: ['close a client report', 'check the morning market board', 'meet a colleague near the exchange'],
  doctor: ['finish rounds without delaying triage', 'check on an emergency handoff', 'take a short quiet break after shift'],
  teacher: ['prepare the next class', 'walk students safely across campus', 'grade assignments before evening'],
  courier: ['finish a timed delivery loop', 'avoid late traffic near the depot', 'confirm the next pickup address'],
  barista: ['restock cups before lunch', 'remember a regular customer order', 'close the cafe cleanly tonight'],
  engineer: ['test a street sensor prototype', 'bring parts back to Maker Yard', 'debug a delivery robot route'],
  artist: ['sketch a new facade detail', 'meet friends near Neon Square', 'find good evening light for a mural'],
  security: ['keep station entrances clear', 'watch the crosswalk rush', 'help a lost visitor find the platform'],
  student: ['make it to class on time', 'meet a friend after school', 'study before heading home'],
  shopkeeper: ['open the front display', 'track a delivery from the depot', 'check foot traffic after work'],
  gardener: ['water the hill path planters', 'inspect trees near the road edge', 'clear leaves from a park entrance'],
  retiree: ['take a steady morning walk', 'chat near the park benches', 'buy groceries before sunset'],
}

const RELATIONSHIP_STYLES = ['neighborly', 'private', 'helpful', 'busy-but-kind', 'curious', 'formal', 'chatty', 'practical']

const SPEECH_STYLES = [
  { id: 'polite_brief', label: 'polite and brief', prefix: '네, ', flavor: '짧고 정중하게 말함' },
  { id: 'warm_chatty', label: 'warm and chatty', prefix: '좋아요, ', flavor: '상대 기분을 살피며 부드럽게 말함' },
  { id: 'dry_direct', label: 'dry and direct', prefix: '간단히 말하면, ', flavor: '군더더기 없이 건조하게 말함' },
  { id: 'careful_formal', label: 'careful and formal', prefix: '알겠습니다. ', flavor: '존댓말을 정확하게 쓰고 위험을 먼저 확인함' },
  { id: 'bright_casual', label: 'bright and casual', prefix: '오케이, ', flavor: '가볍고 밝은 톤으로 말함' },
  { id: 'tired_soft', label: 'tired but kind', prefix: '음, ', flavor: '조용하고 느리지만 친절하게 말함' },
  { id: 'street_practical', label: 'street practical', prefix: '바로 보면, ', flavor: '길과 교통을 현실적으로 따져 말함' },
  { id: 'curious_precise', label: 'curious and precise', prefix: '확인해볼게요. ', flavor: '질문을 정리하고 이유를 설명함' },
  { id: 'playful', label: 'playful', prefix: '좋죠. ', flavor: '농담을 살짝 섞어 말함' },
  { id: 'reserved', label: 'reserved', prefix: '가능합니다. ', flavor: '감정을 적게 드러내고 차분하게 말함' },
]

const GESTURE_STYLES = [
  'quick nod', 'hands in pockets', 'checks phone often', 'points while speaking', 'small wave',
  'adjusts bag strap', 'folds arms', 'looks around before answering', 'half-smile', 'formal bow',
]

const OUTFIT_PATTERNS = ['solid', 'two-tone', 'striped', 'layered', 'reflective-trim', 'workwear', 'soft-knit', 'streetwear']
const OUTERWEAR = ['hoodie', 'blazer', 'cardigan', 'vest', 'long coat', 'overshirt', 'utility jacket', 'windbreaker']
const ACCESSORIES = ['none', 'round glasses', 'square glasses', 'scarf', 'earbuds', 'watch', 'lanyard', 'crossbody pouch']
const VOICE_PACES = ['quick', 'measured', 'soft', 'low', 'bright', 'slow', 'crisp', 'breathy']
const VOICE_REGISTERS = ['formal', 'casual', 'practical', 'gentle', 'skeptical', 'warm', 'precise', 'dry']

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

function hslToHex(h, s, l) {
  const hue = ((h % 360) + 360) % 360
  const sat = clamp(s, 0, 100) / 100
  const light = clamp(l, 0, 100) / 100
  const c = (1 - Math.abs(2 * light - 1)) * sat
  const x = c * (1 - Math.abs((hue / 60) % 2 - 1))
  const m = light - c / 2
  const [r1, g1, b1] = hue < 60
    ? [c, x, 0]
    : hue < 120
      ? [x, c, 0]
      : hue < 180
        ? [0, c, x]
        : hue < 240
          ? [0, x, c]
          : hue < 300
            ? [x, 0, c]
            : [c, 0, x]
  const toHex = value => Math.round((value + m) * 255).toString(16).padStart(2, '0')
  return `#${toHex(r1)}${toHex(g1)}${toHex(b1)}`
}

function colorFromHue(h, s = 52, l = 50) {
  return hslToHex(h, s, l)
}

function uniqueName(rng, usedNames, index) {
  for (let tries = 0; tries < 80; tries += 1) {
    const name = `${pick(rng, GIVEN_NAMES)} ${pick(rng, FAMILY_NAMES)}`
    if (!usedNames.has(name)) {
      usedNames.add(name)
      return name
    }
  }
  const fallback = `${GIVEN_NAMES[index % GIVEN_NAMES.length]} ${FAMILY_NAMES[Math.floor(index / GIVEN_NAMES.length) % FAMILY_NAMES.length]} ${index + 1}`
  usedNames.add(fallback)
  return fallback
}

function createSpeechStyle(rng, role, personality, index) {
  const base = SPEECH_STYLES[(index + Math.floor(rng() * SPEECH_STYLES.length)) % SPEECH_STYLES.length]
  const voice = `${pick(rng, VOICE_PACES)} ${pick(rng, VOICE_REGISTERS)}`
  const gesture = GESTURE_STYLES[(index * 3 + Math.floor(rng() * GESTURE_STYLES.length)) % GESTURE_STYLES.length]
  return {
    ...base,
    voice,
    gesture,
    roleBias: role,
    personalityBias: personality,
    signature: `${base.id}-${voice.replace(/\s+/g, '_')}-${gesture.replace(/\s+/g, '_')}-${index}`,
  }
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

function entryFaceForPoint(x, z, roadId, roads) {
  const road = roads.find(item => item.id === roadId)
  if (!road) return 'south'
  if (road.axis === 'x') return road.z >= z ? 'north' : 'south'
  return road.x >= x ? 'east' : 'west'
}

function oppositeFace(face) {
  return {
    north: 'south',
    south: 'north',
    east: 'west',
    west: 'east',
  }[face] || 'north'
}

function createFacadePlan(type, form, entryFace, rng) {
  const faces = ['north', 'south', 'east', 'west']
  const baseDensity = type === 'skyscraper' ? 0.95 : type === 'office' ? 0.78 : type === 'apartment' ? 0.64 : 0.42
  const rearFace = oppositeFace(entryFace)
  const primaryRhythm = pick(rng, ['regular-grid', 'offset-grid', 'vertical-bands', 'punched-openings'])
  const sideRhythm = pick(rng, ['regular-grid', 'offset-grid', 'vertical-bands', 'punched-openings'])
  const balconyPattern = type === 'apartment'
    ? form.profile === 'balcony_stack'
      ? 'stacked-centered'
      : pick(rng, ['stacked-centered', 'paired-balanced', 'corner-return'])
    : 'none'
  return {
    entryFace,
    rearFace,
    balconyPattern,
    glazingWrap: type === 'skyscraper' ? 'curtain-wall-all-sides' : type === 'office' ? 'mixed-all-sides' : 'residential-all-sides',
    faces: Object.fromEntries(faces.map((face, index) => {
      const role = face === entryFace ? 'front' : face === rearFace ? 'rear' : 'side'
      const roleFactor = role === 'front' ? 1.04 : role === 'rear' ? 0.92 : 0.86
      const density = clamp(baseDensity * roleFactor + (rng() - 0.5) * 0.045, type === 'house' ? 0.24 : 0.34, 1)
      const rhythm = role === 'side' ? sideRhythm : primaryRhythm
      const supportsBalcony = type === 'apartment' && (role === 'front' || (role === 'rear' && balconyPattern !== 'corner-return'))
      return [face, {
        role,
        glazingDensity: density,
        hasWindows: true,
        hasEntry: role === 'front',
        rhythm,
        trim: form.facade,
        balconyBias: supportsBalcony,
        balconyPattern: supportsBalcony ? balconyPattern : 'none',
        pairedWith: face === entryFace ? rearFace : face === rearFace ? entryFace : oppositeFace(face),
        articulation: role === 'front'
          ? 'primary-entry'
          : role === 'rear'
            ? 'service-rear'
            : index % 2 === 0
              ? 'balanced-side-a'
              : 'balanced-side-b',
      }]
    })),
    coherence: {
      frontBackLinked: true,
      sideFacesBalanced: true,
      balconyRule: balconyPattern,
      entryRule: 'street-facing-door',
    },
  }
}

function createBuildingInterior(type, form, w, d, h, entryFace, rng) {
  const floorHeight = type === 'house' ? 3.1 : type === 'apartment' ? 3.35 : 4.05
  const floors = Math.max(1, Math.floor(h / floorHeight))
  const verticalCore = type === 'house'
    ? 'stairs'
    : type === 'apartment'
      ? pick(rng, ['stairs', 'elevator'])
      : pick(rng, ['elevator', 'elevator', 'stairs', 'escalator'])
  const lobbyDepth = clamp(type === 'house' ? d * 0.28 : type === 'apartment' ? d * 0.34 : d * 0.42, 2.4, Math.max(2.4, d - 2))
  const lobbyWidth = clamp(type === 'house' ? w * 0.38 : w * 0.58, 2.8, Math.max(2.8, w - 1.4))
  const unitCount = type === 'house'
    ? 1
    : type === 'apartment'
      ? Math.max(2, Math.floor((w + d) / 8))
      : Math.max(3, Math.floor((w + d) / 7))
  const doorWidth = clamp(type === 'house' ? w * 0.22 : w * 0.3, 1.5, Math.max(1.6, w * 0.58))
  return {
    entryFace,
    solidWalls: true,
    entryRule: 'front-door-and-lobby',
    floors,
    floorHeight,
    lobbyDepth,
    lobbyWidth,
    doorWidth,
    corridorType: type === 'house' ? 'room-to-room' : form.profile === 'atrium' ? 'atrium-loop' : form.profile === 'bar' ? 'linear-spine' : 'central-core',
    verticalCore,
    publicAccess: type === 'office' || type === 'skyscraper' ? 'lobby-public' : type === 'apartment' ? 'residents-and-guests' : 'private-home',
    entryPortal: {
      face: entryFace,
      width: doorWidth,
      rule: 'pass-through-door-only',
    },
    floorNavigation: {
      method: verticalCore,
      reachableFloors: floors,
      floorHeight,
      canChangeFloors: floors > 1,
    },
    zones: type === 'house'
      ? ['entry', 'living', 'kitchen', 'bedroom']
      : type === 'apartment'
        ? ['entry lobby', 'mail room', 'residential corridor', 'units']
        : ['entry lobby', 'reception', 'vertical core', 'tenant floors'],
    unitsPerFloor: unitCount,
    coreOffset: {
      along: (rng() - 0.5) * Math.min(w, d) * 0.24,
      depth: lobbyDepth + 1.8 + rng() * Math.max(1.2, Math.min(w, d) * 0.12),
    },
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

function buildableZoneForBlock(blockX, blockZ, roads) {
  const west = roads
    .filter(road => road.axis === 'z' && road.x < blockX)
    .sort((a, b) => b.x - a.x)[0]
  const east = roads
    .filter(road => road.axis === 'z' && road.x > blockX)
    .sort((a, b) => a.x - b.x)[0]
  const south = roads
    .filter(road => road.axis === 'x' && road.z < blockZ)
    .sort((a, b) => b.z - a.z)[0]
  const north = roads
    .filter(road => road.axis === 'x' && road.z > blockZ)
    .sort((a, b) => a.z - b.z)[0]

  if (!west || !east || !south || !north) return null

  const minX = west.x + west.width / 2 + BUILDING_ROAD_SETBACK
  const maxX = east.x - east.width / 2 - BUILDING_ROAD_SETBACK
  const minZ = south.z + south.width / 2 + BUILDING_ROAD_SETBACK
  const maxZ = north.z - north.width / 2 - BUILDING_ROAD_SETBACK
  const width = maxX - minX
  const depth = maxZ - minZ

  if (width < 18 || depth < 18) return null

  return {
    minX,
    maxX,
    minZ,
    maxZ,
    width,
    depth,
    cx: (minX + maxX) / 2,
    cz: (minZ + maxZ) / 2,
  }
}

function nearestBlockCenterCoord(value) {
  const first = -CITY_GRID_HALF + ROAD_SPACING / 2
  const last = CITY_GRID_HALF - ROAD_SPACING / 2
  const index = Math.round((clamp(value, first, last) - first) / ROAD_SPACING)
  return first + index * ROAD_SPACING
}

function blockReferenceForPoint(x, z) {
  return {
    x: nearestBlockCenterCoord(x),
    z: nearestBlockCenterCoord(z),
  }
}

function landmarkBaseFootprint(place) {
  const base = {
    transit: { width: 68, depth: 31 },
    finance: { width: 32, depth: 32 },
    cafe: { width: 30, depth: 24 },
    hospital: { width: 42, depth: 32 },
    workshop: { width: 32, depth: 25 },
    retail: { width: 36, depth: 25 },
    school: { width: 40, depth: 30 },
    leisure: { width: 38, depth: 30 },
    logistics: { width: 63, depth: 46 },
    park: { width: 68, depth: 68 },
  }[place.kind] || { width: 28, depth: 24 }

  return {
    width: base.width * (place.scale || 1),
    depth: base.depth * (place.scale || 1),
  }
}

function fitFootprintToZone(footprint, zone) {
  if (!zone) return { ...footprint, scale: 1 }
  const maxWidth = zone.width * 0.88
  const maxDepth = zone.depth * 0.88
  const scale = Math.min(1, maxWidth / footprint.width, maxDepth / footprint.depth)
  return {
    width: footprint.width * scale,
    depth: footprint.depth * scale,
    scale,
  }
}

function landmarkInteriorFor(place, footprint) {
  const interior = LANDMARK_INTERIORS[place.kind]
  if (!interior) return null

  const scale = footprint.scale || 1
  const width = Math.max(10, Math.min(interior.width * scale, footprint.width - 2))
  const depth = Math.max(9, Math.min(interior.depth * scale, footprint.depth - 2))
  const doorLimit = Math.max(3.4, width - 4)

  return {
    ...interior,
    width,
    depth,
    height: Math.max(5.4, interior.height * Math.max(0.72, scale)),
    doorWidth: Math.min(Math.max(3.8, interior.doorWidth * scale), doorLimit),
    lobbyDepth: Math.min(Math.max(6, interior.lobbyDepth * scale), Math.max(6, depth - 3)),
    entranceSide: 'front',
    solidWalls: true,
    entryRule: 'front-door-only',
    floorCount: Math.max(1, Math.floor((place.kind === 'finance' ? 9 : place.kind === 'hospital' ? 4 : place.kind === 'logistics' ? 2 : 3) * Math.max(0.72, scale))),
    lobbyZones: place.kind === 'hospital'
      ? ['reception', 'triage', 'elevator hall', 'waiting']
      : place.kind === 'transit'
        ? ['ticketing', 'platform access', 'escalator hall', 'retail kiosks']
        : place.kind === 'logistics'
          ? ['dispatch desk', 'loading office', 'stairs', 'secure storage']
          : ['reception', 'public lobby', 'vertical core', 'service room'],
    partitionGrid: place.kind === 'cafe' || place.kind === 'retail' ? 'open-front-retail' : place.kind === 'finance' ? 'secure-core' : 'public-lobby',
  }
}

function landmarkSet(roads) {
  return LANDMARK_BLUEPRINTS.map(place => {
    const blockReference = blockReferenceForPoint(place.x, place.z)
    const zone = buildableZoneForBlock(blockReference.x, blockReference.z, roads)
    const footprint = fitFootprintToZone(landmarkBaseFootprint(place), zone)
    const x = zone
      ? clamp(place.x, zone.minX + footprint.width / 2, zone.maxX - footprint.width / 2)
      : place.x
    const z = zone
      ? clamp(place.z, zone.minZ + footprint.depth / 2, zone.maxZ - footprint.depth / 2)
      : place.z

    return {
      ...place,
      x,
      z,
      y: terrainHeight(x, z),
      radius: Math.max(14, Math.min(footprint.width, footprint.depth) / 2),
      footprint,
      zoning: zone
        ? {
            requested: { x: place.x, z: place.z },
            blockCenter: blockReference,
            buildable: zone,
            roadSetback: BUILDING_ROAD_SETBACK,
            envelopeW: footprint.width,
            envelopeD: footprint.depth,
          }
        : null,
      ...addressInfoForPoint(x, z, roads),
      interior: landmarkInteriorFor(place, footprint),
    }
  })
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
      const zone = buildableZoneForBlock(x, z, roads)
      if (!zone) continue

      const count = district.id === 'core' ? 1 + Math.floor(rng() * 2) : district.id === 'outer' ? 2 + Math.floor(rng() * 3) : 1 + Math.floor(rng() * 3)
      const slots = slotSets[Math.min(4, count)]

      for (let i = 0; i < count; i += 1) {
        const type = district.id === 'core' ? 'skyscraper' : district.type === 'house' ? 'house' : district.type === 'apartment' ? 'apartment' : rng() > 0.55 ? 'office' : 'apartment'
        const slot = slots[i] || slots[0]
        const single = count === 1
        const maxW = single
          ? zone.width * (type === 'house' ? 0.42 : 0.58)
          : zone.width * (type === 'house' ? 0.28 : 0.32)
        const maxD = single
          ? zone.depth * (type === 'apartment' ? 0.48 : type === 'house' ? 0.42 : 0.56)
          : zone.depth * (type === 'house' ? 0.28 : 0.31)
        const minW = type === 'house' ? 7.2 : 11
        const minD = type === 'house' ? 7.2 : 11
        if (maxW < minW || maxD < minD) continue
        const w = clamp(type === 'house' ? 7.5 + rng() * 6.5 : 12 + rng() * Math.max(7, maxW - 12), minW, maxW)
        const d = clamp(type === 'house' ? 7.5 + rng() * 6.5 : 12 + rng() * Math.max(7, maxD - 12), minD, maxD)
        const jitterX = single ? zone.width * 0.025 : zone.width * 0.015
        const jitterZ = single ? zone.depth * 0.025 : zone.depth * 0.015
        const bx = clamp(zone.cx + slot.x * zone.width + (rng() - 0.5) * jitterX, zone.minX + w * 0.68, zone.maxX - w * 0.68)
        const bz = clamp(zone.cz + slot.z * zone.depth + (rng() - 0.5) * jitterZ, zone.minZ + d * 0.72, zone.maxZ - d * 0.72)
        const base = terrainHeight(bx, bz)
        const height = type === 'skyscraper'
          ? 44 + rng() * 92
          : type === 'office'
            ? 16 + rng() * 42
            : type === 'apartment'
              ? 10 + rng() * 24
              : 4.5 + rng() * 6.5

        const address = addressInfoForPoint(bx, bz, roads)
        const form = createBuildingForm(type, rng, district)
        const entryFace = entryFaceForPoint(bx, bz, address.roadId, roads)

        buildings.push({
          id: `b${id++}`,
          x: bx,
          z: bz,
          y: base,
          ...address,
          w,
          d,
          h: height,
          type,
          district: district.name,
          rot: 0,
          tint: rng(),
          entryFace,
          facadePlan: createFacadePlan(type, form, entryFace, rng),
          interior: createBuildingInterior(type, form, w, d, height, entryFace, rng),
          zoning: {
            blockCenter: { x, z },
            buildable: zone,
            roadSetback: BUILDING_ROAD_SETBACK,
            envelopeW: w * 1.36,
            envelopeD: d * 1.44,
          },
          form,
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
    const taxi = rng() < 0.3
    const bodyStyle = taxi ? pick(rng, ['sedan', 'minivan']) : pick(rng, ['sedan', 'hatchback', 'suv', 'van', 'coupe'])
    const dimensions = {
      sedan: { width: 2.05, height: 0.72, length: 4.35, cabinLength: 1.82, cabinHeight: 0.58 },
      hatchback: { width: 1.95, height: 0.72, length: 3.85, cabinLength: 1.72, cabinHeight: 0.62 },
      suv: { width: 2.18, height: 0.9, length: 4.55, cabinLength: 2.05, cabinHeight: 0.72 },
      van: { width: 2.22, height: 0.96, length: 4.85, cabinLength: 2.58, cabinHeight: 0.78 },
      minivan: { width: 2.16, height: 0.9, length: 4.78, cabinLength: 2.4, cabinHeight: 0.72 },
      coupe: { width: 1.98, height: 0.64, length: 4.05, cabinLength: 1.42, cabinHeight: 0.48 },
    }[bodyStyle]
    const driverName = `${pick(rng, GIVEN_NAMES)} ${pick(rng, FAMILY_NAMES)}`
    return {
      id: `car_${i}`,
      kind: taxi ? 'taxi' : 'private',
      bodyStyle,
      dimensions,
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

function createAppearance(rng, role, gender, age, index = 0) {
  const palette = pick(rng, FASHION_PALETTES)
  const body = BODY_ARCHETYPES[(index + Math.floor(rng() * BODY_ARCHETYPES.length)) % BODY_ARCHETYPES.length]
  const walk = WALK_STYLES[(index * 2 + Math.floor(rng() * WALK_STYLES.length)) % WALK_STYLES.length]
  const pattern = OUTFIT_PATTERNS[(index * 3 + Math.floor(rng() * OUTFIT_PATTERNS.length)) % OUTFIT_PATTERNS.length]
  const outerwear = OUTERWEAR[(index * 5 + Math.floor(rng() * OUTERWEAR.length)) % OUTERWEAR.length]
  const accessory = ACCESSORIES[(index * 7 + Math.floor(rng() * ACCESSORIES.length)) % ACCESSORIES.length]
  const ageBand = age < 24 ? 'young' : age > 62 ? 'senior' : 'adult'
  const roleBag = ['courier', 'student', 'teacher', 'engineer'].includes(role)
  const formal = ['banker', 'security', 'doctor'].includes(role)
  const hue = (index * 47 + Math.floor(rng() * 31)) % 360
  const accentHue = (hue + 145 + Math.floor(rng() * 56)) % 360
  const neutralHue = (hue + 210 + Math.floor(rng() * 50)) % 360
  const topColor = formal
    ? role === 'doctor'
      ? colorFromHue(198 + index * 7, 18, 88)
      : role === 'security'
        ? colorFromHue(214 + index * 5, 26, 20)
        : colorFromHue(218 + index * 9, 28, 28)
    : colorFromHue(hue, 42 + rng() * 22, 36 + rng() * 18)
  const jacketColor = formal
    ? role === 'doctor'
      ? colorFromHue(205 + index * 11, 16, 94)
      : role === 'security'
        ? colorFromHue(218 + index * 8, 26, 16)
        : colorFromHue(accentHue, 20 + rng() * 18, 68 + rng() * 10)
    : pattern === 'two-tone' || pattern === 'layered'
      ? colorFromHue(accentHue, 36 + rng() * 22, 52 + rng() * 18)
      : palette.jacket
  const pantsColor = role === 'doctor'
    ? colorFromHue(neutralHue, 18, 28)
    : colorFromHue(neutralHue, 22 + rng() * 18, 16 + rng() * 16)
  const accessoryColor = colorFromHue(accentHue + 36, 48 + rng() * 26, 38 + rng() * 18)
  const skinHue = 22 + rng() * 22
  const skinColor = colorFromHue(skinHue, 32 + rng() * 20, 55 + rng() * 21)
  const grayHair = ageBand === 'senior' && rng() > 0.55
  const hairColor = grayHair
    ? colorFromHue(35 + rng() * 25, 10 + rng() * 12, 44 + rng() * 18)
    : colorFromHue(16 + rng() * 34, 24 + rng() * 32, 12 + rng() * 26)
  const glassesStyle = accessory.includes('glasses') ? accessory : (rng() > 0.88 ? pick(rng, ['round glasses', 'square glasses']) : 'none')
  const scarfStyle = accessory === 'scarf' || rng() > 0.9 ? pick(rng, ['thin', 'wide']) : 'none'
  return {
    signature: `${body.id}-${walk.id}-${pattern}-${outerwear}-${accessory}-${hue}-${index}`,
    bodyArchetype: body.id,
    walkStyle: walk,
    outfitPattern: pattern,
    outerwear,
    accessory,
    heightScale: clamp(0.96 + body.height + rng() * 0.12 + (ageBand === 'senior' ? -0.035 : 0), 0.84, 1.2),
    shoulderScale: clamp(1 + body.shoulder + (gender === 'man' ? 0.025 : gender === 'woman' ? -0.015 : 0) + (rng() - 0.5) * 0.09, 0.78, 1.26),
    bodyScale: clamp(1 + body.body + (rng() - 0.5) * 0.08, 0.82, 1.24),
    legScale: clamp(1 + body.leg + (rng() - 0.5) * 0.09, 0.82, 1.26),
    headScale: clamp(1 + body.head + (rng() - 0.5) * 0.08, 0.88, 1.14),
    ageBand,
    hairStyle: pick(rng, gender === 'man' ? ['short', 'cap', 'swept', 'shaved'] : ['bob', 'long', 'bun', 'cap']),
    hatStyle: role === 'courier' || role === 'security' || rng() > 0.82 ? pick(rng, ['cap', 'beanie']) : 'none',
    bagStyle: roleBag || rng() > 0.6 ? pick(rng, ['backpack', 'shoulder', 'briefcase']) : 'none',
    bottomStyle: !formal && rng() > 0.72 ? 'skirt' : 'pants',
    topColor,
    jacketColor,
    pantsColor,
    shoeColor: colorFromHue(neutralHue + 24, 16 + rng() * 12, 8 + rng() * 8),
    accessoryColor,
    skinColor,
    hairColor,
    glassesStyle,
    scarfStyle,
    styleBrief: `${outerwear}, ${pattern}, ${accessory}, ${body.id}, ${walk.id}`,
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

function createNPCs(rng, buildings, landmarks, roads) {
  const socialPlaces = landmarks.filter(place => ['cafe', 'park', 'retail', 'leisure', 'transit'].includes(place.kind))
  const byId = new Map(landmarks.map(place => [place.id, place]))
  const homes = buildings.filter(building => building.type === 'apartment' || building.type === 'house')
  const roadsById = new Map(roads.map(road => [road.id, road]))
  const usedNames = new Set()

  return Array.from({ length: 160 }, (_, i) => {
    const roleInfo = pick(rng, ROLE_LIBRARY)
    const home = pick(rng, homes)
    const work = byId.get(roleInfo.workplace) || landmarks[0]
    const third = pick(rng, socialPlaces)
    const gender = pick(rng, ['woman', 'man', 'nonbinary'])
    const name = uniqueName(rng, usedNames, i)
    const frontage = frontageForBuilding(home, roadsById)
    const hx = frontage ? frontage.x + (rng() - 0.5) * 4.4 : home.x + (rng() - 0.5) * home.w
    const hz = frontage ? frontage.z + (rng() - 0.5) * 4.4 : home.z + (rng() - 0.5) * home.d

    const age = 18 + Math.floor(rng() * 57)
    const personality = pick(rng, PERSONALITIES)
    const speechStyle = createSpeechStyle(rng, roleInfo.role, personality, i)
    const appearance = createAppearance(rng, roleInfo.role, gender, age, i)
    const dailyGoals = DAILY_GOALS[roleInfo.role] || ['follow today schedule', 'check in with a friend', 'return home safely']
    const dailyGoal = dailyGoals[(i + Math.floor(rng() * dailyGoals.length)) % dailyGoals.length]
    const needProfile = {
      energy: clamp(0.52 + rng() * 0.42 - (age > 62 ? 0.08 : 0), 0.25, 0.98),
      hunger: clamp(0.18 + rng() * 0.38, 0.05, 0.78),
      social: clamp(0.28 + rng() * 0.56, 0.08, 0.96),
      urgency: clamp(roleInfo.pace * 0.42 + rng() * 0.34, 0.12, 0.94),
    }

    return {
      id: `npc_${i}`,
      name,
      gender,
      age,
      role: roleInfo.role,
      job: roleInfo.job,
      color: roleInfo.color,
      pace: roleInfo.pace * (appearance.walkStyle?.speed || 1),
      personality,
      speechStyle,
      voice: speechStyle.voice,
      gestureStyle: speechStyle.gesture,
      appearance,
      autonomy: {
        dailyGoal,
        needProfile,
        relationshipStyle: RELATIONSHIP_STYLES[(i + Math.floor(rng() * RELATIONSHIP_STYLES.length)) % RELATIONSHIP_STYLES.length],
        memoryStyle: personality,
        routineTolerance: clamp(0.35 + rng() * 0.56, 0.18, 0.96),
      },
      personaSignature: `${personality}-${speechStyle.signature}`,
      styleBrief: `${appearance.styleBrief}, ${speechStyle.label}, ${speechStyle.voice}`,
      home: {
        x: hx,
        z: hz,
        y: terrainHeight(hx, hz),
        name: `${name.split(' ')[1]} residence`,
        address: home.address,
        buildingId: home.id,
        roadName: frontage?.roadName || home.roadName,
        entryRule: frontage ? 'home-sidewalk-frontage' : 'home-building-offset',
      },
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
  const npcs = createNPCs(rng, buildings, landmarks, roads)
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
      zoning: `Buildings are restricted to per-block buildable envelopes with a ${BUILDING_ROAD_SETBACK}m setback from road reserves.`,
      npcDiversity: 'Every NPC carries a distinct name, body archetype, walking cadence, outfit/accessory signature, voice register, gesture style, and speech flavor.',
      npcAutonomy: 'Every NPC has a daily goal, mutable needs, relationship style, and short memory feed that can surface as live city events.',
      collision: 'Buildings, landmark interiors, pedestrians, and vehicles are treated as solid bodies; contacts push actors apart, make pedestrians stumble or fall, and force drivers to brake.',
      streetHierarchy: 'Sidewalks are segmented before intersections, curbs mark the road edge, and zebra crosswalks with stop bars are the only pedestrian surfaces crossing traffic lanes.',
      facadeSystem: 'Procedural facades use bright wall palettes, mullion grids, reflective/lit window cells, balcony rails, and trim so buildings read as walls and glass rather than black blocks.',
    },
    zoningRules: {
      roadSetback: BUILDING_ROAD_SETBACK,
      buildableEnvelope: 'Each generated building is clamped inside the rectangle between adjacent roads after subtracting road half-widths and setbacks.',
      rotationPolicy: 'Procedural buildings stay axis-aligned with the street grid until parcel-aware rotated lots are introduced.',
    },
    trafficRules: {
      drivingSide: 'right-hand',
      laneRule: 'Opposite lanes carry opposite directions; east-west positive traffic uses the south/right lane, north-south positive traffic uses the west/right lane.',
      signals: `Main intersections alternate east-west and north-south green phases every ${TRAFFIC_SIGNAL_CYCLE_SECONDS / 2} seconds with a ${TRAFFIC_SIGNAL_YELLOW_SECONDS} second yellow interval.`,
      yielding: 'Drivers brake for pedestrians in or near a lane and stop at red/yellow signal approaches.',
      followingDistance: 'Drivers track the nearest vehicle in the same lane and reduce speed before the gap falls below a temperament-adjusted safety distance.',
    },
    integrations: {
      mapLibre: 'live procedural GeoJSON layer',
      cesium3DTiles: `${tiles.length} procedural tiles with 3D Tiles-style metadata`,
      tripo3D: `${landmarks.length} landmark prompts ready for asset replacement`,
    },
  }
}
