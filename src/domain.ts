export interface Hub {
  id: string
  name: string
  location: string
  isActive: boolean
  createdAt: string
}

export interface Player {
  id: string
  hubId: string
  displayName: string
  avatarUrl: string | null
  isActive: boolean
  initialMMR: number
  currentMMR: number
  createdAt: string
  updatedAt: string
}

export interface MatchMember {
  id: string
  playerId: string
  displayName: string
  teamNumber: 1 | 2
  mmrBefore: number | null
  mmrChange: number | null
  mmrAfter: number | null
}

export type MatchStatus = 'Scheduled' | 'Completed' | 'Cancelled' | 'Voided'

export interface Match {
  id: string
  hubId: string
  playedAt: string
  team1Score: number
  team2Score: number
  winningTeamNumber: 1 | 2
  status: MatchStatus
  isOfficial: boolean
  team1Confirmed: boolean
  team2Confirmed: boolean
  youtubeVideoUrl: string | null
  correctionReason: string | null
  voidReason: string | null
  createdAt: string
  updatedAt: string
  members: MatchMember[]
}

export interface Dataset {
  version: 1
  hubs: Hub[]
  players: Player[]
  matches: Match[]
}

export function recalculate(dataset: Dataset): Dataset {
  const ratings = new Map(
    dataset.players.map((player) => [player.id, player.initialMMR]),
  )
  const matches = dataset.matches.map((match) => ({
    ...match,
    members: match.members.map((member) => ({ ...member })),
  }))

  matches
    .filter((match) => match.status === 'Completed' && match.isOfficial)
    .sort(
      (left, right) =>
        left.playedAt.localeCompare(right.playedAt) ||
        left.id.localeCompare(right.id),
    )
    .forEach((match) => {
      const teamOne = match.members.filter((member) => member.teamNumber === 1)
      const teamTwo = match.members.filter((member) => member.teamNumber === 2)
      const average = (ids: string[]) =>
        ids.length
          ? ids.reduce((sum, id) => sum + (ratings.get(id) ?? 1000), 0) / ids.length
          : 1000
      const expected = 1 / (
        1 + 10 ** (
          (average(teamTwo.map((member) => member.playerId)) -
            average(teamOne.map((member) => member.playerId))) /
            400
        )
      )
      const winningDelta = Math.round(
        32 * (1 - (match.winningTeamNumber === 1 ? expected : 1 - expected)),
      )

      match.members.forEach((member) => {
        const before = ratings.get(member.playerId)
        if (before === undefined) return
        const change = member.teamNumber === match.winningTeamNumber
          ? winningDelta
          : -winningDelta
        const after = before + change
        ratings.set(member.playerId, after)
        member.mmrBefore = before
        member.mmrChange = change
        member.mmrAfter = after
      })
    })

  matches.forEach((match) => {
    if (match.status !== 'Completed' || !match.isOfficial) {
      match.members.forEach((member) => {
        member.mmrBefore = null
        member.mmrChange = null
        member.mmrAfter = null
      })
    }
  })

  return {
    ...dataset,
    matches,
    players: dataset.players.map((player) => ({
      ...player,
      currentMMR: ratings.get(player.id) ?? player.initialMMR,
      updatedAt: player.updatedAt,
    })),
  }
}

export function validateDataset(dataset: Dataset): string[] {
  const errors: string[] = []
  const hubIds = new Set(dataset.hubs.map((hub) => hub.id))
  const playerIds = new Set(dataset.players.map((player) => player.id))
  const matchIds = new Set<string>()
  if (hubIds.size !== dataset.hubs.length) errors.push('Hub IDs must be unique.')
  if (playerIds.size !== dataset.players.length) errors.push('Player IDs must be unique.')
  dataset.hubs.forEach((hub) => {
    if (!hub.id.trim() || !hub.name.trim() || !hub.location.trim()) {
      errors.push('Every hub needs an ID, name, and location.')
    }
    if (!isIsoDate(hub.createdAt)) errors.push(`Hub ${hub.id} has an invalid creation date.`)
  })
  dataset.players.forEach((player) => {
    if (!player.id.trim() || !player.displayName.trim()) {
      errors.push('Every player needs an ID and display name.')
    }
    if (!hubIds.has(player.hubId)) errors.push(`${player.displayName} has an unknown hub.`)
    if (!Number.isFinite(player.initialMMR) || player.initialMMR < 0) {
      errors.push(`${player.displayName} has an invalid initial rating.`)
    }
    if (!isIsoDate(player.createdAt) || !isIsoDate(player.updatedAt)) {
      errors.push(`${player.displayName} has an invalid date.`)
    }
  })
  dataset.matches.forEach((match) => {
    if (matchIds.has(match.id)) errors.push(`Duplicate match ID ${match.id}.`)
    matchIds.add(match.id)
    if (!match.id.trim()) errors.push('Match IDs cannot be empty.')
    if (!hubIds.has(match.hubId)) errors.push(`Match ${match.id} has an unknown hub.`)
    if (!isIsoDate(match.playedAt) || !isIsoDate(match.createdAt) || !isIsoDate(match.updatedAt)) {
      errors.push(`Match ${match.id} has an invalid date.`)
    }
    if (!['Scheduled', 'Completed', 'Cancelled', 'Voided'].includes(match.status)) {
      errors.push(`Match ${match.id} has an invalid status.`)
    }
    if (
      !Number.isInteger(match.team1Score) ||
      match.team1Score < 0 ||
      !Number.isInteger(match.team2Score) ||
      match.team2Score < 0
    ) {
      errors.push(`Match ${match.id} has invalid scores.`)
    }
    if (
      match.status === 'Completed' &&
      (!match.isOfficial || !match.team1Confirmed || !match.team2Confirmed)
    ) {
      errors.push(`Match ${match.id} is official without both team confirmations.`)
    }
    if (match.status === 'Scheduled' && match.isOfficial) {
      errors.push(`Scheduled match ${match.id} cannot already be official.`)
    }
    if (new Set(match.members.map((member) => member.playerId)).size !== match.members.length) {
      errors.push(`Match ${match.id} contains a duplicate participant.`)
    }
    if (
      !match.members.some((member) => member.teamNumber === 1) ||
      !match.members.some((member) => member.teamNumber === 2)
    ) {
      errors.push(`Match ${match.id} must have participants on both teams.`)
    }
    if (
      match.members.some((member) => {
        const player = dataset.players.find((item) => item.id === member.playerId)
        return !player || player.hubId !== match.hubId
      })
    ) {
      errors.push(`Match ${match.id} contains an invalid hub participant.`)
    }
    if (match.status === 'Voided' && !match.voidReason?.trim()) {
      errors.push(`Match ${match.id} is voided without a reason.`)
    }
    if (match.members.some((member) => !member.id.trim() || !member.displayName.trim())) {
      errors.push(`Match ${match.id} has an invalid participant record.`)
    }
    if (match.youtubeVideoUrl && !isYouTubeUrl(match.youtubeVideoUrl)) {
      errors.push(`Match ${match.id} has an invalid YouTube URL.`)
    }
    if (
      match.status === 'Completed' &&
      ((match.winningTeamNumber === 1 && match.team1Score <= match.team2Score) ||
        (match.winningTeamNumber === 2 && match.team2Score <= match.team1Score))
    ) {
      errors.push(`Match ${match.id} has an invalid winning score.`)
    }
  })
  return errors
}

export function validateDatasetValue(value: unknown): value is Dataset {
  if (!isRecord(value) || value.version !== 1) return false
  if (!Array.isArray(value.hubs) || !Array.isArray(value.players) || !Array.isArray(value.matches)) {
    return false
  }
  const hubsValid = value.hubs.every((hub) =>
    isRecord(hub) &&
    isString(hub.id) &&
    isString(hub.name) &&
    isString(hub.location) &&
    typeof hub.isActive === 'boolean' &&
    isIsoDate(hub.createdAt),
  )
  const playersValid = value.players.every((player) =>
    isRecord(player) &&
    isString(player.id) &&
    isString(player.hubId) &&
    isString(player.displayName) &&
    (player.avatarUrl === null || isString(player.avatarUrl)) &&
    typeof player.isActive === 'boolean' &&
    isFiniteNumber(player.initialMMR) &&
    isFiniteNumber(player.currentMMR) &&
    isIsoDate(player.createdAt) &&
    isIsoDate(player.updatedAt),
  )
  const matchesValid = value.matches.every((match) =>
    isRecord(match) &&
    isString(match.id) &&
    isString(match.hubId) &&
    isIsoDate(match.playedAt) &&
    isFiniteNumber(match.team1Score) &&
    isFiniteNumber(match.team2Score) &&
    (match.winningTeamNumber === 1 || match.winningTeamNumber === 2) &&
    ['Scheduled', 'Completed', 'Cancelled', 'Voided'].includes(String(match.status)) &&
    typeof match.isOfficial === 'boolean' &&
    typeof match.team1Confirmed === 'boolean' &&
    typeof match.team2Confirmed === 'boolean' &&
    (match.youtubeVideoUrl === null || isString(match.youtubeVideoUrl)) &&
    (match.correctionReason === null || isString(match.correctionReason)) &&
    (match.voidReason === null || isString(match.voidReason)) &&
    isIsoDate(match.createdAt) &&
    isIsoDate(match.updatedAt) &&
    Array.isArray(match.members) &&
    match.members.every((member) =>
      isRecord(member) &&
      isString(member.id) &&
      isString(member.playerId) &&
      isString(member.displayName) &&
      (member.teamNumber === 1 || member.teamNumber === 2) &&
      isNullableNumber(member.mmrBefore) &&
      isNullableNumber(member.mmrChange) &&
      isNullableNumber(member.mmrAfter),
    ),
  )
  return hubsValid && playersValid && matchesValid
}

export function id() {
  return crypto.randomUUID()
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isString(value: unknown): value is string {
  return typeof value === 'string'
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value)
}

function isNullableNumber(value: unknown): value is number | null {
  return value === null || isFiniteNumber(value)
}

function isIsoDate(value: unknown): value is string {
  return typeof value === 'string' && Number.isFinite(Date.parse(value))
}

function isYouTubeUrl(value: string) {
  try {
    const url = new URL(value)
    const videoId =
      url.hostname === 'youtu.be'
        ? url.pathname.slice(1)
        : url.hostname.endsWith('youtube.com')
          ? url.searchParams.get('v') ??
            url.pathname.match(/^\/(?:embed|shorts)\/([\w-]{11})/)?.[1]
          : null
    return (
      (url.protocol === 'https:' || url.protocol === 'http:') &&
      typeof videoId === 'string' &&
      /^[\w-]{11}$/.test(videoId)
    )
  } catch {
    return false
  }
}
