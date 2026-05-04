import { useState, useEffect, useRef, useCallback } from 'react'
import { CITY_DATA } from '../utils/cityGenerator'

// Minimap canvas renderer
function MinimapCanvas({ playerPos, playerHeading }) {
  const canvasRef = useRef()

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    const W = canvas.width, H = canvas.height
    const SCALE = W / 1800  // city 1800m → canvas W px

    ctx.clearRect(0, 0, W, H)

    // Background
    ctx.fillStyle = '#0d1117'
    ctx.fillRect(0, 0, W, H)

    // Roads
    ctx.strokeStyle = '#2a3a4a'
    ctx.lineWidth = 1.2
    CITY_DATA.roads.forEach(road => {
      if (!road.isMain) return
      ctx.beginPath()
      if (road.type === 'ew') {
        const x1 = (road.x1 + 900) * SCALE
        const x2 = (road.x2 + 900) * SCALE
        const z = (road.z + 900) * SCALE
        ctx.moveTo(x1, z); ctx.lineTo(x2, z)
      } else {
        const x = (road.x + 900) * SCALE
        const z1 = (road.z1 + 900) * SCALE
        const z2 = (road.z2 + 900) * SCALE
        ctx.moveTo(x, z1); ctx.lineTo(x, z2)
      }
      ctx.stroke()
    })

    // Player dot
    const px = (playerPos[0] + 900) * SCALE
    const pz = (playerPos[2] + 900) * SCALE

    // Direction cone
    ctx.save()
    ctx.translate(px, pz)
    ctx.rotate(playerHeading)
    ctx.fillStyle = 'rgba(80, 160, 255, 0.25)'
    ctx.beginPath()
    ctx.moveTo(0, 0)
    ctx.arc(0, 0, 18, -0.5, 0.5)
    ctx.closePath()
    ctx.fill()
    ctx.restore()

    // Player circle
    ctx.fillStyle = '#4aadff'
    ctx.beginPath()
    ctx.arc(px, pz, 3.5, 0, Math.PI * 2)
    ctx.fill()
    ctx.strokeStyle = '#fff'
    ctx.lineWidth = 0.8
    ctx.stroke()
  })

  return (
    <canvas
      ref={canvasRef}
      width={180}
      height={180}
      style={{ width: 180, height: 180, borderRadius: '50%', display: 'block' }}
    />
  )
}

// Compass bar
function CompassBar({ heading }) {
  const dirs = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW']
  const deg = ((heading * 180 / Math.PI) % 360 + 360) % 360

  return (
    <div style={{
      position: 'absolute', top: 16, left: '50%', transform: 'translateX(-50%)',
      background: 'rgba(0,0,0,0.45)', borderRadius: 20,
      padding: '5px 18px', display: 'flex', alignItems: 'center', gap: 0,
      backdropFilter: 'blur(10px)', border: '1px solid rgba(255,255,255,0.08)',
      overflow: 'hidden', width: 320,
    }}>
      {/* Sliding degree markers */}
      {Array.from({ length: 72 }, (_, i) => {
        const tickDeg = i * 5
        const diff = ((tickDeg - deg + 180 + 360) % 360) - 180
        if (Math.abs(diff) > 45) return null
        const x = 50 + (diff / 45) * 50  // %
        const isCardinal = tickDeg % 90 === 0
        const is45 = tickDeg % 45 === 0
        const label = isCardinal ? dirs[Math.round(tickDeg / 45)] : is45 ? dirs[Math.round(tickDeg / 45)] : null
        return (
          <div key={i} style={{
            position: 'absolute', left: `${x}%`, transform: 'translateX(-50%)',
            textAlign: 'center', color: isCardinal ? '#fff' : 'rgba(255,255,255,0.4)',
            fontSize: isCardinal ? 11 : 9,
            fontWeight: isCardinal ? '700' : '400',
            letterSpacing: 1,
          }}>
            {label && <div>{label}</div>}
            <div style={{
              width: 1, height: isCardinal ? 8 : 4,
              background: isCardinal ? '#4aadff' : 'rgba(255,255,255,0.3)',
              margin: '0 auto',
            }} />
          </div>
        )
      })}
      {/* Center indicator */}
      <div style={{
        position: 'absolute', left: '50%', top: 0, bottom: 0,
        width: 2, background: '#4aadff', transform: 'translateX(-50%)',
        zIndex: 2,
      }} />
      <div style={{ height: 28 }} />
    </div>
  )
}

// Status bars (Health / Stamina)
function StatusBars() {
  return (
    <div style={{
      position: 'absolute', left: 20, bottom: 120,
      display: 'flex', flexDirection: 'column', gap: 6,
    }}>
      {[{ label: '❤', color: '#e05050', val: 100 }, { label: '⚡', color: '#50c040', val: 100 }].map(b => (
        <div key={b.label} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ fontSize: 12, width: 14 }}>{b.label}</span>
          <div style={{
            width: 100, height: 6, background: 'rgba(0,0,0,0.5)',
            borderRadius: 3, overflow: 'hidden',
            border: '1px solid rgba(255,255,255,0.1)',
          }}>
            <div style={{
              width: `${b.val}%`, height: '100%',
              background: b.color, borderRadius: 3,
            }} />
          </div>
          <span style={{ fontSize: 10, color: 'rgba(255,255,255,0.5)', width: 38 }}>
            {b.val}/100
          </span>
        </div>
      ))}
    </div>
  )
}

// Control hints bar
function ControlHints() {
  const hints = [
    { keys: 'W A S D', label: 'Move' },
    { keys: '↑ ↓', label: 'Look' },
    { keys: 'SPACE', label: 'Jump' },
    { keys: 'SHIFT', label: 'Run' },
    { keys: 'E', label: 'Talk' },
  ]
  return (
    <div style={{
      position: 'absolute', bottom: 24, left: '50%', transform: 'translateX(-50%)',
      background: 'rgba(0,0,0,0.5)',
      borderRadius: 12, padding: '8px 20px',
      display: 'flex', gap: 20, alignItems: 'center',
      backdropFilter: 'blur(10px)',
      border: '1px solid rgba(255,255,255,0.07)',
    }}>
      {hints.map(h => (
        <div key={h.label} style={{ textAlign: 'center' }}>
          <span style={{
            background: 'rgba(255,255,255,0.12)', borderRadius: 5,
            padding: '2px 7px', fontSize: 11, color: '#ddeeff',
            letterSpacing: 0.5, fontFamily: 'monospace',
          }}>
            {h.keys}
          </span>
          <div style={{ fontSize: 10, color: 'rgba(255,255,255,0.4)', marginTop: 2 }}>
            {h.label}
          </div>
        </div>
      ))}
    </div>
  )
}

// Top-right function keys
function FunctionKeys() {
  return (
    <div style={{
      position: 'absolute', top: 20, right: 20,
      display: 'flex', flexDirection: 'column', gap: 4,
      alignItems: 'flex-end',
    }}>
      {[['F1', 'Help'], ['M', 'Map'], ['I', 'Inventory'], ['Esc', 'Menu']].map(([k, l]) => (
        <div key={k} style={{
          display: 'flex', alignItems: 'center', gap: 8,
          color: 'rgba(255,255,255,0.55)', fontSize: 11,
        }}>
          <span style={{
            background: 'rgba(255,255,255,0.1)',
            borderRadius: 4, padding: '2px 6px',
            fontSize: 10, fontFamily: 'monospace',
          }}>{k}</span>
          {l}
        </div>
      ))}
    </div>
  )
}

// Crosshair
function Crosshair() {
  return (
    <div style={{
      position: 'absolute', top: '50%', left: '50%',
      transform: 'translate(-50%,-50%)', pointerEvents: 'none',
    }}>
      <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
        <circle cx="10" cy="10" r="8" stroke="rgba(255,255,255,0.5)" strokeWidth="1" />
        <line x1="10" y1="3" x2="10" y2="6.5" stroke="rgba(255,255,255,0.9)" strokeWidth="1.2" />
        <line x1="10" y1="13.5" x2="10" y2="17" stroke="rgba(255,255,255,0.9)" strokeWidth="1.2" />
        <line x1="3" y1="10" x2="6.5" y2="10" stroke="rgba(255,255,255,0.9)" strokeWidth="1.2" />
        <line x1="13.5" y1="10" x2="17" y2="10" stroke="rgba(255,255,255,0.9)" strokeWidth="1.2" />
        <circle cx="10" cy="10" r="1" fill="rgba(255,255,255,0.7)" />
      </svg>
    </div>
  )
}

// NPC Dialogue bubble
function NPCBubble({ msg }) {
  if (!msg) return null
  return (
    <div style={{
      position: 'absolute', top: 80, left: '50%',
      transform: 'translateX(-50%)',
      background: 'rgba(5, 12, 24, 0.85)',
      borderRadius: 14, padding: '14px 24px',
      maxWidth: 480, fontSize: 14, lineHeight: 1.7,
      backdropFilter: 'blur(14px)',
      border: '1px solid rgba(74, 173, 255, 0.3)',
      boxShadow: '0 4px 40px rgba(74,173,255,0.15)',
      textAlign: 'center', color: '#e8f4ff',
      animation: 'fadeIn 0.3s ease',
    }}>
      <div style={{
        color: '#4aadff', fontSize: 10, letterSpacing: 3,
        marginBottom: 8, textTransform: 'uppercase',
      }}>
        [ {msg.role} ]
      </div>
      <div>"{msg.text}"</div>
    </div>
  )
}

// Minimap container
function Minimap({ playerPos, playerHeading }) {
  return (
    <div style={{
      position: 'absolute', bottom: 90, left: 20,
      width: 180, height: 180,
      borderRadius: '50%',
      overflow: 'hidden',
      border: '2px solid rgba(255,255,255,0.15)',
      boxShadow: '0 2px 20px rgba(0,0,0,0.6)',
      background: '#0d1117',
    }}>
      <MinimapCanvas playerPos={playerPos} playerHeading={playerHeading} />
      {/* Cardinal labels */}
      {[
        { label: 'N', style: { top: 4, left: '50%', transform: 'translateX(-50%)' } },
        { label: 'S', style: { bottom: 4, left: '50%', transform: 'translateX(-50%)' } },
        { label: 'W', style: { left: 4, top: '50%', transform: 'translateY(-50%)' } },
        { label: 'E', style: { right: 4, top: '50%', transform: 'translateY(-50%)' } },
      ].map(({ label, style }) => (
        <div key={label} style={{
          position: 'absolute', ...style,
          fontSize: 9, color: 'rgba(255,255,255,0.5)',
          fontWeight: '600', letterSpacing: 1,
          pointerEvents: 'none',
        }}>{label}</div>
      ))}
    </div>
  )
}

export default function HUD() {
  const [npcMsg, setNpcMsg] = useState(null)
  const [playerPos, setPlayerPos] = useState([0, 0, 0])
  const [heading, setHeading] = useState(0)
  const [gameTime, setGameTime] = useState({ h: 12, m: 45 })
  const [weather] = useState({ temp: 22, icon: '☁', desc: 'Partly Cloudy' })

  useEffect(() => {
    window.__showNPCMessage = (msg) => {
      setNpcMsg(msg)
      setTimeout(() => setNpcMsg(null), 7000)
    }
    window.__updateHUD = (pos, head) => {
      setPlayerPos([pos.x, pos.y, pos.z])
      setHeading(head)
    }
    window.__updateGameTime = (h, m) => setGameTime({ h, m })
    return () => {
      delete window.__showNPCMessage
      delete window.__updateHUD
      delete window.__updateGameTime
    }
  }, [])

  const timeStr = `${String(gameTime.h).padStart(2, '0')}:${String(gameTime.m).padStart(2, '0')}`
  const ampm = gameTime.h >= 12 ? 'PM' : 'AM'
  const h12 = gameTime.h % 12 || 12

  return (
    <div style={{
      position: 'fixed', inset: 0, pointerEvents: 'none', zIndex: 100,
      fontFamily: "'Segoe UI', system-ui, sans-serif", color: '#eef4ff',
    }}>
      <style>{`
        @keyframes fadeIn { from { opacity:0; transform: translateX(-50%) translateY(-8px); } to { opacity:1; transform: translateX(-50%) translateY(0); } }
      `}</style>

      {/* Top-left: Time + Weather + Location */}
      <div style={{
        position: 'absolute', top: 20, left: 20,
        background: 'rgba(0,0,0,0.45)', borderRadius: 12,
        padding: '10px 16px', backdropFilter: 'blur(10px)',
        border: '1px solid rgba(255,255,255,0.08)',
      }}>
        <div style={{ fontSize: 22, fontWeight: '300', letterSpacing: 1, lineHeight: 1 }}>
          {`${h12}:${String(gameTime.m).padStart(2, '0')} ${ampm}`}
        </div>
        <div style={{ fontSize: 12, color: 'rgba(255,255,255,0.55)', marginTop: 4 }}>
          {weather.icon} {weather.temp}°C
        </div>
        <div style={{ fontSize: 10, color: 'rgba(255,255,255,0.35)', marginTop: 2, letterSpacing: 0.5 }}>
          RealCity District, KR
        </div>
      </div>

      {/* Compass bar */}
      <CompassBar heading={heading} />

      {/* Top-right: Function keys */}
      <FunctionKeys />

      {/* Crosshair */}
      <Crosshair />

      {/* NPC dialogue */}
      <NPCBubble msg={npcMsg} />

      {/* Status bars */}
      <StatusBars />

      {/* Minimap */}
      <Minimap playerPos={playerPos} playerHeading={heading} />

      {/* Control hints bar */}
      <ControlHints />
    </div>
  )
}
