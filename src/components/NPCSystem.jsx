import { useRef, useMemo, useEffect, useState } from 'react'
import { useFrame } from '@react-three/fiber'
import * as THREE from 'three'
import { getTerrainHeight } from '../utils/noise'
import { CITY_DATA } from '../utils/cityGenerator'

const INTERACT_DIST = 6

async function askOllama(prompt, model = 'llama3.2') {
  try {
    const res = await fetch('/ollama/api/generate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model,
        prompt,
        stream: false,
        options: { num_predict: 80, temperature: 0.85 },
      }),
      signal: AbortSignal.timeout(8000),
    })
    if (!res.ok) throw new Error()
    const data = await res.json()
    return data.response?.trim() || null
  } catch {
    return null
  }
}

const SCRIPTED = {
  banker:     ['시장이 요즘 불안정하네요. 투자는 신중하게 하세요.', '오늘 미팅이 세 개나 있어서 정신없어요.', '이 근처 카페 커피가 진짜 맛있어요.'],
  lawyer:     ['서류 검토할 게 산더미 같아요.', '법적으로 도움이 필요하면 언제든지요.', '오늘 재판이 있어서 긴장되네요.'],
  executive:  ['글로벌 파트너십 미팅 준비 중이에요.', '이 도시는 기회로 가득 차 있어요.', '우리 팀은 최고예요!'],
  barista:    ['오늘의 스페셜은 에스프레소 토닉이에요!', '커피 한 잔 하실래요?', '단골 손님들이 정말 좋아요.'],
  teacher:    ['학생들이 오늘 집중을 잘 했어요.', '교육이 세상을 바꾼다고 믿어요.', '방과 후 수업 준비가 남아있네요.'],
  doctor:     ['건강이 최우선이에요! 운동 꾸준히 하세요.', '오늘도 바쁜 하루였어요.', '잠깐 산책 중이에요.'],
  engineer:   ['새 프로젝트 설계도를 검토 중이에요.', '코드 리뷰하다 머리 식히려고 나왔어요.', '이 도시 인프라 개선할 부분이 보여요.'],
  shopkeeper: ['어서 오세요! 오늘 할인 중이에요.', '장사가 오늘 잘 되네요!', '이 가게 연 지 10년 됐어요.'],
  student:    ['기말고사가 다음 주인데...', '카페인 없이는 못 살아요.', '졸업 후 뭘 할지 고민 중이에요.'],
  artist:     ['이 도시의 빛과 그림자가 아름다워요.', '새 전시회 준비 중이에요.', '영감은 항상 길거리에서 와요.'],
  jogger:     ['매일 5km 달리고 있어요!', '이 코스 경치가 정말 좋아요.', '건강한 몸에 건강한 마음이죠!'],
  parent:     ['애들 학교 마치면 데리러 가야 해요.', '육아가 힘들지만 정말 행복해요.', '잠깐 혼자 산책하는 시간이 소중해요.'],
  retiree:    ['은퇴하고 나서 이 동네가 정말 좋아요.', '젊었을 때 더 즐길걸 그랬어요.', '손자들이 얼마나 귀여운지 몰라요.'],
  default:    ['안녕하세요! 좋은 하루 보내고 계세요?', '날씨 참 좋네요!', '이 도시 정말 활기차죠?'],
}

function getLine(role) {
  const lines = SCRIPTED[role] || SCRIPTED.default
  return lines[Math.floor(Math.random() * lines.length)]
}

class NPCAgent {
  constructor(d) {
    this.id = d.id
    this.role = d.role
    this.personality = d.personality
    this.pos = new THREE.Vector3(d.x, d.y + 0.9, d.z)
    this.heading = Math.random() * Math.PI * 2
    this.state = 'idle'
    this.timer = Math.random() * 5
    this.talkCooldown = 0
  }

  update(delta) {
    this.timer -= delta
    this.talkCooldown -= delta

    if (this.state === 'idle' && this.timer <= 0) {
      this.state = 'walking'
      this.heading += (Math.random() - 0.5) * 2.2
      this.timer = 3 + Math.random() * 7
    } else if (this.state === 'walking') {
      const nx = this.pos.x + Math.sin(this.heading) * 1.2 * delta
      const nz = this.pos.z + Math.cos(this.heading) * 1.2 * delta
      if (Math.abs(nx) < 900 && Math.abs(nz) < 900) {
        const h = getTerrainHeight(nx, nz)
        this.pos.set(nx, h + 0.9, nz)
      } else {
        this.heading += Math.PI
      }
      if (this.timer <= 0) {
        this.state = 'idle'
        this.timer = 2 + Math.random() * 4
      }
    } else if (this.state === 'talking' && this.timer <= 0) {
      this.state = 'idle'
      this.timer = 2
    }
  }
}

export default function NPCSystem() {
  const agents = useMemo(
    () => CITY_DATA.npcs.slice(0, 120).map(d => new NPCAgent(d)),
    []
  )

  const bodyRef = useRef()
  const headRef = useRef()
  const dummy = useMemo(() => new THREE.Object3D(), [])
  const camPos = useRef(new THREE.Vector3())

  useFrame((state, delta) => {
    if (!bodyRef.current || !headRef.current) return
    camPos.current.copy(state.camera.position)

    agents.forEach((agent, i) => {
      agent.update(delta)

      dummy.position.copy(agent.pos)
      dummy.rotation.y = agent.heading
      dummy.scale.set(0.22, 0.55, 0.22)
      dummy.updateMatrix()
      bodyRef.current.setMatrixAt(i, dummy.matrix)

      dummy.position.set(agent.pos.x, agent.pos.y + 0.72, agent.pos.z)
      dummy.scale.set(0.24, 0.24, 0.24)
      dummy.updateMatrix()
      headRef.current.setMatrixAt(i, dummy.matrix)
    })

    bodyRef.current.instanceMatrix.needsUpdate = true
    headRef.current.instanceMatrix.needsUpdate = true
  })

  useEffect(() => {
    let busy = false
    const onKey = async (e) => {
      if (e.code !== 'KeyE' || busy) return
      busy = true
      setTimeout(() => { busy = false }, 5000)

      const pp = camPos.current.clone()
      pp.y -= 5

      let best = null, bestDist = Infinity
      for (const a of agents) {
        const d = a.pos.distanceTo(pp)
        if (d < bestDist) { best = a; bestDist = d }
      }

      if (!best || bestDist > INTERACT_DIST) { busy = false; return }

      best.state = 'talking'
      best.timer = 8

      if (window.__showNPCMessage) {
        window.__showNPCMessage({ role: best.role, text: '...' })
      }

      const prompt = `You are an NPC in a realistic Korean city. Your role: ${best.role}. Personality: ${best.personality}. A player walks up to you. Reply naturally in Korean in 1-2 sentences. Stay in character as a ${best.role}.`

      const reply = (await askOllama(prompt)) || getLine(best.role)

      if (window.__showNPCMessage) {
        window.__showNPCMessage({ role: best.role, text: reply })
      }
    }

    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [agents])

  const n = agents.length
  if (!n) return null

  return (
    <>
      <instancedMesh ref={bodyRef} args={[null, null, n]} castShadow frustumCulled={false}>
        <capsuleGeometry args={[1, 2, 3, 6]} />
        <meshStandardMaterial color="#445566" roughness={0.8} />
      </instancedMesh>
      <instancedMesh ref={headRef} args={[null, null, n]} castShadow frustumCulled={false}>
        <sphereGeometry args={[1, 8, 8]} />
        <meshStandardMaterial color="#f0c090" roughness={0.7} />
      </instancedMesh>
    </>
  )
}
