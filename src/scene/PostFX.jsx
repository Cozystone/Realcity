import { Bloom, BrightnessContrast, EffectComposer, HueSaturation, SMAA, ToneMapping, Vignette } from '@react-three/postprocessing'
import { ToneMappingMode } from 'postprocessing'

export default function PostFX() {
  return (
    <EffectComposer multisampling={0} enableNormalPass>
      <SMAA />
      <Bloom luminanceThreshold={0.9} luminanceSmoothing={0.1} intensity={0.18} radius={0.48} mipmapBlur levels={6} />
      <HueSaturation saturation={0.04} hue={0} />
      <BrightnessContrast brightness={0} contrast={0.01} />
      <Vignette offset={0.44} darkness={0.12} />
      <ToneMapping mode={ToneMappingMode.ACES_FILMIC} />
    </EffectComposer>
  )
}
