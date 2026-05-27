import { useEffect, useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import { useCityStore } from '../engine/cityStore'

const SEND_INTERVAL = 0.72

function peerFromServer(player) {
  const pose = player.pose || {}
  return {
    id: player.id,
    name: player.name,
    color: player.color || '#4aadff',
    x: Number(pose.x || 0),
    y: Number(pose.y || 1),
    z: Number(pose.z || 0),
    heading: Number(pose.heading || 0),
    speed: Number(pose.speed || 0),
    district: pose.district || 'RealCity',
    status: player.status || 'exploring',
    updatedAt: player.updatedAt || 0,
  }
}

async function postPresence(multiplayer, player) {
  const response = await fetch('/api/multiplayer', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      roomId: multiplayer.roomId,
      playerId: multiplayer.playerId,
      name: multiplayer.name,
      color: multiplayer.color,
      status: player.indoors ? `inside ${player.placeName || 'a building'}` : `exploring ${player.district}`,
      pose: {
        x: player.x,
        y: player.y,
        z: player.z,
        heading: player.heading,
        speed: player.speed,
        district: player.district,
      },
    }),
  })
  if (!response.ok) throw new Error(`Multiplayer API ${response.status}`)
  return response.json()
}

function sendLeave(multiplayer) {
  if (!multiplayer?.playerId || !multiplayer?.roomId) return
  const body = JSON.stringify({
    action: 'leave',
    roomId: multiplayer.roomId,
    playerId: multiplayer.playerId,
  })
  try {
    const blob = new Blob([body], { type: 'application/json' })
    if (navigator.sendBeacon?.('/api/multiplayer', blob)) return
  } catch {
    // Fall through to fetch.
  }
  fetch('/api/multiplayer', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body,
    keepalive: true,
  }).catch(() => {})
}

function RemoteAvatar({ peer }) {
  const bodyColor = peer.color || '#4aadff'
  return (
    <group position={[peer.x, peer.y, peer.z]} rotation={[0, peer.heading, 0]}>
      <group position={[0, -0.9, 0]}>
        <mesh castShadow position={[0, 0.78, 0]}>
          <boxGeometry args={[0.38, 0.2, 0.25]} />
          <meshStandardMaterial color="#1c2541" roughness={0.8} />
        </mesh>
        <mesh castShadow position={[0, 1.2, 0]}>
          <capsuleGeometry args={[0.21, 0.52, 4, 10]} />
          <meshStandardMaterial color={bodyColor} roughness={0.72} />
        </mesh>
        <mesh castShadow position={[0, 1.27, 0.18]}>
          <boxGeometry args={[0.28, 0.34, 0.035]} />
          <meshStandardMaterial color="#e8f1f4" roughness={0.56} metalness={0.02} />
        </mesh>
        <mesh castShadow position={[0, 1.57, 0]}>
          <capsuleGeometry args={[0.075, 0.12, 4, 8]} />
          <meshStandardMaterial color="#d9a47f" roughness={0.66} />
        </mesh>
        <mesh castShadow position={[-0.12, 0.4, 0]}>
          <capsuleGeometry args={[0.065, 0.52, 4, 8]} />
          <meshStandardMaterial color="#17203a" roughness={0.84} />
        </mesh>
        <mesh castShadow position={[0.12, 0.4, 0]}>
          <capsuleGeometry args={[0.065, 0.52, 4, 8]} />
          <meshStandardMaterial color="#17203a" roughness={0.84} />
        </mesh>
        <mesh castShadow position={[-0.12, 0.07, 0.045]}>
          <boxGeometry args={[0.11, 0.06, 0.18]} />
          <meshStandardMaterial color="#0d1118" roughness={0.85} />
        </mesh>
        <mesh castShadow position={[0.12, 0.07, 0.045]}>
          <boxGeometry args={[0.11, 0.06, 0.18]} />
          <meshStandardMaterial color="#0d1118" roughness={0.85} />
        </mesh>
        <mesh castShadow position={[-0.28, 1.08, 0]}>
          <capsuleGeometry args={[0.055, 0.42, 4, 8]} />
          <meshStandardMaterial color="#d9a47f" roughness={0.68} />
        </mesh>
        <mesh castShadow position={[0.28, 1.08, 0]}>
          <capsuleGeometry args={[0.055, 0.42, 4, 8]} />
          <meshStandardMaterial color="#d9a47f" roughness={0.68} />
        </mesh>
        <mesh castShadow position={[0, 1.72, 0]}>
          <sphereGeometry args={[0.205, 18, 14]} />
          <meshStandardMaterial color="#efc29a" roughness={0.64} />
        </mesh>
        <mesh castShadow position={[-0.088, 1.745, 0.188]}>
          <sphereGeometry args={[0.024, 8, 6]} />
          <meshStandardMaterial color="#05070a" roughness={0.34} />
        </mesh>
        <mesh castShadow position={[0.088, 1.745, 0.188]}>
          <sphereGeometry args={[0.024, 8, 6]} />
          <meshStandardMaterial color="#05070a" roughness={0.34} />
        </mesh>
        <mesh castShadow position={[0, 1.88, -0.02]}>
          <sphereGeometry args={[0.205, 12, 8, 0, Math.PI * 2, 0, Math.PI * 0.55]} />
          <meshStandardMaterial color="#17100b" roughness={0.92} />
        </mesh>
        <mesh castShadow position={[0, 1.72, -0.145]}>
          <boxGeometry args={[0.34, 0.22, 0.08]} />
          <meshStandardMaterial color="#17100b" roughness={0.92} />
        </mesh>
      </group>
    </group>
  )
}

export default function MultiplayerPresence() {
  const enabled = useCityStore(state => state.multiplayer.enabled)
  const peers = useCityStore(state => state.multiplayer.peers)
  const elapsed = useRef(0)
  const inflight = useRef(false)
  const lastIdentity = useRef(null)
  const wasEnabled = useRef(false)

  useEffect(() => {
    if (!enabled && wasEnabled.current) sendLeave(lastIdentity.current)
    wasEnabled.current = enabled
  }, [enabled])

  useEffect(() => () => sendLeave(lastIdentity.current), [])

  useEffect(() => {
    if (typeof window === 'undefined') return
    window.__REALCITY_MULTIPLAYER__ = {
      enabled,
      roomId: useCityStore.getState().multiplayer.roomId,
      peerCount: peers.length,
      peers: peers.map(peer => ({ id: peer.id, name: peer.name, district: peer.district })),
    }
  }, [enabled, peers])

  useFrame((_, delta) => {
    if (!enabled || inflight.current || typeof fetch === 'undefined') return
    elapsed.current += delta
    if (elapsed.current < SEND_INTERVAL) return
    elapsed.current = 0

    const state = useCityStore.getState()
    const multiplayer = state.multiplayer
    lastIdentity.current = multiplayer
    inflight.current = true
    postPresence(multiplayer, state.player)
      .then(data => {
        if (!data?.ok) throw new Error(data?.error || 'Multiplayer update failed')
        useCityStore.getState().setMultiplayerPresence({
          status: 'online',
          lastError: null,
          serverTime: data.serverTime,
          playerCount: data.playerCount,
          peers: (data.peers || []).map(peerFromServer),
        })
      })
      .catch(error => {
        useCityStore.getState().setMultiplayerPresence({
          status: 'offline',
          lastError: error instanceof Error ? error.message : String(error),
        })
      })
      .finally(() => {
        inflight.current = false
      })
  })

  if (!enabled || peers.length === 0) return null
  return peers.slice(0, 24).map(peer => <RemoteAvatar key={peer.id} peer={peer} />)
}
