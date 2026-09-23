import { describe, it, expect } from 'vitest'
import { validateSettingsInput, getCustomCapMin, getLastRuleDays } from './settingsValidation.js'
import { MAX_MILESTONE_MONTHS, MAX_ANNUAL_LEAVE_DAYS } from './leaveCalculations.js'

// A small custom rule set used as a valid baseline across tests. Last row
// (sorted by months) is r2 (24mo/14 days), used by the cap-boundary tests below.
const BASE_RULES = [
  { id: 'r1', months: '12', days: '10' },
  { id: 'r2', months: '24', days: '14' },
]
const LAST_ROW_DAYS = 14

function input(overrides = {}) {
  return {
    onboardDate: '2024-01-01',
    ruleType: 'custom',
    customRules: BASE_RULES,
    growthPerYear: '0',
    growthCap: '0',
    ...overrides,
  }
}

function ids(warnings) {
  return warnings.map(w => w.id)
}

function byId(warnings, id) {
  return warnings.find(w => w.id === id)
}

describe('validateSettingsInput', () => {
  it('requires the onboard date', () => {
    const warnings = validateSettingsInput(input({ onboardDate: '' }))
    expect(ids(warnings)).toContain('onboardDate-incomplete')
    expect(byId(warnings, 'onboardDate-incomplete').tier).toBe('incomplete')
  })

  it('returns no warnings for a fully valid custom input', () => {
    expect(validateSettingsInput(input({ growthPerYear: '1', growthCap: '30' }))).toEqual([])
  })

  it('skips every custom-only check for ruleType "labor", even with empty/invalid fields', () => {
    const warnings = validateSettingsInput({
      onboardDate: '2024-01-01',
      ruleType: 'labor',
      customRules: [],
      growthPerYear: '',
      growthCap: '',
    })
    expect(warnings).toEqual([])
  })

  it('reports only the onboardDate warning for ruleType "labor" even with garbage custom fields', () => {
    const warnings = validateSettingsInput({
      onboardDate: '',
      ruleType: 'labor',
      customRules: [{ id: 'r1', months: -5, days: -5 }],
      growthPerYear: '-5',
      growthCap: '-5',
    })
    expect(ids(warnings)).toEqual(['onboardDate-incomplete'])
  })

  it('requires at least one custom rule', () => {
    const warnings = validateSettingsInput(input({ customRules: [] }))
    expect(ids(warnings)).toContain('customRules-empty')
    const w = byId(warnings, 'customRules-empty')
    expect(w.tier).toBe('error')
    expect(w.scope).toBe('form')
  })

  describe('W9: months raw-value emptiness', () => {
    it('reports incomplete (not error) when months is an empty string', () => {
      const rules = [{ id: 'r1', months: '', days: 10 }]
      const warnings = validateSettingsInput(input({ customRules: rules }))
      expect(ids(warnings)).toContain('row-r1-months-incomplete')
      expect(byId(warnings, 'row-r1-months-incomplete').tier).toBe('incomplete')
    })

    it.each([
      ['non-integer', 1.5],
      ['below 1', 0],
      [`above ${MAX_MILESTONE_MONTHS}`, MAX_MILESTONE_MONTHS + 1],
    ])('reports an error when months is %s', (_label, months) => {
      const rules = [{ id: 'r1', months, days: 10 }]
      const warnings = validateSettingsInput(input({ customRules: rules }))
      expect(ids(warnings)).toContain('row-r1-months-invalid')
      expect(byId(warnings, 'row-r1-months-invalid').tier).toBe('error')
    })
  })

  describe('W12: duplicate thresholds', () => {
    it('produces one error warning per rowId, sharing the same dedupeKey', () => {
      const rules = [{ id: 'r1', months: 12, days: 10 }, { id: 'r2', months: 12, days: 14 }]
      const warnings = validateSettingsInput(input({ customRules: rules }))
      const dupWarnings = warnings.filter(w => w.field === 'months' && w.scope === 'form')
      expect(dupWarnings).toHaveLength(2)
      expect(dupWarnings.map(w => w.rowId).sort()).toEqual(['r1', 'r2'])
      expect(dupWarnings.every(w => w.tier === 'error')).toBe(true)
      expect(new Set(dupWarnings.map(w => w.dedupeKey)).size).toBe(1)
      expect(dupWarnings[0].dedupeKey).toBe('months-duplicate-12')
      expect(dupWarnings[0].message).toBe('年資門檻「12 個月」重複，請合併或刪除其中一列')
    })

    it('gives two different threshold groups independent dedupeKeys', () => {
      const rules = [
        { id: 'r1', months: 12, days: 10 },
        { id: 'r2', months: 12, days: 10 },
        { id: 'r3', months: 24, days: 14 },
        { id: 'r4', months: 24, days: 14 },
      ]
      const warnings = validateSettingsInput(input({ customRules: rules }))
      const dupWarnings = warnings.filter(w => w.field === 'months' && w.scope === 'form')
      const dedupeKeys = new Set(dupWarnings.map(w => w.dedupeKey))
      expect(dedupeKeys).toEqual(new Set(['months-duplicate-12', 'months-duplicate-24']))
    })

    it('does not flag a row whose months is itself invalid as part of a duplicate group', () => {
      const rules = [{ id: 'r1', months: 1500, days: 10 }, { id: 'r2', months: 1500, days: 14 }]
      const warnings = validateSettingsInput(input({ customRules: rules }))
      expect(warnings.some(w => w.field === 'months' && w.scope === 'form')).toBe(false)
    })
  })

  describe('custom rule days (#45, W4)', () => {
    it('accepts exactly MAX_ANNUAL_LEAVE_DAYS', () => {
      const rules = [{ id: 'r1', months: 12, days: MAX_ANNUAL_LEAVE_DAYS }]
      expect(validateSettingsInput(input({ customRules: rules }))).toEqual([])
    })

    it('reports incomplete (not error) for an empty string', () => {
      const rules = [{ id: 'r1', months: 12, days: '' }]
      const warnings = validateSettingsInput(input({ customRules: rules }))
      expect(ids(warnings)).toEqual(['row-r1-days-incomplete'])
      expect(byId(warnings, 'row-r1-days-incomplete').tier).toBe('incomplete')
    })

    it('reports days-positive for zero/negative', () => {
      const rules = [{ id: 'r1', months: 12, days: 0 }]
      expect(ids(validateSettingsInput(input({ customRules: rules })))).toContain('row-r1-days-positive')
    })

    it('reports days-max for a value over the ceiling', () => {
      const rules = [{ id: 'r1', months: 12, days: MAX_ANNUAL_LEAVE_DAYS + 1 }]
      expect(ids(validateSettingsInput(input({ customRules: rules })))).toContain('row-r1-days-max')
    })

    it('reports days-quarter-step for a non-0.25 multiple', () => {
      const rules = [{ id: 'r1', months: 12, days: 364.1 }]
      expect(ids(validateSettingsInput(input({ customRules: rules })))).toContain('row-r1-days-quarter-step')
    })

    it('reports both days-max and days-quarter-step together when both conditions fail (W4)', () => {
      const rules = [{ id: 'r1', months: 12, days: MAX_ANNUAL_LEAVE_DAYS + 0.1 }]
      const warnings = validateSettingsInput(input({ customRules: rules }))
      expect(ids(warnings)).toEqual(expect.arrayContaining(['row-r1-days-max', 'row-r1-days-quarter-step']))
    })

    it('rejects Infinity and a huge finite value (1e23) as not a valid day count', () => {
      for (const days of [Infinity, 1e23]) {
        const rules = [{ id: 'r1', months: 12, days }]
        const warnings = validateSettingsInput(input({ customRules: rules }))
        expect(warnings.some(w => w.rowId === 'r1' && w.field === 'days')).toBe(true)
      }
    })
  })

  describe('perYear (#45)', () => {
    it('accepts exactly MAX_ANNUAL_LEAVE_DAYS', () => {
      expect(validateSettingsInput(input({
        growthPerYear: String(MAX_ANNUAL_LEAVE_DAYS),
        growthCap: String(MAX_ANNUAL_LEAVE_DAYS),
      }))).toEqual([])
    })

    it('reports incomplete (not error) for an empty string', () => {
      const warnings = validateSettingsInput(input({ growthPerYear: '' }))
      expect(ids(warnings)).toContain('growthPerYear-incomplete')
      expect(byId(warnings, 'growthPerYear-incomplete').tier).toBe('incomplete')
    })

    it.each([
      ['negative', '-1', 'growthPerYear-nonnegative'],
      [`above MAX (${MAX_ANNUAL_LEAVE_DAYS})`, String(MAX_ANNUAL_LEAVE_DAYS + 1), 'growthPerYear-max'],
      ['not a multiple of 0.25', '1.1', 'growthPerYear-quarter-step'],
    ])('rejects %s', (_label, growthPerYear, expectedId) => {
      expect(ids(validateSettingsInput(input({ growthPerYear })))).toContain(expectedId)
    })
  })

  describe('cap, only validated when perYear > 0 (#45)', () => {
    it('accepts exactly MAX_ANNUAL_LEAVE_DAYS', () => {
      expect(validateSettingsInput(input({ growthPerYear: '1', growthCap: String(MAX_ANNUAL_LEAVE_DAYS) }))).toEqual([])
    })

    it("accepts exactly the last row's day count", () => {
      expect(validateSettingsInput(input({ growthPerYear: '1', growthCap: String(LAST_ROW_DAYS) }))).toEqual([])
    })

    it('reports incomplete (not error) for an empty string', () => {
      const warnings = validateSettingsInput(input({ growthPerYear: '1', growthCap: '' }))
      expect(ids(warnings)).toContain('growthCap-incomplete')
      expect(byId(warnings, 'growthCap-incomplete').tier).toBe('incomplete')
    })

    it.each([
      [`above MAX (${MAX_ANNUAL_LEAVE_DAYS})`, String(MAX_ANNUAL_LEAVE_DAYS + 1), 'growthCap-max'],
      ['not a multiple of 0.25', '16.1', 'growthCap-quarter-step'],
      ["below the last row's days", '10', 'growthCap-min-lastrow'],
    ])('rejects %s', (_label, growthCap, expectedId) => {
      expect(ids(validateSettingsInput(input({ growthPerYear: '1', growthCap })))).toContain(expectedId)
    })

    it('does not validate the cap at all when perYear is 0, even with a stale invalid value (C4)', () => {
      expect(validateSettingsInput(input({ growthPerYear: '0', growthCap: '9000' }))).toEqual([])
      expect(validateSettingsInput(input({ growthPerYear: '0', growthCap: '' }))).toEqual([])
    })

    describe('W15: cap-min-lastrow is skipped when its source fields are unreliable', () => {
      it('is skipped when any row\'s months is blocking', () => {
        const rules = [{ id: 'r1', months: '', days: 10 }, { id: 'r2', months: 24, days: 14 }]
        const warnings = validateSettingsInput(input({ customRules: rules, growthPerYear: '1', growthCap: '10' }))
        expect(ids(warnings)).not.toContain('growthCap-min-lastrow')
      })

      it("is skipped when the last row's own days is blocking", () => {
        const rules = [{ id: 'r1', months: 12, days: 10 }, { id: 'r2', months: 24, days: -5 }]
        const warnings = validateSettingsInput(input({ customRules: rules, growthPerYear: '1', growthCap: '10' }))
        expect(ids(warnings)).not.toContain('growthCap-min-lastrow')
      })

      it("touchedKeys includes both growthCap and the last row's days key", () => {
        const warnings = validateSettingsInput(input({ growthPerYear: '1', growthCap: '10' }))
        const w = byId(warnings, 'growthCap-min-lastrow')
        expect(w.touchedKeys).toEqual(expect.arrayContaining(['growthCap', 'r2:days']))
      })
    })
  })

  it('accepts the default custom rules with a valid growth row', () => {
    expect(validateSettingsInput(input({ growthPerYear: '1', growthCap: '30' }))).toEqual([])
  })

  it("computes growthCap-min-lastrow's threshold using getLastRuleDays, matching a manually-computed value for an unordered rule set", () => {
    const rules = [
      { id: 'r1', months: 36, days: 14 },
      { id: 'r2', months: 6, days: 3 },
      { id: 'r3', months: 12, days: 7 },
    ]
    const warnings = validateSettingsInput(input({ customRules: rules, growthPerYear: '1', growthCap: '10' }))
    const w = byId(warnings, 'growthCap-min-lastrow')
    expect(w.message).toBe(`天數上限不可低於最後一列的天數（${getLastRuleDays(rules)} 天）`)
    expect(getLastRuleDays(rules)).toBe(14)
  })
})

describe('getCustomCapMin', () => {
  it("returns the highest-threshold row's days when it is a valid day count", () => {
    expect(getCustomCapMin(BASE_RULES)).toBe(LAST_ROW_DAYS)
  })

  it('falls back to 0 when the highest-threshold row\'s months is not a parseable number', () => {
    // '-' is a realistic mid-typing state for a negative number and, unlike
    // '', does not coerce to 0 -- Number('-') is NaN, so this row is excluded
    // from getDaysForMilestone's own valid-threshold lookup entirely.
    const rules = [{ id: 'r1', months: '12', days: '10' }, { id: 'r2', months: '-', days: '14' }]
    expect(getCustomCapMin(rules)).toBe(0)
  })

  it('falls back to 0 when the highest-threshold row\'s days is blank/NaN', () => {
    const rules = [{ id: 'r1', months: '12', days: '10' }, { id: 'r2', months: '24', days: '' }]
    expect(getCustomCapMin(rules)).toBe(0)
  })

  it.each([
    ['zero', 0],
    ['negative', -1],
  ])('falls back to 0 when the highest-threshold row\'s days is %s', (_label, days) => {
    const rules = [{ id: 'r1', months: '12', days: '10' }, { id: 'r2', months: '24', days }]
    expect(getCustomCapMin(rules)).toBe(0)
  })

  it('falls back to 0 when the highest-threshold row\'s days is not a multiple of 0.25', () => {
    const rules = [{ id: 'r1', months: '12', days: '10' }, { id: 'r2', months: '24', days: '16.1' }]
    expect(getCustomCapMin(rules)).toBe(0)
  })
})
