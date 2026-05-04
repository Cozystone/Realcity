import { Canvas } from '@react-three/fiber'
import { Physics } from '@react-three/rapier'
import * as THREE from 'three'
import { Suspense } from 'react'
import Scene from './Scene'
import HUD from './components/HUD'

export default function App() {
  return (
    <div style={{ width: '100vw', height: '100vh', background: '#0a0a1a', position: 'relative' }}>
      <Canvas
        shadows="soft"
        gl={{
          antialias: true,
          toneMapping: THREE.ACESFilmicToneMapping,
          toneMappingExposure: 0.85,
          outputColorSpace: THREE.SRGBColorSpace,
          powerPreference: 'high-performance',
          logarithmicDepthBuffer: true,
        }}
        camera={{ fov: 72, near: 0.5, far: 6000, position: [0, 80, 80] }}
        dpr={[1, 2]}
        performance={{ min: 0.5 }}
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
