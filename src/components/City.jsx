import { useMemo, useRef, useEffect } from 'react'
import { useFrame } from '@react-three/fiber'
import { RigidBody } from '@react-three/rapier'
import { useRapier } from '@react-three/rapier'
import * as THREE from 'three'
import { getBuildingTextures, createRoadTexture, createSidewalkTexture } from '../utils/textures'

const BUILDING_TYPES = ['skyscraper', 'office', 'apartment', 'house']

// One InstancedMesh per building type
function Buildings({ buildings }) {
  const meshRefs = useRef({})
  const { rapier, world } = useRapier()

  const grouped = useMemo(() => {
    const g = {}
    BUILDING_TYPES.forEach(t => { g[t] = [] })
    buildings.forEach(b => {
      const t = BUILDING_TYPES.includes(b.type) ? b.type : 'office'
      g[t].push(b)
    })
    return g
  }, [buildings])

  // Physics colliders for all buildings (one compound rigid body)
  useEffect(() => {
    const rbDesc = rapier.RigidBodyDesc.fixed()
    const rb = world.createRigidBody(rbDesc)

    buildings.forEach(b => {
      const desc = rapier.ColliderDesc.cuboid(b.w / 2, b.h / 2, b.d / 2)
        .setTranslation(b.x, b.terrainH + b.h / 2, b.z)
        .setFriction(0.7)
      world.createCollider(desc, rb)
    })

    return () => {
      if (world.getRigidBody(rb.handle)) world.removeRigidBody(rb)
    }
  }, [buildings, rapier, world])

  // Update instanced matrices
  useEffect(() => {
    const dummy = new THREE.Object3D()

    BUILDING_TYPES.forEach(type => {
      const mesh = meshRefs.current[type]
      if (!mesh) return
      const arr = grouped[type]
      arr.forEach((b, i) => {
        dummy.position.set(b.x, b.terrainH + b.h / 2, b.z)
        dummy.rotation.set(0, b.rot, 0)
        dummy.scale.set(b.w, b.h, b.d)
        dummy.updateMatrix()
        mesh.setMatrixAt(i, dummy.matrix)
      })
      mesh.instanceMatrix.needsUpdate = true
    })
  }, [grouped])

  return (
    <>
      {BUILDING_TYPES.map(type => {
        const arr = grouped[type]
        if (!arr.length) return null
        const { dayTex } = getBuildingTextures(type)
        const metalness = type === 'skyscraper' ? 0.7 : type === 'office' ? 0.3 : 0.05
        const roughness = type === 'skyscraper' ? 0.15 : type === 'office' ? 0.7 : 0.9

        return (
          <instancedMesh
            key={type}
            ref={(r) => { if (r) meshRefs.current[type] = r }}
            args={[null, null, arr.length]}
            castShadow
            receiveShadow
          >
            <boxGeometry args={[1, 1, 1]} />
            <meshStandardMaterial
              map={dayTex}
              roughness={roughness}
              metalness={metalness}
              envMapIntensity={type === 'skyscraper' ? 2.0 : 0.5}
            />
          </instancedMesh>
        )
      })}
      {/* Rooftops / top accent for skyscrapers */}
      <SkyscraperTops buildings={grouped.skyscraper} />
    </>
  )
}

function SkyscraperTops({ buildings }) {
  const ref = useRef()
  useEffect(() => {
    if (!ref.current) return
    const dummy = new THREE.Object3D()
    buildings.forEach((b, i) => {
      dummy.position.set(b.x, b.terrainH + b.h + 1.5, b.z)
      dummy.scale.set(b.w * 0.4, 3, b.d * 0.4)
      dummy.updateMatrix()
      ref.current.setMatrixAt(i, dummy.matrix)
    })
    ref.current.instanceMatrix.needsUpdate = true
  }, [buildings])

  if (!buildings.length) return null
  return (
    <instancedMesh ref={ref} args={[null, null, buildings.length]}>
      <boxGeometry args={[1, 1, 1]} />
      <meshStandardMaterial color="#2a3a4a" metalness={0.9} roughness={0.1} />
    </instancedMesh>
  )
}

function Roads({ roads }) {
  const geo = useMemo(() => {
    const verts = [], normals = [], uvs = []

    roads.forEach(road => {
      const hw = road.width / 2
      let quads
      if (road.type === 'ew') {
        const y0 = 0.05
        quads = [
          [road.x1, y0, road.z - hw], [road.x2, y0, road.z - hw],
          [road.x2, y0, road.z + hw], [road.x1, y0, road.z + hw],
        ]
        const len = road.x2 - road.x1
        uvs.push(0, 0, len / 12, 0, len / 12, 1, 0, 1)
      } else {
        const y0 = 0.05
        quads = [
          [road.x - hw, y0, road.z1], [road.x + hw, y0, road.z1],
          [road.x + hw, y0, road.z2], [road.x - hw, y0, road.z2],
        ]
        const len = road.z2 - road.z1
        uvs.push(0, 0, 1, 0, 1, len / 12, 0, len / 12)
      }

      const [A, B, C, D] = quads
      verts.push(...A, ...B, ...C, ...A, ...C, ...D)
      for (let i = 0; i < 6; i++) normals.push(0, 1, 0)
    })

    const geo = new THREE.BufferGeometry()
    geo.setAttribute('position', new THREE.Float32BufferAttribute(verts, 3))
    geo.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3))
    return geo
  }, [roads])

  const roadTex = useMemo(() => {
    const t = createRoadTexture()
    t.repeat.set(1, 8)
    return t
  }, [])

  return (
    <mesh geometry={geo} receiveShadow>
      <meshStandardMaterial map={roadTex} roughness={0.85} metalness={0.02} />
    </mesh>
  )
}

function StreetLights({ lights }) {
  const poleRef = useRef()
  const headRef = useRef()

  useEffect(() => {
    if (!poleRef.current || !headRef.current) return
    const dummy = new THREE.Object3D()

    lights.forEach((l, i) => {
      // Pole
      dummy.position.set(l.x, l.y - 4, l.z)
      dummy.scale.set(0.15, 8, 0.15)
      dummy.updateMatrix()
      poleRef.current.setMatrixAt(i, dummy.matrix)

      // Head
      dummy.position.set(l.x, l.y, l.z)
      dummy.scale.set(0.5, 0.4, 0.5)
      dummy.updateMatrix()
      headRef.current.setMatrixAt(i, dummy.matrix)
    })
    poleRef.current.instanceMatrix.needsUpdate = true
    headRef.current.instanceMatrix.needsUpdate = true
  }, [lights])

  if (!lights.length) return null
  return (
    <>
      <instancedMesh ref={poleRef} args={[null, null, lights.length]}>
        <cylinderGeometry args={[1, 1, 1, 6]} />
        <meshStandardMaterial color="#4a4a4a" metalness={0.7} roughness={0.4} />
      </instancedMesh>
      <instancedMesh ref={headRef} args={[null, null, lights.length]}>
        <boxGeometry args={[1, 1, 1]} />
        <meshStandardMaterial
          color="#ffffff"
          emissive="#ffe8a0"
          emissiveIntensity={8}
          roughness={0.2}
          metalness={0.1}
        />
      </instancedMesh>
    </>
  )
}

function Trees({ trees }) {
  const trunkRef = useRef()
  const foliageRef = useRef()

  useEffect(() => {
    if (!trunkRef.current || !foliageRef.current) return
    const dummy = new THREE.Object3D()

    trees.forEach((t, i) => {
      const sc = t.scale
      dummy.position.set(t.x, t.y + sc * 2, t.z)
      dummy.scale.set(sc * 0.3, sc * 4, sc * 0.3)
      dummy.rotation.set(0, Math.random() * Math.PI * 2, 0)
      dummy.updateMatrix()
      trunkRef.current.setMatrixAt(i, dummy.matrix)

      dummy.position.set(t.x, t.y + sc * 6, t.z)
      dummy.scale.set(sc * 2.5, sc * 5, sc * 2.5)
      dummy.rotation.set(0, Math.random() * Math.PI * 2, 0)
      dummy.updateMatrix()
      foliageRef.current.setMatrixAt(i, dummy.matrix)
    })
    trunkRef.current.instanceMatrix.needsUpdate = true
    foliageRef.current.instanceMatrix.needsUpdate = true
  }, [trees])

  if (!trees.length) return null
  return (
    <>
      <instancedMesh ref={trunkRef} args={[null, null, trees.length]} castShadow>
        <cylinderGeometry args={[1, 1.2, 1, 6]} />
        <meshStandardMaterial color="#5c3a1e" roughness={0.95} />
      </instancedMesh>
      <instancedMesh ref={foliageRef} args={[null, null, trees.length]} castShadow>
        <dodecahedronGeometry args={[1, 0]} />
        <meshStandardMaterial
          color="#2d6a2a"
          roughness={0.9}
          metalness={0.0}
          flatShading
        />
      </instancedMesh>
    </>
  )
}

export default function City({ data }) {
  const { buildings, roads, lights, trees } = data
  return (
    <>
      <Buildings buildings={buildings} />
      <Roads roads={roads} />
      <StreetLights lights={lights} />
      <Trees trees={trees} />
    </>
  )
}
