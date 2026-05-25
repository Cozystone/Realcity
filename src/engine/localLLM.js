const provider = import.meta.env.VITE_LOCAL_LLM_PROVIDER || 'ollama'
const endpoint = import.meta.env.VITE_LOCAL_LLM_ENDPOINT || '/ollama/api/generate'
const model = import.meta.env.VITE_LOCAL_LLM_MODEL || 'llama3.2'

export function llmStatus() {
  return `${provider}:${model}`
}

export async function askLocalNPC(agent, context) {
  if (typeof window === 'undefined') return null
  if (window.location.hostname.endsWith('.vercel.app') && endpoint.startsWith('/ollama')) return null

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

  try {
    const controller = new AbortController()
    const timeout = window.setTimeout(() => controller.abort(), 8500)
    const body = provider === 'openai-compatible'
      ? {
          model,
          messages: [
            { role: 'system', content: system },
            { role: 'user', content: user },
          ],
          temperature: 0.85,
          max_tokens: 90,
        }
      : {
          model,
          prompt: `${system}\n\n${user}`,
          stream: false,
          options: { temperature: 0.85, num_predict: 90 },
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

export function fallbackLine(agent) {
  const place = agent.placeName || 'this block'
  const lines = {
    banker: `오늘 ${place} 쪽 자금 흐름이 이상하게 빠릅니다. 다들 회의실보다 도로를 더 보고 있어요.`,
    doctor: `병원은 계속 바쁘지만 아직 버틸 만해요. 출퇴근 시간만 지나면 조금 숨이 트입니다.`,
    teacher: `아이들은 벌써 하루의 절반을 끝낸 얼굴이에요. 저는 ${place} 근처로 이동 중입니다.`,
    courier: `길은 막히지만 시간표는 기다려주지 않죠. 저는 다음 배송지로 움직여야 해요.`,
    barista: `커피 주문이 도시의 맥박 같아요. 아침엔 모두가 조금 더 솔직해집니다.`,
    engineer: `센서 데이터로 보면 이 구역 보행량이 갑자기 늘었어요. 뭔가 작은 이벤트가 생긴 것 같네요.`,
    artist: `빛이 건물 유리에 닿는 각도가 좋아요. 이 도시는 계속 다른 얼굴을 보여줘요.`,
    security: `역 주변은 흐름만 지키면 괜찮습니다. 멈추는 사람이 많아지면 문제가 생겨요.`,
    student: `수업 끝나면 네온 스퀘어로 갈 거예요. 지금은 그냥 도시 구경 중이에요.`,
    shopkeeper: `저녁 장사가 곧 시작됩니다. 사람들 발걸음만 봐도 오늘 매출이 보여요.`,
    gardener: `바람이 조금 건조하네요. 공원 쪽 나무들은 오후에 물이 더 필요하겠습니다.`,
    retiree: `매일 같은 길을 걸어도 다른 이야기가 들려요. 그게 이 도시의 좋은 점입니다.`,
  }
  return lines[agent.role] || `저는 ${place}에 가는 중입니다. 오늘 RealCity는 평소보다 조금 빠르게 움직이네요.`
}
