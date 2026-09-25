import { describe, it, expect } from 'vitest'
import {
  addMonthsToDate,
  getCompletedMonths,
  toISODateString,
  parseLocalDate,
  getDefaultVisibleMonth,
  getLaborLawDays,
  getDaysForMilestone,
  getMilestones,
  getPeriodInfo,
  getPeriodContainingDate,
  getLeaveTakenInPeriod,
  getLeaveRecordDates,
  makeIsNonWorkingDay,
  computePeriodLedger,
  validateRecordsChain,
  calculateSummary,
  formatPeriodLabel,
  checkLaborLawCompliance,
  NO_CUSTOM_GROWTH,
  MAX_MILESTONE_MONTHS,
  MAX_ANNUAL_LEAVE_DAYS,
  MAX_LEAVE_RECORD_DATES,
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

describe('getDefaultVisibleMonth', () => {
  const periodStart = d('2025-06-01')
  const periodEnd = d('2026-05-31')

  it('defaults to the month containing today when today falls inside the period', () => {
    const today = d('2025-08-20')
    expect(toISODateString(getDefaultVisibleMonth(periodStart, periodEnd, today))).toBe('2025-08-01')
  })

  it('falls back to the period start month when today is before the period', () => {
    const today = d('2025-01-15')
    expect(toISODateString(getDefaultVisibleMonth(periodStart, periodEnd, today))).toBe('2025-06-01')
  })

  it('falls back to the period start month when today is after the period', () => {
    const today = d('2026-09-01')
    expect(toISODateString(getDefaultVisibleMonth(periodStart, periodEnd, today))).toBe('2025-06-01')
  })

  it('still recognizes periodEnd as "inside" the period when today carries a non-midnight time', () => {
    const todayWithTime = new Date(2026, 4, 31, 23, 59, 30) // 2026-05-31 23:59:30, same day as periodEnd
    expect(toISODateString(getDefaultVisibleMonth(periodStart, periodEnd, todayWithTime))).toBe('2026-05-01')
  })

  it('defaults to `new Date()` when today is not passed', () => {
    expect(getDefaultVisibleMonth(d('1970-01-01'), d('2999-01-01')).getDate()).toBe(1)
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

  it('first reaches the 30-day cap at 288 months (24 years)', () => {
    expect(getLaborLawDays(287)).toBe(29)
    expect(getLaborLawDays(288)).toBe(30)
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

  describe('customGrowth', () => {
    it('applies no growth by default (NO_CUSTOM_GROWTH), even past the last threshold', () => {
      expect(getDaysForMilestone(240, 'custom', DEFAULT_CUSTOM_RULE_SET)).toBe(16)
      expect(getDaysForMilestone(240, 'custom', DEFAULT_CUSTOM_RULE_SET, NO_CUSTOM_GROWTH)).toBe(16)
    })

    it('adds perYear days for each full year past the last threshold', () => {
      const growth = { perYear: 1, cap: 30 }
      expect(getDaysForMilestone(132, 'custom', DEFAULT_CUSTOM_RULE_SET, growth)).toBe(17)
      expect(getDaysForMilestone(144, 'custom', DEFAULT_CUSTOM_RULE_SET, growth)).toBe(18)
    })

    it('does not apply growth exactly at the last threshold, only past it', () => {
      const growth = { perYear: 1, cap: 30 }
      expect(getDaysForMilestone(120, 'custom', DEFAULT_CUSTOM_RULE_SET, growth)).toBe(16)
    })

    it('does not apply growth for a milestone between two earlier thresholds, even past the nearest one', () => {
      // Milestone 48 sits between the 36mo (14 days) and 60mo (15 days)
      // thresholds -- growth must not kick in just because 48 > 36; only
      // milestones past the *last* threshold (120) are eligible.
      const growth = { perYear: 1, cap: 30 }
      expect(getDaysForMilestone(48, 'custom', DEFAULT_CUSTOM_RULE_SET, growth)).toBe(14)
    })

    it('caps growth at the configured cap', () => {
      const growth = { perYear: 5, cap: 20 }
      expect(getDaysForMilestone(132, 'custom', DEFAULT_CUSTOM_RULE_SET, growth)).toBe(20)
    })

    it('never lets a misconfigured cap shrink days below the last threshold', () => {
      const growth = { perYear: 1, cap: 10 } // cap (10) is below the last threshold's days (16)
      expect(getDaysForMilestone(132, 'custom', DEFAULT_CUSTOM_RULE_SET, growth)).toBe(16)
    })

    it('coerces a null or malformed customGrowth into no growth instead of throwing', () => {
      expect(getDaysForMilestone(132, 'custom', DEFAULT_CUSTOM_RULE_SET, null)).toBe(16)
      expect(getDaysForMilestone(132, 'custom', DEFAULT_CUSTOM_RULE_SET, { perYear: 'abc', cap: 'xyz' })).toBe(16)
      expect(getDaysForMilestone(132, 'custom', DEFAULT_CUSTOM_RULE_SET, { perYear: -5, cap: -5 })).toBe(16)
    })

    it('coerces a string days value in customRules into a number for growth math', () => {
      const custom = [{ months: 12, days: '7' }]
      const growth = { perYear: 1, cap: 20 }
      expect(getDaysForMilestone(24, 'custom', custom, growth)).toBe(8) // not '7' + 1 = '71'
    })

    it('ignores a rule with an invalid months value (e.g. cleared to 0 mid-edit) for the base days', () => {
      // Same filter as normalizeCustomThresholds: a 0-months row never
      // becomes a real milestone, so it must not contribute days either.
      const custom = [{ months: 0, days: 3 }, { months: 12, days: 7 }]
      expect(getDaysForMilestone(6, 'custom', custom)).toBe(0)
      expect(getDaysForMilestone(12, 'custom', custom)).toBe(7)
    })

    it('does not let a threshold beyond MAX_MILESTONE_MONTHS silently become the growth anchor', () => {
      const custom = [{ months: 12, days: 7 }, { months: 1201, days: 20 }]
      const growth = { perYear: 1, cap: 30 }
      // The 1201mo row is dropped, so 12mo (7 days) is the effective last
      // threshold and growth kicks in past it, not past the invalid 1201mo row.
      expect(getDaysForMilestone(24, 'custom', custom, growth)).toBe(8)
    })
  })

  describe('MAX_ANNUAL_LEAVE_DAYS clamp (#45)', () => {
    it('clamps a threshold-path day count that exceeds the ceiling', () => {
      expect(getDaysForMilestone(12, 'custom', [{ months: 12, days: 500 }])).toBe(MAX_ANNUAL_LEAVE_DAYS)
    })

    it('clamps a growth-path day count that exceeds the ceiling', () => {
      const growth = { perYear: 400, cap: 9000 }
      expect(getDaysForMilestone(132, 'custom', DEFAULT_CUSTOM_RULE_SET, growth)).toBe(MAX_ANNUAL_LEAVE_DAYS)
    })

    it('returns a value exactly at the ceiling unchanged', () => {
      expect(getDaysForMilestone(12, 'custom', [{ months: 12, days: MAX_ANNUAL_LEAVE_DAYS }])).toBe(MAX_ANNUAL_LEAVE_DAYS)
    })

    it('falls back to 0 instead of NaN when stored data is missing a days value', () => {
      // { months: 12 } normalizes to days: Number(undefined) = NaN, which
      // would otherwise poison every Math.min comparison and slip through
      // unclamped.
      expect(getDaysForMilestone(12, 'custom', [{ months: 12 }])).toBe(0)
    })

    it('falls back to 0 on the growth path too, not just the threshold path', () => {
      // Same NaN-from-missing-days hazard as the previous test, but with
      // growth active (perYear > 0, past the last threshold) so it forces
      // the *other* Number.isFinite fallback (the one guarding `grown`),
      // not the threshold-path one above.
      const growth = { perYear: 1, cap: 30 }
      expect(getDaysForMilestone(24, 'custom', [{ months: 12 }], growth)).toBe(0)
    })
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

  it('applies customGrowth to entitledDays past the last custom threshold', () => {
    const info = getPeriodInfo(d('2020-01-01'), 132, 'custom', DEFAULT_CUSTOM_RULE_SET, { perYear: 1, cap: 30 })
    expect(info.entitledDays).toBe(17)
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

  describe('MAX_LEAVE_RECORD_DATES bound (#29)', () => {
    it('stops at MAX_LEAVE_RECORD_DATES instead of hanging for an absurd day count', () => {
      expect(getLeaveRecordDates('2026-09-01', 1e6)).toHaveLength(MAX_LEAVE_RECORD_DATES)
    })

    it('does not truncate a day count exactly at the bound', () => {
      expect(getLeaveRecordDates('2026-09-01', MAX_LEAVE_RECORD_DATES)).toHaveLength(MAX_LEAVE_RECORD_DATES)
    })

    it('still yields the full bound when the count is just under it, since the trailing fractional day occupies a date', () => {
      expect(getLeaveRecordDates('2026-09-01', MAX_LEAVE_RECORD_DATES - 0.5)).toHaveLength(MAX_LEAVE_RECORD_DATES)
    })

    it.each([
      ['Infinity', Infinity],
      ['NaN', NaN],
      ['a non-numeric string', 'abc'],
      ['undefined', undefined],
    ])('returns an empty array for a non-finite day count (%s)', (_label, days) => {
      expect(getLeaveRecordDates('2026-09-01', days)).toEqual([])
    })

    it('treats a numeric string the same as the equivalent number', () => {
      expect(getLeaveRecordDates('2026-09-01', '5')).toEqual(getLeaveRecordDates('2026-09-01', 5))
    })
  })

  describe('isNonWorkingDay (holiday-aware expansion, #33)', () => {
    it('defaults to weekends-only when no predicate is passed (backward compatible)', () => {
      expect(getLeaveRecordDates('2026-09-01', 5)).toEqual(
        getLeaveRecordDates('2026-09-01', 5, undefined)
      )
    })

    it('skips a date the predicate reports as non-working, even a weekday (2026-09-03 is a Thursday)', () => {
      const isNonWorkingDay = (date) => toISODateString(date) === '2026-09-03'
      expect(getLeaveRecordDates('2026-09-01', 3, isNonWorkingDay)).toEqual([
        '2026-09-01', '2026-09-02', '2026-09-04',
      ])
    })

    it('treats a Saturday the predicate reports as working (補班) as a spanned date', () => {
      // 2026-09-05 is a Saturday; the predicate says it's a working day.
      const isNonWorkingDay = (date) => date.getDay() === 0
      expect(getLeaveRecordDates('2026-09-04', 3, isNonWorkingDay)).toEqual([
        '2026-09-04', '2026-09-05', '2026-09-07',
      ])
    })
  })
})

describe('makeIsNonWorkingDay', () => {
  it('uses the holiday dates Set for a year with `available` status', () => {
    const isNonWorkingDay = makeIsNonWorkingDay({
      2025: { status: 'available', dates: new Set(['2025-01-01']) },
    })
    expect(isNonWorkingDay(d('2025-01-01'))).toBe(true)
    // 2025-01-02 is a Thursday and not in the Set -- working, even though
    // it's a weekday anyway; the important part is the Set is authoritative.
    expect(isNonWorkingDay(d('2025-01-02'))).toBe(false)
  })

  it('treats an `available` weekend NOT in the dates Set as a working day (補班)', () => {
    // 2025-01-04 is a Saturday, deliberately absent from the Set.
    const isNonWorkingDay = makeIsNonWorkingDay({
      2025: { status: 'available', dates: new Set(['2025-01-01']) },
    })
    expect(isNonWorkingDay(d('2025-01-04'))).toBe(false)
  })

  it.each(['loading', 'pending', 'error', 'unavailable'])(
    'falls back to weekends-only for a year with status %s',
    (status) => {
      const isNonWorkingDay = makeIsNonWorkingDay({ 2025: { status } })
      expect(isNonWorkingDay(d('2025-01-01'))).toBe(false) // Wednesday
      expect(isNonWorkingDay(d('2025-01-04'))).toBe(true) // Saturday
    }
  )

  it('falls back to weekends-only for a year with no cache entry at all', () => {
    const isNonWorkingDay = makeIsNonWorkingDay({})
    expect(isNonWorkingDay(d('2025-01-01'))).toBe(false) // Wednesday
    expect(isNonWorkingDay(d('2025-01-04'))).toBe(true) // Saturday
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

  describe('MAX_ANNUAL_LEAVE_DAYS clamp bounds the overspend guard (#45)', () => {
    // Only threshold is 12mo with an absurd day count; without clamping,
    // the overspend guard below would accept a similarly absurd number of
    // leave days.
    const settings = {
      onboardDate: '2020-01-01',
      ruleType: 'custom',
      customRules: [{ months: 12, days: 1e6 }],
      allowCarryover: false,
    }
    const asOfDate = d('2021-06-01') // within milestone 12's period

    it('allows spending exactly the clamped entitlement', () => {
      const records = [{ startDate: '2021-01-15', days: MAX_ANNUAL_LEAVE_DAYS }]
      expect(validateRecordsChain(settings, records, asOfDate).valid).toBe(true)
    })

    it('rejects spending 0.25 days beyond the clamped entitlement', () => {
      const records = [{ startDate: '2021-01-15', days: MAX_ANNUAL_LEAVE_DAYS + 0.25 }]
      expect(validateRecordsChain(settings, records, asOfDate).valid).toBe(false)
    })
  })

  describe('a single record legitimately exceeding 30 days (#30)', () => {
    it('allows spending up to the combined 90-day allowance once entitlement has plateaued at 30 days/period', () => {
      // Labor law, onboard 2000-01-01, carryover on, asOf within milestone
      // 300's period (2025-01-01~2025-12-31), where entitlement has long
      // plateaued at 30 days/period -- so carryIn, entitledDays and
      // nextEntitled are each 30. With nothing taken beforehand:
      // availableTotal = carryIn 30 + entitled 30 - taken, which must be
      // >= -nextEntitled 30, so taken <= 90.
      const settings = { onboardDate: '2000-01-01', ruleType: 'labor', customRules: [], allowCarryover: true }
      const asOfDate = d('2025-06-15')
      const validRecords = [{ startDate: '2025-06-01', days: 90 }]
      const invalidRecords = [{ startDate: '2025-06-01', days: 90.25 }]
      expect(validateRecordsChain(settings, validRecords, asOfDate).valid).toBe(true)
      expect(validateRecordsChain(settings, invalidRecords, asOfDate).valid).toBe(false)
    })
  })

  describe('customGrowth affecting the next-period overspend threshold', () => {
    // Only threshold is 12mo (5 days); milestone 24 is a gap-filled repeat of
    // it. onboard 2020-01-01 -> milestone 12's period is 2021-01-01~2021-12-31
    // (the very first period in the chain, so carryIn is always 0 here).
    const baseSettings = {
      onboardDate: '2020-01-01',
      ruleType: 'custom',
      customRules: [{ months: 12, days: 5 }],
      allowCarryover: true,
    }
    const records = [{ startDate: '2021-06-01', days: 12 }]
    const asOfDate = d('2021-06-15') // still within milestone 12's period

    it('accepts an overspend that only fits within the next period\'s grown entitlement', () => {
      // availableTotal = 0 + 5 - 12 = -7. Next period (milestone 24) grows to
      // 5 + 2*floor((24-12)/12) = 5 + 2 = 7 days, so the threshold is -7 --
      // -7 is exactly at the boundary (allowed).
      const settings = { ...baseSettings, customGrowth: { perYear: 2, cap: 20 } }
      expect(validateRecordsChain(settings, records, asOfDate).valid).toBe(true)
    })

    it('rejects the same overspend when customGrowth is absent (ungrown next-period entitlement)', () => {
      // Same -7 availableTotal, but the next period's entitlement stays at
      // the base 5 days with no growth -> threshold -5, and -7 < -5.
      const settings = { ...baseSettings, customGrowth: { perYear: 0, cap: 0 } }
      expect(validateRecordsChain(settings, records, asOfDate).valid).toBe(false)
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

  it('reports hasLeave: false with a reset hint when custom rules have no valid thresholds', () => {
    const settings = { onboardDate: '2023-06-15', ruleType: 'custom', customRules: [], allowCarryover: false }
    const result = calculateSummary(settings, [], today)
    expect(result.hasLeave).toBe(false)
    expect(result.message).toContain('離職重來')
    expect(result.periods).toEqual([])
  })

  it('treats custom rules whose thresholds are all invalid the same as an empty rule set', () => {
    const settings = {
      onboardDate: '2023-06-15',
      ruleType: 'custom',
      customRules: [{ months: 0, days: 5 }, { months: -1, days: 5 }],
      allowCarryover: false,
    }
    const result = calculateSummary(settings, [], today)
    expect(result.hasLeave).toBe(false)
    expect(result.message).toContain('離職重來')
    expect(result.periods).toEqual([])
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

  it('applies customGrowth entitlement growth to the current period', () => {
    const settings = {
      onboardDate: '2010-01-01',
      ruleType: 'custom',
      customRules: DEFAULT_CUSTOM_RULE_SET,
      customGrowth: { perYear: 1, cap: 30 },
      allowCarryover: false,
    }
    // 2010-01-01 -> 2021-01-01 is exactly 132 completed months (11 years).
    const result = calculateSummary(settings, [], d('2021-01-01'))
    const current = result.periods[result.periods.length - 1]
    expect(current.milestoneMonths).toBe(132)
    expect(current.entitledDays).toBe(17)
  })

  it('ignores customGrowth entirely for ruleType "labor", even if present in settings', () => {
    const settings = {
      onboardDate: '2010-01-01',
      ruleType: 'labor',
      customRules: [],
      customGrowth: { perYear: 100, cap: 9999 },
      allowCarryover: false,
    }
    const result = calculateSummary(settings, [], today)
    const current = result.periods[result.periods.length - 1]
    expect(current.entitledDays).toBe(getLaborLawDays(current.milestoneMonths))
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

  it('clamps entitledDays at MAX_ANNUAL_LEAVE_DAYS for a settings blob with an absurd custom rule day count (#45)', () => {
    // Reproduces the #45 report: onboard date far enough in the past that a
    // custom rule of 1e23 days would otherwise flow straight into the summary.
    const settings = {
      onboardDate: '1900-01-01',
      ruleType: 'custom',
      customRules: [{ months: 12, days: 1e23 }],
      allowCarryover: false,
    }
    const result = calculateSummary(settings, [], d('2000-01-01'))
    expect(result.hasLeave).toBe(true)
    const current = result.periods[result.periods.length - 1]
    expect(current.entitledDays).toBe(MAX_ANNUAL_LEAVE_DAYS)
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
  it('returns an empty array for an empty rule set', () => {
    expect(checkLaborLawCompliance([])).toEqual([])
  })

  it('reports no warnings for the default custom rules with the default growth (matches labor law exactly)', () => {
    const growth = { perYear: 1, cap: 30 }
    expect(checkLaborLawCompliance(DEFAULT_CUSTOM_RULE_SET, growth)).toEqual([])
  })

  it('reports an open-ended warning starting past the last threshold when there is no growth', () => {
    const warnings = checkLaborLawCompliance(DEFAULT_CUSTOM_RULE_SET) // no growth arg -> NO_CUSTOM_GROWTH
    expect(warnings).toHaveLength(1)
    expect(warnings[0].fromMonths).toBe(132)
    expect(warnings[0].untilMonths).toBeNull()
  })

  it('reports a deficiency starting before the first custom threshold when it is later than 6 months', () => {
    const custom = [
      { months: 12, days: 7 }, { months: 24, days: 10 }, { months: 36, days: 14 },
      { months: 60, days: 15 }, { months: 120, days: 16 },
    ]
    const growth = { perYear: 1, cap: 30 }
    const warnings = checkLaborLawCompliance(custom, growth)
    expect(warnings).toHaveLength(1)
    expect(warnings[0]).toMatchObject({
      fromMonths: 6, untilMonths: 12,
      customDaysMin: 0, customDaysMax: 0,
      legalDaysMin: 3, legalDaysMax: 3,
    })
  })

  it('merges consecutive deficient checkpoints created by a gap between two custom thresholds into one range with min/max', () => {
    // Skips the 12mo and 24mo thresholds, so the 6mo threshold's 3 days
    // carries through several checkpoints (labor's 12/24 plus the custom
    // gap-fill's own 18/30) while labor law climbs from 7 to 10.
    const custom = [
      { months: 6, days: 3 }, { months: 36, days: 14 }, { months: 60, days: 15 }, { months: 120, days: 16 },
    ]
    const growth = { perYear: 1, cap: 30 }
    const warnings = checkLaborLawCompliance(custom, growth)
    expect(warnings).toHaveLength(1)
    expect(warnings[0]).toMatchObject({
      fromMonths: 12, untilMonths: 36,
      customDaysMin: 3, customDaysMax: 3,
      legalDaysMin: 7, legalDaysMax: 10,
    })
  })

  it('reports two non-adjacent deficient ranges as separate entries, not merged', () => {
    const custom = [
      { months: 6, days: 1 },  // below the 3-day minimum
      { months: 12, days: 7 }, // meets the minimum
      { months: 24, days: 5 }, // below the 10-day minimum
      { months: 36, days: 14 }, { months: 60, days: 15 }, { months: 120, days: 16 },
    ]
    const growth = { perYear: 1, cap: 30 }
    const warnings = checkLaborLawCompliance(custom, growth)
    expect(warnings).toHaveLength(2)
    expect(warnings[0]).toMatchObject({ fromMonths: 6, untilMonths: 12 })
    expect(warnings[1]).toMatchObject({ fromMonths: 24, untilMonths: 36 })
  })

  it('clamps the horizon at MAX_MILESTONE_MONTHS instead of hanging when perYear is vanishingly small', () => {
    const growth = { perYear: 0.001, cap: 30 }
    const warnings = checkLaborLawCompliance(DEFAULT_CUSTOM_RULE_SET, growth)
    expect(warnings).toHaveLength(1)
    expect(warnings[0].fromMonths).toBe(132)
    expect(warnings[0].untilMonths).toBeNull() // still deficient at the clamped horizon
    for (const w of warnings) {
      expect(w.fromMonths).toBeLessThanOrEqual(MAX_MILESTONE_MONTHS)
    }
  })
})
