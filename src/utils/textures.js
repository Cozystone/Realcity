import * as THREE from 'three'

function createWindowTexture(type = 'office') {
  const W = 512, H = 1024
  const canvas = document.createElement('canvas')
  canvas.width = W; canvas.height = H
  const ctx = canvas.getContext('2d')

  const wallColors = {
    skyscraper: '#3a4a5a',
    office:     '#6a7a8a',
    apartment:  '#9a8070',
    house:      '#c4b090',
  }

  ctx.fillStyle = wallColors[type] || '#888'
  ctx.fillRect(0, 0, W, H)

  const cfg = {
    skyscraper: { cols: 10, rows: 32, litDay: 0.12, litNight: 0.72, winColor: '#90c0e0' },
    office:     { cols: 7,  rows: 24, litDay: 0.15, litNight: 0.65, winColor: '#a0c8d8' },
    apartment:  { cols: 5,  rows: 18, litDay: 0.10, litNight: 0.55, winColor: '#f0d080' },
    house:      { cols: 2,  rows: 4,  litDay: 0.05, litNight: 0.50, winColor: '#f8e090' },
  }[type] || { cols: 6, rows: 20, litDay: 0.12, litNight: 0.60, winColor: '#b0d0e0' }

  const cw = W / cfg.cols
  const rh = H / cfg.rows
  const winW = cw * 0.6
  const winH = rh * 0.55
  const padX = (cw - winW) / 2
  const padY = (rh - winH) / 2

  for (let row = 0; row < cfg.rows; row++) {
    for (let col = 0; col < cfg.cols; col++) {
      const x = col * cw + padX
      const y = row * rh + padY
      // Day texture (used during day)
      ctx.fillStyle = '#0a1520'
      ctx.fillRect(x, y, winW, winH)
    }
  }

  const dayTex = new THREE.CanvasTexture(canvas)
  dayTex.wrapS = dayTex.wrapT = THREE.RepeatWrapping

  // Night version
  ctx.fillStyle = wallColors[type] || '#888'
  ctx.fillRect(0, 0, W, H)

  for (let row = 0; row < cfg.rows; row++) {
    for (let col = 0; col < cfg.cols; col++) {
      const x = col * cw + padX
      const y = row * rh + padY
      const lit = Math.random() < cfg.litNight
      if (lit) {
        const warm = Math.random()
        const r = Math.floor(210 + warm * 45)
        const g = Math.floor(185 + warm * 40)
        const b = Math.floor(100 + warm * 80)
        ctx.fillStyle = `rgb(${r},${g},${b})`
      } else {
        ctx.fillStyle = '#050e18'
      }
      ctx.fillRect(x, y, winW, winH)
    }
  }

  const nightTex = new THREE.CanvasTexture(canvas)
  nightTex.wrapS = nightTex.wrapT = THREE.RepeatWrapping

  return { dayTex, nightTex }
}

// Cache textures per type
const cache = new Map()

export function getBuildingTextures(type) {
  if (!cache.has(type)) {
    cache.set(type, createWindowTexture(type))
  }
  return cache.get(type)
}

export function createRoadTexture() {
  const canvas = document.createElement('canvas')
  canvas.width = 512; canvas.height = 512
  const ctx = canvas.getContext('2d')

  ctx.fillStyle = '#1c1c1c'
  ctx.fillRect(0, 0, 512, 512)

  // Center line dashes
  ctx.strokeStyle = '#f0d000'
  ctx.setLineDash([40, 30])
  ctx.lineWidth = 4
  ctx.beginPath()
  ctx.moveTo(256, 0); ctx.lineTo(256, 512)
  ctx.stroke()

  // Edge lines
  ctx.setLineDash([])
  ctx.strokeStyle = '#ffffff'
  ctx.lineWidth = 3
  ctx.beginPath()
  ctx.moveTo(30, 0); ctx.lineTo(30, 512)
  ctx.moveTo(482, 0); ctx.lineTo(482, 512)
  ctx.stroke()

  // Surface detail
  ctx.fillStyle = 'rgba(255,255,255,0.015)'
  for (let i = 0; i < 120; i++) {
    const x = Math.random() * 512, y = Math.random() * 512
    ctx.fillRect(x, y, Math.random() * 60, Math.random() * 3)
  }

  const tex = new THREE.CanvasTexture(canvas)
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping
  return tex
}

export function createSidewalkTexture() {
  const canvas = document.createElement('canvas')
  canvas.width = 256; canvas.height = 256
  const ctx = canvas.getContext('2d')

  ctx.fillStyle = '#b0a898'
  ctx.fillRect(0, 0, 256, 256)

  // Tile pattern
  ctx.strokeStyle = '#908878'
  ctx.lineWidth = 1.5
  const tileSize = 32
  for (let x = 0; x <= 256; x += tileSize) {
    ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, 256); ctx.stroke()
  }
  for (let y = 0; y <= 256; y += tileSize) {
    ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(256, y); ctx.stroke()
  }

  const tex = new THREE.CanvasTexture(canvas)
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping
  return tex
}
