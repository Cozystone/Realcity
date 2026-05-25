import { Bloom, BrightnessContrast, EffectComposer, HueSaturation, SMAA, ToneMapping, Vignette } from '@react-three/postprocessing'
import { ToneMappingMode } from 'postprocessing'

export default function PostFX() {
  return (
    <EffectComposer multisampling={0} enableNormalPass={false}>
      <SMAA />
      <Bloom luminanceThreshold={0.92} luminanceSmoothing={0.08} intensity={0.1} radius={0.34} mipmapBlur levels={3} />
      <HueSaturation saturation={0.04} hue={0} />
      <BrightnessContrast brightness={0} contrast={0.01} />
      <Vignette offset={0.44} darkness={0.12} />
      <ToneMapping mode={ToneMappingMode.ACES_FILMIC} />
    </EffectComposer>
  )
}
