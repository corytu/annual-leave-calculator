import { describe, it, expect } from 'vitest'
import {
  addMonthsToDate,
  getCompletedMonths,
  toISODateString,
  parseLocalDate,
  getLaborLawDays,
  getDaysForMilestone,
  getMilestones,
  getPeriodInfo,
  getPeriodContainingDate,
  getLeaveTakenInPeriod,
  getLeaveRecordDates,
  computePeriodLedger,
  validateRecordsChain,
  calculateSummary,
  formatPeriodLabel,
  checkLaborLawCompliance,
} from './leaveCalculations.js'

// Small helper so test cases read like dates, not Date(y, m-1, d) noise.
const d = (str) => parseLocalDate(str)

describe('addMonthsToDate', () => {
  it('adds months normally with no overflow', () => {
    expect(toISODateString(addMonthsToDate(d('2024-03-15'), 2))).toBe('2024-05-15')
  })

  it('clamps month-end overflow in a non-leap year (Jan 31 + 1mo -> Feb 28)', () => {
    expect(toISODateString(addMonthsToDate(d('2025-01-31'), 1))).toBe('2025-02-28')
  })

  it('clamps month-end overflow in a leap year (Jan 31 + 1mo -> Feb 29)', () => {
    expect(toISODateString(addMonthsToDate(d('2024-01-31'), 1))).toBe('2024-02-29')
  })

  it('handles a Feb 29 onboard date rolling into a non-leap year (+12mo -> Feb 28)', () => {
    expect(toISODateString(addMonthsToDate(d('2024-02-29'), 12))).toBe('2025-02-28')
  })

  it('handles crossing a year boundary (Nov + 3mo -> next Feb)', () => {
    expect(toISODateString(addMonthsToDate(d('2023-11-10'), 3))).toBe('2024-02-10')
  })
})

describe('getCompletedMonths', () => {
  it('returns 0 when less than a month has elapsed (1 day short)', () => {
    expect(getCompletedMonths(d('2024-01-01'), d('2024-01-31'))).toBe(0)
  })

  it('returns the exact month count on the anniversary day itself', () => {
    expect(getCompletedMonths(d('2024-01-01'), d('2024-07-01'))).toBe(6)
  })

  it('counts full months plus a leftover day fraction correctly (floors down)', () => {
    expect(getCompletedMonths(d('2024-01-15'), d('2024-08-20'))).toBe(7)
  })

  it('returns 0 when from === to', () => {
    const date = d('2024-05-05')
    expect(getCompletedMonths(date, date)).toBe(0)
  })
})

describe('toISODateString / parseLocalDate', () => {
  it('round-trips a normal date', () => {
    expect(toISODateString(parseLocalDate('2024-06-15'))).toBe('2024-06-15')
  })

  it('round-trips a month-start date', () => {
    expect(toISODateString(parseLocalDate('2024-03-01'))).toBe('2024-03-01')
  })

  it('round-trips a month-end / leap-day date', () => {
    expect(toISODateString(parseLocalDate('2024-02-29'))).toBe('2024-02-29')
  })

  it('round-trips a year-boundary date', () => {
    expect(toISODateString(parseLocalDate('2023-12-31'))).toBe('2023-12-31')
  })
})

describe('getLaborLawDays', () => {
  it.each([
    [0, 0],
    [5, 0],
    [6, 3],
    [11, 3],
    [12, 7],
    [23, 7],
    [24, 10],
    [35, 10],
    [36, 14],
    [59, 14],
    [60, 15],
    [119, 15],
    [120, 16],
    [131, 16],
    [132, 17],
  ])('gives the correct days at %i months -> %i days', (months, expected) => {
    expect(getLaborLawDays(months)).toBe(expected)
  })

  it('caps at 30 days for very long tenure (300 months)', () => {
    expect(getLaborLawDays(300)).toBe(30)
  })

  it('caps at 30 days and stays there beyond the cap (360 months)', () => {
    expect(getLaborLawDays(360)).toBe(30)
  })
})

describe('getMilestones (labor law extension covers upToMonths)', () => {
  it('extends the fixed milestone list far enough to cover upToMonths', () => {
    const milestones = getMilestones('labor', [], 200)
    expect(Math.max(...milestones)).toBeGreaterThanOrEqual(200)
    // Should still include all the fixed early milestones
    expect(milestones).toEqual(expect.arrayContaining([6, 12, 24, 36, 48, 60, 72, 84, 96, 108, 120]))
  })

  it('returns [6] fallback for empty custom rules', () => {
    expect(getMilestones('custom', [], 100)).toEqual([6])
  })

  it('extends custom rules annually past the last defined rule', () => {
    const custom = [{ months: 6, days: 3 }, { months: 18, days: 10 }]
    const milestones = getMilestones('custom', custom, 50)
    expect(milestones[0]).toBe(6)
    expect(milestones[1]).toBe(18)
    expect(milestones).toContain(30) // 18 + 12
    expect(milestones).toContain(42) // 18 + 24
    expect(Math.max(...milestones)).toBeGreaterThanOrEqual(50)
  })
})

// Mirrors Settings.jsx's DEFAULT_CUSTOM_RULES thresholds/days exactly, so tests
// that rely on "the default custom rule set" stay in sync with the UI default.
const DEFAULT_CUSTOM_RULE_SET = [
  { months: 6,   days: 3  },
  { months: 12,  days: 7  },
  { months: 24,  days: 10 },
  { months: 36,  days: 14 },
  { months: 60,  days: 15 },
  { months: 120, days: 16 },
]

describe('getMilestones (custom rules yearly grid)', () => {
  it('produces the same milestones as labor law for the default custom thresholds', () => {
    const customMilestones = getMilestones('custom', DEFAULT_CUSTOM_RULE_SET, 200)
    const laborMilestones = getMilestones('labor', [], 200)
    expect(customMilestones).toEqual(laborMilestones)
  })

  it('fills yearly cut points forward from each threshold, leaving any short remainder just before the next threshold', () => {
    const custom = [{ months: 6, days: 3 }, { months: 12, days: 7 }, { months: 30, days: 14 }]
    const milestones = getMilestones('custom', custom, 50)
    expect(milestones.slice(0, 5)).toEqual([6, 12, 24, 30, 42])
  })

  it('never produces a gap longer than 12 months between consecutive milestones', () => {
    const custom = [{ months: 3, days: 1 }, { months: 17, days: 5 }, { months: 45, days: 10 }]
    const milestones = getMilestones('custom', custom, 100)
    for (let i = 1; i < milestones.length; i++) {
      expect(milestones[i] - milestones[i - 1]).toBeLessThanOrEqual(12)
    }
  })

  it('deduplicates repeated thresholds', () => {
    const withDupe = [{ months: 12, days: 5 }, { months: 12, days: 7 }, { months: 24, days: 10 }]
    const withoutDupe = [{ months: 12, days: 5 }, { months: 24, days: 10 }]
    expect(getMilestones('custom', withDupe, 30)).toEqual(getMilestones('custom', withoutDupe, 30))
  })

  it('ignores thresholds that are not positive integers', () => {
    const messy = [
      { months: 0, days: 1 },
      { months: -5, days: 1 },
      { months: 1.5, days: 1 },
      { months: 'abc', days: 1 },
      { months: 12, days: 5 },
    ]
    expect(getMilestones('custom', messy, 30)).toEqual(getMilestones('custom', [{ months: 12, days: 5 }], 30))
  })

  it('ignores thresholds beyond the sanity ceiling and does not hang on a huge gap', () => {
    const huge = [{ months: 12, days: 5 }, { months: 999999999, days: 30 }]
    expect(getMilestones('custom', huge, 30)).toEqual(getMilestones('custom', [{ months: 12, days: 5 }], 30))
  })
})

describe('getDaysForMilestone', () => {
  it('delegates to labor law days for ruleType "labor"', () => {
    expect(getDaysForMilestone(24, 'labor', [])).toBe(getLaborLawDays(24))
  })

  const custom = [
    { months: 6, days: 3 },
    { months: 12, days: 7 },
    { months: 24, days: 10 },
  ]

  it('matches an exact threshold for custom rules', () => {
    expect(getDaysForMilestone(12, 'custom', custom)).toBe(7)
  })

  it('falls back to the lower threshold when between two custom thresholds', () => {
    expect(getDaysForMilestone(18, 'custom', custom)).toBe(7)
  })

  it('returns 0 for custom rules below the lowest threshold', () => {
    expect(getDaysForMilestone(3, 'custom', custom)).toBe(0)
  })

  it('gives a gap-filled milestone the days of the highest threshold at or below it', () => {
    expect(getDaysForMilestone(48, 'custom', DEFAULT_CUSTOM_RULE_SET)).toBe(14)
    expect(getDaysForMilestone(72, 'custom', DEFAULT_CUSTOM_RULE_SET)).toBe(15)
  })
})

describe('getPeriodInfo', () => {
  it('computes correct periodStart/periodEnd/entitledDays for a normal case', () => {
    const info = getPeriodInfo(d('2023-01-08'), 12, 'labor', [])
    expect(toISODateString(info.periodStart)).toBe('2024-01-08')
    // Next milestone is 24 months -> period end is the day before.
    expect(toISODateString(info.periodEnd)).toBe('2025-01-07')
    expect(info.entitledDays).toBe(7)
  })

  it('adds 12 months when past the last known milestone', () => {
    // 132 is the last known milestone before the +12 extension kicks in during this call
    const info = getPeriodInfo(d('2020-01-01'), 132, 'labor', [])
    expect(info.nextMilestoneMonths).toBe(144)
  })

  it('spans exactly 12 months at milestone 36 under the default custom thresholds', () => {
    const info = getPeriodInfo(d('2020-01-01'), 36, 'custom', DEFAULT_CUSTOM_RULE_SET)
    expect(toISODateString(info.periodStart)).toBe('2023-01-01')
    expect(info.nextMilestoneMonths).toBe(48)
    expect(toISODateString(info.periodEnd)).toBe('2023-12-31')
    expect(info.entitledDays).toBe(14)
  })

  it('never ends before it starts when custom thresholds are duplicated', () => {
    const custom = [{ months: 6, days: 1 }, { months: 6, days: 2 }, { months: 12, days: 3 }]
    const info = getPeriodInfo(d('2020-01-01'), 6, 'custom', custom)
    expect(info.periodEnd.getTime()).toBeGreaterThanOrEqual(info.periodStart.getTime())
  })

  it("keeps a short remainder period's days at the threshold it falls under, without proration", () => {
    const custom = [{ months: 6, days: 3 }, { months: 12, days: 7 }, { months: 30, days: 14 }]
    const info = getPeriodInfo(d('2020-01-01'), 24, 'custom', custom)
    expect(toISODateString(info.periodStart)).toBe('2022-01-01')
    expect(toISODateString(info.periodEnd)).toBe('2022-06-30')
    expect(info.entitledDays).toBe(7)
  })
})

describe('getPeriodContainingDate', () => {
  const onboard = d('2023-01-08')

  it('returns null before the first milestone is reached', () => {
    expect(getPeriodContainingDate(onboard, d('2023-06-01'), 'labor', [])).toBeNull()
  })

  it('returns the correct period exactly on a milestone day', () => {
    const period = getPeriodContainingDate(onboard, d('2023-07-08'), 'labor', [])
    expect(period.milestoneMonths).toBe(6)
  })

  it('returns the correct period mid-way through it', () => {
    const period = getPeriodContainingDate(onboard, d('2023-10-01'), 'labor', [])
    expect(period.milestoneMonths).toBe(6)
  })
})

describe('getLeaveTakenInPeriod', () => {
  const periodStart = d('2024-01-08')
  const periodEnd = d('2025-01-07')

  it('includes records exactly on the boundary dates', () => {
    const records = [
      { startDate: '2024-01-08', days: 1 },
      { startDate: '2025-01-07', days: 1 },
    ]
    expect(getLeaveTakenInPeriod(records, periodStart, periodEnd)).toBe(2)
  })

  it('excludes records outside the period', () => {
    const records = [
      { startDate: '2024-01-07', days: 1 },
      { startDate: '2025-01-08', days: 1 },
    ]
    expect(getLeaveTakenInPeriod(records, periodStart, periodEnd)).toBe(0)
  })

  it('sums multiple records within the period', () => {
    const records = [
      { startDate: '2024-02-01', days: 1 },
      { startDate: '2024-03-01', days: 2.5 },
      { startDate: '2024-04-01', days: 0.25 },
    ]
    expect(getLeaveTakenInPeriod(records, periodStart, periodEnd)).toBe(3.75)
  })
})

describe('getLeaveRecordDates', () => {
  it('skips the weekend and continues counting into the following week (2026-09-01 is a Tuesday)', () => {
    expect(getLeaveRecordDates('2026-09-01', 5)).toEqual([
      '2026-09-01', '2026-09-02', '2026-09-03', '2026-09-04', '2026-09-07',
    ])
  })

  it('does not cross into the weekend when the count already ends on a Friday (2026-08-31 is a Monday)', () => {
    expect(getLeaveRecordDates('2026-08-31', 5)).toEqual([
      '2026-08-31', '2026-09-01', '2026-09-02', '2026-09-03', '2026-09-04',
    ])
  })

  it('still marks the date of a fractional trailing day', () => {
    expect(getLeaveRecordDates('2026-08-31', 2.5)).toEqual([
      '2026-08-31', '2026-09-01', '2026-09-02',
    ])
  })
})

describe('computePeriodLedger', () => {
  // 6~12mo period: 2024-03-01 ~ 2024-08-31 (3 days)
  // 12~24mo period: 2024-09-01 ~ 2025-08-31 (7 days)
  // 24~36mo period: 2025-09-01 ~ 2026-08-31 (10 days)
  const onboard = d('2023-09-01')
  const asOfDate = d('2025-09-01') // covers the chain through the 24~36mo period

  it('settles the old bucket while the current period\'s own leftover carries on', () => {
    const records = [{ startDate: '2024-08-31', days: 1 }, { startDate: '2025-08-31', days: 1 }]
    const ledger = computePeriodLedger(onboard, 'labor', [], records, asOfDate, true)
    expect(ledger.find(e => e.milestoneMonths === 12)).toMatchObject({
      carryIn: 2, oldEnd: 1, newEnd: 7, settlement: 1, carryOut: 7,
    })
    expect(ledger.find(e => e.milestoneMonths === 24).carryIn).toBe(7)
  })

  it('settles cleanly (settlement 0) when the old bucket is exactly used up', () => {
    const records = [{ startDate: '2024-08-31', days: 1 }, { startDate: '2025-08-31', days: 2 }]
    const ledger = computePeriodLedger(onboard, 'labor', [], records, asOfDate, true)
    expect(ledger.find(e => e.milestoneMonths === 12)).toMatchObject({
      carryIn: 2, oldEnd: 0, newEnd: 7, settlement: 0, carryOut: 7,
    })
    expect(ledger.find(e => e.milestoneMonths === 24).carryIn).toBe(7)
  })

  it('carries an already-negative old bucket (inherited from an earlier period\'s overspend) forward into carryOut', () => {
    const records = [{ startDate: '2024-08-31', days: 4 }, { startDate: '2025-08-31', days: 1 }]
    const ledger = computePeriodLedger(onboard, 'labor', [], records, asOfDate, true)
    expect(ledger.find(e => e.milestoneMonths === 12)).toMatchObject({
      carryIn: -1, oldEnd: -1, newEnd: 6, settlement: 0, carryOut: 5,
    })
    expect(ledger.find(e => e.milestoneMonths === 24).carryIn).toBe(5)
  })

  it('settles every period independently with no carry-in when allowCarryover is false', () => {
    const records = [{ startDate: '2024-08-31', days: 1 }]
    const ledger = computePeriodLedger(onboard, 'labor', [], records, asOfDate, false)
    expect(ledger.find(e => e.milestoneMonths === 6)).toMatchObject({
      carryIn: 0, oldEnd: 0, newEnd: 2, settlement: 2, carryOut: 0,
    })
    expect(ledger.find(e => e.milestoneMonths === 12).carryIn).toBe(0)
  })
})

describe('validateRecordsChain', () => {
  const onboardDate = '2023-09-01'
  const asOfDate = d('2025-09-01') // ensures the chain covers at least through the 12~24mo period

  it('allows spending up to the combined old+current+next entitlement when carryover is enabled', () => {
    const settings = { onboardDate, ruleType: 'labor', customRules: [], allowCarryover: true }
    const records = [{ startDate: '2024-05-01', days: 10 }] // 6~12mo entitlement (3) + 12~24mo entitlement (7)
    expect(validateRecordsChain(settings, records, asOfDate).valid).toBe(true)
  })

  it('rejects one day beyond the combined entitlement limit when carryover is enabled', () => {
    const settings = { onboardDate, ruleType: 'labor', customRules: [], allowCarryover: true }
    const records = [{ startDate: '2024-05-01', days: 11 }]
    expect(validateRecordsChain(settings, records, asOfDate).valid).toBe(false)
  })

  it('allows using exactly the current period\'s own entitlement when carryover is disabled', () => {
    const settings = { onboardDate, ruleType: 'labor', customRules: [], allowCarryover: false }
    const records = [{ startDate: '2024-05-01', days: 3 }]
    expect(validateRecordsChain(settings, records, asOfDate).valid).toBe(true)
  })

  it('rejects any overspend beyond the current period\'s own entitlement when carryover is disabled, even though it would fit within the combined limit', () => {
    const settings = { onboardDate, ruleType: 'labor', customRules: [], allowCarryover: false }
    const records = [{ startDate: '2024-05-01', days: 4 }]
    expect(validateRecordsChain(settings, records, asOfDate).valid).toBe(false)
  })

  describe('re-validating the whole chain after editing an earlier record', () => {
    const settings = { onboardDate, ruleType: 'labor', customRules: [], allowCarryover: true }
    // Initial legal state: 6~12mo has 1 day (carryOut 2), 12~24mo has 15 days
    // (legal when added: availableTotal = 2+7-15 = -6, not below -10).
    const initialRecords = [
      { startDate: '2024-05-01', days: 1 },
      { startDate: '2024-10-01', days: 15 },
    ]

    it('accepts the initial state as legal', () => {
      expect(validateRecordsChain(settings, initialRecords, asOfDate).valid).toBe(true)
    })

    it('rejects editing the earlier record even though it is legal in isolation, because it pushes a later period out of range', () => {
      // Editing the 6~12mo record from 1 to 10 days is exactly at its own boundary
      // (0+3-10 = -7, equal to the -7 threshold, allowed alone). But it drops the
      // carryIn flowing into 12~24mo from 2 to -7, making that period's own
      // availableTotal (-7+7-15 = -15) fall below its -10 threshold.
      const editedRecords = [
        { startDate: '2024-05-01', days: 10 },
        { startDate: '2024-10-01', days: 15 },
      ]
      const result = validateRecordsChain(settings, editedRecords, asOfDate)
      expect(result.valid).toBe(false)
      expect(result.invalidPeriod.milestoneMonths).toBe(12)
    })

    it('always accepts deleting the earlier record, since it can only free up room in later periods', () => {
      const recordsAfterDelete = initialRecords.filter(r => r.startDate !== '2024-05-01')
      expect(validateRecordsChain(settings, recordsAfterDelete, asOfDate).valid).toBe(true)
    })
  })
})

describe('calculateSummary', () => {
  const today = d('2025-06-15')

  it('reports hasLeave: false with a message and empty periods when onboardDate is missing', () => {
    const result = calculateSummary({ onboardDate: '', ruleType: 'labor', customRules: [], allowCarryover: false }, [], today)
    expect(result.hasLeave).toBe(false)
    expect(result.message).toBeTruthy()
    expect(result.periods).toEqual([])
  })

  it('reports hasLeave: false with a first-milestone message and empty periods before minimum tenure', () => {
    const settings = { onboardDate: '2025-06-01', ruleType: 'labor', customRules: [], allowCarryover: false }
    const result = calculateSummary(settings, [], today)
    expect(result.hasLeave).toBe(false)
    expect(result.message).toContain('2025-12-01')
    expect(result.periods).toEqual([])
  })

  it('computes the latest period correctly with no carryover', () => {
    // 2023-06-15 -> 2025-06-15 is exactly 24 completed months -> milestone 24 -> 10 days.
    // There are two earlier periods (milestone 6 and 12), so periods[length-2] here is
    // milestone 12's period info -- allowCarryover only controls whether carryIn/
    // carryOut are nonzero, not whether a previous period exists in the chain at all.
    const settings = { onboardDate: '2023-06-15', ruleType: 'labor', customRules: [], allowCarryover: false }
    // Current period starts exactly on 2025-06-15 (the milestone date), so a record
    // dated 2025-01-01 would actually fall in the *previous* period, not this one.
    const records = [{ startDate: '2025-06-20', days: 2 }]
    const result = calculateSummary(settings, records, today)
    expect(result.hasLeave).toBe(true)
    expect(result.periods).toHaveLength(3)
    const current = result.periods[result.periods.length - 1]
    const previous = result.periods[result.periods.length - 2]
    expect(current.entitledDays).toBe(10)
    expect(current.taken).toBe(2)
    expect(current.carryIn).toBe(0)
    expect(current.remaining).toBe(8)
    expect(previous.milestoneMonths).toBe(12)
    expect(previous.settlement).toBe(7)
    expect(previous.carryOut).toBe(0)
  })

  it('adds carryover from the previous period when it has remaining days', () => {
    const settings = { onboardDate: '2022-06-15', ruleType: 'labor', customRules: [], allowCarryover: true }
    // At 2025-06-15: completed months = 36 -> current milestone 36 (14 days)
    // Previous milestone 24 (10 days), no records taken anywhere in the chain -> carryOut 10
    const result = calculateSummary(settings, [], today)
    expect(result.hasLeave).toBe(true)
    expect(result.periods.length).toBeGreaterThanOrEqual(2)
    const current = result.periods[result.periods.length - 1]
    const previous = result.periods[result.periods.length - 2]
    expect(previous.carryOut).toBe(10)
    expect(current.carryIn).toBe(10)
    expect(current.remaining).toBe(current.entitledDays + 10)
  })

  it('still carries forward the period\'s own untouched entitlement when its inherited old bucket is fully consumed by the spend', () => {
    const settings = { onboardDate: '2022-06-15', ruleType: 'labor', customRules: [], allowCarryover: true }
    // Previous period (milestone 24, 10 days, spans 2024-06-15 ~ 2025-06-14) is fully used (taken=10),
    // but it had itself inherited a carryIn of 7 (3 from milestone 6, unused, settling through milestone 12)
    // from the untouched earlier periods. Only the carryIn is consumed here (up to taken), so the
    // period's own new bucket (10 - 3 = 7) still carries forward.
    const records = [{ startDate: '2024-07-01', days: 10 }]
    const result = calculateSummary(settings, records, today)
    const current = result.periods[result.periods.length - 1]
    const previous = result.periods[result.periods.length - 2]
    expect(previous.settlement).toBe(0)
    expect(previous.carryOut).toBe(7)
    expect(current.carryIn).toBe(7)
    expect(current.remaining).toBe(current.entitledDays + 7)
  })

  it('clamps carryover to 0 when several consecutive periods each fully use their own entitlement', () => {
    const settings = { onboardDate: '2022-06-15', ruleType: 'labor', customRules: [], allowCarryover: true }
    // 6~12mo (3 days), 12~24mo (7 days), 24~36mo (10 days) each exactly use up their own bucket,
    // so nothing ever accumulates and the chain carries 0 forward at every hop.
    const records = [
      { startDate: '2022-12-20', days: 3 },
      { startDate: '2023-07-01', days: 7 },
      { startDate: '2024-07-01', days: 10 },
    ]
    const result = calculateSummary(settings, records, today)
    const current = result.periods[result.periods.length - 1]
    const previous = result.periods[result.periods.length - 2]
    expect(previous.settlement).toBe(0)
    expect(previous.carryOut).toBe(0)
    expect(current.carryIn).toBe(0)
    expect(current.remaining).toBe(current.entitledDays)
  })

  it('does not error when carryover is enabled but currently in the first period', () => {
    // onboard 2024-12-01 -> exactly 6 completed months at today (2025-06-15) -> first milestone, no previous period
    const settings = { onboardDate: '2024-12-01', ruleType: 'labor', customRules: [], allowCarryover: true }
    const result = calculateSummary(settings, [], today)
    expect(result.hasLeave).toBe(true)
    expect(result.periods).toHaveLength(1)
  })

  it('returns all periods in ascending time order when the chain spans 3+ periods', () => {
    const settings = { onboardDate: '2022-06-15', ruleType: 'labor', customRules: [], allowCarryover: false }
    const result = calculateSummary(settings, [], today)
    expect(result.periods.length).toBeGreaterThanOrEqual(3)
    for (let i = 1; i < result.periods.length; i++) {
      expect(result.periods[i].periodStart.getTime()).toBeGreaterThan(result.periods[i - 1].periodStart.getTime())
    }
  })

  it('starts a new 12-month period every year under the default custom thresholds', () => {
    const settings = { onboardDate: '2020-01-01', ruleType: 'custom', customRules: DEFAULT_CUSTOM_RULE_SET, allowCarryover: false }
    const result = calculateSummary(settings, [], d('2024-01-01'))
    expect(result.hasLeave).toBe(true)
    expect(result.periods).toHaveLength(5)
    const current = result.periods[result.periods.length - 1]
    expect(current.milestoneMonths).toBe(48)
    expect(toISODateString(current.periodStart)).toBe('2024-01-01')
    expect(toISODateString(current.periodEnd)).toBe('2024-12-31')
    expect(current.entitledDays).toBe(14)
  })

  // Simulates existing localStorage data saved before #19 was fixed with a
  // looser period-boundary rule: after the fix, this record gets re-gridded
  // into a shorter period and now looks overspent (D17). This test only
  // guards against a crash / hasLeave flip, not against the overspend itself.
  it('does not throw and reports negative remaining when re-gridded periods make a previously-valid record look overspent (#19)', () => {
    const today = d('2022-03-01')
    const settings = {
      onboardDate: '2020-01-01',
      ruleType: 'custom',
      customRules: [{ months: 6, days: 3 }, { months: 12, days: 7 }, { months: 30, days: 14 }],
      allowCarryover: false,
    }
    const records = [{ startDate: '2022-02-01', days: 10 }]
    const result = calculateSummary(settings, records, today)
    expect(result.hasLeave).toBe(true)
    const current = result.periods.find(p => p.milestoneMonths === 24)
    expect(current.remaining).toBe(-3)
  })
})

describe('formatPeriodLabel', () => {
  it('returns a plain year when the period starts and ends in the same calendar year', () => {
    expect(formatPeriodLabel(d('2025-01-01'), d('2025-12-31'))).toBe('2025')
  })

  it('returns a year-range with an en dash when the period spans two calendar years', () => {
    expect(formatPeriodLabel(d('2025-06-15'), d('2026-06-14'))).toBe('2025–26')
  })
})

describe('checkLaborLawCompliance', () => {
  it('flags custom rules below the labor law minimum', () => {
    const custom = [{ months: 12, days: 5 }] // labor law min at 12mo is 7
    const warnings = checkLaborLawCompliance(custom)
    expect(warnings).toHaveLength(1)
    expect(warnings[0]).toMatchObject({ months: 12, customDays: 5, legalMinimum: 7 })
  })

  it('does not flag rules that meet or exceed the labor law minimum', () => {
    const custom = [{ months: 12, days: 7 }, { months: 24, days: 12 }]
    expect(checkLaborLawCompliance(custom)).toHaveLength(0)
  })

  it('returns an empty array for an empty rule set', () => {
    expect(checkLaborLawCompliance([])).toEqual([])
  })
})
