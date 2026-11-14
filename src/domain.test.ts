import { describe, expect, it } from 'vitest'
import seed from './seed.json'
import { recalculate } from './domain'
import type { Dataset } from './domain'
import { parseAdminBackup, createAdminBackup, createPublicDataset } from './transfers'

const sample = seed as Dataset

describe('admin ratings', () => {
  it('calculates official results in chronological order', () => {
    const result = recalculate(structuredClone(sample))
    const first = result.matches.find((match) => match.id === 'match-1')!
    const second = result.matches.find((match) => match.id === 'match-2')!
    const mayaAfterFirst = first.members.find((member) => member.playerId === 'maya')!
    const mayaBeforeSecond = second.members.find((member) => member.playerId === 'maya')!

    expect(mayaAfterFirst.mmrBefore).toBe(1000)
    expect(mayaAfterFirst.mmrChange).toBe(-16)
    expect(mayaAfterFirst.mmrAfter).toBe(984)
    expect(mayaBeforeSecond.mmrBefore).toBe(984)
    expect(result.players.find((player) => player.id === 'maya')?.currentMMR).toBe(1000)
  })

  it('recalculates later player snapshots when a historical result changes', () => {
    const corrected = structuredClone(sample)
    const historicalMatch = corrected.matches.find((match) => match.id === 'match-1')!
    historicalMatch.winningTeamNumber = 1
    historicalMatch.team1Score = 21
    historicalMatch.team2Score = 10
    historicalMatch.correctionReason = 'Scorecard correction'

    const result = recalculate(corrected)
    const laterMayaMember = result.matches
      .find((match) => match.id === 'match-2')!
      .members.find((member) => member.playerId === 'maya')!

    expect(laterMayaMember.mmrBefore).toBe(1016)
  })

  it('removes a voided result from the chronological rating calculation', () => {
    const corrected = structuredClone(sample)
    const voidedMatch = corrected.matches.find((match) => match.id === 'match-1')!
    voidedMatch.status = 'Voided'
    voidedMatch.voidReason = 'Result could not be verified'

    const result = recalculate(corrected)
    const laterMayaMember = result.matches
      .find((match) => match.id === 'match-2')!
      .members.find((member) => member.playerId === 'maya')!

    expect(laterMayaMember.mmrBefore).toBe(1000)
  })
})

describe('admin data transfers', () => {
  it('round-trips full admin backup data', () => {
    const original = recalculate(structuredClone(sample))
    expect(parseAdminBackup(JSON.parse(createAdminBackup(original)))).toEqual(original)
  })

  it('exports one public JSON document with only official results and no admin-only notes', () => {
    const dataset = structuredClone(sample)
    dataset.matches[0]!.correctionReason = 'Internal correction details'
    const scheduled = structuredClone(dataset.matches[0]!)
    scheduled.id = 'scheduled-match'
    scheduled.status = 'Scheduled'
    scheduled.isOfficial = false
    scheduled.team1Confirmed = false
    scheduled.team2Confirmed = false
    scheduled.correctionReason = null
    dataset.matches.push(scheduled)

    const publicJson = JSON.parse(createPublicDataset(dataset)) as {
      matches: { id: string; correctionReason?: string; youtubeVideoId: string | null }[]
    }

    expect(publicJson.matches).toHaveLength(2)
    expect(publicJson.matches.map((match) => match.id)).not.toContain('scheduled-match')
    expect(publicJson.matches.some((match) => 'correctionReason' in match)).toBe(false)
    expect(publicJson.matches.find((match) => match.id === 'match-2')?.youtubeVideoId)
      .toBe('dQw4w9WgXcQ')
  })

  it('rejects invalid imported data', () => {
    expect(() => parseAdminBackup({ version: 1, hubs: [], players: [], matches: [{}] }))
      .toThrow('invalid or unsupported JSON structure')
  })
})
