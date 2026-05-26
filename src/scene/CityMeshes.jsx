import { useLayoutEffect, useMemo, useRef } from 'react'
import { Billboard, Text } from '@react-three/drei'
import * as THREE from 'three'
import {
  CITY_BASE_Y,
  CITY_GRID_HALF,
  CITY_WORLD_SIZE,
  ROAD_SPACING,
  ROAD_WIDTH,
  terrainHeight,
  terrainTone,
} from '../engine/cityEngine'

function makeTerrainGeometry() {
  const segments = 140
  const geometry = new THREE.PlaneGeometry(CITY_WORLD_SIZE, CITY_WORLD_SIZE, segments, segments)
  geometry.rotateX(-Math.PI / 2)
  const positions = geometry.attributes.position
  const colors = new Float32Array(positions.count * 3)

  for (let i = 0; i < positions.count; i += 1) {
    const x = positions.getX(i)
    const z = positions.getZ(i)
    const distance = Math.hypot(x, z)
    const h = distance < CITY_GRID_HALF * 1.08 ? CITY_BASE_Y - 0.22 : terrainHeight(x, z)
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
      const y = CITY_BASE_Y + 0.1
      vertices.push(road.from, y, z0, road.to, y, z0, road.to, y, z1, road.from, y, z0, road.to, y, z1, road.from, y, z1)
      uvs.push(0, 0, 36, 0, 36, 1, 0, 0, 36, 1, 0, 1)
    } else {
      const x0 = road.x - hw
      const x1 = road.x + hw
      const y = CITY_BASE_Y + 0.1
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
  ctx.fillStyle = '#474c4f'
  ctx.fillRect(0, 0, 512, 512)
  ctx.fillStyle = 'rgba(255,255,255,0.035)'
  for (let i = 0; i < 150; i += 1) {
    ctx.fillRect(Math.random() * 512, Math.random() * 512, 2 + Math.random() * 24, 1)
  }
  ctx.fillStyle = 'rgba(0,0,0,0.045)'
  for (let i = 0; i < 90; i += 1) {
    ctx.fillRect(Math.random() * 512, Math.random() * 512, 4 + Math.random() * 34, 1)
  }
  ctx.setLineDash([42, 34])
  ctx.strokeStyle = 'rgba(236, 196, 70, 0.72)'
  ctx.lineWidth = 3
  ctx.beginPath()
  ctx.moveTo(256, 0)
  ctx.lineTo(256, 512)
  ctx.moveTo(0, 256)
  ctx.lineTo(512, 256)
  ctx.stroke()
  ctx.setLineDash([])
  ctx.strokeStyle = 'rgba(230,236,240,0.24)'
  ctx.lineWidth = 2
  ctx.beginPath()
  ctx.moveTo(36, 0)
  ctx.lineTo(36, 512)
  ctx.moveTo(476, 0)
  ctx.lineTo(476, 512)
  ctx.moveTo(0, 36)
  ctx.lineTo(512, 36)
  ctx.moveTo(0, 476)
  ctx.lineTo(512, 476)
  ctx.stroke()
  const texture = new THREE.CanvasTexture(canvas)
  texture.wrapS = texture.wrapT = THREE.RepeatWrapping
  texture.colorSpace = THREE.SRGBColorSpace
  return texture
}

function makePavementTexture() {
  const canvas = document.createElement('canvas')
  canvas.width = 512
  canvas.height = 512
  const ctx = canvas.getContext('2d')
  ctx.fillStyle = '#676967'
  ctx.fillRect(0, 0, 512, 512)
  ctx.strokeStyle = 'rgba(46, 50, 50, 0.74)'
  ctx.lineWidth = 2
  for (let p = 0; p <= 512; p += 64) {
    ctx.beginPath()
    ctx.moveTo(p, 0)
    ctx.lineTo(p, 512)
    ctx.moveTo(0, p)
    ctx.lineTo(512, p)
    ctx.stroke()
  }
  ctx.fillStyle = 'rgba(255,255,255,0.035)'
  for (let i = 0; i < 140; i += 1) {
    ctx.fillRect(Math.random() * 512, Math.random() * 512, 1 + Math.random() * 18, 1)
  }
  ctx.fillStyle = 'rgba(0,0,0,0.035)'
  for (let i = 0; i < 110; i += 1) {
    ctx.fillRect(Math.random() * 512, Math.random() * 512, 2 + Math.random() * 20, 1)
  }
  const texture = new THREE.CanvasTexture(canvas)
  texture.wrapS = texture.wrapT = THREE.RepeatWrapping
  texture.repeat.set(1.5, 1.5)
  texture.colorSpace = THREE.SRGBColorSpace
  return texture
}

function UrbanBase() {
  const blockRef = useRef()
  const curbRef = useRef()
  const pavementTexture = useMemo(() => makePavementTexture(), [])
  const blocks = useMemo(() => {
    const items = []
    for (let x = -CITY_GRID_HALF + ROAD_SPACING / 2; x < CITY_GRID_HALF; x += ROAD_SPACING) {
      for (let z = -CITY_GRID_HALF + ROAD_SPACING / 2; z < CITY_GRID_HALF; z += ROAD_SPACING) {
        const distance = Math.hypot(x, z)
        if (distance > 930) continue
        const isPlaza = distance < 132
        items.push({ x, z, size: ROAD_SPACING - ROAD_WIDTH - (isPlaza ? 2 : 10), plaza: isPlaza })
      }
    }
    return items
  }, [])

  useLayoutEffect(() => {
    if (!blockRef.current || !curbRef.current) return
    const dummy = new THREE.Object3D()
    const color = new THREE.Color()
    blocks.forEach((block, i) => {
      dummy.position.set(block.x, CITY_BASE_Y + 0.02, block.z)
      dummy.scale.set(block.size, 0.12, block.size)
      dummy.updateMatrix()
      blockRef.current.setMatrixAt(i, dummy.matrix)
      blockRef.current.setColorAt(i, color.set(block.plaza ? '#d7d2c6' : '#e0dfd4'))

      dummy.position.set(block.x, CITY_BASE_Y + 0.12, block.z)
      dummy.scale.set(block.size + 2.6, 0.16, block.size + 2.6)
      dummy.updateMatrix()
      curbRef.current.setMatrixAt(i, dummy.matrix)
    })
    blockRef.current.instanceMatrix.needsUpdate = true
    curbRef.current.instanceMatrix.needsUpdate = true
    if (blockRef.current.instanceColor) blockRef.current.instanceColor.needsUpdate = true
  }, [blocks])

  return (
    <>
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, CITY_BASE_Y - 0.03, 0]}>
        <planeGeometry args={[CITY_GRID_HALF * 2.08, CITY_GRID_HALF * 2.08]} />
        <meshBasicMaterial color="#444845" toneMapped={false} />
      </mesh>
      <instancedMesh ref={curbRef} args={[undefined, undefined, blocks.length]} frustumCulled={false}>
        <boxGeometry args={[1, 1, 1]} />
        <meshBasicMaterial color="#343839" toneMapped={false} />
      </instancedMesh>
      <instancedMesh ref={blockRef} args={[undefined, undefined, blocks.length]} frustumCulled={false}>
        <boxGeometry args={[1, 1, 1]} />
        <meshBasicMaterial map={pavementTexture} color="#ffffff" vertexColors toneMapped={false} />
      </instancedMesh>
    </>
  )
}

function RoadMarkings({ roads }) {
  const stripeRef = useRef()
  const stripes = useMemo(() => {
    const items = []
    for (const road of roads) {
      if (!road.main) continue
      for (let p = road.from + 34; p < road.to - 34; p += 52) {
        items.push(road.axis === 'x'
          ? { x: p, z: road.z, sx: 15, sz: 0.42 }
          : { x: road.x, z: p, sx: 0.42, sz: 15 })
      }
    }
    return items
  }, [roads])

  useLayoutEffect(() => {
    if (!stripeRef.current) return
    const dummy = new THREE.Object3D()
    stripes.forEach((stripe, i) => {
      dummy.position.set(stripe.x, CITY_BASE_Y + 0.17, stripe.z)
      dummy.scale.set(stripe.sx, 0.035, stripe.sz)
      dummy.updateMatrix()
      stripeRef.current.setMatrixAt(i, dummy.matrix)
    })
    stripeRef.current.instanceMatrix.needsUpdate = true
  }, [stripes])

  return (
    <instancedMesh ref={stripeRef} args={[undefined, undefined, stripes.length]} frustumCulled={false}>
      <boxGeometry args={[1, 1, 1]} />
      <meshBasicMaterial color="#d9b84a" toneMapped={false} />
    </instancedMesh>
  )
}

function makeWindowTexture(type) {
  const canvas = document.createElement('canvas')
  canvas.width = 256
  canvas.height = 512
  const ctx = canvas.getContext('2d')
  const wall = {
    skyscraper: '#5f7f90',
    office: '#8c9693',
    apartment: '#aa967f',
    house: '#b1846b',
  }[type] || '#63717a'
  const cols = type === 'skyscraper' ? 8 : type === 'house' ? 3 : 6
  const rows = type === 'skyscraper' ? 24 : type === 'house' ? 5 : 15
  ctx.fillStyle = wall
  ctx.fillRect(0, 0, 256, 512)

  ctx.fillStyle = 'rgba(255,255,255,0.045)'
  for (let i = 0; i < 180; i += 1) {
    const x = (i * 47) % 256
    const y = (i * 83) % 512
    ctx.fillRect(x, y, 1 + (i % 7), 1)
  }
  ctx.strokeStyle = type === 'house' ? 'rgba(80,54,40,0.34)' : 'rgba(255,255,255,0.13)'
  ctx.lineWidth = 2
  for (let c = 0; c <= cols; c += 1) {
    const x = (c / cols) * 256
    ctx.beginPath()
    ctx.moveTo(x, 0)
    ctx.lineTo(x, 512)
    ctx.stroke()
  }
  for (let r = 0; r < rows; r += 1) {
    for (let c = 0; c < cols; c += 1) {
      const lit = (r * 17 + c * 11 + type.length) % 5 !== 0
      const cellW = 256 / cols
      const cellH = 512 / rows
      const x = c * cellW + cellW * 0.2
      const y = r * cellH + cellH * 0.25
      const w = cellW * 0.58
      const h = cellH * 0.5
      ctx.fillStyle = 'rgba(8,13,18,0.28)'
      ctx.fillRect(x - 2, y - 2, w + 4, h + 4)
      ctx.fillStyle = lit ? '#eac46f' : '#1e2a33'
      ctx.fillRect(x, y, w, h)
      ctx.fillStyle = lit ? 'rgba(255,255,255,0.22)' : 'rgba(111,158,184,0.12)'
      ctx.fillRect(x + w * 0.12, y + h * 0.1, w * 0.18, h * 0.78)
    }
  }
  ctx.strokeStyle = type === 'apartment' || type === 'house' ? 'rgba(68,45,32,0.42)' : 'rgba(20,28,35,0.28)'
  ctx.lineWidth = 3
  for (let r = 1; r < rows; r += 1) {
    const y = (r / rows) * 512
    ctx.beginPath()
    ctx.moveTo(0, y)
    ctx.lineTo(256, y)
    ctx.stroke()
  }
  const texture = new THREE.CanvasTexture(canvas)
  texture.wrapS = texture.wrapT = THREE.RepeatWrapping
  texture.repeat.set(1, type === 'skyscraper' ? 3.2 : type === 'office' ? 2.1 : type === 'apartment' ? 1.55 : 1)
  texture.colorSpace = THREE.SRGBColorSpace
  texture.anisotropy = 4
  return texture
}

function Buildings({ buildings }) {
  const refs = useRef({})
  const textures = useMemo(() => ({
    skyscraper: makeWindowTexture('skyscraper'),
    office: makeWindowTexture('office'),
    apartment: makeWindowTexture('apartment'),
    house: makeWindowTexture('house'),
  }), [])
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
        const base = type === 'skyscraper' ? '#a8c3d2' : type === 'office' ? '#c1c7c2' : type === 'apartment' ? '#c9ad8b' : '#c18a6d'
        mesh.setColorAt(i, color.set(base).lerp(new THREE.Color('#44525c'), building.tint * 0.14))
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
            frustumCulled={false}
          >
            <boxGeometry args={[1, 1, 1]} />
            <meshStandardMaterial
              map={textures[type]}
              color="#ffffff"
              vertexColors
              roughness={isGlass ? 0.22 : type === 'house' ? 0.76 : 0.52}
              metalness={isGlass ? 0.42 : type === 'office' ? 0.16 : 0.04}
              emissive={isGlass ? '#1c3342' : type === 'apartment' ? '#2b2118' : type === 'house' ? '#28170f' : '#202728'}
              emissiveIntensity={isGlass ? 0.28 : 0.18}
              envMapIntensity={isGlass ? 1.25 : 0.45}
            />
          </instancedMesh>
        )
      })}
    </>
  )
}

function DistantMountains() {
  const ref = useRef()
  const mountains = useMemo(() => Array.from({ length: 38 }, (_, i) => {
    const angle = (i / 38) * Math.PI * 2
    const radius = 1540 + ((i * 97) % 220)
    const height = 85 + ((i * 53) % 160)
    return {
      x: Math.cos(angle) * radius,
      z: Math.sin(angle) * radius,
      y: -24,
      sx: 120 + ((i * 71) % 190),
      sy: height,
      sz: 70 + ((i * 37) % 120),
      yaw: -angle,
      tint: i / 38,
    }
  }), [])

  useLayoutEffect(() => {
    if (!ref.current) return
    const dummy = new THREE.Object3D()
    const color = new THREE.Color()
    mountains.forEach((mountain, i) => {
      dummy.position.set(mountain.x, mountain.y + mountain.sy / 2, mountain.z)
      dummy.rotation.set(0, mountain.yaw, 0)
      dummy.scale.set(mountain.sx, mountain.sy, mountain.sz)
      dummy.updateMatrix()
      ref.current.setMatrixAt(i, dummy.matrix)
      ref.current.setColorAt(i, color.set('#45514d').lerp(new THREE.Color('#6d766d'), mountain.tint * 0.28))
    })
    ref.current.instanceMatrix.needsUpdate = true
    if (ref.current.instanceColor) ref.current.instanceColor.needsUpdate = true
  }, [mountains])

  return (
    <instancedMesh ref={ref} args={[undefined, undefined, mountains.length]} frustumCulled={false}>
      <coneGeometry args={[1, 1, 6]} />
      <meshStandardMaterial color="#ffffff" vertexColors roughness={0.94} metalness={0.02} flatShading />
    </instancedMesh>
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

  const signHeight = place.kind === 'finance' ? 58 : place.kind === 'transit' ? 22 : 15

  return (
    <group position={[place.x, CITY_BASE_Y, place.z]}>
      {place.kind === 'finance' ? (
        <>
          <mesh castShadow receiveShadow position={[0, 18, 0]}>
            <boxGeometry args={[24, 36, 24]} />
            <meshStandardMaterial color="#9fb8c7" roughness={0.18} metalness={0.35} transparent opacity={0.88} />
          </mesh>
          <mesh castShadow receiveShadow position={[0, 43, 0]}>
            <boxGeometry args={[15, 50, 15]} />
            <meshStandardMaterial color="#9fb8c7" roughness={0.18} metalness={0.35} transparent opacity={0.88} />
          </mesh>
        </>
      ) : place.kind === 'transit' ? (
        <>
          <mesh castShadow receiveShadow position={[0, 3.2, 0]}>
            <boxGeometry args={[58, 6.4, 26]} />
            <meshStandardMaterial color={color} roughness={0.42} metalness={0.18} />
          </mesh>
          <mesh castShadow receiveShadow position={[0, 8.2, 0]}>
            <boxGeometry args={[64, 3.4, 30]} />
            <meshStandardMaterial color="#cfd7dd" roughness={0.32} metalness={0.18} />
          </mesh>
          <mesh castShadow position={[0, 11, 0]} rotation={[0, 0, Math.PI / 8]}>
            <boxGeometry args={[68, 1.4, 31]} />
            <meshStandardMaterial color="#2a3034" roughness={0.55} metalness={0.12} />
          </mesh>
        </>
      ) : place.kind === 'park' ? (
        <>
          <mesh receiveShadow position={[0, 0.14, 0]}>
            <cylinderGeometry args={[34, 34, 0.24, 48]} />
            <meshStandardMaterial color="#2f6f3d" roughness={0.9} />
          </mesh>
          <mesh castShadow position={[0, 3.5, 0]}>
            <cylinderGeometry args={[5, 6, 7, 14]} />
            <meshStandardMaterial color="#826d4f" roughness={0.78} />
          </mesh>
        </>
      ) : place.kind === 'logistics' ? (
        <>
          <mesh castShadow receiveShadow position={[0, 5.4, 0]}>
            <boxGeometry args={[58, 10.8, 34]} />
            <meshStandardMaterial color="#9fa7ac" roughness={0.58} metalness={0.08} />
          </mesh>
          <mesh castShadow receiveShadow position={[0, 12.2, 0]}>
            <boxGeometry args={[63, 2.4, 39]} />
            <meshStandardMaterial color="#3e474f" roughness={0.44} metalness={0.18} />
          </mesh>
          {[-19, 0, 19].map(x => (
            <mesh key={`dock-${x}`} receiveShadow position={[x, 3.2, -17.25]}>
              <boxGeometry args={[9.5, 5.8, 0.42]} />
              <meshStandardMaterial color="#2d343a" roughness={0.62} metalness={0.18} />
            </mesh>
          ))}
          {[-24, -12, 12, 24].map(x => (
            <mesh key={`window-${x}`} position={[x, 7.8, 17.25]}>
              <boxGeometry args={[4.5, 1.55, 0.36]} />
              <meshStandardMaterial color="#bde8ff" emissive="#4bb6ff" emissiveIntensity={0.36} roughness={0.22} metalness={0.28} />
            </mesh>
          ))}
          <mesh position={[0, 1.35, -18.15]}>
            <boxGeometry args={[54, 0.18, 0.34]} />
            <meshStandardMaterial color="#f5c542" emissive="#b7791f" emissiveIntensity={0.22} roughness={0.48} />
          </mesh>
          <mesh castShadow position={[-22, 1.4, -23]}>
            <boxGeometry args={[8, 2.8, 4.6]} />
            <meshStandardMaterial color="#d9a441" roughness={0.48} metalness={0.12} />
          </mesh>
          <mesh castShadow position={[20, 1.1, -23]}>
            <boxGeometry args={[7, 2.2, 5]} />
            <meshStandardMaterial color="#58616a" roughness={0.52} metalness={0.12} />
          </mesh>
        </>
      ) : place.kind === 'hospital' ? (
        <>
          <mesh castShadow receiveShadow position={[0, 6.5, 0]}>
            <boxGeometry args={[42, 13, 30]} />
            <meshStandardMaterial color="#dfe8ed" roughness={0.48} metalness={0.05} />
          </mesh>
          <mesh castShadow receiveShadow position={[0, 14.8, 0]}>
            <boxGeometry args={[31, 6, 22]} />
            <meshStandardMaterial color="#cbd9df" roughness={0.42} metalness={0.06} />
          </mesh>
          {[-13, -4.5, 4.5, 13].map(x => (
            <mesh key={`hospital-window-${x}`} position={[x, 7.2, -15.25]}>
              <boxGeometry args={[4.4, 2.2, 0.28]} />
              <meshStandardMaterial color="#c8f2ff" emissive="#76d6ff" emissiveIntensity={0.22} roughness={0.18} metalness={0.16} />
            </mesh>
          ))}
          <mesh position={[0, 8.2, -15.55]}>
            <boxGeometry args={[1.5, 6.8, 0.36]} />
            <meshStandardMaterial color="#e85d75" emissive="#e85d75" emissiveIntensity={0.32} />
          </mesh>
          <mesh position={[0, 8.2, -15.62]}>
            <boxGeometry args={[6.8, 1.5, 0.38]} />
            <meshStandardMaterial color="#e85d75" emissive="#e85d75" emissiveIntensity={0.32} />
          </mesh>
        </>
      ) : (
        <>
          <mesh castShadow receiveShadow position={[0, 4.5, 0]}>
            <boxGeometry args={[26, 9, 22]} />
            <meshStandardMaterial color={color} roughness={0.42} metalness={0.18} />
          </mesh>
          <mesh castShadow receiveShadow position={[0, 10.5, 0]}>
            <boxGeometry args={[22, 4, 18]} />
            <meshStandardMaterial color="#343b42" roughness={0.45} metalness={0.08} />
          </mesh>
          {[-8, 0, 8].map(x => (
            <mesh key={`front-window-${x}`} position={[x, 5.2, -11.25]}>
              <boxGeometry args={[4.2, 2.0, 0.3]} />
              <meshStandardMaterial color="#d4f4ff" emissive="#57c7ff" emissiveIntensity={0.25} roughness={0.2} metalness={0.2} />
            </mesh>
          ))}
          <mesh position={[0, 1.8, -11.4]}>
            <boxGeometry args={[4.4, 3.4, 0.34]} />
            <meshStandardMaterial color="#202831" roughness={0.45} metalness={0.18} />
          </mesh>
          <mesh position={[0, 8.8, -11.55]}>
            <boxGeometry args={[17, 1.1, 0.36]} />
            <meshStandardMaterial color="#101820" emissive={color} emissiveIntensity={0.6} roughness={0.28} metalness={0.24} />
          </mesh>
        </>
      )}
      <mesh position={[0, signHeight - 3, 0]}>
        <sphereGeometry args={[1.35, 16, 10]} />
        <meshStandardMaterial color="#ffffff" emissive={color} emissiveIntensity={1.6} />
      </mesh>
      <Billboard position={[0, signHeight, 0]}>
        <Text fontSize={3.2} maxWidth={64} textAlign="center" color="#f8fbff" outlineWidth={0.1} outlineColor="#07111d">
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
      <mesh geometry={terrain}>
        <meshLambertMaterial vertexColors />
      </mesh>

      <UrbanBase />

      <mesh geometry={roads}>
        <meshBasicMaterial map={roadTexture} color="#ffffff" toneMapped={false} />
      </mesh>
      <RoadMarkings roads={city.roads} />

      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -1.8, -980]} receiveShadow>
        <planeGeometry args={[CITY_WORLD_SIZE, 150]} />
        <meshStandardMaterial color="#14324b" roughness={0.1} metalness={0.25} />
      </mesh>
      <DistantMountains />

      <Buildings buildings={city.buildings} />
      <Trees trees={city.trees} />
      {city.landmarks.map(place => <Landmark key={place.id} place={place} />)}
    </>
  )
}
