import { recalculate, validateDataset, validateDatasetValue } from './domain'
import type { Dataset, Match } from './domain'

export function createPublicDataset(input: Dataset) {
  const errors = validateDataset(input)
  if (errors.length) throw new Error(`Cannot publish invalid admin data:\n${errors.join('\n')}`)

  const dataset = input
  const officialMatches = dataset.matches
    .filter((match) => match.status === 'Completed' && match.isOfficial)
    .sort((left, right) => left.playedAt.localeCompare(right.playedAt))
  const playerStats = new Map<string, { wins: number; losses: number }>()

  for (const match of officialMatches) {
    for (const member of match.members) {
      const current = playerStats.get(member.playerId) ?? { wins: 0, losses: 0 }
      if (member.teamNumber === match.winningTeamNumber) current.wins += 1
      else current.losses += 1
      playerStats.set(member.playerId, current)
    }
  }

  const hubs = dataset.hubs.filter((hub) => hub.isActive)
  const activeHubIds = new Set(hubs.map((hub) => hub.id))
  const players = dataset.players
    .filter((player) => player.isActive && activeHubIds.has(player.hubId))
    .map((player) => {
    const stats = playerStats.get(player.id) ?? { wins: 0, losses: 0 }
    const totalMatches = stats.wins + stats.losses
    return {
      id: player.id,
      hubId: player.hubId,
      displayName: player.displayName,
      avatarUrl: player.avatarUrl,
      isActive: true,
      currentMMR: player.currentMMR,
      wins: stats.wins,
      losses: stats.losses,
      totalMatches,
      winRate: totalMatches ? stats.wins / totalMatches : 0,
      createdAt: player.createdAt,
      updatedAt: player.updatedAt,
    }
    })
  const matches = officialMatches.map(publicMatch)
  const publicDataset = {
    version: 1,
    generatedAt: new Date().toISOString(),
    hubs,
    players,
    matches,
  }
  return JSON.stringify(publicDataset, null, 2)
}

export function createAdminBackup(dataset: Dataset) {
  const errors = validateDataset(dataset)
  if (errors.length) throw new Error(`Cannot export invalid admin data:\n${errors.join('\n')}`)
  return JSON.stringify(dataset, null, 2)
}

export function parseAdminBackup(value: unknown): Dataset {
  if (!validateDatasetValue(value)) {
    throw new Error('Backup has an invalid or unsupported JSON structure.')
  }
  const errors = validateDataset(value)
  if (errors.length) throw new Error(`Backup validation failed:\n${errors.join('\n')}`)
  return recalculate(value)
}

function publicMatch(match: Match) {
  return {
    id: match.id,
    hubId: match.hubId,
    playedAt: match.playedAt,
    team1Score: match.team1Score,
    team2Score: match.team2Score,
    winningTeamNumber: match.winningTeamNumber,
    status: 'Completed',
    isOfficial: true,
    youtubeVideoId: getYouTubeVideoId(match.youtubeVideoUrl),
    createdAt: match.createdAt,
    updatedAt: match.updatedAt,
    members: match.members.map((member) => ({
      id: member.id,
      playerId: member.playerId,
      displayName: member.displayName,
      teamNumber: member.teamNumber,
      mmrBefore: member.mmrBefore,
      mmrChange: member.mmrChange,
      mmrAfter: member.mmrAfter,
    })),
  }
}

function getYouTubeVideoId(value: string | null) {
  if (!value) return null
  const input = value.trim()
  const match = input.match(
    /(?:youtu\.be\/|youtube\.com\/(?:watch\?.*v=|embed\/|shorts\/))([\w-]{11})/,
  )
  const videoId = match?.[1] ?? input
  return /^[\w-]{11}$/.test(videoId) ? videoId : null
}

export function downloadFile(name: string, content: BlobPart, type: string) {
  const url = URL.createObjectURL(new Blob([content], { type }))
  const link = document.createElement('a')
  link.href = url
  link.download = name
  link.click()
  window.setTimeout(() => URL.revokeObjectURL(url), 1000)
}
