import { createNoise2D } from 'simplex-noise'

function alea(seed) {
  let s0 = 0, s1 = 0, s2 = 0
  const mash = (d) => {
    d = d.toString()
    for (let i = 0; i < d.length; i++) {
      s0 -= (s0 ^ (d.charCodeAt(i) * 1.7320508075688772))
      s1 -= (s1 ^ s0)
      s2 -= (s2 ^ s1)
    }
  }
  mash(' '); mash(seed); mash(' ')
  return () => {
    const t = 2091639 * s0 + 2.3283064365386963e-10
    s0 = s1; s1 = s2; return (s2 = t - (t | 0))
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

// City radius where terrain is forced flat
const CITY_RADIUS = 620

export function getTerrainHeight(x, z) {
  const dist = Math.sqrt(x * x + z * z)

  // Mountain noise (always computed)
  const baseNoise = fbm(x, z, { octaves: 8, scale: 0.00038, persistence: 0.52 })
  const mountainHeight = Math.max(0, baseNoise + 0.45) * 220  // 0-220m

  // City floor: always 2.5m + tiny variation
  const microNoise = fbm(x, z, { octaves: 3, scale: 0.012 }) * 0.6
  const cityFloor = 2.5 + microNoise  // 1.9 - 3.1m

  // Blend factor: 0 in city center, 1 at edge and beyond
  const t = Math.min(1, Math.max(0, (dist - CITY_RADIUS * 0.7) / (CITY_RADIUS * 0.3)))
  const smooth = t * t * (3 - 2 * t)  // smoothstep

  return cityFloor * (1 - smooth) + mountainHeight * smooth
}

export function getTerrainColor(height, x, z) {
  const dist = Math.sqrt(x * x + z * z)
  const inCity = dist < CITY_RADIUS

  // City area: concrete/asphalt
  if (inCity && height < 12) {
    const v = 0.30 + Math.sin(x * 1.3) * Math.cos(z * 1.7) * 0.015
    return [v, v * 0.99, v * 0.97]
  }

  // Natural terrain
  if (height < 0)   return [0.04, 0.15, 0.30]  // deep water
  if (height < 2.5) return [0.08, 0.24, 0.42]  // shallow water
  if (height < 4)   return [0.74, 0.66, 0.46]  // sandy shore
  if (height < 35)  return [0.27, 0.51, 0.21]  // grass
  if (height < 90)  return [0.20, 0.38, 0.14]  // forest
  if (height < 140) return [0.50, 0.46, 0.38]  // rock
  return [0.92, 0.93, 0.95]                     // snow
}
