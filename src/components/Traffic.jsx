import { useRef, useMemo } from 'react'
import { useFrame } from '@react-three/fiber'
import * as THREE from 'three'
import { getTerrainHeight } from '../utils/noise'

const CAR_COUNT = 70

const CAR_COLORS = [
  '#c02020', '#2040c0', '#208020', '#e09010', '#888888',
  '#202020', '#c06010', '#ffffff', '#400080', '#006090',
]

function seeded(seed = 9999) {
  let s = seed
  return () => { s = (s * 1664525 + 1013904223) & 0xffffffff; return (s >>> 0) / 4294967295 }
}

// Build driving waypoints along a road (21 evenly-spaced points)
function buildPath(road, lane, rng) {
  const pts = []
  const offset = lane * 2.8 + (rng() - 0.5) * 0.5
  const steps = 20

  if (road.type === 'ew') {
    const z = road.z + offset
    for (let i = 0; i <= steps; i++) {
      const x = road.x1 + (road.x2 - road.x1) * (i / steps)
      pts.push(new THREE.Vector3(x, getTerrainHeight(x, z) + 0.52, z))
    }
  } else {
    const x = road.x + offset
    for (let i = 0; i <= steps; i++) {
      const z = road.z1 + (road.z2 - road.z1) * (i / steps)
      pts.push(new THREE.Vector3(x, getTerrainHeight(x, z) + 0.52, z))
    }
  }
  return pts
}

// Compute real path length in metres
function pathLength(pts) {
  let len = 0
  for (let i = 1; i < pts.length; i++) len += pts[i].distanceTo(pts[i - 1])
  return len
}

export default function Traffic({ roads }) {
  const rng = useMemo(() => seeded(54321), [])

  const carData = useMemo(() => {
    const mainRoads = roads.filter(r => r.isMain)
    if (!mainRoads.length) return []

    const cars = []
    for (let i = 0; i < CAR_COUNT; i++) {
      const road = mainRoads[Math.floor(rng() * mainRoads.length)]
      const lane = rng() > 0.5 ? 1 : -1
      const path = buildPath(road, lane, rng)
      const len  = pathLength(path)
      const speed = 6 + rng() * 6           // 6–12 m/s = 22–43 km/h (city speed)
      const t     = rng()
      const color = CAR_COLORS[Math.floor(rng() * CAR_COLORS.length)]
      cars.push({ path, len, speed, t, color })
    }
    return cars
  }, [roads, rng])

  const bodyRef  = useRef()
  const roofRef  = useRef()
  const carTs    = useRef(carData.map(c => c.t))
  const dummy    = useMemo(() => new THREE.Object3D(), [])

  useFrame((_, delta) => {
    if (!bodyRef.current || !carData.length) return
    const dt = Math.min(delta, 0.05)

    carData.forEach((car, i) => {
      // Advance t by real-world speed / path length
      carTs.current[i] = (carTs.current[i] + (car.speed * dt) / car.len) % 1

      const t    = carTs.current[i]
      const maxSeg = car.path.length - 1
      const segF = t * maxSeg
      const seg  = Math.min(Math.floor(segF), maxSeg - 1)
      const frac = segF - seg

      const p0 = car.path[seg]
      const p1 = car.path[seg + 1]
      const pos = new THREE.Vector3().lerpVectors(p0, p1, frac)

      const dir = new THREE.Vector3().subVectors(p1, p0)
      const q   = new THREE.Quaternion()
      if (dir.length() > 0.001) q.setFromUnitVectors(new THREE.Vector3(0, 0, 1), dir.normalize())

      // Body
      dummy.position.copy(pos)
      dummy.quaternion.copy(q)
      dummy.scale.set(2.1, 0.85, 4.4)
      dummy.updateMatrix()
      bodyRef.current.setMatrixAt(i, dummy.matrix)

      // Roof
      dummy.position.set(pos.x, pos.y + 0.82, pos.z)
      dummy.scale.set(1.9, 0.65, 2.7)
      dummy.updateMatrix()
      roofRef.current.setMatrixAt(i, dummy.matrix)
    })

    bodyRef.current.instanceMatrix.needsUpdate = true
    roofRef.current.instanceMatrix.needsUpdate = true
  })

  if (!carData.length) return null

  return (
    <>
      {/* Car bodies */}
      <instancedMesh ref={bodyRef} args={[undefined, undefined, CAR_COUNT]} castShadow frustumCulled={false}>
        <boxGeometry args={[1, 1, 1]} />
        <meshStandardMaterial color="#cc2222" roughness={0.28} metalness={0.55} />
      </instancedMesh>
      {/* Roofs / windows */}
      <instancedMesh ref={roofRef} args={[undefined, undefined, CAR_COUNT]} castShadow frustumCulled={false}>
        <boxGeometry args={[1, 1, 1]} />
        <meshStandardMaterial color="#111111" roughness={0.1} metalness={0.3} />
      </instancedMesh>
    </>
  )
}
