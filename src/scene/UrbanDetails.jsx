import { useLayoutEffect, useMemo, useRef } from 'react'
import * as THREE from 'three'
import { CITY_BASE_Y, CITY_GRID_HALF, ROAD_SPACING, ROAD_WIDTH } from '../engine/cityEngine'

function setInstance(mesh, index, dummy, position, scale, rotationY = 0) {
  dummy.position.set(position[0], position[1], position[2])
  dummy.rotation.set(0, rotationY, 0)
  dummy.scale.set(scale[0], scale[1], scale[2])
  dummy.updateMatrix()
  mesh.setMatrixAt(index, dummy.matrix)
}

function useRoadLayout(roads) {
  return useMemo(() => {
    const vertical = roads.filter(road => road.axis === 'z')
    const horizontal = roads.filter(road => road.axis === 'x')
    const mainVertical = vertical.filter(road => road.main)
    const mainHorizontal = horizontal.filter(road => road.main)
    return { vertical, horizontal, mainVertical, mainHorizontal }
  }, [roads])
}

function Crosswalks({ roads }) {
  const ref = useRef()
  const { mainVertical, mainHorizontal } = useRoadLayout(roads)
  const stripes = useMemo(() => {
    const items = []
    for (const h of mainHorizontal) {
      for (const v of mainVertical) {
        const distance = Math.hypot(v.x, h.z)
        if (distance > CITY_GRID_HALF * 0.94) continue
        const offsets = [-5.4, -3.6, -1.8, 0, 1.8, 3.6, 5.4]
        offsets.forEach(offset => {
          items.push({ x: v.x + offset, z: h.z - h.width * 0.54, sx: 0.72, sz: h.width * 0.54 })
          items.push({ x: v.x + offset, z: h.z + h.width * 0.54, sx: 0.72, sz: h.width * 0.54 })
          items.push({ x: v.x - v.width * 0.54, z: h.z + offset, sx: v.width * 0.54, sz: 0.72 })
          items.push({ x: v.x + v.width * 0.54, z: h.z + offset, sx: v.width * 0.54, sz: 0.72 })
        })
      }
    }
    return items
  }, [mainHorizontal, mainVertical])

  useLayoutEffect(() => {
    if (!ref.current) return
    const dummy = new THREE.Object3D()
    stripes.forEach((stripe, i) => {
      setInstance(ref.current, i, dummy, [stripe.x, CITY_BASE_Y + 0.19, stripe.z], [stripe.sx, 0.025, stripe.sz])
    })
    ref.current.instanceMatrix.needsUpdate = true
  }, [stripes])

  return (
    <instancedMesh ref={ref} args={[undefined, undefined, stripes.length]} frustumCulled={false}>
      <boxGeometry args={[1, 1, 1]} />
      <meshBasicMaterial color="#e8ece9" toneMapped={false} />
    </instancedMesh>
  )
}

function StreetLights({ roads }) {
  const poleRef = useRef()
  const armRef = useRef()
  const bulbRef = useRef()
  const { mainVertical, mainHorizontal } = useRoadLayout(roads)
  const lights = useMemo(() => {
    const items = []
    const spacing = ROAD_SPACING * 2.25
    for (const road of mainHorizontal) {
      for (let x = road.from + spacing; x < road.to - spacing; x += spacing) {
        if (Math.hypot(x, road.z) > CITY_GRID_HALF * 0.96) continue
        items.push({ x, z: road.z - road.width * 0.95, yaw: Math.PI / 2, side: -1 })
        items.push({ x, z: road.z + road.width * 0.95, yaw: -Math.PI / 2, side: 1 })
      }
    }
    for (const road of mainVertical) {
      for (let z = road.from + spacing; z < road.to - spacing; z += spacing) {
        if (Math.hypot(road.x, z) > CITY_GRID_HALF * 0.96) continue
        items.push({ x: road.x - road.width * 0.95, z, yaw: 0, side: -1 })
        items.push({ x: road.x + road.width * 0.95, z, yaw: Math.PI, side: 1 })
      }
    }
    return items
  }, [mainHorizontal, mainVertical])

  useLayoutEffect(() => {
    if (!poleRef.current || !armRef.current || !bulbRef.current) return
    const dummy = new THREE.Object3D()
    lights.forEach((light, i) => {
      setInstance(poleRef.current, i, dummy, [light.x, CITY_BASE_Y + 2.7, light.z], [0.07, 5.4, 0.07])
      const armX = light.x + Math.sin(light.yaw) * 0.72
      const armZ = light.z + Math.cos(light.yaw) * 0.72
      setInstance(armRef.current, i, dummy, [armX, CITY_BASE_Y + 5.35, armZ], [0.16, 0.12, 1.45], light.yaw)
      const bulbX = light.x + Math.sin(light.yaw) * 1.35
      const bulbZ = light.z + Math.cos(light.yaw) * 1.35
      setInstance(bulbRef.current, i, dummy, [bulbX, CITY_BASE_Y + 5.18, bulbZ], [0.28, 0.16, 0.28])
    })
    poleRef.current.instanceMatrix.needsUpdate = true
    armRef.current.instanceMatrix.needsUpdate = true
    bulbRef.current.instanceMatrix.needsUpdate = true
  }, [lights])

  return (
    <>
      <instancedMesh ref={poleRef} args={[undefined, undefined, lights.length]} castShadow frustumCulled={false}>
        <cylinderGeometry args={[1, 1, 1, 8]} />
        <meshStandardMaterial color="#2f3437" roughness={0.5} metalness={0.45} />
      </instancedMesh>
      <instancedMesh ref={armRef} args={[undefined, undefined, lights.length]} castShadow frustumCulled={false}>
        <boxGeometry args={[1, 1, 1]} />
        <meshStandardMaterial color="#2c3135" roughness={0.46} metalness={0.5} />
      </instancedMesh>
      <instancedMesh ref={bulbRef} args={[undefined, undefined, lights.length]} frustumCulled={false}>
        <sphereGeometry args={[1, 10, 8]} />
        <meshStandardMaterial color="#fff2be" emissive="#ffd470" emissiveIntensity={0.85} roughness={0.22} />
      </instancedMesh>
    </>
  )
}

function TrafficSignals({ roads }) {
  const poleRef = useRef()
  const headRef = useRef()
  const redRef = useRef()
  const greenRef = useRef()
  const { mainVertical, mainHorizontal } = useRoadLayout(roads)
  const signals = useMemo(() => {
    const items = []
    for (const h of mainHorizontal) {
      for (const v of mainVertical) {
        if (Math.hypot(v.x, h.z) > CITY_GRID_HALF * 0.86) continue
        items.push({ x: v.x - v.width * 0.68, z: h.z - h.width * 0.68, yaw: Math.PI / 4 })
        items.push({ x: v.x + v.width * 0.68, z: h.z + h.width * 0.68, yaw: -Math.PI * 0.75 })
      }
    }
    return items
  }, [mainHorizontal, mainVertical])

  useLayoutEffect(() => {
    if (!poleRef.current || !headRef.current || !redRef.current || !greenRef.current) return
    const dummy = new THREE.Object3D()
    signals.forEach((signal, i) => {
      setInstance(poleRef.current, i, dummy, [signal.x, CITY_BASE_Y + 2.05, signal.z], [0.08, 4.1, 0.08])
      setInstance(headRef.current, i, dummy, [signal.x, CITY_BASE_Y + 4.02, signal.z], [0.52, 0.9, 0.22], signal.yaw)
      setInstance(redRef.current, i, dummy, [signal.x, CITY_BASE_Y + 4.26, signal.z], [0.09, 0.09, 0.09])
      setInstance(greenRef.current, i, dummy, [signal.x, CITY_BASE_Y + 3.82, signal.z], [0.09, 0.09, 0.09])
    })
    poleRef.current.instanceMatrix.needsUpdate = true
    headRef.current.instanceMatrix.needsUpdate = true
    redRef.current.instanceMatrix.needsUpdate = true
    greenRef.current.instanceMatrix.needsUpdate = true
  }, [signals])

  return (
    <>
      <instancedMesh ref={poleRef} args={[undefined, undefined, signals.length]} castShadow frustumCulled={false}>
        <cylinderGeometry args={[1, 1, 1, 8]} />
        <meshStandardMaterial color="#22262a" roughness={0.5} metalness={0.45} />
      </instancedMesh>
      <instancedMesh ref={headRef} args={[undefined, undefined, signals.length]} castShadow frustumCulled={false}>
        <boxGeometry args={[1, 1, 1]} />
        <meshStandardMaterial color="#111315" roughness={0.38} metalness={0.2} />
      </instancedMesh>
      <instancedMesh ref={redRef} args={[undefined, undefined, signals.length]} frustumCulled={false}>
        <sphereGeometry args={[1, 8, 6]} />
        <meshStandardMaterial color="#ff6a60" emissive="#ff2f29" emissiveIntensity={1.3} />
      </instancedMesh>
      <instancedMesh ref={greenRef} args={[undefined, undefined, signals.length]} frustumCulled={false}>
        <sphereGeometry args={[1, 8, 6]} />
        <meshStandardMaterial color="#64ffa6" emissive="#1fd86d" emissiveIntensity={1.15} />
      </instancedMesh>
    </>
  )
}

function PlantersAndBenches({ roads }) {
  const planterRef = useRef()
  const shrubRef = useRef()
  const benchRef = useRef()
  const { mainHorizontal } = useRoadLayout(roads)
  const items = useMemo(() => {
    const placed = []
    const coreRoads = mainHorizontal.filter(road => Math.abs(road.z) < ROAD_SPACING * 3)
    for (const road of coreRoads) {
      for (let x = -CITY_GRID_HALF * 0.58; x < CITY_GRID_HALF * 0.58; x += ROAD_SPACING * 1.2) {
        if (Math.abs(x) < ROAD_SPACING) continue
        placed.push({ x, z: road.z + road.width * 1.35, yaw: 0 })
        placed.push({ x: x + ROAD_SPACING * 0.42, z: road.z - road.width * 1.35, yaw: Math.PI })
      }
    }
    return placed
  }, [mainHorizontal])

  useLayoutEffect(() => {
    if (!planterRef.current || !shrubRef.current || !benchRef.current) return
    const dummy = new THREE.Object3D()
    items.forEach((item, i) => {
      setInstance(planterRef.current, i, dummy, [item.x, CITY_BASE_Y + 0.34, item.z], [2.4, 0.52, 0.82], item.yaw)
      setInstance(shrubRef.current, i, dummy, [item.x, CITY_BASE_Y + 0.95, item.z], [1.92, 0.74, 0.58], item.yaw)
      setInstance(benchRef.current, i, dummy, [item.x + Math.sin(item.yaw) * 2.4, CITY_BASE_Y + 0.47, item.z + Math.cos(item.yaw) * 2.4], [1.9, 0.18, 0.42], item.yaw)
    })
    planterRef.current.instanceMatrix.needsUpdate = true
    shrubRef.current.instanceMatrix.needsUpdate = true
    benchRef.current.instanceMatrix.needsUpdate = true
  }, [items])

  return (
    <>
      <instancedMesh ref={planterRef} args={[undefined, undefined, items.length]} castShadow receiveShadow frustumCulled={false}>
        <boxGeometry args={[1, 1, 1]} />
        <meshStandardMaterial color="#5d5548" roughness={0.82} />
      </instancedMesh>
      <instancedMesh ref={shrubRef} args={[undefined, undefined, items.length]} castShadow frustumCulled={false}>
        <dodecahedronGeometry args={[1, 0]} />
        <meshStandardMaterial color="#3d8750" roughness={0.88} flatShading />
      </instancedMesh>
      <instancedMesh ref={benchRef} args={[undefined, undefined, items.length]} castShadow receiveShadow frustumCulled={false}>
        <boxGeometry args={[1, 1, 1]} />
        <meshStandardMaterial color="#8a6a4a" roughness={0.72} />
      </instancedMesh>
    </>
  )
}

function RooftopDetails({ buildings }) {
  const hvacRef = useRef()
  const antennaRef = useRef()
  const waterRef = useRef()
  const details = useMemo(() => {
    return buildings
      .filter(building => building.h > 18 && Math.hypot(building.x, building.z) < CITY_GRID_HALF * 0.9)
      .slice(0, 220)
      .map((building, i) => ({
        x: building.x,
        z: building.z,
        y: building.y + building.h,
        yaw: building.rot,
        hvac: [Math.max(1.8, building.w * 0.16), 0.7 + (i % 3) * 0.16, Math.max(1.5, building.d * 0.12)],
        water: building.type === 'apartment' || building.type === 'office',
        antenna: building.type === 'skyscraper',
      }))
  }, [buildings])

  const antennas = useMemo(() => details.filter(item => item.antenna), [details])
  const tanks = useMemo(() => details.filter(item => item.water), [details])

  useLayoutEffect(() => {
    if (!hvacRef.current || !antennaRef.current || !waterRef.current) return
    const dummy = new THREE.Object3D()
    details.forEach((detail, i) => {
      setInstance(hvacRef.current, i, dummy, [detail.x + Math.sin(detail.yaw) * 2.2, detail.y + 0.44, detail.z + Math.cos(detail.yaw) * 2.2], detail.hvac, detail.yaw)
    })
    antennas.forEach((detail, i) => {
      setInstance(antennaRef.current, i, dummy, [detail.x, detail.y + 3.8, detail.z], [0.06, 7.6, 0.06])
    })
    tanks.forEach((detail, i) => {
      setInstance(waterRef.current, i, dummy, [detail.x - Math.sin(detail.yaw) * 2.6, detail.y + 0.74, detail.z - Math.cos(detail.yaw) * 2.6], [0.85, 1.48, 0.85])
    })
    hvacRef.current.instanceMatrix.needsUpdate = true
    antennaRef.current.instanceMatrix.needsUpdate = true
    waterRef.current.instanceMatrix.needsUpdate = true
  }, [details, antennas, tanks])

  return (
    <>
      <instancedMesh ref={hvacRef} args={[undefined, undefined, details.length]} castShadow frustumCulled={false}>
        <boxGeometry args={[1, 1, 1]} />
        <meshStandardMaterial color="#515b60" roughness={0.48} metalness={0.38} />
      </instancedMesh>
      <instancedMesh ref={antennaRef} args={[undefined, undefined, antennas.length]} castShadow frustumCulled={false}>
        <cylinderGeometry args={[1, 1, 1, 6]} />
        <meshStandardMaterial color="#d4d9da" roughness={0.28} metalness={0.62} />
      </instancedMesh>
      <instancedMesh ref={waterRef} args={[undefined, undefined, tanks.length]} castShadow frustumCulled={false}>
        <cylinderGeometry args={[1, 1, 1, 12]} />
        <meshStandardMaterial color="#8ea0a7" roughness={0.42} metalness={0.34} />
      </instancedMesh>
    </>
  )
}

export default function UrbanDetails({ city }) {
  return (
    <>
      <Crosswalks roads={city.roads} />
      <StreetLights roads={city.roads} />
      <TrafficSignals roads={city.roads} />
      <PlantersAndBenches roads={city.roads} />
      <RooftopDetails buildings={city.buildings} />
    </>
  )
}
