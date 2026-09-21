import { useState, useEffect } from 'react'
import { v4 as uuidv4 } from 'uuid'
import { checkLaborLawCompliance, getLaborLawDays, calculateSummary, toISODateString, MAX_MILESTONE_MONTHS, MAX_ANNUAL_LEAVE_DAYS } from '../utils/leaveCalculations.js'
import { buildBackupCsv, downloadCsv } from '../utils/exportCsv.js'
import { DEFAULT_SETTINGS } from '../utils/storage.js'
import { validateSettingsInput } from '../utils/settingsValidation.js'

// Default custom rules pre-populated with labor law as a starting point
const DEFAULT_CUSTOM_RULES = [
  { id: uuidv4(), months: 6,   days: 3  },
  { id: uuidv4(), months: 12,  days: 7  },
  { id: uuidv4(), months: 24,  days: 10 },
  { id: uuidv4(), months: 36,  days: 14 },
  { id: uuidv4(), months: 60,  days: 15 },
  { id: uuidv4(), months: 120, days: 16 },
]

// Default growth prefilled for a new user setting up custom rules for the
// first time. Existing data (loaded via storage.js) instead backfills to
// {perYear: 0, cap: 0} ("no further growth") so it never silently changes
// an existing user's days -- see isLocked below.
const DEFAULT_CUSTOM_GROWTH = { perYear: 1, cap: 30 }

export default function Settings({ settings, records, onSave, onCancel, onResign }) {
  const isLocked = Boolean(settings.onboardDate)

  const [onboardDate,    setOnboardDate]    = useState(settings.onboardDate    || '')
  const [ruleType,       setRuleType]       = useState(settings.ruleType       || 'labor')
  const [customRules,    setCustomRules]    = useState(
    settings.customRules?.length > 0
      ? settings.customRules.map(r => ({ ...r, id: r.id || uuidv4() }))
      : DEFAULT_CUSTOM_RULES
  )
  const [allowCarryover, setAllowCarryover] = useState(settings.allowCarryover ?? false)
  // isLocked distinguishes "existing data" (backfilled to {0, 0} by
  // storage.js, must not be silently overridden) from "new user filling this
  // in for the first time" (prefilled with a sensible default).
  const [growthPerYear,  setGrowthPerYear]  = useState(
    String(isLocked ? (settings.customGrowth?.perYear ?? 0) : DEFAULT_CUSTOM_GROWTH.perYear)
  )
  const [growthCap,      setGrowthCap]      = useState(
    String(isLocked ? (settings.customGrowth?.cap ?? 0) : DEFAULT_CUSTOM_GROWTH.cap)
  )

  // Compliance warnings derived from current custom rules
  const [warnings, setWarnings] = useState([])

  // 'confirm' -> first "are you sure" dialog, 'settlement' -> shows the payout figure
  const [resignStep, setResignStep] = useState(null)

  useEffect(() => {
    if (ruleType === 'custom') {
      setWarnings(checkLaborLawCompliance(
        customRules.map(r => ({ ...r, months: Number(r.months), days: Number(r.days) })),
        { perYear: Number(growthPerYear), cap: Number(growthCap) }
      ))
    } else {
      setWarnings([])
    }
  }, [ruleType, customRules, growthPerYear, growthCap])

  // ── Custom rules helpers ─────────────────────────────────────────────────

  function addCustomRule() {
    const sorted = [...customRules].sort((a, b) => a.months - b.months)
    const lastMonths = sorted.length > 0 ? Number(sorted[sorted.length - 1].months) || 0 : 0
    setCustomRules(prev => [
      ...prev,
      { id: uuidv4(), months: lastMonths + 12, days: 15 },
    ])
  }

  function updateCustomRule(id, field, value) {
    setCustomRules(prev =>
      prev.map(r => r.id === id ? { ...r, [field]: value } : r)
    )
  }

  function removeCustomRule(id) {
    setCustomRules(prev => prev.filter(r => r.id !== id))
  }

  // ── Save ─────────────────────────────────────────────────────────────────

  function handleSave() {
    const error = validateSettingsInput({ onboardDate, ruleType, customRules, growthPerYear, growthCap })
    if (error) {
      alert(error)
      return
    }

    const normalizedRules = customRules.map(r => ({
      ...r,
      months: Number(r.months),
      days: Number(r.days),
    }))
    const growthPerYearNum = Number(growthPerYear)
    const growthCapNum = Number(growthCap)

    onSave({
      onboardDate,
      ruleType,
      customRules: ruleType === 'custom'
        ? [...normalizedRules].sort((a, b) => a.months - b.months)
        : DEFAULT_SETTINGS.customRules,
      allowCarryover,
      customGrowth: ruleType === 'custom'
        ? { perYear: growthPerYearNum, cap: growthPerYearNum > 0 ? growthCapNum : 0 }
        : DEFAULT_SETTINGS.customGrowth,
    })
  }

  // ── Resignation reset ────────────────────────────────────────────────────

  const resignSummary = calculateSummary(settings, records, new Date())
  const settlementDays = resignSummary.hasLeave
    ? resignSummary.periods[resignSummary.periods.length - 1].remaining
    : 0

  function handleExportCsv() {
    downloadCsv(
      `annual-leave-backup-${toISODateString(new Date())}.csv`,
      buildBackupCsv(settings, records, resignSummary)
    )
  }

  function handleConfirmResign() {
    onResign()
    setResignStep(null)
  }

  const sortedRules = [...customRules].sort((a, b) => a.months - b.months)

  // Mirrors normalizeCustomThresholds' filter (that helper stays private to
  // leaveCalculations.js) so the growth row's threshold always matches the
  // one getMilestones()/getDaysForMilestone() actually use -- not just
  // "whatever the last row happens to contain", which could be a mid-edit
  // value (e.g. months cleared to 0) or one beyond the sanity ceiling.
  const validThresholds = customRules
    .map(r => Number(r.months))
    .filter(m => Number.isInteger(m) && m >= 1 && m <= MAX_MILESTONE_MONTHS)
  const lastValidThreshold = validThresholds.length > 0 ? Math.max(...validThresholds) : null

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-bold text-stone-800">設定</h1>
        <p className="text-sm text-stone-500 mt-0.5">設定到職日與特休規則</p>
      </div>

      {/* ── 到職日 ──────────────────────────────────────────────────────── */}
      <Section title="到職日">
        <div>
          <label className="block text-sm font-medium text-stone-700 mb-1">
            到職日期
          </label>
          <input
            type="date"
            value={onboardDate}
            disabled={isLocked}
            onChange={e => setOnboardDate(e.target.value)}
            className="block w-full sm:w-48 rounded-md border border-stone-300 px-3 py-2 text-sm
                       focus:outline-none focus:ring-2 focus:ring-teal-500 focus:border-teal-500
                       disabled:bg-stone-100 disabled:text-stone-500"
          />
          <p className="text-xs text-stone-400 mt-1">
            特休年資的計算起點
          </p>
        </div>
      </Section>

      {/* ── 特休規則 ─────────────────────────────────────────────────────── */}
      <Section title="特休規則">
        <div className="space-y-4">
          {/* Rule type selector */}
          <div className="flex flex-col sm:flex-row gap-3">
            <RuleTypeCard
              selected={ruleType === 'labor'}
              disabled={isLocked}
              onClick={() => setRuleType('labor')}
              title="按勞基法第38條"
              description="依法定最低標準自動套用，含6個月、1年、2年等各階段。"
            />
            <RuleTypeCard
              selected={ruleType === 'custom'}
              disabled={isLocked}
              onClick={() => setRuleType('custom')}
              title="公司另有規定"
              description="自訂各年資門檻的特休天數。"
            />
          </div>

          {/* Labor law preview */}
          {ruleType === 'labor' && (
            <div className="rounded-lg border border-stone-200 overflow-hidden">
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-stone-50">
                    <th className="text-left px-4 py-2 text-stone-600 font-medium">年資門檻</th>
                    <th className="text-right px-4 py-2 text-stone-600 font-medium">天數</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-stone-100">
                  {[
                    { label: '滿 6 月未滿 12 月',   months: 6   },
                    { label: '滿 12 月未滿 24 月',  months: 12  },
                    { label: '滿 24 月未滿 36 月',  months: 24  },
                    { label: '滿 36 月未滿 60 月',  months: 36  },
                    { label: '滿 60 月未滿 120 月', months: 60  },
                    { label: '滿 120 月以上',        months: 120 },
                  ].map(row => (
                    <tr key={row.months}>
                      <td className="px-4 py-2 text-stone-700">{row.label}</td>
                      <td className="px-4 py-2 text-right text-stone-700">
                        {row.months >= 120
                          ? '每年加 1 天，上限 30 天'
                          : `${getLaborLawDays(row.months)} 天`}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {/* Custom rules editor */}
          {ruleType === 'custom' && (
            <div className="space-y-3">
              {/* Compliance warnings */}
              {warnings.length > 0 && (
                <div className="rounded-md bg-amber-50 border border-amber-200 px-4 py-3 text-sm text-amber-800">
                  <p className="font-semibold mb-1">⚠ 以下年資區間的天數低於勞基法最低標準</p>
                  <ul className="list-disc list-inside space-y-0.5">
                    {warnings.map(w => {
                      const rangeLabel = w.untilMonths != null
                        ? `滿 ${w.fromMonths} 個月至未滿 ${w.untilMonths} 個月`
                        : `滿 ${w.fromMonths} 個月起`
                      const customRange = w.customDaysMin === w.customDaysMax
                        ? `${w.customDaysMin}`
                        : `${w.customDaysMin}～${w.customDaysMax}`
                      const legalRange = w.legalDaysMin === w.legalDaysMax
                        ? `${w.legalDaysMin}`
                        : `${w.legalDaysMin}～${w.legalDaysMax}`
                      return (
                        <li key={w.fromMonths}>
                          {rangeLabel}：您的規則 {customRange} 天，勞基法最低 {legalRange} 天
                        </li>
                      )
                    })}
                  </ul>
                  <p className="mt-1 text-xs text-amber-600">
                    {isLocked ? '如需調整請使用「離職重來」重新設定。' : '仍可儲存，但請確認是否符合規定。'}
                  </p>
                </div>
              )}

              {/* Rules table */}
              <div className="rounded-lg border border-stone-200 overflow-hidden">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="bg-stone-50">
                      <th className="text-left px-3 py-2 text-stone-600 font-medium">滿幾個月後</th>
                      <th className="text-left px-3 py-2 text-stone-600 font-medium">每年可休天數</th>
                      <th className="px-3 py-2"></th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-stone-100">
                    {sortedRules.map(rule => (
                      <tr key={rule.id} data-testid="custom-rule-row">
                        <td className="px-3 py-2">
                          <div className="flex items-center gap-1.5">
                            <input
                              type="number"
                              min={1}
                              max={MAX_MILESTONE_MONTHS}
                              step={1}
                              value={rule.months}
                              disabled={isLocked}
                              onChange={e =>
                                updateCustomRule(rule.id, 'months', e.target.value)
                              }
                              className="w-20 rounded border border-stone-300 px-2 py-1 text-sm
                                         focus:outline-none focus:ring-1 focus:ring-teal-500
                                         disabled:bg-stone-100 disabled:text-stone-500"
                            />
                            <span className="text-stone-500 text-xs">個月</span>
                          </div>
                        </td>
                        <td className="px-3 py-2">
                          <div className="flex items-center gap-1.5">
                            <input
                              type="number"
                              min={0.25}
                              max={MAX_ANNUAL_LEAVE_DAYS}
                              step={0.25}
                              value={rule.days}
                              disabled={isLocked}
                              onChange={e =>
                                updateCustomRule(rule.id, 'days', e.target.value)
                              }
                              className="w-20 rounded border border-stone-300 px-2 py-1 text-sm
                                         focus:outline-none focus:ring-1 focus:ring-teal-500
                                         disabled:bg-stone-100 disabled:text-stone-500"
                            />
                            <span className="text-stone-500 text-xs">天</span>
                          </div>
                        </td>
                        <td className="px-3 py-2 text-right">
                          <button
                            onClick={() => removeCustomRule(rule.id)}
                            disabled={isLocked || customRules.length <= 1}
                            title={customRules.length <= 1 ? '至少需保留一條規則' : undefined}
                            className="text-stone-400 hover:text-red-500 transition-colors
                                       disabled:opacity-40 disabled:hover:text-stone-400"
                            aria-label="刪除此規則"
                          >
                            <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                            </svg>
                          </button>
                        </td>
                      </tr>
                    ))}
                    {/* Growth row: fixed at the bottom, no delete affordance. */}
                    <tr data-testid="custom-growth-row">
                      <td className="px-3 py-2 text-stone-600 whitespace-nowrap">
                        {lastValidThreshold !== null ? `滿 ${lastValidThreshold + 12} 個月起` : '—'}
                      </td>
                      <td className="px-3 py-2" colSpan={2}>
                        <div className="flex items-center gap-1.5 flex-wrap text-xs text-stone-500">
                          <span>每年加</span>
                          <input
                            type="number"
                            min={0}
                            max={MAX_ANNUAL_LEAVE_DAYS}
                            step={0.25}
                            value={growthPerYear}
                            disabled={isLocked}
                            aria-label="每年增加天數"
                            onChange={e => setGrowthPerYear(e.target.value)}
                            className="w-16 rounded border border-stone-300 px-2 py-1 text-sm
                                       focus:outline-none focus:ring-1 focus:ring-teal-500
                                       disabled:bg-stone-100 disabled:text-stone-500"
                          />
                          <span>天，上限</span>
                          <input
                            type="number"
                            min={0}
                            max={MAX_ANNUAL_LEAVE_DAYS}
                            step={0.25}
                            value={growthCap}
                            disabled={isLocked || (growthPerYear !== '' && Number(growthPerYear) === 0)}
                            aria-label="天數上限"
                            onChange={e => setGrowthCap(e.target.value)}
                            className="w-16 rounded border border-stone-300 px-2 py-1 text-sm
                                       focus:outline-none focus:ring-1 focus:ring-teal-500
                                       disabled:bg-stone-100 disabled:text-stone-500"
                          />
                          <span>天</span>
                        </div>
                      </td>
                    </tr>
                  </tbody>
                </table>
              </div>

              <button
                onClick={addCustomRule}
                disabled={isLocked}
                className="flex items-center gap-1.5 text-sm text-teal-700 hover:text-teal-900
                           font-medium transition-colors
                           disabled:opacity-40 disabled:hover:text-teal-700"
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth={2.5} viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
                </svg>
                新增規則
              </button>
            </div>
          )}
        </div>
      </Section>

      {/* ── 遞延 ────────────────────────────────────────────────────────── */}
      <Section title="假期遞延">
        <div className="flex items-start gap-3">
          <label className="relative mt-0.5 inline-flex flex-shrink-0 cursor-pointer items-center">
            <input
              type="checkbox"
              role="switch"
              checked={allowCarryover}
              disabled={isLocked}
              onChange={() => setAllowCarryover(v => !v)}
              className="peer sr-only"
            />
            {/* 軌道 */}
            <span
              className="h-6 w-10 rounded-full bg-stone-300 transition-colors
                        peer-checked:bg-teal-600
                        peer-focus-visible:ring-2 peer-focus-visible:ring-teal-500
                        peer-focus-visible:ring-offset-1
                        peer-disabled:opacity-50"
            />
            {/* 圓點 */}
            <span
              className="absolute left-1 top-1 h-4 w-4 rounded-full bg-white shadow
                        transition-transform peer-checked:translate-x-4"
            />
          </label>
          <div>
            <p className="text-sm font-medium text-stone-700">允許遞延</p>
            <p className="text-xs text-stone-500 mt-0.5">
              若雇主允許，可將上一個週年度未休完的假期帶入本年度使用。
            </p>
          </div>
        </div>
      </Section>

      {/* ── Action buttons ───────────────────────────────────────────────── */}
      <div className="flex gap-3 pt-2">
        {!isLocked && (
          <>
            <button
              onClick={handleSave}
              className="px-5 py-2 bg-teal-700 text-white text-sm font-medium rounded-md
                         hover:bg-teal-800 focus:outline-none focus:ring-2 focus:ring-teal-500
                         focus:ring-offset-1 transition-colors"
            >
              儲存設定
            </button>
            <button
              onClick={onCancel}
              className="px-5 py-2 text-stone-600 text-sm font-medium rounded-md
                         hover:bg-stone-100 focus:outline-none focus:ring-2 focus:ring-stone-400
                         focus:ring-offset-1 transition-colors"
            >
              取消
            </button>
          </>
        )}
        <button
          onClick={() => setResignStep('confirm')}
          disabled={!isLocked}
          className="px-5 py-2 text-red-600 text-sm font-medium rounded-md border border-red-200
                     hover:bg-red-50 focus:outline-none focus:ring-2 focus:ring-red-400
                     focus:ring-offset-1 transition-colors
                     disabled:opacity-40 disabled:hover:bg-transparent"
        >
          離職重來
        </button>
      </div>

      {/* ── 離職重來 modals ──────────────────────────────────────────────── */}
      {resignStep === 'confirm' && (
        <Modal>
          <p className="text-sm text-stone-700">
            離職將清除現有到職日設定與休假記錄，是否確定執行？
          </p>
          <div className="flex justify-end gap-3">
            <button
              onClick={() => setResignStep(null)}
              className="px-4 py-2 text-stone-600 text-sm font-medium rounded-md hover:bg-stone-100 transition-colors"
            >
              取消
            </button>
            <button
              onClick={() => setResignStep('settlement')}
              className="px-4 py-2 bg-red-600 text-white text-sm font-medium rounded-md hover:bg-red-700 transition-colors"
            >
              確定
            </button>
          </div>
        </Modal>
      )}

      {resignStep === 'settlement' && (
        <Modal>
          <p className="text-sm text-stone-700">
            應結清工資天數：<span className="font-semibold">{settlementDays}</span> 天
          </p>
          <div className="flex flex-wrap justify-end gap-3">
            <button
              onClick={handleExportCsv}
              className="px-4 py-2 text-teal-700 text-sm font-medium rounded-md border border-teal-200
                         hover:bg-teal-50 transition-colors"
            >
              匯出 CSV 備份
            </button>
            <button
              onClick={() => setResignStep(null)}
              className="px-4 py-2 text-stone-600 text-sm font-medium rounded-md hover:bg-stone-100 transition-colors"
            >
              取消
            </button>
            <button
              onClick={handleConfirmResign}
              className="px-4 py-2 bg-red-600 text-white text-sm font-medium rounded-md hover:bg-red-700 transition-colors"
            >
              確定清空
            </button>
          </div>
        </Modal>
      )}
    </div>
  )
}

function Section({ title, children }) {
  return (
    <div className="bg-white rounded-xl border border-stone-200 overflow-hidden">
      <div className="px-5 py-3 border-b border-stone-100 bg-stone-50">
        <h2 className="text-sm font-semibold text-stone-700">{title}</h2>
      </div>
      <div className="px-5 py-4">{children}</div>
    </div>
  )
}

function RuleTypeCard({ selected, disabled, onClick, title, description }) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className={`flex-1 text-left rounded-lg border-2 px-4 py-3 transition-all
                  ${selected
                    ? 'border-teal-600 bg-teal-50'
                    : 'border-stone-200 bg-white hover:border-stone-300'
                  }
                  ${disabled ? 'opacity-60 hover:border-stone-200' : ''}`}
    >
      <div className="flex items-center gap-2 mb-1">
        <span className={`w-4 h-4 rounded-full border-2 flex-shrink-0 flex items-center justify-center
                          ${selected ? 'border-teal-600' : 'border-stone-300'}`}>
          {selected && <span className="w-2 h-2 rounded-full bg-teal-600" />}
        </span>
        <span className={`text-sm font-medium ${selected ? 'text-teal-800' : 'text-stone-700'}`}>
          {title}
        </span>
      </div>
      <p className="text-xs text-stone-500 pl-6">{description}</p>
    </button>
  )
}

function Modal({ children }) {
  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 px-4">
      <div className="bg-white rounded-xl shadow-lg max-w-sm w-full p-6 space-y-4">
        {children}
      </div>
    </div>
  )
}
