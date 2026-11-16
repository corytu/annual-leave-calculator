import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import {
  loadSettings,
  saveSettings,
  loadRecords,
  saveRecords,
  clearAll,
  hasAnyAppData,
  affectedAppData,
  DEFAULT_SETTINGS,
} from './storage.js'

// jsdom provides a working localStorage; just make sure each test starts clean.
beforeEach(() => {
  localStorage.clear()
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('loadSettings', () => {
  it('returns DEFAULT_SETTINGS when nothing is stored', () => {
    expect(loadSettings()).toEqual(DEFAULT_SETTINGS)
  })

  it('merges stored data with defaults when some fields are missing', () => {
    localStorage.setItem('leaveCalculator_settings', JSON.stringify({ onboardDate: '2024-01-01' }))
    const result = loadSettings()
    expect(result.onboardDate).toBe('2024-01-01')
    expect(result.ruleType).toBe(DEFAULT_SETTINGS.ruleType)
    expect(result.allowCarryover).toBe(DEFAULT_SETTINGS.allowCarryover)
  })

  it('falls back to defaults when stored JSON is corrupted', () => {
    localStorage.setItem('leaveCalculator_settings', '{not valid json')
    expect(loadSettings()).toEqual(DEFAULT_SETTINGS)
  })

  it('backfills a missing customGrowth field from settings saved before this feature existed', () => {
    localStorage.setItem('leaveCalculator_settings', JSON.stringify({ onboardDate: '2024-01-01' }))
    expect(loadSettings().customGrowth).toEqual({ perYear: 0, cap: 0 })
  })

  it('deep-merges a partial customGrowth object instead of overwriting it wholesale', () => {
    localStorage.setItem('leaveCalculator_settings', JSON.stringify({ customGrowth: { perYear: 1 } }))
    expect(loadSettings().customGrowth).toEqual({ perYear: 1, cap: 0 })
  })
})

describe('saveSettings -> loadSettings round trip', () => {
  it('persists and reloads settings correctly', () => {
    const settings = {
      onboardDate: '2022-03-10',
      ruleType: 'custom',
      customRules: [{ id: 'a', months: 6, days: 3 }],
      allowCarryover: true,
      customGrowth: { perYear: 0, cap: 0 },
    }
    saveSettings(settings)
    expect(loadSettings()).toEqual(settings)
  })

  it('persists and reloads a fully-specified customGrowth', () => {
    const settings = {
      onboardDate: '2022-03-10',
      ruleType: 'custom',
      customRules: [{ id: 'a', months: 6, days: 3 }],
      allowCarryover: true,
      customGrowth: { perYear: 2, cap: 25 },
    }
    saveSettings(settings)
    expect(loadSettings()).toEqual(settings)
  })
})

describe('loadRecords', () => {
  it('returns an empty array when nothing is stored', () => {
    expect(loadRecords()).toEqual([])
  })

  it('falls back to an empty array when stored JSON is corrupted', () => {
    localStorage.setItem('leaveCalculator_records', 'not json at all')
    expect(loadRecords()).toEqual([])
  })
})

describe('saveRecords -> loadRecords round trip', () => {
  it('persists and reloads records correctly', () => {
    const records = [
      { id: '1', startDate: '2024-01-08', days: 1 },
      { id: '2', startDate: '2024-02-01', days: 0.25 },
    ]
    saveRecords(records)
    expect(loadRecords()).toEqual(records)
  })
})

describe('hasAnyAppData', () => {
  it('returns false when nothing is stored', () => {
    expect(hasAnyAppData()).toBe(false)
  })

  it('returns true when settings alone are stored', () => {
    saveSettings(DEFAULT_SETTINGS)
    expect(hasAnyAppData()).toBe(true)
  })

  it('returns true when records alone are stored', () => {
    saveRecords([])
    expect(hasAnyAppData()).toBe(true)
  })

  it('returns true when both settings and records are stored', () => {
    saveSettings(DEFAULT_SETTINGS)
    saveRecords([{ id: '1', startDate: '2024-01-08', days: 1 }])
    expect(hasAnyAppData()).toBe(true)
  })

  it('returns false again after clearAll', () => {
    saveSettings(DEFAULT_SETTINGS)
    saveRecords([])
    clearAll()
    expect(hasAnyAppData()).toBe(false)
  })

  it('returns false when localStorage access itself throws', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('SecurityError')
    })
    expect(hasAnyAppData()).toBe(false)
  })
})

describe('clearAll', () => {
  it('removes both keys so loadSettings/loadRecords fall back to defaults', () => {
    saveSettings({
      onboardDate: '2022-03-10',
      ruleType: 'custom',
      customRules: [{ id: 'a', months: 6, days: 3 }],
      allowCarryover: true,
    })
    saveRecords([{ id: '1', startDate: '2024-01-08', days: 1 }])

    clearAll()

    expect(localStorage.getItem('leaveCalculator_settings')).toBeNull()
    expect(localStorage.getItem('leaveCalculator_records')).toBeNull()
    expect(loadSettings()).toEqual(DEFAULT_SETTINGS)
    expect(loadRecords()).toEqual([])
  })
})

describe('affectedAppData', () => {
  it('flags only settings for the settings key', () => {
    expect(affectedAppData('leaveCalculator_settings')).toEqual({ settings: true, records: false })
  })

  it('flags only records for the records key', () => {
    expect(affectedAppData('leaveCalculator_records')).toEqual({ settings: false, records: true })
  })

  it('flags both when another tab cleared the whole storage (key === null)', () => {
    expect(affectedAppData(null)).toEqual({ settings: true, records: true })
  })

  it('ignores holiday-cache keys so they never reset the other tab', () => {
    expect(affectedAppData('leaveCalculator_holidayCache_2025')).toEqual({ settings: false, records: false })
  })

  it('ignores unrelated keys', () => {
    expect(affectedAppData('unrelated')).toEqual({ settings: false, records: false })
  })

  it('recognises every key that saveSettings/saveRecords actually write', () => {
    // Guards against renaming a storage key without updating the sync check.
    saveSettings(DEFAULT_SETTINGS)
    saveRecords([])
    const writtenKeys = Array.from({ length: localStorage.length }, (_, i) => localStorage.key(i))
    expect(writtenKeys).toHaveLength(2)
    for (const key of writtenKeys) {
      const affected = affectedAppData(key)
      expect(affected.settings || affected.records).toBe(true)
    }
  })
})
