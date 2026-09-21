/**
 * settingsValidation.js
 *
 * Pure validation for the settings form, extracted out of Settings.jsx so
 * boundary cases can be covered by fast unit tests instead of Playwright.
 */

import { getDaysForMilestone, MAX_MILESTONE_MONTHS } from './leaveCalculations.js'

/**
 * Validate the settings form before saving.
 *
 * Returns the message of the FIRST failing check, or null when everything
 * is valid. Check order is significant -- see the inline comments.
 *
 * Deliberately returns a single message rather than a list: collecting every
 * error would require deciding how dependent checks interact (e.g. whether
 * "cap below the last row's days" is meaningful when a row is itself
 * invalid). That belongs to a future inline-error UI, not to this refactor.
 *
 * @param {{
 *   onboardDate: string,
 *   ruleType: 'labor' | 'custom',
 *   customRules: Array<{ months: any, days: any }>,
 *   growthPerYear: string,  // raw input text
 *   growthCap: string,      // raw input text
 * }} input
 * @returns {string | null}
 */
export function validateSettingsInput({ onboardDate, ruleType, customRules, growthPerYear, growthCap }) {
  if (!onboardDate) {
    return '請填寫到職日'
  }

  const normalizedRules = customRules.map(r => ({
    ...r,
    months: Number(r.months),
    days: Number(r.days),
  }))

  // growthPerYearNum/growthCapNum are declared here, outside every branch,
  // because both the validation below and the onSave(...) payload built by
  // the caller need them in scope.
  const growthPerYearNum = Number(growthPerYear)
  const growthCapNum = Number(growthCap)

  if (ruleType === 'custom') {
    // This whole block -- including the empty-list guard -- must stay inside
    // the `ruleType === 'custom'` branch. A user who deleted every custom
    // rule and then switched back to 'labor' has an empty customRules array
    // that is irrelevant once ruleType is 'labor'; if the guard ran
    // unconditionally, they could never save again.
    if (normalizedRules.length === 0) {
      return '請至少保留一條自訂規則'
    }

    // Rows are validated before the growth row so the last row's days is
    // guaranteed to be <= MAX_ANNUAL_LEAVE_DAYS by the time the cap is checked;
    // otherwise "cap >= last row" and "cap <= MAX" could both be unsatisfiable.
    const sorted = [...normalizedRules].sort((a, b) => a.months - b.months)
    const seenMonths = new Set()
    for (const r of sorted) {
      // Reject months beyond the sanity ceiling used by
      // normalizeCustomThresholds (D14), so a silently-dropped threshold
      // doesn't look like a successful save.
      if (!Number.isInteger(r.months) || r.months < 1 || r.months > MAX_MILESTONE_MONTHS) {
        return `年資門檻請填寫 ${MAX_MILESTONE_MONTHS} 個月（${MAX_MILESTONE_MONTHS / 12} 年）以內的正整數`
      }
      if (seenMonths.has(r.months)) {
        return `年資門檻「${r.months} 個月」重複，請合併或刪除其中一列`
      }
      seenMonths.add(r.months)
      if (!r.days || r.days <= 0) {
        return '特休天數請填寫大於 0 的數字'
      }
    }

    // Growth row validation, appended to the same custom-rules branch.
    const perYearValid = growthPerYear !== '' && Number.isFinite(growthPerYearNum) &&
      growthPerYearNum >= 0 && (growthPerYearNum * 4) % 1 === 0
    if (!perYearValid) {
      return '每年增加天數請填寫大於等於 0、且為 0.25 的倍數的數字'
    }
    // Every cap check must stay inside this branch. When perYear is 0 the cap
    // input is disabled but its state may still hold a stale value (e.g. '9000'
    // typed before perYear was set to 0); validating it here would block the
    // save on a field the user cannot edit. The saved cap is 0 in that case.
    if (growthPerYearNum > 0) {
      const lastDays = getDaysForMilestone(
        Math.max(...sorted.map(r => r.months)), 'custom', customRules
      )
      if (growthCap === '' || !Number.isFinite(growthCapNum)) {
        return '天數上限請填寫數字'
      }
      if (growthCapNum < lastDays) {
        return `天數上限不可低於最後一列的天數（${lastDays} 天）`
      }
      if ((growthCapNum * 4) % 1 !== 0) {
        return '天數上限請填寫 0.25 的倍數'
      }
    }
  }

  return null
}
