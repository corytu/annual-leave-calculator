import { describe, it, expect } from 'vitest'
import { validateSettingsInput } from './settingsValidation.js'
import { MAX_MILESTONE_MONTHS, MAX_ANNUAL_LEAVE_DAYS } from './leaveCalculations.js'

// A small custom rule set used as a valid baseline across tests. Last row
// (sorted by months) is 24mo/14 days, used by the cap-boundary tests below.
const BASE_RULES = [
  { months: '12', days: '10' },
  { months: '24', days: '14' },
]
const LAST_ROW_DAYS = 14

const DAYS_MESSAGE = `特休天數請填寫大於 0、不超過 ${MAX_ANNUAL_LEAVE_DAYS}、且為 0.25 的倍數的數字`
const PER_YEAR_MESSAGE = `每年增加天數請填寫 0 到 ${MAX_ANNUAL_LEAVE_DAYS} 之間、且為 0.25 的倍數的數字`
const CAP_MESSAGE = `天數上限請填寫不低於 ${LAST_ROW_DAYS}（最後一列的天數）、不超過 ${MAX_ANNUAL_LEAVE_DAYS}、且為 0.25 的倍數的數字`

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

describe('validateSettingsInput', () => {
  it('requires the onboard date', () => {
    expect(validateSettingsInput(input({ onboardDate: '' }))).toBe('請填寫到職日')
  })

  it('skips every custom-only check for ruleType "labor", even with empty/invalid fields', () => {
    expect(validateSettingsInput({
      onboardDate: '2024-01-01',
      ruleType: 'labor',
      customRules: [],
      growthPerYear: '',
      growthCap: '',
    })).toBeNull()
  })

  it('requires at least one custom rule', () => {
    expect(validateSettingsInput(input({ customRules: [] }))).toBe('請至少保留一條自訂規則')
  })

  it.each([
    ['non-integer', 1.5],
    ['below 1', 0],
    [`above ${MAX_MILESTONE_MONTHS}`, MAX_MILESTONE_MONTHS + 1],
  ])('rejects a threshold that is %s', (_label, months) => {
    const rules = [{ months, days: 10 }]
    expect(validateSettingsInput(input({ customRules: rules })))
      .toBe(`年資門檻請填寫 ${MAX_MILESTONE_MONTHS} 個月（${MAX_MILESTONE_MONTHS / 12} 年）以內的正整數`)
  })

  it('rejects duplicate thresholds', () => {
    const rules = [{ months: 12, days: 10 }, { months: 12, days: 14 }]
    expect(validateSettingsInput(input({ customRules: rules })))
      .toBe('年資門檻「12 個月」重複，請合併或刪除其中一列')
  })

  describe('custom rule days (#45)', () => {
    it('accepts exactly MAX_ANNUAL_LEAVE_DAYS', () => {
      const rules = [{ months: 12, days: MAX_ANNUAL_LEAVE_DAYS }]
      expect(validateSettingsInput(input({ customRules: rules }))).toBeNull()
    })

    it.each([
      ['MAX + 0.25 (legal step, over the ceiling)', MAX_ANNUAL_LEAVE_DAYS + 0.25],
      ['MAX + 0.1 (also violates the 0.25 step)', MAX_ANNUAL_LEAVE_DAYS + 0.1],
      ['zero', 0],
      ['negative', -1],
      ['not a multiple of 0.25 (364.1)', 364.1],
      ['a huge value (1e23)', 1e23],
      ['Infinity', Infinity],
      ['an empty string', ''],
    ])('rejects %s', (_label, days) => {
      const rules = [{ months: 12, days }]
      expect(validateSettingsInput(input({ customRules: rules }))).toBe(DAYS_MESSAGE)
    })
  })

  describe('perYear (#45)', () => {
    it('accepts exactly MAX_ANNUAL_LEAVE_DAYS', () => {
      // A valid cap must accompany a nonzero perYear, or the cap check below
      // (growthCap defaults to '0', below the last row) would fail first.
      expect(validateSettingsInput(input({
        growthPerYear: String(MAX_ANNUAL_LEAVE_DAYS),
        growthCap: String(MAX_ANNUAL_LEAVE_DAYS),
      }))).toBeNull()
    })

    it.each([
      ['MAX + 0.25', String(MAX_ANNUAL_LEAVE_DAYS + 0.25)],
      ['MAX + 0.1', String(MAX_ANNUAL_LEAVE_DAYS + 0.1)],
      ['a huge value (1e23)', '1e23'],
      ['an empty string', ''],
      ['negative', '-1'],
      ['not a multiple of 0.25', '1.1'],
    ])('rejects %s', (_label, growthPerYear) => {
      expect(validateSettingsInput(input({ growthPerYear }))).toBe(PER_YEAR_MESSAGE)
    })
  })

  describe('cap, only validated when perYear > 0 (#45)', () => {
    it('accepts exactly MAX_ANNUAL_LEAVE_DAYS', () => {
      expect(validateSettingsInput(input({ growthPerYear: '1', growthCap: String(MAX_ANNUAL_LEAVE_DAYS) }))).toBeNull()
    })

    it('accepts exactly the last row\'s day count', () => {
      expect(validateSettingsInput(input({ growthPerYear: '1', growthCap: String(LAST_ROW_DAYS) }))).toBeNull()
    })

    it.each([
      ['MAX + 0.25', String(MAX_ANNUAL_LEAVE_DAYS + 0.25)],
      ['MAX + 0.1', String(MAX_ANNUAL_LEAVE_DAYS + 0.1)],
      ['9000.1', '9000.1'],
      ['an empty string', ''],
      ['not a number ("abc")', 'abc'],
      ['below the last row\'s days', '10'],
      ['16.1 (not a 0.25 step)', '16.1'],
    ])('rejects %s', (_label, growthCap) => {
      expect(validateSettingsInput(input({ growthPerYear: '1', growthCap }))).toBe(CAP_MESSAGE)
    })

    it('does not validate the cap at all when perYear is 0, even with a stale invalid value (C4)', () => {
      expect(validateSettingsInput(input({ growthPerYear: '0', growthCap: '9000' }))).toBeNull()
      expect(validateSettingsInput(input({ growthPerYear: '0', growthCap: '' }))).toBeNull()
    })
  })

  it('reports the rule-days message, not the cap message, when a row is over the ceiling and the cap is also invalid (C3: rows validate before growth)', () => {
    const rules = [{ months: 12, days: MAX_ANNUAL_LEAVE_DAYS + 0.25 }]
    expect(validateSettingsInput(input({
      customRules: rules,
      growthPerYear: '1',
      growthCap: String(MAX_ANNUAL_LEAVE_DAYS + 0.25),
    }))).toBe(DAYS_MESSAGE)
  })

  it('accepts the default custom rules with a valid growth row', () => {
    expect(validateSettingsInput(input({ growthPerYear: '1', growthCap: '30' }))).toBeNull()
  })
})
