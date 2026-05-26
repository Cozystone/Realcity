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
  },
  weather: {
    label: 'Clear',
    tempC: 22,
    windAngle: 0.72,
    windSpeed: 5.8,
    clouds: 0.44,
  },
  stats: {
    npcs: 0,
    cars: 0,
    talks: 0,
    tiles: 0,
    llm: 'ollama',
  },
  focusedAgent: null,
  dialogue: null,
  interaction: null,
  mission: null,
  ride: null,
  pedestrianSamples: [],
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
      Math.abs(player.z - current.z) < 0.12 &&
      Math.abs(player.heading - current.heading) < 0.008 &&
      Math.abs((player.viewHeading ?? player.heading) - (current.viewHeading ?? current.heading)) < 0.008 &&
      Math.abs(player.speed - current.speed) < 0.2
    ) return

    set({ player })
  },

  setStats(stats) {
    set(state => ({ stats: { ...state.stats, ...stats } }))
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

  setPedestrianSamples(pedestrianSamples) {
    set({ pedestrianSamples })
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
