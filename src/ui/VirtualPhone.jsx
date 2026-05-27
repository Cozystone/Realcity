import { useEffect, useMemo, useRef, useState } from 'react'
import { clockLabel, useCityStore } from '../engine/cityStore'
import { styleNpcSpeech } from '../engine/localLLM'

const PHONE_TABS = [
  { id: 'messages', label: 'Msg' },
  { id: 'contacts', label: 'People' },
  { id: 'social', label: 'Feed' },
  { id: 'taxi', label: 'Taxi' },
  { id: 'music', label: 'Music' },
]

const TRACKS = [
  { id: 'han-river-fm', title: 'Han River FM', mood: 'clear morning synth', notes: [196, 246.94, 293.66] },
  { id: 'night-market', title: 'Night Market Lo-Fi', mood: 'soft street bass', notes: [174.61, 220, 261.63] },
  { id: 'taxi-dispatch', title: 'Taxi Dispatch', mood: 'late ride pulse', notes: [130.81, 196, 261.63] },
]

function hashString(value) {
  let hash = 0
  for (let i = 0; i < value.length; i += 1) {
    hash = (hash * 31 + value.charCodeAt(i)) >>> 0
  }
  return hash
}

function relationFor(npc) {
  const score = 44 + (hashString(npc.id || npc.name) % 55)
  if (score > 86) return { label: 'Close contact', score }
  if (score > 70) return { label: 'Friend', score }
  if (score > 58) return { label: 'SNS mutual', score }
  return { label: 'Known face', score }
}

function contactFromNpc(npc, city, focusedAgent, player) {
  const work = city.landmarks.find(place => place.id === npc.workId)
  const third = city.landmarks.find(place => place.id === npc.thirdId)
  const active = focusedAgent?.id === npc.id ? focusedAgent : null
  const relation = relationFor(npc)
  const x = active?.x ?? npc.home?.x ?? 0
  const z = active?.z ?? npc.home?.z ?? 0
  const distance = Math.hypot(x - player.x, z - player.z)

  return {
    id: npc.id,
    name: npc.name,
    age: npc.age,
    gender: npc.gender,
    job: npc.job,
    role: npc.role,
    personality: npc.personality,
    speechStyle: npc.speechStyle,
    voice: npc.voice,
    gestureStyle: npc.gestureStyle,
    personaSignature: npc.personaSignature,
    appearance: npc.appearance,
    styleBrief: npc.styleBrief,
    activity: active?.activity || 'following schedule',
    placeName: active?.placeName || work?.name || third?.name || npc.home?.name || 'RealCity',
    workId: npc.workId,
    workName: work?.name,
    workAddress: work?.address,
    thirdId: npc.thirdId,
    thirdName: third?.name,
    thirdAddress: third?.address,
    relation: relation.label,
    affinity: relation.score,
    distance,
    online: active || relation.score > 64,
  }
}

function buildContacts(city, focusedAgent, player) {
  const base = city.npcs
    .map(npc => contactFromNpc(npc, city, focusedAgent, player))
    .sort((a, b) => {
      if (focusedAgent?.id === a.id) return -1
      if (focusedAgent?.id === b.id) return 1
      return b.affinity - a.affinity
    })

  return base.slice(0, 10)
}

function buildRouteTargets(city, player) {
  const landmarks = (city.landmarks || [])
    .filter(place => place.address)
    .slice(0, 6)
  const nearbyAddresses = [...(city.addressBook || [])]
    .sort((a, b) => Math.hypot(a.x - player.x, a.z - player.z) - Math.hypot(b.x - player.x, b.z - player.z))
    .slice(0, 8)

  return [...landmarks, ...nearbyAddresses].map(target => ({
    id: target.id,
    name: target.name,
    address: target.address,
    roadName: target.roadName,
    kind: target.kind,
    distance: Math.hypot(target.x - player.x, target.z - player.z),
  }))
}

function cleanSeedThread(contact) {
  return [
    {
      from: 'them',
      text: styleNpcSpeech(phoneAgent(contact), `${contact.placeName}${contact.workAddress ? `, ${contact.workAddress}` : ''} 근처에 있어요. 길 안내나 약속이 필요하면 메시지 주세요.`),
    },
  ]
}

function cleanReplyFor(contact, text, player, timeMinutes) {
  const messageText = text.toLowerCase()
  const npc = phoneAgent(contact)
  if (/taxi|cab|ride|drive/.test(messageText)) {
    return styleNpcSpeech(npc, 'RealPhone Taxi 앱에서 목적지를 고르면 가장 가까운 운행 택시가 직접 길가로 옵니다. 사람에게 대신 부탁하는 방식은 아니에요.')
  }
  if (/escort|guide|take|bring|walk|workplace|office|meet/.test(messageText)) {
    return styleNpcSpeech(npc, `${contact.placeName}에서 출발하는 동선을 확인해볼게요. 걸을지 택시를 탈지는 거리와 도로 상황을 보고 정하면 됩니다.`)
  }
  if (/where|location|busy|doing|now/.test(messageText)) {
    return styleNpcSpeech(npc, `지금은 ${contact.placeName} 근처에서 ${contact.activity} 중이에요. 현재 시각은 ${clockLabel(timeMinutes)}입니다.`)
  }
  if (/music|song|radio/.test(messageText)) {
    return styleNpcSpeech(npc, '밤길이면 Night Market Lo-Fi가 잘 맞아요. 도시 소리랑 섞이면 꽤 자연스럽습니다.')
  }
  if (player.indoors) {
    return styleNpcSpeech(npc, `지금 ${player.placeName} 안에 계시군요. 필요하면 입구 근처에서 만나겠습니다.`)
  }
  return styleNpcSpeech(npc, `메시지 봤어요. ${contact.relation.toLowerCase()} 연락처니까 위치와 상황을 계속 확인하고 있을게요.`)
}

function cleanCallText(contact) {
  return styleNpcSpeech(phoneAgent(contact), `전화 받았어요. 지금은 ${contact.placeName} 근처에서 ${contact.activity} 중입니다.`)
}

function seedThread(contact) {
  return cleanSeedThread(contact)
}

function replyFor(contact, text, player, timeMinutes) {
  return cleanReplyFor(contact, text, player, timeMinutes)
}

function phoneAgent(contact) {
  return {
    id: contact.id,
    name: contact.name,
    age: contact.age,
    gender: contact.gender,
    job: contact.job,
    role: contact.role,
    personality: contact.personality,
    speechStyle: contact.speechStyle,
    voice: contact.voice,
    gestureStyle: contact.gestureStyle,
    personaSignature: contact.personaSignature,
    appearance: contact.appearance,
    styleBrief: contact.styleBrief,
    activity: contact.activity,
    placeName: contact.placeName,
    workId: contact.workId,
    workName: contact.workName,
    workAddress: contact.workAddress,
    thirdId: contact.thirdId,
    thirdName: contact.thirdName,
    thirdAddress: contact.thirdAddress,
  }
}

function isActionRequest(text) {
  return /taxi|ride|drive|escort|guide|take|bring|walk|workplace|office|meet|station|hospital|school|depot|park|cafe|market|square/i.test(text)
}

function stopAudio(audio) {
  if (!audio) return
  for (const osc of audio.oscillators) {
    try {
      osc.stop()
    } catch {
      // The oscillator may already be stopped by a previous click.
    }
  }
  audio.ctx.close?.()
}

export default function VirtualPhone({ city, player, focusedAgent, timeMinutes }) {
  const [open, setOpen] = useState(false)
  const [tab, setTab] = useState('messages')
  const [selectedId, setSelectedId] = useState('')
  const [draft, setDraft] = useState('')
  const [threads, setThreads] = useState({})
  const [trackIndex, setTrackIndex] = useState(0)
  const [musicPlaying, setMusicPlaying] = useState(false)
  const audioRef = useRef(null)
  const cityEvents = useCityStore(state => state.cityEvents)

  const contacts = useMemo(
    () => buildContacts(city, focusedAgent, player),
    [city, focusedAgent, player.x, player.z],
  )
  const routeTargets = useMemo(
    () => buildRouteTargets(city, player),
    [city, player.x, player.z],
  )
  const selected = contacts.find(contact => contact.id === selectedId) || contacts[0]
  const thread = selected ? (threads[selected.id] || seedThread(selected)) : []

  useEffect(() => {
    if (!selectedId && contacts[0]) setSelectedId(contacts[0].id)
  }, [contacts, selectedId])

  useEffect(() => () => stopAudio(audioRef.current), [])

  useEffect(() => {
    const openPhone = (event) => {
      setOpen(true)
      if (event.detail?.tab) setTab(event.detail.tab)
    }
    window.addEventListener('realcity:open-phone', openPhone)
    return () => window.removeEventListener('realcity:open-phone', openPhone)
  }, [])

  const appendThread = (contact, items) => {
    setThreads(prev => ({
      ...prev,
      [contact.id]: [...(prev[contact.id] || seedThread(contact)), ...items],
    }))
  }

  const sendMessage = (event) => {
    event.preventDefault()
    if (!selected || !draft.trim()) return
    const text = draft.trim()
    const reply = replyFor(selected, text, player, timeMinutes)
    appendThread(selected, [
      { from: 'me', text },
      { from: 'them', text: reply },
    ])
    setDraft('')

    const store = useCityStore.getState()
    store.setPulse(`Phone message sent to ${selected.name}.`)
    store.showDialogue({ speaker: selected.name, role: selected.job, text: reply, agent: phoneAgent(selected) })

    if (isActionRequest(text)) {
      window.dispatchEvent(new CustomEvent('realcity:npc-request', {
        detail: { agentId: selected.id, text },
      }))
    }
  }

  const requestDirectTaxiToTarget = (target) => {
    if (!target) return
    const label = target.address || target.name
    useCityStore.getState().setPulse(`RealPhone Taxi requested the nearest passing cab to ${label}.`)
    window.dispatchEvent(new CustomEvent('realcity:player-taxi-request', {
      detail: { target },
    }))
  }

  const callContact = (contact = selected) => {
    if (!contact) return
    const directText = cleanCallText(contact)
    appendThread(contact, [{ from: 'system', text: `Call connected with ${contact.name}.` }])
    useCityStore.getState().showDialogue({ speaker: contact.name, role: contact.job, text: directText, agent: phoneAgent(contact) })
    useCityStore.getState().setPulse(`Calling ${contact.name} through RealPhone.`)
    return
  }

  const toggleMusic = (index = trackIndex) => {
    const nextPlaying = index !== trackIndex || !musicPlaying
    stopAudio(audioRef.current)
    audioRef.current = null
    setTrackIndex(index)
    setMusicPlaying(nextPlaying)

    if (!nextPlaying) {
      useCityStore.getState().setPulse('RealPhone music paused.')
      return
    }

    const Ctx = window.AudioContext || window.webkitAudioContext
    if (Ctx) {
      const ctx = new Ctx()
      const master = ctx.createGain()
      master.gain.value = 0.018
      master.connect(ctx.destination)
      const oscillators = TRACKS[index].notes.map((frequency, i) => {
        const osc = ctx.createOscillator()
        const gain = ctx.createGain()
        osc.type = i === 0 ? 'sine' : 'triangle'
        osc.frequency.value = frequency
        gain.gain.value = i === 0 ? 0.72 : 0.24
        osc.connect(gain)
        gain.connect(master)
        osc.start()
        return osc
      })
      audioRef.current = { ctx, oscillators }
    }

    useCityStore.getState().setPulse(`Now playing ${TRACKS[index].title}.`)
  }

  if (!open) {
    return (
      <div className="phone-shell">
        <button type="button" className="phone-toggle" onClick={() => setOpen(true)} aria-label="Open RealPhone">
          <span />
          <strong>Phone</strong>
        </button>
      </div>
    )
  }

  return (
    <div className="phone-shell open" onKeyDown={event => event.stopPropagation()}>
      <section className="phone-device" aria-label="RealPhone">
        <div className="phone-side-button" />
        <div className="phone-screen">
          <header className="phone-status">
            <span>{clockLabel(timeMinutes)}</span>
            <i />
            <span>RC 5G 82%</span>
          </header>
          <div className="phone-header">
            <div>
              <p>RealPhone</p>
              <h2>{PHONE_TABS.find(item => item.id === tab)?.label}</h2>
            </div>
            <button type="button" className="phone-close" onClick={() => setOpen(false)} aria-label="Close RealPhone">x</button>
          </div>

          <nav className="phone-tabs" aria-label="RealPhone apps">
            {PHONE_TABS.map(item => (
              <button
                key={item.id}
                type="button"
                data-tab={item.id}
                className={tab === item.id ? 'active' : ''}
                onClick={() => setTab(item.id)}
              >
                {item.label}
              </button>
            ))}
          </nav>

          {tab === 'messages' && selected ? (
            <div className="phone-app">
              <div className="phone-contact-strip">
                {contacts.slice(0, 5).map(contact => (
                  <button
                    type="button"
                    key={contact.id}
                    className={contact.id === selected.id ? 'active' : ''}
                    onClick={() => setSelectedId(contact.id)}
                  >
                    <span>{contact.name.slice(0, 1)}</span>
                    <strong>{contact.name.split(' ')[0]}</strong>
                  </button>
                ))}
              </div>
              <div className="phone-thread">
                <div className="phone-thread-title">
                  <strong>{selected.name}</strong>
                  <span>{selected.relation} / {selected.online ? 'online' : 'later'}</span>
                </div>
                <div className="phone-bubbles">
                  {thread.slice(-5).map((message, index) => (
                    <p key={`${message.from}-${index}`} className={message.from}>
                      {message.text}
                    </p>
                  ))}
                </div>
              </div>
              <form className="phone-message-form" onSubmit={sendMessage}>
                <input
                  value={draft}
                  onChange={event => setDraft(event.target.value)}
                  placeholder="Message, call, or ask for a route"
                  aria-label="Message contact"
                />
                <button type="submit" disabled={!draft.trim()}>Send</button>
              </form>
            </div>
          ) : null}

          {tab === 'contacts' ? (
            <div className="phone-app phone-list">
              {contacts.map(contact => (
                <article key={contact.id} className={contact.id === selected?.id ? 'active' : ''}>
                  <button type="button" onClick={() => { setSelectedId(contact.id); setTab('messages') }}>
                    <span>{contact.name.slice(0, 1)}</span>
                    <div>
                      <strong>{contact.name}</strong>
                  <small>{contact.job} / {contact.workAddress || contact.relation}</small>
                    </div>
                  </button>
                  <button type="button" onClick={() => callContact(contact)}>Call</button>
                </article>
              ))}
            </div>
          ) : null}

          {tab === 'social' ? (
            <div className="phone-app phone-feed">
              <section className="phone-city-events" aria-label="Live city events">
                <strong>Live city</strong>
                {!(cityEvents || []).length ? (
                  <article>
                    <small>{clockLabel(timeMinutes)} / listening</small>
                    <p>Waiting for city memories and NPC routines to surface.</p>
                  </article>
                ) : null}
                {(cityEvents || []).slice(0, 4).map(event => (
                  <article key={event.id} className={`event-${event.kind}`}>
                    <small>{clockLabel(event.timeMinutes || timeMinutes)} / {event.kind}</small>
                    <p>{event.text}</p>
                    {event.topic || event.partnerName ? (
                      <footer>{[event.topic, event.partnerName ? `with ${event.partnerName}` : null].filter(Boolean).join(' / ')}</footer>
                    ) : null}
                  </article>
                ))}
              </section>
              {contacts.slice(0, 6).map(contact => (
                <article key={contact.id}>
                  <div>
                    <span>{contact.name.slice(0, 1)}</span>
                    <strong>{contact.name}</strong>
                  <small>{contact.workAddress || contact.placeName}</small>
                  </div>
                  <p>{contact.personality} / {contact.speechStyle?.label || 'natural'}. Today I am {contact.activity} around {contact.placeName}.</p>
                  <footer>{contact.affinity} trust / {Math.round(contact.distance)}m memory distance</footer>
                </article>
              ))}
            </div>
          ) : null}

          {tab === 'taxi' ? (
            <div className="phone-app phone-taxi">
              <div className="phone-taxi-summary">
                <strong>RealCity Taxi</strong>
                <small>Dispatches a cruising cab directly to your curb / no NPC relay</small>
              </div>
              <div className="phone-route-list">
                {routeTargets.map(target => (
                  <button
                    key={`direct-${target.id}`}
                    type="button"
                    onClick={() => requestDirectTaxiToTarget(target)}
                  >
                    <strong>{target.address || target.name}</strong>
                    <span>Direct cab dispatch / {Math.round(target.distance)}m / press F to board</span>
                  </button>
                ))}
              </div>
            </div>
          ) : null}

          {tab === 'music' ? (
            <div className="phone-app phone-music">
              <div className="phone-now-playing">
                <span>{musicPlaying ? 'Playing' : 'Paused'}</span>
                <strong>{TRACKS[trackIndex].title}</strong>
                <small>{TRACKS[trackIndex].mood}</small>
              </div>
              <div className="phone-track-list">
                {TRACKS.map((track, index) => (
                  <button
                    key={track.id}
                    type="button"
                    className={index === trackIndex ? 'active' : ''}
                    onClick={() => toggleMusic(index)}
                  >
                    <strong>{track.title}</strong>
                    <span>{track.mood}</span>
                  </button>
                ))}
              </div>
              <button type="button" className="phone-play" onClick={() => toggleMusic(trackIndex)}>
                {musicPlaying ? 'Pause' : 'Play'}
              </button>
            </div>
          ) : null}

          <div className="phone-home-indicator" />
        </div>
      </section>
    </div>
  )
}
