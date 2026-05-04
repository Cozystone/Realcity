import {
  EffectComposer,
  Bloom,
  SMAA,
  Vignette,
  ToneMapping,
  SSAO,
  ChromaticAberration,
  DepthOfField,
} from '@react-three/postprocessing'
import { ToneMappingMode, BlendFunction } from 'postprocessing'
import * as THREE from 'three'

export default function PostProcessing() {
  return (
    <EffectComposer multisampling={0}>
      <SMAA />
      <SSAO
        blendFunction={BlendFunction.MULTIPLY}
        samples={24}
        radius={0.12}
        intensity={1.4}
        luminanceInfluence={0.5}
        color={new THREE.Color('#000000')}
        worldDistanceThreshold={50}
        worldDistanceFalloff={4}
        worldProximityThreshold={0.4}
        worldProximityFalloff={0.1}
      />
      <Bloom
        luminanceThreshold={0.65}
        luminanceSmoothing={0.08}
        intensity={0.7}
        radius={0.5}
        mipmapBlur
      />
      <ChromaticAberration
        offset={new THREE.Vector2(0.0008, 0.0006)}
        radialModulation={false}
      />
      <Vignette offset={0.35} darkness={0.55} />
      <ToneMapping mode={ToneMappingMode.ACES_FILMIC} />
    </EffectComposer>
  )
}
