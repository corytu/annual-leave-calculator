import { test, expect } from '@playwright/test'
import { freezeTime, seedAppStorage } from './helpers.js'
import { MAX_ANNUAL_LEAVE_DAYS, MAX_MILESTONE_MONTHS } from '../src/utils/leaveCalculations.js'

test.describe('首次使用與設定流程', () => {
  test.beforeEach(async ({ page }) => {
    await freezeTime(page)
  })

  test('首次進入（無資料）顯示尚未設定到職日的空狀態', async ({ page }) => {
    await page.goto('/')
    await expect(page.getByRole('heading', { name: '尚未設定到職日' })).toBeVisible()
    await expect(page.getByText('請先在設定頁填寫您的到職日與特休規則。')).toBeVisible()
    await expect(page.getByRole('button', { name: '前往設定' })).toBeVisible()
  })

  test('透過空狀態按鈕前往設定頁，用月曆選取到職日並儲存後導回首頁', async ({ page }) => {
    await page.goto('/')
    await page.getByRole('button', { name: '前往設定' }).click()
    await expect(page.getByRole('heading', { name: '設定' })).toBeVisible()

    // Open the onboard-date picker and select 2023-06-15 (exactly 24 completed
    // months before the frozen "today" of 2025-06-15 -> milestone 24, 10 days).
    await page.locator('input[type="date"]').fill('2023-06-15')
    await expect(page.locator('input[type="date"]')).toHaveValue('2023-06-15')

    await page.getByRole('button', { name: '儲存設定' }).click()

    // Back on the main page.
    await expect(page.getByText('到職日：')).toBeVisible()
    await expect(page.getByText('本年度週年制區間：')).toBeVisible()
    await expect(page.getByTestId('summary-entitled')).toContainText('10')
  })
})

test.describe('特休規則設定', () => {
  test.beforeEach(async ({ page }) => {
    await freezeTime(page)
    // No seeded settings: once onboardDate is saved, the settings page locks
    // and the rule editor becomes read-only (see resignation.spec.js), so the
    // only place left to exercise rule-editing is before the first save.
    await page.goto('/')
    await page.getByRole('button', { name: '前往設定' }).click()
  })

  test('預設顯示勞基法對照表', async ({ page }) => {
    await expect(page.getByText('滿 6 月未滿 12 月')).toBeVisible()
    await expect(page.getByText('滿 12 月未滿 24 月')).toBeVisible()
  })

  test('切換到公司另有規定顯示自訂規則編輯區', async ({ page }) => {
    await page.getByRole('button', { name: '公司另有規定' }).click()
    await expect(page.getByRole('button', { name: '新增規則' })).toBeVisible()
    await expect(page.getByText('滿幾個月後')).toBeVisible()
  })

  test('自訂天數低於勞基法最低標準時顯示警告', async ({ page }) => {
    await page.getByRole('button', { name: '公司另有規定' }).click()

    // The 12-month row defaults to 7 days (matching labor law). Lower it to 5.
    const row = page.locator('table tbody tr').filter({ has: page.locator('input[value="12"]') })
    await row.locator('input[step="0.25"]').fill('5')

    await expect(page.getByText('以下年資區間的天數低於勞基法最低標準')).toBeVisible()
    await expect(page.getByText('滿 12 個月至未滿 24 個月：您的規則 5 天，勞基法最低 7 天')).toBeVisible()
  })

  test('沒有成長設定時顯示滿 132 個月起的開放式不合規警告', async ({ page }) => {
    await page.getByRole('button', { name: '公司另有規定' }).click()

    await page.getByLabel('每年增加天數').fill('0')

    // No growth past the last threshold (120mo, 16 days): stays deficient
    // forever once labor law climbs from 17 (132mo) up to its 30-day cap
    // (288mo) and plateaus there through the comparison horizon.
    await expect(page.getByText('滿 132 個月起：您的規則 16 天，勞基法最低 17～30 天')).toBeVisible()
  })

  test('第一個自訂門檻晚於 6 個月時顯示缺口', async ({ page }) => {
    await page.getByRole('button', { name: '公司另有規定' }).click()

    const sixMonthRow = page.getByTestId('custom-rule-row').filter({ has: page.locator('input[value="6"]') })
    await sixMonthRow.getByRole('button', { name: '刪除此規則' }).click()

    // Below the (now first) 12mo threshold, custom gives 0 days while labor
    // law's 6mo minimum is 3.
    await expect(page.getByText('滿 6 個月至未滿 12 個月：您的規則 0 天，勞基法最低 3 天')).toBeVisible()
  })

  test('兩段不相鄰的缺口同時顯示為獨立項目', async ({ page }) => {
    await page.getByRole('button', { name: '公司另有規定' }).click()

    const sixMonthRow = page.getByTestId('custom-rule-row').filter({ has: page.locator('input[value="6"]') })
    await sixMonthRow.locator('input[step="0.25"]').fill('1')
    const twentyFourMonthRow = page.getByTestId('custom-rule-row').filter({ has: page.locator('input[value="24"]') })
    await twentyFourMonthRow.locator('input[step="0.25"]').fill('5')

    await expect(page.getByText('滿 6 個月至未滿 12 個月：您的規則 1 天，勞基法最低 3 天')).toBeVisible()
    await expect(page.getByText('滿 24 個月至未滿 36 個月：您的規則 5 天，勞基法最低 10 天')).toBeVisible()
  })

  test('刪除自訂規則後列表更新', async ({ page }) => {
    await page.getByRole('button', { name: '公司另有規定' }).click()
    const rows = page.getByTestId('custom-rule-row')
    const before = await rows.count()

    await rows.first().getByRole('button', { name: '刪除此規則' }).click()

    await expect(rows).toHaveCount(before - 1)
  })

  test('自訂門檻重複時，集中清單顯示錯誤（只 blur 其中一列，恰好顯示 1 行）', async ({ page }) => {
    // Fill onboardDate first so it can't be the (only) reason the save
    // button ends up disabled -- this test's disabled assertion needs the
    // duplicate-threshold warning itself to be the blocking source.
    await page.locator('input[type="date"]').fill('2024-06-15')
    await page.getByRole('button', { name: '公司另有規定' }).click()
    await expect(page.getByRole('button', { name: '儲存設定' })).toBeEnabled()

    // The default rows include a 12-month threshold; retarget the 6-month
    // row's threshold to 12 so two rows now share the same months value.
    const row = page.getByTestId('custom-rule-row').filter({ has: page.locator('input[value="6"]') })
    const monthsInput = row.locator('input[step="1"]')
    await monthsInput.fill('12')
    // Tab instead of calling .blur() on `monthsInput`: blurring re-syncs the
    // DOM `value` attribute to the input's current text, which invalidates
    // the `input[value="6"]` filter this locator was built from -- calling
    // `.blur()` on it would re-resolve that now-stale filter and find
    // nothing. Tab blurs whatever element is currently focused (the input
    // we just filled) without re-resolving the locator.
    await page.keyboard.press('Tab')

    // Both rows independently carry the warning (see settingsValidation.test.js's
    // unit coverage), but the two rows' warnings share the same dedupeKey, so
    // the centralized list only ever shows ONE representative line -- not one
    // per row -- regardless of how many of the two rows have been touched.
    const formWarnings = page.getByTestId('settings-form-warnings')
    await expect(formWarnings.getByText('年資門檻「12 個月」重複，請合併或刪除其中一列', { exact: true })).toBeVisible()
    await expect(formWarnings.locator('p')).toHaveCount(1)
    await expect(page.getByRole('button', { name: '儲存設定' })).toBeDisabled()
  })

  test('自訂門檻重複時，只 blur 未被改值的那列，集中清單仍恰好顯示 1 行（另一個 dedupeKey 代表）', async ({ page }) => {
    // Companion to the test above: that test edits+blurs row 0 (the 6-month
    // row), so row 0 is the only touched row and dedupeBy's surviving
    // representative is row 0's warning -- which happens to also be
    // whichever entry appears first in the underlying array, since
    // customRules order puts row 0 before row 1. That coincidence doesn't
    // prove dedupeBy is looking at touchedKeys at all.
    //
    // To actually exercise "the touched row (not the array-order-first row)
    // is what survives", this test edits row 1 (originally 12 months, index
    // 1 in DEFAULT_CUSTOM_RULES) to duplicate row 0's existing, UNTOUCHED
    // value (6) instead, and never interacts with row 0's inputs at all.
    // Settings.jsx filters fieldWarnings by isWarningVisible(touched) before
    // dedupeBy runs, so row 0's warning (untouched) is dropped from the list
    // before dedup even sees it -- only row 1's warning reaches dedupeBy,
    // and that's what must render.
    await page.locator('input[type="date"]').fill('2024-06-15')
    await page.getByRole('button', { name: '公司另有規定' }).click()
    await expect(page.getByRole('button', { name: '儲存設定' })).toBeEnabled()

    const originalTwelveMonthRow = page.getByTestId('custom-rule-row').nth(1)
    const originalTwelveMonthsInput = originalTwelveMonthRow.locator('input[step="1"]')
    await originalTwelveMonthsInput.fill('6')
    // Tab instead of .blur(): blurring re-syncs the DOM `value` attribute,
    // which would invalidate an `input[value="…"]`-based filter locator if
    // this used one. Not needed here since the row is already held by
    // position (`nth(1)`), but Tab is used consistently with the other
    // duplicate-threshold tests in this file.
    await page.keyboard.press('Tab')

    const formWarnings = page.getByTestId('settings-form-warnings')
    await expect(formWarnings.getByText('年資門檻「6 個月」重複，請合併或刪除其中一列', { exact: true })).toBeVisible()
    await expect(formWarnings.locator('p')).toHaveCount(1)
    await expect(page.getByRole('button', { name: '儲存設定' })).toBeDisabled()
  })

  test('自訂規則只剩一列時刪除按鈕為 disabled', async ({ page }) => {
    await page.getByRole('button', { name: '公司另有規定' }).click()

    const rows = page.getByTestId('custom-rule-row')
    let count = await rows.count()
    while (count > 1) {
      await rows.first().getByRole('button', { name: '刪除此規則' }).click()
      count = await rows.count()
    }

    await expect(rows).toHaveCount(1)
    await expect(rows.first().getByRole('button', { name: '刪除此規則' })).toBeDisabled()
  })

  test('年資門檻超過安全上限時顯示錯誤', async ({ page }) => {
    await page.locator('input[type="date"]').fill('2024-06-15')
    await page.getByRole('button', { name: '公司另有規定' }).click()
    await expect(page.getByRole('button', { name: '儲存設定' })).toBeEnabled()

    const monthsInput = page.getByTestId('custom-rule-row')
      .filter({ has: page.locator('input[value="6"]') })
      .locator('input[step="1"]')
    await monthsInput.fill('1201')
    // Tab instead of .blur(): blurring re-syncs the DOM `value` attribute,
    // after which the `input[value="6"]` filter `monthsInput` was built from
    // no longer matches; calling `.blur()` on it would re-resolve that
    // now-stale filter and find nothing. Tab blurs whatever's currently
    // focused instead of re-resolving the locator.
    await page.keyboard.press('Tab')

    await expect(page.getByText('年資門檻請填寫 1200 個月（100 年）以內的正整數', { exact: true })).toBeVisible()
    await expect(page.getByRole('button', { name: '儲存設定' })).toBeDisabled()
  })

  test('每年可休天數輸入框：可以逐字元打出完整的小數（不會在打出小數點時被吃掉）', async ({ page }) => {
    await page.getByRole('button', { name: '公司另有規定' }).click()

    const row = page.locator('table tbody tr').filter({ has: page.locator('input[value="12"]') })
    const daysInput = row.locator('input[step="0.25"]')
    await daysInput.fill('')
    await daysInput.pressSequentially('4.75')

    await expect(daysInput).toHaveValue('4.75')
    // min/max mirror validateSettingsInput's actual bounds (#30).
    await expect(daysInput).toHaveAttribute('min', '0.25')
    await expect(daysInput).toHaveAttribute('max', String(MAX_ANNUAL_LEAVE_DAYS))
  })

  test('每年可休天數輸入框：只打了負號並 blur 時顯示「請填寫天數」（瀏覽器層級回報空字串，屬於 incomplete）', async ({ page }) => {
    await page.locator('input[type="date"]').fill('2024-06-15')
    await page.getByRole('button', { name: '公司另有規定' }).click()
    await expect(page.getByRole('button', { name: '儲存設定' })).toBeEnabled()

    const row = page.getByTestId('custom-rule-row').filter({ has: page.locator('input[value="12"]') })
    const daysInput = row.locator('input[step="0.25"]')
    await daysInput.fill('')
    // Typed character-by-character so it goes through the same real-input
    // path as a user leaving the field mid-way through typing a number.
    // A lone "-" is an invalid intermediate number state, so the browser
    // itself reports the input's .value as an empty string.
    await daysInput.pressSequentially('-')
    await daysInput.blur()

    await expect(row.getByText('請填寫天數', { exact: true })).toBeVisible()
    await expect(page.getByRole('button', { name: '儲存設定' })).toBeDisabled()
  })

  test('儲存自訂規則後首頁天數依自訂規則顯示', async ({ page }) => {
    await page.getByRole('button', { name: '公司另有規定' }).click()

    // Bump the 12-month row's days from 7 to 20 so we can assert the exact
    // custom value (rather than a value that happens to match labor law).
    const row = page.locator('table tbody tr').filter({ has: page.locator('input[value="12"]') })
    await row.locator('input[step="0.25"]').fill('20')

    // Filling the onboard date is only a necessary precondition for the save
    // to go through (settings are unlocked here, before any first save) --
    // this test's only assertion focus stays on the custom rule taking effect.
    await page.locator('input[type="date"]').fill('2024-06-15') // 12 months before frozen "today"
    await page.getByRole('button', { name: '儲存設定' }).click()

    await expect(page.getByTestId('summary-entitled')).toContainText('20')
  })

  test('成長列顯示滿最後一列門檻加 12 個月起的文字，且門檻隨最後一列月數更新', async ({ page }) => {
    await page.getByRole('button', { name: '公司另有規定' }).click()

    // Default custom rules' last threshold is 120 months -> 120 + 12 = 132.
    // Growth defaults to perYear 1 / cap 30 for a brand-new setup (D8).
    await expect(page.getByTestId('custom-growth-row')).toContainText('滿 132 個月起')
    await expect(page.getByLabel('每年增加天數')).toHaveValue('1')
    await expect(page.getByLabel('天數上限')).toHaveValue('30')
    // No delete affordance on the growth row -- it's not a removable rule.
    await expect(page.getByTestId('custom-growth-row').getByRole('button', { name: '刪除此規則' })).toHaveCount(0)

    // Retarget the last (120mo) row's threshold to 96 -> growth row follows to 96 + 12 = 108.
    const lastRow = page.getByTestId('custom-rule-row').filter({ has: page.locator('input[value="120"]') })
    await lastRow.locator('input[step="1"]').fill('96')
    await expect(page.getByTestId('custom-growth-row')).toContainText('滿 108 個月起')
  })

  test('新增規則後成長列門檻跟著更新', async ({ page }) => {
    await page.getByRole('button', { name: '公司另有規定' }).click()

    // addCustomRule() appends 12 months past the current last row (120 -> 132),
    // so the growth row's threshold follows it to 132 + 12 = 144.
    await page.getByRole('button', { name: '新增規則' }).click()
    await expect(page.getByTestId('custom-growth-row')).toContainText('滿 144 個月起')
  })

  test('每年增加天數為 0 時，上限欄位停用', async ({ page }) => {
    await page.getByRole('button', { name: '公司另有規定' }).click()

    await page.getByLabel('每年增加天數').fill('0')

    await expect(page.getByLabel('天數上限')).toBeDisabled()
    await expect(page.getByLabel('天數上限')).toHaveCSS('cursor', 'not-allowed')
    await expect(page.getByLabel('每年增加天數')).not.toHaveCSS('cursor', 'not-allowed')

    // min/max mirror validateSettingsInput's actual bounds (#30).
    await expect(page.getByLabel('每年增加天數')).toHaveAttribute('min', '0')
    await expect(page.getByLabel('每年增加天數')).toHaveAttribute('max', String(MAX_ANNUAL_LEAVE_DAYS))
    // capMin follows the highest-threshold row's days; with DEFAULT_CUSTOM_RULES
    // that row is 120 months / 16 days.
    await expect(page.getByLabel('天數上限')).toHaveAttribute('min', '16')
    await expect(page.getByLabel('天數上限')).toHaveAttribute('max', String(MAX_ANNUAL_LEAVE_DAYS))
  })

  test('每年增加天數留空時顯示「請填寫每年增加天數」', async ({ page }) => {
    await page.locator('input[type="date"]').fill('2024-06-15')
    await page.getByRole('button', { name: '公司另有規定' }).click()
    await expect(page.getByRole('button', { name: '儲存設定' })).toBeEnabled()

    const perYearInput = page.getByLabel('每年增加天數')
    await perYearInput.fill('')
    await perYearInput.blur()

    await expect(page.getByText('請填寫每年增加天數', { exact: true })).toBeVisible()
    await expect(page.getByRole('button', { name: '儲存設定' })).toBeDisabled()
  })

  test('天數上限低於最後一列天數時顯示錯誤', async ({ page }) => {
    await page.locator('input[type="date"]').fill('2024-06-15')
    await page.getByRole('button', { name: '公司另有規定' }).click()
    await expect(page.getByRole('button', { name: '儲存設定' })).toBeEnabled()

    // Default growth per-year is prefilled at 1; last row's days is 16.
    const capInput = page.getByLabel('天數上限')
    await capInput.fill('10')
    await capInput.blur()

    await expect(page.getByText('天數上限不可低於最後一列的天數（16 天）', { exact: true })).toBeVisible()
    await expect(page.getByRole('button', { name: '儲存設定' })).toBeDisabled()
  })

  test('天數上限非 0.25 倍數時顯示錯誤', async ({ page }) => {
    await page.locator('input[type="date"]').fill('2024-06-15')
    await page.getByRole('button', { name: '公司另有規定' }).click()
    await expect(page.getByRole('button', { name: '儲存設定' })).toBeEnabled()

    const capInput = page.getByLabel('天數上限')
    await capInput.fill('20.1')
    await capInput.blur()

    await expect(page.getByText('天數上限須為 0.25 的倍數', { exact: true })).toBeVisible()
    await expect(page.getByRole('button', { name: '儲存設定' })).toBeDisabled()
  })

  test('成長設定儲存後首頁天數套用逐年成長', async ({ page }) => {
    await page.getByRole('button', { name: '公司另有規定' }).click()

    // Default growth (perYear 1, cap 30) is prefilled; keep it as-is.
    // Onboard 2014-06-15 -> frozen "today" 2025-06-15 is exactly 132 completed
    // months -> milestone 132, 12 months past the last threshold (120, 16
    // days) -> 16 + 1*1 = 17.
    await page.locator('input[type="date"]').fill('2014-06-15')
    await page.getByRole('button', { name: '儲存設定' }).click()

    await expect(page.getByTestId('summary-entitled')).toContainText('17')
  })

  test('特休天數、每年增加天數、天數上限都填上限值可以儲存 (#45)', async ({ page }) => {
    await page.getByRole('button', { name: '公司另有規定' }).click()

    const lastRow = page.getByTestId('custom-rule-row').filter({ has: page.locator('input[value="120"]') })
    await lastRow.locator('input[step="0.25"]').fill(String(MAX_ANNUAL_LEAVE_DAYS))
    await page.getByLabel('每年增加天數').fill(String(MAX_ANNUAL_LEAVE_DAYS))
    await page.getByLabel('天數上限').fill(String(MAX_ANNUAL_LEAVE_DAYS))
    // Onboard date exactly 120 months (10 years) before frozen "today"
    // (2025-06-15) -> current milestone is exactly the last row's own
    // threshold, so its days apply directly with no growth involved yet.
    await page.locator('input[type="date"]').fill('2015-06-15')

    await page.getByRole('button', { name: '儲存設定' }).click()

    // Back on the main page -- save succeeded, no alert fired.
    await expect(page.getByText('到職日：')).toBeVisible()
    await expect(page.getByTestId('summary-entitled')).toContainText(String(MAX_ANNUAL_LEAVE_DAYS))
  })

  test('特休天數超過上限且非 0.25 倍數時，兩則錯誤同時顯示 (#45, W4)', async ({ page }) => {
    await page.locator('input[type="date"]').fill('2024-06-15')
    await page.getByRole('button', { name: '公司另有規定' }).click()
    await expect(page.getByRole('button', { name: '儲存設定' })).toBeEnabled()

    const lastRow = page.getByTestId('custom-rule-row').filter({ has: page.locator('input[value="120"]') })
    const daysInput = lastRow.locator('input[step="0.25"]')
    await daysInput.fill(String(MAX_ANNUAL_LEAVE_DAYS + 0.1))
    await daysInput.blur()

    await expect(lastRow.getByText(`天數不可超過 ${MAX_ANNUAL_LEAVE_DAYS} 天`, { exact: true })).toBeVisible()
    await expect(lastRow.getByText('天數須為 0.25 的倍數', { exact: true })).toBeVisible()
    await expect(page.getByRole('button', { name: '儲存設定' })).toBeDisabled()
  })

  test('每年增加天數改回 0 後可以儲存，且天數上限一併存為 0 (C4)', async ({ page }) => {
    await page.getByRole('button', { name: '公司另有規定' }).click()

    // Default growth is prefilled at perYear 1 / cap 30. Type a stale cap
    // value first, then zero out perYear -- the disabled cap field's stale
    // state must not block the save (C4).
    await page.getByLabel('天數上限').fill('9000')
    await page.getByLabel('每年增加天數').fill('0')
    await page.locator('input[type="date"]').fill('2024-06-15')

    await expect(page.getByRole('button', { name: '儲存設定' })).toBeEnabled()
    await page.getByRole('button', { name: '儲存設定' }).click()

    // Back on the main page -- save succeeded.
    await expect(page.getByText('到職日：')).toBeVisible()

    // The disabled cap field's stale '9000' must not have been persisted --
    // Settings.jsx saves cap as 0 whenever perYear is 0 (C4).
    const storedSettings = await page.evaluate(
      () => JSON.parse(window.localStorage.getItem('leaveCalculator_settings'))
    )
    expect(storedSettings.customGrowth).toEqual({ perYear: 0, cap: 0 })
  })

  test('公司另有規定使用預設門檻時，滿 4 年後仍是 12 個月一期', async ({ page }) => {
    // Driven through the UI rather than seeded: the default thresholds are
    // defined in Settings.jsx (DEFAULT_CUSTOM_RULES), so seeding them here
    // would just be a copy that silently drifts if that default ever changes.
    await page.getByRole('button', { name: '公司另有規定' }).click()

    // Onboard date 2021-06-15, frozen "today" 2025-06-15 -> exactly 48
    // completed months -> milestone 48 (14 days, gap-filled from the 36-month
    // rule), period 2025-06-15 ~ 2026-06-14 (12 months, not the pre-fix
    // 2024-06-15 ~ 2026-06-14 span across milestone 36).
    await page.locator('input[type="date"]').fill('2021-06-15')
    await page.getByRole('button', { name: '儲存設定' }).click()

    await expect(page.getByTestId('period-range')).toContainText('2025-06-15')
    await expect(page.getByTestId('period-range')).toContainText('2026-06-14')
    await expect(page.getByTestId('summary-entitled')).toContainText('14')
    await expect(page.getByTestId('period-tabs').getByRole('button')).toHaveCount(5)
    await expect(page.getByTestId('period-tabs').getByRole('button').first()).toHaveText('2025–26')
  })

  test('到職日留空但已 blur 過時，顯示「請填寫到職日」', async ({ page }) => {
    // Positive case first: covers the touched filter -- disabled but no
    // message before any interaction with the date field.
    await expect(page.getByRole('button', { name: '儲存設定' })).toBeDisabled()
    await expect(page.getByText('請填寫到職日')).toHaveCount(0)

    // Not "fill nothing then click save" -- the save button starts disabled
    // and stays disabled with an empty onboard date, so .click() would just
    // time out waiting for it to become enabled, and even if it could be
    // clicked, that click wouldn't mark onboardDate touched (only the date
    // input's own onBlur does).
    const dateInput = page.locator('input[type="date"]')
    await dateInput.focus()
    await dateInput.blur()

    await expect(page.getByText('請填寫到職日', { exact: true })).toBeVisible()
    await expect(page.getByRole('button', { name: '儲存設定' })).toBeDisabled()
  })

  test('ruleType 切換時，儲存按鈕與合規清單立即反映新的 ruleType，不需要額外互動 (C1)', async ({ page }) => {
    await page.locator('input[type="date"]').fill('2024-06-15')
    await page.getByRole('button', { name: '公司另有規定' }).click()

    // Also make the custom rules non-compliant (12-month row's days below
    // labor law's own 7-day minimum for that threshold) so the compliance
    // advisory list -- not just the save button -- has something to react to.
    const twelveMonthRow = page.getByTestId('custom-rule-row').filter({ has: page.locator('input[value="12"]') })
    await twelveMonthRow.locator('input[step="0.25"]').fill('5')
    const complianceText = page.getByText('以下年資區間的天數低於勞基法最低標準')
    await expect(complianceText).toBeVisible()

    const lastRow = page.getByTestId('custom-rule-row').filter({ has: page.locator('input[value="120"]') })
    const daysInput = lastRow.locator('input[step="0.25"]')
    await daysInput.fill('')
    await daysInput.blur()

    await expect(lastRow.getByText('請填寫天數', { exact: true })).toBeVisible()
    await expect(page.getByRole('button', { name: '儲存設定' })).toBeDisabled()

    // Switching to 'labor' bypasses every custom-only check immediately --
    // no further interaction with the (now unmounted) custom rows needed.
    // The compliance advisory (which only applies to 'custom') disappears
    // with it, since 'labor' rules are the reference standard themselves.
    await page.getByRole('button', { name: '按勞基法第38條' }).click()
    await expect(page.getByRole('button', { name: '儲存設定' })).toBeEnabled()
    await expect(complianceText).toHaveCount(0)

    // Switching back to 'custom' brings the same (already-touched) error
    // back immediately too, and the compliance advisory reappears without
    // any further interaction with the custom rows.
    await page.getByRole('button', { name: '公司另有規定' }).click()
    await expect(page.getByRole('button', { name: '儲存設定' })).toBeDisabled()
    await expect(complianceText).toBeVisible()
  })

  test('兩組不同數值的重複門檻各自在集中清單顯示一行 (C3)', async ({ page }) => {
    await page.getByRole('button', { name: '公司另有規定' }).click()

    // Retarget 6mo -> 12mo (duplicates the existing 12mo row) and
    // 36mo -> 24mo (duplicates the existing 24mo row): two independent
    // duplicate groups with different threshold values, each with its own
    // dedupeKey -- unlike the single-group case above, both lines should
    // show up in the centralized list.
    // Tab (not .blur() on these locators) after each fill: blurring
    // re-syncs the DOM `value` attribute, after which each locator's
    // `input[value="…"]` filter no longer matches; calling `.blur()` on the
    // locator itself would re-resolve that now-stale filter and find
    // nothing. Tab blurs the currently focused input without re-resolving it.
    const sixMonthRow = page.getByTestId('custom-rule-row').filter({ has: page.locator('input[value="6"]') })
    const sixMonthsInput = sixMonthRow.locator('input[step="1"]')
    await sixMonthsInput.fill('12')
    await page.keyboard.press('Tab')

    const thirtySixMonthRow = page.getByTestId('custom-rule-row').filter({ has: page.locator('input[value="36"]') })
    const thirtySixMonthsInput = thirtySixMonthRow.locator('input[step="1"]')
    await thirtySixMonthsInput.fill('24')
    await page.keyboard.press('Tab')

    const formWarnings = page.getByTestId('settings-form-warnings')
    await expect(formWarnings.getByText('年資門檻「12 個月」重複，請合併或刪除其中一列', { exact: true })).toBeVisible()
    await expect(formWarnings.getByText('年資門檻「24 個月」重複，請合併或刪除其中一列', { exact: true })).toBeVisible()
    await expect(formWarnings.locator('p')).toHaveCount(2)
  })

  test('B2 回歸：某列年資門檻不合法時，天數上限欄位不顯示帶著無意義數值的「不可低於」訊息', async ({ page }) => {
    await page.getByRole('button', { name: '公司另有規定' }).click()

    const sixMonthRow = page.getByTestId('custom-rule-row').filter({ has: page.locator('input[value="6"]') })
    const monthsInput = sixMonthRow.locator('input[step="1"]')
    await monthsInput.fill('')
    // Tab instead of .blur(): blurring re-syncs the DOM `value` attribute,
    // after which the `input[value="6"]` filter `monthsInput` was built from
    // no longer matches; calling `.blur()` on it would re-resolve that
    // now-stale filter and find nothing.
    await page.keyboard.press('Tab')

    const capInput = page.getByLabel('天數上限')
    await capInput.fill('10')
    await capInput.blur()

    await expect(page.getByText(/天數上限不可低於最後一列的天數/)).toHaveCount(0)
  })

  test('B2 回歸：最後一列天數本身不合法時，天數上限欄位不顯示帶著無意義數值的「不可低於」訊息', async ({ page }) => {
    await page.locator('input[type="date"]').fill('2024-06-15')
    await page.getByRole('button', { name: '公司另有規定' }).click()
    await expect(page.getByRole('button', { name: '儲存設定' })).toBeEnabled()

    const lastRow = page.getByTestId('custom-rule-row').filter({ has: page.locator('input[value="120"]') })
    const daysInput = lastRow.locator('input[step="0.25"]')
    // 20.1 is deliberately invalid (not a multiple of 0.25) AND greater than
    // the cap filled below (10) -- with the guard removed, 10 < 20.1 would
    // be true and the warning WOULD fire (with the bogus "20.1 天" baked
    // in), so this has discriminating power. -5 (used previously) is also
    // invalid, but -5 < 10 is false regardless of the guard, so that value
    // passed the assertion even with the guard deleted -- it tested nothing.
    await daysInput.fill('20.1')
    await daysInput.blur()

    const capInput = page.getByLabel('天數上限')
    await capInput.fill('10')
    await capInput.blur()

    // Prefix/regex match, not { exact: true }: this asserts the message
    // never appears with ANY day-count value baked in, not just a
    // particular one.
    const growthRow = page.getByTestId('custom-growth-row')
    await expect(growthRow.getByText(/^天數上限不可低於最後一列的天數/)).toHaveCount(0)
    await expect(page.getByRole('button', { name: '儲存設定' })).toBeDisabled()
  })

  test('切回勞基法標準時，先前的自訂規則相關警示不殘留', async ({ page }) => {
    await page.locator('input[type="date"]').fill('2024-06-15')
    await page.getByRole('button', { name: '公司另有規定' }).click()

    const row = page.getByTestId('custom-rule-row').filter({ has: page.locator('input[value="12"]') })
    const daysInput = row.locator('input[step="0.25"]')
    await daysInput.fill('')
    await daysInput.blur()

    const perYearInput = page.getByLabel('每年增加天數')
    await perYearInput.fill('')
    await perYearInput.blur()

    await expect(page.getByRole('button', { name: '儲存設定' })).toBeDisabled()

    await page.getByRole('button', { name: '按勞基法第38條' }).click()

    await expect(page.getByRole('button', { name: '儲存設定' })).toBeEnabled()
    await expect(page.getByText('請填寫天數')).toHaveCount(0)
    await expect(page.getByText('請填寫每年增加天數')).toHaveCount(0)
  })

  test('把最後一列月數改到接近上限後新增規則，新列的年資門檻錯誤立即可見（不必碰新列，方案 c）', async ({ page }) => {
    await page.getByRole('button', { name: '公司另有規定' }).click()

    const lastRow = page.getByTestId('custom-rule-row').filter({ has: page.locator('input[value="120"]') })
    const monthsInput = lastRow.locator('input[step="1"]')
    await monthsInput.fill('1189')
    // Tab instead of .blur(): blurring re-syncs the DOM `value` attribute,
    // after which the `input[value="120"]` filter `monthsInput` was built
    // from no longer matches; calling `.blur()` on it would re-resolve that
    // now-stale filter and find nothing.
    await page.keyboard.press('Tab')

    // addCustomRule() appends 12 months past the current last row:
    // 1189 + 12 = 1201, past MAX_MILESTONE_MONTHS (1200). Its touched state
    // is set automatically on creation (maintainer decision c), so the
    // error is visible without ever touching the new row's own inputs.
    await page.getByRole('button', { name: '新增規則' }).click()

    await expect(page.getByText(
      `年資門檻請填寫 ${MAX_MILESTONE_MONTHS} 個月（${MAX_MILESTONE_MONTHS / 12} 年）以內的正整數`,
      { exact: true }
    )).toBeVisible()
  })

  test('合規建議清單（advisory）與新警示集中清單（blocking）同時出現時，樣式與位置都不同 (W13)', async ({ page }) => {
    await page.getByRole('button', { name: '公司另有規定' }).click()

    // Trigger the compliance advisory: the 12-month row's days (7) drops
    // below labor law's own 7-day minimum for that threshold.
    const twelveMonthRow = page.getByTestId('custom-rule-row').filter({ has: page.locator('input[value="12"]') })
    await twelveMonthRow.locator('input[step="0.25"]').fill('5')

    // Trigger a form-scoped blocking error at the same time: retarget the
    // 6-month row to duplicate the existing 12-month threshold.
    const sixMonthRow = page.getByTestId('custom-rule-row').filter({ has: page.locator('input[value="6"]') })
    const sixMonthsInput = sixMonthRow.locator('input[step="1"]')
    await sixMonthsInput.fill('12')
    // Tab instead of .blur(): blurring re-syncs the DOM `value` attribute,
    // after which the `input[value="6"]` filter `sixMonthsInput` was built
    // from no longer matches; calling `.blur()` on it would re-resolve that
    // now-stale filter and find nothing.
    await page.keyboard.press('Tab')

    const complianceBox = page.getByText('以下年資區間的天數低於勞基法最低標準').locator('..')
    const formWarnings = page.getByTestId('settings-form-warnings')
    await expect(complianceBox).toBeVisible()
    await expect(formWarnings).toBeVisible()

    // Different styling: the advisory list keeps its amber card; the new
    // centralized list is deliberately plain text (see plan §7.3 W13).
    await expect(complianceBox).toHaveClass(/bg-amber-50/)
    await expect(formWarnings).not.toHaveClass(/bg-amber-50/)

    // Different physical position: the advisory card sits above the new
    // centralized list, not interleaved with it.
    const complianceBoxRect = await complianceBox.boundingBox()
    const formWarningsRect = await formWarnings.boundingBox()
    expect(complianceBoxRect.y).toBeLessThan(formWarningsRect.y)
  })
})

// A separate top-level describe on purpose: '特休規則設定' navigates
// straight to the settings page in its beforeEach with no seeded settings
// (that describe's own comment says so), so seedAppStorage() called inside
// one of its tests would run too late for page.addInitScript() to take
// effect, and the page wouldn't even be on '/' to read summary-* from.
// This test needs its own explicit freeze -> seed -> navigate order instead.
test.describe('既有資料相容性（#19 切點重新分配）', () => {
  test('既有請假記錄因切點重新分配而超支時，首頁仍正常顯示且不拋錯', async ({ page }) => {
    await freezeTime(page, '2022-03-01T03:00:00')
    await seedAppStorage(page, {
      settings: {
        onboardDate: '2020-01-01',
        ruleType: 'custom',
        customRules: [
          { id: 'c1', months: 6, days: 3 },
          { id: 'c2', months: 12, days: 7 },
          { id: 'c3', months: 30, days: 14 },
        ],
        allowCarryover: false,
      },
      records: [{ id: 'r1', startDate: '2022-02-01', days: 10 }],
    })
    await page.goto('/')

    await expect(page.getByTestId('summary-entitled')).toBeVisible()
    await expect(page.getByTestId('summary-remaining')).toContainText('-3')
  })
})

// Another separate top-level describe, for the same reason as above: this
// test needs settings seeded before first navigation, which the locked
// '特休規則設定' describe's beforeEach doesn't support.
test.describe('舊資料的荒謬天數設定會被夾值 (#45)', () => {
  test('儲存於上限修正前的荒謬規則天數，首頁額度顯示為 MAX_ANNUAL_LEAVE_DAYS', async ({ page }) => {
    await freezeTime(page)
    await seedAppStorage(page, {
      settings: {
        onboardDate: '2000-01-01',
        ruleType: 'custom',
        customRules: [{ id: 'c1', months: 6, days: 1e23 }],
        allowCarryover: false,
      },
    })
    await page.goto('/')

    await expect(page.getByTestId('summary-entitled')).toContainText(String(MAX_ANNUAL_LEAVE_DAYS))
  })

  test('舊資料缺少 days 欄位且成長規則啟用時，首頁額度顯示為 0 而非 NaN', async ({ page }) => {
    await freezeTime(page)
    await seedAppStorage(page, {
      settings: {
        onboardDate: '2000-01-01',
        ruleType: 'custom',
        customRules: [{ id: 'c1', months: 6 }], // missing `days` -> NaN
        customGrowth: { perYear: 1, cap: 30 },
        allowCarryover: false,
      },
    })
    await page.goto('/')

    await expect(page.getByTestId('summary-entitled')).toContainText('0')
  })
})
