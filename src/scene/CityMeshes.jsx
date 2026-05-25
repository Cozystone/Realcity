import { useLayoutEffect, useMemo, useRef } from 'react'
import { Billboard, Text } from '@react-three/drei'
import * as THREE from 'three'
import { CITY_HALF, CITY_WORLD_SIZE, terrainHeight, terrainTone } from '../engine/cityEngine'

function makeTerrainGeometry() {
  const segments = 220
  const geometry = new THREE.PlaneGeometry(CITY_WORLD_SIZE, CITY_WORLD_SIZE, segments, segments)
  geometry.rotateX(-Math.PI / 2)
  const positions = geometry.attributes.position
  const colors = new Float32Array(positions.count * 3)

  for (let i = 0; i < positions.count; i += 1) {
    const x = positions.getX(i)
    const z = positions.getZ(i)
    const h = terrainHeight(x, z)
    positions.setY(i, h)
    const tone = terrainTone(x, z)
    colors[i * 3] = tone[0]
    colors[i * 3 + 1] = tone[1]
    colors[i * 3 + 2] = tone[2]
  }

  geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3))
  geometry.computeVertexNormals()
  return geometry
}

function makeRoadGeometry(roads) {
  const vertices = []
  const normals = []
  const uvs = []

  for (const road of roads) {
    const hw = road.width / 2
    if (road.axis === 'x') {
      const z0 = road.z - hw
      const z1 = road.z + hw
      const y = terrainHeight(0, road.z) + 0.12
      vertices.push(road.from, y, z0, road.to, y, z0, road.to, y, z1, road.from, y, z0, road.to, y, z1, road.from, y, z1)
      uvs.push(0, 0, 36, 0, 36, 1, 0, 0, 36, 1, 0, 1)
    } else {
      const x0 = road.x - hw
      const x1 = road.x + hw
      const y = terrainHeight(road.x, 0) + 0.12
      vertices.push(x0, y, road.from, x1, y, road.from, x1, y, road.to, x0, y, road.from, x1, y, road.to, x0, y, road.to)
      uvs.push(0, 0, 1, 0, 1, 36, 0, 0, 1, 36, 0, 36)
    }
    for (let i = 0; i < 6; i += 1) normals.push(0, 1, 0)
  }

  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3))
  geometry.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3))
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2))
  return geometry
}

function makeRoadTexture() {
  const canvas = document.createElement('canvas')
  canvas.width = 512
  canvas.height = 512
  const ctx = canvas.getContext('2d')
  ctx.fillStyle = '#1b1c1f'
  ctx.fillRect(0, 0, 512, 512)
  ctx.fillStyle = 'rgba(255,255,255,0.035)'
  for (let i = 0; i < 180; i += 1) {
    ctx.fillRect(Math.random() * 512, Math.random() * 512, 2 + Math.random() * 42, 1)
  }
  ctx.setLineDash([42, 34])
  ctx.strokeStyle = '#f0d456'
  ctx.lineWidth = 5
  ctx.beginPath()
  ctx.moveTo(256, 0)
  ctx.lineTo(256, 512)
  ctx.stroke()
  ctx.setLineDash([])
  ctx.strokeStyle = 'rgba(255,255,255,0.78)'
  ctx.lineWidth = 3
  ctx.beginPath()
  ctx.moveTo(36, 0)
  ctx.lineTo(36, 512)
  ctx.moveTo(476, 0)
  ctx.lineTo(476, 512)
  ctx.stroke()
  const texture = new THREE.CanvasTexture(canvas)
  texture.wrapS = texture.wrapT = THREE.RepeatWrapping
  return texture
}

function makeWindowTexture(type) {
  const canvas = document.createElement('canvas')
  canvas.width = 256
  canvas.height = 512
  const ctx = canvas.getContext('2d')
  const wall = {
    skyscraper: '#2d4e66',
    office: '#56666b',
    apartment: '#8a7660',
    house: '#9b6950',
  }[type] || '#63717a'
  const cols = type === 'skyscraper' ? 8 : type === 'house' ? 3 : 6
  const rows = type === 'skyscraper' ? 24 : type === 'house' ? 5 : 15
  ctx.fillStyle = wall
  ctx.fillRect(0, 0, 256, 512)
  for (let r = 0; r < rows; r += 1) {
    for (let c = 0; c < cols; c += 1) {
      const lit = (r * 17 + c * 11 + type.length) % 5 !== 0
      ctx.fillStyle = lit ? '#f2d88d' : '#09111a'
      const cellW = 256 / cols
      const cellH = 512 / rows
      ctx.fillRect(c * cellW + cellW * 0.25, r * cellH + cellH * 0.28, cellW * 0.5, cellH * 0.46)
    }
  }
  const texture = new THREE.CanvasTexture(canvas)
  texture.wrapS = texture.wrapT = THREE.RepeatWrapping
  return texture
}

function Buildings({ buildings }) {
  const refs = useRef({})
  const grouped = useMemo(() => {
    const groups = { skyscraper: [], office: [], apartment: [], house: [] }
    for (const building of buildings) groups[building.type]?.push(building)
    return groups
  }, [buildings])

  useLayoutEffect(() => {
    const dummy = new THREE.Object3D()
    const color = new THREE.Color()
    for (const [type, items] of Object.entries(grouped)) {
      const mesh = refs.current[type]
      if (!mesh) continue
      for (let i = 0; i < items.length; i += 1) {
        const building = items[i]
        dummy.position.set(building.x, building.y + building.h / 2, building.z)
        dummy.rotation.set(0, building.rot, 0)
        dummy.scale.set(building.w, building.h, building.d)
        dummy.updateMatrix()
        mesh.setMatrixAt(i, dummy.matrix)
        const base = type === 'skyscraper' ? '#9bd3ff' : type === 'office' ? '#b9c7bd' : type === 'apartment' ? '#d3aa84' : '#c88b66'
        mesh.setColorAt(i, color.set(base).lerp(new THREE.Color('#101820'), building.tint * 0.28))
      }
      mesh.instanceMatrix.needsUpdate = true
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true
    }
  }, [grouped])

  return (
    <>
      {Object.entries(grouped).map(([type, items]) => {
        if (!items.length) return null
        const isGlass = type === 'skyscraper'
        return (
          <instancedMesh
            key={type}
            ref={node => { if (node) refs.current[type] = node }}
            args={[undefined, undefined, items.length]}
            castShadow
            receiveShadow
            frustumCulled={false}
          >
            <boxGeometry args={[1, 1, 1]} />
            <meshStandardMaterial
              map={makeWindowTexture(type)}
              color="#ffffff"
              vertexColors
              roughness={isGlass ? 0.22 : 0.76}
              metalness={isGlass ? 0.42 : 0.05}
              envMapIntensity={isGlass ? 0.9 : 0.25}
            />
          </instancedMesh>
        )
      })}
    </>
  )
}

function Trees({ trees }) {
  const trunkRef = useRef()
  const crownRef = useRef()

  useLayoutEffect(() => {
    if (!trunkRef.current || !crownRef.current) return
    const dummy = new THREE.Object3D()
    const color = new THREE.Color()
    for (let i = 0; i < trees.length; i += 1) {
      const tree = trees[i]
      dummy.position.set(tree.x, tree.y + tree.scale * 1.6, tree.z)
      dummy.scale.set(tree.scale * 0.18, tree.scale * 3.2, tree.scale * 0.18)
      dummy.updateMatrix()
      trunkRef.current.setMatrixAt(i, dummy.matrix)

      dummy.position.set(tree.x, tree.y + tree.scale * 4.2, tree.z)
      dummy.scale.set(tree.scale * 1.3, tree.scale * 2.1, tree.scale * 1.3)
      dummy.updateMatrix()
      crownRef.current.setMatrixAt(i, dummy.matrix)
      crownRef.current.setColorAt(i, color.set('#2f7d3a').lerp(new THREE.Color('#8abf55'), tree.tint * 0.35))
    }
    trunkRef.current.instanceMatrix.needsUpdate = true
    crownRef.current.instanceMatrix.needsUpdate = true
    if (crownRef.current.instanceColor) crownRef.current.instanceColor.needsUpdate = true
  }, [trees])

  return (
    <>
      <instancedMesh ref={trunkRef} args={[undefined, undefined, trees.length]} castShadow frustumCulled={false}>
        <cylinderGeometry args={[1, 1, 1, 6]} />
        <meshStandardMaterial color="#4d321f" roughness={0.95} />
      </instancedMesh>
      <instancedMesh ref={crownRef} args={[undefined, undefined, trees.length]} castShadow frustumCulled={false}>
        <dodecahedronGeometry args={[1, 0]} />
        <meshStandardMaterial color="#ffffff" vertexColors roughness={0.9} flatShading />
      </instancedMesh>
    </>
  )
}

function Landmark({ place }) {
  const color = {
    transit: '#55a7ff',
    finance: '#8ecae6',
    cafe: '#d98b5f',
    hospital: '#e85d75',
    workshop: '#9b7ede',
    retail: '#f4a261',
    school: '#78c6a3',
    leisure: '#ff7ab6',
    park: '#8ac926',
    logistics: '#adb5bd',
  }[place.kind] || '#ffffff'

  return (
    <group position={[place.x, place.y, place.z]}>
      <mesh castShadow receiveShadow position={[0, 1.5, 0]}>
        <cylinderGeometry args={[place.radius * 0.38, place.radius * 0.46, 3, 24]} />
        <meshStandardMaterial color={color} roughness={0.35} metalness={0.18} />
      </mesh>
      <mesh castShadow position={[0, 7 + place.scale * 2, 0]}>
        <boxGeometry args={[place.radius * 0.72, 8 + place.scale * 6, place.radius * 0.72]} />
        <meshStandardMaterial color={color} roughness={0.25} metalness={0.45} emissive={color} emissiveIntensity={0.14} />
      </mesh>
      <mesh position={[0, 16 + place.scale * 4, 0]}>
        <sphereGeometry args={[2.3, 18, 12]} />
        <meshStandardMaterial color="#ffffff" emissive={color} emissiveIntensity={2.2} />
      </mesh>
      <Billboard position={[0, 24 + place.scale * 6, 0]}>
        <Text fontSize={4.2} maxWidth={70} textAlign="center" color="#f8fbff" outlineWidth={0.12} outlineColor="#07111d">
          {place.name}
        </Text>
      </Billboard>
    </group>
  )
}

export default function CityMeshes({ city }) {
  const terrain = useMemo(() => makeTerrainGeometry(), [])
  const roads = useMemo(() => makeRoadGeometry(city.roads), [city.roads])
  const roadTexture = useMemo(() => makeRoadTexture(), [])

  return (
    <>
      <mesh geometry={terrain} receiveShadow>
        <meshStandardMaterial vertexColors roughness={0.9} metalness={0.02} />
      </mesh>

      <mesh geometry={roads} receiveShadow>
        <meshStandardMaterial map={roadTexture} roughness={0.86} metalness={0.04} />
      </mesh>

      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.45, -180]} receiveShadow>
        <planeGeometry args={[CITY_WORLD_SIZE, 122]} />
        <meshStandardMaterial color="#14324b" roughness={0.1} metalness={0.25} transparent opacity={0.86} />
      </mesh>

      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 2.52, 0]} receiveShadow>
        <circleGeometry args={[CITY_HALF * 0.48, 96]} />
        <meshStandardMaterial color="#303032" roughness={0.95} polygonOffset polygonOffsetFactor={-2} polygonOffsetUnits={-2} />
      </mesh>

      <Buildings buildings={city.buildings} />
      <Trees trees={city.trees} />
      {city.landmarks.map(place => <Landmark key={place.id} place={place} />)}
    </>
  )
}
