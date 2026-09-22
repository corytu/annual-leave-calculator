import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { buildBackupCsv, downloadCsv } from './exportCsv.js'

describe('buildBackupCsv', () => {
  it('formats settings, records, and settlement into the expected CSV shape', () => {
    const settings = {
      onboardDate: '2023-06-15',
      ruleType: 'labor',
      customRules: [],
      allowCarryover: true,
    }
    const records = [
      { id: '2', startDate: '2024-02-01', days: 1 },
      { id: '1', startDate: '2024-01-08', days: 0.5 },
    ]
    const summary = {
      hasLeave: true,
      periods: [
        { remaining: 3 },
        { remaining: 5.5 },
      ],
    }

    const csv = buildBackupCsv(settings, records, summary)
    const lines = csv.split('\n')

    expect(lines).toEqual([
      '到職日,2023-06-15',
      '特休規則,勞基法',
      '允許遞延,是',
      '',
      '請假記錄',
      '開始日期,天數',
      '2024-01-08,0.5',
      '2024-02-01,1',
      '',
      '離職結清',
      '應結清工資天數,5.5',
    ])
  })

  it('outputs a negative settlement without altering its sign', () => {
    const settings = { onboardDate: '2023-06-15', ruleType: 'labor', customRules: [], allowCarryover: true }
    const summary = { hasLeave: true, periods: [{ remaining: -2.5 }] }

    const csv = buildBackupCsv(settings, [], summary)

    expect(csv).toContain('應結清工資天數,-2.5')
  })

  it('reports settlement as 0 when hasLeave is false', () => {
    const settings = { onboardDate: '2025-06-15', ruleType: 'labor', customRules: [], allowCarryover: false }
    const summary = { hasLeave: false, periods: [] }

    const csv = buildBackupCsv(settings, [], summary)

    expect(csv).toContain('應結清工資天數,0')
  })

  it('lists each custom rule as months,days when ruleType is custom', () => {
    const settings = {
      onboardDate: '2023-06-15',
      ruleType: 'custom',
      customRules: [
        { id: 'a', months: 6, days: 3 },
        { id: 'b', months: 12, days: 10 },
      ],
      allowCarryover: false,
      customGrowth: { perYear: 0, cap: 0 },
    }
    const summary = { hasLeave: true, periods: [{ remaining: 0 }] }

    const csv = buildBackupCsv(settings, [], summary)
    const lines = csv.split('\n')

    expect(lines).toEqual([
      '到職日,2023-06-15',
      '特休規則,公司自訂',
      '允許遞延,否',
      '6,3',
      '12,10',
      '之後每年加,0',
      '',
      '請假記錄',
      '開始日期,天數',
      '',
      '離職結清',
      '應結清工資天數,0',
    ])
  })

  it('also lists the cap when customGrowth.perYear is greater than 0', () => {
    const settings = {
      onboardDate: '2023-06-15',
      ruleType: 'custom',
      customRules: [{ id: 'a', months: 6, days: 3 }],
      allowCarryover: false,
      customGrowth: { perYear: 1, cap: 30 },
    }
    const summary = { hasLeave: true, periods: [{ remaining: 0 }] }

    const csv = buildBackupCsv(settings, [], summary)
    const lines = csv.split('\n')

    expect(lines).toEqual([
      '到職日,2023-06-15',
      '特休規則,公司自訂',
      '允許遞延,否',
      '6,3',
      '之後每年加,1',
      '天數上限,30',
      '',
      '請假記錄',
      '開始日期,天數',
      '',
      '離職結清',
      '應結清工資天數,0',
    ])
  })

  it('exports a rule row\'s raw stored days value, uncapped by MAX_ANNUAL_LEAVE_DAYS (#45, C9)', () => {
    // Settings saved before #45 could hold an absurd day count. A backup
    // should reflect the raw stored data, not the clamped calculated value
    // (which is what settlementDays below already is).
    const settings = {
      onboardDate: '2023-06-15',
      ruleType: 'custom',
      customRules: [{ id: 'a', months: 12, days: 1e23 }],
      allowCarryover: false,
      customGrowth: { perYear: 0, cap: 0 },
    }
    const summary = { hasLeave: true, periods: [{ remaining: 365 }] }

    const csv = buildBackupCsv(settings, [], summary)

    // JS formats 1e23 as '1e+23' when interpolated into a template string.
    expect(csv).toContain('12,1e+23')
  })

  it('defaults to no-growth when customGrowth is missing from settings (pre-#35 data)', () => {
    const settings = {
      onboardDate: '2023-06-15',
      ruleType: 'custom',
      customRules: [{ id: 'a', months: 6, days: 3 }],
      allowCarryover: false,
    }
    const summary = { hasLeave: true, periods: [{ remaining: 0 }] }

    const csv = buildBackupCsv(settings, [], summary)

    expect(csv).toContain('之後每年加,0')
    expect(csv).not.toContain('天數上限')
  })
})

describe('downloadCsv', () => {
  beforeEach(() => {
    vi.stubGlobal('URL', {
      ...URL,
      createObjectURL: vi.fn(() => 'blob:mock-url'),
      revokeObjectURL: vi.fn(),
    })
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  it('creates a Blob URL and triggers a click on a temporary anchor', () => {
    const clickSpy = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {})

    downloadCsv('annual-leave-backup-2025-06-15.csv', '到職日,2023-06-15')

    expect(URL.createObjectURL).toHaveBeenCalledTimes(1)
    expect(clickSpy).toHaveBeenCalledTimes(1)
    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:mock-url')
  })
})
