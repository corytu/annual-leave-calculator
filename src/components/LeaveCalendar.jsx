import { useState, useEffect } from 'react'
import Calendar from 'react-calendar'
import { parseLocalDate, toISODateString, getLeaveRecordDates, getDefaultVisibleMonth } from '../utils/leaveCalculations.js'

/**
 * Thin wrapper around react-calendar that:
 * - Restricts navigation to the active period's months
 * - Highlights days that have leave records
 * - Marks dates outside the period range as un-clickable
 * - Marks non-working days (weekends, and national holidays/补班日 once
 *   holiday data is available) via `isNonWorkingDay`
 */
export default function LeaveCalendar({
  periodStart,
  periodEnd,
  today,
  records,
  selectedDate,
  isNonWorkingDay,
  onDateClick,
  onVisibleMonthChange,
}) {
  // Build a Set of ISO date strings that have leave records for fast lookup
  const leaveDates = new Set(
    records.flatMap(r => getLeaveRecordDates(r.startDate, r.days, isNonWorkingDay))
  )

  // The selected date as a Date object (or null)
  const selectedDateObj = selectedDate ? parseLocalDate(selectedDate) : null

  // react-calendar only reads defaultActiveStartDate at mount, so this is
  // frozen for this instance's lifetime -- the parent remounts us (via a
  // `key` change) to reset which month is shown. Report it up once, at mount,
  // so the parent's holiday-note status can key off the actually-displayed
  // month from the very first render, not just after the user navigates.
  const [initialMonth] = useState(() => getDefaultVisibleMonth(periodStart, periodEnd, today))
  useEffect(() => {
    onVisibleMonthChange?.(initialMonth)
    // eslint-disable-next-line react-hooks/exhaustive-deps -- report once, at mount, using the frozen initialMonth
  }, [])

  function handleChange(date) {
    // Only fire if date is within the period
    if (date >= periodStart && date <= periodEnd) {
      onDateClick(date)
    }
  }

  function tileContent({ date, view }) {
    if (view !== 'month') return null
    const iso = toISODateString(date)
    if (leaveDates.has(iso)) {
      return (
        <>
          <span className="leave-dot" aria-hidden="true" />
          <span className="sr-only">已登記請假</span>
        </>
      )
    }
    return null
  }

  function tileDisabled({ date, view }) {
    if (view !== 'month') return false
    // Disable dates outside the active period
    return date < periodStart || date > periodEnd
  }

  function tileClassName({ date, view }) {
    if (view !== 'month') return null
    const classes = []
    if (date < periodStart || date > periodEnd) classes.push('react-calendar__tile--out-of-period')
    // Deliberately calls isNonWorkingDay(date) directly rather than reading
    // react-calendar's native --weekend class, so a compensatory workday
    // (補班, a Saturday/Sunday that isNonWorkingDay reports as working)
    // correctly does NOT get the holiday styling below.
    if (isNonWorkingDay(date)) classes.push('react-calendar__tile--holiday')
    return classes.length > 0 ? classes.join(' ') : null
  }

  return (
    <Calendar
      onChange={handleChange}
      value={selectedDateObj}
      tileContent={tileContent}
      tileDisabled={tileDisabled}
      tileClassName={tileClassName}
      // Restrict navigation to the period's date range
      minDate={periodStart}
      maxDate={periodEnd}
      // Never let the user drill into a year/decade view -- day-tile
      // selection is the only supported interaction here.
      minDetail="month"
      defaultActiveStartDate={initialMonth}
      onActiveStartDateChange={({ activeStartDate }) => onVisibleMonthChange?.(activeStartDate)}
      locale="zh-TW"
      calendarType="gregory"
      showNeighboringMonth={false}
    />
  )
}
