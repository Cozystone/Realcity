import { createNoise2D } from 'simplex-noise'

function alea(seed) {
  let s0 = 0, s1 = 0, s2 = 0, c = 1
  const mash = (data) => {
    data = data.toString()
    for (let i = 0; i < data.length; i++) {
      s0 -= (s0 ^ (data.charCodeAt(i) * 1.7320508075688772))
      s1 -= (s1 ^ s0)
      s2 -= (s2 ^ s1)
    }
  }
  mash(' ')
  mash(seed)
  mash(' ')
  return () => {
    const t = 2091639 * s0 + c * 2.3283064365386963e-10
    s0 = s1; s1 = s2
    return (s2 = t - (c = t | 0))
  }
}

const noise2D = createNoise2D(alea('realcity-42'))

export function fbm(x, y, { octaves = 7, persistence = 0.52, lacunarity = 2.1, scale = 1.0 } = {}) {
  let value = 0, amplitude = 1, frequency = scale, maxValue = 0
  for (let i = 0; i < octaves; i++) {
    value += noise2D(x * frequency, y * frequency) * amplitude
    maxValue += amplitude
    amplitude *= persistence
    frequency *= lacunarity
  }
  return value / maxValue
}

export function getTerrainHeight(x, z) {
  const distFromCenter = Math.sqrt(x * x + z * z)
  const cityRadius = 700

  // Smooth bowl: flat in city, mountains outside
  const bowl = Math.max(0, distFromCenter / cityRadius - 0.5) * 2
  const bowlFactor = Math.pow(Math.min(bowl, 1), 2.5)

  const baseNoise = fbm(x, z, { octaves: 8, scale: 0.00035, persistence: 0.52 })
  const detailNoise = fbm(x + 1000, z + 1000, { octaves: 4, scale: 0.002, persistence: 0.45 })

  const mountainHeight = (baseNoise * 0.7 + detailNoise * 0.3) * 280
  const cityFloorNoise = fbm(x, z, { octaves: 3, scale: 0.003 }) * 1.5

  return mountainHeight * bowlFactor + cityFloorNoise * (1 - bowlFactor * 0.8)
}

export function getTerrainColor(height, slope = 0) {
  if (height < -4) return [0.05, 0.18, 0.32]  // Deep water
  if (height < 0)  return [0.08, 0.26, 0.44]  // Shallow water
  if (height < 1.5) return [0.76, 0.68, 0.48] // Sandy shore
  if (slope > 0.7)  return [0.52, 0.46, 0.38] // Rocky slope
  if (height < 35)  return [0.28, 0.52, 0.22] // Grass
  if (height < 90)  return [0.22, 0.42, 0.16] // Forest green
  if (height < 140) return [0.52, 0.48, 0.42] // Rock
  return [0.92, 0.94, 0.96]                   // Snow
}
