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

function assert(condition, message) {
  if (!condition) throw new Error(message)
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
    const mission = state?.mission
    const ride = state?.ride
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
      taxiPose: ride?.taxiPose || mission?.taxi?.pose || null,
      taxiSpeed: mission?.taxi?.speed || null,
      rideDuration: ride?.duration || 0,
      rideProgress: ride?.progress || 0,
    }
  })
}

async function inspectCanvas(page) {
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
  assert(largest.width >= 600 && largest.height >= 400, `Main canvas is too small: ${largest.width}x${largest.height}`)
  assert(!largest.sampleError, `Canvas pixel sample failed: ${largest.sampleError}`)
  assert(largest.dataUrlLength > 20000, `Canvas appears blank or too small: data URL length ${largest.dataUrlLength}`)
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
      }))
  })
  assert(Array.isArray(interiors), 'City metadata was not exposed for interior verification')
  assert(interiors.length >= 8, 'Expected landmark interiors for most named buildings')
  const broken = interiors.filter(item => !item.hasInterior || !item.solidWalls || item.doorWidth <= 0 || !item.verticalCore || item.floorCount <= 0 || item.lobbyZones < 3)
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
    const entryFaces = new Set(city.buildings.map(building => building.facadePlan?.entryFace).filter(Boolean))
    const buildingInteriors = city.buildings.filter(building => building.interior?.solidWalls && building.interior?.floors >= 1 && building.interior?.lobbyDepth > 0 && building.interior?.verticalCore && Array.isArray(building.interior?.zones) && building.interior.zones.length >= 4)
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
      entryFaceVariants: entryFaces.size,
      buildingInteriors: buildingInteriors.length,
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
  assert(norms.entryFaceVariants >= 4, `Building entry faces do not vary enough: ${norms.entryFaceVariants}`)
  assert(norms.buildingInteriors === norms.buildingCount, 'Procedural building interior plans are incomplete')
  assert(norms.interiorCoreTypes >= 3, `Building vertical core types are not diverse enough: ${norms.interiorCoreTypes}`)
  assert(norms.corridorTypes >= 4, `Building corridor/interior layouts are not diverse enough: ${norms.corridorTypes}`)
  assert(norms.buildingRoadConflicts === 0, `${norms.buildingRoadConflicts} buildings overlap road reserves`)
  assert(norms.landmarkRoadConflicts === 0, `${norms.landmarkRoadConflicts} landmarks overlap road reserves: ${norms.landmarkRoadConflictIds.join(', ')}`)
  assert(norms.buildingProfiles.length >= 12, `Building massing profiles are not diverse enough: ${norms.buildingProfiles.join(', ')}`)
  assert(norms.houseProfiles.length >= 4, `House profiles are not diverse enough: ${norms.houseProfiles.join(', ')}`)
  assert(norms.houseRoofs.length >= 3, `House roof styles are not diverse enough: ${norms.houseRoofs.join(', ')}`)
  assert(norms.houseAccessoryCount >= 20, 'Houses did not receive enough porches, garages, chimneys, or wings')
  assert(norms.laneViolations === 0, `${norms.laneViolations} cars violate right-hand lane placement`)
  assert(norms.trafficRules?.drivingSide === 'right-hand' && norms.trafficRules?.signals, 'Traffic rule metadata is incomplete')
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
  assert(norms.treeRoadConflicts === 0, `${norms.treeRoadConflicts} trees overlap road reserves`)
  assert(norms.socialNorms?.pedestrian && norms.socialNorms?.traffic && norms.socialNorms?.addressSystem && norms.socialNorms?.zoning && norms.socialNorms?.npcDiversity && norms.socialNorms?.collision && norms.socialNorms?.streetHierarchy && norms.socialNorms?.facadeSystem, 'Social norm metadata is incomplete')
  return norms
}

async function inspectSupportUX(page) {
  await page.locator('.prompt-stack').waitFor({ state: 'visible', timeout: 10000 })
  const promptText = await page.locator('.prompt-stack').innerText({ timeout: 5000 })
  assert(promptText.includes('Taxi') && promptText.includes('Map') && promptText.includes('Phone'), `Context prompt actions are incomplete: ${promptText}`)
  assert(promptText.includes('W/S') && promptText.includes('A/D') && promptText.includes('Space'), `Movement guide is incomplete: ${promptText}`)

  await dispatchKey(page, 'KeyT', 'keydown')
  await dispatchKey(page, 'KeyT', 'keyup')
  await page.locator('.phone-device').waitFor({ state: 'visible', timeout: 10000 })
  const taxiText = await page.locator('.phone-device').innerText({ timeout: 5000 })
  assert(taxiText.includes('Taxi') && await page.locator('.phone-route-list button').count() > 0, `T key did not open the phone taxi app: ${taxiText}`)
  await page.locator('.phone-close').click()
  await page.locator('.phone-device').waitFor({ state: 'hidden', timeout: 10000 })

  return {
    prompt: promptText.split(/\r?\n/).slice(0, 16),
    taxiShortcut: taxiText.split(/\r?\n/).slice(0, 12),
  }
}

async function inspectPhone(page) {
  await page.locator('.phone-toggle').click()
  await page.locator('.phone-device').waitFor({ state: 'visible', timeout: 10000 })
  await page.locator('.phone-tabs button[data-tab="messages"]').click()
  const homeText = await page.locator('.phone-device').innerText({ timeout: 5000 })
  assert(homeText.includes('RealPhone'), 'Phone shell did not open')
  assert(homeText.includes('Msg') && homeText.includes('People') && homeText.includes('Feed') && homeText.includes('Taxi') && homeText.includes('Music'), 'Phone app tabs were missing')
  assert(await page.locator('.phone-message-form input').count() === 1, 'Phone message composer was missing')

  await page.locator('.phone-tabs button[data-tab="contacts"]').click()
  const contactsText = await page.locator('.phone-device').innerText({ timeout: 5000 })
  assert(contactsText.includes('Call'), 'Phone contacts did not expose calling')

  await page.locator('.phone-tabs button[data-tab="music"]').click()
  const musicText = await page.locator('.phone-device').innerText({ timeout: 5000 })
  assert(musicText.includes('Han River FM') && musicText.includes('Play'), 'Phone music app was incomplete')

  await page.locator('.phone-tabs button[data-tab="taxi"]').click()
  const taxiText = await page.locator('.phone-device').innerText({ timeout: 5000 })
  assert(taxiText.includes('Taxi') && await page.locator('.phone-route-list button').count() > 0, 'Phone taxi app did not expose route targets')

  await page.locator('.phone-close').click()
  await page.locator('.phone-device').waitFor({ state: 'hidden', timeout: 10000 })
  return {
    home: homeText.split(/\r?\n/).slice(0, 12),
    contacts: contactsText.split(/\r?\n/).slice(0, 12),
    music: musicText.split(/\r?\n/).slice(0, 12),
    taxi: taxiText.split(/\r?\n/).slice(0, 12),
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
      npcWallViolations: npcWallViolations.map(sample => ({ id: sample.id, x: Number(sample.x.toFixed(2)), z: Number(sample.z.toFixed(2)), state: sample.state })).slice(0, 8),
      vehicleKinds: [...new Set((state?.vehicleSamples || []).map(sample => sample.kind).filter(Boolean))],
      vehicleBoundsReady: (state?.vehicleSamples || []).filter(sample => sample.width > 0 && sample.length > 0 && typeof sample.yaw === 'number').length,
      clouds: window.__REALCITY_CLOUDS__ || null,
      textures: window.__REALCITY_TEXTURES__ || null,
    }
  })

  assert(result.rules?.solidObjects?.includes('pedestrians') && result.rules?.solidObjects?.includes('vehicles'), 'Dynamic pedestrian/vehicle collision rules are missing')
  assert(result.rules?.solidObjects?.includes('buildings') && result.rules?.solidObjects?.includes('landmarks'), 'Static building/landmark collision rules are missing')
  assert(result.rules?.reactions?.includes('push-away') && result.rules?.reactions?.includes('fall') && result.rules?.reactions?.includes('driver-brake'), 'Collision reaction metadata is incomplete')
  assert(result.pedestrianSamples > 100, `Pedestrian collision samples are too sparse: ${result.pedestrianSamples}`)
  assert(result.npcWallViolations.length === 0, `NPCs are inside solid building walls: ${JSON.stringify(result.npcWallViolations)}`)
  assert(result.vehicleSamples === 120, `Vehicle collision samples are incomplete: ${result.vehicleSamples}`)
  assert(result.vehicleBoundsReady === result.vehicleSamples, 'Vehicle collision samples do not expose oriented bounds')
  assert(result.vehicleKinds.includes('taxi') && result.vehicleKinds.length >= 2, `Vehicle samples do not distinguish taxis and regular cars: ${result.vehicleKinds.join(', ')}`)
  assert(result.clouds?.system === 'layered-procedural-puffs', 'Cloud renderer did not switch to layered procedural puffs')
  assert(result.clouds.count >= 16 && result.clouds.averagePuffs >= 8, 'Cloud puff composition is too sparse')
  assert(result.clouds.hasFlattenedUndersides && result.clouds.maxVerticalAspect < 0.55, 'Clouds are still vertically stretched or lack flattened undersides')
  assert(result.textures?.procedural && result.textures.classes?.length >= 8, 'Procedural texture catalog was not exposed')
  assert(['cloud-vapor', 'city-fabric', 'skin-pores', 'vehicle-paint', 'rubber-tread', 'glass-smudge'].every(key => result.textures.classes.includes(key)), 'Core object texture classes are missing')
  return result
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
  return result
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
    const interiors = await inspectLandmarkInteriors(page)
    const cityNorms = await inspectCityNorms(page)
    const supportUX = await inspectSupportUX(page)
    const skyState = await page.evaluate(() => window.__REALCITY_STORE__?.getState().sky || null)
    assert(skyState && typeof skyState.sunElevation === 'number' && skyState.phase && typeof skyState.reflection === 'number', 'Day-night sky state was not exposed')
    const collisionAndMaterials = await inspectCollisionAndMaterials(page)
    const streetRendering = await inspectStreetRendering(page)
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
    assert(await page.locator('.full-map-player').count() === 1, 'Full map did not include the player marker')
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
    assert(forwardDistance > 1.2, `W key did not move the avatar forward far enough: ${forwardDistance.toFixed(2)}m`)

    await dispatchKey(page, 'KeyE', 'keydown')
    await dispatchKey(page, 'KeyE', 'keyup')
    await page.locator('.interaction-panel textarea').waitFor({ state: 'visible', timeout: 10000 })
    await page.locator('.interaction-panel textarea').fill(task)
    await page.locator('.interaction-panel button[type="submit"]').click()
    await page.locator('.mission-panel').waitFor({ state: 'visible', timeout: 35000 })
    const missionText = await page.locator('.mission-panel').innerText({ timeout: 5000 })
    assert(/escort/i.test(missionText), `Mission panel did not describe an escort: ${missionText}`)
    if (addressRoute?.address) assert(missionText.includes(addressRoute.address), `Mission panel did not resolve the requested address ${addressRoute.address}: ${missionText}`)

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

    await page.waitForFunction(() => {
      const state = window.__REALCITY_STORE__?.getState()
      return state?.ride?.path?.length >= 2 && state.ride.routeMeters > 0
    }, null, { timeout: 90000 })
    const taxiRide = await getTaxiRouteState(page)
    assert(taxiRide.ridePathPoints >= 2, `Taxi ride did not use a road path: ${JSON.stringify(taxiRide)}`)
    assert(taxiRide.routeMeters >= Math.max(1, taxiRide.directMeters * 0.9), `Taxi ride route distance was implausible: ${JSON.stringify(taxiRide)}`)
    assert(taxiRide.rideDuration >= taxiRide.routeMeters / 25 - 0.5, `Taxi ride duration is too short for the road distance: ${JSON.stringify(taxiRide)}`)
    assert(taxiRide.taxiPose && Number.isFinite(taxiRide.taxiPose.x) && Number.isFinite(taxiRide.taxiPose.z), `Taxi vehicle pose was not updated during ride: ${JSON.stringify(taxiRide)}`)

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
    assert(consoleErrors.length === 0, `Console errors were reported: ${consoleErrors.join(' | ')}`)
    assert(pageErrors.length === 0, `Page errors were reported: ${pageErrors.join(' | ')}`)

    const report = {
      checkedAt: new Date().toISOString(),
      url: baseUrl,
      task,
      addressRoute,
      browser: executablePath,
      canvas,
      interiors,
      cityNorms,
      supportUX,
      skyState,
      collisionAndMaterials,
      streetRendering,
      phone,
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
    console.log(JSON.stringify({ ok: true, task, finalDistrict: finalPlayer.district, screenshotPath }, null, 2))
  } finally {
    if (browser) await browser.close()
    stopDevServer(server.child)
  }
}

main().catch(error => {
  console.error(error)
  process.exit(1)
})
