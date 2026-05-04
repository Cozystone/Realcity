import { useRef, useMemo } from 'react'
import { useFrame } from '@react-three/fiber'
import * as THREE from 'three'
import { getTerrainHeight } from '../utils/noise'

const CAR_COUNT = 80
const CAR_COLORS = ['#c02020', '#2040c0', '#208020', '#e0a000', '#888888', '#202020', '#c06000', '#ffffff']

function makePRNG(seed = 9999) {
  let s = seed
  return () => { s = (s * 1664525 + 1013904223) & 0xffffffff; return (s >>> 0) / 4294967295 }
}

function buildWaypoints(roads) {
  const ewRoads = roads.filter(r => r.type === 'ew' && r.isMain)
  const nsRoads = roads.filter(r => r.type === 'ns' && r.isMain)

  // Intersections
  const intersections = []
  ewRoads.forEach(ew => {
    nsRoads.forEach(ns => {
      intersections.push({ x: ns.x, z: ew.z })
    })
  })

  return { ewRoads, nsRoads, intersections }
}

function createCarPath(rng, ewRoads, nsRoads) {
  // Pick a random road and drive along it, turning at intersections
  const useEW = rng() > 0.5
  const road = useEW
    ? ewRoads[Math.floor(rng() * ewRoads.length)]
    : nsRoads[Math.floor(rng() * nsRoads.length)]

  if (!road) return null

  const offset = (rng() - 0.5) * 3  // lane offset
  const lane = rng() > 0.5 ? 1 : -1  // which side of road

  const waypoints = []
  const steps = 20
  if (useEW) {
    const z = road.z + lane * 2.5 + offset * 0.5
    for (let i = 0; i <= steps; i++) {
      const x = road.x1 + (road.x2 - road.x1) * (i / steps)
      waypoints.push(new THREE.Vector3(x, getTerrainHeight(x, z) + 0.5, z))
    }
  } else {
    const x = road.x + lane * 2.5 + offset * 0.5
    for (let i = 0; i <= steps; i++) {
      const z = road.z1 + (road.z2 - road.z1) * (i / steps)
      waypoints.push(new THREE.Vector3(x, getTerrainHeight(x, z) + 0.5, z))
    }
  }

  return waypoints
}

export default function Traffic({ roads }) {
  const rng = useMemo(() => makePRNG(54321), [])
  const { ewRoads, nsRoads } = useMemo(() => buildWaypoints(roads), [roads])

  const carData = useMemo(() => {
    const cars = []
    for (let i = 0; i < CAR_COUNT; i++) {
      const path = createCarPath(rng, ewRoads, nsRoads)
      if (!path) continue
      const t = rng()
      const color = CAR_COLORS[Math.floor(rng() * CAR_COLORS.length)]
      const speed = 8 + rng() * 6
      cars.push({ path, t, speed, color, id: i })
    }
    return cars
  }, [rng, ewRoads, nsRoads])

  const bodyRef = useRef()
  const roofRef = useRef()
  const wheelFL = useRef(), wheelFR = useRef(), wheelRL = useRef(), wheelRR = useRef()
  const carTs = useRef(carData.map(c => c.t))
  const carDirs = useRef(carData.map(() => new THREE.Quaternion()))

  // Init instanced colors
  const dummy = useMemo(() => new THREE.Object3D(), [])

  useFrame((_, delta) => {
    if (!bodyRef.current || !carData.length) return

    carData.forEach((car, i) => {
      const path = car.path
      const totalLen = path.length - 1
      carTs.current[i] = (carTs.current[i] + (car.speed * delta) / 300) % 1

      const t = carTs.current[i]
      const segF = t * totalLen
      const seg = Math.floor(segF)
      const frac = segF - seg

      const p0 = path[Math.min(seg, totalLen)]
      const p1 = path[Math.min(seg + 1, totalLen)]
      const pos = new THREE.Vector3().lerpVectors(p0, p1, frac)

      // Direction
      const dir = new THREE.Vector3().subVectors(p1, p0).normalize()
      const quat = new THREE.Quaternion()
      if (dir.length() > 0.001) {
        quat.setFromUnitVectors(new THREE.Vector3(0, 0, 1), dir)
      }

      // Car body
      dummy.position.copy(pos)
      dummy.quaternion.copy(quat)
      dummy.scale.set(2.2, 0.9, 4.5)
      dummy.updateMatrix()
      bodyRef.current.setMatrixAt(i, dummy.matrix)

      // Roof
      dummy.position.set(pos.x, pos.y + 0.9, pos.z)
      dummy.scale.set(2.0, 0.7, 2.8)
      dummy.updateMatrix()
      roofRef.current.setMatrixAt(i, dummy.matrix)
    })

    bodyRef.current.instanceMatrix.needsUpdate = true
    roofRef.current.instanceMatrix.needsUpdate = true
  })

  if (!carData.length) return null

  return (
    <>
      <instancedMesh ref={bodyRef} args={[null, null, CAR_COUNT]}>
        <boxGeometry args={[1, 1, 1]} />
        <meshStandardMaterial color="#cc2222" roughness={0.3} metalness={0.6} />
      </instancedMesh>
      <instancedMesh ref={roofRef} args={[null, null, CAR_COUNT]}>
        <boxGeometry args={[1, 1, 1]} />
        <meshStandardMaterial color="#111111" roughness={0.1} metalness={0.3} />
      </instancedMesh>
    </>
  )
}
