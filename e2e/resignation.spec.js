import { test, expect } from '@playwright/test'
import { freezeTime, seedAppStorage } from './helpers.js'

// Settings are locked once onboardDate has been saved (isLocked = Boolean(settings.onboardDate)).
// ruleType is deliberately 'custom' with a non-empty customRules row so the
// custom-rule table and its delete button actually render and can be
// asserted disabled -- a 'labor' fixture would leave that table absent.
const LOCKED_SETTINGS = {
  onboardDate: '2024-06-15',
  ruleType: 'custom',
  customRules: [
    { id: 'c1', months: 12, days: 10 },
    { id: 'c2', months: 24, days: 14 },
  ],
  allowCarryover: true,
  customGrowth: { perYear: 1, cap: 30 },
}

// onboard 2024-06-15 + frozen "today" 2025-06-15 -> exactly 12 completed
// months -> chain is [milestone 6 (3 days), milestone 12 (7 days)], the
// latter's period spanning 2025-06-15 ~ 2026-06-14. One record of 2 days
// inside that period -> remaining = 0 (carryover off) + 7 - 2 = 5.
const SETTLEMENT_SETTINGS = {
  onboardDate: '2024-06-15',
  ruleType: 'labor',
  customRules: [],
  allowCarryover: false,
}
const SETTLEMENT_RECORDS = [{ id: 'r1', startDate: '2025-07-01', days: 2 }]

// Same chain as above but with carryover on: milestone 6 fully unused ->
// carryOut 3 into milestone 12. Taking 13 days there -> remaining =
// carryIn(3) + entitled(7) - taken(13) = -3.
const OVERSPEND_SETTINGS = {
  onboardDate: '2024-06-15',
  ruleType: 'labor',
  customRules: [],
  allowCarryover: true,
}
const OVERSPEND_RECORDS = [{ id: 'r1', startDate: '2025-07-01', days: 13 }]

// Onboarded 5 days before frozen "today" -> nowhere near the 6-month minimum -> hasLeave: false.
const NO_LEAVE_YET_SETTINGS = {
  onboardDate: '2025-06-10',
  ruleType: 'labor',
  customRules: [],
  allowCarryover: false,
}

async function readStorage(page) {
  return page.evaluate(() => ({
    settings: window.localStorage.getItem('leaveCalculator_settings'),
    records: window.localStorage.getItem('leaveCalculator_records'),
  }))
}

test.describe('離職重來', () => {
  test.beforeEach(async ({ page }) => {
    await freezeTime(page)
  })

  test('未儲存設定時「離職重來」為 disabled', async ({ page }) => {
    await page.goto('/')
    await page.getByRole('button', { name: '前往設定' }).click()

    await expect(page.getByRole('button', { name: '離職重來' })).toBeDisabled()
  })

  test('儲存後欄位變唯讀，「離職重來」變 enabled', async ({ page }) => {
    await seedAppStorage(page, { settings: LOCKED_SETTINGS, records: [] })
    await page.goto('/')
    await page.getByRole('button', { name: '設定' }).click()

    await expect(page.locator('input[type="date"]')).toBeDisabled()
    await expect(page.getByRole('button', { name: '按勞基法第38條' })).toBeDisabled()
    await expect(page.getByRole('button', { name: '公司另有規定' })).toBeDisabled()
    await expect(page.locator('table tbody tr input[type="number"]').first()).toBeDisabled()
    await expect(page.locator('table tbody tr input[type="number"]').nth(1)).toBeDisabled()
    const deleteButtons = page.getByRole('button', { name: '刪除此規則' })
    await expect(deleteButtons).toHaveCount(2)
    for (const btn of await deleteButtons.all()) {
      await expect(btn).toBeDisabled()
    }
    await expect(page.getByLabel('每年增加天數')).toBeDisabled()
    await expect(page.getByLabel('天數上限')).toBeDisabled()
    await expect(page.getByRole('switch')).toBeDisabled()
    await expect(page.getByRole('button', { name: '儲存設定' })).not.toBeVisible()
    await expect(page.getByRole('button', { name: '取消' })).not.toBeVisible()
    await expect(page.getByRole('button', { name: '離職重來' })).toBeEnabled()
  })

  test('確認彈窗 1 按取消，設定與記錄不變', async ({ page }) => {
    await seedAppStorage(page, { settings: LOCKED_SETTINGS, records: [] })
    await page.goto('/')
    await page.getByRole('button', { name: '設定' }).click()
    const before = await readStorage(page)

    await page.getByRole('button', { name: '離職重來' }).click()
    await expect(page.getByText('離職將清除現有到職日設定與休假記錄，是否確定執行？')).toBeVisible()
    await page.getByRole('button', { name: '取消' }).click()

    await expect(page.getByText('離職將清除現有到職日設定與休假記錄，是否確定執行？')).not.toBeVisible()
    expect(await readStorage(page)).toEqual(before)
  })

  test('確認彈窗 2 正確顯示結清天數', async ({ page }) => {
    await seedAppStorage(page, { settings: SETTLEMENT_SETTINGS, records: SETTLEMENT_RECORDS })
    await page.goto('/')
    await page.getByRole('button', { name: '設定' }).click()

    await page.getByRole('button', { name: '離職重來' }).click()
    await page.getByRole('button', { name: '確定' }).click()

    await expect(page.getByText('應結清工資天數：5 天')).toBeVisible()
  })

  test('確認彈窗 2 按取消，設定與記錄不變', async ({ page }) => {
    await seedAppStorage(page, { settings: SETTLEMENT_SETTINGS, records: SETTLEMENT_RECORDS })
    await page.goto('/')
    await page.getByRole('button', { name: '設定' }).click()
    const before = await readStorage(page)

    await page.getByRole('button', { name: '離職重來' }).click()
    await page.getByRole('button', { name: '確定' }).click()
    await page.getByRole('button', { name: '取消' }).click()

    await expect(page.getByText('應結清工資天數：5 天')).not.toBeVisible()
    expect(await readStorage(page)).toEqual(before)
  })

  test('確認彈窗 2 按確定清空，兩個 localStorage key 清除、頁面回到空狀態', async ({ page }) => {
    await seedAppStorage(page, { settings: SETTLEMENT_SETTINGS, records: SETTLEMENT_RECORDS })
    await page.goto('/')
    await page.getByRole('button', { name: '設定' }).click()

    await page.getByRole('button', { name: '離職重來' }).click()
    await page.getByRole('button', { name: '確定' }).click()
    await page.getByRole('button', { name: '確定清空' }).click()

    await expect(page.getByRole('heading', { name: '尚未設定到職日' })).toBeVisible()
    const after = await readStorage(page)
    expect(after.settings).toBeNull()
    expect(after.records).toBeNull()
  })

  test('允許遞延且過度預支時，結清天數正確顯示為負數', async ({ page }) => {
    await seedAppStorage(page, { settings: OVERSPEND_SETTINGS, records: OVERSPEND_RECORDS })
    await page.goto('/')
    await page.getByRole('button', { name: '設定' }).click()

    await page.getByRole('button', { name: '離職重來' }).click()
    await page.getByRole('button', { name: '確定' }).click()

    await expect(page.getByText('應結清工資天數：-3 天')).toBeVisible()
  })

  test('尚未達最低服務年資時直接離職，結清天數顯示為 0', async ({ page }) => {
    await seedAppStorage(page, { settings: NO_LEAVE_YET_SETTINGS, records: [] })
    await page.goto('/')
    await page.getByRole('button', { name: '設定' }).click()

    await page.getByRole('button', { name: '離職重來' }).click()
    await page.getByRole('button', { name: '確定' }).click()

    await expect(page.getByText('應結清工資天數：0 天')).toBeVisible()
  })

  test('既有資料鎖定後若因未設定成長規則而不合規，警告文字改為提示離職重來', async ({ page }) => {
    // Pre-#35 data: no customGrowth field at all (storage.js backfills it to
    // {perYear: 0, cap: 0}), so the default-shaped custom rules become
    // deficient past the last threshold once compared against labor law's
    // own ongoing +1/year growth.
    await seedAppStorage(page, {
      settings: {
        onboardDate: '2024-06-15',
        ruleType: 'custom',
        customRules: [
          { id: 'c1', months: 6, days: 3 },
          { id: 'c2', months: 12, days: 7 },
          { id: 'c3', months: 24, days: 10 },
          { id: 'c4', months: 36, days: 14 },
          { id: 'c5', months: 60, days: 15 },
          { id: 'c6', months: 120, days: 16 },
        ],
        allowCarryover: false,
      },
      records: [],
    })
    await page.goto('/')
    await page.getByRole('button', { name: '設定' }).click()

    await expect(page.getByText('以下年資區間的天數低於勞基法最低標準')).toBeVisible()
    await expect(page.getByText('如需調整請使用「離職重來」重新設定。')).toBeVisible()
    await expect(page.getByText('仍可儲存，但請確認是否符合規定。')).not.toBeVisible()

    for (const input of await page.locator('table tbody tr input[type="number"]').all()) {
      await expect(input).toBeDisabled()
    }
    await expect(page.getByRole('button', { name: '儲存設定' })).not.toBeVisible()
  })

  test('自訂規則為空的舊資料：首頁提示改用離職重來', async ({ page }) => {
    await seedAppStorage(page, {
      settings: { onboardDate: '2023-06-15', ruleType: 'custom', customRules: [], allowCarryover: false },
      records: [],
    })
    await page.goto('/')

    await expect(page.getByText('離職重來')).toBeVisible()
    await expect(page.getByTestId('period-tabs')).toHaveCount(0)
  })

  test('匯出 CSV 備份會觸發下載，且不關閉彈窗、不影響後續清空流程', async ({ page }) => {
    await seedAppStorage(page, { settings: SETTLEMENT_SETTINGS, records: SETTLEMENT_RECORDS })
    await page.goto('/')
    await page.getByRole('button', { name: '設定' }).click()

    await page.getByRole('button', { name: '離職重來' }).click()
    await page.getByRole('button', { name: '確定' }).click()

    const downloadPromise = page.waitForEvent('download')
    await page.getByRole('button', { name: '匯出 CSV 備份' }).click()
    const download = await downloadPromise
    expect(download.suggestedFilename()).toMatch(/^annual-leave-backup-\d{4}-\d{2}-\d{2}\.csv$/)

    // Modal is still open and the reset flow still works afterwards.
    await expect(page.getByText('應結清工資天數：5 天')).toBeVisible()
    await page.getByRole('button', { name: '確定清空' }).click()
    await expect(page.getByRole('heading', { name: '尚未設定到職日' })).toBeVisible()
  })
})
