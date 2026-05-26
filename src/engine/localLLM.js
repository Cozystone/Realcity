const provider = import.meta.env.VITE_LOCAL_LLM_PROVIDER || 'ollama'
const endpoint = import.meta.env.VITE_LOCAL_LLM_ENDPOINT || '/ollama/api/generate'
const model = import.meta.env.VITE_LOCAL_LLM_MODEL || 'dolphin3:latest'

const PLACE_ALIASES = [
  {
    id: 'hanbit_hospital',
    aliases: ['hospital', 'clinic', 'medical', 'emergency', '\ubcd1\uc6d0', '\uc751\uae09\uc2e4', '\uc9c4\ub8cc'],
  },
  {
    id: 'river_cafe',
    aliases: ['cafe', 'coffee', 'river cafe', '\uce74\ud398', '\ucee4\ud53c'],
  },
  {
    id: 'mirae_school',
    aliases: ['school', 'campus', 'class', '\ud559\uad50', '\ucea0\ud37c\uc2a4', '\uc218\uc5c5'],
  },
  {
    id: 'hill_park',
    aliases: ['park', 'garden', 'hill park', '\uacf5\uc6d0', '\uc815\uc6d0'],
  },
  {
    id: 'central_station',
    aliases: ['station', 'central station', 'train', 'metro', 'transit', '\uc5ed', '\uc815\uac70\uc7a5', '\uae30\ucc28', '\uc9c0\ud558\ucca0'],
  },
  {
    id: 'market_lane',
    aliases: ['market', 'shop', 'retail', 'market lane', '\uc2dc\uc7a5', '\ub9c8\ucf13', '\uc0c1\uc810'],
  },
  {
    id: 'aster_exchange',
    aliases: ['exchange', 'bank', 'finance', 'office tower', '\uc740\ud589', '\uae08\uc735', '\uac70\ub798\uc18c'],
  },
  {
    id: 'neon_square',
    aliases: ['square', 'plaza', 'neon square', 'nightlife', '\uad11\uc7a5', '\ud50c\ub77c\uc790'],
  },
  {
    id: 'south_depot',
    aliases: ['depot', 'warehouse', 'logistics', 'delivery hub', '\ucc3d\uace0', '\ubb3c\ub958', '\ubc30\uc1a1'],
  },
  {
    id: 'maker_yard',
    aliases: ['maker', 'workshop', 'robotics', 'yard', '\uacf5\ubc29', '\uc791\uc5c5\uc7a5', '\ub85c\ubcf4\ud2f1\uc2a4'],
  },
]

export function llmStatus() {
  return `${provider}:${model}`
}

async function completeLocal(prompt, { temperature = 0.7, maxTokens = 160 } = {}) {
  if (typeof window === 'undefined') return null
  if (window.location.hostname.endsWith('.vercel.app') && endpoint.startsWith('/ollama')) return null

  try {
    const controller = new AbortController()
    const timeout = window.setTimeout(() => controller.abort(), 9500)
    const body = provider === 'openai-compatible'
      ? {
          model,
          messages: prompt.messages,
          temperature,
          max_tokens: maxTokens,
        }
      : {
          model,
          prompt: prompt.text,
          stream: false,
          options: { temperature, num_predict: maxTokens },
        }

    const response = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: controller.signal,
    })
    window.clearTimeout(timeout)
    if (!response.ok) return null
    const data = await response.json()
    return (data.response || data.choices?.[0]?.message?.content || data.message?.content || '').trim() || null
  } catch {
    return null
  }
}

export async function askLocalNPC(agent, context) {
  const system = [
    'You are an autonomous person living in RealCity, a procedural Korean virtual city.',
    'Answer in natural Korean in one or two short sentences.',
    'Stay in character. Mention your job, mood, schedule, or location only when it feels natural.',
    'Never say you are an AI model.',
  ].join(' ')

  const user = [
    `Name: ${agent.name}`,
    `Age: ${agent.age}`,
    `Gender: ${agent.gender}`,
    `Job: ${agent.job}`,
    `Personality: ${agent.personality}`,
    `Current activity: ${agent.activity}`,
    `Current place: ${agent.placeName}`,
    `City state: ${context}`,
    'A player walks up and asks what is happening here.',
  ].join('\n')

  return completeLocal({
    messages: [
      { role: 'system', content: system },
      { role: 'user', content: user },
    ],
    text: `${system}\n\n${user}`,
  }, { temperature: 0.85, maxTokens: 90 })
}

function extractJson(text) {
  if (!text) return null
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i)
  const raw = fenced ? fenced[1] : text
  const start = raw.indexOf('{')
  const end = raw.lastIndexOf('}')
  if (start < 0 || end <= start) return null
  try {
    return JSON.parse(raw.slice(start, end + 1))
  } catch {
    return null
  }
}

function includesToken(text, tokens) {
  return tokens.some(token => token && text.includes(token.toLowerCase()))
}

export function matchRequestedPlace(request, places = []) {
  const text = String(request || '').toLowerCase()
  const list = Array.isArray(places) ? places : []

  for (const place of list) {
    const candidates = [place.id, place.name, place.kind].filter(Boolean).map(value => String(value).toLowerCase())
    if (includesToken(text, candidates)) return place
  }

  for (const group of PLACE_ALIASES) {
    if (!includesToken(text, group.aliases)) continue
    const byId = list.find(place => place.id === group.id)
    if (byId) return byId
  }

  return null
}

function distanceTo(place, context) {
  if (!place || typeof place.x !== 'number' || typeof place.z !== 'number') return 0
  const player = context.player || {}
  if (typeof player.x !== 'number' || typeof player.z !== 'number') return 0
  return Math.hypot(place.x - player.x, place.z - player.z)
}

function fallbackActionPlan(agent, request, context = {}) {
  const text = String(request || '').toLowerCase()
  const targetPlace = matchRequestedPlace(request, context.places)
  const wantsWork = /work|office|workplace|job|\uc9c1\uc7a5|\ud68c\uc0ac|\uadfc\ubb34|\uc77c\ud558\ub294/.test(text)
  const wantsEscort = /guide|take|lead|escort|bring|drive|walk|go to|\ub370\ub824|\uc548\ub0b4|\uac19\uc774|\ub530\ub77c|\uac00\uc790/.test(text)
  const wantsTaxi = /taxi|cab|car|ride|drive|\ud0dd\uc2dc|\ucc28|\uc2b9\ucc28|\ud0dc\uc6cc/.test(text)
  const asksIdentity = /who|name|job|work|identity|\ub204\uad6c|\uc774\ub984|\uc9c1\uc5c5/.test(text)

  if (targetPlace && (wantsEscort || wantsTaxi || /where|location|\uc5b4\ub514|\uc704\uce58/.test(text))) {
    const tripDistance = distanceTo(targetPlace, context)
    const mode = wantsTaxi || tripDistance > 420 ? 'taxi' : 'walk'
    return {
      intent: 'escort_to_place',
      decision: 'accept',
      mode,
      destination: 'named_place',
      targetPlaceId: targetPlace.id || '',
      targetPlaceName: targetPlace.name || 'requested place',
      speech: mode === 'taxi'
        ? `I can take you to ${targetPlace.name}. Let's step to the curb, get a taxi, and ride there together.`
        : `I can guide you to ${targetPlace.name}. Stay close and I will lead the way.`,
      steps: mode === 'taxi'
        ? ['Move to the nearest curb', 'Hail a taxi', `Ride with the player to ${targetPlace.name}`, 'Confirm arrival at the entrance']
        : ['Confirm the destination', `Walk toward ${targetPlace.name}`, 'Stop at the entrance and brief the player'],
    }
  }

  if (wantsWork || (wantsEscort && /work|office|job|\uc9c1\uc7a5|\ud68c\uc0ac/.test(text))) {
    const far = typeof context.distanceToWork === 'number' && context.distanceToWork > 260
    const mode = wantsTaxi || far ? 'taxi' : 'walk'
    return {
      intent: 'escort_to_work',
      decision: 'accept',
      mode,
      destination: 'work',
      targetPlaceId: agent.workId || '',
      targetPlaceName: agent.workName || 'workplace',
      speech: mode === 'taxi'
        ? `Yes. My workplace is ${agent.workName || 'nearby'}, so I will call a taxi and take you there.`
        : `Yes. My workplace is ${agent.workName || 'nearby'}; follow me and I will walk you there.`,
      steps: mode === 'taxi'
        ? ['Move to the nearest curb', 'Hail a taxi', 'Ride together to the workplace', 'Guide the player to the entrance']
        : ['Check that the player is following', 'Walk along the route', 'Stop at the workplace entrance'],
    }
  }

  if (asksIdentity) {
    return {
      intent: 'smalltalk',
      decision: 'answer',
      mode: 'talk',
      destination: 'none',
      targetPlaceId: '',
      targetPlaceName: '',
      speech: `I am ${agent.name}, a ${agent.job}. I am ${agent.activity || 'moving through the city'} near ${agent.placeName || 'this block'}.`,
      steps: ['Introduce identity and current activity'],
    }
  }

  return {
    intent: 'clarify',
    decision: 'clarify',
    mode: 'talk',
    destination: 'none',
    targetPlaceId: '',
    targetPlaceName: '',
    speech: 'Tell me the exact place or person you need, and I will decide whether we should walk, take a taxi, or ask a better local guide.',
    steps: ['Ask for a clearer destination', 'Choose walking or taxi after the destination is known'],
  }
}

function resolvePlanPlace(plan, request, places = []) {
  if (!plan || plan.destination !== 'named_place') return null
  const list = Array.isArray(places) ? places : []
  const id = typeof plan.targetPlaceId === 'string' ? plan.targetPlaceId.trim() : ''
  if (id) {
    const byId = list.find(place => place.id === id)
    if (byId) return byId
  }

  const name = typeof plan.targetPlaceName === 'string' ? plan.targetPlaceName.trim().toLowerCase() : ''
  if (name) {
    const byName = list.find(place => [place.name, place.kind, place.id].some(value => String(value || '').toLowerCase().includes(name)))
    if (byName) return byName
  }

  return matchRequestedPlace(request, list)
}

export async function planLocalNPCAction(agent, request, context = {}) {
  const places = Array.isArray(context.places) ? context.places : []
  const schema = {
    intent: 'escort_to_work | escort_to_place | smalltalk | clarify | decline',
    decision: 'accept | clarify | decline | answer',
    mode: 'walk | taxi | talk',
    destination: 'work | home | third | named_place | none',
    targetPlaceId: 'known city place id or empty string',
    targetPlaceName: 'known city place name or empty string',
    speech: 'Korean sentence spoken by the NPC',
    steps: ['short action step 1', 'short action step 2'],
  }

  const knownPlaces = places
    .map(place => `${place.id}: ${place.name} (${place.kind})`)
    .join('\n')

  const system = [
    'You are the decision system for one autonomous NPC in a playable virtual city.',
    'The player can ask for realistic favors, guidance, transport, or conversation.',
    'Think about the NPC schedule, job, personality, safety, urgency, and available city actions.',
    'Return only strict JSON matching this schema:',
    JSON.stringify(schema),
    'Use Korean for speech. Keep steps concrete and executable in a 3D city simulation.',
    'If the player asks to be taken to the NPC workplace, use destination "work".',
    'If the player names a known city place, use destination "named_place" and set targetPlaceId.',
    'If the trip is far, urgent, or the player asks for a taxi, mode can be "taxi"; otherwise use "walk".',
    'Do not claim impossible actions. Clarify when the request is ambiguous.',
  ].join('\n')

  const user = [
    `NPC: ${agent.name}, ${agent.age}, ${agent.gender}`,
    `Job: ${agent.job}`,
    `Personality: ${agent.personality}`,
    `Current activity: ${agent.activity}`,
    `Current place: ${agent.placeName}`,
    `Workplace: ${agent.workName || 'unknown'}`,
    `Distance to work: ${Math.round(context.distanceToWork || 0)} meters`,
    `City time: ${context.timeLabel || 'unknown'}`,
    `Player district: ${context.playerDistrict || 'unknown'}`,
    `Known city places:\n${knownPlaces || 'none'}`,
    `Player request: ${request}`,
  ].join('\n')

  const text = await completeLocal({
    messages: [
      { role: 'system', content: system },
      { role: 'user', content: user },
    ],
    text: `${system}\n\n${user}`,
  }, { temperature: 0.42, maxTokens: 240 })

  const parsed = extractJson(text)
  const safe = fallbackActionPlan(agent, request, context)
  const parsedPlace = resolvePlanPlace(parsed, request, places)
  const safeAcceptsRoute = safe.decision === 'accept' && safe.destination !== 'none'
  const parsedCanRoute = parsed && (
    parsed.destination === 'work' ||
    parsed.destination === 'home' ||
    parsed.destination === 'third' ||
    (parsed.destination === 'named_place' && parsedPlace)
  )
  const plan = parsedCanRoute || !safeAcceptsRoute ? (parsed || safe) : safe
  const resolvedPlace = resolvePlanPlace(plan, request, places)

  return {
    intent: typeof plan.intent === 'string' ? plan.intent : safe.intent,
    decision: ['accept', 'clarify', 'decline', 'answer'].includes(plan.decision) ? plan.decision : safe.decision,
    mode: ['walk', 'taxi', 'talk'].includes(plan.mode) ? plan.mode : safe.mode,
    destination: ['work', 'home', 'third', 'named_place', 'none'].includes(plan.destination) ? plan.destination : safe.destination,
    targetPlaceId: resolvedPlace?.id || (typeof plan.targetPlaceId === 'string' ? plan.targetPlaceId : safe.targetPlaceId || ''),
    targetPlaceName: resolvedPlace?.name || (typeof plan.targetPlaceName === 'string' ? plan.targetPlaceName : safe.targetPlaceName || ''),
    speech: typeof plan.speech === 'string' && plan.speech.trim() ? plan.speech.trim().slice(0, 220) : safe.speech,
    steps: Array.isArray(plan.steps) && plan.steps.length
      ? plan.steps.slice(0, 5).map(step => String(step).slice(0, 90))
      : safe.steps,
    source: parsed ? (plan === safe ? 'local-llm+fallback-route' : 'local-llm') : 'fallback',
  }
}

export function fallbackLine(agent) {
  const place = agent.placeName || 'this block'
  const lines = {
    banker: `The money flow around ${place} is moving fast today. I am watching the market before my next meeting.`,
    doctor: 'The hospital is busy, but the shift is under control. A quiet ten minutes would help.',
    teacher: 'I am between classes. The students have been unusually energetic today.',
    courier: 'Traffic is rough, but delivery windows do not wait. I am heading to the next drop.',
    barista: 'Coffee orders are stacking up. Morning makes everyone move a little faster.',
    engineer: 'The sidewalk sensors show a strange flow pattern here. Something small changed in this block.',
    artist: 'The light on the building glass is good right now. It is giving me an idea for tonight.',
    security: 'Stay aware of the crowd and you will be fine. The station gets dense around this time.',
    student: 'I am looking around before study hall. The city feels busier than usual today.',
    shopkeeper: 'The market tells you the mood of the whole day if you watch people long enough.',
    gardener: 'The wind is dry. The park trees will need water before the afternoon.',
    retiree: 'I walk this route every day. Slow streets reveal more than fast ones.',
  }
  return lines[agent.role] || `I am near ${place}. RealCity is moving a little faster than usual today.`
}
