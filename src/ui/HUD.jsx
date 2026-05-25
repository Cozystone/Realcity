import { useEffect, useRef, useState } from 'react'
import maplibregl from 'maplibre-gl'
import 'maplibre-gl/dist/maplibre-gl.css'
import { clockLabel, useCityStore } from '../engine/cityStore'

function Minimap({ city, player }) {
  const container = useRef(null)
  const map = useRef(null)
  const viewHeading = player.viewHeading ?? player.heading

  useEffect(() => {
    if (!container.current || map.current) return

    map.current = new maplibregl.Map({
      container: container.current,
      attributionControl: false,
      interactive: false,
      center: city.worldToLngLat(player.x, player.z),
      zoom: 13.2,
      bearing: 0,
      pitch: 0,
      style: {
        version: 8,
        sources: {
          realcity: { type: 'geojson', data: city.geojson },
        },
        layers: [
          { id: 'background', type: 'background', paint: { 'background-color': '#0b1320' } },
          {
            id: 'roads',
            type: 'line',
            source: 'realcity',
            filter: ['==', ['get', 'layer'], 'road'],
            paint: { 'line-color': '#9fb0bd', 'line-width': 1.2, 'line-opacity': 0.74 },
          },
          {
            id: 'places',
            type: 'circle',
            source: 'realcity',
            filter: ['==', ['get', 'layer'], 'place'],
            paint: {
              'circle-radius': 3.3,
              'circle-stroke-width': 0.7,
              'circle-stroke-color': '#f8fbff',
              'circle-color': [
                'match',
                ['get', 'kind'],
                'hospital',
                '#e85d75',
                'park',
                '#8ac926',
                'transit',
                '#55a7ff',
                'finance',
                '#8ecae6',
                'leisure',
                '#ff7ab6',
                '#f2c14e',
              ],
            },
          },
        ],
      },
    })

    return () => {
      map.current?.remove()
      map.current = null
    }
  }, [city, player.x, player.z])

  useEffect(() => {
    if (!map.current) return
    map.current.jumpTo({
      center: city.worldToLngLat(player.x, player.z),
      bearing: (viewHeading * 180) / Math.PI,
      zoom: 13.6,
    })
  }, [city, player.x, player.z, viewHeading])

  return (
    <div className="minimap">
      <div ref={container} className="minimap-map" />
      <div className="minimap-player" />
    </div>
  )
}

function Compass({ heading }) {
  const degrees = ((heading * 180 / Math.PI) % 360 + 360) % 360
  const labels = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW']
  return (
    <div className="compass">
      {Array.from({ length: 72 }, (_, i) => {
        const tick = i * 5
        const diff = ((tick - degrees + 180 + 360) % 360) - 180
        if (Math.abs(diff) > 48) return null
        const x = 50 + (diff / 48) * 50
        const major = tick % 45 === 0
        const cardinal = tick % 90 === 0
        return (
          <div className={`compass-tick ${cardinal ? 'major' : ''}`} key={i} style={{ left: `${x}%` }}>
            {major ? labels[Math.round(tick / 45) % labels.length] : ''}
            <span />
          </div>
        )
      })}
      <div className="compass-center" />
    </div>
  )
}

function Dialogue({ dialogue }) {
  const [now, setNow] = useState(Date.now())
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 500)
    return () => window.clearInterval(id)
  }, [])

  if (!dialogue || now - dialogue.shownAt > 7800) return null

  return (
    <div className="dialogue">
      <div className="dialogue-speaker">
        <strong>{dialogue.speaker}</strong>
        <span>{dialogue.role}</span>
      </div>
      <p>{dialogue.text}</p>
    </div>
  )
}

function AgentCard({ agent, stats, pulse }) {
  if (agent) {
    return (
      <aside className="agent-card">
        <div className="eyebrow">Nearby Agent</div>
        <h2>{agent.name}</h2>
        <p>{agent.job} / {agent.age} / {agent.gender}</p>
        <p>{agent.activity} at {agent.placeName}</p>
      </aside>
    )
  }

  return (
    <aside className="agent-card">
      <div className="eyebrow">City State</div>
      <div className="metrics">
        <div><span>NPC</span><strong>{stats.npcs}</strong></div>
        <div><span>Cars</span><strong>{stats.cars}</strong></div>
        <div><span>Talks</span><strong>{stats.talks}</strong></div>
        <div><span>Tiles</span><strong>{stats.tiles}</strong></div>
      </div>
      <p>{pulse}</p>
      <small>{stats.llm}</small>
    </aside>
  )
}

export default function HUD({ city }) {
  const timeMinutes = useCityStore(state => state.timeMinutes)
  const day = useCityStore(state => state.day)
  const player = useCityStore(state => state.player)
  const weather = useCityStore(state => state.weather)
  const stats = useCityStore(state => state.stats)
  const pulse = useCityStore(state => state.pulse)
  const focusedAgent = useCityStore(state => state.focusedAgent)
  const dialogue = useCityStore(state => state.dialogue)
  const viewHeading = player.viewHeading ?? player.heading

  return (
    <div className="hud">
      <section className="time-card">
        <h1>{clockLabel(timeMinutes)}</h1>
        <p>Day {day} / {weather.label} / {weather.tempC}C</p>
        <span>{player.district}</span>
      </section>

      <Compass heading={viewHeading} />
      <AgentCard agent={focusedAgent} stats={stats} pulse={pulse} />
      <Dialogue dialogue={dialogue} />

      <div className="map-shell">
        <Minimap city={city} player={player} />
      </div>

      <div className="vitals">
        <div><span>HP</span><i style={{ width: '100%' }} /></div>
        <div><span>ST</span><i style={{ width: `${Math.max(35, 100 - player.speed * 4)}%` }} /></div>
      </div>
    </div>
  )
}
