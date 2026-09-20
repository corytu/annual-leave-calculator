import { test, expect } from '@playwright/test'
import { freezeTime, seedAppStorage } from './helpers.js'

test('leave markers announce recorded weekdays and disappear after deletion', async ({ page }) => {
  await freezeTime(page)
  await seedAppStorage(page, {
    settings: { onboardDate: '2024-06-15', ruleType: 'labor', customRules: [], allowCarryover: false },
    records: [{ id: 'accessible-leave', startDate: '2025-06-20', days: 3 }],
  })
  await page.goto('/')

  for (const day of [20, 23, 24]) {
    const tile = page.getByRole('button', { name: `2025年6月${day}日 已登記請假`, exact: true })
    await expect(tile).toBeVisible()
    await expect(tile.locator('.leave-dot')).toHaveAttribute('aria-hidden', 'true')
  }
  for (const day of [21, 22, 25]) {
    await expect(page.getByRole('button', { name: `2025年6月${day}日`, exact: true })).toBeVisible()
  }
  await page.getByRole('button', { name: '刪除' }).click()
  await expect(page.getByRole('button', { name: /已登記請假/ })).toHaveCount(0)
  await expect(page.getByRole('button', { name: '2025年6月20日', exact: true })).toBeVisible()
})
