/**
 * leaveCalculations.js
 *
 * Core calculation utilities for Taiwan annual leave (特休假) calculator.
 * Supports 週年制 (anniversary-based system) only.
 *
 * Key concepts:
 * - Milestone: a month threshold (e.g., 6, 12, 24...) after which a new leave
 *   entitlement kicks in.
 * - Period: the interval between two consecutive milestones. The period starting
 *   at milestone M runs from (onboard + M months) to (onboard + next_milestone months - 1 day).
 * - For custom rules the last milestone repeats every 12 months indefinitely.
 */

// ─── Date helpers ────────────────────────────────────────────────────────────

/**
 * Add months to a date, clamping to the last valid day of the month.
 * This correctly handles:
 *   - Jan 31 + 1 month → Feb 28/29 (not Mar 3)
 *   - Feb 29 + 12 months → Feb 28 (non-leap year)
 */
export function addMonthsToDate(date, months) {
  const d = new Date(date);
  const originalDay = d.getDate();
  d.setMonth(d.getMonth() + months);
  // If the day overflowed into the next month, roll back to the last day of
  // the intended month (setDate(0) means "last day of previous month").
  if (d.getDate() !== originalDay) {
    d.setDate(0);
  }
  return d;
}

/**
 * Return how many complete months have elapsed from `from` to `to`.
 * Uses addMonthsToDate to respect the clamping logic above.
 */
export function getCompletedMonths(from, to) {
  // Quick estimate
  let months =
    (to.getFullYear() - from.getFullYear()) * 12 +
    (to.getMonth() - from.getMonth());

  // If the anniversary of `months` months hasn't actually arrived yet today,
  // decrement by one.
  if (addMonthsToDate(from, months) > to) {
    months -= 1;
  }

  return Math.max(0, months);
}

/**
 * Pick which month a calendar should default to: the month containing
 * `today` when `today` falls inside the period, otherwise the period's
 * first month.
 */
export function getDefaultVisibleMonth(periodStart, periodEnd, today = new Date()) {
  const t = new Date(today.getFullYear(), today.getMonth(), today.getDate())
  const base = t >= periodStart && t <= periodEnd ? t : periodStart
  return new Date(base.getFullYear(), base.getMonth(), 1)
}

/**
 * Format a Date to YYYY-MM-DD (local date, not UTC).
 */
export function toISODateString(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

/**
 * Parse a YYYY-MM-DD string to a local Date (midnight local time).
 * Using new Date(str) would give midnight UTC and cause off-by-one on timezones.
 */
export function parseLocalDate(str) {
  const [y, m, d] = str.split('-').map(Number);
  return new Date(y, m - 1, d);
}

// ─── Labor law rules (勞基法第38條第1項) ──────────────────────────────────────

/**
 * Given completed months of tenure, return the entitlement for that period
 * under the Labor Standards Act.
 *
 * Milestone → days:
 *   6  → 3
 *   12 → 7
 *   24 → 10
 *   36 → 14    (year 4)
 *   48 → 14    (year 5)
 *   60 → 15    (years 6–10)
 *   120 → 16   (year 11)
 *   132 → 17   (year 12)  ... +1/yr, capped at 30
 */
export function getLaborLawDays(milestoneMonths) {
  if (milestoneMonths < 6)   return 0;
  if (milestoneMonths < 12)  return 3;
  if (milestoneMonths < 24)  return 7;
  if (milestoneMonths < 36)  return 10;
  if (milestoneMonths < 60)  return 14;
  if (milestoneMonths < 120) return 15;
  // 120+ months: +1 day per completed year beyond 9 full years, max 30
  const completedYears = Math.floor(milestoneMonths / 12);
  return Math.min(15 + (completedYears - 9), 30);
}

/**
 * Build the ordered list of milestone-month values for the labor law rules,
 * extended far enough to cover at least `upToMonths`.
 */
function buildLaborLawMilestones(upToMonths) {
  const fixed = [6, 12, 24, 36, 48, 60, 72, 84, 96, 108, 120];
  let m = 132;
  while (m <= upToMonths + 12) {
    fixed.push(m);
    m += 12;
  }
  return fixed;
}

// ─── Rules resolution ────────────────────────────────────────────────────────

// Sanity ceiling for any month-threshold value. Bounds the gap-fill loop
// below (a huge gap between two thresholds would otherwise iterate millions
// of times) and is reused by checkLaborLawCompliance's horizon clamp (#20).
export const MAX_MILESTONE_MONTHS = 1200; // 100 years

// Sanity ceiling for any entitlement value -- a single custom rule's days,
// the growth row's perYear and its cap. Rejects absurd input only; NOT a
// precise physical limit (a period can be shorter than 12 months, so even
// 260 weekdays isn't exact either). 365 makes the error message
// self-explanatory. Don't "correct" it to 260 (#45).
//
// Enforced in two places: validateSettingsInput() rejects new input with a
// message, and getDaysForMilestone() silently clamps values saved before
// this limit existed.
//
// Known consequence of the clamp (accepted tradeoff, not a bug): a user whose
// pre-#45 settings granted an absurd entitlement (e.g. 1e23 days) and who
// already logged leave close to that old entitlement will, after this clamp
// takes effect, permanently look overspent for that period -- their real
// `days` total still exceeds the clamped 365. validateRecordsChain checks the
// whole ledger, so it will then reject *every* new or edited record, not just
// ones touching the offending period, and the settings page is locked once
// onboardDate is saved, so they cannot lower the rule to fix it either. The
// only in-app fix is switching to that period's tab and deleting or shrinking
// the offending record: deletion (LeaveForm.jsx's RecordRow -> onDelete)
// never goes through validateRecordsChain, and editing validates the
// post-edit candidateRecords, so shrinking the record to within the clamped
// entitlement also passes. The cost is losing the leave logged under the old
// rule. Migrating stored data or scoping validateRecordsChain to only the
// periods a given edit touches would both avoid that cost, but are out of
// scope here -- see docs/reviews/83e5a17-annual-leave-cap-concept-plan.md §9.
export const MAX_ANNUAL_LEAVE_DAYS = 365;

/**
 * Clean user-entered thresholds into sorted, de-duplicated positive integers
 * within a sane range.
 * Duplicates must be removed here: getPeriodInfo() looks up the next
 * milestone by position, so a repeated value would make a period end
 * before it starts (#20).
 */
function normalizeCustomThresholds(customRules) {
  return [...new Set(
    (customRules ?? [])
      .map(r => Number(r?.months))
      .filter(m => Number.isInteger(m) && m >= 1 && m <= MAX_MILESTONE_MONTHS)
  )].sort((a, b) => a - b);
}

/** customGrowth value meaning "no growth after the last custom threshold". */
export const NO_CUSTOM_GROWTH = Object.freeze({ perYear: 0, cap: 0 });

/**
 * Coerce a possibly-partial or malformed customGrowth object into safe
 * numbers. Needed because settings loaded from storage may predate this
 * field, or customGrowth may be `null` from a hand-edited localStorage blob.
 */
function normalizeCustomGrowth(customGrowth) {
  const perYear = Number(customGrowth?.perYear);
  const cap = Number(customGrowth?.cap);
  return {
    perYear: Number.isFinite(perYear) && perYear > 0 ? perYear : 0,
    cap: Number.isFinite(cap) && cap > 0 ? cap : 0,
  };
}

/**
 * Compute entitled days for the period starting at `milestoneMonths` given
 * the user's settings.
 *
 * For custom rules, once `milestoneMonths` passes the highest threshold at or
 * below it, `customGrowth.perYear` days are added for each full year past
 * that threshold, capped at `customGrowth.cap` (never dropping below the
 * threshold's own days, even if cap is misconfigured below it).
 *
 * @param {number}  milestoneMonths
 * @param {string}  ruleType        'labor' | 'custom'
 * @param {Array}   customRules     [{months, days}] sorted ascending
 * @param {{perYear: number, cap: number}} [customGrowth]
 */
export function getDaysForMilestone(milestoneMonths, ruleType, customRules, customGrowth = NO_CUSTOM_GROWTH) {
  if (ruleType === 'custom') {
    // Only consider rules whose months value is a valid threshold -- the
    // same filter as normalizeCustomThresholds. Without this, a row mid-edit
    // (e.g. months cleared to 0) would still contribute its days here even
    // though getMilestones() already ignores it, and a months value beyond
    // MAX_MILESTONE_MONTHS would silently become the growth anchor below.
    const validRules = (customRules ?? [])
      .map(r => ({ months: Number(r?.months), days: Number(r?.days) }))
      .filter(r => Number.isInteger(r.months) && r.months >= 1 && r.months <= MAX_MILESTONE_MONTHS)
      .sort((a, b) => a.months - b.months);

    // Walk through valid rules to find the highest threshold ≤ milestone.
    let days = 0;
    for (const rule of validRules) {
      if (rule.months <= milestoneMonths) {
        days = rule.days;
      } else {
        break;
      }
    }
    if (validRules.length === 0) return days;

    // Growth only kicks in past the *last* (highest) valid threshold overall
    // -- not past whichever earlier threshold happens to apply to this
    // particular milestone. A milestone between two thresholds still just
    // gets that lower threshold's own days (D1), with no growth involved.
    const lastRule = validRules[validRules.length - 1];
    const { perYear, cap } = normalizeCustomGrowth(customGrowth);
    if (perYear > 0 && milestoneMonths > lastRule.months) {
      const k = Math.floor((milestoneMonths - lastRule.months) / 12);
      const grown = Math.min(
        lastRule.days + perYear * k,
        Math.max(cap, lastRule.days),
        MAX_ANNUAL_LEAVE_DAYS,
      );
      // NaN poisons every Math.min/Math.max comparison (all comparisons
      // involving NaN are false), so corrupt stored data -- e.g. a rule
      // missing `days`, normalized to Number(undefined) = NaN -- would
      // otherwise slip through unclamped instead of being caught here.
      // Falling back to 0 keeps the safe direction: an entitlement of 0
      // cannot cause the overspend hole #45 closes, while falling back to
      // MAX_ANNUAL_LEAVE_DAYS would just recreate a smaller version of it.
      return Number.isFinite(grown) ? grown : 0;
    }
    const clamped = Math.min(days, MAX_ANNUAL_LEAVE_DAYS);
    return Number.isFinite(clamped) ? clamped : 0;
  }
  return getLaborLawDays(milestoneMonths);
}

/**
 * Return the sorted list of milestone-month values relevant to the given
 * settings, extended to cover at least `upToMonths`.
 *
 * For custom rules, thresholds are first de-duplicated and clamped to
 * [1, MAX_MILESTONE_MONTHS]. Between any two consecutive thresholds, a new
 * period is cut every 12 months counting forward from the earlier one, so no
 * custom period ever exceeds a year. Any sub-year remainder therefore sits
 * just before the next threshold, and that remainder still gets the full-year
 * entitlement of the threshold it falls under -- it is not prorated.
 */
export function getMilestones(ruleType, customRules, upToMonths = 360) {
  if (ruleType !== 'custom') return buildLaborLawMilestones(upToMonths);

  const thresholds = normalizeCustomThresholds(customRules);
  if (thresholds.length === 0) return [6]; // fallback

  const milestones = [];
  thresholds.forEach((current, i) => {
    const next = thresholds[i + 1];
    if (next === undefined) {
      milestones.push(current);
      for (let m = current + 12; m <= upToMonths + 12; m += 12) milestones.push(m);
    } else {
      // Cut a new period every 12 months counting forward from this
      // threshold, so no period between two thresholds exceeds a year (#19).
      // Any sub-year remainder therefore sits just before `next`, and that
      // remainder still gets the full-year entitlement of `current` (not
      // prorated) -- this is intentional, see the design doc (D1).
      for (let m = current; m < next; m += 12) milestones.push(m);
    }
  });
  return milestones;
}

// ─── Period helpers ───────────────────────────────────────────────────────────

/**
 * Given the milestone that starts a period, return full period metadata.
 *
 * @returns {{
 *   milestoneMonths: number,
 *   periodStart: Date,
 *   periodEnd: Date,        ← inclusive last day
 *   entitledDays: number,
 * }}
 */
export function getPeriodInfo(onboardDate, milestoneMonths, ruleType, customRules, customGrowth = NO_CUSTOM_GROWTH) {
  const allMilestones = getMilestones(ruleType, customRules, milestoneMonths + 24);
  const idx = allMilestones.indexOf(milestoneMonths);

  let nextMilestoneMonths;
  if (idx >= 0 && idx + 1 < allMilestones.length) {
    nextMilestoneMonths = allMilestones[idx + 1];
  } else {
    // Past the pre-computed list: add 12 months
    nextMilestoneMonths = milestoneMonths + 12;
  }

  const periodStart = addMonthsToDate(onboardDate, milestoneMonths);
  // Period end is the day before the next period starts (inclusive)
  const nextStart = addMonthsToDate(onboardDate, nextMilestoneMonths);
  const periodEnd = new Date(nextStart);
  periodEnd.setDate(periodEnd.getDate() - 1);

  return {
    milestoneMonths,
    nextMilestoneMonths,
    periodStart,
    periodEnd,
    entitledDays: getDaysForMilestone(milestoneMonths, ruleType, customRules, customGrowth),
  };
}

/**
 * Find the period that contains `date`.
 * Returns null if `date` is before the first milestone.
 */
export function getPeriodContainingDate(onboardDate, date, ruleType, customRules, customGrowth = NO_CUSTOM_GROWTH) {
  const completedMonths = getCompletedMonths(onboardDate, date);
  const milestones = getMilestones(ruleType, customRules, completedMonths + 12);

  // Find the highest milestone that has been reached
  let currentMilestone = null;
  for (const m of milestones) {
    if (completedMonths >= m) {
      currentMilestone = m;
    } else {
      break;
    }
  }

  if (currentMilestone === null) return null;
  return getPeriodInfo(onboardDate, currentMilestone, ruleType, customRules, customGrowth);
}

// ─── Leave-record helpers ────────────────────────────────────────────────────

// Upper bound on how many dates one leave record can expand to on the
// calendar. The overspend guard caps a single period's total leave at
// carry-in (<= the previous period's entitlement) + this period's
// entitlement + the next period's advance, each <= MAX_ANNUAL_LEAVE_DAYS.
// A fractional trailing day still occupies a date, so a valid record yields
// at most ceil(days) <= 3 * MAX_ANNUAL_LEAVE_DAYS dates and is never
// truncated. Anything longer is corrupt data (e.g. hand-edited localStorage,
// or records saved before #45), and without this bound the loop below would
// freeze the tab during LeaveCalendar's render (#29).
//
// A module constant rather than a function parameter, so no caller can
// pass a larger value and bypass the guard. Exported for tests only.
export const MAX_LEAVE_RECORD_DATES = 3 * MAX_ANNUAL_LEAVE_DAYS;

/**
 * Expand a leave record's startDate + days into the list of calendar dates
 * it actually spans, skipping non-working days. Each working day consumes
 * 1 unit of `days`; a fractional trailing day still counts as a spanned date.
 *
 * `startDate` is a record's startDate field, a 'YYYY-MM-DD' string (storage.js).
 *
 * `isNonWorkingDay` defaults to weekends-only for backward compatibility;
 * callers that have holiday data pass `makeIsNonWorkingDay(holidayCache)`
 * instead so the expansion also skips national holidays and correctly
 * includes compensatory workdays (補班日) as working days (#33).
 *
 * Bounded by MAX_LEAVE_RECORD_DATES (#29); this only affects calendar dots --
 * getLeaveTakenInPeriod sums the raw `days` value directly, so a corrupt
 * record still shows up as an overspend in the summary (not silently hidden).
 */
export function getLeaveRecordDates(startDate, days, isNonWorkingDay = defaultWeekendCheck) {
  const start = parseLocalDate(startDate);
  const cursor = new Date(start);
  const dates = [];
  let remaining = Number(days);
  // A non-finite day count (NaN, Infinity) means the record is corrupt, so
  // mark nothing rather than guess. The bound below would already stop the
  // loop; this check exists to make that intent explicit.
  if (!Number.isFinite(remaining)) return dates;
  while (remaining > 0 && dates.length < MAX_LEAVE_RECORD_DATES) {
    if (!isNonWorkingDay(cursor)) {
      dates.push(toISODateString(cursor));
      remaining -= 1;
    }
    cursor.setDate(cursor.getDate() + 1);
  }
  return dates;
}

function defaultWeekendCheck(date) {
  return date.getDay() === 0 || date.getDay() === 6;
}

/**
 * Build an `isNonWorkingDay(date)` predicate backed by a year -> holiday-cache
 * entry map (see useHolidayCache.js). For a year with `available` data,
 * `isHoliday` from the source is the sole source of truth (it already covers
 * weekends and compensatory workdays, see §2.1 of the design doc); for any
 * other year (no data yet, `pending`, `loading`, `error`, `unavailable`) it
 * falls back to weekends-only. The same instance should be passed to both
 * getLeaveRecordDates (dot expansion) and LeaveCalendar's tileClassName
 * (visual highlighting) so the two never disagree.
 */
export function makeIsNonWorkingDay(holidayCache) {
  return function isNonWorkingDay(date) {
    const entry = holidayCache[date.getFullYear()];
    if (entry?.status === 'available') return entry.dates.has(toISODateString(date));
    return defaultWeekendCheck(date);
  };
}

/**
 * Sum leave days in `records` whose startDate falls within [periodStart, periodEnd].
 */
export function getLeaveTakenInPeriod(records, periodStart, periodEnd) {
  return records.reduce((sum, r) => {
    const d = parseLocalDate(r.startDate);
    if (d >= periodStart && d <= periodEnd) {
      return sum + r.days;
    }
    return sum;
  }, 0);
}

// ─── Chained ledger ───────────────────────────────────────────────────────────

/**
 * Compute the full chain of periods from the very first milestone through the
 * period containing `asOfDate`, threading an "old bucket" (carryIn) forward
 * from period to period.
 *
 * When `allowCarryover` is true, each period first deducts `taken` from its
 * carried-in balance (down to 0), then from its own entitlement. Whatever is
 * left of the old bucket settles (is forfeited) rather than carrying forward
 * again; only the remainder of the new bucket carries out to the next period.
 * A negative old-bucket balance (prior overspend) merges into the new bucket's
 * carry-out instead of settling.
 *
 * When `allowCarryover` is false, every period is fully independent: nothing
 * carries in, and whatever is left of the entitlement at period end simply
 * settles.
 *
 * @returns {Array<{
 *   milestoneMonths, nextMilestoneMonths, periodStart, periodEnd,
 *   carryIn, entitledDays, taken, oldEnd, newEnd, settlement, carryOut,
 * }>}
 */
export function computePeriodLedger(onboardDate, ruleType, customRules, records, asOfDate, allowCarryover, customGrowth = NO_CUSTOM_GROWTH) {
  const completedMonths = getCompletedMonths(onboardDate, asOfDate);
  const milestones = getMilestones(ruleType, customRules, completedMonths + 12);
  const chainMilestones = milestones.filter(m => m <= completedMonths);
  if (chainMilestones.length === 0) return [];

  const ledger = [];
  for (const milestoneMonths of chainMilestones) {
    const period = getPeriodInfo(onboardDate, milestoneMonths, ruleType, customRules, customGrowth);
    const entitledDays = period.entitledDays;
    const taken = getLeaveTakenInPeriod(records, period.periodStart, period.periodEnd);

    let carryIn, oldEnd, newEnd, settlement, carryOut;
    if (allowCarryover) {
      carryIn = ledger.length === 0 ? 0 : ledger[ledger.length - 1].carryOut;
      if (carryIn > 0) {
        const deductFromOld = Math.min(carryIn, taken);
        oldEnd = carryIn - deductFromOld;
        newEnd = entitledDays - (taken - deductFromOld);
      } else {
        oldEnd = carryIn;
        newEnd = entitledDays - taken;
      }
      if (oldEnd > 0) {
        settlement = oldEnd;
        carryOut = newEnd;
      } else {
        settlement = 0;
        carryOut = newEnd + oldEnd;
      }
    } else {
      carryIn = 0;
      oldEnd = 0;
      newEnd = entitledDays - taken;
      settlement = newEnd;
      carryOut = 0;
    }

    ledger.push({ ...period, carryIn, entitledDays, taken, oldEnd, newEnd, settlement, carryOut });
  }
  return ledger;
}

/**
 * Validate that adding/editing a record keeps every period in the chain
 * (from the first milestone through the latest period with data) within its
 * allowed overspend guard.
 *
 * With carryover enabled, a period may legally run its available balance
 * down to -(next period's entitlement), since that debt can be carried
 * forward and repaid once. With carryover disabled, periods are independent
 * and may never go negative at all.
 *
 * @returns {{ valid: true } | { valid: false, invalidPeriod: object, shortfall: number }}
 */
export function validateRecordsChain(settings, recordsAfterChange, asOfDate) {
  const { onboardDate, ruleType, customRules, allowCarryover, customGrowth } = settings;
  const growth = ruleType === 'custom' ? customGrowth : NO_CUSTOM_GROWTH;
  const onboard = parseLocalDate(onboardDate);

  const latestRecordDate = recordsAfterChange.reduce(
    (max, r) => { const d = parseLocalDate(r.startDate); return d > max ? d : max; },
    asOfDate
  );

  const ledger = computePeriodLedger(onboard, ruleType, customRules, recordsAfterChange, latestRecordDate, allowCarryover, growth);

  for (const entry of ledger) {
    if (allowCarryover) {
      const availableTotal = entry.carryIn + entry.entitledDays - entry.taken;
      const nextEntitled = getDaysForMilestone(entry.nextMilestoneMonths, ruleType, customRules, growth);
      if (availableTotal < -nextEntitled) {
        return { valid: false, invalidPeriod: entry, shortfall: -nextEntitled - availableTotal };
      }
    } else {
      const availableTotal = entry.entitledDays - entry.taken;
      if (availableTotal < 0) {
        return { valid: false, invalidPeriod: entry, shortfall: -availableTotal };
      }
    }
  }
  return { valid: true };
}

// ─── Top-level summary ────────────────────────────────────────────────────────

/**
 * Compute the full summary needed by the main page.
 *
 * Returns:
 * {
 *   hasLeave: boolean,
 *   message?: string,   // shown when hasLeave is false
 *   periods: Array<{
 *     milestoneMonths, nextMilestoneMonths, periodStart, periodEnd,
 *     entitledDays, taken, carryIn, carryOut, settlement,
 *     remaining,  // = carryIn + entitledDays - taken
 *   }>,  // ascending by time; [] when hasLeave is false
 * }
 */
export function calculateSummary(settings, records, today = new Date()) {
  const { onboardDate, ruleType, customRules, allowCarryover, customGrowth } = settings;
  const growth = ruleType === 'custom' ? customGrowth : NO_CUSTOM_GROWTH;
  if (!onboardDate) {
    return { hasLeave: false, message: '請先在設定中填寫到職日。', periods: [] };
  }

  // Settings saved before #21 was fixed can hold a custom rule set with no
  // usable thresholds. The settings page is locked by then, so explain the
  // only way out instead of showing a frozen 0-day period.
  if (ruleType === 'custom' && normalizeCustomThresholds(customRules).length === 0) {
    return {
      hasLeave: false,
      message: '自訂規則沒有任何有效的年資門檻，無法計算特休。請至設定頁使用「離職重來」重新設定。',
      periods: [],
    };
  }

  const onboard = parseLocalDate(onboardDate);
  const ledger = computePeriodLedger(onboard, ruleType, customRules, records, today, allowCarryover, growth);

  if (ledger.length === 0) {
    const firstMilestone = getMilestones(ruleType, customRules, 12)[0];
    const firstDate = addMonthsToDate(onboard, firstMilestone);
    return {
      hasLeave: false,
      message: `尚未達到最低服務年資（${firstMilestone} 個月），目前沒有特休假。到 ${toISODateString(firstDate)} 後將取得首批特休。`,
      periods: [],
    };
  }

  const periods = ledger.map(entry => ({
    milestoneMonths: entry.milestoneMonths,
    nextMilestoneMonths: entry.nextMilestoneMonths,
    periodStart: entry.periodStart,
    periodEnd: entry.periodEnd,
    entitledDays: entry.entitledDays,
    taken: entry.taken,
    carryIn: entry.carryIn,
    carryOut: entry.carryOut,
    settlement: entry.settlement,
    remaining: entry.carryIn + entry.entitledDays - entry.taken,
  }));

  return { hasLeave: true, periods };
}

/**
 * Format a period's date range as a compact year label for tab display.
 * Same calendar year → "2025"; spans two years → "2025–26" (en dash, U+2013).
 */
export function formatPeriodLabel(periodStart, periodEnd) {
  const startYear = periodStart.getFullYear();
  const endYear = periodEnd.getFullYear();
  if (startYear === endYear) return `${startYear}`;
  return `${startYear}–${String(endYear).slice(-2)}`;
}

// ─── Compliance check ─────────────────────────────────────────────────────────

/** getLaborLawDays() first reaches its 30-day cap at 288 months (24 years). */
const LABOR_LAW_CAP_MONTHS = 288;

/**
 * Check whether the custom rules (with growth) ever give fewer days than the
 * labor law minimum, at any point in time.
 *
 * Compares custom vs. labor-law entitlement at every checkpoint in the union
 * of the labor-law milestone points and the custom milestone points (their
 * entitlements only change at these points, so checking the union is
 * equivalent to checking every point in time). Checkpoints below the labor
 * law's own minimum tenure (legalMin === 0) are skipped. Consecutive
 * deficient checkpoints merge into a single range; non-adjacent ranges stay
 * separate.
 *
 * The comparison horizon is bounded by MAX_MILESTONE_MONTHS. `untilMonths:
 * null` on the last range therefore means "still deficient at the horizon",
 * not a mathematical proof that it stays deficient forever.
 *
 * @returns {Array<{
 *   fromMonths, untilMonths: number | null,
 *   customDaysMin, customDaysMax, legalDaysMin, legalDaysMax,
 * }>}
 */
export function checkLaborLawCompliance(customRules, customGrowth = NO_CUSTOM_GROWTH) {
  const thresholds = normalizeCustomThresholds(customRules);
  if (thresholds.length === 0) return [];

  const { perYear, cap } = normalizeCustomGrowth(customGrowth);
  const lastThreshold = thresholds[thresholds.length - 1];
  const lastDays = getDaysForMilestone(lastThreshold, 'custom', customRules);

  let stableAt = lastThreshold;
  if (perYear > 0 && cap > lastDays) {
    stableAt = lastThreshold + 12 * Math.ceil((cap - lastDays) / perYear);
  }
  const horizon = Math.min(MAX_MILESTONE_MONTHS, Math.max(LABOR_LAW_CAP_MONTHS, stableAt) + 12);

  const checkpoints = [...new Set([
    ...getMilestones('labor', [], horizon),
    ...getMilestones('custom', customRules, horizon),
  ])]
    .filter(m => m <= horizon)
    .sort((a, b) => a - b);

  const warnings = [];
  let current = null;

  for (const m of checkpoints) {
    const legal = getLaborLawDays(m);
    if (legal === 0) continue;

    const custom = getDaysForMilestone(m, 'custom', customRules, customGrowth);
    if (custom < legal) {
      if (current === null) {
        current = {
          fromMonths: m, untilMonths: null,
          customDaysMin: custom, customDaysMax: custom,
          legalDaysMin: legal, legalDaysMax: legal,
        };
      } else {
        current.customDaysMin = Math.min(current.customDaysMin, custom);
        current.customDaysMax = Math.max(current.customDaysMax, custom);
        current.legalDaysMin = Math.min(current.legalDaysMin, legal);
        current.legalDaysMax = Math.max(current.legalDaysMax, legal);
      }
    } else if (current !== null) {
      current.untilMonths = m;
      warnings.push(current);
      current = null;
    }
  }
  if (current !== null) warnings.push(current);

  return warnings;
}
