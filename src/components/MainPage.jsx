import { useState, useMemo } from 'react'
import { calculateSummary, toISODateString, parseLocalDate } from '../utils/leaveCalculations.js'
import LeaveCalendar from './LeaveCalendar.jsx'
import LeaveForm from './LeaveForm.jsx'

export default function MainPage({
  settings,
  records,
  onAddRecord,
  onUpdateRecord,
  onDeleteRecord,
  onGoToSettings,
}) {
  const today = useMemo(() => new Date(), [])
  const summary = useMemo(
    () => calculateSummary(settings, records, today),
    [settings, records, today]
  )

  // Which period tab is active when carryover is enabled
  const [periodTab, setPeriodTab] = useState('current')
  // Date selected by clicking the calendar (pre-fills the form)
  const [selectedDate, setSelectedDate] = useState(null)
  // Record being edited (null = add mode)
  const [editingRecord, setEditingRecord] = useState(null)

  // ── No leave yet / not set up ──────────────────────────────────────────────

  if (!settings.onboardDate) {
    return (
      <EmptyState
        title="尚未設定到職日"
        description="請先在設定頁填寫您的到職日與特休規則。"
        action={{ label: '前往設定', onClick: onGoToSettings }}
      />
    )
  }

  if (!summary.hasLeave) {
    return (
      <div className="space-y-4">
        <OnboardBanner settings={settings} />
        <div className="bg-white rounded-xl border border-stone-200 px-6 py-8 text-center">
          <p className="text-stone-500 text-sm">{summary.message}</p>
        </div>
      </div>
    )
  }

  const { current, previous } = summary
  const showTabs = settings.allowCarryover && previous

  // Determine which period's records to show/manage
  const activePeriod = (showTabs && periodTab === 'previous') ? previous : current
  const activePeriodRecords = records.filter(r => {
    const d = parseLocalDate(r.startDate)
    return d >= activePeriod.periodStart && d <= activePeriod.periodEnd
  })

  function handleCalendarDateClick(date) {
    setSelectedDate(toISODateString(date))
    setEditingRecord(null) // switch to add mode with this date
  }

  function handleEditRecord(record) {
    setEditingRecord(record)
    setSelectedDate(record.startDate)
  }

  function handleCancelEdit() {
    setEditingRecord(null)
    setSelectedDate(null)
  }

  return (
    <div className="space-y-5">
      <OnboardBanner settings={settings} />

      {/* ── Summary cards ──────────────────────────────────────────────── */}
      <div className="grid grid-cols-3 gap-3">
        <SummaryCard
          testId="summary-entitled"
          label="本年度天數"
          value={current.entitledDays}
          unit="天"
          sub={settings.allowCarryover && previous
            ? `+ ${current.carryIn} 天遞延`
            : undefined}
        />
        <SummaryCard
          testId="summary-taken"
          label="已休天數"
          value={current.taken}
          unit="天"
        />
        <SummaryCard
          testId="summary-remaining"
          label="剩餘可休"
          value={current.remaining}
          unit="天"
          highlight
        />
      </div>

      {/* ── Previous period summary (carryover) ────────────────────────── */}
      {settings.allowCarryover && previous && (
        <div className="bg-amber-50 border border-amber-200 rounded-xl px-5 py-4">
          <p className="text-xs font-semibold text-amber-700 mb-2 uppercase tracking-wide">
            上一週年度（遞延來源）
          </p>
          <div className="grid grid-cols-3 gap-3">
            <MiniStat testId="previous-entitled" label="共" value={`${previous.entitledDays} 天`} />
            <MiniStat testId="previous-taken" label="已休" value={`${previous.taken} 天`} />
            <MiniStat
              testId="previous-carryover"
              label="遞延"
              value={`${previous.carryOut} 天`}
              accent
            />
          </div>
        </div>
      )}

      {/* ── Settlement (unused days forfeited at the end of the previous period) ─ */}
      {previous && (
        <div className="bg-stone-50 border border-stone-200 rounded-xl px-5 py-3 text-center">
          <p className="text-xs text-stone-500">已結清前年度未休工資天數（請與薪資條核對）</p>
          <p className="text-base font-semibold text-stone-700 mt-1" data-testid="previous-settlement">
            {previous.settlement} 天
          </p>
        </div>
      )}

      {/* ── Period info bar ─────────────────────────────────────────────── */}
      <div className="text-xs text-stone-400 text-center">
        本年度週年制區間：
        <span className="text-stone-600 font-medium">
          {toISODateString(current.periodStart)}
        </span>
        {' '}～{' '}
        <span className="text-stone-600 font-medium">
          {toISODateString(current.periodEnd)}
        </span>
      </div>

      {/* ── Period tabs (when carryover enabled) ────────────────────────── */}
      {showTabs && (
        <div className="flex border-b border-stone-200 gap-0">
          <TabButton
            active={periodTab === 'current'}
            onClick={() => { setPeriodTab('current'); setEditingRecord(null); setSelectedDate(null) }}
          >
            本年度
          </TabButton>
          <TabButton
            active={periodTab === 'previous'}
            onClick={() => { setPeriodTab('previous'); setEditingRecord(null); setSelectedDate(null) }}
          >
            上一年度
          </TabButton>
        </div>
      )}

      {/* ── Calendar ────────────────────────────────────────────────────── */}
      <div className="bg-white rounded-xl border border-stone-200 overflow-hidden">
        <div className="px-5 py-3 border-b border-stone-100 bg-stone-50">
          <h2 className="text-sm font-semibold text-stone-700">月曆</h2>
          <p className="text-xs text-stone-400 mt-0.5">點擊日期快速新增請假記錄</p>
        </div>
        <div className="p-4">
          <LeaveCalendar
            periodStart={activePeriod.periodStart}
            periodEnd={activePeriod.periodEnd}
            records={activePeriodRecords}
            selectedDate={selectedDate}
            onDateClick={handleCalendarDateClick}
          />
        </div>
      </div>

      {/* ── Form + list ──────────────────────────────────────────────────── */}
      <div className="bg-white rounded-xl border border-stone-200 overflow-hidden">
        <div className="px-5 py-3 border-b border-stone-100 bg-stone-50">
          <h2 className="text-sm font-semibold text-stone-700">請假記錄</h2>
        </div>
        <div className="p-4">
          <LeaveForm
            settings={settings}
            periodStart={activePeriod.periodStart}
            periodEnd={activePeriod.periodEnd}
            records={activePeriodRecords}
            allRecords={records}
            selectedDate={selectedDate}
            editingRecord={editingRecord}
            onAdd={onAddRecord}
            onUpdate={onUpdateRecord}
            onDelete={onDeleteRecord}
            onEdit={handleEditRecord}
            onCancel={handleCancelEdit}
          />
        </div>
      </div>
    </div>
  )
}

// ── Sub-components ───────────────────────────────────────────────────────────

function OnboardBanner({ settings }) {
  const date = settings.onboardDate
    ? parseLocalDate(settings.onboardDate).toLocaleDateString('zh-TW', {
        year: 'numeric', month: 'long', day: 'numeric',
      })
    : ''
  return (
    <div className="text-sm text-stone-500">
      到職日：<span className="text-stone-700 font-medium">{date}</span>
    </div>
  )
}

function SummaryCard({ testId, label, value, unit, sub, highlight }) {
  return (
    <div
      data-testid={testId}
      className={`rounded-xl border p-4 text-center
      ${highlight
        ? 'bg-teal-700 border-teal-700 text-white'
        : 'bg-white border-stone-200'
      }`}
    >
      <p className={`text-xs font-medium mb-1 ${highlight ? 'text-teal-200' : 'text-stone-500'}`}>
        {label}
      </p>
      <p className={`text-3xl font-bold tabular-nums leading-none
                     ${highlight ? 'text-white' : 'text-stone-800'}`}>
        {typeof value === 'number' ? formatDays(value) : value}
      </p>
      <p className={`text-xs mt-1 ${highlight ? 'text-teal-200' : 'text-stone-400'}`}>
        {sub ?? unit}
      </p>
    </div>
  )
}

function MiniStat({ testId, label, value, accent }) {
  return (
    <div data-testid={testId} className="text-center">
      <p className="text-xs text-amber-600 mb-0.5">{label}</p>
      <p className={`text-base font-semibold ${accent ? 'text-amber-800' : 'text-amber-700'}`}>
        {value}
      </p>
    </div>
  )
}

function TabButton({ active, onClick, children }) {
  return (
    <button
      onClick={onClick}
      className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors
                  ${active
                    ? 'border-teal-600 text-teal-700'
                    : 'border-transparent text-stone-500 hover:text-stone-700'
                  }`}
    >
      {children}
    </button>
  )
}

function EmptyState({ title, description, action }) {
  return (
    <div className="flex flex-col items-center justify-center py-20 text-center">
      <svg className="w-12 h-12 text-stone-300 mb-4" fill="none" stroke="currentColor" strokeWidth={1.5} viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round"
          d="M6.75 3v2.25M17.25 3v2.25M3 18.75V7.5a2.25 2.25 0 012.25-2.25h13.5A2.25 2.25 0 0121 7.5v11.25m-18 0A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75m-18 0v-7.5A2.25 2.25 0 015.25 9h13.5A2.25 2.25 0 0121 11.25v7.5" />
      </svg>
      <h2 className="text-stone-600 font-medium mb-1">{title}</h2>
      <p className="text-stone-400 text-sm mb-4">{description}</p>
      {action && (
        <button
          onClick={action.onClick}
          className="px-4 py-2 bg-teal-700 text-white text-sm font-medium rounded-md
                     hover:bg-teal-800 transition-colors"
        >
          {action.label}
        </button>
      )}
    </div>
  )
}

/** Format a number: show as integer if whole, show 1–2 decimal places if fractional */
function formatDays(n) {
  if (Number.isInteger(n)) return String(n)
  return n.toFixed(2).replace(/\.?0+$/, '')
}
