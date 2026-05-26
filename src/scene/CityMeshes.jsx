import { useLayoutEffect, useMemo, useRef } from 'react'
import { useFrame } from '@react-three/fiber'
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
import { useCityStore } from '../engine/cityStore'

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

function UrbanBase({ roads }) {
  const blockRef = useRef()
  const curbRef = useRef()
  const sidewalkRef = useRef()
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
  const sidewalks = useMemo(() => {
    const width = 5.8
    return roads.flatMap(road => {
      if (road.axis === 'x') {
        return [
          { x: (road.from + road.to) / 2, z: road.z - road.width / 2 - width / 2 - 0.9, sx: road.to - road.from, sz: width },
          { x: (road.from + road.to) / 2, z: road.z + road.width / 2 + width / 2 + 0.9, sx: road.to - road.from, sz: width },
        ]
      }
      return [
        { x: road.x - road.width / 2 - width / 2 - 0.9, z: (road.from + road.to) / 2, sx: width, sz: road.to - road.from },
        { x: road.x + road.width / 2 + width / 2 + 0.9, z: (road.from + road.to) / 2, sx: width, sz: road.to - road.from },
      ]
    })
  }, [roads])

  useLayoutEffect(() => {
    if (!blockRef.current || !curbRef.current || !sidewalkRef.current) return
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
    sidewalks.forEach((sidewalk, i) => {
      dummy.position.set(sidewalk.x, CITY_BASE_Y + 0.155, sidewalk.z)
      dummy.scale.set(sidewalk.sx, 0.05, sidewalk.sz)
      dummy.updateMatrix()
      sidewalkRef.current.setMatrixAt(i, dummy.matrix)
    })
    blockRef.current.instanceMatrix.needsUpdate = true
    curbRef.current.instanceMatrix.needsUpdate = true
    sidewalkRef.current.instanceMatrix.needsUpdate = true
    if (blockRef.current.instanceColor) blockRef.current.instanceColor.needsUpdate = true
  }, [blocks, sidewalks])

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
      <instancedMesh ref={sidewalkRef} args={[undefined, undefined, sidewalks.length]} frustumCulled={false}>
        <boxGeometry args={[1, 1, 1]} />
        <meshBasicMaterial map={pavementTexture} color="#f0eee4" toneMapped={false} />
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
  const edgeRef = useRef()
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
  const edges = useMemo(() => roads.flatMap(road => {
    if (road.axis === 'x') {
      const x = (road.from + road.to) / 2
      const sx = road.to - road.from
      return [
        { x, z: road.z - road.width / 2 + 0.18, sx, sz: 0.16 },
        { x, z: road.z + road.width / 2 - 0.18, sx, sz: 0.16 },
      ]
    }
    const z = (road.from + road.to) / 2
    const sz = road.to - road.from
    return [
      { x: road.x - road.width / 2 + 0.18, z, sx: 0.16, sz },
      { x: road.x + road.width / 2 - 0.18, z, sx: 0.16, sz },
    ]
  }), [roads])

  useLayoutEffect(() => {
    if (!stripeRef.current || !edgeRef.current) return
    const dummy = new THREE.Object3D()
    stripes.forEach((stripe, i) => {
      dummy.position.set(stripe.x, CITY_BASE_Y + 0.17, stripe.z)
      dummy.scale.set(stripe.sx, 0.035, stripe.sz)
      dummy.updateMatrix()
      stripeRef.current.setMatrixAt(i, dummy.matrix)
    })
    edges.forEach((edge, i) => {
      dummy.position.set(edge.x, CITY_BASE_Y + 0.185, edge.z)
      dummy.scale.set(edge.sx, 0.028, edge.sz)
      dummy.updateMatrix()
      edgeRef.current.setMatrixAt(i, dummy.matrix)
    })
    stripeRef.current.instanceMatrix.needsUpdate = true
    edgeRef.current.instanceMatrix.needsUpdate = true
  }, [stripes, edges])

  return (
    <>
      <instancedMesh ref={edgeRef} args={[undefined, undefined, edges.length]} frustumCulled={false}>
        <boxGeometry args={[1, 1, 1]} />
        <meshBasicMaterial color="#f2f4ec" toneMapped={false} />
      </instancedMesh>
      <instancedMesh ref={stripeRef} args={[undefined, undefined, stripes.length]} frustumCulled={false}>
        <boxGeometry args={[1, 1, 1]} />
        <meshBasicMaterial color="#d9b84a" toneMapped={false} />
      </instancedMesh>
    </>
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

function makeGableRoofGeometry() {
  const vertices = [
    -0.5, 0, -0.5, 0.5, 0, -0.5, 0, 1, -0.5,
    0.5, 0, 0.5, -0.5, 0, 0.5, 0, 1, 0.5,
    -0.5, 0, -0.5, -0.5, 0, 0.5, 0, 1, 0.5,
    -0.5, 0, -0.5, 0, 1, 0.5, 0, 1, -0.5,
    0.5, 0, -0.5, 0, 1, -0.5, 0, 1, 0.5,
    0.5, 0, -0.5, 0, 1, 0.5, 0.5, 0, 0.5,
    -0.5, 0, -0.5, 0.5, 0, 0.5, -0.5, 0, 0.5,
    -0.5, 0, -0.5, 0.5, 0, -0.5, 0.5, 0, 0.5,
  ]
  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3))
  geometry.computeVertexNormals()
  return geometry
}

function worldOffset(building, lx = 0, lz = 0) {
  const cos = Math.cos(building.rot || 0)
  const sin = Math.sin(building.rot || 0)
  return {
    x: building.x + lx * cos + lz * sin,
    z: building.z - lx * sin + lz * cos,
  }
}

function bodyColor(type) {
  return {
    skyscraper: '#a8c3d2',
    office: '#c1c7c2',
    apartment: '#c9ad8b',
    house: '#c18a6d',
  }[type] || '#b9c0c2'
}

function roofColor(building) {
  if (building.type === 'house') {
    return {
      brick: '#6f2f27',
      stucco: '#7c5041',
      timber: '#4b3b31',
      painted: '#2f4654',
    }[building.form?.facade] || '#5b3e35'
  }
  if (building.type === 'skyscraper') return '#1f3542'
  if (building.type === 'office') return '#56646a'
  return '#6b6258'
}

function partFromBuilding(building, { lx = 0, lz = 0, yOffset = 0, sx = building.w, sy = building.h, sz = building.d, rx = 0, rz = 0, color = bodyColor(building.type), textureType = building.type }) {
  const position = worldOffset(building, lx, lz)
  return {
    building,
    textureType,
    localX: lx,
    localZ: lz,
    x: position.x,
    z: position.z,
    y: building.y + yOffset + sy / 2,
    sx,
    sy,
    sz,
    rot: building.rot || 0,
    rx,
    rz,
    color,
  }
}

function roofPartFromBuilding(building, { lx = 0, lz = 0, baseY = building.h, sx = building.w, sy = 1, sz = building.d, rx = 0, rz = 0, centered = false, color = roofColor(building) }) {
  const position = worldOffset(building, lx, lz)
  return {
    building,
    localX: lx,
    localZ: lz,
    x: position.x,
    z: position.z,
    y: building.y + baseY + (centered ? sy / 2 : 0),
    sx,
    sy,
    sz,
    rot: building.rot || 0,
    rx,
    rz,
    color,
  }
}

function mainMassFor(building) {
  const form = building.form || {}
  const profile = form.profile || 'slab'
  if (building.type === 'house') {
    const sy = Math.max(3.2, building.h * (form.bodyRatio || 0.72))
    const row = profile === 'rowhouse'
    return partFromBuilding(building, {
      sx: building.w * (row ? 1.08 : 0.92),
      sy,
      sz: building.d * (row ? 0.82 : 0.9),
      color: bodyColor(building.type),
    })
  }

  if (building.type === 'skyscraper') {
    const podiumH = Math.min(13, building.h * 0.16)
    const narrow = profile === 'needle' ? 0.58 : profile === 'setback' ? 0.68 : 0.76
    return partFromBuilding(building, {
      lx: profile === 'twin_core' ? -building.w * 0.16 : 0,
      yOffset: podiumH * 0.72,
      sx: building.w * narrow,
      sy: Math.max(22, building.h - podiumH * 0.72),
      sz: building.d * (profile === 'needle' ? 0.6 : 0.76),
    })
  }

  if (building.type === 'office') {
    const podiumH = Math.min(8, building.h * 0.24)
    const compact = profile === 'podium_tower' || profile === 'offset_core'
    return partFromBuilding(building, {
      lx: profile === 'offset_core' ? building.w * 0.08 : 0,
      lz: profile === 'atrium' ? -building.d * 0.08 : 0,
      yOffset: compact ? podiumH * 0.85 : 0,
      sx: building.w * (compact ? 0.72 : 0.92),
      sy: compact ? building.h - podiumH * 0.85 : building.h,
      sz: building.d * (compact ? 0.78 : 0.9),
    })
  }

  const bar = profile === 'bar' || profile === 'balcony_stack'
  return partFromBuilding(building, {
    sx: building.w * (bar ? 1.05 : 0.82),
    sy: building.h * (profile === 'terraced' ? 0.88 : 1),
    sz: building.d * (bar ? 0.62 : 0.94),
  })
}

function createBuildingRenderData(buildings) {
  const bodies = { skyscraper: [], office: [], apartment: [], house: [] }
  const podiums = []
  const wings = []
  const flatRoofs = []
  const gableRoofs = []
  const hipRoofs = []
  const shedRoofs = []
  const crowns = []
  const balconies = []
  const porches = []
  const garages = []
  const chimneys = []
  const antennas = []

  for (const building of buildings) {
    const form = building.form || {}
    const body = mainMassFor(building)
    bodies[building.type]?.push(body)

    if (building.type !== 'house' && form.podium) {
      const podiumH = Math.min(building.type === 'skyscraper' ? 13 : 8, building.h * 0.22)
      podiums.push(partFromBuilding(building, {
        sx: building.w * 1.08,
        sy: podiumH,
        sz: building.d * 1.05,
        color: building.type === 'apartment' ? '#b99778' : '#7d898a',
      }))
    }

    if (form.wing) {
      const side = building.tint > 0.5 ? 1 : -1
      if (building.type === 'house') {
        wings.push(partFromBuilding(building, {
          lx: side * building.w * 0.26,
          lz: building.d * 0.08,
          sx: building.w * 0.42,
          sy: body.sy * 0.76,
          sz: building.d * 0.52,
          color: '#b8795e',
        }))
      } else {
        wings.push(partFromBuilding(building, {
          lx: side * building.w * 0.28,
          lz: building.d * 0.05,
          sx: building.w * 0.42,
          sy: Math.max(6, body.sy * 0.72),
          sz: building.d * (building.type === 'apartment' ? 0.88 : 0.62),
          color: building.type === 'office' ? '#aeb9b8' : '#b89b7b',
        }))
      }
    }

    const topY = body.y - building.y + body.sy / 2
    if (building.type === 'house') {
      const roofH = 1.15 + building.tint * 1.35
      const roofW = body.sx * 1.16
      const roofD = body.sz * 1.16
      if (form.roof === 'hip') {
        hipRoofs.push(roofPartFromBuilding(building, { baseY: topY, sx: roofW / 2, sy: roofH, sz: roofD / 2, centered: true }))
      } else if (form.roof === 'flat') {
        flatRoofs.push(roofPartFromBuilding(building, { baseY: topY, sx: roofW, sy: 0.38, sz: roofD, centered: true }))
      } else if (form.roof === 'shed') {
        shedRoofs.push(roofPartFromBuilding(building, { baseY: topY + 0.12, sx: roofW, sy: 0.42, sz: roofD, rx: -0.12, centered: true }))
      } else {
        gableRoofs.push(roofPartFromBuilding(building, { baseY: topY, sx: roofW, sy: roofH, sz: roofD }))
      }

      if (form.porch) {
        porches.push(partFromBuilding(building, {
          lz: -body.sz * 0.58,
          sx: Math.min(5.2, body.sx * 0.54),
          sy: 0.18,
          sz: 2.4,
          yOffset: 2.25,
          color: '#5d4a3a',
        }))
      }
      if (form.garage) {
        garages.push(partFromBuilding(building, {
          lx: (building.tint > 0.5 ? 1 : -1) * body.sx * 0.42,
          lz: -body.sz * 0.2,
          sx: body.sx * 0.36,
          sy: Math.min(2.5, body.sy * 0.62),
          sz: body.sz * 0.46,
          color: '#8c8175',
        }))
      }
      if (form.chimney) {
        chimneys.push(roofPartFromBuilding(building, {
          lx: body.sx * 0.26,
          lz: -body.sz * 0.12,
          baseY: topY + roofH * 0.48,
          sx: 0.42,
          sy: 1.55,
          sz: 0.42,
          centered: true,
          color: '#4f342b',
        }))
      }
    } else {
      flatRoofs.push(roofPartFromBuilding(building, {
        lx: body.localX,
        lz: body.localZ,
        baseY: topY,
        sx: body.sx * 1.02,
        sy: 0.5,
        sz: body.sz * 1.02,
        centered: true,
      }))

      if (building.type === 'skyscraper' || form.roof === 'crown') {
        crowns.push(roofPartFromBuilding(building, {
          lx: body.localX,
          lz: body.localZ,
          baseY: topY + 0.3,
          sx: body.sx * 0.54,
          sy: Math.max(1.2, building.h * 0.035),
          sz: body.sz * 0.54,
          centered: true,
          color: '#2c4654',
        }))
      }
      if (form.roof === 'antenna') {
        antennas.push(roofPartFromBuilding(building, {
          lx: body.localX,
          lz: body.localZ,
          baseY: topY + 1.4,
          sx: 0.12,
          sy: Math.max(6, building.h * 0.12),
          sz: 0.12,
          centered: true,
          color: '#c9d2d7',
        }))
      }
      if (building.type === 'apartment' && form.balconies) {
        const floors = Math.min(8, Math.max(3, Math.floor(building.h / 4.2)))
        for (let floor = 1; floor <= floors; floor += 1) {
          balconies.push(partFromBuilding(building, {
            lz: -body.sz * 0.53,
            yOffset: Math.min(building.h - 1.2, floor * (building.h / (floors + 1))),
            sx: body.sx * 0.72,
            sy: 0.14,
            sz: 0.72,
            color: '#d7d0c4',
          }))
        }
      }
    }
  }

  return { bodies, podiums, wings, flatRoofs, gableRoofs, hipRoofs, shedRoofs, crowns, balconies, porches, garages, chimneys, antennas }
}

function applyPart(mesh, index, part, dummy, color) {
  dummy.position.set(part.x, part.y, part.z)
  dummy.rotation.set(part.rx || 0, part.rot || 0, part.rz || 0)
  dummy.scale.set(part.sx, part.sy, part.sz)
  dummy.updateMatrix()
  mesh.setMatrixAt(index, dummy.matrix)
  if (color) mesh.setColorAt(index, color.set(part.color).lerp(new THREE.Color('#44525c'), (part.building?.tint || 0) * 0.08))
}

function Buildings({ buildings }) {
  const refs = useRef({})
  const detailRefs = useRef({})
  const textures = useMemo(() => ({
    skyscraper: makeWindowTexture('skyscraper'),
    office: makeWindowTexture('office'),
    apartment: makeWindowTexture('apartment'),
    house: makeWindowTexture('house'),
  }), [])
  const gableGeometry = useMemo(() => makeGableRoofGeometry(), [])
  const renderData = useMemo(() => createBuildingRenderData(buildings), [buildings])

  useLayoutEffect(() => {
    const dummy = new THREE.Object3D()
    const color = new THREE.Color()
    for (const [type, items] of Object.entries(renderData.bodies)) {
      const mesh = refs.current[type]
      if (!mesh) continue
      for (let i = 0; i < items.length; i += 1) {
        applyPart(mesh, i, items[i], dummy, color)
      }
      mesh.instanceMatrix.needsUpdate = true
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true
    }
    for (const [key, items] of Object.entries(renderData)) {
      if (key === 'bodies') continue
      const mesh = detailRefs.current[key]
      if (!mesh) continue
      for (let i = 0; i < items.length; i += 1) applyPart(mesh, i, items[i], dummy, color)
      mesh.instanceMatrix.needsUpdate = true
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true
    }
  }, [renderData])

  return (
    <>
      {Object.entries(renderData.bodies).map(([type, items]) => {
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
              emissive={isGlass ? '#1c3342' : type === 'apartment' ? '#2f241b' : type === 'house' ? '#4a2b1e' : '#202728'}
              emissiveIntensity={isGlass ? 0.28 : type === 'house' ? 0.3 : 0.18}
              envMapIntensity={isGlass ? 1.25 : 0.45}
            />
          </instancedMesh>
        )
      })}
      {renderData.podiums.length ? (
        <instancedMesh ref={node => { if (node) detailRefs.current.podiums = node }} args={[undefined, undefined, renderData.podiums.length]} castShadow receiveShadow frustumCulled={false}>
          <boxGeometry args={[1, 1, 1]} />
          <meshStandardMaterial color="#ffffff" vertexColors roughness={0.58} metalness={0.08} emissive="#151515" emissiveIntensity={0.07} />
        </instancedMesh>
      ) : null}
      {renderData.wings.length ? (
        <instancedMesh ref={node => { if (node) detailRefs.current.wings = node }} args={[undefined, undefined, renderData.wings.length]} castShadow receiveShadow frustumCulled={false}>
          <boxGeometry args={[1, 1, 1]} />
          <meshStandardMaterial color="#ffffff" vertexColors roughness={0.62} metalness={0.06} emissive="#211611" emissiveIntensity={0.12} />
        </instancedMesh>
      ) : null}
      {renderData.flatRoofs.length ? (
        <instancedMesh ref={node => { if (node) detailRefs.current.flatRoofs = node }} args={[undefined, undefined, renderData.flatRoofs.length]} castShadow frustumCulled={false}>
          <boxGeometry args={[1, 1, 1]} />
          <meshStandardMaterial color="#ffffff" vertexColors roughness={0.5} metalness={0.12} emissive="#181818" emissiveIntensity={0.08} />
        </instancedMesh>
      ) : null}
      {renderData.gableRoofs.length ? (
        <instancedMesh ref={node => { if (node) detailRefs.current.gableRoofs = node }} args={[gableGeometry, undefined, renderData.gableRoofs.length]} castShadow frustumCulled={false}>
          <meshStandardMaterial color="#ffffff" vertexColors roughness={0.74} metalness={0.04} emissive="#321d17" emissiveIntensity={0.16} />
        </instancedMesh>
      ) : null}
      {renderData.hipRoofs.length ? (
        <instancedMesh ref={node => { if (node) detailRefs.current.hipRoofs = node }} args={[undefined, undefined, renderData.hipRoofs.length]} castShadow frustumCulled={false}>
          <coneGeometry args={[1, 1, 4]} />
          <meshStandardMaterial color="#ffffff" vertexColors roughness={0.74} metalness={0.04} emissive="#321d17" emissiveIntensity={0.16} flatShading />
        </instancedMesh>
      ) : null}
      {renderData.shedRoofs.length ? (
        <instancedMesh ref={node => { if (node) detailRefs.current.shedRoofs = node }} args={[undefined, undefined, renderData.shedRoofs.length]} castShadow frustumCulled={false}>
          <boxGeometry args={[1, 1, 1]} />
          <meshStandardMaterial color="#ffffff" vertexColors roughness={0.68} metalness={0.05} emissive="#321d17" emissiveIntensity={0.16} />
        </instancedMesh>
      ) : null}
      {renderData.crowns.length ? (
        <instancedMesh ref={node => { if (node) detailRefs.current.crowns = node }} args={[undefined, undefined, renderData.crowns.length]} castShadow frustumCulled={false}>
          <boxGeometry args={[1, 1, 1]} />
          <meshStandardMaterial color="#ffffff" vertexColors roughness={0.22} metalness={0.32} emissive="#122a34" emissiveIntensity={0.24} />
        </instancedMesh>
      ) : null}
      {renderData.balconies.length ? (
        <instancedMesh ref={node => { if (node) detailRefs.current.balconies = node }} args={[undefined, undefined, renderData.balconies.length]} castShadow frustumCulled={false}>
          <boxGeometry args={[1, 1, 1]} />
          <meshStandardMaterial color="#ffffff" vertexColors roughness={0.46} metalness={0.14} />
        </instancedMesh>
      ) : null}
      {renderData.porches.length ? (
        <instancedMesh ref={node => { if (node) detailRefs.current.porches = node }} args={[undefined, undefined, renderData.porches.length]} castShadow frustumCulled={false}>
          <boxGeometry args={[1, 1, 1]} />
          <meshStandardMaterial color="#ffffff" vertexColors roughness={0.78} metalness={0.04} emissive="#201712" emissiveIntensity={0.12} />
        </instancedMesh>
      ) : null}
      {renderData.garages.length ? (
        <instancedMesh ref={node => { if (node) detailRefs.current.garages = node }} args={[undefined, undefined, renderData.garages.length]} castShadow receiveShadow frustumCulled={false}>
          <boxGeometry args={[1, 1, 1]} />
          <meshStandardMaterial color="#ffffff" vertexColors roughness={0.66} metalness={0.1} emissive="#171717" emissiveIntensity={0.1} />
        </instancedMesh>
      ) : null}
      {renderData.chimneys.length ? (
        <instancedMesh ref={node => { if (node) detailRefs.current.chimneys = node }} args={[undefined, undefined, renderData.chimneys.length]} castShadow frustumCulled={false}>
          <boxGeometry args={[1, 1, 1]} />
          <meshStandardMaterial color="#ffffff" vertexColors roughness={0.9} metalness={0.02} emissive="#1c100c" emissiveIntensity={0.14} />
        </instancedMesh>
      ) : null}
      {renderData.antennas.length ? (
        <instancedMesh ref={node => { if (node) detailRefs.current.antennas = node }} args={[undefined, undefined, renderData.antennas.length]} frustumCulled={false}>
          <cylinderGeometry args={[1, 1, 1, 6]} />
          <meshStandardMaterial color="#ffffff" vertexColors roughness={0.35} metalness={0.7} />
        </instancedMesh>
      ) : null}
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

function AutomaticDoorPanels({ place, color }) {
  const leftRef = useRef()
  const rightRef = useRef()
  const open = useRef(0)
  const interior = place.interior

  const door = interior.doorWidth
  const frontZ = -interior.depth / 2

  useFrame((_, delta) => {
    const player = useCityStore.getState().player
    const localX = player.x - place.x
    const localZ = player.z - place.z
    const nearDoor = Math.abs(localX) < door * 0.9 && Math.abs(localZ - frontZ) < 6.5
    const insideLobby = Math.abs(localX) < interior.width / 2 && Math.abs(localZ) < interior.depth / 2
    const target = nearDoor || insideLobby ? 1 : 0
    open.current += (target - open.current) * (1 - Math.exp(-8 * Math.min(delta, 0.05)))
    const slide = open.current * door * 0.42
    if (leftRef.current) leftRef.current.position.x = -door * 0.28 - slide
    if (rightRef.current) rightRef.current.position.x = door * 0.28 + slide
  })

  return (
    <group>
      <mesh ref={leftRef} position={[-door * 0.28, 2.1, frontZ - 0.12]}>
        <boxGeometry args={[door * 0.42, 3.8, 0.12]} />
        <meshStandardMaterial color="#b8ecff" roughness={0.08} metalness={0.34} transparent opacity={0.45} />
      </mesh>
      <mesh ref={rightRef} position={[door * 0.28, 2.1, frontZ - 0.12]}>
        <boxGeometry args={[door * 0.42, 3.8, 0.12]} />
        <meshStandardMaterial color="#b8ecff" roughness={0.08} metalness={0.34} transparent opacity={0.45} />
      </mesh>
      <mesh position={[0, 4.45, frontZ - 0.18]}>
        <boxGeometry args={[door + 1.2, 0.48, 0.18]} />
        <meshStandardMaterial color="#101820" emissive={color} emissiveIntensity={0.55} roughness={0.28} metalness={0.24} />
      </mesh>
    </group>
  )
}

function InteriorShell({ place, color }) {
  const interior = place.interior
  if (!interior) return null

  const w = interior.width
  const d = interior.depth
  const h = interior.height
  const t = 0.42
  const door = interior.doorWidth
  const sideWidth = (w - door) / 2
  const frontZ = -d / 2
  const backZ = d / 2
  const wallColor = place.kind === 'hospital' ? '#dfe8ed' : place.kind === 'logistics' ? '#9fa7ac' : '#c7c0b3'

  const verticalCore = interior.verticalCore === 'elevator'
    ? (
      <group position={[w * 0.25, 0, d * 0.25]}>
        <mesh castShadow receiveShadow position={[0, h * 0.36, 0]}>
          <boxGeometry args={[4.6, h * 0.72, 4.2]} />
          <meshStandardMaterial color="#303941" roughness={0.36} metalness={0.28} />
        </mesh>
        <mesh position={[0, 2.2, -2.14]}>
          <boxGeometry args={[3.2, 3.7, 0.16]} />
          <meshStandardMaterial color="#b6c0c6" roughness={0.26} metalness={0.62} />
        </mesh>
        <mesh position={[0, 4.7, -2.24]}>
          <boxGeometry args={[2.4, 0.34, 0.18]} />
          <meshStandardMaterial color="#6be6ff" emissive="#3db8ff" emissiveIntensity={0.5} />
        </mesh>
      </group>
    )
    : interior.verticalCore === 'escalator'
      ? (
        <group position={[w * 0.22, 0.7, d * 0.18]} rotation={[0.18, 0, -0.35]}>
          <mesh castShadow receiveShadow>
            <boxGeometry args={[2.2, 0.38, 8.4]} />
            <meshStandardMaterial color="#49515a" roughness={0.38} metalness={0.34} />
          </mesh>
          <mesh position={[-1.2, 0.32, 0]}>
            <boxGeometry args={[0.18, 0.42, 8.8]} />
            <meshStandardMaterial color="#d8e4ea" roughness={0.22} metalness={0.6} />
          </mesh>
          <mesh position={[1.2, 0.32, 0]}>
            <boxGeometry args={[0.18, 0.42, 8.8]} />
            <meshStandardMaterial color="#d8e4ea" roughness={0.22} metalness={0.6} />
          </mesh>
        </group>
      )
      : (
        <group position={[w * 0.23, 0.25, d * 0.18]}>
          {Array.from({ length: 7 }, (_, i) => (
            <mesh key={i} castShadow receiveShadow position={[0, i * 0.22, i * 0.54]}>
              <boxGeometry args={[4.5, 0.2, 0.5]} />
              <meshStandardMaterial color="#7c858b" roughness={0.58} metalness={0.12} />
            </mesh>
          ))}
          <mesh position={[2.35, 0.92, 1.7]}>
            <boxGeometry args={[0.15, 1.4, 4.5]} />
            <meshStandardMaterial color="#d8e4ea" roughness={0.24} metalness={0.58} />
          </mesh>
        </group>
      )

  return (
    <group>
      <mesh receiveShadow position={[0, 0.08, 0]}>
        <boxGeometry args={[w, 0.16, d]} />
        <meshStandardMaterial color={place.kind === 'logistics' ? '#697176' : '#bfc4c5'} roughness={0.48} metalness={0.06} />
      </mesh>
      <mesh castShadow receiveShadow position={[0, h / 2, backZ]}>
        <boxGeometry args={[w, h, t]} />
        <meshStandardMaterial color={wallColor} roughness={0.54} metalness={0.08} />
      </mesh>
      <mesh castShadow receiveShadow position={[-w / 2, h / 2, 0]}>
        <boxGeometry args={[t, h, d]} />
        <meshStandardMaterial color={wallColor} roughness={0.54} metalness={0.08} />
      </mesh>
      <mesh castShadow receiveShadow position={[w / 2, h / 2, 0]}>
        <boxGeometry args={[t, h, d]} />
        <meshStandardMaterial color={wallColor} roughness={0.54} metalness={0.08} />
      </mesh>
      <mesh castShadow receiveShadow position={[-door / 2 - sideWidth / 2, h / 2, frontZ]}>
        <boxGeometry args={[sideWidth, h, t]} />
        <meshStandardMaterial color={wallColor} roughness={0.54} metalness={0.08} />
      </mesh>
      <mesh castShadow receiveShadow position={[door / 2 + sideWidth / 2, h / 2, frontZ]}>
        <boxGeometry args={[sideWidth, h, t]} />
        <meshStandardMaterial color={wallColor} roughness={0.54} metalness={0.08} />
      </mesh>
      <mesh castShadow receiveShadow position={[0, h + 0.22, 0]}>
        <boxGeometry args={[w + 1.8, 0.44, d + 1.8]} />
        <meshStandardMaterial color="#343b42" roughness={0.45} metalness={0.16} />
      </mesh>
      <AutomaticDoorPanels place={place} color={color} />
      <mesh receiveShadow position={[0, 0.11, -d * 0.1]}>
        <boxGeometry args={[Math.max(3, door * 0.8), 0.05, Math.max(6, interior.lobbyDepth)]} />
        <meshStandardMaterial color="#d7dce0" roughness={0.32} metalness={0.04} />
      </mesh>
      <mesh position={[-w * 0.2, 1.25, d * 0.18]}>
        <boxGeometry args={[4.8, 2.2, 1.0]} />
        <meshStandardMaterial color="#5f6b72" roughness={0.56} metalness={0.14} />
      </mesh>
      {verticalCore}
    </group>
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
      <InteriorShell place={place} color={color} />
      {place.kind === 'finance' ? (
        <>
          <mesh castShadow receiveShadow position={[0, 42, 0]}>
            <boxGeometry args={[15, 50, 15]} />
            <meshStandardMaterial color="#9fb8c7" roughness={0.18} metalness={0.35} transparent opacity={0.88} />
          </mesh>
        </>
      ) : place.kind === 'transit' ? (
        <>
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

      <UrbanBase roads={city.roads} />

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
