import { spawn, spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright-core'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const root = path.resolve(__dirname, '..')
const artifactsDir = path.join(root, '.verification')
const port = 5177 + Math.floor(Math.random() * 200)
const baseUrl = `http://127.0.0.1:${port}`

const randomTasks = [
  'Take me to South Depot. Use a taxi and stay with me until we arrive.',
  'Take me to Hill Park. Use a taxi and stay with me until we arrive.',
  'Take me to Neon Square. Use a taxi and stay with me until we arrive.',
  'Take me to Mirae School. Use a taxi and stay with me until we arrive.',
]

const BROKEN_TEXT_PATTERN = /[�源뚯앹몃곕뺥吏紐媛醫蹂諛濡湲鍮]|[?]{2,}/u

function assert(condition, message) {
  if (!condition) throw new Error(message)
}

function assertReadableText(label, text) {
  assert(!BROKEN_TEXT_PATTERN.test(String(text || '')), `${label} contains mojibake text: ${text}`)
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms))
}

function angleDiff(a, b) {
  return Math.atan2(Math.sin(a - b), Math.cos(a - b))
}

function positionDistance(a, b) {
  return Math.hypot(a.x - b.x, a.z - b.z)
}

async function inspectBuildingAccess(page) {
  const result = await page.evaluate(() => {
    const city = window.__REALCITY_CITY__
    const collision = window.__REALCITY_COLLISION__
    if (!city || !collision) return null
    const faces = ['north', 'south', 'east', 'west']
    const world = (item, lx, lz) => {
      const cos = Math.cos(item.rot || 0)
      const sin = Math.sin(item.rot || 0)
      return {
        x: item.x + lx * cos + lz * sin,
        z: item.z - lx * sin + lz * cos,
      }
    }
    const probe = (building, face, along, distanceFromFace) => {
      if (face === 'north') return world(building, along, building.d / 2 + distanceFromFace)
      if (face === 'south') return world(building, along, -building.d / 2 - distanceFromFace)
      if (face === 'east') return world(building, building.w / 2 + distanceFromFace, along)
      return world(building, -building.w / 2 - distanceFromFace, along)
    }
    const doorEntryTests = []
    const blockedSideWallTests = []

    for (const building of city.buildings) {
      const face = building.interior?.entryPortal?.face || building.facadePlan?.entryFace || 'south'
      const outside = probe(building, face, 0, 2.2)
      const inside = probe(building, face, 0, -1.1)
      const [x, z] = collision.resolveBuildingCollision(city, outside.x, outside.z, inside.x, inside.z)
      const interior = collision.currentInterior(city, x, z)
      if (interior?.id === building.id) doorEntryTests.push(building.id)

      const blockedFace = faces.find(candidate => candidate !== face)
      const faceLen = blockedFace === 'north' || blockedFace === 'south' ? building.w : building.d
      const sideOutside = probe(building, blockedFace, faceLen * 0.28, 2.2)
      const sideInside = probe(building, blockedFace, faceLen * 0.28, -1.1)
      const [blockedX, blockedZ] = collision.resolveBuildingCollision(city, sideOutside.x, sideOutside.z, sideInside.x, sideInside.z)
      const blockedInterior = collision.currentInterior(city, blockedX, blockedZ)
      if (blockedInterior?.id !== building.id) blockedSideWallTests.push(building.id)
    }

    const floorReady = city.buildings.filter(building =>
      building.interior?.entryPortal?.rule === 'pass-through-door-only' &&
      building.interior?.floorNavigation?.reachableFloors === building.interior?.floors &&
      building.interior?.floorNavigation?.floorHeight === building.interior?.floorHeight
    )
    const floorDirectoryReady = city.buildings.filter(building =>
      Array.isArray(building.interior?.floorDirectory) &&
      building.interior.floorDirectory.length === building.interior.floors &&
      building.interior.floorDirectory.every(entry => entry.level > 0 && entry.label && entry.zone && entry.access && entry.core && entry.guide)
    )
    const currentInteriorDirectoryReady = city.buildings.filter(building => {
      const face = building.interior?.entryPortal?.face || building.facadePlan?.entryFace || 'south'
      const inside = probe(building, face, 0, -1.1)
      const interior = collision.currentInterior(city, inside.x, inside.z)
      return interior?.id === building.id &&
        Array.isArray(interior.floorDirectory) &&
        interior.floorDirectory.length === building.interior.floors
    })

    return {
      buildingCount: city.buildings.length,
      doorEntryTests: doorEntryTests.length,
      blockedSideWallTests: blockedSideWallTests.length,
      floorNavigationReady: floorReady.length,
      floorDirectoryReady: floorDirectoryReady.length,
      currentInteriorDirectoryReady: currentInteriorDirectoryReady.length,
    }
  })

  assert(result, 'Building access collision helpers were not exposed in the browser')
  assert(result.doorEntryTests === result.buildingCount, `Not every procedural building can be entered through its door: ${result.doorEntryTests}/${result.buildingCount}`)
  assert(result.blockedSideWallTests === result.buildingCount, `Some procedural side walls are passable away from doors: ${result.blockedSideWallTests}/${result.buildingCount}`)
  assert(result.floorNavigationReady === result.buildingCount, `Procedural building floor navigation metadata is incomplete: ${result.floorNavigationReady}/${result.buildingCount}`)
  assert(result.floorDirectoryReady === result.buildingCount, `Procedural building floor directories are incomplete: ${result.floorDirectoryReady}/${result.buildingCount}`)
  assert(result.currentInteriorDirectoryReady === result.buildingCount, `Runtime interior lookup does not expose floor directories: ${result.currentInteriorDirectoryReady}/${result.buildingCount}`)
  return result
}

function keyForCode(code) {
  if (code.startsWith('Key')) return code.slice(3).toLowerCase()
  if (code.startsWith('Arrow')) return code
  if (code === 'Space') return ' '
  if (code.startsWith('Shift')) return 'Shift'
  return code
}

async function dispatchKey(page, code, type) {
  await page.evaluate(({ code: eventCode, key, type: eventType }) => {
    window.dispatchEvent(new KeyboardEvent(eventType, {
      code: eventCode,
      key,
      bubbles: true,
      cancelable: true,
    }))
  }, { code, key: keyForCode(code), type })
}

async function holdKey(page, code, ms) {
  await dispatchKey(page, code, 'keydown')
  await page.waitForTimeout(ms)
  await dispatchKey(page, code, 'keyup')
}

function findBrowserExecutable() {
  const candidates = process.platform === 'win32'
    ? [
        path.join(process.env.PROGRAMFILES || 'C:\\Program Files', 'Google\\Chrome\\Application\\chrome.exe'),
        path.join(process.env['PROGRAMFILES(X86)'] || 'C:\\Program Files (x86)', 'Google\\Chrome\\Application\\chrome.exe'),
        path.join(process.env.LOCALAPPDATA || '', 'Google\\Chrome\\Application\\chrome.exe'),
        path.join(process.env.PROGRAMFILES || 'C:\\Program Files', 'Microsoft\\Edge\\Application\\msedge.exe'),
        path.join(process.env['PROGRAMFILES(X86)'] || 'C:\\Program Files (x86)', 'Microsoft\\Edge\\Application\\msedge.exe'),
      ]
    : [
        '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
        '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
        '/usr/bin/google-chrome',
        '/usr/bin/chromium',
        '/usr/bin/chromium-browser',
        '/usr/bin/microsoft-edge',
      ]

  return candidates.find(candidate => candidate && existsSync(candidate))
}

function startDevServer() {
  const command = process.platform === 'win32' ? 'cmd.exe' : 'npm'
  const args = process.platform === 'win32'
    ? ['/d', '/s', '/c', `npm run dev -- --host 127.0.0.1 --port ${port} --strictPort`]
    : ['run', 'dev', '--', '--host', '127.0.0.1', '--port', String(port), '--strictPort']
  const child = spawn(command, args, {
    cwd: root,
    stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, BROWSER: 'none' },
  })

  const logs = []
  child.stdout.on('data', chunk => logs.push(chunk.toString()))
  child.stderr.on('data', chunk => logs.push(chunk.toString()))
  return { child, logs }
}

function stopDevServer(child) {
  if (!child || child.killed) return
  if (process.platform === 'win32') {
    spawnSync('taskkill.exe', ['/PID', String(child.pid), '/T', '/F'], { stdio: 'ignore' })
    return
  }
  child.kill('SIGTERM')
}

async function waitForServer() {
  const started = Date.now()
  while (Date.now() - started < 45000) {
    try {
      const response = await fetch(baseUrl)
      if (response.ok) return
    } catch {
      await sleep(500)
    }
  }
  throw new Error(`Timed out waiting for Vite dev server at ${baseUrl}`)
}

async function getPlayer(page) {
  const player = await page.evaluate(() => window.__REALCITY_STORE__?.getState().player || null)
  assert(player, 'Dev verification store was not exposed')
  return player
}

async function getTaxiRouteState(page) {
  return page.evaluate(() => {
    const state = window.__REALCITY_STORE__?.getState()
    const city = window.__REALCITY_CITY__
    const mission = state?.mission
    const ride = state?.ride
    const angleDiff = (a, b) => Math.atan2(Math.sin(a - b), Math.cos(a - b))
    const pathTurns = (points = []) => {
      let turns = 0
      let previousAxis = null
      for (let i = 1; i < points.length; i += 1) {
        const a = points[i - 1]
        const b = points[i]
        const axis = Math.abs(a.x - b.x) >= Math.abs(a.z - b.z) ? 'x' : 'z'
        if (previousAxis && axis !== previousAxis) turns += 1
        previousAxis = axis
      }
      return turns
    }
    const maxHeadingDelta = (points = []) => {
      const routeMeters = (points = []) => {
        let meters = 0
        for (let i = 1; i < points.length; i += 1) {
          meters += Math.hypot(points[i].x - points[i - 1].x, points[i].z - points[i - 1].z)
        }
        return meters
      }
      const positionAt = (meters) => {
        const total = Math.max(0.001, routeMeters(points))
        let remaining = Math.max(0, Math.min(total, meters))
        for (let i = 1; i < points.length; i += 1) {
          const a = points[i - 1]
          const b = points[i]
          const segment = Math.hypot(b.x - a.x, b.z - a.z)
          if (segment <= 0.001) continue
          if (remaining <= segment || i === points.length - 1) {
            const t = Math.max(0, Math.min(1, remaining / segment))
            return { x: a.x + (b.x - a.x) * t, z: a.z + (b.z - a.z) * t }
          }
          remaining -= segment
        }
        return points[points.length - 1] || { x: 0, z: 0 }
      }
      if (points.length < 2) return 0
      const total = routeMeters(points)
      const lookDistance = Math.min(6, Math.max(2.4, total * 0.012))
      let previous = null
      let max = 0
      for (let distance = 0; distance <= total; distance += 2) {
        const behind = positionAt(Math.max(0, distance - lookDistance))
        const ahead = positionAt(Math.min(total, distance + lookDistance))
        const heading = Math.atan2(ahead.x - behind.x, ahead.z - behind.z)
        if (previous !== null) max = Math.max(max, Math.abs(angleDiff(heading, previous)))
        previous = heading
      }
      return max
    }
    const nearestRoad = (point) => {
      if (!point || !city?.roads?.length) return null
      const linked = point.roadId ? city.roads.find(road => road.id === point.roadId) : null
      if (linked) return linked
      return city.roads
        .map(road => ({
          road,
          distance: road.axis === 'x'
            ? Math.abs(point.z - road.z)
            : Math.abs(point.x - road.x),
        }))
        .sort((a, b) => a.distance - b.distance)[0]?.road || null
    }
    const roadStatus = (point) => {
      const road = nearestRoad(point)
      if (!point || !road) return null
      const offset = road.axis === 'x' ? Math.abs(point.z - road.z) : Math.abs(point.x - road.x)
      return {
        roadName: road.name,
        offset,
        halfWidth: road.width / 2,
        insideRoad: offset <= road.width / 2 - 0.35,
        outsideRoad: offset >= road.width / 2 + 0.35,
        laneLike: offset > road.width * 0.14 && offset < road.width * 0.42,
      }
    }
    const laneStats = (points = []) => {
      const samples = []
      for (let i = 1; i < points.length; i += 1) {
        const a = points[i - 1]
        const b = points[i]
        const length = Math.hypot(a.x - b.x, a.z - b.z)
        if (length < 6) continue
        samples.push(roadStatus({ x: (a.x + b.x) / 2, z: (a.z + b.z) / 2, roadId: a.roadId === b.roadId ? a.roadId : null }))
      }
      const filtered = samples
        .filter(Boolean)
      return {
        samples: filtered.length,
        laneLike: filtered.filter(sample => sample.laneLike).length,
        centerline: filtered.filter(sample => sample.offset < 1.2).length,
      }
    }
    const activeRoute = ride?.path || mission?.taxi?.destinationPath || mission?.route || mission?.taxi?.path || []
    return {
      missionPhase: mission?.phase || null,
      dispatchPathPoints: mission?.taxi?.path?.length || 0,
      destinationPathPoints: mission?.taxi?.destinationPath?.length || mission?.route?.length || 0,
      ridePathPoints: ride?.path?.length || 0,
      dispatchMeters: mission?.taxi?.routeMeters || 0,
      destinationMeters: mission?.taxi?.destinationMeters || 0,
      routeMeters: ride?.routeMeters || (mission?.phase === 'taxi_dispatch' ? mission?.taxi?.routeMeters : mission?.taxi?.destinationMeters) || mission?.taxi?.routeMeters || 0,
      directMeters: mission?.taxi?.directMeters || 0,
      dispatchTurns: pathTurns(mission?.taxi?.path),
      destinationTurns: pathTurns(ride?.path || mission?.taxi?.destinationPath || mission?.route),
      dispatchMaxHeadingDelta: maxHeadingDelta(mission?.taxi?.path),
      destinationMaxHeadingDelta: maxHeadingDelta(activeRoute),
      dispatchLaneStats: laneStats(mission?.taxi?.path),
      destinationLaneStats: laneStats(activeRoute),
      taxiPose: ride?.taxiPose || mission?.taxi?.pose || null,
      taxiSpeed: mission?.taxi?.speed || null,
      taxiSource: mission?.taxi?.source || ride?.taxiSource || null,
      fleetCarId: mission?.taxi?.fleetCarId || ride?.taxiId || null,
      driverName: mission?.taxi?.driverName || null,
      dispatchDistanceFromCruise: mission?.taxi?.dispatchDistanceFromCruise || 0,
      boardingRequested: !!mission?.boardingRequested,
      boardingStartedAt: mission?.boardingStartedAt || 0,
      pickupStop: mission?.taxi?.pickupStop || null,
      passengerPickup: mission?.taxi?.passengerPickup || mission?.pickup || null,
      pickupStopRoadStatus: roadStatus(mission?.taxi?.pickupStop),
      passengerPickupRoadStatus: roadStatus(mission?.taxi?.passengerPickup || mission?.pickup),
      dropoffStop: mission?.taxi?.dropoffStop || null,
      rideExitPoint: ride?.exitPoint || null,
      assignedVehicleSamples: (state?.vehicleSamples || []).filter(sample => sample.assignment).length,
      taxiLoopSamples: (state?.vehicleSamples || []).filter(sample => sample.kind === 'taxi' && sample.routeMode === 'city-ring-loop').length,
      taxiRoutePointSamples: (state?.vehicleSamples || []).filter(sample => sample.kind === 'taxi' && sample.cruiseRoutePoints >= 8).length,
      rideDuration: ride?.duration || 0,
      rideProgress: ride?.progress || 0,
    }
  })
}

async function inspectCanvas(page, options = {}) {
  const minWidth = options.minWidth ?? 600
  const minHeight = options.minHeight ?? 400
  const minDataUrlLength = options.minDataUrlLength ?? 20000
  const canvases = await page.evaluate(() => Array.from(document.querySelectorAll('canvas')).map((canvas, index) => {
    const rect = canvas.getBoundingClientRect()
    let dataUrlLength = 0
    let sampleError = null
    try {
      dataUrlLength = canvas.toDataURL('image/png').length
    } catch (error) {
      sampleError = error instanceof Error ? error.message : String(error)
    }
    return {
      index,
      width: canvas.width,
      height: canvas.height,
      clientWidth: Math.round(rect.width),
      clientHeight: Math.round(rect.height),
      dataUrlLength,
      sampleError,
    }
  }))

  const largest = [...canvases].sort((a, b) => (b.width * b.height) - (a.width * a.height))[0]
  assert(largest, 'No canvas was rendered')
  assert(largest.width >= minWidth && largest.height >= minHeight, `Main canvas is too small: ${largest.width}x${largest.height}`)
  assert(!largest.sampleError, `Canvas pixel sample failed: ${largest.sampleError}`)
  assert(largest.dataUrlLength > minDataUrlLength, `Canvas appears blank or too small: data URL length ${largest.dataUrlLength}`)
  return { canvases, largest }
}

async function inspectLandmarkInteriors(page) {
  const interiors = await page.evaluate(() => {
    const city = window.__REALCITY_CITY__
    if (!city) return null
    return city.landmarks
      .filter(place => place.kind !== 'park')
      .map(place => ({
        id: place.id,
        name: place.name,
        kind: place.kind,
        hasInterior: !!place.interior,
        solidWalls: !!place.interior?.solidWalls,
        doorWidth: place.interior?.doorWidth || 0,
        verticalCore: place.interior?.verticalCore || '',
        floorCount: place.interior?.floorCount || 0,
        lobbyZones: place.interior?.lobbyZones?.length || 0,
        floorDirectory: place.interior?.floorDirectory?.length || 0,
        floorDirectoryComplete: (place.interior?.floorDirectory || []).every(entry => entry.level > 0 && entry.label && entry.zone && entry.access && entry.core && entry.guide),
      }))
  })
  assert(Array.isArray(interiors), 'City metadata was not exposed for interior verification')
  assert(interiors.length >= 8, 'Expected landmark interiors for most named buildings')
  const broken = interiors.filter(item => !item.hasInterior || !item.solidWalls || item.doorWidth <= 0 || !item.verticalCore || item.floorCount <= 0 || item.lobbyZones < 3 || item.floorDirectory !== item.floorCount || !item.floorDirectoryComplete)
  assert(broken.length === 0, `Incomplete landmark interiors: ${broken.map(item => item.id).join(', ')}`)
  return interiors
}

async function inspectCityNorms(page) {
  const norms = await page.evaluate(() => {
    const city = window.__REALCITY_CITY__
    if (!city) return null
    const formKeys = buildings => [...new Set(buildings.map(building => building.form?.profile).filter(Boolean))]
    const roofKeys = buildings => [...new Set(buildings.map(building => building.form?.roof).filter(Boolean))]
    const houses = city.buildings.filter(building => building.type === 'house')
    const rectsOverlap = (a, b) => a.minX <= b.maxX && a.maxX >= b.minX && a.minZ <= b.maxZ && a.maxZ >= b.minZ
    const roadRect = (road, margin = 0) => road.axis === 'x'
      ? { minX: road.from - margin, maxX: road.to + margin, minZ: road.z - road.width / 2 - margin, maxZ: road.z + road.width / 2 + margin }
      : { minX: road.x - road.width / 2 - margin, maxX: road.x + road.width / 2 + margin, minZ: road.from - margin, maxZ: road.to + margin }
    const envelopeRect = item => {
      const width = item.zoning?.envelopeW || item.footprint?.width || item.w || 0
      const depth = item.zoning?.envelopeD || item.footprint?.depth || item.d || 0
      return {
        minX: item.x - width / 2,
        maxX: item.x + width / 2,
        minZ: item.z - depth / 2,
        maxZ: item.z + depth / 2,
      }
    }
    const insideZone = item => {
      const zone = item.zoning?.buildable
      if (!zone) return false
      const rect = envelopeRect(item)
      return rect.minX >= zone.minX - 0.01 && rect.maxX <= zone.maxX + 0.01 && rect.minZ >= zone.minZ - 0.01 && rect.maxZ <= zone.maxZ + 0.01
    }
    const laneViolations = city.cars.filter(car => {
      const expectedOffset = car.road.width * (car.road.main ? 0.27 : 0.22)
      const expectedLane = car.road.axis === 'x' ? car.direction * expectedOffset : -car.direction * expectedOffset
      return car.laneRule !== 'right-hand' || Math.abs(car.lane - expectedLane) > 0.01
    })
    const buildingRoadConflicts = city.buildings.filter(building => city.roads.some(road => rectsOverlap(envelopeRect(building), roadRect(road, 0.35))))
    const landmarkRoadConflicts = city.landmarks.filter(place => city.roads.some(road => rectsOverlap(envelopeRect(place), roadRect(road, 0.35))))
    const buildingZoningReady = city.buildings.filter(building => building.zoning?.roadSetback >= 8 && insideZone(building))
    const landmarkZoningReady = city.landmarks.filter(place => place.zoning?.roadSetback >= 8 && insideZone(place))
    const fourSidedFacades = city.buildings.filter(building => ['north', 'south', 'east', 'west'].every(face => building.facadePlan?.faces?.[face]?.hasWindows))
    const coherentFacades = city.buildings.filter(building =>
      building.facadePlan?.coherence?.frontBackLinked &&
      building.facadePlan?.coherence?.sideFacesBalanced &&
      ['north', 'south', 'east', 'west'].every(face => building.facadePlan?.faces?.[face]?.role && building.facadePlan?.faces?.[face]?.pairedWith)
    )
    const stableBalconies = city.buildings.filter(building =>
      building.type !== 'apartment' ||
      ['stacked-centered', 'paired-balanced', 'corner-return'].includes(building.facadePlan?.balconyPattern)
    )
    const entryFaces = new Set(city.buildings.map(building => building.facadePlan?.entryFace).filter(Boolean))
    const buildingInteriors = city.buildings.filter(building => building.interior?.solidWalls && building.interior?.floors >= 1 && building.interior?.lobbyDepth > 0 && building.interior?.verticalCore && Array.isArray(building.interior?.zones) && building.interior.zones.length >= 4)
    const buildingFloorDirectories = city.buildings.filter(building =>
      Array.isArray(building.interior?.floorDirectory) &&
      building.interior.floorDirectory.length === building.interior.floors &&
      building.interior.floorDirectory.every(entry => entry.level > 0 && entry.label && entry.zone && entry.access && entry.core && entry.guide)
    )
    const entryPortals = city.buildings.filter(building => building.interior?.entryPortal?.rule === 'pass-through-door-only' && building.interior?.entryPortal?.width > 0 && building.interior?.entryPortal?.face === building.facadePlan?.entryFace)
    const floorNavigation = city.buildings.filter(building => building.interior?.floorNavigation?.method === building.interior?.verticalCore && building.interior?.floorNavigation?.reachableFloors === building.interior?.floors)
    const interiorCoreTypes = new Set(city.buildings.map(building => building.interior?.verticalCore).filter(Boolean))
    const corridorTypes = new Set(city.buildings.map(building => building.interior?.corridorType).filter(Boolean))
    const carBodyStyles = new Set(city.cars.map(car => car.bodyStyle).filter(Boolean))
    const detailedCars = city.cars.filter(car => car.dimensions?.width > 0 && car.dimensions?.length > 0 && car.dimensions?.cabinLength > 0)
    const appearanceReady = city.npcs.filter(npc => npc.appearance?.heightScale && npc.appearance?.topColor && npc.appearance?.hairStyle)
    const heightVariants = new Set(city.npcs.map(npc => npc.appearance?.heightScale?.toFixed(2)).filter(Boolean))
    const fashionVariants = new Set(city.npcs.map(npc => `${npc.appearance?.topColor}:${npc.appearance?.jacketColor}:${npc.appearance?.bottomStyle}:${npc.appearance?.hatStyle}`))
    const uniqueNames = new Set(city.npcs.map(npc => npc.name).filter(Boolean))
    const appearanceSignatures = new Set(city.npcs.map(npc => npc.appearance?.signature).filter(Boolean))
    const outfitSignatures = new Set(city.npcs.map(npc => `${npc.appearance?.outerwear}:${npc.appearance?.outfitPattern}:${npc.appearance?.topColor}:${npc.appearance?.jacketColor}:${npc.appearance?.pantsColor}:${npc.appearance?.accessory}`).filter(Boolean))
    const speechStyleVariants = new Set(city.npcs.map(npc => npc.speechStyle?.id).filter(Boolean))
    const personaSignatures = new Set(city.npcs.map(npc => npc.personaSignature).filter(Boolean))
    const skinVariants = new Set(city.npcs.map(npc => npc.appearance?.skinColor).filter(Boolean))
    const hairVariants = new Set(city.npcs.map(npc => npc.appearance?.hairColor).filter(Boolean))
    const bodyArchetypes = new Set(city.npcs.map(npc => npc.appearance?.bodyArchetype).filter(Boolean))
    const walkStyles = new Set(city.npcs.map(npc => npc.appearance?.walkStyle?.id).filter(Boolean))
    const accessoryVariants = new Set(city.npcs.map(npc => npc.appearance?.accessory).filter(Boolean))
    const autonomyReady = city.npcs.filter(npc =>
      npc.autonomy?.dailyGoal &&
      npc.autonomy?.relationshipStyle &&
      npc.autonomy?.memoryStyle &&
      typeof npc.autonomy?.routineTolerance === 'number' &&
      ['energy', 'hunger', 'social', 'urgency'].every(key => typeof npc.autonomy?.needProfile?.[key] === 'number')
    )
    const autonomyGoals = new Set(city.npcs.map(npc => npc.autonomy?.dailyGoal).filter(Boolean))
    const relationshipStyles = new Set(city.npcs.map(npc => npc.autonomy?.relationshipStyle).filter(Boolean))
    const treeRoadConflicts = city.trees.filter(tree => city.roads.some(road => {
      if (road.axis === 'x') return tree.x >= road.from - 3 && tree.x <= road.to + 3 && Math.abs(tree.z - road.z) <= road.width / 2 + 5
      return tree.z >= road.from - 3 && tree.z <= road.to + 3 && Math.abs(tree.x - road.x) <= road.width / 2 + 5
    }))
    return {
      roads: city.roads.length,
      buildingCount: city.buildings.length,
      landmarkCount: city.landmarks.length,
      namedRoads: city.roads.filter(road => road.name).length,
      landmarkAddresses: city.landmarks.filter(place => place.address && place.roadName).length,
      buildingAddresses: city.buildings.filter(building => building.address && building.roadName).length,
      addressBookEntries: (city.addressBook || []).filter(place => place.address && place.roadName && typeof place.x === 'number' && typeof place.z === 'number').length,
      buildingRoadConflicts: buildingRoadConflicts.length,
      landmarkRoadConflicts: landmarkRoadConflicts.length,
      landmarkRoadConflictIds: landmarkRoadConflicts.map(place => place.id),
      buildingZoningReady: buildingZoningReady.length,
      landmarkZoningReady: landmarkZoningReady.length,
      fourSidedFacades: fourSidedFacades.length,
      coherentFacades: coherentFacades.length,
      stableBalconies: stableBalconies.length,
      entryFaceVariants: entryFaces.size,
      buildingInteriors: buildingInteriors.length,
      buildingFloorDirectories: buildingFloorDirectories.length,
      entryPortals: entryPortals.length,
      floorNavigation: floorNavigation.length,
      interiorCoreTypes: interiorCoreTypes.size,
      corridorTypes: corridorTypes.size,
      buildingProfiles: formKeys(city.buildings),
      houseProfiles: formKeys(houses),
      houseRoofs: roofKeys(houses),
      houseAccessoryCount: houses.filter(building => building.form?.porch || building.form?.garage || building.form?.chimney || building.form?.wing).length,
      laneViolations: laneViolations.length,
      carBodyStyles: carBodyStyles.size,
      detailedCars: detailedCars.length,
      appearanceReady: appearanceReady.length,
      npcCount: city.npcs.length,
      heightVariants: heightVariants.size,
      fashionVariants: fashionVariants.size,
      uniqueNames: uniqueNames.size,
      appearanceSignatures: appearanceSignatures.size,
      outfitSignatures: outfitSignatures.size,
      speechStyleVariants: speechStyleVariants.size,
      personaSignatures: personaSignatures.size,
      skinVariants: skinVariants.size,
      hairVariants: hairVariants.size,
      bodyArchetypes: bodyArchetypes.size,
      walkStyles: walkStyles.size,
      accessoryVariants: accessoryVariants.size,
      autonomyReady: autonomyReady.length,
      autonomyGoals: autonomyGoals.size,
      relationshipStyles: relationshipStyles.size,
      treeRoadConflicts: treeRoadConflicts.length,
      socialNorms: city.socialNorms,
      trafficRules: city.trafficRules,
    }
  })
  assert(norms, 'City metadata was not exposed for norm verification')
  assert(norms.namedRoads === norms.roads, 'Not every road has a street name')
  assert(norms.landmarkAddresses >= 9, 'Landmarks did not receive road-name addresses')
  assert(norms.buildingAddresses > 100, 'Buildings did not receive road-name addresses')
  assert(norms.addressBookEntries > 100, 'Address book did not expose routable street addresses')
  assert(norms.buildingZoningReady === norms.buildingCount, 'Building zoning metadata is incomplete or outside buildable envelopes')
  assert(norms.landmarkZoningReady === norms.landmarkCount, 'Landmark zoning metadata is incomplete or outside buildable envelopes')
  assert(norms.fourSidedFacades === norms.buildingCount, 'Not every building exposes four-sided facade/window metadata')
  assert(norms.coherentFacades === norms.buildingCount, 'Building facade plans do not link front/rear/side faces coherently')
  assert(norms.stableBalconies === norms.buildingCount, 'Apartment balcony patterns are not using stable facade rules')
  assert(norms.entryFaceVariants >= 4, `Building entry faces do not vary enough: ${norms.entryFaceVariants}`)
  assert(norms.buildingInteriors === norms.buildingCount, 'Procedural building interior plans are incomplete')
  assert(norms.buildingFloorDirectories === norms.buildingCount, 'Procedural building floor directories are incomplete')
  assert(norms.entryPortals === norms.buildingCount, 'Procedural building entry portals are incomplete')
  assert(norms.floorNavigation === norms.buildingCount, 'Procedural floor navigation metadata is incomplete')
  assert(norms.interiorCoreTypes >= 3, `Building vertical core types are not diverse enough: ${norms.interiorCoreTypes}`)
  assert(norms.corridorTypes >= 4, `Building corridor/interior layouts are not diverse enough: ${norms.corridorTypes}`)
  assert(norms.buildingRoadConflicts === 0, `${norms.buildingRoadConflicts} buildings overlap road reserves`)
  assert(norms.landmarkRoadConflicts === 0, `${norms.landmarkRoadConflicts} landmarks overlap road reserves: ${norms.landmarkRoadConflictIds.join(', ')}`)
  assert(norms.buildingProfiles.length >= 12, `Building massing profiles are not diverse enough: ${norms.buildingProfiles.join(', ')}`)
  assert(norms.houseProfiles.length >= 4, `House profiles are not diverse enough: ${norms.houseProfiles.join(', ')}`)
  assert(norms.houseRoofs.length >= 3, `House roof styles are not diverse enough: ${norms.houseRoofs.join(', ')}`)
  assert(norms.houseAccessoryCount >= 20, 'Houses did not receive enough porches, garages, chimneys, or wings')
  assert(norms.laneViolations === 0, `${norms.laneViolations} cars violate right-hand lane placement`)
  assert(norms.trafficRules?.drivingSide === 'right-hand' && norms.trafficRules?.signals && norms.trafficRules?.followingDistance, 'Traffic rule metadata is incomplete')
  assert(norms.detailedCars === 120, 'Vehicle style/dimension metadata is incomplete')
  assert(norms.carBodyStyles >= 5, `Vehicle body style variation is too low: ${norms.carBodyStyles}`)
  assert(norms.appearanceReady === norms.npcCount, 'NPC appearance metadata is incomplete')
  assert(norms.heightVariants >= 8, `NPC height variation is too low: ${norms.heightVariants}`)
  assert(norms.fashionVariants >= 8, `NPC fashion variation is too low: ${norms.fashionVariants}`)
  assert(norms.uniqueNames === norms.npcCount, `NPC names are not unique enough: ${norms.uniqueNames}/${norms.npcCount}`)
  assert(norms.appearanceSignatures === norms.npcCount, `NPC appearance signatures are not unique enough: ${norms.appearanceSignatures}/${norms.npcCount}`)
  assert(norms.personaSignatures === norms.npcCount, `NPC persona signatures are not unique enough: ${norms.personaSignatures}/${norms.npcCount}`)
  assert(norms.outfitSignatures >= 120, `NPC outfit variation is too low: ${norms.outfitSignatures}`)
  assert(norms.speechStyleVariants >= 9, `NPC speech style variation is too low: ${norms.speechStyleVariants}`)
  assert(norms.bodyArchetypes >= 7, `NPC body archetype variation is too low: ${norms.bodyArchetypes}`)
  assert(norms.walkStyles >= 7, `NPC walking style variation is too low: ${norms.walkStyles}`)
  assert(norms.skinVariants >= 8, `NPC skin tone variation is too low: ${norms.skinVariants}`)
  assert(norms.hairVariants >= 8, `NPC hair tone variation is too low: ${norms.hairVariants}`)
  assert(norms.accessoryVariants >= 7, `NPC accessory variation is too low: ${norms.accessoryVariants}`)
  assert(norms.autonomyReady === norms.npcCount, `NPC autonomy metadata is incomplete: ${norms.autonomyReady}/${norms.npcCount}`)
  assert(norms.autonomyGoals >= 20, `NPC daily goal variation is too low: ${norms.autonomyGoals}`)
  assert(norms.relationshipStyles >= 6, `NPC relationship style variation is too low: ${norms.relationshipStyles}`)
  assert(norms.treeRoadConflicts === 0, `${norms.treeRoadConflicts} trees overlap road reserves`)
  assert(norms.socialNorms?.pedestrian && norms.socialNorms?.traffic && norms.socialNorms?.addressSystem && norms.socialNorms?.zoning && norms.socialNorms?.npcDiversity && norms.socialNorms?.npcAutonomy && norms.socialNorms?.npcMobility && norms.socialNorms?.humanReactions && norms.socialNorms?.collision && norms.socialNorms?.streetHierarchy && norms.socialNorms?.facadeSystem, 'Social norm metadata is incomplete')
  return norms
}

async function inspectSupportUX(page) {
  await page.locator('.prompt-stack').waitFor({ state: 'visible', timeout: 10000 })
  const promptText = await page.locator('.prompt-stack').innerText({ timeout: 5000 })
  assert(promptText.includes('Taxi') && promptText.includes('Map') && promptText.includes('Phone'), `Context prompt actions are incomplete: ${promptText}`)
  assert(promptText.includes('Hail') && promptText.includes('W/S') && promptText.includes('A/D') && promptText.includes('Space') && promptText.includes('H/F'), `Movement guide is incomplete: ${promptText}`)
  assertReadableText('Context prompt', promptText)

  await dispatchKey(page, 'KeyT', 'keydown')
  await dispatchKey(page, 'KeyT', 'keyup')
  await page.locator('.phone-device').waitFor({ state: 'visible', timeout: 10000 })
  const taxiText = await page.locator('.phone-device').innerText({ timeout: 5000 })
  assert(taxiText.includes('Taxi') && await page.locator('.phone-route-list button').count() > 0, `T key did not open the phone taxi app: ${taxiText}`)
  assertReadableText('Phone taxi shortcut', taxiText)
  await page.locator('.phone-close').click()
  await page.locator('.phone-device').waitFor({ state: 'hidden', timeout: 10000 })

  return {
    prompt: promptText.split(/\r?\n/).slice(0, 16),
    taxiShortcut: taxiText.split(/\r?\n/).slice(0, 12),
  }
}

async function inspectMapCoordinateResilience(page) {
  const result = await page.evaluate(() => {
    const store = window.__REALCITY_STORE__?.getState()
    const city = window.__REALCITY_CITY__
    if (!store || !city) return null
    const original = { ...store.player }
    const badLngLat = city.worldToLngLat(Number.NaN, Number.NaN)
    store.setPlayer({
      ...original,
      x: Number.NaN,
      y: Number.NaN,
      z: Number.NaN,
      heading: Number.NaN,
      viewHeading: Number.NaN,
      speed: Number.NaN,
    })
    const afterBadSet = { ...window.__REALCITY_STORE__.getState().player }
    store.setPlayer(original)
    return {
      badLngLat,
      original: {
        x: original.x,
        y: original.y,
        z: original.z,
        heading: original.heading,
        viewHeading: original.viewHeading,
        speed: original.speed,
      },
      afterBadSet: {
        x: afterBadSet.x,
        y: afterBadSet.y,
        z: afterBadSet.z,
        heading: afterBadSet.heading,
        viewHeading: afterBadSet.viewHeading,
        speed: afterBadSet.speed,
      },
    }
  })
  assert(result, 'Map coordinate resilience hooks were unavailable')
  assert(result.badLngLat.every(Number.isFinite), `worldToLngLat did not sanitize NaN input: ${JSON.stringify(result)}`)
  assert(Object.values(result.afterBadSet).every(value => Number.isFinite(Number(value))), `Player state accepted NaN coordinates: ${JSON.stringify(result)}`)

  await page.locator('.map-shell').click()
  await page.locator('.full-map-panel').waitFor({ state: 'visible', timeout: 10000 })
  await page.locator('.full-map-header button').click()
  await page.locator('.full-map-panel').waitFor({ state: 'hidden', timeout: 10000 })
  return result
}

async function inspectActorRendering(page) {
  await page.waitForFunction(() => {
    const actor = window.__REALCITY_ACTOR_RENDERING__
    return actor?.npcBase === 'player-avatar-shared-humanoid' &&
      actor.bodyParts?.includes('hips') &&
      actor.bodyParts?.includes('hairBack') &&
      actor.bodyParts?.includes('faceMarks') &&
      actor.bodyParts?.includes('lapels') &&
      actor.socialVisualCues?.speechCueInstances === actor.variation?.count &&
      actor.variation?.count > 100
  }, null, { timeout: 15000 })

  const actor = await page.evaluate(() => window.__REALCITY_ACTOR_RENDERING__ || null)
  assert(actor, 'Actor rendering metadata was not exposed')
  assert(actor.playerReference === 'PlayerRig.Character', `NPCs are not tied to the player avatar base: ${actor.playerReference}`)
  assert(actor.rigScale?.torsoCapsuleTotalHeight === 0.94, 'NPC torso was not matched to the player avatar torso capsule')
  assert(actor.rigScale?.armCapsuleTotalHeight === 0.53, 'NPC arm capsule proportions do not match the player avatar')
  assert(actor.rigScale?.legCapsuleTotalHeight === 0.65, 'NPC leg capsule proportions do not match the player avatar')
  assert(['hips', 'torso', 'chest', 'neck', 'head', 'hairCap', 'hairBack', 'ears', 'eyes', 'brows', 'nose', 'mouth', 'faceMarks', 'cheeks', 'arms', 'hands', 'legs', 'shoes', 'collar', 'lapels', 'badge', 'cuffs'].every(part => actor.bodyParts.includes(part)), `NPC humanoid body parts are incomplete: ${actor.bodyParts.join(', ')}`)
  assert(['speechCue', 'phoneProp', 'gestureCue'].every(part => actor.bodyParts.includes(part)), `NPC social rendering cues are incomplete: ${actor.bodyParts.join(', ')}`)
  assert(actor.socialVisualCues?.speechCueInstances === actor.variation.count && actor.socialVisualCues?.phonePropInstances === actor.variation.count, `NPC social cue instances do not match actor count: ${JSON.stringify(actor.socialVisualCues)}`)
  assert(actor.socialVisualCues?.gestureStyleVariants >= 8 && actor.socialVisualCues?.partnerFacingRule, `NPC social gesture metadata is incomplete: ${JSON.stringify(actor.socialVisualCues)}`)
  assert(['collar', 'lapels', 'cheeks', 'front badge', 'pant cuffs'].every(part => actor.streetReadableDetails?.includes(part)), `NPC street-readable detail metadata is incomplete: ${(actor.streetReadableDetails || []).join(', ')}`)
  assert(actor.variation.heightVariants >= 8, `NPC height variation is too low in actor rendering: ${actor.variation.heightVariants}`)
  assert(actor.variation.bodyVariants >= 7, `NPC body type variation is too low in actor rendering: ${actor.variation.bodyVariants}`)
  assert(actor.variation.ageBands >= 3 && actor.variation.ages >= 40, `NPC age variation is too low in actor rendering: ${JSON.stringify(actor.variation)}`)
  assert(actor.variation.hairStyles >= 5, `NPC hair style variation is too low in actor rendering: ${actor.variation.hairStyles}`)
  assert(actor.variation.outfitSignatures >= 120, `NPC outfit variation is too low in actor rendering: ${actor.variation.outfitSignatures}`)
  assert(actor.samplePeople?.length >= 10 && actor.samplePeople.every(person => person.name && person.age && person.hairStyle && person.outfit), 'NPC actor samples do not expose person-like identity and style')
  const readablePrefixes = ['네.', '좋아요.', '간단히 말하면,', '확인했습니다.', '좋죠.', '음,', '바로 보면,', '확인해볼게요.', '좋지.', '가능합니다.']
  assert(actor.speechSamples?.length >= 10, 'NPC speech style samples were not exposed')
  assert(actor.speechSamples.every(sample => readablePrefixes.includes(sample.prefix)), `NPC speech prefixes are not readable Korean: ${JSON.stringify(actor.speechSamples)}`)
  assert(actor.speechSamples.every(sample => !BROKEN_TEXT_PATTERN.test(`${sample.prefix} ${sample.flavor}`)), `NPC speech style samples contain mojibake: ${JSON.stringify(actor.speechSamples)}`)
  return actor
}

async function inspectMultiplayer(page) {
  await page.locator('.multiplayer-panel').waitFor({ state: 'visible', timeout: 10000 })
  const panelText = await page.locator('.multiplayer-panel').innerText({ timeout: 5000 })
  assert(panelText.includes('Multiplayer') && panelText.includes('Join Server'), `Multiplayer join panel is missing: ${panelText}`)
  assert(/invite link/i.test(panelText) && panelText.includes('room='), `Multiplayer invite link is missing from the join panel: ${panelText}`)

  const seeded = await page.evaluate(async () => {
    const roomId = `verify-${Date.now()}`
    const post = async (playerId, name, x, z, color) => {
      const response = await fetch('/api/multiplayer', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          roomId,
          playerId,
          name,
          color,
          pose: { x, y: 1.1, z, heading: 0.45, speed: 0, district: 'Verification' },
        }),
      })
      return response.json()
    }
    await post('verify_peer_b', 'Verifier B', 24, 48, '#ffb703')
    const self = await post('verify_peer_a', 'Verifier A', 0, 40, '#4aadff')
    window.__REALCITY_STORE__?.getState().setMultiplayerIdentity({
      playerId: 'verify_peer_a',
      name: 'Verifier A',
      roomId,
      color: '#4aadff',
    })
    window.__REALCITY_STORE__?.getState().setMultiplayerEnabled(true)
    return { roomId, apiPeers: self.peers.map(peer => peer.id), playerCount: self.playerCount }
  })

  assert(seeded.apiPeers.includes('verify_peer_b') && seeded.playerCount >= 2, `Multiplayer API did not return seeded peer: ${JSON.stringify(seeded)}`)
  await page.waitForFunction(() => {
    const state = window.__REALCITY_STORE__?.getState()
    return state?.multiplayer?.status === 'online' &&
      state.multiplayer.peers.some(peer => peer.id === 'verify_peer_b') &&
      window.__REALCITY_MULTIPLAYER__?.peerCount >= 1
  }, null, { timeout: 15000 })

  const state = await page.evaluate(async (roomId) => {
    const multiplayer = window.__REALCITY_STORE__?.getState().multiplayer
    const rendering = window.__REALCITY_MULTIPLAYER__
    for (const playerId of ['verify_peer_a', 'verify_peer_b']) {
      await fetch('/api/multiplayer', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'leave', roomId, playerId }),
      })
    }
    window.__REALCITY_STORE__?.getState().setMultiplayerEnabled(false)
    return {
      status: multiplayer?.status,
      roomId: multiplayer?.roomId,
      playerCount: multiplayer?.playerCount,
      peers: multiplayer?.peers?.map(peer => ({ id: peer.id, name: peer.name, x: peer.x, z: peer.z })),
      rendering,
    }
  }, seeded.roomId)

  assert(state.peers.some(peer => peer.id === 'verify_peer_b' && Number.isFinite(peer.x) && Number.isFinite(peer.z)), `Multiplayer peer pose was not synchronized: ${JSON.stringify(state)}`)
  assert(state.rendering?.remoteAvatarBase === 'player-avatar-shared-humanoid', `Remote multiplayer avatars are not using the shared humanoid base: ${JSON.stringify(state.rendering)}`)
  assert(state.rendering?.renderMode === 'smoothed-nameplate-peer-avatar', `Remote multiplayer avatars are missing smoothing/nameplate metadata: ${JSON.stringify(state.rendering)}`)

  const inviteRoom = `invite-${Date.now()}`
  await page.goto(`${baseUrl}/?room=${inviteRoom}&mp=1&name=Invite%20Guest`, { waitUntil: 'domcontentloaded', timeout: 45000 })
  await page.locator('canvas').first().waitFor({ state: 'visible', timeout: 30000 })
  await page.waitForFunction((roomId) => {
      const state = window.__REALCITY_STORE__?.getState()
      return state?.multiplayer?.enabled &&
        state.multiplayer.roomId === roomId &&
        state.multiplayer.name === 'Invite Guest' &&
        state.multiplayer.status === 'online' &&
        window.__REALCITY_MULTIPLAYER__?.enabled === true
  }, inviteRoom, { timeout: 18000 })
  const inviteState = await page.evaluate(async (roomId) => {
    const state = window.__REALCITY_STORE__?.getState()
    const panelText = document.querySelector('.multiplayer-panel')?.textContent || ''
    await fetch('/api/multiplayer', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'leave', roomId, playerId: state.multiplayer.playerId }),
    })
    window.__REALCITY_STORE__?.getState().setMultiplayerEnabled(false)
    return {
      enabled: state.multiplayer.enabled,
      roomId: state.multiplayer.roomId,
      name: state.multiplayer.name,
      status: state.multiplayer.status,
      panelHasInvite: /invite link/i.test(panelText) && panelText.includes(roomId),
      urlHasInvite: window.location.search.includes(`room=${roomId}`) && window.location.search.includes('mp=1'),
    }
  }, inviteRoom)
  assert(inviteState.enabled && inviteState.roomId === inviteRoom && inviteState.name === 'Invite Guest' && inviteState.status === 'online', `Invite URL did not auto-join the requested room: ${JSON.stringify(inviteState)}`)
  assert(inviteState.panelHasInvite && inviteState.urlHasInvite, `Invite URL or panel did not expose the shareable room link: ${JSON.stringify(inviteState)}`)

  await page.goto(baseUrl, { waitUntil: 'domcontentloaded', timeout: 45000 })
  await page.locator('canvas').first().waitFor({ state: 'visible', timeout: 30000 })
  await page.waitForTimeout(1200)
  return { panel: panelText.split(/\r?\n/).slice(0, 10), seeded, state, inviteState }
}

async function inspectPhone(page) {
  await page.locator('.phone-toggle').click()
  await page.locator('.phone-device').waitFor({ state: 'visible', timeout: 10000 })
  await page.locator('.phone-tabs button[data-tab="messages"]').click()
  const homeText = await page.locator('.phone-device').innerText({ timeout: 5000 })
  assert(homeText.includes('RealPhone'), 'Phone shell did not open')
  assert(homeText.includes('Msg') && homeText.includes('People') && homeText.includes('Feed') && homeText.includes('Taxi') && homeText.includes('Music'), 'Phone app tabs were missing')
  assert(await page.locator('.phone-message-form input').count() === 1, 'Phone message composer was missing')
  assertReadableText('Phone message app', homeText)

  await page.locator('.phone-tabs button[data-tab="contacts"]').click()
  const contactsText = await page.locator('.phone-device').innerText({ timeout: 5000 })
  assert(contactsText.includes('Call'), 'Phone contacts did not expose calling')
  assertReadableText('Phone contacts app', contactsText)

  await page.locator('.phone-tabs button[data-tab="social"]').click()
  const socialText = await page.locator('.phone-device').innerText({ timeout: 5000 })
  assert(socialText.includes('Live city') && /routine|need|conversation|crosswalk|mobility|taxi/i.test(socialText), `Phone social feed did not expose live city autonomy events: ${socialText}`)
  assertReadableText('Phone social app', socialText)

  await page.locator('.phone-tabs button[data-tab="music"]').click()
  const musicText = await page.locator('.phone-device').innerText({ timeout: 5000 })
  assert(musicText.includes('Han River FM') && musicText.includes('Play'), 'Phone music app was incomplete')
  assertReadableText('Phone music app', musicText)

  await page.locator('.phone-tabs button[data-tab="taxi"]').click()
  const taxiText = await page.locator('.phone-device').innerText({ timeout: 5000 })
  assert(taxiText.includes('Taxi') && await page.locator('.phone-route-list button').count() > 0, 'Phone taxi app did not expose route targets')
  assert(taxiText.includes('RealCity Taxi') && taxiText.includes('Dispatches a cruising cab directly'), `Phone taxi app did not describe direct cab dispatch: ${taxiText}`)
  assert(taxiText.includes('no NPC relay') && taxiText.includes('Direct cab dispatch'), `Phone taxi app did not make direct taxi dispatch explicit: ${taxiText}`)
  assert(!taxiText.includes('Contact dispatch'), `Phone taxi app still exposes contact-mediated taxi dispatch: ${taxiText}`)
  assert(await page.locator('.phone-taxi .phone-route-list').count() === 1, 'Phone taxi app should expose only one direct dispatch route list')
  assertReadableText('Phone taxi app', taxiText)

  await page.locator('.phone-close').click()
  await page.locator('.phone-device').waitFor({ state: 'hidden', timeout: 10000 })
  return {
    home: homeText.split(/\r?\n/).slice(0, 12),
    contacts: contactsText.split(/\r?\n/).slice(0, 12),
    social: socialText.split(/\r?\n/).slice(0, 16),
    music: musicText.split(/\r?\n/).slice(0, 12),
    taxi: taxiText.split(/\r?\n/).slice(0, 12),
  }
}

async function inspectPhoneDirectTaxiDispatch(page) {
  await page.locator('.phone-toggle').click()
  await page.locator('.phone-device').waitFor({ state: 'visible', timeout: 10000 })
  await page.locator('.phone-tabs button[data-tab="taxi"]').click()
  await page.locator('.phone-taxi .phone-route-list button').first().click()
  await page.waitForFunction(() => {
    const mission = window.__REALCITY_STORE__?.getState()?.mission
    return mission?.source === 'player_taxi' &&
      mission.mode === 'taxi' &&
      !mission.agentId &&
      !mission.agentName &&
      mission.taxi?.path?.length >= 2
  }, null, { timeout: 15000 })

  const state = await page.evaluate(() => {
    const mission = window.__REALCITY_STORE__?.getState()?.mission
    return mission
      ? {
          source: mission.source,
          mode: mission.mode,
          phase: mission.phase,
          agentId: mission.agentId || null,
          agentName: mission.agentName || null,
          taxiPathPoints: mission.taxi?.path?.length || 0,
          summary: mission.summary,
        }
      : null
  })
  assert(state?.source === 'player_taxi' && !state.agentId && !state.agentName, `Phone Taxi dispatched through an NPC instead of direct cab dispatch: ${JSON.stringify(state)}`)
  await page.locator('.phone-close').click()
  await page.locator('.phone-device').waitFor({ state: 'hidden', timeout: 10000 })
  await page.evaluate(() => {
    const store = window.__REALCITY_STORE__?.getState()
    if (store?.mission?.source === 'player_taxi') store.finishMission('Phone taxi verification complete.')
  })
  return state
}

async function inspectPhoneSocialActions(page) {
  await page.evaluate(() => {
    const store = window.__REALCITY_STORE__?.getState()
    if (store?.mission) store.finishMission('Phone social verification reset.')
    store?.closeInteraction?.()
  })

  await page.locator('.phone-toggle').click()
  await page.locator('.phone-device').waitFor({ state: 'visible', timeout: 10000 })
  await page.locator('.phone-tabs button[data-tab="messages"]').click()
  const selectedName = (await page.locator('.phone-thread-title strong').innerText({ timeout: 5000 })).trim()
  assert(selectedName, 'Phone messages did not expose a selected contact')

  await page.locator('.phone-message-form input').fill('Where are you now?')
  await page.locator('.phone-message-form button').click()
  await page.waitForFunction(name => {
    const state = window.__REALCITY_STORE__?.getState()
    return state?.dialogue?.speaker === name &&
      (state.cityEvents || []).some(event => event.kind === 'phone' && event.agentName === name && event.topic === 'message')
  }, selectedName, { timeout: 10000 })
  const messageThread = await page.locator('.phone-bubbles').innerText({ timeout: 5000 })
  assert(messageThread.includes('Where are you now?'), `Phone message bubble was not rendered: ${messageThread}`)

  await page.locator('.phone-message-form input').fill('Call me a taxi to Central Station.')
  await page.locator('.phone-message-form button').click()
  await page.waitForFunction(() => {
    const state = window.__REALCITY_STORE__?.getState()
    return state?.mission?.source === 'player_taxi' &&
      state.mission.mode === 'taxi' &&
      !state.mission.agentId &&
      !state.mission.agentName &&
      /central station/i.test(state.mission.destination?.name || '')
  }, null, { timeout: 15000 })
  const directMessageTaxiState = await page.evaluate(() => {
    const state = window.__REALCITY_STORE__?.getState()
    const event = (state?.cityEvents || []).find(item => item.kind === 'mobility' && item.topic === 'phone taxi')
    return {
      source: state?.mission?.source || null,
      mode: state?.mission?.mode || null,
      agentId: state?.mission?.agentId || null,
      agentName: state?.mission?.agentName || null,
      destination: state?.mission?.destination?.name || null,
      eventText: event?.text || null,
    }
  })
  const directMessageThread = await page.locator('.phone-bubbles').innerText({ timeout: 5000 })
  assert(directMessageThread.includes('No contact or NPC relay'), `Phone message taxi intent did not stay direct: ${directMessageThread}`)
  assert(directMessageTaxiState.source === 'player_taxi' && !directMessageTaxiState.agentId && !directMessageTaxiState.agentName, `Phone message taxi intent used an NPC relay: ${JSON.stringify(directMessageTaxiState)}`)
  await page.evaluate(() => {
    const store = window.__REALCITY_STORE__?.getState()
    if (store?.mission?.source === 'player_taxi') store.finishMission('Phone message taxi verification reset.')
  })

  await page.locator('.phone-tabs button[data-tab="contacts"]').click()
  await page.locator('.phone-list article').first().locator('.phone-call-button').click()
  await page.waitForFunction(name => {
    const state = window.__REALCITY_STORE__?.getState()
    return state?.dialogue?.speaker === name &&
      (state.cityEvents || []).some(event => event.kind === 'phone' && event.agentName === name && event.topic === 'call')
  }, selectedName, { timeout: 10000 })
  const callState = await page.evaluate(name => {
    const state = window.__REALCITY_STORE__?.getState()
    const event = (state?.cityEvents || []).find(item => item.kind === 'phone' && item.agentName === name && item.topic === 'call')
    return { speaker: state?.dialogue?.speaker || null, eventText: event?.text || null }
  }, selectedName)

  await page.locator('.phone-tabs button[data-tab="messages"]').click()
  await page.locator('.phone-message-form input').fill('Please take me to your workplace. Use a taxi if it is far.')
  await page.locator('.phone-message-form button').click()
  await page.waitForFunction(name => {
    const state = window.__REALCITY_STORE__?.getState()
    return state?.mission?.agentName === name &&
      ['walk', 'taxi'].includes(state.mission.mode) &&
      !!state.mission.destination &&
      state.interaction?.agent?.name === name &&
      state.interaction?.status === 'active'
  }, selectedName, { timeout: 24000 })

  const routeState = await page.evaluate(name => {
    const state = window.__REALCITY_STORE__?.getState()
    const actionEvent = (state?.cityEvents || []).find(item => item.kind === 'phone' && item.agentName === name && item.topic === 'route request')
    return {
      selectedName: name,
      missionAgent: state?.mission?.agentName || null,
      missionMode: state?.mission?.mode || null,
      missionPhase: state?.mission?.phase || null,
      missionDestination: state?.mission?.destination?.name || state?.mission?.destination?.address || null,
      interactionStatus: state?.interaction?.status || null,
      interactionAgent: state?.interaction?.agent?.name || null,
      actionEventText: actionEvent?.text || null,
      latestPulse: state?.pulse || null,
    }
  }, selectedName)

  const actionThread = await page.locator('.phone-bubbles').innerText({ timeout: 5000 })
  assert(actionThread.includes('Action request forwarded'), `Phone action request did not leave a system bubble: ${actionThread}`)
  assert(routeState.actionEventText?.includes('RealPhone action request'), `Phone route request was not recorded as a city event: ${JSON.stringify(routeState)}`)

  await page.locator('.phone-close').click()
  await page.locator('.phone-device').waitFor({ state: 'hidden', timeout: 10000 })
  return {
    selectedName,
    messageThread: messageThread.split(/\r?\n/).slice(-5),
    directMessageTaxiState,
    callState,
    routeState,
  }
}

async function inspectWalkingEscort(page) {
  await page.waitForFunction(() =>
    !!window.__REALCITY_CITY__ &&
    !!window.__REALCITY_STORE__ &&
    !!window.__REALCITY_PLAYER_RIG__?.debugPlace &&
    !!window.__REALCITY_NPC_DEBUG__?.placeNpc &&
    (window.__REALCITY_STORE__?.getState()?.pedestrianSamples || []).length > 80
  , null, { timeout: 10000 })

  const setup = await page.evaluate(() => {
    const city = window.__REALCITY_CITY__
    const store = window.__REALCITY_STORE__?.getState()
    if (!city || !store) return null
    if (store.mission) store.finishMission('Walking escort verification reset.')
    if (store.ride) store.finishRide('Walking escort verification reset.')
    store.closeInteraction?.()

    const player = store.player || { x: 0, z: 40, heading: Math.PI }
    const samples = [...(store.pedestrianSamples || [])]
      .filter(sample => sample.id && !/taxi|riding|fallen|stumbling|boarding/i.test(sample.state || ''))
    const agent = samples.find(sample => sample.routeMode !== 'crosswalk-crossing') || samples[0]
    if (!agent) return { error: 'no-walk-agent', player, sampleCount: samples.length }
    const npc = (city.npcs || []).find(item => item.id === agent.id)
    const clamp = (value, min, max) => Math.max(min, Math.min(max, value))
    const walkPlaces = [...(city.addressBook || []), ...(city.landmarks || [])]
      .filter(place => place?.id && (place.address || place.name) && Number.isFinite(place.x) && Number.isFinite(place.z))
      .map(place => {
        const road = (city.roads || []).find(item => item.id === place.roadId || item.name === place.roadName)
        if (!road) return null
        const privatePlace = /residence|house|home/i.test(`${place.name || ''} ${place.kind || ''} ${place.buildingType || ''}`)
        const side = road.axis === 'x'
          ? (place.z >= road.z ? 1 : -1)
          : (place.x >= road.x ? 1 : -1)
        const startDistance = 54
        let start
        if (road.axis === 'x') {
          let sx = clamp(place.x - startDistance, road.from + 14, road.to - 14)
          if (Math.abs(sx - place.x) < 32) sx = clamp(place.x + startDistance, road.from + 14, road.to - 14)
          start = { x: sx, z: road.z + side * (road.width / 2 + 5.2) }
        } else {
          let sz = clamp(place.z - startDistance, road.from + 14, road.to - 14)
          if (Math.abs(sz - place.z) < 32) sz = clamp(place.z + startDistance, road.from + 14, road.to - 14)
          start = { x: road.x + side * (road.width / 2 + 5.2), z: sz }
        }
        const agentDistance = Math.hypot(place.x - start.x, place.z - start.z)
        return {
          ...place,
          road,
          start,
          side,
          privatePlace,
          distance: Math.hypot(place.x - player.x, place.z - player.z),
          agentDistance,
          score: Math.abs(agentDistance - 58) + (privatePlace ? 35 : 0),
        }
      })
      .filter(Boolean)
      .filter(place => place.agentDistance >= 36 && place.agentDistance <= 90)
      .sort((a, b) => a.score - b.score)
    const target = walkPlaces[0]
    if (!target) return { error: 'no-nearby-walk-target', player, sampleCount: samples.length }

    const label = target.address || target.name
    const request = `Please walk with me to ${label}. Stay on sidewalks and stop at the entrance.`
    const heading = Math.atan2(target.x - target.start.x, target.z - target.start.z)
    window.__REALCITY_NPC_DEBUG__?.placeNpc?.({
      id: agent.id,
      x: target.start.x,
      z: target.start.z,
      heading,
      activity: 'available for walking directions',
      placeName: `${target.road.name} sidewalk`,
      speedScale: 4.2,
    })
    window.__REALCITY_PLAYER_RIG__?.debugPlace?.({
      x: target.start.x + Math.sin(heading + Math.PI / 2) * 6.2,
      z: target.start.z + Math.cos(heading + Math.PI / 2) * 6.2,
      heading,
    })
    return {
      agentId: agent.id,
      agentName: npc?.name || agent.id,
      targetId: target.id,
      targetLabel: label,
      targetDistance: target.distance,
      agentTargetDistance: target.agentDistance,
      sameRoad: true,
      roadName: target.road.name,
      request,
      originalPlayer: {
        x: player.x,
        z: player.z,
        heading: player.heading || Math.PI,
      },
    }
  })

  assert(setup?.agentId && !setup.error, `Walking escort setup failed: ${JSON.stringify(setup)}`)
  await page.waitForFunction(({ agentId }) => {
    const state = window.__REALCITY_STORE__?.getState()
    const sample = (state?.pedestrianSamples || []).find(item => item.id === agentId)
    const player = state?.player
    return sample && player && Math.hypot(player.x - sample.x, player.z - sample.z) < 12
  }, setup, { timeout: 7000 })

  await page.evaluate(({ agentId, request }) => {
    window.dispatchEvent(new CustomEvent('realcity:npc-request', {
      detail: { agentId, text: request, source: 'verify-walking-escort' },
    }))
  }, setup)

  try {
    await page.waitForFunction(({ agentId }) => {
      const state = window.__REALCITY_STORE__?.getState()
      const mission = state?.mission
      return mission?.agentId === agentId && mission.destination && state.interaction?.status === 'active'
    }, setup, { timeout: 35000 })
  } catch (error) {
    const debug = await page.evaluate(({ agentId }) => {
      const state = window.__REALCITY_STORE__?.getState()
      const sample = (state?.pedestrianSamples || []).find(item => item.id === agentId)
      return {
        mission: state?.mission || null,
        interaction: state?.interaction
          ? {
              status: state.interaction.status,
              agent: state.interaction.agent?.name || state.interaction.agent?.id || null,
              request: state.interaction.request,
              plan: state.interaction.plan,
            }
          : null,
        dialogue: state?.dialogue || null,
        pulse: state?.pulse || null,
        sample,
      }
    }, setup)
    throw new Error(`Walking escort mission was not created: ${JSON.stringify({ setup, debug })}`)
  }

  const initial = await page.evaluate(({ agentId }) => {
    const state = window.__REALCITY_STORE__?.getState()
    const sample = (state?.pedestrianSamples || []).find(item => item.id === agentId)
    return {
      mission: state?.mission
        ? {
            mode: state.mission.mode,
            phase: state.mission.phase,
            destinationName: state.mission.destination?.name || state.mission.destination?.address || null,
            reasoning: state.mission.reasoning,
            safety: state.mission.safety,
            offer: state.mission.offer,
          }
        : null,
      sample,
      missionText: document.querySelector('.mission-panel')?.innerText || '',
    }
  }, setup)
  assert(initial.mission?.mode === 'walk', `Walking escort selected the wrong mode: ${JSON.stringify(initial)}`)
  assert(initial.mission?.phase === 'leading', `Walking escort did not enter leading phase: ${JSON.stringify(initial)}`)
  assert(!BROKEN_TEXT_PATTERN.test(`${initial.missionText} ${initial.mission.reasoning || ''} ${initial.mission.offer || ''}`), `Walking escort text contains mojibake: ${JSON.stringify(initial)}`)
  assert(/sidewalk|crosswalk|entrance|walk/i.test(`${initial.mission.safety || ''} ${initial.missionText}`), `Walking escort did not expose pedestrian safety norms: ${JSON.stringify(initial)}`)
  assert(initial.sample?.stableRoute || initial.sample?.routeMode, `Walking escort sample did not expose a route plan: ${JSON.stringify(initial.sample)}`)

  const progress = []
  const started = Date.now()
  while (Date.now() - started < 110000) {
    const state = await page.evaluate(({ agentId }) => {
      const store = window.__REALCITY_STORE__?.getState()
      const mission = store?.mission || null
      const sample = (store?.pedestrianSamples || []).find(item => item.id === agentId) || null
      if (sample && window.__REALCITY_PLAYER_RIG__?.debugPlace) {
        const destination = mission?.destination || null
        const sideHeading = destination
          ? Math.atan2(destination.x - sample.x, destination.z - sample.z) + Math.PI / 2
          : (store.player?.heading || Math.PI) + Math.PI / 2
        window.__REALCITY_PLAYER_RIG__.debugPlace({
          x: sample.x + Math.sin(sideHeading) * 5.8,
          z: sample.z + Math.cos(sideHeading) * 5.8,
          heading: store.player?.heading || Math.PI,
        })
      }
      const player = store?.player || null
      return {
        missionActive: !!mission,
        interactionStatus: store?.interaction?.status || null,
        pulse: store?.pulse || '',
        sample: sample
          ? {
              id: sample.id,
              state: sample.state,
              routeMode: sample.routeMode,
              stableRoute: sample.stableRoute,
              routePoints: sample.routePoints || 0,
              distanceToTarget: sample.distanceToTarget,
              distanceToWaypoint: sample.distanceToWaypoint,
              targetName: sample.targetName,
              x: sample.x,
              z: sample.z,
            }
          : null,
        playerFollowDistance: sample && player ? Math.hypot(player.x - sample.x, player.z - sample.z) : null,
      }
    }, setup)
    progress.push(state)
    if (!state.missionActive && state.interactionStatus === 'done') break
    await page.waitForTimeout(850)
  }

  const completed = progress.at(-1)
  const routeSamples = progress.filter(item => item.sample?.stableRoute)
  const guidingSamples = progress.filter(item => /guiding|walking/.test(item.sample?.state || ''))
  const activeDistances = progress
    .filter(item => item.missionActive)
    .map(item => item.sample?.distanceToTarget)
    .filter(value => typeof value === 'number' && value > 4)
  const initialDistance = activeDistances.length ? Math.max(...activeDistances) : setup.agentTargetDistance
  const finalDistance = completed?.missionActive ? activeDistances.at(-1) ?? initialDistance : 0
  const followDistances = progress.map(item => item.playerFollowDistance).filter(value => typeof value === 'number')

  assert(routeSamples.length >= 3, `Walking escort did not keep a stable pedestrian route: ${JSON.stringify(progress.slice(0, 6))}`)
  assert(guidingSamples.length >= 3, `NPC did not visibly guide the player during walking escort: ${JSON.stringify(progress.slice(0, 6))}`)
  assert(completed && !completed.missionActive && completed.interactionStatus === 'done', `Walking escort mission did not complete cleanly: ${JSON.stringify(completed)}`)
  if (activeDistances.length >= 2) {
    assert(finalDistance < Math.max(4, initialDistance * 0.55), `Walking escort did not approach the destination while active: ${initialDistance} -> ${finalDistance}`)
  }
  assert(followDistances.some(distance => distance < 8), `Player never stayed close enough to follow the walking escort: ${JSON.stringify(followDistances.slice(0, 10))}`)

  await page.evaluate(({ originalPlayer }) => {
    window.__REALCITY_STORE__?.getState()?.closeInteraction?.()
    if (originalPlayer && window.__REALCITY_PLAYER_RIG__?.debugPlace) {
      window.__REALCITY_PLAYER_RIG__.debugPlace({
        x: originalPlayer.x,
        z: originalPlayer.z,
        heading: originalPlayer.heading,
      })
    }
  }, setup)
  await page.waitForFunction(({ x, z }) => {
    const player = window.__REALCITY_STORE__?.getState()?.player
    return player && Math.hypot(player.x - x, player.z - z) < 2.5
  }, setup.originalPlayer, { timeout: 7000 }).catch(() => {})

  return {
    agentName: setup.agentName,
    targetLabel: setup.targetLabel,
    playerTargetDistance: Number(setup.targetDistance.toFixed(1)),
    agentTargetDistance: Number(setup.agentTargetDistance.toFixed(1)),
    initialDistance: Number(initialDistance.toFixed(1)),
    finalDistance: Number(finalDistance.toFixed(1)),
    samples: progress.length,
    routeSamples: routeSamples.length,
    guidingSamples: guidingSamples.length,
    minFollowDistance: Number(Math.min(...followDistances).toFixed(1)),
    lastPulse: completed?.pulse || '',
  }
}

async function inspectCollisionAndMaterials(page) {
  await page.waitForFunction(() => {
    const state = window.__REALCITY_STORE__?.getState()
    return state?.pedestrianSamples?.length > 80 && state?.vehicleSamples?.length > 80
  }, null, { timeout: 15000 })

  const result = await page.evaluate(() => {
    const state = window.__REALCITY_STORE__?.getState()
    const city = window.__REALCITY_CITY__
    const samples = state?.pedestrianSamples || []
    const nearCrosswalk = (x, z, road, roads) => {
      const crossRoads = roads.filter(item => item.axis !== road.axis)
      return crossRoads.some(cross => {
        if (road.axis === 'x') return Math.abs(x - cross.x) < Math.max(road.width, cross.width) * 0.72
        return Math.abs(z - cross.z) < Math.max(road.width, cross.width) * 0.72
      })
    }
    const pedestrianRoadViolations = city
      ? samples.filter(sample => {
          if (['fallen', 'stumbling', 'boarding taxi', 'riding with player'].includes(sample.state)) return false
          return (city.roads || []).some(road => {
            if (road.axis === 'x') {
              if (sample.x < road.from || sample.x > road.to) return false
              if (Math.abs(sample.z - road.z) >= road.width / 2 - 0.35) return false
              return !nearCrosswalk(sample.x, sample.z, road, city.roads || [])
            }
            if (sample.z < road.from || sample.z > road.to) return false
            if (Math.abs(sample.x - road.x) >= road.width / 2 - 0.35) return false
            return !nearCrosswalk(sample.x, sample.z, road, city.roads || [])
          })
        })
      : []
    const npcWallViolations = city
      ? samples.filter(sample => {
          const buildingHit = (city.getNearbyBuildings?.(sample.x, sample.z) || city.buildings || []).some(building => {
            if (building.h < 3) return false
            return Math.abs(sample.x - building.x) < building.w / 2 + 0.72 &&
              Math.abs(sample.z - building.z) < building.d / 2 + 0.72
          })
          if (buildingHit) return true
          return (city.landmarks || []).some(place => {
            const interior = place.interior
            if (!interior?.solidWalls) return false
            return Math.abs(sample.x - place.x) < interior.width / 2 + 0.72 &&
              Math.abs(sample.z - place.z) < interior.depth / 2 + 0.72
          })
        })
      : []
    return {
      rules: state?.collisionRules || null,
      pedestrianSamples: samples.length,
      vehicleSamples: state?.vehicleSamples?.length || 0,
      activePedestrianStates: [...new Set(samples.map(sample => sample.state).filter(Boolean))].slice(0, 12),
      pedestrianRouteModes: [...new Set(samples.map(sample => sample.routeMode).filter(Boolean))],
      pedestrianWaypointSamples: samples.filter(sample => ['sidewalk-waypoint', 'crosswalk-crossing'].includes(sample.routeMode)).length,
      pedestrianPurposeSamples: samples.filter(sample => sample.targetName && sample.routeMode).length,
      pedestrianStableRouteSamples: samples.filter(sample => sample.stableRoute && (sample.routeMode === 'dwelling' || sample.routePoints > 0)).length,
      pedestrianMultiPointRoutes: samples.filter(sample => sample.routePoints >= 2).length,
      pedestrianSocialReactions: samples.filter(sample =>
        ['glancing-at-player', 'turning-toward-player'].includes(sample.socialReaction) &&
        sample.playerDistance < 24 &&
        typeof sample.facingPlayerAngle === 'number'
      ).length,
      pedestrianGlanceSamples: samples.filter(sample =>
        sample.socialReaction === 'glancing-at-player' &&
        sample.playerDistance < 24 &&
        typeof sample.facingPlayerAngle === 'number' &&
        sample.facingPlayerAngle < 0.9
      ).length,
      pedestrianRoadViolations: pedestrianRoadViolations.map(sample => ({
        id: sample.id,
        x: Number(sample.x.toFixed(2)),
        z: Number(sample.z.toFixed(2)),
        state: sample.state,
        routeMode: sample.routeMode,
        targetName: sample.targetName,
        routeRoadName: sample.routeRoadName,
      })).slice(0, 8),
      npcWallViolations: npcWallViolations.map(sample => ({ id: sample.id, x: Number(sample.x.toFixed(2)), z: Number(sample.z.toFixed(2)), state: sample.state })).slice(0, 8),
      vehicleKinds: [...new Set((state?.vehicleSamples || []).map(sample => sample.kind).filter(Boolean))],
      taxiLoopSamples: (state?.vehicleSamples || []).filter(sample => sample.kind === 'taxi' && sample.routeMode === 'city-ring-loop' && sample.cruiseRoutePoints >= 8).length,
      vehicleBoundsReady: (state?.vehicleSamples || []).filter(sample => sample.width > 0 && sample.length > 0 && typeof sample.yaw === 'number').length,
      vehicleDriverSamples: (state?.vehicleSamples || []).filter(sample => sample.driverName && sample.driverTemperament && sample.activeRoadName && sample.laneKey).length,
      vehicleFollowingSamples: (state?.vehicleSamples || []).filter(sample => sample.followingVehicleId && typeof sample.followDistance === 'number' && typeof sample.desiredGap === 'number').length,
      vehicleFollowingBrakes: (state?.vehicleSamples || []).filter(sample => sample.brakingReason === 'following-vehicle').length,
      vehicleBrakeLightSamples: (state?.vehicleSamples || []).filter(sample => sample.brakingReason && sample.visualSafetyCue === 'brake-lights-and-driver-yield' && sample.brakeLightIntensity > 0).length,
      vehicleSignalIntentSamples: (state?.vehicleSamples || []).filter(sample => sample.signalIntent && sample.driverReaction).length,
      vehicleDriverReactionSamples: (state?.vehicleSamples || []).filter(sample => sample.driverReaction && sample.visualSafetyCue).length,
      clouds: window.__REALCITY_CLOUDS__ || null,
      textures: window.__REALCITY_TEXTURES__ || null,
    }
  })

  assert(result.rules?.solidObjects?.includes('pedestrians') && result.rules?.solidObjects?.includes('vehicles'), 'Dynamic pedestrian/vehicle collision rules are missing')
  assert(result.rules?.solidObjects?.includes('buildings') && result.rules?.solidObjects?.includes('landmarks'), 'Static building/landmark collision rules are missing')
  assert(result.rules?.reactions?.includes('push-away') && result.rules?.reactions?.includes('fall') && result.rules?.reactions?.includes('driver-brake'), 'Collision reaction metadata is incomplete')
  assert(result.pedestrianSamples > 100, `Pedestrian collision samples are too sparse: ${result.pedestrianSamples}`)
  assert(result.pedestrianPurposeSamples === result.pedestrianSamples, `Pedestrian route purpose metadata is incomplete: ${result.pedestrianPurposeSamples}/${result.pedestrianSamples}`)
  assert(result.pedestrianRouteModes.includes('direct') || result.pedestrianWaypointSamples > 0, `Pedestrian route modes were not exposed: ${result.pedestrianRouteModes.join(', ')}`)
  assert(result.pedestrianStableRouteSamples > 120, `NPCs do not expose stable sidewalk routes: ${result.pedestrianStableRouteSamples}/${result.pedestrianSamples}`)
  assert(result.pedestrianMultiPointRoutes > 8, `NPC multi-waypoint routing is too sparse: ${result.pedestrianMultiPointRoutes}`)
  assert(result.pedestrianSocialReactions >= 1, `Nearby NPCs are not exposing social reactions to the player: ${JSON.stringify(result.activePedestrianStates)}`)
  assert(result.pedestrianGlanceSamples >= 1, `No nearby NPC exposes a glancing-at-player state: ${result.pedestrianGlanceSamples}`)
  assert(result.pedestrianRoadViolations.length === 0, `NPCs are walking in vehicle lanes away from crosswalks: ${JSON.stringify(result.pedestrianRoadViolations)}`)
  assert(result.npcWallViolations.length === 0, `NPCs are inside solid building walls: ${JSON.stringify(result.npcWallViolations)}`)
  assert(result.vehicleSamples === 120, `Vehicle collision samples are incomplete: ${result.vehicleSamples}`)
  assert(result.vehicleBoundsReady === result.vehicleSamples, 'Vehicle collision samples do not expose oriented bounds')
  assert(result.vehicleDriverSamples === result.vehicleSamples, `Vehicle driver/lane metadata is incomplete: ${result.vehicleDriverSamples}/${result.vehicleSamples}`)
  assert(result.vehicleFollowingSamples >= 20, `Vehicles are not tracking same-lane following distance: ${result.vehicleFollowingSamples}`)
  assert(result.vehicleFollowingBrakes >= 1, `No vehicles are braking for the car ahead: ${result.vehicleFollowingBrakes}`)
  assert(result.vehicleBrakeLightSamples >= 1, `No braking vehicles expose brake-light safety cues: ${result.vehicleBrakeLightSamples}`)
  assert(result.vehicleSignalIntentSamples >= 1, `No vehicles expose turn/hazard signal intent: ${result.vehicleSignalIntentSamples}`)
  assert(result.vehicleDriverReactionSamples >= result.vehicleBrakeLightSamples, `Driver reaction metadata is missing for visual safety cues: ${result.vehicleDriverReactionSamples}/${result.vehicleBrakeLightSamples}`)
  assert(result.vehicleKinds.includes('taxi') && result.vehicleKinds.length >= 2, `Vehicle samples do not distinguish taxis and regular cars: ${result.vehicleKinds.join(', ')}`)
  assert(result.taxiLoopSamples >= 8, `Cruising taxis are not distributed on city ring loops: ${result.taxiLoopSamples}`)
  assert(result.clouds?.system === 'layered-procedural-puffs', 'Cloud renderer did not switch to layered procedural puffs')
  assert(result.clouds.count >= 16 && result.clouds.averagePuffs >= 8, 'Cloud puff composition is too sparse')
  assert(result.clouds.hasFlattenedUndersides && result.clouds.maxVerticalAspect < 0.55, 'Clouds are still vertically stretched or lack flattened undersides')
  assert(result.textures?.procedural && result.textures.classes?.length >= 8, 'Procedural texture catalog was not exposed')
  assert(['cloud-vapor', 'city-fabric', 'skin-pores', 'vehicle-paint', 'rubber-tread', 'glass-smudge'].every(key => result.textures.classes.includes(key)), 'Core object texture classes are missing')
  return result
}

async function inspectAgentAutonomy(page) {
  await page.evaluate(() => {
    const store = window.__REALCITY_STORE__?.getState()
    const player = store?.player || { x: 0, z: 40 }
    window.__REALCITY_NPC_DEBUG__?.startConversation?.({
      x: player.x + 4,
      z: player.z + 9,
      spacing: 2.7,
      seconds: 9,
    })
  })

  await page.waitForFunction(() => {
    const state = window.__REALCITY_STORE__?.getState()
    const samples = state?.pedestrianSamples || []
    return (state?.cityEvents || []).length >= 3 &&
      (state?.cityEvents || []).some(event => event.kind === 'conversation' && event.partnerName && event.topic) &&
      samples.length > 100 &&
      samples.some(sample => sample.autonomyGoal && sample.currentIntent && sample.memoryCount > 0) &&
      samples.filter(sample => sample.talkPartnerId && sample.visualGesture && sample.renderFacingPartner && sample.facingPartnerAngle < 0.9).length >= 2 &&
      samples.filter(sample => sample.relationshipCount > 0 && sample.lastInteractionTopic).length >= 6 &&
      (samples.some(sample => sample.travelMode === 'taxi' && sample.taxiDriverName && sample.taxiTargetName) ||
        (state?.cityEvents || []).some(event => event.kind === 'mobility' && /taxi/i.test(event.text || '')))
  }, null, { timeout: 22000 })

  const result = await page.evaluate(() => {
    const state = window.__REALCITY_STORE__?.getState()
    const samples = state?.pedestrianSamples || []
    const cityEvents = state?.cityEvents || []
    const autonomousSamples = samples.filter(sample => sample.autonomyGoal && sample.currentIntent && sample.memoryCount > 0)
    const conversationEvents = cityEvents.filter(event => event.kind === 'conversation')
    const mobilityEvents = cityEvents.filter(event => event.kind === 'mobility')
    const relationshipSamples = samples.filter(sample => sample.relationshipCount > 0 && sample.lastInteractionPartner && sample.lastInteractionTopic)
    const taxiCommuters = samples.filter(sample => sample.travelMode === 'taxi' && sample.taxiDriverName && sample.taxiTargetName)
    const autonomousTaxiVehicles = (state?.vehicleSamples || []).filter(sample => sample.routeMode === 'npc-autonomous-taxi' && sample.npcTaxiPhase && sample.npcTaxiTarget)
    const socialVisualSamples = samples.filter(sample => sample.talkPartnerId && sample.visualGesture && sample.renderFacingPartner && sample.facingPartnerAngle < 0.9)
    return {
      cityEvents: cityEvents.length,
      eventKinds: [...new Set(cityEvents.map(event => event.kind).filter(Boolean))],
      latestEvents: cityEvents.slice(0, 5).map(event => ({
        kind: event.kind,
        agentName: event.agentName,
        partnerName: event.partnerName,
        placeName: event.placeName,
        topic: event.topic,
        text: event.text,
      })),
      conversationEvents: conversationEvents.length,
      mobilityEvents: mobilityEvents.length,
      conversationMetadata: conversationEvents.slice(0, 5).map(event => ({
        agentName: event.agentName,
        partnerName: event.partnerName,
        topic: event.topic,
        relationshipTrust: event.relationshipTrust,
      })),
      mobilityMetadata: mobilityEvents.slice(0, 5).map(event => ({
        agentName: event.agentName,
        topic: event.topic,
        text: event.text,
      })),
      autonomousSamples: autonomousSamples.length,
      relationshipSamples: relationshipSamples.length,
      taxiCommuters: taxiCommuters.length,
      autonomousTaxiVehicles: autonomousTaxiVehicles.length,
      socialVisualSamples: socialVisualSamples.length,
      socialGestureKinds: [...new Set(socialVisualSamples.map(sample => sample.visualGesture).filter(Boolean))],
      partnerFacingSamples: socialVisualSamples.slice(0, 5).map(sample => ({
        id: sample.id,
        partner: sample.talkPartnerName,
        topic: sample.talkTopicLabel,
        gesture: sample.visualGesture,
        angle: sample.facingPartnerAngle,
      })),
      knownContactSamples: samples.filter(sample => Array.isArray(sample.knownContacts) && sample.knownContacts.length > 0).length,
      memorySamples: samples.filter(sample => sample.lastMemory).length,
      needSamples: samples.filter(sample => typeof sample.energy === 'number' && typeof sample.hunger === 'number' && typeof sample.socialNeed === 'number').length,
      relationshipStyles: [...new Set(samples.map(sample => sample.relationshipStyle).filter(Boolean))],
      intentSamples: autonomousSamples.slice(0, 5).map(sample => ({
        id: sample.id,
        currentIntent: sample.currentIntent,
        autonomyGoal: sample.autonomyGoal,
        memoryCount: sample.memoryCount,
        lastMemory: sample.lastMemory,
        lastInteractionPartner: sample.lastInteractionPartner,
        lastInteractionTopic: sample.lastInteractionTopic,
        travelMode: sample.travelMode,
        taxiPhase: sample.taxiPhase,
      })),
    }
  })

  assert(result.cityEvents >= 3, `Live city event feed is too sparse: ${result.cityEvents}`)
  assert(result.autonomousSamples > 100, `NPC runtime autonomy samples are incomplete: ${result.autonomousSamples}`)
  assert(result.memorySamples > 100, `NPC memory samples are incomplete: ${result.memorySamples}`)
  assert(result.needSamples > 100, `NPC need samples are incomplete: ${result.needSamples}`)
  assert(result.relationshipStyles.length >= 6, `Runtime relationship styles are too sparse: ${result.relationshipStyles.join(', ')}`)
  assert(result.conversationEvents >= 1, 'NPC-to-NPC conversation events are missing from the live city feed')
  assert(result.socialVisualSamples >= 2, `NPC-to-NPC conversations are not exposing rendered social cues: ${JSON.stringify(result.partnerFacingSamples)}`)
  assert(result.socialGestureKinds.length >= 1, `NPC social gesture cues are missing: ${JSON.stringify(result.partnerFacingSamples)}`)
  assert(result.mobilityEvents >= 1, `NPC autonomous mobility events are missing: ${JSON.stringify(result.mobilityMetadata)}`)
  assert(result.conversationMetadata.every(event => event.agentName && event.partnerName && event.topic), `Conversation event metadata is incomplete: ${JSON.stringify(result.conversationMetadata)}`)
  assert(result.taxiCommuters >= 1, `No NPC is actively using a self-called taxi: ${JSON.stringify(result.intentSamples)}`)
  assert(result.autonomousTaxiVehicles >= 1, `No fleet taxi is rendering as an NPC autonomous taxi: ${JSON.stringify(result.mobilityMetadata)}`)
  assert(result.relationshipSamples >= 6, `NPC relationship state is too sparse: ${result.relationshipSamples}`)
  assert(result.knownContactSamples >= 6, `NPC known-contact samples are too sparse: ${result.knownContactSamples}`)
  assert(result.latestEvents.every(event => event.text && event.agentName), `Live city events are missing agent context: ${JSON.stringify(result.latestEvents)}`)
  return result
}

async function inspectDeterministicSocialReaction(page) {
  await page.waitForFunction(() =>
    !!window.__REALCITY_STORE__ &&
    !!window.__REALCITY_PLAYER_RIG__?.debugPlace &&
    !!window.__REALCITY_NPC_DEBUG__?.placeNpc &&
    (window.__REALCITY_STORE__?.getState()?.pedestrianSamples || []).length > 80
  , null, { timeout: 10000 })

  const setup = await page.evaluate(() => {
    const store = window.__REALCITY_STORE__?.getState()
    const city = window.__REALCITY_CITY__
    if (!store || !city || !window.__REALCITY_PLAYER_RIG__?.debugPlace || !window.__REALCITY_NPC_DEBUG__?.placeNpc) return null
    const sample = (store.pedestrianSamples || [])
      .find(item => item.id && !/taxi|riding|fallen|stumbling|boarding/i.test(item.state || ''))
    const npc = city.npcs?.find(item => item.id === sample?.id) || city.npcs?.[0]
    if (!npc) return null
    const originalPlayer = { ...store.player }
    const originalNpc = sample
      ? {
          id: sample.id,
          x: sample.x,
          z: sample.z,
          heading: sample.heading || 0,
          activity: sample.state || 'following schedule',
          placeName: sample.placeName || 'original route',
        }
      : null
    const player = { x: 0, z: 40, heading: Math.PI }
    const npcPose = { x: player.x + 5.4, z: player.z + 1.2, heading: -Math.PI / 2 }
    window.__REALCITY_PLAYER_RIG__.debugPlace(player)
    window.__REALCITY_NPC_DEBUG__.placeNpc({
      id: npc.id,
      ...npcPose,
      activity: 'standing and noticing the player',
      placeName: 'Central Core plaza',
      talkSeconds: 5,
      speedScale: 1,
    })
    return {
      agentId: npc.id,
      agentName: npc.name,
      player,
      npcPose,
      originalPlayer,
      originalNpc,
    }
  })
  assert(setup, 'Could not set up deterministic NPC social reaction verification')

  await page.waitForFunction(agentId => {
    const state = window.__REALCITY_STORE__?.getState()
    const sample = (state?.pedestrianSamples || []).find(item => item.id === agentId)
    return sample &&
      sample.playerDistance < 8 &&
      ['glancing-at-player', 'turning-toward-player'].includes(sample.socialReaction) &&
      typeof sample.facingPlayerAngle === 'number' &&
      sample.facingPlayerAngle < 0.9
  }, setup.agentId, { timeout: 10000 })

  const reaction = await page.evaluate(agentId => {
    const state = window.__REALCITY_STORE__?.getState()
    const sample = (state?.pedestrianSamples || []).find(item => item.id === agentId)
    return {
      id: sample?.id || null,
      name: sample?.name || null,
      playerDistance: sample?.playerDistance || null,
      socialReaction: sample?.socialReaction || null,
      facingPlayerAngle: sample?.facingPlayerAngle || null,
      heading: sample?.heading || null,
      placeName: sample?.placeName || null,
      pulse: state?.pulse || '',
    }
  }, setup.agentId)
  reaction.name = reaction.name || setup.agentName

  assert(reaction.name && reaction.socialReaction, `NPC social reaction sample is incomplete: ${JSON.stringify(reaction)}`)
  assert(/glances over|pass through/i.test(reaction.pulse), `NPC social reaction did not surface in city pulse: ${JSON.stringify(reaction)}`)

  await page.evaluate(({ originalPlayer, originalNpc }) => {
    if (originalPlayer && window.__REALCITY_PLAYER_RIG__?.debugPlace) {
      window.__REALCITY_PLAYER_RIG__.debugPlace({
        x: originalPlayer.x,
        z: originalPlayer.z,
        heading: originalPlayer.heading,
      })
    }
    if (originalNpc && window.__REALCITY_NPC_DEBUG__?.placeNpc) {
      window.__REALCITY_NPC_DEBUG__.placeNpc({
        id: originalNpc.id,
        x: originalNpc.x,
        z: originalNpc.z,
        heading: originalNpc.heading,
        activity: originalNpc.activity,
        placeName: originalNpc.placeName,
      })
    }
  }, setup)

  return {
    agentName: reaction.name,
    socialReaction: reaction.socialReaction,
    playerDistance: reaction.playerDistance,
    facingPlayerAngle: reaction.facingPlayerAngle,
    pulse: reaction.pulse,
  }
}

async function inspectDailyRoutineTimeShift(page) {
  const original = await page.evaluate(() => {
    const state = window.__REALCITY_STORE__?.getState()
    return state ? { timeMinutes: state.timeMinutes, day: state.day } : null
  })
  assert(original, 'City clock store was not exposed for routine verification')

  const checkpoints = [
    { label: 'morning-commute', minutes: 6.8 * 60 },
    { label: 'workday', minutes: 10.4 * 60 },
    { label: 'evening-third-place', minutes: 19.2 * 60 },
    { label: 'night-home', minutes: 22.7 * 60 },
  ]

  const phases = []
  try {
    for (const checkpoint of checkpoints) {
      await page.evaluate(({ minutes, day }) => {
        const store = window.__REALCITY_STORE__?.getState()
        store?.setClock?.(minutes, day)
      }, { minutes: checkpoint.minutes, day: original.day })
      await page.waitForFunction(({ minutes }) => {
        const state = window.__REALCITY_STORE__?.getState()
        const samples = state?.pedestrianSamples || []
        return Math.abs((state?.timeMinutes || 0) - minutes) < 5 &&
          samples.length > 100 &&
          samples.filter(sample =>
            sample.scheduleTarget &&
            sample.scheduleActivity &&
            Math.abs((sample.sampleTimeMinutes || 0) - minutes) < 5
          ).length > 100
      }, checkpoint, { timeout: 10000 })
      await page.waitForTimeout(650)
      phases.push(await page.evaluate(label => {
        const state = window.__REALCITY_STORE__?.getState()
        const samples = state?.pedestrianSamples || []
        const counts = values => values.reduce((acc, value) => {
          const key = value || 'unknown'
          acc[key] = (acc[key] || 0) + 1
          return acc
        }, {})
        return {
          label,
          timeMinutes: Number((state.timeMinutes || 0).toFixed(1)),
          sampleTimeMinutes: samples[0]?.sampleTimeMinutes ?? null,
          samples: samples.length,
          scheduleTargets: counts(samples.map(sample => sample.scheduleTarget)),
          scheduleActivities: counts(samples.map(sample => sample.scheduleActivity)),
          tracked: samples.slice(0, 80).map(sample => ({
            id: sample.id,
            target: sample.scheduleTarget,
            activity: sample.scheduleActivity,
            placeName: sample.targetName || sample.placeName,
            currentIntent: sample.currentIntent,
          })),
        }
      }, checkpoint.label))
    }
  } finally {
    await page.evaluate(originalClock => {
      const store = window.__REALCITY_STORE__?.getState()
      store?.setClock?.(originalClock.timeMinutes, originalClock.day)
    }, original)
  }

  const targetTotal = (phase, target) => phase.scheduleTargets[target] || 0
  const activityText = phase => Object.keys(phase.scheduleActivities).join(' | ')
  assert(targetTotal(phases[1], 'work') > 45, `Workday schedule did not route enough NPCs to work: ${JSON.stringify(phases[1].scheduleTargets)}`)
  assert(targetTotal(phases[2], 'third') > 35, `Evening schedule did not route enough NPCs to third places: ${JSON.stringify(phases[2].scheduleTargets)}`)
  assert(targetTotal(phases[3], 'home') > 45, `Night schedule did not route enough NPCs home: ${JSON.stringify(phases[3].scheduleTargets)}`)
  assert(/commuting|on shift|class|working|customers|social time|errands|home life/.test(phases.map(activityText).join(' | ')), `Schedule activities are too generic: ${JSON.stringify(phases.map(phase => phase.scheduleActivities))}`)

  const byAgent = new Map()
  for (const phase of phases) {
    for (const sample of phase.tracked) {
      if (!byAgent.has(sample.id)) byAgent.set(sample.id, [])
      byAgent.get(sample.id).push(`${sample.target}:${sample.activity}`)
    }
  }
  const changingAgents = [...byAgent.values()].filter(values => new Set(values).size >= 3).length
  assert(changingAgents >= 48, `Too few tracked NPCs change schedule states across the day: ${changingAgents}`)

  return {
    checkpoints: phases.map(phase => ({
      label: phase.label,
      timeMinutes: phase.timeMinutes,
      sampleTimeMinutes: phase.sampleTimeMinutes,
      scheduleTargets: phase.scheduleTargets,
      scheduleActivities: phase.scheduleActivities,
    })),
    changingAgents,
    original,
  }
}

async function inspectStreetRendering(page) {
  await page.waitForFunction(() => {
    const rendering = window.__REALCITY_RENDERING__
    return rendering?.streetHierarchy?.segmentedSidewalks && rendering?.crosswalks?.zebraStripes > 0 && rendering?.facades?.proceduralWindowTexture
  }, null, { timeout: 15000 })

  const result = await page.evaluate(() => window.__REALCITY_RENDERING__ || null)
  assert(result, 'Rendering metadata was not exposed')
  assert(result.streetHierarchy?.segmentedSidewalks, 'Sidewalks are not marked as segmented at intersections')
  assert(result.streetHierarchy.sidewalkSegments > result.streetHierarchy.sourceRoads * 2, `Sidewalks were not split into enough non-intersection segments: ${result.streetHierarchy.sidewalkSegments}`)
  assert(result.streetHierarchy.curbEdgeSegments === result.streetHierarchy.sidewalkSegments, 'Curbs do not track sidewalk edge segments')
  assert(result.streetHierarchy.roadMaterial === 'dark asphalt' && result.streetHierarchy.sidewalkMaterial === 'raised light pavers', 'Road/sidewalk material hierarchy is unclear')
  assert(result.crosswalks?.zebraStripes >= 300 && result.crosswalks?.crossingPads >= 40 && result.crosswalks?.stopBars >= 40, 'Crosswalk zebra pads or stop bars are too sparse')
  assert(result.crosswalks.raisedAboveRoad && result.crosswalks.separatedFromSidewalks, 'Crosswalks are not explicitly separated from sidewalks')
  assert(result.facades?.proceduralWindowTexture && result.facades?.hasMullions && result.facades?.hasLitWindows, 'Facade texture/window system is incomplete')
  assert(result.facades.wallPalettes?.length >= 4, 'Facade wall palettes are not diverse enough')
  assert(result.facadeDetails?.physicalMullions >= 1000 && result.facadeDetails?.windowSills >= 1000, `Facade physical window detail is too sparse: ${JSON.stringify(result.facadeDetails)}`)
  assert(result.facadeDetails?.facadeBands >= 500 && result.facadeDetails?.acUnits >= 120 && result.facadeDetails?.drainPipes >= 300, `Facade service/material breakup is incomplete: ${JSON.stringify(result.facadeDetails)}`)
  assert(result.facadeDetails?.balconySideRails >= result.facadeDetails?.balconyDecks * 2, `Balconies lack side-return rails: ${JSON.stringify(result.facadeDetails)}`)
  assert(result.buildingAccess?.visibleDirectoryBoards > 300 && result.buildingAccess?.visibleCoreWayfindingSigns > 300, `Lobby wayfinding boards are too sparse: ${JSON.stringify(result.buildingAccess)}`)
  assert(result.buildingAccess?.visibleConciergeDesks > 300 && result.buildingAccess?.visibleQueueRails > 600, `Lobby furniture and queue rails are too sparse: ${JSON.stringify(result.buildingAccess)}`)
  assert(result.buildingAccess?.readableDirectoryLabels >= 60 && /floor directories/i.test(result.buildingAccess?.interiorVisualRule || ''), `Readable interior directory metadata is incomplete: ${JSON.stringify(result.buildingAccess)}`)
  return result
}

async function inspectAutomaticDoors(page) {
  const setup = await page.evaluate(() => {
    const city = window.__REALCITY_CITY__
    const store = window.__REALCITY_STORE__?.getState()
    if (!city || !store) return null
    const target = city.buildings
      .filter(building => building.interior?.entryPortal && Math.hypot(building.x, building.z) < 760)
      .sort((a, b) => Math.hypot(a.x, a.z) - Math.hypot(b.x, b.z))[0]
    if (!target) return null
    const face = target.interior?.entryPortal?.face || target.facadePlan?.entryFace || 'south'
    const world = (item, lx, lz) => {
      const cos = Math.cos(item.rot || 0)
      const sin = Math.sin(item.rot || 0)
      return {
        x: item.x + lx * cos + lz * sin,
        z: item.z - lx * sin + lz * cos,
      }
    }
    const probe = (building, entryFace, along, distanceFromFace) => {
      if (entryFace === 'north') return world(building, along, building.d / 2 + distanceFromFace)
      if (entryFace === 'south') return world(building, along, -building.d / 2 - distanceFromFace)
      if (entryFace === 'east') return world(building, building.w / 2 + distanceFromFace, along)
      return world(building, -building.w / 2 - distanceFromFace, along)
    }
    const near = probe(target, face, 0, 3.2)
    const far = { x: target.x + 1500, z: target.z + 1500 }
    window.__REALCITY_AUTODOOR_PROBE__ = {
      ...store.player,
      x: near.x,
      z: near.z,
      speed: 0,
      indoors: false,
      placeId: null,
      placeName: null,
      floor: 0,
      floorCount: 0,
    }
    return { id: target.id, face, near, far }
  })

  assert(setup?.id, 'No automatic-door target building was available')
  try {
    await page.waitForFunction(({ id }) => {
      const access = window.__REALCITY_RENDERING__?.buildingAccess
      return access?.automaticDoorPanels >= 2 &&
        access?.automaticDoorBuildings > 100 &&
        access?.openDoorPanels >= 2 &&
        access?.nearestAutomaticDoorDistance <= 5.5
    }, { id: setup.id }, { timeout: 10000 })
  } catch (error) {
    const debug = await page.evaluate(id => ({
      access: window.__REALCITY_RENDERING__?.buildingAccess || null,
      player: window.__REALCITY_STORE__?.getState()?.player || null,
      probe: window.__REALCITY_AUTODOOR_PROBE__ || null,
      targetIncluded: (window.__REALCITY_RENDERING__?.buildingAccess?.openDoorIds || []).includes(id),
    }), setup.id)
    throw new Error(`Automatic door panels did not open near the avatar: ${JSON.stringify({ setup, debug })}`)
  }
  const openState = await page.evaluate(() => window.__REALCITY_RENDERING__?.buildingAccess || null)
  assert(openState?.openDoorPanels >= 2, `Automatic door panels did not open near the player: ${JSON.stringify(openState)}`)

  await page.evaluate(({ far }) => {
    window.__REALCITY_AUTODOOR_PROBE__ = {
      ...(window.__REALCITY_STORE__?.getState()?.player || {}),
      x: far.x,
      z: far.z,
      speed: 0,
      indoors: false,
      placeId: null,
      placeName: null,
      floor: 0,
      floorCount: 0,
    }
  }, setup)
  await page.waitForFunction(({ id }) => {
    const access = window.__REALCITY_RENDERING__?.buildingAccess
    return access?.automaticDoorPanels >= 2 &&
      access?.nearestAutomaticDoorDistance > 100 &&
      access?.openDoorPanels === 0 &&
      !(access.openDoorIds || []).includes(id)
  }, { id: setup.id }, { timeout: 10000 })
  const closedState = await page.evaluate(() => window.__REALCITY_RENDERING__?.buildingAccess || null)

  await page.evaluate(() => {
    delete window.__REALCITY_AUTODOOR_PROBE__
  })

  return {
    target: setup.id,
    face: setup.face,
    openDoorPanels: openState.openDoorPanels,
    nearestOpenDoor: openState.nearestAutomaticDoorId,
    nearestOpenDistance: openState.nearestAutomaticDoorDistance,
    automaticDoorBuildings: openState.automaticDoorBuildings,
    closedOpenDoorIds: closedState.openDoorIds || [],
  }
}

async function inspectInteriorStateAndFloors(page) {
  await page.waitForFunction(() =>
    !!window.__REALCITY_CITY__ &&
    !!window.__REALCITY_STORE__ &&
    !!window.__REALCITY_COLLISION__ &&
    !!window.__REALCITY_PLAYER_RIG__?.debugPlace
  , null, { timeout: 10000 })

  const setup = await page.evaluate(() => {
    const city = window.__REALCITY_CITY__
    const store = window.__REALCITY_STORE__?.getState()
    const collision = window.__REALCITY_COLLISION__
    const rig = window.__REALCITY_PLAYER_RIG__
    if (!city || !store || !collision || !rig?.debugPlace) return null

    const world = (item, lx, lz) => {
      const cos = Math.cos(item.rot || 0)
      const sin = Math.sin(item.rot || 0)
      return {
        x: item.x + lx * cos + lz * sin,
        z: item.z - lx * sin + lz * cos,
      }
    }
    const probe = (building, entryFace, along, distanceFromFace) => {
      if (entryFace === 'north') return world(building, along, building.d / 2 + distanceFromFace)
      if (entryFace === 'south') return world(building, along, -building.d / 2 - distanceFromFace)
      if (entryFace === 'east') return world(building, building.w / 2 + distanceFromFace, along)
      return world(building, -building.w / 2 - distanceFromFace, along)
    }

    const target = city.buildings
      .filter(building => building.interior?.entryPortal && (building.interior?.floors || 1) > 1)
      .sort((a, b) => {
        const floors = (b.interior?.floors || 1) - (a.interior?.floors || 1)
        if (floors) return floors
        return Math.hypot(a.x, a.z) - Math.hypot(b.x, b.z)
      })[0]
    if (!target) return null

    const face = target.interior?.entryPortal?.face || target.facadePlan?.entryFace || 'south'
    const inside = probe(target, face, 0, -1.35)
    const interior = collision.currentInterior(city, inside.x, inside.z)
    if (interior?.id !== target.id) return { error: 'probe-missed-interior', id: target.id, face, inside, interior }

    const original = {
      x: store.player?.x || 0,
      z: store.player?.z || 40,
      heading: store.player?.heading || Math.PI,
    }
    rig.debugPlace({
      x: inside.x,
      z: inside.z,
      heading: face === 'north' ? 0 : face === 'south' ? Math.PI : face === 'east' ? Math.PI / 2 : -Math.PI / 2,
      floor: 0,
      pulse: `Interior verification at ${target.name || target.address || target.id}.`,
    })

    return {
      id: target.id,
      name: target.name || target.address || target.id,
      face,
      floorCount: target.interior.floors,
      firstFloorLabel: target.interior.floorDirectory?.[0]?.label || 'Ground lobby',
      original,
    }
  })

  assert(setup?.id && !setup.error, `No multi-floor interior target was available: ${JSON.stringify(setup)}`)

  try {
    await page.waitForFunction(({ id }) => {
      const player = window.__REALCITY_STORE__?.getState()?.player
      return player?.indoors &&
        player.placeId === id &&
        player.floor === 1 &&
        player.floorCount > 1 &&
        !!player.floorLabel &&
        !!player.floorZone &&
        !!player.coreHint
    }, setup, { timeout: 7000 })

    const initialPlayer = await getPlayer(page)
    const initialHud = await page.locator('.time-card').innerText({ timeout: 5000 })
    assert(initialHud.includes(initialPlayer.placeName), `HUD did not show the interior place name: ${initialHud}`)
    assert(initialHud.includes(`Floor 1 of ${initialPlayer.floorCount}`), `HUD did not show the first floor state: ${initialHud}`)
    assert(initialHud.includes(initialPlayer.floorLabel), `HUD did not expose floor label text: ${initialHud}`)

    await holdKey(page, 'PageUp', 180)
    await page.waitForFunction(({ id }) => {
      const player = window.__REALCITY_STORE__?.getState()?.player
      return player?.placeId === id && player.floor === 2
    }, setup, { timeout: 7000 })
    const upperPlayer = await getPlayer(page)
    const upperHud = await page.locator('.time-card').innerText({ timeout: 5000 })
    assert(upperHud.includes(`Floor ${upperPlayer.floor} of ${upperPlayer.floorCount}`), `HUD did not update after PageUp: ${upperHud}`)
    assert(upperPlayer.y > initialPlayer.y + 2.5, `PageUp did not move the player to a higher floor: ${initialPlayer.y} -> ${upperPlayer.y}`)

    await holdKey(page, 'PageDown', 180)
    await page.waitForFunction(({ id }) => {
      const player = window.__REALCITY_STORE__?.getState()?.player
      return player?.placeId === id && player.floor === 1
    }, setup, { timeout: 7000 })
    const returnedPlayer = await getPlayer(page)

    return {
      target: setup.id,
      name: setup.name,
      face: setup.face,
      floorCount: setup.floorCount,
      initialFloor: initialPlayer.floor,
      upperFloor: upperPlayer.floor,
      returnedFloor: returnedPlayer.floor,
      floorLabel: returnedPlayer.floorLabel,
      floorZone: returnedPlayer.floorZone,
      accessHint: returnedPlayer.accessHint,
      coreHint: returnedPlayer.coreHint,
      hudShowsInterior: initialHud.includes(setup.name) && upperHud.includes(`Floor ${upperPlayer.floor} of ${upperPlayer.floorCount}`),
    }
  } finally {
    await page.evaluate(original => {
      if (!original || !window.__REALCITY_PLAYER_RIG__?.debugPlace) return
      window.__REALCITY_PLAYER_RIG__.debugPlace({
        x: original.x,
        z: original.z,
        heading: original.heading,
        floor: 0,
      })
    }, setup.original)
    await page.waitForFunction(original => {
      const player = window.__REALCITY_STORE__?.getState()?.player
      if (!player || !original) return false
      return Math.hypot(player.x - original.x, player.z - original.z) < 1.8
    }, setup.original, { timeout: 5000 }).catch(() => {})
  }
}

async function inspectPlayerPhysicsAndCollision(page) {
  await page.waitForFunction(() =>
    !!window.__REALCITY_CITY__ &&
    !!window.__REALCITY_STORE__ &&
    !!window.__REALCITY_COLLISION__ &&
    !!window.__REALCITY_PLAYER_RIG__?.debugPlace
  , null, { timeout: 10000 })

  const setup = await page.evaluate(() => {
    const city = window.__REALCITY_CITY__
    const store = window.__REALCITY_STORE__?.getState()
    const rig = window.__REALCITY_PLAYER_RIG__
    const collision = window.__REALCITY_COLLISION__
    if (!city || !store || !rig?.debugPlace || !collision) return null

    const faces = ['north', 'south', 'east', 'west']
    const world = (item, lx, lz) => {
      const cos = Math.cos(item.rot || 0)
      const sin = Math.sin(item.rot || 0)
      return {
        x: item.x + lx * cos + lz * sin,
        z: item.z - lx * sin + lz * cos,
      }
    }
    const probe = (building, entryFace, along, distanceFromFace) => {
      if (entryFace === 'north') return world(building, along, building.d / 2 + distanceFromFace)
      if (entryFace === 'south') return world(building, along, -building.d / 2 - distanceFromFace)
      if (entryFace === 'east') return world(building, building.w / 2 + distanceFromFace, along)
      return world(building, -building.w / 2 - distanceFromFace, along)
    }

    const target = city.buildings
      .filter(building => building.interior?.solidWalls && building.interior?.entryPortal && building.w > 18 && building.d > 18)
      .sort((a, b) => Math.hypot(a.x, a.z) - Math.hypot(b.x, b.z))[0]
    if (!target) return null

    const entryFace = target.interior?.entryPortal?.face || target.facadePlan?.entryFace || 'south'
    const blockedFace = faces.find(face => face !== entryFace) || 'north'
    const faceLength = blockedFace === 'north' || blockedFace === 'south' ? target.w : target.d
    const along = Math.max(-faceLength * 0.32, Math.min(faceLength * 0.32, faceLength * 0.24))
    const outside = probe(target, blockedFace, along, 4.5)
    const inside = probe(target, blockedFace, along, -5.5)
    const heading = Math.atan2(inside.x - outside.x, inside.z - outside.z)
    const original = {
      x: store.player?.x || 0,
      z: store.player?.z || 40,
      heading: store.player?.heading || Math.PI,
    }

    rig.debugPlace({
      x: outside.x,
      z: outside.z,
      heading,
      floor: 0,
      pulse: `Physics verification against ${target.address || target.id}.`,
    })

    return {
      id: target.id,
      address: target.address || target.name || target.id,
      x: target.x,
      z: target.z,
      w: target.w,
      d: target.d,
      rot: target.rot || 0,
      entryFace,
      blockedFace,
      outside,
      inside,
      heading,
      original,
    }
  })

  assert(setup?.id, 'No solid building was available for player collision verification')
  await page.waitForFunction(({ outside }) => {
    const player = window.__REALCITY_STORE__?.getState()?.player
    return player && Math.hypot(player.x - outside.x, player.z - outside.z) < 1.8
  }, setup, { timeout: 5000 })

  const beforeWall = await getPlayer(page)
  await holdKey(page, 'KeyW', 1600)
  await page.waitForTimeout(250)
  const wallCollision = await page.evaluate(({ id, x, z, w, d, rot, inside }) => {
    const player = window.__REALCITY_STORE__?.getState()?.player
    const interior = window.__REALCITY_COLLISION__?.currentInterior(window.__REALCITY_CITY__, player.x, player.z)
    const dx = player.x - x
    const dz = player.z - z
    const cos = Math.cos(-(rot || 0))
    const sin = Math.sin(-(rot || 0))
    const local = {
      x: dx * cos - dz * sin,
      z: dx * sin + dz * cos,
    }
    return {
      player,
      interiorId: interior?.id || null,
      insideFootprint: Math.abs(local.x) < w / 2 - 0.72 && Math.abs(local.z) < d / 2 - 0.72,
      local,
      distanceToBlockedInside: Math.hypot(player.x - inside.x, player.z - inside.z),
      targetId: id,
    }
  }, setup)

  assert(wallCollision.interiorId !== setup.id, `Player clipped into a blocked building interior: ${JSON.stringify(wallCollision)}`)
  assert(!wallCollision.insideFootprint, `Player crossed a solid side/back wall footprint: ${JSON.stringify(wallCollision)}`)
  assert(wallCollision.distanceToBlockedInside > 1.8, `Player ended too close to the blocked inside probe: ${JSON.stringify(wallCollision)}`)

  await page.evaluate(original => {
    window.__REALCITY_PLAYER_RIG__?.debugPlace?.({
      x: original.x,
      z: original.z,
      heading: original.heading,
      floor: 0,
    })
  }, setup.original)
  await page.waitForFunction(original => {
    const player = window.__REALCITY_STORE__?.getState()?.player
    return player && Math.hypot(player.x - original.x, player.z - original.z) < 2.5
  }, setup.original, { timeout: 5000 })

  await page.waitForTimeout(250)
  const beforeJump = await getPlayer(page)
  await holdKey(page, 'Space', 110)
  const jumpSamples = []
  for (let i = 0; i < 22; i += 1) {
    await page.waitForTimeout(120)
    jumpSamples.push(await getPlayer(page))
  }
  const maxY = Math.max(...jumpSamples.map(sample => sample.y))
  const minY = Math.min(...jumpSamples.map(sample => sample.y))
  const finalY = jumpSamples.at(-1)?.y ?? beforeJump.y
  assert(maxY - beforeJump.y > 0.85, `Space did not produce a measurable jump arc: ${JSON.stringify({ beforeJump, maxY, samples: jumpSamples.slice(0, 6) })}`)
  assert(finalY <= beforeJump.y + 0.45, `Gravity did not bring the player back to the ground: ${JSON.stringify({ beforeJumpY: beforeJump.y, finalY, maxY })}`)
  assert(minY >= beforeJump.y - 0.2, `Player fell below terrain baseline during jump: ${JSON.stringify({ beforeJumpY: beforeJump.y, minY, maxY })}`)

  return {
    wallTarget: setup.id,
    wallAddress: setup.address,
    blockedFace: setup.blockedFace,
    beforeWall: {
      x: Number(beforeWall.x.toFixed(2)),
      z: Number(beforeWall.z.toFixed(2)),
    },
    afterWall: {
      x: Number(wallCollision.player.x.toFixed(2)),
      z: Number(wallCollision.player.z.toFixed(2)),
      interiorId: wallCollision.interiorId,
      insideFootprint: wallCollision.insideFootprint,
    },
    jump: {
      baselineY: Number(beforeJump.y.toFixed(2)),
      maxY: Number(maxY.toFixed(2)),
      finalY: Number(finalY.toFixed(2)),
      arcMeters: Number((maxY - beforeJump.y).toFixed(2)),
      samples: jumpSamples.length,
    },
  }
}

async function inspectResponsivePerformance(browser) {
  const mobileErrors = []
  const mobilePageErrors = []
  const mobile = await browser.newPage({
    viewport: { width: 390, height: 844 },
    deviceScaleFactor: 1,
    isMobile: true,
  })
  mobile.on('console', message => {
    if (message.type() === 'error') mobileErrors.push(message.text())
  })
  mobile.on('pageerror', error => mobilePageErrors.push(error.message))

  try {
    await mobile.goto(baseUrl, { waitUntil: 'domcontentloaded', timeout: 45000 })
    await mobile.locator('canvas').first().waitFor({ state: 'visible', timeout: 30000 })
    await mobile.locator('.prompt-stack').waitFor({ state: 'visible', timeout: 12000 })
    await mobile.waitForTimeout(2200)

    const canvas = await inspectCanvas(mobile, {
      minWidth: 320,
      minHeight: 640,
      minDataUrlLength: 12000,
    })
    const layout = await mobile.evaluate(() => {
      const viewport = { width: window.innerWidth, height: window.innerHeight }
      const selectors = ['.time-card', '.compass', '.prompt-stack', '.map-shell', '.phone-toggle', '.agent-card']
      const rectFor = selector => {
        const node = document.querySelector(selector)
        if (!node) return null
        const style = window.getComputedStyle(node)
        const rect = node.getBoundingClientRect()
        return {
          selector,
          visible: style.display !== 'none' && style.visibility !== 'hidden' && rect.width > 0 && rect.height > 0,
          left: rect.left,
          top: rect.top,
          right: rect.right,
          bottom: rect.bottom,
          width: rect.width,
          height: rect.height,
          withinViewport: rect.left >= -1 && rect.top >= -1 && rect.right <= viewport.width + 1 && rect.bottom <= viewport.height + 1,
        }
      }
      const rects = selectors.map(rectFor).filter(Boolean)
      const bySelector = Object.fromEntries(rects.map(rect => [rect.selector, rect]))
      const overlapRatio = (a, b) => {
        if (!a || !b) return 0
        const width = Math.max(0, Math.min(a.right, b.right) - Math.max(a.left, b.left))
        const height = Math.max(0, Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top))
        const area = width * height
        const smallest = Math.max(1, Math.min(a.width * a.height, b.width * b.height))
        return area / smallest
      }
      const pairs = [
        ['.time-card', '.compass'],
        ['.prompt-stack', '.phone-toggle'],
        ['.prompt-stack', '.agent-card'],
        ['.map-shell', '.phone-toggle'],
      ].map(([a, b]) => ({ a, b, ratio: overlapRatio(bySelector[a], bySelector[b]) }))
      const overflowingText = Array.from(document.querySelectorAll('.prompt-stack button, .time-card, .agent-card'))
        .filter(node => node.scrollWidth > node.clientWidth + 3 || node.scrollHeight > node.clientHeight + 8)
        .map(node => ({
          className: node.className,
          text: node.textContent?.trim().slice(0, 80),
          scrollWidth: node.scrollWidth,
          clientWidth: node.clientWidth,
          scrollHeight: node.scrollHeight,
          clientHeight: node.clientHeight,
        }))
      const canvasRect = document.querySelector('canvas')?.getBoundingClientRect()
      return { viewport, rects, pairs, overflowingText, canvasRect }
    })

    assert(layout.viewport.width === 390 && layout.viewport.height === 844, `Mobile viewport was not applied: ${JSON.stringify(layout.viewport)}`)
    assert(layout.canvasRect?.width >= 380 && layout.canvasRect?.height >= 820, `Mobile canvas does not fill the viewport: ${JSON.stringify(layout.canvasRect)}`)
    const offscreen = layout.rects.filter(rect => rect.visible && !rect.withinViewport)
    assert(offscreen.length === 0, `Mobile HUD elements overflow the viewport: ${JSON.stringify(offscreen)}`)
    const badOverlaps = layout.pairs.filter(pair => pair.ratio > 0.08)
    assert(badOverlaps.length === 0, `Mobile HUD elements overlap too much: ${JSON.stringify(badOverlaps)}`)
    assert(layout.overflowingText.length === 0, `Mobile HUD text overflows its containers: ${JSON.stringify(layout.overflowingText)}`)
    assert(mobileErrors.length === 0, `Mobile console errors were reported: ${mobileErrors.join(' | ')}`)
    assert(mobilePageErrors.length === 0, `Mobile page errors were reported: ${mobilePageErrors.join(' | ')}`)

    return {
      viewport: layout.viewport,
      canvas: canvas.largest,
      hudRects: layout.rects.map(rect => ({
        selector: rect.selector,
        width: Math.round(rect.width),
        height: Math.round(rect.height),
        left: Math.round(rect.left),
        top: Math.round(rect.top),
      })),
      maxOverlapRatio: Number(Math.max(0, ...layout.pairs.map(pair => pair.ratio)).toFixed(3)),
      textOverflowCount: layout.overflowingText.length,
    }
  } finally {
    await mobile.close()
  }
}

function collectOllamaStatus() {
  try {
    const result = spawnSync('ollama', ['list'], { encoding: 'utf8', timeout: 10000 })
    return {
      ok: result.status === 0,
      stdout: result.stdout.trim(),
      stderr: result.stderr.trim(),
    }
  } catch (error) {
    return {
      ok: false,
      stdout: '',
      stderr: error instanceof Error ? error.message : String(error),
    }
  }
}

async function main() {
  mkdirSync(artifactsDir, { recursive: true })
  const server = startDevServer()
  let browser
  const consoleErrors = []
  const pageErrors = []
  let task = randomTasks[Math.floor(Math.random() * randomTasks.length)]
  let addressRoute = null

  try {
    await waitForServer()
    const executablePath = findBrowserExecutable()
    assert(executablePath, 'Chrome or Edge executable was not found for Playwright verification')

    browser = await chromium.launch({
      executablePath,
      headless: true,
      args: ['--ignore-gpu-blocklist', '--enable-webgl', '--use-gl=swiftshader'],
    })

    const page = await browser.newPage({ viewport: { width: 1440, height: 920 }, deviceScaleFactor: 1 })
    page.on('console', message => {
      if (message.type() === 'error') consoleErrors.push(message.text())
    })
    page.on('pageerror', error => pageErrors.push(error.message))

    await page.goto(baseUrl, { waitUntil: 'domcontentloaded', timeout: 45000 })
    await page.locator('canvas').first().waitFor({ state: 'visible', timeout: 30000 })
    await page.waitForTimeout(2500)

    const canvas = await inspectCanvas(page)
    const buildingAccess = await inspectBuildingAccess(page)
    const interiors = await inspectLandmarkInteriors(page)
    const cityNorms = await inspectCityNorms(page)
    const actorRendering = await inspectActorRendering(page)
    const multiplayer = await inspectMultiplayer(page)
    const supportUX = await inspectSupportUX(page)
    const mapCoordinateResilience = await inspectMapCoordinateResilience(page)
    const skyState = await page.evaluate(() => window.__REALCITY_STORE__?.getState().sky || null)
    assert(skyState && typeof skyState.sunElevation === 'number' && skyState.phase && typeof skyState.reflection === 'number', 'Day-night sky state was not exposed')
    const collisionAndMaterials = await inspectCollisionAndMaterials(page)
    const agentAutonomy = await inspectAgentAutonomy(page)
    const socialReaction = await inspectDeterministicSocialReaction(page)
    const dailyRoutine = await inspectDailyRoutineTimeShift(page)
    const streetRendering = await inspectStreetRendering(page)
    const automaticDoors = await inspectAutomaticDoors(page)
    const interiorState = await inspectInteriorStateAndFloors(page)
    const playerPhysics = await inspectPlayerPhysicsAndCollision(page)
    const initialScreenshotPath = path.join(artifactsDir, 'realcity-initial-core.png')
    await page.screenshot({ path: initialScreenshotPath, fullPage: false })
    addressRoute = await page.evaluate(() => {
      const city = window.__REALCITY_CITY__
      const player = window.__REALCITY_STORE__?.getState().player || { x: 0, z: 40 }
      const addresses = [...(city?.addressBook || [])]
      const target = addresses
        .filter(place => place.address && Math.hypot(place.x - player.x, place.z - player.z) > 520)
        .filter(place => Math.abs(place.x - player.x) > 220 && Math.abs(place.z - player.z) > 220)
        .sort((a, b) => Math.hypot(b.x - player.x, b.z - player.z) - Math.hypot(a.x - player.x, a.z - player.z))[0]
        || addresses
          .filter(place => place.address && Math.hypot(place.x - player.x, place.z - player.z) > 520)
          .sort((a, b) => Math.hypot(b.x - player.x, b.z - player.z) - Math.hypot(a.x - player.x, a.z - player.z))[0]
      return target
        ? { id: target.id, name: target.name, address: target.address, roadName: target.roadName }
        : null
    })
    if (addressRoute?.address) task = `Take me to ${addressRoute.address}. Use a taxi and stay with me until we arrive.`
    const phone = await inspectPhone(page)
    await page.locator('.map-shell').click()
    await page.locator('.full-map-panel').waitFor({ state: 'visible', timeout: 10000 })
    const mapText = await page.locator('.full-map-panel').innerText({ timeout: 5000 })
    assert(mapText.includes('RealCity Map'), 'Full map popup did not open from the minimap')
    assert(/live gps fix/i.test(mapText), `Full map did not show a GPS-style live fix panel: ${mapText}`)
    assert(await page.locator('.full-map-player').count() === 1, 'Full map did not include the player marker')
    assert(await page.locator('.minimap-gps').count() === 1, 'Minimap did not render the GPS coordinate overlay')
    assert(await page.locator('.full-map-controls').count() === 1, 'Full map did not render interactive map controls')
    assert(await page.locator('.full-map-buildings rect').count() > 20, 'Full map did not render building footprints')
    assert(await page.locator('.full-map-live-vehicles rect').count() > 0, 'Full map did not render live vehicle positions')
    assert(await page.locator('.full-map-live-pedestrians circle').count() > 0, 'Full map did not render live NPC positions')
    const zoomBefore = Number(await page.locator('.full-city-map').getAttribute('data-zoom', { timeout: 5000 }))
    await page.locator('.full-map-controls button[aria-label="Zoom in"]').click()
    await page.waitForFunction(previous => {
      const zoom = Number(document.querySelector('.full-city-map')?.getAttribute('data-zoom') || 0)
      return zoom > previous
    }, zoomBefore, { timeout: 5000 })
    const zoomAfter = Number(await page.locator('.full-city-map').getAttribute('data-zoom', { timeout: 5000 }))
    assert(zoomAfter > zoomBefore, `Full map zoom control did not increase zoom: ${zoomBefore} -> ${zoomAfter}`)
    const mapBox = await page.locator('.full-city-map').boundingBox()
    assert(mapBox, 'Full map SVG bounding box was unavailable for pan verification')
    const viewBoxBeforePan = await page.locator('.full-city-map').getAttribute('viewBox', { timeout: 5000 })
    await page.mouse.move(mapBox.x + mapBox.width * 0.52, mapBox.y + mapBox.height * 0.52)
    await page.mouse.down()
    await page.mouse.move(mapBox.x + mapBox.width * 0.68, mapBox.y + mapBox.height * 0.6, { steps: 5 })
    await page.mouse.up()
    await page.waitForFunction(previous => {
      const map = document.querySelector('.full-city-map')
      return map?.getAttribute('data-follow') === 'false' && map.getAttribute('viewBox') !== previous
    }, viewBoxBeforePan, { timeout: 5000 })
    await page.locator('.full-map-controls button', { hasText: 'GPS' }).click()
    await page.waitForFunction(() => document.querySelector('.full-city-map')?.getAttribute('data-follow') === 'true', null, { timeout: 5000 })
    await page.locator('.full-map-header button').click()
    await page.locator('.full-map-panel').waitFor({ state: 'hidden', timeout: 10000 })

    const beforeTurn = await getPlayer(page)
    await holdKey(page, 'KeyA', 900)
    const afterTurn = await getPlayer(page)
    assert(Math.abs(angleDiff(afterTurn.heading, beforeTurn.heading)) > 0.18, 'A key did not rotate avatar heading')
    assert(positionDistance(afterTurn, beforeTurn) < 1.2, 'A key moved the avatar instead of only rotating heading')

    const beforeLook = await getPlayer(page)
    await dispatchKey(page, 'ArrowLeft', 'keydown')
    await page.waitForTimeout(450)
    const duringLook = await getPlayer(page)
    await dispatchKey(page, 'ArrowLeft', 'keyup')
    await page.waitForTimeout(1200)
    const afterLook = await getPlayer(page)
    assert(Math.abs(angleDiff(duringLook.heading, beforeLook.heading)) < 0.08, 'Arrow key changed avatar heading')
    assert(Math.abs(angleDiff(duringLook.viewHeading, duringLook.heading)) > 0.18, 'Arrow key did not move temporary camera view')
    assert(Math.abs(angleDiff(afterLook.viewHeading, afterLook.heading)) < 0.18, 'Camera view did not return after releasing arrow key')

    const beforeMove = await getPlayer(page)
    await holdKey(page, 'KeyW', 1800)
    const afterMove = await getPlayer(page)
    const forwardDistance = positionDistance(afterMove, beforeMove)
    const movementContext = await page.evaluate(() => {
      const state = window.__REALCITY_STORE__?.getState()
      const player = state?.player || { x: 0, z: 0 }
      const nearbyPedestrians = (state?.pedestrianSamples || [])
        .map(sample => ({
          id: sample.id,
          state: sample.state,
          routeMode: sample.routeMode,
          x: Number(sample.x.toFixed(2)),
          z: Number(sample.z.toFixed(2)),
          d: Number(Math.hypot(sample.x - player.x, sample.z - player.z).toFixed(2)),
        }))
        .filter(sample => sample.d < 18)
        .sort((a, b) => a.d - b.d)
        .slice(0, 6)
      const nearbyVehicles = (state?.vehicleSamples || [])
        .map(sample => ({
          id: sample.id,
          kind: sample.kind,
          x: Number(sample.x.toFixed(2)),
          z: Number(sample.z.toFixed(2)),
          d: Number(Math.hypot(sample.x - player.x, sample.z - player.z).toFixed(2)),
        }))
        .filter(sample => sample.d < 18)
        .sort((a, b) => a.d - b.d)
        .slice(0, 6)
      return { player, nearbyPedestrians, nearbyVehicles }
    })
    assert(forwardDistance > 1.2, `W key did not move the avatar forward far enough: ${forwardDistance.toFixed(2)}m ${JSON.stringify({ beforeMove, afterMove, movementContext })}`)
    const walkingEscort = await inspectWalkingEscort(page)

    await dispatchKey(page, 'KeyE', 'keydown')
    await dispatchKey(page, 'KeyE', 'keyup')
    await page.locator('.interaction-panel textarea').waitFor({ state: 'visible', timeout: 10000 })
    const requestPlaceholder = await page.locator('.interaction-panel textarea').getAttribute('placeholder', { timeout: 5000 })
    assert(requestPlaceholder && /데려다|택시/.test(requestPlaceholder) && !BROKEN_TEXT_PATTERN.test(requestPlaceholder), `Interaction request placeholder is not readable: ${requestPlaceholder}`)
    await page.locator('.interaction-panel textarea').fill(task)
    await page.locator('.interaction-panel button[type="submit"]').click()
    await page.locator('.mission-panel').waitFor({ state: 'visible', timeout: 35000 })
    const missionText = await page.locator('.mission-panel').innerText({ timeout: 5000 })
    assert(/escort/i.test(missionText), `Mission panel did not describe an escort: ${missionText}`)
    assert(!BROKEN_TEXT_PATTERN.test(missionText), `Mission panel contains mojibake text: ${missionText}`)
    if (addressRoute?.address) assert(missionText.includes(addressRoute.address), `Mission panel did not resolve the requested address ${addressRoute.address}: ${missionText}`)
    const missionPlan = await page.evaluate(() => {
      const state = window.__REALCITY_STORE__?.getState()
      const mission = state?.mission || {}
      const focused = state?.focusedAgent || {}
      return {
        reasoning: mission.reasoning || '',
        safety: mission.safety || '',
        offer: mission.offer || '',
        urgency: mission.urgency || '',
        source: mission.source || '',
        requestEvents: (state?.cityEvents || []).filter(event => event.kind === 'request' && event.agentId === mission.agentId).length,
        focusedMemory: focused.memories?.[0]?.text || '',
      }
    })
    assert(missionPlan.reasoning && missionPlan.safety && missionPlan.offer && missionPlan.urgency, `NPC action plan did not expose reasoning/safety/offer/urgency: ${JSON.stringify(missionPlan)}`)
    assert(!BROKEN_TEXT_PATTERN.test(`${missionPlan.reasoning} ${missionPlan.safety} ${missionPlan.offer}`), `NPC mission plan contains mojibake text: ${JSON.stringify(missionPlan)}`)
    assert(/sidewalk|curb|taxi|road|crosswalk|lane/i.test(missionPlan.safety), `NPC safety norm is not concrete enough: ${JSON.stringify(missionPlan)}`)
    assert(missionPlan.requestEvents >= 1 && /Player asked/i.test(missionPlan.focusedMemory), `NPC request memory/event was not recorded: ${JSON.stringify(missionPlan)}`)
    assert(missionText.includes(missionPlan.offer.slice(0, 24)), `Mission panel did not display the NPC offer: ${JSON.stringify({ missionText, missionPlan })}`)

    await page.waitForFunction(() => {
      const state = window.__REALCITY_STORE__?.getState()
      return state?.mission?.taxi?.path?.length >= 2 && (state.mission.taxi.destinationPath?.length >= 2 || state.mission.route?.length >= 2)
    }, null, { timeout: 35000 })
    const taxiDispatch = await getTaxiRouteState(page)
    assert(['taxi_dispatch', 'taxi_waiting', 'taxi_ride'].includes(taxiDispatch.missionPhase), `Taxi did not enter a dispatch/wait/ride phase: ${taxiDispatch.missionPhase}`)
    assert(taxiDispatch.dispatchPathPoints >= 2, `Taxi dispatch path was not created: ${JSON.stringify(taxiDispatch)}`)
    assert(taxiDispatch.destinationPathPoints >= 2, `Taxi destination road path was not plotted: ${JSON.stringify(taxiDispatch)}`)
    assert(taxiDispatch.dispatchMeters > 80, `Taxi pickup route was too short to prove it drove in from the street: ${JSON.stringify(taxiDispatch)}`)
    assert(taxiDispatch.taxiSpeed <= 20, `Taxi dispatch speed is too fast for city driving: ${JSON.stringify(taxiDispatch)}`)
    assert(taxiDispatch.taxiSource === 'fleet' && taxiDispatch.fleetCarId, `Taxi request did not select an existing cruising fleet taxi: ${JSON.stringify(taxiDispatch)}`)
    assert(taxiDispatch.dispatchDistanceFromCruise > 0, `Taxi dispatch did not record distance from the cruising taxi pose: ${JSON.stringify(taxiDispatch)}`)
    assert(taxiDispatch.taxiLoopSamples >= 8 || taxiDispatch.assignedVehicleSamples >= 1, `Taxi fleet loop samples were not present during dispatch: ${JSON.stringify(taxiDispatch)}`)
    assert(taxiDispatch.pickupStopRoadStatus?.insideRoad, `Taxi pickup stop is not inside the vehicle lane: ${JSON.stringify(taxiDispatch)}`)
    assert(taxiDispatch.passengerPickupRoadStatus?.outsideRoad, `Passenger pickup point should stay on the curb/sidewalk, not the vehicle lane: ${JSON.stringify(taxiDispatch)}`)
    assert(taxiDispatch.dispatchLaneStats.samples > 0 && taxiDispatch.dispatchLaneStats.laneLike > taxiDispatch.dispatchLaneStats.centerline, `Taxi dispatch route still looks centerline-based instead of lane-based: ${JSON.stringify(taxiDispatch)}`)
    assert(taxiDispatch.dispatchMaxHeadingDelta < 1.2, `Taxi dispatch path still has a hard 90-degree corner: ${JSON.stringify(taxiDispatch)}`)

    await page.locator('.map-shell').click()
    await page.locator('.full-map-panel').waitFor({ state: 'visible', timeout: 10000 })
    assert(await page.locator('.full-map-route').count() === 1, 'Full map did not render the taxi route polyline')
    const dispatchMapRoutePoints = await page.locator('.full-map-route').getAttribute('points', { timeout: 5000 })
    const dispatchMapPointCount = dispatchMapRoutePoints.trim().split(/\s+/).filter(Boolean).length
    if (taxiDispatch.missionPhase === 'taxi_dispatch') {
      assert(dispatchMapPointCount === taxiDispatch.dispatchPathPoints, `Map did not show the taxi pickup route while the taxi was coming: ${dispatchMapPointCount} vs ${taxiDispatch.dispatchPathPoints}`)
    }
    await page.locator('.full-map-header button').click()
    await page.locator('.full-map-panel').waitFor({ state: 'hidden', timeout: 10000 })

    try {
      await page.waitForFunction(() => {
        const phase = window.__REALCITY_STORE__?.getState()?.mission?.phase
        return phase === 'taxi_waiting'
      }, null, { timeout: 90000 })
    } catch (error) {
      const debugTaxi = await getTaxiRouteState(page)
      throw new Error(`Taxi never reached manual boarding state: ${JSON.stringify(debugTaxi)}`)
    }
    const beforeBoard = await getTaxiRouteState(page)
    assert(beforeBoard.missionPhase === 'taxi_waiting' && !beforeBoard.boardingRequested, `Taxi should wait for manual boarding: ${JSON.stringify(beforeBoard)}`)
    assert(beforeBoard.pickupStopRoadStatus?.insideRoad && beforeBoard.passengerPickupRoadStatus?.outsideRoad, `Taxi did not wait in-lane while passengers stayed curbside: ${JSON.stringify(beforeBoard)}`)
    if (beforeBoard.taxiPose && beforeBoard.pickupStop) {
      const stopDistance = Math.hypot(beforeBoard.taxiPose.x - beforeBoard.pickupStop.x, beforeBoard.taxiPose.z - beforeBoard.pickupStop.z)
      assert(stopDistance < 3.2, `Taxi stopped away from the curb-lane pickup point: ${stopDistance.toFixed(2)}m ${JSON.stringify(beforeBoard)}`)
    }
    await dispatchKey(page, 'KeyF', 'keydown')
    await dispatchKey(page, 'KeyF', 'keyup')
    await page.waitForFunction(() => {
      const mission = window.__REALCITY_STORE__?.getState()?.mission
      return !!mission?.boardingRequested && ['taxi_boarding', 'taxi_ride'].includes(mission.phase)
    }, null, { timeout: 10000 })
    const boardingTaxi = await getTaxiRouteState(page)
    assert(boardingTaxi.boardingRequested && boardingTaxi.boardingStartedAt > 0, `Taxi boarding did not expose a timed boarding phase: ${JSON.stringify(boardingTaxi)}`)

    try {
      await page.waitForFunction(() => {
        const state = window.__REALCITY_STORE__?.getState()
        return state?.ride?.path?.length >= 2 && state.ride.routeMeters > 0
      }, null, { timeout: 90000 })
    } catch (error) {
      const debugTaxi = await getTaxiRouteState(page)
      throw new Error(`Taxi did not start after manual F boarding: ${JSON.stringify(debugTaxi)}`)
    }
    const taxiRide = await getTaxiRouteState(page)
    assert(taxiRide.ridePathPoints >= 2, `Taxi ride did not use a road path: ${JSON.stringify(taxiRide)}`)
    assert(taxiRide.routeMeters >= Math.max(1, taxiRide.directMeters * 0.9), `Taxi ride route distance was implausible: ${JSON.stringify(taxiRide)}`)
    assert(taxiRide.rideDuration >= taxiRide.routeMeters / 25 - 0.5, `Taxi ride duration is too short for the road distance: ${JSON.stringify(taxiRide)}`)
    assert(taxiRide.taxiPose && Number.isFinite(taxiRide.taxiPose.x) && Number.isFinite(taxiRide.taxiPose.z), `Taxi vehicle pose was not updated during ride: ${JSON.stringify(taxiRide)}`)
    assert(taxiRide.destinationLaneStats.samples > 0 && taxiRide.destinationLaneStats.laneLike > taxiRide.destinationLaneStats.centerline, `Taxi ride route still follows road centerlines instead of traffic lanes: ${JSON.stringify(taxiRide)}`)
    assert(taxiRide.destinationMaxHeadingDelta < 1.2, `Taxi ride still turns with a hard 90-degree corner: ${JSON.stringify(taxiRide)}`)
    assert(taxiRide.rideExitPoint, `Taxi ride did not preserve a curbside passenger exit point: ${JSON.stringify(taxiRide)}`)

    await page.locator('.mission-panel').waitFor({ state: 'hidden', timeout: 120000 })
    await page.waitForTimeout(700)
    const finalState = await page.evaluate(() => {
      const state = window.__REALCITY_STORE__?.getState()
      return state
        ? {
            mission: state.mission,
            ride: state.ride,
            interactionStatus: state.interaction?.status,
            pulse: state.pulse,
          }
        : null
    })
    const finalPlayer = await getPlayer(page)
    assert(finalState && !finalState.mission && !finalState.ride && finalState.interactionStatus === 'done', 'Mission state did not complete cleanly')
    assert(positionDistance(finalPlayer, afterMove) > 50, 'Avatar did not travel a meaningful distance during the random task')

    const screenshotPath = path.join(artifactsDir, 'realcity-last-run.png')
    await page.screenshot({ path: screenshotPath, fullPage: false })
    const phoneDirectTaxi = await inspectPhoneDirectTaxiDispatch(page)
    const phoneSocialActions = await inspectPhoneSocialActions(page)
    const responsivePerformance = await inspectResponsivePerformance(browser)
    assert(consoleErrors.length === 0, `Console errors were reported: ${consoleErrors.join(' | ')}`)
    assert(pageErrors.length === 0, `Page errors were reported: ${pageErrors.join(' | ')}`)

    const report = {
      checkedAt: new Date().toISOString(),
      url: baseUrl,
      task,
      addressRoute,
      browser: executablePath,
      canvas,
      buildingAccess,
      interiors,
      cityNorms,
      actorRendering,
      multiplayer,
      supportUX,
      mapCoordinateResilience,
      skyState,
      collisionAndMaterials,
      agentAutonomy,
      socialReaction,
      dailyRoutine,
      streetRendering,
      automaticDoors,
      interiorState,
      playerPhysics,
      phone,
      phoneDirectTaxi,
      phoneSocialActions,
      walkingEscort,
      responsivePerformance,
      controls: {
        headingChangedByA: Math.abs(angleDiff(afterTurn.heading, beforeTurn.heading)),
        arrowViewOffset: Math.abs(angleDiff(duringLook.viewHeading, duringLook.heading)),
        arrowReturnOffset: Math.abs(angleDiff(afterLook.viewHeading, afterLook.heading)),
        forwardDistance,
      },
      missionText,
      taxiDispatch,
      taxiRide,
      finalState,
      finalDistrict: finalPlayer.district,
      travelDistance: positionDistance(finalPlayer, afterMove),
      ollama: collectOllamaStatus(),
      consoleErrors,
      pageErrors,
      serverLogTail: server.logs.join('').split(/\r?\n/).slice(-30),
      initialScreenshotPath,
      screenshotPath,
    }
    writeFileSync(path.join(artifactsDir, 'realcity-last-run.json'), JSON.stringify(report, null, 2))
    console.log(JSON.stringify({ ok: true, task, finalDistrict: finalPlayer.district, buildingAccess, screenshotPath }, null, 2))
  } finally {
    if (browser) await browser.close()
    stopDevServer(server.child)
  }
}

main().catch(error => {
  console.error(error)
  process.exit(1)
})
