import { useEffect, useRef, useState } from 'react'
import maplibregl from 'maplibre-gl'
import 'maplibre-gl/dist/maplibre-gl.css'
import { CITY_HALF, CITY_WORLD_SIZE } from '../engine/cityEngine'
import { clockLabel, useCityStore } from '../engine/cityStore'
import VirtualPhone from './VirtualPhone'

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

function InteractionPanel({ interaction }) {
  const [text, setText] = useState('')

  useEffect(() => {
    setText('')
  }, [interaction?.agent?.id])

  if (!interaction?.agent) return null

  const disabled = interaction.status === 'thinking'
  const submit = (event) => {
    event.preventDefault()
    const request = text.trim()
    if (!request || disabled) return
    useCityStore.getState().setInteraction({ status: 'thinking', request })
    window.dispatchEvent(new CustomEvent('realcity:npc-request', {
      detail: { agentId: interaction.agent.id, text: request },
    }))
  }

  return (
    <form className="interaction-panel" onSubmit={submit} onKeyDown={event => event.stopPropagation()}>
      <div>
        <strong>{interaction.agent.name}</strong>
        <span>{interaction.status === 'thinking' ? 'Thinking' : interaction.status === 'active' ? 'Acting' : 'Ready'}</span>
      </div>
      <textarea
        value={text}
        disabled={disabled}
        onChange={event => setText(event.target.value)}
        placeholder="예: 나를 당신이 일하는 데까지 데려다줘요. 급하면 택시를 잡아도 돼요."
        rows={3}
      />
      <div className="interaction-actions">
        <button type="submit" disabled={disabled || !text.trim()}>{disabled ? 'Thinking...' : 'Send'}</button>
        <button type="button" onClick={() => useCityStore.getState().closeInteraction()}>Close</button>
      </div>
    </form>
  )
}

function MissionPanel({ mission, ride }) {
  if (!mission) return null
  const phase = ride ? `Taxi ${(Math.min(1, (performance.now() - ride.startedAt) / (ride.duration * 1000)) * 100).toFixed(0)}%` : mission.phase

  return (
    <aside className="mission-panel">
      <div className="eyebrow">Active Plan</div>
      <h2>{mission.agentName}</h2>
      <p>{mission.mode === 'taxi' ? 'Taxi escort' : 'Walking escort'} to {mission.destination?.name}</p>
      <small>{phase}</small>
      <ol>
        {(mission.steps || []).slice(0, 4).map(step => <li key={step}>{step}</li>)}
      </ol>
    </aside>
  )
}

function placeColor(kind) {
  return {
    hospital: '#e85d75',
    park: '#8ac926',
    transit: '#55a7ff',
    finance: '#8ecae6',
    leisure: '#ff7ab6',
    cafe: '#d98b5f',
    retail: '#f4a261',
    school: '#78c6a3',
    workshop: '#9b7ede',
    logistics: '#adb5bd',
  }[kind] || '#f2c14e'
}

function FullCityMap({ city, player, onClose }) {
  const heading = ((player.viewHeading ?? player.heading) * 180) / Math.PI

  return (
    <div className="full-map-overlay" onClick={onClose}>
      <section className="full-map-panel" onClick={event => event.stopPropagation()}>
        <div className="full-map-header">
          <div>
            <h2>RealCity Map</h2>
            <p>{player.district}</p>
          </div>
          <button type="button" onClick={onClose}>Close</button>
        </div>
        <svg
          className="full-city-map"
          viewBox={`${-CITY_HALF} ${-CITY_HALF} ${CITY_WORLD_SIZE} ${CITY_WORLD_SIZE}`}
          role="img"
          aria-label="Full city map with player position"
        >
          <rect x={-CITY_HALF} y={-CITY_HALF} width={CITY_WORLD_SIZE} height={CITY_WORLD_SIZE} />
          <g className="full-map-grid">
            {Array.from({ length: 13 }, (_, i) => {
              const p = -900 + i * 150
              return (
                <g key={p}>
                  <line x1={p} y1={-CITY_HALF} x2={p} y2={CITY_HALF} />
                  <line x1={-CITY_HALF} y1={p} x2={CITY_HALF} y2={p} />
                </g>
              )
            })}
          </g>
          <g className="full-map-roads">
            {city.roads.map(road => (
              <line
                key={road.id}
                className={road.main ? 'main' : 'local'}
                x1={road.axis === 'x' ? road.from : road.x}
                y1={road.axis === 'x' ? road.z : road.from}
                x2={road.axis === 'x' ? road.to : road.x}
                y2={road.axis === 'x' ? road.z : road.to}
                strokeWidth={road.width}
              />
            ))}
          </g>
          <g className="full-map-landmarks">
            {city.landmarks.map(place => (
              <g key={place.id} transform={`translate(${place.x} ${place.z})`}>
                <circle r={place.kind === 'park' ? 25 : 17} fill={placeColor(place.kind)} />
                <text x="24" y="7">{place.name}</text>
              </g>
            ))}
          </g>
          <g className="full-map-player" transform={`translate(${player.x} ${player.z}) rotate(${heading})`}>
            <circle r="22" />
            <path d="M 0 -38 L 16 18 L 0 8 L -16 18 Z" />
          </g>
        </svg>
      </section>
    </div>
  )
}

export default function HUD({ city }) {
  const [mapOpen, setMapOpen] = useState(false)
  const timeMinutes = useCityStore(state => state.timeMinutes)
  const day = useCityStore(state => state.day)
  const player = useCityStore(state => state.player)
  const weather = useCityStore(state => state.weather)
  const stats = useCityStore(state => state.stats)
  const pulse = useCityStore(state => state.pulse)
  const focusedAgent = useCityStore(state => state.focusedAgent)
  const dialogue = useCityStore(state => state.dialogue)
  const interaction = useCityStore(state => state.interaction)
  const mission = useCityStore(state => state.mission)
  const ride = useCityStore(state => state.ride)
  const viewHeading = player.viewHeading ?? player.heading

  return (
    <div className="hud">
      <section className="time-card">
        <h1>{clockLabel(timeMinutes)}</h1>
        <p>Day {day} / {weather.label} / {weather.tempC}C</p>
        <span>{player.indoors ? `${player.placeName} interior` : player.district}</span>
      </section>

      <Compass heading={viewHeading} />
      <AgentCard agent={focusedAgent} stats={stats} pulse={pulse} />
      <Dialogue dialogue={dialogue} />
      <InteractionPanel interaction={interaction} />
      <MissionPanel mission={mission} ride={ride} />

      <button type="button" className="map-shell" onClick={() => setMapOpen(true)} aria-label="Open full city map">
        <Minimap city={city} player={player} />
      </button>
      {mapOpen ? <FullCityMap city={city} player={player} onClose={() => setMapOpen(false)} /> : null}
      <VirtualPhone city={city} player={player} focusedAgent={focusedAgent} timeMinutes={timeMinutes} />

      <div className="vitals">
        <div><span>HP</span><i style={{ width: '100%' }} /></div>
        <div><span>ST</span><i style={{ width: `${Math.max(35, 100 - player.speed * 4)}%` }} /></div>
      </div>
    </div>
  )
}
