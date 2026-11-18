import type { Dataset, Hub, Match, MatchMember, Player } from './domain'
import { getSupabaseClient } from './supabase'

interface ApiHub {
  id: string
  name: string
  location: string
  isActive: boolean
  createdAt: string
}

interface ApiPlayer {
  id: string
  hubId: string
  displayName: string
  avatarUrl: string | null
  currentMMR: number
  isActive: boolean
  createdAt: string
  updatedAt: string
}

interface ApiMatchMember {
  id: string
  playerId: string
  displayName: string
  teamNumber: 1 | 2
  mmrBefore: number | null
  mmrChange: number | null
  mmrAfter: number | null
}

interface ApiMatch {
  id: string
  hubId: string
  playedAt: string
  team1Score: number
  team2Score: number
  winningTeamNumber: 1 | 2 | null
  status: 1 | 2 | 3 | 'Scheduled' | 'Completed' | 'Cancelled'
  youtubeVideoId: string | null
  createdAt: string
  updatedAt: string
  members: ApiMatchMember[]
}

interface ApiPage<T> {
  items: T[]
  page: number
  pageSize: number
  totalCount: number
}

const apiBase = (import.meta.env.VITE_API_BASE_URL || '/api/v1').replace(/\/$/, '')

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const { data: { session }, error: sessionError } = await getSupabaseClient().auth.getSession()
  if (sessionError) throw sessionError
  if (!session) throw new Error('Your session has expired. Sign in again to continue.')

  const headers = new Headers(init?.headers)
  if (init?.body && !headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json')
  }
  headers.set('Authorization', `Bearer ${session.access_token}`)

  const response = await fetch(`${apiBase}${path}`, {
    ...init,
    headers,
  })

  const contentType = response.headers.get('content-type') ?? ''
  const isJson = contentType.includes('json')
  const payload: unknown = isJson ? await response.json() : await response.text()

  if (!response.ok) {
    const message = apiError(payload)
    if (message) throw new Error(message)
    if (typeof payload === 'string' && /<html|<!doctype/i.test(payload)) {
      throw new Error(
        `The API returned an HTML error page (${response.status}). Check the local API proxy configuration.`,
      )
    }
    throw new Error(`API request failed (${response.status}).`)
  }

  if (!isJson || !isRecord(payload) || !('data' in payload)) {
    throw new Error('The API returned an unexpected response. Check the API URL.')
  }
  return payload.data as T
}

export async function fetchAdminDataset(): Promise<Dataset> {
  const apiHubs = await request<ApiHub[]>('/hubs')
  const hubData = await Promise.all(apiHubs.map(async (hub) => {
    const [players, matches] = await Promise.all([
      request<ApiPlayer[]>(`/hubs/${hub.id}/players`),
      fetchAllMatches(hub.id),
    ])
    return { hub, players, matches }
  }))

  const apiMatches = hubData.flatMap((item) => item.matches)
  const knownPlayerIds = new Set(hubData.flatMap((item) => item.players.map((player) => player.id)))
  const historicalPlayerIds = [...new Set(
    apiMatches.flatMap((match) => match.members.map((member) => member.playerId)),
  )].filter((playerId) => !knownPlayerIds.has(playerId))
  const historicalPlayers = await Promise.all(
    historicalPlayerIds.map((playerId) => request<ApiPlayer>(`/players/${playerId}`)),
  )
  const initialRatings = new Map<string, { playedAt: string; mmr: number }>()
  for (const match of apiMatches) {
    if (match.status !== 2 && match.status !== 'Completed') continue
    for (const member of match.members) {
      if (member.mmrBefore === null) continue
      const current = initialRatings.get(member.playerId)
      if (!current || match.playedAt < current.playedAt) {
        initialRatings.set(member.playerId, { playedAt: match.playedAt, mmr: member.mmrBefore })
      }
    }
  }

  const hubs: Hub[] = hubData.map(({ hub }) => ({
    id: hub.id,
    name: hub.name,
    location: hub.location,
    isActive: hub.isActive,
    createdAt: hub.createdAt,
  }))
  const players: Player[] = [...hubData.flatMap(({ players }) => players), ...historicalPlayers].map((player) => ({
    id: player.id,
    hubId: player.hubId,
    displayName: player.displayName,
    avatarUrl: player.avatarUrl,
    isActive: player.isActive,
    initialMMR: initialRatings.get(player.id)?.mmr ?? player.currentMMR,
    currentMMR: player.currentMMR,
    createdAt: player.createdAt,
    updatedAt: player.updatedAt,
  }))
  const matches: Match[] = apiMatches.map(mapMatch)

  return { version: 1, hubs, players, matches }
}

export function createHub(name: string, location: string) {
  return request<ApiHub>('/hubs', {
    method: 'POST',
    body: JSON.stringify({ name, location }),
  })
}

export function getYouTubeVideoId(value: string) {
  const input = value.trim()
  if (!input) return null
  const match = input.match(
    /(?:youtu\.be\/|youtube\.com\/(?:watch\?.*v=|embed\/|shorts\/))([\w-]{11})/,
  )
  const videoId = match?.[1] ?? input
  return /^[\w-]{11}$/.test(videoId) ? videoId : null
}

export function createPlayer(hubId: string, displayName: string, avatarUrl: string | null) {
  return request<ApiPlayer>(`/hubs/${hubId}/players`, {
    method: 'POST',
    body: JSON.stringify({ displayName, avatarUrl }),
  })
}

export function updatePlayer(playerId: string, displayName: string, avatarUrl: string | null, isActive: boolean) {
  return request<ApiPlayer>(`/players/${playerId}`, {
    method: 'PUT',
    body: JSON.stringify({ displayName, avatarUrl, isActive }),
  })
}

export function createMatch(
  hubId: string,
  match: {
    playedAt: string
    team1Score: number
    team2Score: number
    members: { playerId: string; teamNumber: 1 | 2 }[]
    youtubeVideoId: string | null
  },
) {
  return request<ApiMatch>(`/hubs/${hubId}/matches`, {
    method: 'POST',
    body: JSON.stringify(match),
  })
}

export function completeMatch(matchId: string, winningTeamNumber: 1 | 2) {
  return request<ApiMatch>(`/matches/${matchId}/complete`, {
    method: 'POST',
    body: JSON.stringify({ winningTeamNumber }),
  })
}

export function cancelMatch(matchId: string) {
  return request<ApiMatch>(`/matches/${matchId}/cancel`, { method: 'POST' })
}

async function fetchAllMatches(hubId: string) {
  const pageSize = 100
  const firstPage = await request<ApiPage<ApiMatch>>(
    `/hubs/${hubId}/matches?page=1&pageSize=${pageSize}`,
  )
  const pages = Math.ceil(firstPage.totalCount / pageSize)
  if (pages <= 1) return firstPage.items

  const rest = await Promise.all(
    Array.from({ length: pages - 1 }, (_, index) =>
      request<ApiPage<ApiMatch>>(
        `/hubs/${hubId}/matches?page=${index + 2}&pageSize=${pageSize}`,
      ),
    ),
  )
  return [firstPage.items, ...rest.map((page) => page.items)].flat()
}

function mapMatch(match: ApiMatch): Match {
  const status = matchStatus(match.status)
  const members: MatchMember[] = match.members.map((member) => ({
    id: member.id,
    playerId: member.playerId,
    displayName: member.displayName,
    teamNumber: member.teamNumber,
    mmrBefore: member.mmrBefore,
    mmrChange: member.mmrChange,
    mmrAfter: member.mmrAfter,
  }))

  return {
    id: match.id,
    hubId: match.hubId,
    playedAt: match.playedAt,
    team1Score: match.team1Score,
    team2Score: match.team2Score,
    winningTeamNumber:
      match.winningTeamNumber ??
      (match.team1Score > match.team2Score ? 1 : 2),
    status,
    isOfficial: status === 'Completed',
    team1Confirmed: status === 'Completed',
    team2Confirmed: status === 'Completed',
    youtubeVideoUrl: match.youtubeVideoId
      ? `https://www.youtube.com/watch?v=${match.youtubeVideoId}`
      : null,
    correctionReason: null,
    voidReason: null,
    createdAt: match.createdAt,
    updatedAt: match.updatedAt,
    members,
  }
}

function matchStatus(status: ApiMatch['status']): Match['status'] {
  if (status === 1 || status === 'Scheduled') return 'Scheduled'
  if (status === 2 || status === 'Completed') return 'Completed'
  return 'Cancelled'
}

function apiError(payload: unknown) {
  if (typeof payload === 'string') {
    return /<html|<!doctype/i.test(payload) ? null : payload
  }
  if (!isRecord(payload)) return null
  for (const key of ['detail', 'title', 'message']) {
    const value = payload[key]
    if (typeof value === 'string' && value) return value
  }
  return null
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}
