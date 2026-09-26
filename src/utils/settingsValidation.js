/**
 * settingsValidation.js
 *
 * Pure validation for the settings form, extracted out of Settings.jsx so
 * boundary cases can be covered by fast unit tests instead of Playwright.
 */

import { getDaysForMilestone, MAX_MILESTONE_MONTHS, MAX_ANNUAL_LEAVE_DAYS } from './leaveCalculations.js'
import { isBlocking, isQuarterStep } from './warnings.js'

/**
 * Days for the custom rule whose months threshold is the highest (not
 * necessarily the last element in `customRules`' original order). This is
 * what the cap must be `>=` -- shared by the save-time validation below and
 * by Settings.jsx, which uses it to set the cap input's `min`.
 *
 * @param {Array<{ months: any, days: any }>} customRules
 * @returns {number}
 */
export function getLastRuleDays(customRules) {
  const normalizedRules = customRules.map(r => ({
    ...r,
    months: Number(r.months),
    days: Number(r.days),
  }))
  const sorted = [...normalizedRules].sort((a, b) => a.months - b.months)
  return getDaysForMilestone(
    Math.max(...sorted.map(r => r.months)), 'custom', customRules
  )
}

/**
 * The value to use as the cap input's `min`. Only meaningful when the
 * highest-threshold rule's days is itself a valid day count (finite, >=
 * 0.25, a multiple of 0.25) -- e.g. mid-edit it could be blank, negative, or
 * fractional in a way that isn't a quarter-day step, none of which should be
 * pinned as a floor. Falls back to 0 in those cases; the real gate against
 * an invalid cap is still validateSettingsInput below, this only steers the
 * input's spinner arrows and :invalid state.
 *
 * @param {Array<{ months: any, days: any }>} customRules
 * @returns {number}
 */
export function getCustomCapMin(customRules) {
  const lastDays = getLastRuleDays(customRules)
  const isValid = Number.isFinite(lastDays) && lastDays >= 0.25 && (lastDays * 4) % 1 === 0
  return isValid ? lastDays : 0
}

/**
 * Validate the settings form, returning every applicable warning instead of
 * stopping at the first failure (see warnings.js's Warning typedef). Check
 * order inside the `ruleType === 'custom'` branch is still significant for
 * dependent checks -- see the inline comments.
 *
 * @param {{
 *   onboardDate: string,
 *   ruleType: 'labor' | 'custom',
 *   customRules: Array<{ id: string, months: any, days: any }>,
 *   growthPerYear: string,  // raw input text
 *   growthCap: string,      // raw input text
 * }} input
 * @returns {import('./warnings.js').Warning[]}
 */
export function validateSettingsInput({ onboardDate, ruleType, customRules, growthPerYear, growthCap }) {
  const warnings = []

  if (!onboardDate) {
    warnings.push({
      id: 'onboardDate-incomplete', tier: 'incomplete', scope: 'field', field: 'onboardDate',
      touchedKeys: ['onboardDate'], message: '請填寫到職日',
    })
  }

  if (ruleType === 'custom') {
    if (customRules.length === 0) {
      warnings.push({
        id: 'customRules-empty', tier: 'error', scope: 'form', field: 'months',
        touchedKeys: [], message: '請至少保留一條自訂規則',
      })
    }

    // 逐列驗證：W9 空值判斷讀「原始值」，不能先 Number() 再判斷
    // （Number('') === 0，不是 NaN，會被誤判成「非正整數」而不是「未完成」）。
    for (const r of customRules) {
      const monthsIsEmpty = r.months === '' || r.months === null || r.months === undefined
      if (monthsIsEmpty) {
        warnings.push({
          id: `row-${r.id}-months-incomplete`, tier: 'incomplete', scope: 'row', rowId: r.id,
          field: 'months', touchedKeys: [`${r.id}:months`], message: '請填寫年資門檻',
        })
      } else {
        const monthsNum = Number(r.months)
        if (!Number.isInteger(monthsNum) || monthsNum < 1 || monthsNum > MAX_MILESTONE_MONTHS) {
          warnings.push({
            id: `row-${r.id}-months-invalid`, tier: 'error', scope: 'row', rowId: r.id, field: 'months',
            touchedKeys: [`${r.id}:months`],
            message: `年資門檻請填寫 ${MAX_MILESTONE_MONTHS} 個月（${MAX_MILESTONE_MONTHS / 12} 年）以內的正整數`,
          })
        }
      }

      const daysIsEmpty = r.days === '' || r.days === null || r.days === undefined
      if (daysIsEmpty) {
        warnings.push({
          id: `row-${r.id}-days-incomplete`, tier: 'incomplete', scope: 'row', rowId: r.id,
          field: 'days', touchedKeys: [`${r.id}:days`], message: '請填寫天數',
        })
      } else {
        const daysNum = Number(r.days)
        if (!(Number.isFinite(daysNum) && daysNum > 0)) {
          warnings.push({
            id: `row-${r.id}-days-positive`, tier: 'error', scope: 'row', rowId: r.id, field: 'days',
            touchedKeys: [`${r.id}:days`], message: '天數須大於 0',
          })
        }
        if (Number.isFinite(daysNum) && daysNum > MAX_ANNUAL_LEAVE_DAYS) {
          warnings.push({
            id: `row-${r.id}-days-max`, tier: 'error', scope: 'row', rowId: r.id, field: 'days',
            touchedKeys: [`${r.id}:days`], message: `天數不可超過 ${MAX_ANNUAL_LEAVE_DAYS} 天`,
          })
        }
        if (!isQuarterStep(daysNum)) {
          warnings.push({
            id: `row-${r.id}-days-quarter-step`, tier: 'error', scope: 'row', rowId: r.id, field: 'days',
            touchedKeys: [`${r.id}:days`], message: '天數須為 0.25 的倍數',
          })
        }
      }
    }

    // 門檻重複偵測（W15：只比對「兩列都已經是合法正整數、且數值相同」的情況）
    const validMonthsRows = customRules.filter(r => {
      const n = Number(r.months)
      const monthsIsEmpty = r.months === '' || r.months === null || r.months === undefined
      return !monthsIsEmpty && Number.isInteger(n) && n >= 1 && n <= MAX_MILESTONE_MONTHS
    })
    const groups = new Map() // monthsNum -> rowId[]
    for (const r of validMonthsRows) {
      const n = Number(r.months)
      if (!groups.has(n)) groups.set(n, [])
      groups.get(n).push(r.id)
    }
    for (const [monthsNum, rowIds] of groups) {
      if (rowIds.length < 2) continue
      for (const rowId of rowIds) {
        warnings.push({
          id: `row-${rowId}-months-duplicate-${monthsNum}`, tier: 'error', scope: 'form',
          rowId, field: 'months', touchedKeys: [`${rowId}:months`],
          dedupeKey: `months-duplicate-${monthsNum}`,
          message: `年資門檻「${monthsNum} 個月」重複，請合併或刪除其中一列`,
        })
      }
    }

    const perYearIsEmpty = growthPerYear === '' || growthPerYear === null || growthPerYear === undefined
    if (perYearIsEmpty) {
      warnings.push({
        id: 'growthPerYear-incomplete', tier: 'incomplete', scope: 'field', field: 'growthPerYear',
        touchedKeys: ['growthPerYear'], message: '請填寫每年增加天數',
      })
    } else {
      const perYearNum = Number(growthPerYear)
      if (!(Number.isFinite(perYearNum) && perYearNum >= 0)) {
        warnings.push({
          id: 'growthPerYear-nonnegative', tier: 'error', scope: 'field', field: 'growthPerYear',
          touchedKeys: ['growthPerYear'], message: '每年增加天數須大於等於 0',
        })
      }
      if (Number.isFinite(perYearNum) && perYearNum > MAX_ANNUAL_LEAVE_DAYS) {
        warnings.push({
          id: 'growthPerYear-max', tier: 'error', scope: 'field', field: 'growthPerYear',
          touchedKeys: ['growthPerYear'], message: `每年增加天數不可超過 ${MAX_ANNUAL_LEAVE_DAYS} 天`,
        })
      }
      if (!isQuarterStep(perYearNum)) {
        warnings.push({
          id: 'growthPerYear-quarter-step', tier: 'error', scope: 'field', field: 'growthPerYear',
          touchedKeys: ['growthPerYear'], message: '每年增加天數須為 0.25 的倍數',
        })
      }

      // cap 只在 perYearNum > 0 時才驗證（perYear === 0 時欄位本來就停用）。
      // 這個 gate 跟 Settings.jsx 裡 cap 輸入框的 disabled 條件
      // （growthPerYear !== '' && Number(growthPerYear) === 0）不完全對稱：
      // perYear 為空或負數時，cap 輸入框在 UI 上仍可編輯但這裡不驗證它。
      // 這是刻意接受的不對稱——perYear 本身的 incomplete/error 已經會擋住
      // 儲存，cap 驗不驗證不影響最終能不能送出。
      if (perYearNum > 0) {
        const capIsEmpty = growthCap === '' || growthCap === null || growthCap === undefined
        if (capIsEmpty) {
          warnings.push({
            id: 'growthCap-incomplete', tier: 'incomplete', scope: 'field', field: 'growthCap',
            touchedKeys: ['growthCap'], message: '請填寫天數上限',
          })
        } else {
          const capNum = Number(growthCap)
          if (Number.isFinite(capNum) && capNum > MAX_ANNUAL_LEAVE_DAYS) {
            warnings.push({
              id: 'growthCap-max', tier: 'error', scope: 'field', field: 'growthCap',
              touchedKeys: ['growthCap'], message: `天數上限不可超過 ${MAX_ANNUAL_LEAVE_DAYS} 天`,
            })
          }
          if (!isQuarterStep(capNum)) {
            warnings.push({
              id: 'growthCap-quarter-step', tier: 'error', scope: 'field', field: 'growthCap',
              touchedKeys: ['growthCap'], message: '天數上限須為 0.25 的倍數',
            })
          }

          // cap-min-lastrow（W15：只要任何一列的 months 有 blocking 警示，整條跳過；
          // 重用既有 getLastRuleDays 取得天數）：
          const anyMonthsBlocking = warnings.some(w => w.field === 'months' && isBlocking(w.tier))
          if (!anyMonthsBlocking && customRules.length > 0) {
            const lastRow = customRules.reduce((a, b) => (Number(b.months) > Number(a.months) ? b : a))
            const lastRowDaysBlocking = warnings.some(
              w => w.rowId === lastRow.id && w.field === 'days' && isBlocking(w.tier)
            )
            if (!lastRowDaysBlocking) {
              const lastDays = getLastRuleDays(customRules)
              if (Number.isFinite(capNum) && capNum < lastDays) {
                warnings.push({
                  id: 'growthCap-min-lastrow', tier: 'error', scope: 'field', field: 'growthCap',
                  touchedKeys: ['growthCap', `${lastRow.id}:days`],
                  message: `天數上限不可低於最後一列的天數（${lastDays} 天）`,
                })
              }
            }
          }
        }
      }
    }
  }

  return warnings
}
