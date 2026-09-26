import { describe, it, expect } from 'vitest'
import { computeLeaveFormWarnings } from './leaveFormValidation.js'
import { parseLocalDate } from './leaveCalculations.js'

// onboard 2024-06-15 + asOf 2025-06-15 -> exactly 12 completed months ->
// current milestone 12 (7 days), period 2025-06-15 ~ 2026-06-14.
const SETTINGS = {
  onboardDate: '2024-06-15',
  ruleType: 'labor',
  customRules: [],
  allowCarryover: false,
}
const PERIOD_START = parseLocalDate('2025-06-15')
const PERIOD_END = parseLocalDate('2026-06-14')
const TODAY = parseLocalDate('2025-06-15')

function base(overrides = {}) {
  return {
    startDate: '2025-06-20',
    days: 1,
    periodStart: PERIOD_START,
    periodEnd: PERIOD_END,
    allRecords: [],
    editingRecord: null,
    settings: SETTINGS,
    today: TODAY,
    ...overrides,
  }
}

function ids(warnings) {
  return warnings.map(w => w.id)
}

describe('computeLeaveFormWarnings', () => {
  it('returns no warnings for a valid, non-overspending input', () => {
    expect(computeLeaveFormWarnings(base())).toEqual([])
  })

  it('flags an empty startDate as incomplete', () => {
    const warnings = computeLeaveFormWarnings(base({ startDate: '' }))
    expect(ids(warnings)).toContain('startDate-incomplete')
  })

  it('flags a startDate outside the period range as an error', () => {
    const warnings = computeLeaveFormWarnings(base({ startDate: '2025-06-01' }))
    expect(ids(warnings)).toContain('startDate-range')
  })

  it('flags an empty days as incomplete', () => {
    const warnings = computeLeaveFormWarnings(base({ days: '' }))
    expect(ids(warnings)).toContain('days-incomplete')
  })

  it('flags a non-positive days as an error', () => {
    const warnings = computeLeaveFormWarnings(base({ days: 0 }))
    expect(ids(warnings)).toContain('days-positive')
  })

  it('flags a days value that is not a 0.25 step as an error', () => {
    const warnings = computeLeaveFormWarnings(base({ days: 1.1 }))
    expect(ids(warnings)).toContain('days-quarter-step')
  })

  // W4: a value can violate more than one condition on the same field at once.
  it('flags both days-positive and days-quarter-step for a negative non-quarter-step value', () => {
    const warnings = computeLeaveFormWarnings(base({ days: -0.1 }))
    expect(ids(warnings)).toEqual(expect.arrayContaining(['days-positive', 'days-quarter-step']))
  })

  it('does not run the overspend check when a field is blocking (incomplete)', () => {
    const warnings = computeLeaveFormWarnings(base({ startDate: '', days: 100 }))
    expect(ids(warnings)).not.toContain('overspend')
  })

  it('does not run the overspend check when a field has an error', () => {
    const warnings = computeLeaveFormWarnings(base({ days: -1 }))
    expect(ids(warnings)).not.toContain('overspend')
  })

  it('flags overspend when the candidate record exceeds the period entitlement', () => {
    // Entitlement is 7 days; 8 days alone already overspends.
    const warnings = computeLeaveFormWarnings(base({ days: 8 }))
    expect(ids(warnings)).toContain('overspend')
  })

  it('does not flag overspend when within the period entitlement', () => {
    const warnings = computeLeaveFormWarnings(base({ days: 7 }))
    expect(ids(warnings)).not.toContain('overspend')
  })

  it('substitutes the edited record instead of appending a duplicate when editingRecord is set', () => {
    // Existing record already uses the full 7-day entitlement. Editing it
    // down to 5 days should not be flagged as overspend (it replaces, not adds).
    const warnings = computeLeaveFormWarnings(base({
      days: 5,
      allRecords: [{ id: 'r1', startDate: '2025-06-20', days: 7 }],
      editingRecord: { id: 'r1', startDate: '2025-06-20', days: 7 },
    }))
    expect(ids(warnings)).not.toContain('overspend')
  })
})
