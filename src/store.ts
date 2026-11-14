import seed from './seed.json'
import { recalculate, validateDataset, validateDatasetValue } from './domain'
import type { Dataset } from './domain'

const STORAGE_KEY = 'rankup.admin.v1'

export function loadDataset(): Dataset {
  try {
    const saved = localStorage.getItem(STORAGE_KEY)
    if (!saved) return recalculate(seed as Dataset)
    const parsed: unknown = JSON.parse(saved)
    const migrated = migrateDataset(parsed)
    if (!validateDatasetValue(migrated)) {
      throw new Error('Saved admin data does not match the supported dataset format.')
    }
    const errors = validateDataset(migrated)
    if (errors.length) throw new Error(errors.join(' '))
    return recalculate(migrated)
  } catch (cause) {
    throw new Error(
      `Could not load local admin data: ${cause instanceof Error ? cause.message : String(cause)}`,
    )
  }
}

function migrateDataset(value: unknown): unknown {
  if (
    typeof value !== 'object' ||
    value === null ||
    !('matches' in value) ||
    !Array.isArray(value.matches)
  ) {
    return value
  }
  const record = value as Record<string, unknown>
  return {
    ...record,
    matches: (record.matches as unknown[]).map((value) => {
      if (typeof value !== 'object' || value === null || Array.isArray(value)) {
        return value
      }
      const match = value as Record<string, unknown>
      const wasOfficial = match.status === 'Completed' && match.isOfficial === true
      return {
        ...match,
        team1Confirmed: match.team1Confirmed ?? wasOfficial,
        team2Confirmed: match.team2Confirmed ?? wasOfficial,
      }
    }),
  }
}

export function saveDataset(dataset: Dataset) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(recalculate(dataset)))
  } catch (cause) {
    throw new Error(
      `Could not save local admin data: ${cause instanceof Error ? cause.message : String(cause)}`,
    )
  }
}
