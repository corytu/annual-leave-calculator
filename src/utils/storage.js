/**
 * storage.js
 *
 * Typed localStorage helpers for the leave calculator.
 * All data lives under prefixed keys to avoid collisions.
 */

const KEYS = {
  settings: 'leaveCalculator_settings',
  records:  'leaveCalculator_records',
};

// ─── Default values ───────────────────────────────────────────────────────────

export const DEFAULT_SETTINGS = {
  /** ISO date string, e.g. '2023-07-01' */
  onboardDate: '',
  /** 'labor' | 'custom' */
  ruleType: 'labor',
  /**
   * Custom rules – only used when ruleType === 'custom'.
   * Each entry: { id, months, days }
   * months: tenure threshold in months (integer)
   * days:   entitled leave days (can be decimal)
   */
  customRules: [],
  /** Whether unused leave from the previous period carries over */
  allowCarryover: false,
  /**
   * Growth applied per year past the last custom threshold – only used when
   * ruleType === 'custom'. { perYear: 0, cap: 0 } means "no further growth".
   */
  customGrowth: { perYear: 0, cap: 0 },
};

// ─── Settings ─────────────────────────────────────────────────────────────────

export function loadSettings() {
  try {
    const raw = localStorage.getItem(KEYS.settings);
    if (!raw) return { ...DEFAULT_SETTINGS };
    const parsed = JSON.parse(raw);
    return {
      ...DEFAULT_SETTINGS,
      ...parsed,
      // A shallow spread would let a partial (or absent) stored customGrowth
      // wholesale-overwrite the default, dropping whichever key it omits.
      customGrowth: { ...DEFAULT_SETTINGS.customGrowth, ...(parsed.customGrowth ?? {}) },
    };
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

export function saveSettings(settings) {
  localStorage.setItem(KEYS.settings, JSON.stringify(settings));
}

// ─── Leave records ────────────────────────────────────────────────────────────

/**
 * A leave record:
 * {
 *   id:        string  (uuid)
 *   startDate: string  (YYYY-MM-DD)
 *   days:      number  (multiple of 0.25)
 * }
 */
export function loadRecords() {
  try {
    const raw = localStorage.getItem(KEYS.records);
    if (!raw) return [];
    return JSON.parse(raw);
  } catch {
    return [];
  }
}

export function saveRecords(records) {
  localStorage.setItem(KEYS.records, JSON.stringify(records));
}

// ─── Reset ────────────────────────────────────────────────────────────────────

/** Removes both settings and records from localStorage entirely (resignation reset). */
export function clearAll() {
  localStorage.removeItem(KEYS.settings);
  localStorage.removeItem(KEYS.records);
}
