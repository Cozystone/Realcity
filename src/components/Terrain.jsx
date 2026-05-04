import { useMemo } from 'react'
import { RigidBody } from '@react-three/rapier'
import * as THREE from 'three'
import { getTerrainHeight, getTerrainColor } from '../utils/noise'

const RESOLUTION = 256   // 257 vertices per side
const WORLD_SIZE = 2048

export default function Terrain() {
  const { geometry } = useMemo(() => {
    const geo = new THREE.PlaneGeometry(WORLD_SIZE, WORLD_SIZE, RESOLUTION, RESOLUTION)
    geo.rotateX(-Math.PI / 2)

    const positions = geo.attributes.position
    const count = positions.count
    const colors = new Float32Array(count * 3)

    for (let i = 0; i < count; i++) {
      const x = positions.getX(i)
      const z = positions.getZ(i)
      const h = getTerrainHeight(x, z)
      positions.setY(i, h)

      const [r, g, b] = getTerrainColor(h, x, z)
      colors[i * 3] = r
      colors[i * 3 + 1] = g
      colors[i * 3 + 2] = b
    }

    geo.setAttribute('color', new THREE.BufferAttribute(colors, 3))
    geo.computeVertexNormals()
    positions.needsUpdate = true

    return { geometry: geo }
  }, [])

  return (
    <>
      {/* Terrain — trimesh collider so player walks on it */}
      <RigidBody type="fixed" colliders="trimesh" friction={0.85} restitution={0}>
        <mesh geometry={geometry} receiveShadow>
          <meshStandardMaterial
            vertexColors
            roughness={0.92}
            metalness={0.01}
            envMapIntensity={0.2}
          />
        </mesh>
      </RigidBody>

      {/* Water plane below city floor */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.5, 0]}>
        <planeGeometry args={[WORLD_SIZE, WORLD_SIZE]} />
        <meshStandardMaterial
          color="#1a3a5a"
          roughness={0.05}
          metalness={0.15}
          transparent
          opacity={0.9}
        />
      </mesh>
    </>
  )
}
