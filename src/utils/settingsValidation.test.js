import { describe, it, expect } from 'vitest'
import { validateSettingsInput } from './settingsValidation.js'
import { MAX_MILESTONE_MONTHS } from './leaveCalculations.js'

// A small custom rule set used as a valid baseline across tests.
const BASE_RULES = [
  { months: '12', days: '10' },
  { months: '24', days: '14' },
]

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

  it.each([
    ['zero', 0],
    ['negative', -1],
    ['empty string', ''],
  ])('rejects a rule day count that is %s', (_label, days) => {
    const rules = [{ months: 12, days }]
    expect(validateSettingsInput(input({ customRules: rules })))
      .toBe('特休天數請填寫大於 0 的數字')
  })

  it.each([
    ['empty string', ''],
    ['negative', '-1'],
    ['not a multiple of 0.25', '1.3'],
  ])('rejects perYear that is %s', (_label, growthPerYear) => {
    expect(validateSettingsInput(input({ growthPerYear })))
      .toBe('每年增加天數請填寫大於等於 0、且為 0.25 的倍數的數字')
  })

  describe('when growthPerYear > 0', () => {
    it('requires the cap to be a number', () => {
      expect(validateSettingsInput(input({ growthPerYear: '1', growthCap: '' })))
        .toBe('天數上限請填寫數字')
    })

    it('rejects a cap below the last row\'s days', () => {
      // Last row (sorted by months) is 24mo/14 days.
      expect(validateSettingsInput(input({ growthPerYear: '1', growthCap: '10' })))
        .toBe('天數上限不可低於最後一列的天數（14 天）')
    })

    it('rejects a cap that is not a multiple of 0.25', () => {
      expect(validateSettingsInput(input({ growthPerYear: '1', growthCap: '20.1' })))
        .toBe('天數上限請填寫 0.25 的倍數')
    })
  })

  it('does not validate the cap at all when growthPerYear is 0, even with a stale invalid value', () => {
    expect(validateSettingsInput(input({ growthPerYear: '0', growthCap: '9000' }))).toBeNull()
    expect(validateSettingsInput(input({ growthPerYear: '0', growthCap: '' }))).toBeNull()
  })

  it('accepts the default custom rules with a valid growth row', () => {
    expect(validateSettingsInput(input({ growthPerYear: '1', growthCap: '30' }))).toBeNull()
  })
})
