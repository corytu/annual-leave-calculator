import { test, expect } from '@playwright/test'
import { freezeTime, seedAppStorage, zhDayLabel, mockHolidayCdn } from './helpers.js'

// This file covers period-tab *UI behavior* (labels, ordering, selection,
// summary-card follow-through) as opposed to chained-carryover calculation
// correctness, which lives in e2e/carryover.spec.js.

// onboard 2023-09-01: 6~12mo period 2024-03-01~2024-08-31 (3 days),
// 12~24mo period 2024-09-01~2025-08-31 (7 days), 24~36mo period
// 2025-09-01~2026-08-31 (10 days).
const CHAIN_SETTINGS = {
  onboardDate: '2023-09-01',
  ruleType: 'labor',
  customRules: [],
  allowCarryover: true,
}

// onboard 2022-06-15 + frozen "today" 2025-06-15 -> exactly 36 completed
// months -> the full chain is [milestone 6, 12, 24, 36] (4 periods), not just
// the newest two -- milestone 24 (the "previous" tab used below) therefore
// still inherits its own carryIn from milestones 6 and 12, it is not the
// earliest period in the chain.
// newest period (milestone 36, 14 days):   2025-06-15 ~ 2026-06-14 (label "2025–26")
// previous period (milestone 24, 10 days): 2024-06-15 ~ 2025-06-14 (label "2024–25")
const SETTINGS_WITH_CARRYOVER = {
  onboardDate: '2022-06-15',
  ruleType: 'labor',
  customRules: [],
  allowCarryover: true,
}

// onboard 2024-06-15, no carryover -- used for the midnight-rollover tests below.
const MIDNIGHT_ROLLOVER_SETTINGS = {
  onboardDate: '2024-06-15',
  ruleType: 'labor',
  customRules: [],
  allowCarryover: false,
}

test.describe('期別分頁', () => {
  test('多期別時分頁數量與標籤格式正確，且由左至右年份降冪排列', async ({ page }) => {
    // Frozen "today" 2026-01-15 -> completed months 28 -> chain is
    // [milestone 6, milestone 12, milestone 24] -> 3 tabs.
    await freezeTime(page, '2026-01-15T03:00:00')
    await mockHolidayCdn(page)
    await seedAppStorage(page, { settings: CHAIN_SETTINGS, records: [] })
    await page.goto('/')

    const tabs = page.getByTestId('period-tabs').getByRole('button')
    await expect(tabs).toHaveCount(3)
    await expect(tabs.nth(0)).toHaveText('2025–26')
    await expect(tabs.nth(1)).toHaveText('2024–25')
    await expect(tabs.nth(2)).toHaveText('2024')
  })

  test('allowCarryover 為 false 時仍能看到多個分頁', async ({ page }) => {
    await freezeTime(page, '2026-01-15T03:00:00')
    await mockHolidayCdn(page)
    await seedAppStorage(page, { settings: { ...CHAIN_SETTINGS, allowCarryover: false }, records: [] })
    await page.goto('/')

    await expect(page.getByTestId('period-tabs').getByRole('button')).toHaveCount(3)
  })

  test('切到非最新分頁編輯舊記錄，觸發鏈式驗證失敗', async ({ page }) => {
    // Frozen "today" 2025-01-15 -> completed months 16 -> current milestone 12
    // (7 days), previous milestone 6 (3 days). Initial state is legal:
    // 6~12mo has 1 day (carryOut 2), 12~24mo has 15 days
    // (availableTotal = 2+7-15 = -6, not below the -10 threshold).
    await freezeTime(page, '2025-01-15T03:00:00')
    await mockHolidayCdn(page)
    await seedAppStorage(page, {
      settings: CHAIN_SETTINGS,
      records: [
        { id: 'r1', startDate: '2024-05-01', days: 1 },
        { id: 'r2', startDate: '2024-10-01', days: 15 },
      ],
    })
    await page.goto('/')

    // Switch to the milestone-6 period's tab (label "2024") to reach r1.
    await page.getByTestId('period-tabs').getByRole('button', { name: '2024', exact: true }).click()
    await page.getByRole('button', { name: '編輯' }).click()
    await expect(page.locator('input[type="number"]').first()).toHaveValue('1')

    // Editing this record to 10 days is legal in isolation (0+3-10 = -7, exactly
    // at its own threshold), but it drops the carryIn flowing into 12~24mo from
    // 2 to -7, pushing that period's availableTotal (-7+7-15 = -15) below its
    // -10 threshold.
    // Entering edit mode already marks startDate/days touched (§6.4), so the
    // warning becomes visible as soon as the value changes -- no blur needed,
    // and the disabled button can no longer be clicked to trigger a dialog.
    await page.locator('input[type="number"]').first().fill('10')

    await expect(page.getByText('這筆請假超支可用額度上限，請確認天數是否正確', { exact: true })).toBeVisible()
    await expect(page.getByRole('button', { name: '儲存變更' })).toBeDisabled()
    await expect(page.getByTestId('record-days')).toContainText('1 天')
  })

  test('切換分頁後摘要卡片正確反映該期別自己的數字', async ({ page }) => {
    await freezeTime(page)
    await mockHolidayCdn(page)
    await seedAppStorage(page, { settings: SETTINGS_WITH_CARRYOVER, records: [] })
    await page.goto('/')

    // Default tab: the newest period (milestone 36, label "2025–26"). It has a
    // carry-in from the previous period but, being newest, no settlement/carry-out yet.
    await expect(page.getByTestId('summary-entitled')).toContainText('14')
    await expect(page.getByTestId('summary-carryin')).toContainText('10')
    await expect(page.getByTestId('summary-remaining')).toContainText('24')
    await expect(page.getByTestId('summary-settlement')).toHaveCount(0)
    await expect(page.getByTestId('summary-carryout')).toHaveCount(0)

    await page.getByTestId('period-tabs').getByRole('button', { name: '2024–25', exact: true }).click()

    // The previous period (milestone 24) is NOT the earliest in this chain --
    // completed months = 36 also reaches milestone 6 and 12, so milestone 24
    // itself inherits a carryIn of 7 (3 from milestone 6, fully unused, then
    // topped up to 7 through milestone 12, also fully unused). With its own
    // entitlement of 10 and nothing taken: remaining = 7+10-0 = 17,
    // settlement = 7 (the inherited old bucket), carryOut = 10 (its own
    // untouched new bucket, matching current.carryIn on the newest tab above).
    await expect(page.getByTestId('summary-entitled')).toContainText('10')
    await expect(page.getByTestId('summary-taken')).toContainText('0')
    await expect(page.getByTestId('summary-carryin')).toContainText('7')
    await expect(page.getByTestId('summary-remaining')).toContainText('17')
    await expect(page.getByTestId('summary-settlement')).toContainText('7')
    await expect(page.getByTestId('summary-carryout')).toContainText('10')
  })

  test('新增記錄後，目前選取分頁不會被強制跳回最新一期', async ({ page }) => {
    await freezeTime(page)
    await mockHolidayCdn(page)
    await seedAppStorage(page, { settings: SETTINGS_WITH_CARRYOVER, records: [] })
    await page.goto('/')

    await page.getByTestId('period-tabs').getByRole('button', { name: '2024–25', exact: true }).click()
    await expect(page.getByTestId('summary-entitled')).toContainText('10')

    await page.locator('input[type="date"]').fill('2024-07-01')
    await page.getByRole('button', { name: '新增' }).click()

    // Still showing the previous period's own numbers, not snapped back to the newest one.
    await expect(page.getByTestId('summary-entitled')).toContainText('10')
    await expect(page.getByTestId('summary-taken')).toContainText('1')
  })

  test('切換到較舊分頁後，月曆顯示該期間內的月份', async ({ page }) => {
    await freezeTime(page)
    await mockHolidayCdn(page)
    await seedAppStorage(page, { settings: SETTINGS_WITH_CARRYOVER, records: [] })
    await page.goto('/')

    // The default tab (milestone 36) is showing "today"'s month (2025-06).
    // milestone 24's period (2024-06-15 ~ 2025-06-14) does not contain
    // "today", so switching to it should reset the calendar to show its own
    // periodStart month (2024-06) instead of staying on 2025-06.
    await page.getByTestId('period-tabs').getByRole('button', { name: '2024–25', exact: true }).click()

    const juneFifteen2024 = page.getByRole('button', { name: zhDayLabel({ year: 2024, month: 6, day: 15 }), exact: true })
    await expect(juneFifteen2024).toBeVisible()
  })

  test('切換分頁後，表單中尚未送出的輸入被清空', async ({ page }) => {
    await freezeTime(page)
    await mockHolidayCdn(page)
    await seedAppStorage(page, { settings: SETTINGS_WITH_CARRYOVER, records: [] })
    await page.goto('/')

    await page.locator('input[type="date"]').fill('2025-07-01')
    await page.getByTestId('period-tabs').getByRole('button', { name: '2024–25', exact: true }).click()

    await expect(page.locator('input[type="date"]')).toHaveValue('')
  })

  test('編輯中切換分頁後，表單回到新增模式且欄位清空', async ({ page }) => {
    await freezeTime(page)
    await mockHolidayCdn(page)
    await seedAppStorage(page, {
      settings: SETTINGS_WITH_CARRYOVER,
      records: [{ id: 'r1', startDate: '2025-07-01', days: 2 }],
    })
    await page.goto('/')

    await page.getByRole('button', { name: '編輯' }).click()
    await expect(page.getByRole('heading', { name: '編輯請假記錄' })).toBeVisible()
    await expect(page.locator('input[type="date"]')).toHaveValue('2025-07-01')

    await page.getByTestId('period-tabs').getByRole('button', { name: '2024–25', exact: true }).click()

    await expect(page.getByRole('heading', { name: '新增請假記錄' })).toBeVisible()
    await expect(page.locator('input[type="date"]')).toHaveValue('')
  })

  test('點擊目前已選取的分頁不會中斷編輯', async ({ page }) => {
    await freezeTime(page)
    await mockHolidayCdn(page)
    await seedAppStorage(page, {
      settings: SETTINGS_WITH_CARRYOVER,
      records: [{ id: 'r1', startDate: '2025-07-01', days: 2 }],
    })
    await page.goto('/')

    await page.getByRole('button', { name: '編輯' }).click()
    await expect(page.getByRole('heading', { name: '編輯請假記錄' })).toBeVisible()

    await page.getByTestId('period-tabs').getByRole('button', { name: '2025–26', exact: true }).click()

    await expect(page.getByRole('heading', { name: '編輯請假記錄' })).toBeVisible()
    await expect(page.locator('input[type="date"]')).toHaveValue('2025-07-01')
  })

  test('切換分頁後點月曆日期仍能正確帶入表單', async ({ page }) => {
    await freezeTime(page)
    await mockHolidayCdn(page)
    await seedAppStorage(page, { settings: SETTINGS_WITH_CARRYOVER, records: [] })
    await page.goto('/')

    await page.getByTestId('period-tabs').getByRole('button', { name: '2024–25', exact: true }).click()

    // The reset calendar view starts on the period's own start month (2024-06,
    // since "today" 2025-06-15 isn't within this period) -- pick a day tile
    // from that same month so it's actually visible without navigating.
    const june20th2024 = page.getByRole('button', { name: zhDayLabel({ year: 2024, month: 6, day: 20 }), exact: true })
    await june20th2024.click()

    await expect(page.locator('input[type="date"]')).toHaveValue('2024-06-20')
  })

  test('分頁保持開啟，跨越午夜後會新增週年制期別分頁', async ({ page }) => {
    await freezeTime(page, '2025-06-14T23:59:30')
    await mockHolidayCdn(page)
    await seedAppStorage(page, { settings: MIDNIGHT_ROLLOVER_SETTINGS, records: [] })
    await page.goto('/')
    const tabs = page.getByTestId('period-tabs').getByRole('button')
    await expect(tabs).toHaveCount(1)

    await page.clock.runFor(60_000)
    await expect(tabs).toHaveCount(2)
    await page.getByTestId('period-tabs').getByRole('button', { name: '2025–26', exact: true }).click()
    await expect(page.getByTestId('summary-entitled')).toContainText('7')

    // Validation must agree with the newly displayed period without a reload.
    await page.locator('input[type="date"]').fill('2025-06-15')
    await page.getByRole('button', { name: '新增', exact: true }).click()
    await expect(page.getByTestId('summary-taken')).toContainText('1')
  })

  test('分頁保持開啟，達成首次特休資格後會離開空白狀態', async ({ page }) => {
    await freezeTime(page, '2024-12-14T23:59:30')
    await mockHolidayCdn(page)
    await seedAppStorage(page, { settings: MIDNIGHT_ROLLOVER_SETTINGS, records: [] })
    await page.goto('/')
    await expect(page.getByTestId('summary-entitled')).toHaveCount(0)

    await page.clock.runFor(60_000)
    await expect(page.getByTestId('summary-entitled')).toContainText('3')
  })
})
