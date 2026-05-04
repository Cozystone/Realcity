import { Canvas } from '@react-three/fiber'
import { Physics } from '@react-three/rapier'
import * as THREE from 'three'
import { Suspense } from 'react'
import Scene from './Scene'
import HUD from './components/HUD'

export default function App() {
  return (
    <div style={{ width: '100vw', height: '100vh', background: '#0a0e18', position: 'relative' }}>
      <Canvas
        shadows="soft"
        gl={{
          antialias: false,          // SMAA handles AA
          toneMapping: THREE.ACESFilmicToneMapping,
          toneMappingExposure: 0.72, // slightly darker = less washed out
          outputColorSpace: THREE.SRGBColorSpace,
          powerPreference: 'high-performance',
          logarithmicDepthBuffer: true,
          // Enable high-quality rendering
          alpha: false,
          stencil: false,
          depth: true,
          precision: 'highp',
        }}
        camera={{ fov: 68, near: 0.5, far: 5000, position: [0, 30, 40] }}
        dpr={[1, 2]}
        performance={{ min: 0.7 }}
      >
        <Suspense fallback={null}>
          <Physics
            gravity={[0, -20, 0]}
            timeStep="vary"
            maxStabilizationIterations={4}
            maxVelocityIterations={4}
          >
            <Scene />
          </Physics>
        </Suspense>
      </Canvas>
      <HUD />
    </div>
  )
}
