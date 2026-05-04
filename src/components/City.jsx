import { useLayoutEffect, useRef, useMemo, useEffect } from 'react'
import { useRapier } from '@react-three/rapier'
import * as THREE from 'three'
import { getTerrainHeight } from '../utils/noise'

// ─── Building colors per zone type ──────────────────────────────────────────
const BUILDING_COLORS = {
  skyscraper: ['#2a5a78', '#1e4a68', '#1a3a58', '#3a6a88', '#1c4860'],
  office:     ['#5a6a5a', '#6a7060', '#7a8070', '#5a6050', '#6a6850'],
  apartment:  ['#9a7a60', '#a08070', '#c09a80', '#b08870', '#9a8060'],
  house:      ['#8a5a48', '#a06050', '#7a4a38', '#906050', '#b07060'],
}

function pickColor(type, index) {
  const palette = BUILDING_COLORS[type] || BUILDING_COLORS.office
  return palette[index % palette.length]
}

// ─── Windows overlay texture (canvas) ───────────────────────────────────────
function makeWindowTex(type) {
  const W = 256, H = 512
  const cv = document.createElement('canvas')
  cv.width = W; cv.height = H
  const ctx = cv.getContext('2d')

  const wallColor = { skyscraper: '#2a4a62', office: '#4a5a4a', apartment: '#6a5038', house: '#6a4030' }
  ctx.fillStyle = wallColor[type] || '#555'
  ctx.fillRect(0, 0, W, H)

  const cols = type === 'skyscraper' ? 8 : type === 'office' ? 6 : 5
  const rows = type === 'skyscraper' ? 24 : type === 'office' ? 18 : 14
  const ww = (W / cols) * 0.58, wh = (H / rows) * 0.52
  const px = (W / cols - ww) / 2, py = (H / rows - wh) / 2

  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const lit = Math.random() < 0.55
      ctx.fillStyle = lit ? '#e8d890' : '#080e18'
      ctx.fillRect(c * (W / cols) + px, r * (H / rows) + py, ww, wh)
    }
  }
  const t = new THREE.CanvasTexture(cv)
  t.wrapS = t.wrapT = THREE.RepeatWrapping
  return t
}

const winTexCache = {}
function getWinTex(type) {
  if (!winTexCache[type]) winTexCache[type] = makeWindowTex(type)
  return winTexCache[type]
}

// ─── Buildings (one InstancedMesh per type) ──────────────────────────────────
function Buildings({ buildings }) {
  const meshRefs = useRef({})
  const { rapier, world } = useRapier()

  const grouped = useMemo(() => {
    const g = { skyscraper: [], office: [], apartment: [], house: [] }
    buildings.forEach(b => { (g[b.type] || g.office).push(b) })
    return g
  }, [buildings])

  // ── Physics: one compound rigid body for all buildings ──────────────────
  useEffect(() => {
    const rb = world.createRigidBody(rapier.RigidBodyDesc.fixed())
    buildings.forEach(b => {
      world.createCollider(
        rapier.ColliderDesc.cuboid(b.w / 2, b.h / 2, b.d / 2)
          .setTranslation(b.x, b.terrainH + b.h / 2, b.z)
          .setFriction(0.7),
        rb
      )
    })
    return () => { try { world.removeRigidBody(rb) } catch {} }
  }, [buildings, rapier, world])

  // ── Matrices: useLayoutEffect = runs before first paint ─────────────────
  useLayoutEffect(() => {
    const dummy = new THREE.Object3D()

    Object.entries(grouped).forEach(([type, arr]) => {
      const mesh = meshRefs.current[type]
      if (!mesh || !arr.length) return

      arr.forEach((b, i) => {
        dummy.position.set(b.x, b.terrainH + b.h / 2, b.z)
        dummy.rotation.set(0, b.rot || 0, 0)
        dummy.scale.set(b.w, b.h, b.d)
        dummy.updateMatrix()
        mesh.setMatrixAt(i, dummy.matrix)
      })

      mesh.instanceMatrix.needsUpdate = true
    })
  }, [grouped])

  return (
    <>
      {Object.entries(grouped).map(([type, arr]) => {
        if (!arr.length) return null
        const isGlass = type === 'skyscraper'
        return (
          <group key={type}>
            {/* Main body */}
            <instancedMesh
              ref={r => { if (r) meshRefs.current[type] = r }}
              args={[undefined, undefined, arr.length]}
              castShadow
              receiveShadow
              frustumCulled={false}
            >
              <boxGeometry args={[1, 1, 1]} />
              <meshStandardMaterial
                map={getWinTex(type)}
                color={pickColor(type, 0)}
                roughness={isGlass ? 0.25 : 0.80}
                metalness={isGlass ? 0.45 : 0.05}
                envMapIntensity={isGlass ? 0.8 : 0.2}
              />
            </instancedMesh>
            {/* Rooftop accent for skyscrapers */}
            {type === 'skyscraper' && <RooftopAccents buildings={arr} />}
          </group>
        )
      })}
    </>
  )
}

function RooftopAccents({ buildings }) {
  const ref = useRef()
  useLayoutEffect(() => {
    if (!ref.current) return
    const dummy = new THREE.Object3D()
    buildings.forEach((b, i) => {
      dummy.position.set(b.x, b.terrainH + b.h + 1.5, b.z)
      dummy.scale.set(b.w * 0.35, 3, b.d * 0.35)
      dummy.updateMatrix()
      ref.current.setMatrixAt(i, dummy.matrix)
    })
    ref.current.instanceMatrix.needsUpdate = true
  }, [buildings])

  return (
    <instancedMesh ref={ref} args={[undefined, undefined, buildings.length]} frustumCulled={false}>
      <boxGeometry args={[1, 1, 1]} />
      <meshStandardMaterial color="#1a2a3a" metalness={0.9} roughness={0.1} />
    </instancedMesh>
  )
}

// ─── Roads ──────────────────────────────────────────────────────────────────
function buildRoadGeo(roads) {
  const verts = [], normals = [], uvs = []

  roads.forEach(road => {
    const hw = road.width / 2
    let A, B, C, D, len

    if (road.type === 'ew') {
      const y = getTerrainHeight((road.x1 + road.x2) / 2, road.z) + 0.08
      A = [road.x1, y, road.z - hw]; B = [road.x2, y, road.z - hw]
      C = [road.x2, y, road.z + hw]; D = [road.x1, y, road.z + hw]
      len = (road.x2 - road.x1) / 12
      uvs.push(0, 0,  len, 0,  len, 1,  0, 0,  len, 1,  0, 1)
    } else {
      const y = getTerrainHeight(road.x, (road.z1 + road.z2) / 2) + 0.08
      A = [road.x - hw, y, road.z1]; B = [road.x + hw, y, road.z1]
      C = [road.x + hw, y, road.z2]; D = [road.x - hw, y, road.z2]
      len = (road.z2 - road.z1) / 12
      uvs.push(0, 0,  1, 0,  1, len,  0, 0,  1, len,  0, len)
    }

    verts.push(...A, ...B, ...C,  ...A, ...C, ...D)
    for (let i = 0; i < 6; i++) normals.push(0, 1, 0)
  })

  const geo = new THREE.BufferGeometry()
  geo.setAttribute('position', new THREE.Float32BufferAttribute(verts, 3))
  geo.setAttribute('normal',   new THREE.Float32BufferAttribute(normals, 3))
  geo.setAttribute('uv',       new THREE.Float32BufferAttribute(uvs, 2))
  return geo
}

function createRoadTex() {
  const cv = document.createElement('canvas')
  cv.width = 256; cv.height = 256
  const ctx = cv.getContext('2d')
  ctx.fillStyle = '#1a1a1a'
  ctx.fillRect(0, 0, 256, 256)
  // Lane markings
  ctx.strokeStyle = '#f0d010'; ctx.setLineDash([30, 22]); ctx.lineWidth = 4
  ctx.beginPath(); ctx.moveTo(128, 0); ctx.lineTo(128, 256); ctx.stroke()
  ctx.setLineDash([]); ctx.strokeStyle = '#ffffff'; ctx.lineWidth = 3
  ctx.beginPath(); ctx.moveTo(12, 0); ctx.lineTo(12, 256); ctx.stroke()
  ctx.beginPath(); ctx.moveTo(244, 0); ctx.lineTo(244, 256); ctx.stroke()
  const t = new THREE.CanvasTexture(cv)
  t.wrapS = t.wrapT = THREE.RepeatWrapping
  return t
}

function Roads({ roads }) {
  const geo  = useMemo(() => buildRoadGeo(roads), [roads])
  const tex  = useMemo(() => createRoadTex(), [])
  return (
    <mesh geometry={geo} receiveShadow>
      <meshStandardMaterial map={tex} roughness={0.88} metalness={0.01} />
    </mesh>
  )
}

// ─── Street lights ───────────────────────────────────────────────────────────
function StreetLights({ lights }) {
  const poleRef = useRef(), headRef = useRef()
  useLayoutEffect(() => {
    if (!poleRef.current || !headRef.current || !lights.length) return
    const d = new THREE.Object3D()
    lights.forEach((l, i) => {
      d.position.set(l.x, l.y - 4, l.z); d.scale.set(0.12, 7, 0.12); d.updateMatrix()
      poleRef.current.setMatrixAt(i, d.matrix)
      d.position.set(l.x, l.y, l.z); d.scale.set(0.45, 0.35, 0.45); d.updateMatrix()
      headRef.current.setMatrixAt(i, d.matrix)
    })
    poleRef.current.instanceMatrix.needsUpdate = true
    headRef.current.instanceMatrix.needsUpdate = true
  }, [lights])

  if (!lights.length) return null
  const n = lights.length
  return (
    <>
      <instancedMesh ref={poleRef} args={[undefined, undefined, n]} frustumCulled={false} castShadow>
        <cylinderGeometry args={[1, 1, 1, 5]} />
        <meshStandardMaterial color="#3a3a3a" metalness={0.8} roughness={0.3} />
      </instancedMesh>
      <instancedMesh ref={headRef} args={[undefined, undefined, n]} frustumCulled={false}>
        <boxGeometry args={[1, 1, 1]} />
        <meshStandardMaterial color="#fff" emissive="#ffe8a0" emissiveIntensity={12} roughness={0.2} />
      </instancedMesh>
    </>
  )
}

// ─── Trees ───────────────────────────────────────────────────────────────────
function Trees({ trees }) {
  const trunkRef = useRef(), foliageRef = useRef()
  useLayoutEffect(() => {
    if (!trunkRef.current || !foliageRef.current || !trees.length) return
    const d = new THREE.Object3D()
    trees.forEach((t, i) => {
      const s = t.scale
      d.position.set(t.x, t.y + s * 1.8, t.z); d.scale.set(s * 0.28, s * 3.5, s * 0.28)
      d.rotation.set(0, Math.random() * Math.PI * 2, 0); d.updateMatrix()
      trunkRef.current.setMatrixAt(i, d.matrix)

      d.position.set(t.x, t.y + s * 5.5, t.z); d.scale.set(s * 2.2, s * 4.5, s * 2.2)
      d.rotation.set(0, Math.random() * Math.PI * 2, 0); d.updateMatrix()
      foliageRef.current.setMatrixAt(i, d.matrix)
    })
    trunkRef.current.instanceMatrix.needsUpdate = true
    foliageRef.current.instanceMatrix.needsUpdate = true
  }, [trees])

  if (!trees.length) return null
  const n = trees.length
  return (
    <>
      <instancedMesh ref={trunkRef} args={[undefined, undefined, n]} frustumCulled={false} castShadow>
        <cylinderGeometry args={[1, 1.15, 1, 6]} />
        <meshStandardMaterial color="#4a2e10" roughness={0.95} />
      </instancedMesh>
      <instancedMesh ref={foliageRef} args={[undefined, undefined, n]} frustumCulled={false} castShadow>
        <dodecahedronGeometry args={[1, 0]} />
        <meshStandardMaterial color="#2a6022" roughness={0.92} flatShading />
      </instancedMesh>
    </>
  )
}

// ─── City ground (concrete plane over terrain) ───────────────────────────────
function CityGround() {
  return (
    <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 2.6, 0]} receiveShadow>
      <planeGeometry args={[1240, 1240, 1, 1]} />
      <meshStandardMaterial
        color="#2e2e2c"
        roughness={0.95}
        metalness={0.0}
        polygonOffset
        polygonOffsetFactor={-2}
        polygonOffsetUnits={-2}
      />
    </mesh>
  )
}

// ─── Export ──────────────────────────────────────────────────────────────────
export default function City({ data }) {
  const { buildings, roads, lights, trees } = data
  return (
    <>
      <CityGround />
      <Roads roads={roads} />
      <Buildings buildings={buildings} />
      <StreetLights lights={lights} />
      <Trees trees={trees} />
    </>
  )
}
