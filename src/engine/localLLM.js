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

export function styleNpcSpeech(agent, speech) {
  const raw = String(speech || '').replace(/\s+/g, ' ').trim()
  if (!raw) return raw
  const style = agent?.speechStyle || {}
  const prefix = String(style.prefix || '').trim()
  const knownPrefixes = ['네,', '좋아요,', '간단히 말하면,', '알겠습니다.', '오케이,', '음,', '바로 보면,', '확인해볼게요.', '좋죠.', '가능합니다.']
  if (!prefix || raw.startsWith(prefix) || knownPrefixes.some(item => raw.startsWith(item))) return raw.slice(0, 220)
  return `${prefix} ${raw}`.replace(/\s+/g, ' ').slice(0, 220)
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
    'Keep the speech in this NPC personal speech style; do not make every NPC sound the same.',
    'Stay in character. Mention your job, mood, schedule, or location only when it feels natural.',
    'Never say you are an AI model.',
  ].join(' ')

  const user = [
    `Name: ${agent.name}`,
    `Age: ${agent.age}`,
    `Gender: ${agent.gender}`,
    `Job: ${agent.job}`,
    `Personality: ${agent.personality}`,
    `Speech style: ${agent.speechStyle?.label || 'natural'}`,
    `Speech flavor: ${agent.speechStyle?.flavor || 'ordinary'}`,
    `Voice: ${agent.voice || 'neutral'}`,
    `Gesture: ${agent.gestureStyle || 'small nod'}`,
    `Current activity: ${agent.activity}`,
    `Current place: ${agent.placeName}`,
    `City state: ${context}`,
    'A player walks up and asks what is happening here.',
  ].join('\n')

  const response = await completeLocal({
    messages: [
      { role: 'system', content: system },
      { role: 'user', content: user },
    ],
    text: `${system}\n\n${user}`,
  }, { temperature: 0.85, maxTokens: 90 })
  return styleNpcSpeech(agent, response)
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

function normalizeText(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/[^a-z0-9가-힣]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function includesPlaceCandidate(request, values) {
  const raw = String(request || '').toLowerCase()
  const normalized = normalizeText(request)
  return values.some(value => {
    if (!value) return false
    const candidate = String(value).toLowerCase()
    const normalizedCandidate = normalizeText(value)
    return raw.includes(candidate) || (normalizedCandidate && normalized.includes(normalizedCandidate))
  })
}

export function matchRequestedPlace(request, places = []) {
  const list = Array.isArray(places) ? places : []

  for (const place of list) {
    if (includesPlaceCandidate(request, [place.address])) return place
  }

  for (const place of list) {
    const candidates = [place.id, place.name, place.kind, place.district, place.buildingType]
    if (includesPlaceCandidate(request, candidates)) return place
  }

  const text = String(request || '').toLowerCase()
  for (const group of PLACE_ALIASES) {
    if (!includesToken(text, group.aliases)) continue
    const byId = list.find(place => place.id === group.id)
    if (byId) return byId
  }

  for (const place of list) {
    if (includesPlaceCandidate(request, [place.roadName])) return place
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
  const namedAddress = targetPlace && includesPlaceCandidate(request, [targetPlace.address, targetPlace.roadName])
  const asksLocation = /where|location|address|street|road|\uc5b4\ub514|\uc704\uce58|\uc8fc\uc18c|\ub3c4\ub85c\uba85|\uae38|\ub85c/.test(text)

  if (targetPlace && (wantsEscort || wantsTaxi || asksLocation || namedAddress)) {
    const tripDistance = distanceTo(targetPlace, context)
    const mode = wantsTaxi || tripDistance > 420 ? 'taxi' : 'walk'
    const label = targetPlace.address || targetPlace.name
    return {
      intent: 'escort_to_place',
      decision: 'accept',
      mode,
      destination: 'named_place',
      targetPlaceId: targetPlace.id || '',
      targetPlaceName: targetPlace.name || label || 'requested place',
      speech: styleNpcSpeech(agent, mode === 'taxi'
        ? `${label}까지 데려다드릴게요. 길가로 나가서 택시를 잡고 같이 이동하죠.`
        : `${label}까지 안내할게요. 제 뒤를 따라오세요.`),
      steps: mode === 'taxi'
        ? ['Move to the nearest curb', 'Hail a taxi', `Ride with the player to ${label}`, 'Confirm arrival at the entrance']
        : ['Confirm the destination', `Walk toward ${label}`, 'Stop at the entrance and brief the player'],
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
      speech: styleNpcSpeech(agent, mode === 'taxi'
        ? `제 일터는 ${agent.workName || '근처'}입니다. 택시를 불러서 같이 가죠.`
        : `제 일터는 ${agent.workName || '근처'}입니다. 따라오시면 걸어서 안내할게요.`),
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
      speech: styleNpcSpeech(agent, `저는 ${agent.name}, ${agent.job}입니다. 지금은 ${agent.placeName || '이 블록'} 근처에서 ${agent.activity || '이동 중'}이에요.`),
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
    speech: styleNpcSpeech(agent, '정확한 장소나 사람을 말해 주세요. 걸어갈지, 택시를 탈지, 더 잘 아는 사람에게 물어볼지 판단할게요.'),
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
    const normalizedName = normalizeText(name)
    const byName = list.find(place => [place.name, place.kind, place.id, place.address, place.roadName, place.district, place.buildingType].some(value => {
      const normalizedValue = normalizeText(value)
      return normalizedValue && (normalizedValue.includes(normalizedName) || normalizedName.includes(normalizedValue))
    }))
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
    .map(place => `${place.id}: ${place.name} (${place.kind})${place.address ? ` at ${place.address}` : ''}`)
    .join('\n')

  const system = [
    'You are the decision system for one autonomous NPC in a playable virtual city.',
    'The player can ask for realistic favors, guidance, transport, or conversation.',
    'Think about the NPC schedule, job, personality, safety, urgency, and available city actions.',
    'Return only strict JSON matching this schema:',
    JSON.stringify(schema),
    'Use Korean for speech. Keep steps concrete and executable in a 3D city simulation.',
    'Keep the speech in the NPC personal speech style, voice, and gesture flavor; do not make every NPC sound the same.',
    'If the player asks to be taken to the NPC workplace, use destination "work".',
    'If the player names a known city place, use destination "named_place" and set targetPlaceId.',
    'If the trip is far, urgent, or the player asks for a taxi, mode can be "taxi"; otherwise use "walk".',
    'Do not claim impossible actions. Clarify when the request is ambiguous.',
  ].join('\n')

  const user = [
    `NPC: ${agent.name}, ${agent.age}, ${agent.gender}`,
    `Job: ${agent.job}`,
    `Personality: ${agent.personality}`,
    `Speech style: ${agent.speechStyle?.label || 'natural'}`,
    `Speech flavor: ${agent.speechStyle?.flavor || 'ordinary'}`,
    `Voice: ${agent.voice || 'neutral'}`,
    `Gesture: ${agent.gestureStyle || 'small nod'}`,
    `Style brief: ${agent.styleBrief || ''}`,
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
  const safePlace = resolvePlanPlace(safe, request, places)
  const safeAddressExact = safePlace?.address && includesPlaceCandidate(request, [safePlace.address])
  const parsedMatchesSafeAddress = parsedPlace?.id && safePlace?.id && parsedPlace.id === safePlace.id
  const safeAcceptsRoute = safe.decision === 'accept' && safe.destination !== 'none'
  const parsedCanRoute = parsed && (
    parsed.destination === 'work' ||
    parsed.destination === 'home' ||
    parsed.destination === 'third' ||
    (parsed.destination === 'named_place' && parsedPlace)
  )
  const plan = safeAddressExact && !parsedMatchesSafeAddress
    ? safe
    : parsedCanRoute || !safeAcceptsRoute ? (parsed || safe) : safe
  const resolvedPlace = resolvePlanPlace(plan, request, places)

  return {
    intent: typeof plan.intent === 'string' ? plan.intent : safe.intent,
    decision: ['accept', 'clarify', 'decline', 'answer'].includes(plan.decision) ? plan.decision : safe.decision,
    mode: ['walk', 'taxi', 'talk'].includes(plan.mode) ? plan.mode : safe.mode,
    destination: ['work', 'home', 'third', 'named_place', 'none'].includes(plan.destination) ? plan.destination : safe.destination,
    targetPlaceId: resolvedPlace?.id || (typeof plan.targetPlaceId === 'string' ? plan.targetPlaceId : safe.targetPlaceId || ''),
    targetPlaceName: resolvedPlace?.name || (typeof plan.targetPlaceName === 'string' ? plan.targetPlaceName : safe.targetPlaceName || ''),
    speech: styleNpcSpeech(agent, typeof plan.speech === 'string' && plan.speech.trim() ? plan.speech : safe.speech),
    steps: Array.isArray(plan.steps) && plan.steps.length
      ? plan.steps.slice(0, 5).map(step => String(step).slice(0, 90))
      : safe.steps,
    source: parsed ? (plan === safe ? 'local-llm+fallback-route' : 'local-llm') : 'fallback',
  }
}

export function fallbackLine(agent) {
  const place = agent.placeName || 'this block'
  const lines = {
    banker: `${place} 쪽 자금 흐름이 오늘 꽤 빠릅니다. 다음 미팅 전에 시장 분위기를 보고 있어요.`,
    doctor: '병원은 바쁘지만 아직 통제되고 있어요. 조용한 10분만 있어도 숨을 돌릴 수 있겠네요.',
    teacher: '수업 사이에 잠깐 나왔어요. 오늘 학생들이 유난히 에너지가 넘칩니다.',
    courier: '교통이 거칠지만 배송 시간은 기다려주지 않죠. 다음 경유지로 가는 중이에요.',
    barista: '주문이 계속 쌓이고 있어요. 아침에는 도시 전체가 조금 더 빨리 움직이네요.',
    engineer: '인도 센서 흐름이 조금 이상합니다. 이 블록에서 작은 변화가 생긴 것 같아요.',
    artist: '지금 건물 유리에 비치는 빛이 좋아요. 오늘 밤 작업에 쓸 생각이 떠올랐습니다.',
    security: '사람 흐름만 잘 보면 괜찮습니다. 이 시간대에는 역 주변이 특히 빽빽해져요.',
    student: '자습 전에 주변을 둘러보고 있어요. 오늘 도시는 평소보다 더 바쁜 느낌이에요.',
    shopkeeper: '사람들을 오래 보면 시장이 하루의 기분을 알려줍니다. 오늘은 조금 들떠 있어요.',
    gardener: '바람이 건조하네요. 오후 전에 공원 나무들에 물을 줘야 할 것 같습니다.',
    retiree: '이 길은 매일 걷습니다. 천천히 걸어야 빠른 거리에서는 안 보이는 게 보여요.',
  }
  return styleNpcSpeech(agent, lines[agent.role] || `${place} 근처에 있어요. 오늘 RealCity는 평소보다 조금 빠르게 움직이네요.`)
}
