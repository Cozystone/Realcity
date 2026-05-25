import { create } from 'zustand'
import { DAY_MINUTES } from './cityEngine'

export const useCityStore = create((set, get) => ({
  timeMinutes: 10 * 60 + 30,
  day: 1,
  player: {
    x: 0,
    y: 6,
    z: 40,
    heading: 0,
    viewHeading: 0,
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

  setPulse(pulse) {
    set({ pulse })
  },
}))

export function clockLabel(minutes) {
  const h = Math.floor(minutes / 60)
  const m = Math.floor(minutes % 60)
  const suffix = h >= 12 ? 'PM' : 'AM'
  return `${h % 12 || 12}:${String(m).padStart(2, '0')} ${suffix}`
}
