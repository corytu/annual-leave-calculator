import { useState, useMemo, useEffect } from 'react'
import { calculateSummary, formatPeriodLabel, toISODateString, parseLocalDate, makeIsNonWorkingDay, getDefaultVisibleMonth } from '../utils/leaveCalculations.js'
import LeaveCalendar from './LeaveCalendar.jsx'
import LeaveForm from './LeaveForm.jsx'
import { useToday } from '../hooks/useToday.js'

// calendar-holiday-note text per holiday-cache status (§2.5 of the design doc).
const HOLIDAY_NOTE_TEXT = {
  available: '國定假日資料已載入，圓點已跳過所有國定休假',
  loading: '國定假日資料載入中，圓點暫時只跳過週六日',
  pending: '國定假日資料尚未公布，圓點暫時只跳過週六日',
  unavailable: '無國定假日資料來源，圓點只跳過週六日',
  error: '國定假日資料載入失敗，圓點只跳過週六日',
}

export default function MainPage({
  settings,
  records,
  holidayCache,
  ensureYear,
  onAddRecord,
  onUpdateRecord,
  onDeleteRecord,
  onGoToSettings,
}) {
  const today = useToday()
  const summary = useMemo(
    () => calculateSummary(settings, records, today),
    [settings, records, today]
  )
  const periods = summary.periods ?? []

  // Years the visible periods' calendars could ever need holiday data for.
  // Empty when `periods` is empty (e.g. onboarded but not yet past the first
  // milestone) -- coverage effects below then fetch nothing, and
  // holidayCache stays {}.
  const neededYears = useMemo(() => computeNeededYears(periods), [periods])
  const neededYearsKey = [...neededYears].sort().join(',')

  // Shared by both the calendar dot expansion and LeaveCalendar's tile
  // styling, so the two never disagree about which dates are non-working.
  const isNonWorkingDay = useMemo(() => makeIsNonWorkingDay(holidayCache), [holidayCache])

  // Which period's tab is selected, keyed by milestoneMonths (stable across
  // record edits, unlike an array index or a Date object reference).
  const [selectedMilestone, setSelectedMilestone] = useState(null)
  // Date selected by clicking the calendar (pre-fills the form)
  const [selectedDate, setSelectedDate] = useState(null)
  // Record being edited (null = add mode)
  const [editingRecord, setEditingRecord] = useState(null)
  // Month currently shown by LeaveCalendar, reported up via
  // onVisibleMonthChange -- drives which year's holiday-note status to show.
  const [visibleMonth, setVisibleMonth] = useState(null)

  // Default to the newest period on first load, without ever snapping back
  // to it afterwards once the user has picked a period themselves.
  useEffect(() => {
    if (selectedMilestone == null && periods.length > 0) {
      setSelectedMilestone(periods[periods.length - 1].milestoneMonths)
    }
  }, [periods, selectedMilestone])

  // After a resignation reset, onboardDate is cleared -- reset selection so a
  // future re-onboarding correctly re-defaults to the newest period again.
  useEffect(() => {
    if (!settings.onboardDate) {
      setSelectedMilestone(null)
      setVisibleMonth(null)
    }
  }, [settings.onboardDate])

  // Fetch holiday data for every year the visible periods could show.
  useEffect(() => {
    neededYears.forEach((year) => ensureYear(year))
    // eslint-disable-next-line react-hooks/exhaustive-deps -- neededYearsKey is neededYears' stable identity
  }, [neededYearsKey])

  // Daily heartbeat: also re-triggers `pending`/`error` years once the frozen
  // `today` from useToday() ticks over (e.g. past midnight, or a fresh day).
  useEffect(() => {
    neededYears.forEach((year) => ensureYear(year))
    // eslint-disable-next-line react-hooks/exhaustive-deps -- only `today` should re-trigger this
  }, [today])

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

  const activePeriod =
    periods.find(p => p.milestoneMonths === selectedMilestone) ??
    periods[periods.length - 1]

  // Which year's holiday-cache status the note below reflects: the month
  // LeaveCalendar last reported (via onVisibleMonthChange), or -- for the one
  // render before its mount effect fires -- the same default it will report.
  const visibleYear = (
    visibleMonth ?? getDefaultVisibleMonth(activePeriod.periodStart, activePeriod.periodEnd, today)
  ).getFullYear()

  const isNewest = activePeriod.milestoneMonths === periods[periods.length - 1].milestoneMonths
  const isEarliest = activePeriod.milestoneMonths === periods[0].milestoneMonths
  const showCarryIn = settings.allowCarryover && !isEarliest
  const showSettlementOut = !isNewest

  const activePeriodRecords = records.filter(r => {
    const d = parseLocalDate(r.startDate)
    return d >= activePeriod.periodStart && d <= activePeriod.periodEnd
  })

  const holidayNoteStatus = holidayCache[visibleYear]?.status ?? 'loading'

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

  function handleSelectPeriod(milestoneMonths) {
    // Re-selecting the current tab must be a no-op. Clearing editingRecord
    // here without remounting LeaveForm would leave the old values in an
    // "add" form, and submitting it would duplicate the record.
    if (milestoneMonths === activePeriod.milestoneMonths) return
    setSelectedMilestone(milestoneMonths)
    setEditingRecord(null)
    setSelectedDate(null)
    setVisibleMonth(null)
  }

  return (
    <div className="space-y-5">
      <OnboardBanner settings={settings} />

      {/* ── Summary cards (follow the selected period tab) ────────────────── */}
      <div className="grid grid-cols-3 gap-3">
        <SummaryCard
          testId="summary-entitled"
          label="當期天數"
          value={activePeriod.entitledDays}
          unit="天"
        />
        <SummaryCard
          testId="summary-taken"
          label="已休天數"
          value={activePeriod.taken}
          unit="天"
        />
        <SummaryCard
          testId="summary-remaining"
          label="剩餘可休"
          value={activePeriod.remaining}
          unit="天"
          highlight
        />
      </div>

      {(showCarryIn || showSettlementOut) && (
        <div className="bg-amber-50 border border-amber-200 rounded-xl px-5 py-4">
          <div className="grid grid-cols-3 gap-3">
            {showCarryIn && (
              <MiniStat testId="summary-carryin" label="遞延進入本期" value={`${activePeriod.carryIn} 天`} accent />
            )}
            {showSettlementOut && (
              <>
                <MiniStat testId="summary-settlement" label="期末未休結清" value={`${activePeriod.settlement} 天`} />
                <MiniStat testId="summary-carryout" label="遞延至下一期" value={`${activePeriod.carryOut} 天`} accent />
              </>
            )}
          </div>
        </div>
      )}

      {/* ── Period info bar ─────────────────────────────────────────────── */}
      <div data-testid="period-range" className="text-xs text-stone-400 text-center">
        本年度週年制區間：
        <span className="text-stone-600 font-medium">
          {toISODateString(activePeriod.periodStart)}
        </span>
        {' '}～{' '}
        <span className="text-stone-600 font-medium">
          {toISODateString(activePeriod.periodEnd)}
        </span>
      </div>

      {/* ── Period tabs ──────────────────────────────────────────────────── */}
      <div data-testid="period-tabs" className="flex border-b border-stone-200 gap-0 overflow-x-auto whitespace-nowrap">
        {[...periods].reverse().map(p => (
          <TabButton
            key={p.milestoneMonths}
            active={p.milestoneMonths === activePeriod.milestoneMonths}
            onClick={() => handleSelectPeriod(p.milestoneMonths)}
          >
            {formatPeriodLabel(p.periodStart, p.periodEnd)}
          </TabButton>
        ))}
      </div>

      {/* ── Calendar ────────────────────────────────────────────────────── */}
      <div className="bg-white rounded-xl border border-stone-200 overflow-hidden">
        <div className="px-5 py-3 border-b border-stone-100 bg-stone-50">
          <h2 className="text-sm font-semibold text-stone-700">月曆</h2>
          <p className="text-xs text-stone-400 mt-0.5">點擊日期快速新增請假記錄</p>
          <p data-testid="calendar-holiday-note"
             className={holidayNoteStatus === 'error' ? 'text-xs text-red-600' : 'text-xs text-stone-400'}>
            {HOLIDAY_NOTE_TEXT[holidayNoteStatus]}
            {holidayNoteStatus === 'error' && (
              <>
                （<button type="button" className="underline" onClick={() => ensureYear(visibleYear)}>點此重試</button>）
              </>
            )}
          </p>
        </div>
        <div className="p-4">
          <LeaveCalendar
            // react-calendar only reads defaultActiveStartDate at mount, so a
            // period switch needs a fresh instance to reset which month it shows.
            // The remount's own mount effect then reports its new
            // initialMonth via onVisibleMonthChange; the setVisibleMonth(null)
            // calls above are only a stopgap for the one render in between.
            key={activePeriod.milestoneMonths}
            periodStart={activePeriod.periodStart}
            periodEnd={activePeriod.periodEnd}
            today={today}
            records={activePeriodRecords}
            selectedDate={selectedDate}
            isNonWorkingDay={isNonWorkingDay}
            onDateClick={handleCalendarDateClick}
            onVisibleMonthChange={setVisibleMonth}
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
            key={activePeriod.milestoneMonths}
            settings={settings}
            today={today}
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

/** Every calendar year that any of `periods`' start/end dates falls in. */
function computeNeededYears(periods) {
  const years = new Set()
  periods.forEach((p) => {
    years.add(p.periodStart.getFullYear())
    years.add(p.periodEnd.getFullYear())
  })
  return years
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
      className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors flex-shrink-0
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
