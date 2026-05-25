import { Bloom, BrightnessContrast, EffectComposer, HueSaturation, SMAA, SSAO, ToneMapping, Vignette } from '@react-three/postprocessing'
import { BlendFunction, ToneMappingMode } from 'postprocessing'

export default function PostFX() {
  return (
    <EffectComposer multisampling={0} enableNormalPass>
      <SMAA />
      <SSAO
        blendFunction={BlendFunction.MULTIPLY}
        samples={28}
        rings={4}
        radius={0.18}
        intensity={1.45}
        luminanceInfluence={0.45}
        worldDistanceThreshold={95}
        worldDistanceFalloff={8}
        bias={0.025}
      />
      <Bloom luminanceThreshold={0.82} luminanceSmoothing={0.08} intensity={0.48} radius={0.68} mipmapBlur levels={7} />
      <HueSaturation saturation={0.1} hue={0} />
      <BrightnessContrast brightness={-0.015} contrast={0.07} />
      <Vignette offset={0.32} darkness={0.42} />
      <ToneMapping mode={ToneMappingMode.ACES_FILMIC} />
    </EffectComposer>
  )
}
