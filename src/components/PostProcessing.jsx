import {
  EffectComposer,
  Bloom,
  SMAA,
  Vignette,
  ToneMapping,
  SSAO,
  ChromaticAberration,
  DepthOfField,
  HueSaturation,
  BrightnessContrast,
} from '@react-three/postprocessing'
import { ToneMappingMode, BlendFunction } from 'postprocessing'
import * as THREE from 'three'

// RTX 5080 can handle all of this at full quality
export default function PostProcessing() {
  return (
    <EffectComposer multisampling={0} enableNormalPass>
      {/* Anti-aliasing */}
      <SMAA />

      {/* Ambient Occlusion — contact shadows, crevices */}
      <SSAO
        blendFunction={BlendFunction.MULTIPLY}
        samples={32}
        rings={4}
        radius={0.16}
        intensity={1.8}
        luminanceInfluence={0.4}
        color={new THREE.Color('#000000')}
        worldDistanceThreshold={80}
        worldDistanceFalloff={6}
        worldProximityThreshold={0.5}
        worldProximityFalloff={0.15}
        bias={0.025}
      />

      {/* HDR Bloom — emissive lights, sun glare */}
      <Bloom
        luminanceThreshold={0.82}
        luminanceSmoothing={0.06}
        intensity={0.45}
        radius={0.65}
        mipmapBlur
        levels={7}
      />

      {/* Depth of Field — subtle cinematic focus */}
      <DepthOfField
        focusDistance={0.01}
        focalLength={0.04}
        bokehScale={2.0}
        height={480}
      />

      {/* Chromatic aberration — lens realism */}
      <ChromaticAberration
        offset={new THREE.Vector2(0.0006, 0.0005)}
        radialModulation
        modulationOffset={0.15}
      />

      {/* Color grading — cinematic warm/cool balance */}
      <HueSaturation saturation={0.12} hue={0} />
      <BrightnessContrast brightness={-0.02} contrast={0.08} />

      {/* Vignette */}
      <Vignette offset={0.3} darkness={0.5} />

      {/* ACES Filmic tone mapping */}
      <ToneMapping mode={ToneMappingMode.ACES_FILMIC} />
    </EffectComposer>
  )
}
