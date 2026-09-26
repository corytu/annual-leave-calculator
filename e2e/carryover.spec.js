import { test, expect } from '@playwright/test'
import { freezeTime, seedAppStorage } from './helpers.js'

// onboard 2022-06-15 + frozen "today" 2025-06-15 -> exactly 36 completed
// months -> current milestone 36 (14 days), previous milestone 24 (10 days).
// current period:  2025-06-15 ~ 2026-06-14
// previous period: 2024-06-15 ~ 2025-06-14
const SETTINGS_WITH_CARRYOVER = {
  onboardDate: '2022-06-15',
  ruleType: 'labor',
  customRules: [],
  allowCarryover: true,
}

// This file focuses on chained-carryover *calculation* correctness (carryIn/
// carryOut/settlement values, chain-validation failures). All assertions here
// are readable from the default (newest) period tab without switching tabs,
// except where a value only exists on an older period -- there, a tab click
// is used purely as the means to reach that data, not as a UI behavior under
// test. Period-tab UI behavior itself (labels, ordering, selection
// persistence) lives in e2e/period-tabs.spec.js.
test.describe('假期遞延', () => {
  test.beforeEach(async ({ page }) => {
    await freezeTime(page)
    await seedAppStorage(page, { settings: SETTINGS_WITH_CARRYOVER, records: [] })
    await page.goto('/')
  })

  test('首頁摘要卡片正確顯示遞延進入本期的天數', async ({ page }) => {
    // Current period: entitled 14 + carryover 10 = 24 remaining.
    await expect(page.getByTestId('summary-entitled')).toContainText('14')
    await expect(page.getByTestId('summary-carryin')).toContainText('10')
    await expect(page.getByTestId('summary-remaining')).toContainText('24')
  })

  test('前一週期繼承的舊桶剛好被本期用完，不影響本期自己的新桶依然正常遞延一次', async ({ page }) => {
    // Previous period (milestone 24, 10 days, spans 2024-06-15 ~ 2025-06-14) is fully
    // used (taken=10), but it had itself inherited a carryIn of 7 (unused entitlement
    // from milestone 6 -> 12, settling cleanly through each untouched period). Only
    // the inherited 7 is consumed by the 10-day take; the period's own new bucket
    // (10 - 3 = 7) still carries forward into the current period.
    await seedAppStorage(page, {
      settings: SETTINGS_WITH_CARRYOVER,
      records: [{ id: 'r1', startDate: '2024-07-01', days: 10 }],
    })
    await page.reload()

    await expect(page.getByTestId('summary-carryin')).toContainText('7')
    await expect(page.getByTestId('summary-remaining')).toContainText('21')
  })

  test('連續多期都剛好用完時，遞延天數 clamp 為 0', async ({ page }) => {
    // 6~12mo (3 days), 12~24mo (7 days), 24~36mo (10 days) each exactly use up
    // their own bucket, so nothing ever accumulates and the chain carries 0
    // forward at every hop -- a genuine clamp-to-0, not just a coincidence of
    // no earlier records existing.
    await seedAppStorage(page, {
      settings: SETTINGS_WITH_CARRYOVER,
      records: [
        { id: 'r1', startDate: '2022-12-20', days: 3 },
        { id: 'r2', startDate: '2023-07-01', days: 7 },
        { id: 'r3', startDate: '2024-07-01', days: 10 },
      ],
    })
    await page.reload()

    await expect(page.getByTestId('summary-carryin')).toContainText('0')
    await expect(page.getByTestId('summary-remaining')).toContainText('14')
  })
})

// onboard 2023-09-01: 6~12mo period 2024-03-01~2024-08-31 (3 days),
// 12~24mo period 2024-09-01~2025-08-31 (7 days), 24~36mo period
// 2025-09-01~2026-08-31 (10 days).
const CHAIN_SETTINGS = {
  onboardDate: '2023-09-01',
  ruleType: 'labor',
  customRules: [],
  allowCarryover: true,
}

test.describe('跨兩個週年度的鏈式遞延', () => {
  test('連續兩期各自只休一天，未休完的新桶依序正確遞延到第三個週年度', async ({ page }) => {
    // Frozen "today" 2026-01-15 -> completed months 28 -> current milestone 24
    // (10 days), previous milestone 12 (7 days).
    await freezeTime(page, '2026-01-15T03:00:00')
    await seedAppStorage(page, {
      settings: CHAIN_SETTINGS,
      records: [
        { id: 'r1', startDate: '2024-08-31', days: 1 }, // 6~12mo period
        { id: 'r2', startDate: '2025-08-31', days: 1 }, // 12~24mo period
      ],
    })
    await page.goto('/')

    await expect(page.getByTestId('summary-entitled')).toContainText('10')
    await expect(page.getByTestId('summary-carryin')).toContainText('7')
    await expect(page.getByTestId('summary-remaining')).toContainText('17') // carryIn 7 + entitled 10 - taken 0
  })

  test('直接編輯本期記錄超支可用額度時觸發鏈式驗證失敗', async ({ page }) => {
    // Frozen "today" 2025-01-15 -> completed months 16 -> current milestone 12
    // (7 days), previous milestone 6 (3 days). Initial state is legal:
    // 6~12mo has 1 day (carryOut 2), 12~24mo has 15 days
    // (availableTotal = 2+7-15 = -10, exactly at the -10 threshold, not below it).
    await freezeTime(page, '2025-01-15T03:00:00')
    await seedAppStorage(page, {
      settings: CHAIN_SETTINGS,
      records: [
        { id: 'r1', startDate: '2024-05-01', days: 1 },
        { id: 'r2', startDate: '2024-10-01', days: 15 },
      ],
    })
    await page.goto('/')

    // r2 already lives in the current (default-selected, newest) period, so no
    // period-tab switch is needed to reach it -- this test is purely about the
    // chain-validation calculation, not tab navigation.
    await page.getByRole('button', { name: '編輯' }).click()
    await expect(page.locator('input[type="number"]').first()).toHaveValue('15')

    // Editing to 21 days pushes availableTotal to 2+7-21 = -12, below the -10 threshold.
    // Entering edit mode already marks startDate/days touched (§6.4), so the
    // warning becomes visible as soon as the value changes -- no blur needed,
    // and the disabled button can no longer be clicked to trigger a dialog.
    await page.locator('input[type="number"]').first().fill('21')

    await expect(page.getByText('這筆請假超支可用額度上限，請確認天數是否正確', { exact: true })).toBeVisible()
    await expect(page.getByRole('button', { name: '儲存變更' })).toBeDisabled()
    await expect(page.getByTestId('record-days')).toContainText('15 天')
  })
})

test.describe('關閉遞延時仍顯示已結清天數', () => {
  test('allowCarryover 為 false 時，已結清前年度未休工資天數依然顯示完整未休天數', async ({ page }) => {
    // Frozen "today" 2025-01-15 -> current milestone 12, previous milestone 6
    // (3 days entitlement, no records taken -> fully settled since carryover is off).
    await freezeTime(page, '2025-01-15T03:00:00')
    await seedAppStorage(page, {
      settings: { ...CHAIN_SETTINGS, allowCarryover: false },
      records: [],
    })
    await page.goto('/')

    // No carry-in box at all when carryover is off, regardless of which period is selected.
    await expect(page.getByTestId('summary-carryin')).toHaveCount(0)

    // The milestone-6 period (2024-03-01 ~ 2024-08-31) is reached via its tab
    // (label "2024", same calendar year) -- this is "using the tab to reach the
    // data", not a test of tab behavior itself.
    await page.getByRole('button', { name: '2024', exact: true }).click()
    await expect(page.getByTestId('summary-settlement')).toContainText('3')
  })
})
