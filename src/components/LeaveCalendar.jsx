import Calendar from 'react-calendar'
import { parseLocalDate, toISODateString, getLeaveRecordDates } from '../utils/leaveCalculations.js'

/**
 * Thin wrapper around react-calendar that:
 * - Restricts navigation to the active period's months
 * - Highlights days that have leave records
 * - Marks dates outside the period range as un-clickable
 */
export default function LeaveCalendar({
  periodStart,
  periodEnd,
  records,
  selectedDate,
  onDateClick,
}) {
  // Build a Set of ISO date strings that have leave records for fast lookup
  const leaveDates = new Set(records.flatMap(r => getLeaveRecordDates(r.startDate, r.days)))

  // The selected date as a Date object (or null)
  const selectedDateObj = selectedDate ? parseLocalDate(selectedDate) : null

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
    if (date < periodStart || date > periodEnd) {
      return 'react-calendar__tile--out-of-period'
    }
    return null
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
      // Start from the month that contains today (or period start)
      defaultActiveStartDate={
        new Date() >= periodStart && new Date() <= periodEnd
          ? new Date(new Date().getFullYear(), new Date().getMonth(), 1)
          : new Date(periodStart.getFullYear(), periodStart.getMonth(), 1)
      }
      locale="zh-TW"
      calendarType="gregory"
      showNeighboringMonth={false}
    />
  )
}
