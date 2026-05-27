import { useEffect, useRef, useState } from 'react'
import maplibregl from 'maplibre-gl'
import 'maplibre-gl/dist/maplibre-gl.css'
import { CITY_HALF, CITY_WORLD_SIZE } from '../engine/cityEngine'
import { clockLabel, useCityStore } from '../engine/cityStore'
import VirtualPhone from './VirtualPhone'

function activeTaxiRoute(mission, ride) {
  if (mission?.phase === 'taxi_dispatch' && mission?.taxi?.path?.length >= 2) return mission.taxi.path
  if (ride?.path?.length >= 2) return ride.path
  if (mission?.phase === 'taxi_waiting' && mission?.taxi?.destinationPath?.length >= 2) return mission.taxi.destinationPath
  if (mission?.route?.length >= 2) return mission.route
  if (mission?.taxi?.destinationPath?.length >= 2) return mission.taxi.destinationPath
  if (mission?.taxi?.path?.length >= 2) return mission.taxi.path
  return []
}

function activeTaxiPose(mission, ride) {
  return ride?.taxiPose || mission?.taxi?.pose || null
}

function routeGeoJSON(city, route) {
  return {
    type: 'FeatureCollection',
    features: route?.length >= 2
      ? [{
          type: 'Feature',
          properties: { layer: 'taxi-route' },
          geometry: {
            type: 'LineString',
            coordinates: route.map(point => city.worldToLngLat(point.x, point.z)),
          },
        }]
      : [],
  }
}

function Minimap({ city, player, mission, ride }) {
  const container = useRef(null)
  const map = useRef(null)
  const viewHeading = player.viewHeading ?? player.heading
  const route = activeTaxiRoute(mission, ride)

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
          taxiRoute: { type: 'geojson', data: routeGeoJSON(city, []) },
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
            id: 'taxi-route',
            type: 'line',
            source: 'taxiRoute',
            paint: {
              'line-color': '#ffd447',
              'line-width': 4.6,
              'line-opacity': 0.94,
            },
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

  useEffect(() => {
    const source = map.current?.getSource('taxiRoute')
    if (!source) return
    source.setData(routeGeoJSON(city, route))
  }, [city, route, mission?.updatedAt, ride?.updatedAt])

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
        {agent.currentIntent ? <small>{agent.currentIntent}</small> : null}
        {agent.memories?.[0]?.text ? <small>{agent.memories[0].text}</small> : null}
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
  const workLabel = interaction.agent.workAddress || interaction.agent.workName || 'your workplace'
  const presets = [
    {
      label: '직장까지',
      text: `나를 ${workLabel}까지 데려다줘요. 택시가 빠르면 택시를 타요.`,
    },
    {
      label: '택시 이동',
      text: '가까운 택시를 잡아서 목적지까지 같이 가줘요.',
    },
    {
      label: '일정 묻기',
      text: '지금 어디로 가는 중이고 오늘 일정은 어떻게 돼요?',
    },
  ]
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
        placeholder="예: 나를 당신이 일하는 곳까지 데려다줘요. 택시가 빠르면 택시를 타요."
        rows={3}
      />
      <div className="request-presets" aria-label="Quick requests">
        {presets.map(item => (
          <button key={item.label} type="button" disabled={disabled} onClick={() => setText(item.text)}>
            {item.label}
          </button>
        ))}
      </div>
      <div className="interaction-actions">
        <button type="submit" disabled={disabled || !text.trim()}>{disabled ? 'Thinking...' : 'Send'}</button>
        <button type="button" onClick={() => useCityStore.getState().closeInteraction()}>Close</button>
      </div>
    </form>
  )
}

function openPhone(tab = 'messages') {
  window.dispatchEvent(new CustomEvent('realcity:open-phone', { detail: { tab } }))
}

function pressTalk() {
  window.dispatchEvent(new KeyboardEvent('keydown', {
    code: 'KeyE',
    key: 'e',
    bubbles: true,
    cancelable: true,
  }))
}

function pressBoardTaxi() {
  window.dispatchEvent(new KeyboardEvent('keydown', {
    code: 'KeyF',
    key: 'f',
    bubbles: true,
    cancelable: true,
  }))
}

function pressHailTaxi() {
  window.dispatchEvent(new KeyboardEvent('keydown', {
    code: 'KeyH',
    key: 'h',
    bubbles: true,
    cancelable: true,
  }))
}

function KeyPrompt({ keyName, label, detail, primary = false, onClick }) {
  const Component = onClick ? 'button' : 'div'
  return (
    <Component
      type={onClick ? 'button' : undefined}
      className={`key-prompt ${primary ? 'primary' : ''}`}
      onClick={onClick}
    >
      <kbd>{keyName}</kbd>
      <span>{label}</span>
      {detail ? <small>{detail}</small> : null}
    </Component>
  )
}

function ContextPrompts({ nearbyAgent, mission, ride, player, onOpenMap }) {
  const actions = []

  if (mission) {
    const phase = ride
      ? 'In taxi'
      : mission.phase === 'to_pickup'
        ? 'Go to curb'
        : mission.phase === 'taxi_dispatch'
          ? 'Taxi en route'
          : mission.phase === 'taxi_waiting'
            ? 'Board taxi'
        : mission.phase === 'taxi_boarding'
          ? 'Boarding taxi'
          : mission.phase === 'leading'
            ? 'Follow agent'
            : 'Active plan'
    actions.push({
      keyName: mission.mode === 'taxi' && mission.phase === 'taxi_waiting' ? 'F' : mission.mode === 'taxi' ? 'TAXI' : 'GO',
      label: phase,
      detail: mission.destination?.address || mission.destination?.name,
      primary: true,
      onClick: mission.mode === 'taxi' && mission.phase === 'taxi_waiting' ? pressBoardTaxi : undefined,
    })
  } else if (nearbyAgent) {
    actions.push({
      keyName: 'E',
      label: `Talk to ${nearbyAgent.name.split(' ')[0]}`,
      detail: `${Math.round(nearbyAgent.distance)}m`,
      primary: true,
      onClick: pressTalk,
    })
  } else {
    actions.push({ keyName: 'E', label: 'Talk', detail: 'near NPC', primary: true })
  }

  actions.push(
    { keyName: 'T', label: 'Taxi', detail: 'phone route', onClick: () => openPhone('taxi') },
    { keyName: 'H', label: 'Hail', detail: 'passing cab', onClick: pressHailTaxi },
    { keyName: 'M', label: 'Map', detail: 'city', onClick: onOpenMap },
    { keyName: 'P', label: 'Phone', detail: 'contacts', onClick: () => openPhone('messages') },
  )

  return (
    <div className="prompt-stack" aria-label="Context actions">
      <div className="prompt-actions">
        {actions.map(action => (
          <KeyPrompt
            key={`${action.keyName}-${action.label}`}
            keyName={action.keyName}
            label={action.label}
            detail={action.detail}
            primary={action.primary}
            onClick={action.onClick}
          />
        ))}
      </div>
      <div className="control-ribbon" aria-label="Movement controls">
        <span><kbd>W/S</kbd> Move</span>
        <span><kbd>A/D</kbd> Turn</span>
        <span><kbd>Arrows</kbd> Look</span>
        <span><kbd>Space</kbd> Jump</span>
        <span><kbd>H/F</kbd> Taxi</span>
        {player?.indoors ? <span><kbd>PgUp/Dn</kbd> Floor</span> : null}
      </div>
    </div>
  )
}

function MissionPanel({ mission, ride }) {
  if (!mission) return null
  const taxiRoute = activeTaxiRoute(mission, ride)
  const routeMeters = ride?.routeMeters || (mission.phase === 'taxi_dispatch' ? mission.taxi?.routeMeters : mission.taxi?.destinationMeters) || mission.taxi?.routeMeters || 0
  const phase = ride
    ? `Taxi ${(Math.min(1, (performance.now() - ride.startedAt) / (ride.duration * 1000)) * 100).toFixed(0)}%`
    : mission.phase === 'taxi_dispatch'
      ? 'Taxi en route'
      : mission.phase === 'taxi_waiting'
        ? 'Taxi arrived'
        : mission.phase

  return (
    <aside className="mission-panel">
      <div className="eyebrow">Active Plan</div>
      <h2>{mission.agentName}</h2>
      <p>{mission.mode === 'taxi' ? 'Taxi escort' : 'Walking escort'} to {mission.destination?.name}</p>
      {mission.destination?.address ? <small>{mission.destination.address}</small> : null}
      <small>{phase}</small>
      {taxiRoute.length >= 2 ? <small>{Math.round(routeMeters)}m road route plotted</small> : null}
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

function FullCityMap({ city, player, mission, ride, onClose }) {
  const heading = ((player.viewHeading ?? player.heading) * 180) / Math.PI
  const route = activeTaxiRoute(mission, ride)
  const taxi = activeTaxiPose(mission, ride)
  const taxiHeading = taxi ? ((taxi.heading ?? taxi.yaw ?? 0) * 180) / Math.PI : 0

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
          {route.length >= 2 ? (
            <polyline
              className="full-map-route"
              points={route.map(point => `${point.x},${point.z}`).join(' ')}
            />
          ) : null}
          <g className="full-map-landmarks">
            {city.landmarks.map(place => (
              <g key={place.id} transform={`translate(${place.x} ${place.z})`}>
                <circle r={place.kind === 'park' ? 25 : 17} fill={placeColor(place.kind)} />
                <text x="24" y="7">{place.name}</text>
                {place.address ? <text className="address" x="24" y="29">{place.address}</text> : null}
              </g>
            ))}
          </g>
          {taxi ? (
            <g className="full-map-taxi" transform={`translate(${taxi.x} ${taxi.z}) rotate(${taxiHeading})`}>
              <rect x="-15" y="-24" width="30" height="48" rx="5" />
              <rect x="-10" y="-7" width="20" height="16" rx="3" />
            </g>
          ) : null}
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
  const nearbyAgent = useCityStore(state => state.nearbyAgent)
  const dialogue = useCityStore(state => state.dialogue)
  const interaction = useCityStore(state => state.interaction)
  const mission = useCityStore(state => state.mission)
  const ride = useCityStore(state => state.ride)
  const viewHeading = player.viewHeading ?? player.heading
  const displayedAgent = focusedAgent || nearbyAgent

  useEffect(() => {
    const onKeyDown = (event) => {
      if (event.target?.closest?.('input, textarea, select, button')) return
      if (event.code === 'KeyM') {
        event.preventDefault()
        setMapOpen(open => !open)
      } else if (event.code === 'KeyP') {
        event.preventDefault()
        openPhone('messages')
      } else if (event.code === 'KeyT') {
        event.preventDefault()
        openPhone('taxi')
      } else if (event.code === 'Escape') {
        setMapOpen(false)
        useCityStore.getState().closeInteraction()
      }
    }

    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [])

  return (
    <div className="hud">
      <section className="time-card">
        <h1>{clockLabel(timeMinutes)}</h1>
        <p>Day {day} / {weather.label} / {weather.tempC}C</p>
        <span>{player.indoors ? `${player.placeName} / Floor ${player.floor || 1}${player.floorCount ? ` of ${player.floorCount}` : ''}` : player.district}</span>
      </section>

      <Compass heading={viewHeading} />
      <AgentCard agent={displayedAgent} stats={stats} pulse={pulse} />
      <Dialogue dialogue={dialogue} />
      <InteractionPanel interaction={interaction} />
      <MissionPanel mission={mission} ride={ride} />
      {!interaction ? (
        <ContextPrompts
          nearbyAgent={nearbyAgent}
          mission={mission}
          ride={ride}
          player={player}
          onOpenMap={() => setMapOpen(true)}
        />
      ) : null}

      <button type="button" className="map-shell" onClick={() => setMapOpen(true)} aria-label="Open full city map">
        <Minimap city={city} player={player} mission={mission} ride={ride} />
      </button>
      {mapOpen ? <FullCityMap city={city} player={player} mission={mission} ride={ride} onClose={() => setMapOpen(false)} /> : null}
      <VirtualPhone city={city} player={player} focusedAgent={focusedAgent} timeMinutes={timeMinutes} />

      <div className="vitals">
        <div><span>HP</span><i style={{ width: '100%' }} /></div>
        <div><span>ST</span><i style={{ width: `${Math.max(35, 100 - player.speed * 4)}%` }} /></div>
      </div>
    </div>
  )
}
