import { useMemo, useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import { RigidBody } from '@react-three/rapier'
import * as THREE from 'three'
import { getTerrainHeight, getTerrainColor } from '../utils/noise'

const RESOLUTION = 256   // segments (257 vertices per side)
const WORLD_SIZE = 2048

export default function Terrain() {
  const { geometry, heights, heightMap } = useMemo(() => {
    const geo = new THREE.PlaneGeometry(WORLD_SIZE, WORLD_SIZE, RESOLUTION, RESOLUTION)
    geo.rotateX(-Math.PI / 2)

    const positions = geo.attributes.position
    const count = positions.count
    const colors = new Float32Array(count * 3)
    const heights = new Float32Array(count)

    for (let i = 0; i < count; i++) {
      const x = positions.getX(i)
      const z = positions.getZ(i)
      const h = getTerrainHeight(x, z)
      positions.setY(i, h)
      heights[i] = h

      // Compute approx slope from neighbors
      const hE = getTerrainHeight(x + 8, z)
      const hN = getTerrainHeight(x, z + 8)
      const slope = Math.abs(hE - h) / 8 + Math.abs(hN - h) / 8

      const [r, g, b] = getTerrainColor(h, slope)
      colors[i * 3] = r; colors[i * 3 + 1] = g; colors[i * 3 + 2] = b
    }

    geo.setAttribute('color', new THREE.BufferAttribute(colors, 3))
    geo.computeVertexNormals()
    positions.needsUpdate = true

    // For physics heightfield: 257x257 grid
    const N = RESOLUTION + 1
    const heightMap = new Float32Array(N * N)
    for (let row = 0; row < N; row++) {
      for (let col = 0; col < N; col++) {
        heightMap[row * N + col] = heights[row * N + col]
      }
    }

    return { geometry: geo, heights, heightMap }
  }, [])

  const waterRef = useRef()
  useFrame(({ clock }) => {
    if (waterRef.current) {
      waterRef.current.material.uniforms.time.value = clock.getElapsedTime()
    }
  })

  return (
    <>
      {/* Terrain mesh */}
      <RigidBody type="fixed" colliders="trimesh" friction={0.8} restitution={0.0}>
        <mesh geometry={geometry} receiveShadow>
          <meshStandardMaterial
            vertexColors
            roughness={0.92}
            metalness={0.02}
            envMapIntensity={0.3}
          />
        </mesh>
      </RigidBody>

      {/* Water plane */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.3, 0]}>
        <planeGeometry args={[WORLD_SIZE, WORLD_SIZE]} />
        <meshStandardMaterial
          color="#1a4a72"
          roughness={0.05}
          metalness={0.1}
          transparent
          opacity={0.88}
          envMapIntensity={2.0}
        />
      </mesh>
    </>
  )
}
