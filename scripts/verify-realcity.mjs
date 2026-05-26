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
      }))
  })
  assert(Array.isArray(interiors), 'City metadata was not exposed for interior verification')
  assert(interiors.length >= 8, 'Expected landmark interiors for most named buildings')
  const broken = interiors.filter(item => !item.hasInterior || !item.solidWalls || item.doorWidth <= 0 || !item.verticalCore)
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
    const carBodyStyles = new Set(city.cars.map(car => car.bodyStyle).filter(Boolean))
    const detailedCars = city.cars.filter(car => car.dimensions?.width > 0 && car.dimensions?.length > 0 && car.dimensions?.cabinLength > 0)
    const appearanceReady = city.npcs.filter(npc => npc.appearance?.heightScale && npc.appearance?.topColor && npc.appearance?.hairStyle)
    const heightVariants = new Set(city.npcs.map(npc => npc.appearance?.heightScale?.toFixed(2)).filter(Boolean))
    const fashionVariants = new Set(city.npcs.map(npc => `${npc.appearance?.topColor}:${npc.appearance?.jacketColor}:${npc.appearance?.bottomStyle}:${npc.appearance?.hatStyle}`))
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
  assert(norms.treeRoadConflicts === 0, `${norms.treeRoadConflicts} trees overlap road reserves`)
  assert(norms.socialNorms?.pedestrian && norms.socialNorms?.traffic && norms.socialNorms?.addressSystem && norms.socialNorms?.zoning, 'Social norm metadata is incomplete')
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
    const initialScreenshotPath = path.join(artifactsDir, 'realcity-initial-core.png')
    await page.screenshot({ path: initialScreenshotPath, fullPage: false })
    addressRoute = await page.evaluate(() => {
      const city = window.__REALCITY_CITY__
      const player = window.__REALCITY_STORE__?.getState().player || { x: 0, z: 40 }
      const target = [...(city?.addressBook || [])]
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

    await page.locator('.mission-panel').waitFor({ state: 'hidden', timeout: 70000 })
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
      phone,
      controls: {
        headingChangedByA: Math.abs(angleDiff(afterTurn.heading, beforeTurn.heading)),
        arrowViewOffset: Math.abs(angleDiff(duringLook.viewHeading, duringLook.heading)),
        arrowReturnOffset: Math.abs(angleDiff(afterLook.viewHeading, afterLook.heading)),
        forwardDistance,
      },
      missionText,
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
