import { create } from 'zustand'
import { DAY_MINUTES } from './cityEngine'

export const useCityStore = create((set, get) => ({
  timeMinutes: 10 * 60 + 30,
  day: 1,
  player: {
    x: 0,
    y: 6,
    z: 40,
    heading: Math.PI,
    viewHeading: Math.PI,
    speed: 0,
    district: 'Central Core',
    placeId: null,
    placeName: null,
    indoors: false,
    floor: 0,
    floorCount: 0,
    verticalCore: null,
  },
  weather: {
    label: 'Clear',
    tempC: 22,
    windAngle: 0.72,
    windSpeed: 5.8,
    clouds: 0.44,
  },
  sky: {
    phase: 'day',
    sunElevation: 0.75,
    sunlight: 1,
    reflection: 1,
  },
  stats: {
    npcs: 0,
    cars: 0,
    talks: 0,
    tiles: 0,
    llm: 'ollama',
  },
  focusedAgent: null,
  nearbyAgent: null,
  dialogue: null,
  interaction: null,
  mission: null,
  ride: null,
  cityEvents: [],
  pedestrianSamples: [],
  vehicleSamples: [],
  collisionRules: {
    playerRadius: 0.72,
    pedestrianRadius: 0.82,
    vehiclePadding: 0.78,
    solidObjects: ['buildings', 'landmarks', 'pedestrians', 'vehicles'],
    reactions: ['push-away', 'stumble', 'fall', 'driver-brake'],
  },
  pulse: 'Morning traffic is building around Central Station.',

  tick(delta) {
    const state = get()
    const next = state.timeMinutes + delta * 1.25
    set({
      timeMinutes: next % DAY_MINUTES,
      day: state.day + (next >= DAY_MINUTES ? 1 : 0),
    })
  },

  setPlayer(player) {
    const current = get().player
    if (
      Math.abs(player.x - current.x) < 0.12 &&
      Math.abs(player.y - current.y) < 0.12 &&
      Math.abs(player.z - current.z) < 0.12 &&
      Math.abs(player.heading - current.heading) < 0.008 &&
      Math.abs((player.viewHeading ?? player.heading) - (current.viewHeading ?? current.heading)) < 0.008 &&
      Math.abs(player.speed - current.speed) < 0.2 &&
      (player.placeId || null) === (current.placeId || null) &&
      !!player.indoors === !!current.indoors &&
      (player.floor || 0) === (current.floor || 0) &&
      (player.floorCount || 0) === (current.floorCount || 0)
    ) return

    set({ player })
  },

  setStats(stats) {
    set(state => ({ stats: { ...state.stats, ...stats } }))
  },

  setSky(sky) {
    set(state => ({ sky: { ...state.sky, ...sky } }))
  },

  setNearbyAgent(agent) {
    const current = get().nearbyAgent
    if (!agent) {
      if (current) set({ nearbyAgent: null })
      return
    }

    const currentDistance = current ? Math.round(current.distance || 0) : null
    const nextDistance = Math.round(agent.distance || 0)
    if (
      current?.id === agent.id &&
      currentDistance === nextDistance &&
      current.activity === agent.activity &&
      current.placeName === agent.placeName
    ) return

    set({ nearbyAgent: agent })
  },

  showDialogue(dialogue) {
    set({
      dialogue: { ...dialogue, shownAt: Date.now() },
      focusedAgent: dialogue.agent || null,
    })
  },

  openInteraction(agent) {
    set({
      interaction: { agent, status: 'open', request: '', plan: null, updatedAt: Date.now() },
      focusedAgent: agent,
    })
  },

  setInteraction(patch) {
    set(state => ({
      interaction: state.interaction ? { ...state.interaction, ...patch, updatedAt: Date.now() } : null,
    }))
  },

  closeInteraction() {
    set({ interaction: null })
  },

  startMission(mission) {
    set({
      mission: { ...mission, updatedAt: Date.now() },
      pulse: mission.summary || `${mission.agentName} is acting on your request.`,
    })
  },

  updateMission(patch) {
    set(state => ({
      mission: state.mission ? { ...state.mission, ...patch, updatedAt: Date.now() } : null,
    }))
  },

  finishMission(text) {
    set(state => ({
      mission: null,
      interaction: state.interaction ? { ...state.interaction, status: 'done', updatedAt: Date.now() } : null,
      pulse: text || 'The requested action is complete.',
    }))
  },

  startRide(ride) {
    set({
      ride: { ...ride, startedAt: performance.now(), updatedAt: Date.now() },
      pulse: ride.label || 'Taxi ride started.',
    })
  },

  finishRide(text) {
    set({
      ride: null,
      pulse: text || 'Taxi ride complete.',
    })
  },

  setPulse(pulse) {
    set({ pulse })
  },

  addCityEvent(event) {
    if (!event?.text) return
    set(state => {
      const now = Date.now()
      const entry = {
        id: event.id || `event_${now}_${state.cityEvents.length}`,
        timeMinutes: state.timeMinutes,
        day: state.day,
        createdAt: now,
        kind: event.kind || 'city',
        agentId: event.agentId || null,
        agentName: event.agentName || null,
        placeName: event.placeName || null,
        text: String(event.text).slice(0, 180),
      }
      const duplicate = state.cityEvents[0]
      if (
        duplicate &&
        duplicate.agentId === entry.agentId &&
        duplicate.kind === entry.kind &&
        duplicate.text === entry.text &&
        now - duplicate.createdAt < 2500
      ) {
        return state
      }
      return { cityEvents: [entry, ...state.cityEvents].slice(0, 24) }
    })
  },

  setPedestrianSamples(pedestrianSamples) {
    set({ pedestrianSamples })
  },

  setVehicleSamples(vehicleSamples) {
    set({ vehicleSamples })
  },
}))

if (typeof window !== 'undefined' && import.meta.env.DEV) {
  window.__REALCITY_STORE__ = useCityStore
}

export function clockLabel(minutes) {
  const h = Math.floor(minutes / 60)
  const m = Math.floor(minutes % 60)
  const suffix = h >= 12 ? 'PM' : 'AM'
  return `${h % 12 || 12}:${String(m).padStart(2, '0')} ${suffix}`
}
