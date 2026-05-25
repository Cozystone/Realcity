const provider = import.meta.env.VITE_LOCAL_LLM_PROVIDER || 'ollama'
const endpoint = import.meta.env.VITE_LOCAL_LLM_ENDPOINT || '/ollama/api/generate'
const model = import.meta.env.VITE_LOCAL_LLM_MODEL || 'dolphin3:latest'

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

function fallbackActionPlan(agent, request, context = {}) {
  const text = request.toLowerCase()
  const wantsEscort = /데려|안내|같이|따라|직장|회사|office|work|guide|take|lead|escort/.test(text)
  const wantsTaxi = /택시|taxi|차|car|ride|급|빨리|멀/.test(text)
  const asksIdentity = /누구|이름|직업|who|name|job/.test(text)

  if (wantsEscort) {
    const far = typeof context.distanceToWork === 'number' && context.distanceToWork > 260
    const mode = wantsTaxi || far ? 'taxi' : 'walk'
    return {
      intent: 'escort_to_work',
      decision: 'accept',
      mode,
      destination: 'work',
      speech: mode === 'taxi'
        ? '좋아요. 제 일터까지는 거리가 있어서 큰길로 나가 택시를 잡고 같이 이동하죠. 급한 상황이면 가는 동안 설명해주세요.'
        : '좋아요. 제가 앞장설게요. 길이 복잡하니 제 뒤를 따라오세요.',
      steps: mode === 'taxi'
        ? ['큰길 가장자리로 이동한다', '택시를 세운다', '함께 탑승한다', '직장 입구에서 내린다']
        : ['플레이어가 따라오는지 확인한다', '보행 경로로 이동한다', '목적지 앞에서 멈춰 안내한다'],
    }
  }

  if (asksIdentity) {
    return {
      intent: 'smalltalk',
      decision: 'answer',
      mode: 'talk',
      destination: 'none',
      speech: `저는 ${agent.name}, ${agent.job}입니다. 지금은 ${agent.placeName || '이 근처'}에서 ${agent.activity || '일정을 보내는 중'}이에요.`,
      steps: ['짧게 자기소개한다'],
    }
  }

  return {
    intent: 'clarify',
    decision: 'clarify',
    mode: 'talk',
    destination: 'none',
    speech: '가능한지 판단하려면 목적지를 조금 더 정확히 말해줘요. 같이 걸어갈지, 택시를 탈지도 상황을 보고 정할게요.',
    steps: ['요청 목적지를 확인한다', '이동 방식이 필요한지 판단한다'],
  }
}

export async function planLocalNPCAction(agent, request, context = {}) {
  const schema = {
    intent: 'escort_to_work | escort_to_place | smalltalk | clarify | decline',
    decision: 'accept | clarify | decline | answer',
    mode: 'walk | taxi | talk',
    destination: 'work | home | third | named_place | none',
    speech: 'Korean sentence spoken by the NPC',
    steps: ['short action step 1', 'short action step 2'],
  }

  const system = [
    'You are the decision system for one autonomous NPC in a playable virtual city.',
    'The player can ask for realistic favors, guidance, transport, or conversation.',
    'Think about the NPC schedule, job, personality, safety, urgency, and available city actions.',
    'Return only strict JSON matching this schema:',
    JSON.stringify(schema),
    'Use Korean for speech. Keep steps concrete and executable in a 3D city simulation.',
    'If the player asks to be taken to the NPC workplace, use destination "work".',
    'If the trip is far or urgent, mode can be "taxi"; otherwise use "walk".',
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
    `Player request: ${request}`,
  ].join('\n')

  const text = await completeLocal({
    messages: [
      { role: 'system', content: system },
      { role: 'user', content: user },
    ],
    text: `${system}\n\n${user}`,
  }, { temperature: 0.42, maxTokens: 220 })

  const parsed = extractJson(text)
  const safe = fallbackActionPlan(agent, request, context)
  const plan = parsed || safe

  return {
    intent: typeof plan.intent === 'string' ? plan.intent : safe.intent,
    decision: ['accept', 'clarify', 'decline', 'answer'].includes(plan.decision) ? plan.decision : safe.decision,
    mode: ['walk', 'taxi', 'talk'].includes(plan.mode) ? plan.mode : safe.mode,
    destination: ['work', 'home', 'third', 'named_place', 'none'].includes(plan.destination) ? plan.destination : safe.destination,
    speech: typeof plan.speech === 'string' && plan.speech.trim() ? plan.speech.trim().slice(0, 220) : safe.speech,
    steps: Array.isArray(plan.steps) && plan.steps.length
      ? plan.steps.slice(0, 5).map(step => String(step).slice(0, 90))
      : safe.steps,
    source: parsed ? 'local-llm' : 'fallback',
  }
}

export function fallbackLine(agent) {
  const place = agent.placeName || 'this block'
  const lines = {
    banker: `오늘 ${place} 쪽 자금 흐름이 꽤 빠르게 움직이네요. 저는 회의 전에 시장 분위기를 보고 있어요.`,
    doctor: '병원은 계속 바쁘지만 아직 버틸 만해요. 출퇴근 시간만 지나면 조금 숨이 트입니다.',
    teacher: '수업 사이에 잠깐 이동 중이에요. 학생들이 오늘은 유난히 활발하네요.',
    courier: '길은 막히지만 시간표는 기다려주지 않죠. 다음 배송지로 움직이는 중이에요.',
    barista: '커피 주문이 잠깐 몰렸어요. 아침엔 모두가 조금씩 급해지니까요.',
    engineer: '센서 데이터로 보면 이 구역 보행량이 갑자기 늘었어요. 작은 이벤트가 생긴 것 같네요.',
    artist: '빛이 건물 유리에 닿는 각도가 좋아요. 오늘 전시 아이디어가 좀 떠오르네요.',
    security: '주변 흐름만 잘 지키면 괜찮습니다. 사람이 많아질 때가 문제죠.',
    student: '수업 끝나면 스터디로 갈 거예요. 지금은 잠깐 도시를 구경 중이에요.',
    shopkeeper: '상권이 곧 붐빌 시간이에요. 사람들 발걸음만 봐도 오늘 분위기가 보여요.',
    gardener: '바람이 조금 건조하네요. 공원 쪽 나무들에 오후 물주기가 필요하겠어요.',
    retiree: '매일 같은 길을 걸어도 다른 이야기가 들려요. 그게 이 도시의 좋은 점이죠.',
  }
  return lines[agent.role] || `저는 지금 ${place} 근처를 지나고 있어요. 오늘 RealCity는 평소보다 조금 빠르게 움직이네요.`
}
