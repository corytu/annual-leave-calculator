import { useState, useEffect } from 'react'
import { toISODateString, parseLocalDate, validateRecordsChain } from '../utils/leaveCalculations.js'

const DAY_STEPS = [0.25, 0.5, 0.75, 1, 1.5, 2, 2.5, 3, 3.5, 4, 4.5, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15]

export default function LeaveForm({
  settings,
  today,
  periodStart,
  periodEnd,
  records,
  allRecords,
  selectedDate,
  editingRecord,
  onAdd,
  onUpdate,
  onDelete,
  onEdit,
  onCancel,
}) {
  const [startDate, setStartDate] = useState('')
  const [days,      setDays]      = useState(1)
  const [error,     setError]     = useState('')

  // Sync form when a calendar date is clicked or an edit is initiated
  useEffect(() => {
    if (editingRecord) {
      setStartDate(editingRecord.startDate)
      setDays(editingRecord.days)
      setError('')
    } else if (selectedDate) {
      setStartDate(selectedDate)
      setDays(1)
      setError('')
    }
  }, [editingRecord, selectedDate])

  const isEditing = Boolean(editingRecord)

  function validate() {
    const parsedDays = parseFloat(days)
    if (!startDate) { setError('請選擇請假開始日期'); return false }
    const d = parseLocalDate(startDate)
    if (d < periodStart || d > periodEnd) {
      setError('日期必須在本週年度範圍內')
      return false
    }
    if (!parsedDays || parsedDays <= 0) { setError('天數必須大於 0'); return false }
    if (parsedDays % 0.25 !== 0) { setError('天數最小單位為 0.25（2 小時）'); return false }

    const candidateRecords = isEditing
      ? allRecords.map(r => r.id === editingRecord.id ? { ...r, startDate, days: parsedDays } : r)
      : [...allRecords, { startDate, days: parsedDays }]

    const chainResult = validateRecordsChain(settings, candidateRecords, today)
    if (!chainResult.valid) {
      setError('這筆請假超支可用額度上限，請確認天數是否正確')
      return false
    }

    return true
  }

  function handleSubmit() {
    if (!validate()) return
    const parsedDays = parseFloat(days)
    if (isEditing) {
      onUpdate(editingRecord.id, { startDate, days: parsedDays })
    } else {
      onAdd({ startDate, days: parsedDays })
    }
    resetForm()
  }

  function resetForm() {
    setStartDate('')
    setDays(1)
    setError('')
    onCancel()
  }

  const periodStartISO = toISODateString(periodStart)
  const periodEndISO   = toISODateString(periodEnd)

  return (
    <div className="space-y-5">
      {/* ── Form ──────────────────────────────────────────────────────── */}
      <div className="rounded-lg border border-stone-200 p-4 space-y-3">
        <h3 className="text-sm font-semibold text-stone-700">
          {isEditing ? '編輯請假記錄' : '新增請假記錄'}
        </h3>

        <div className="grid grid-cols-2 gap-3">
          {/* Start date */}
          <div>
            <label className="block text-xs text-stone-500 mb-1">開始日期</label>
            <input
              type="date"
              value={startDate}
              min={periodStartISO}
              max={periodEndISO}
              onChange={e => { setStartDate(e.target.value); setError('') }}
              className="w-full rounded border border-stone-300 px-2 py-1.5 text-sm
                         focus:outline-none focus:ring-1 focus:ring-teal-500"
            />
          </div>

          {/* Days */}
          <div>
            <label className="block text-xs text-stone-500 mb-1">天數</label>
            <div className="flex gap-1.5">
              {/* No `max` on purpose: the real per-record ceiling is dynamic
                  (carry-in + this period's entitlement + the next period's
                  advance) and is enforced by validateRecordsChain in
                  validate(). A fixed max here would only mislead (#30). */}
              <input
                type="number"
                min={0.25}
                step={0.25}
                value={days}
                onChange={e => { setDays(e.target.value); setError('') }}
                className="w-full rounded border border-stone-300 px-2 py-1.5 text-sm
                           focus:outline-none focus:ring-1 focus:ring-teal-500"
              />
            </div>
            {/* Quick-pick chips */}
            <div className="flex flex-wrap gap-1 mt-1.5">
              {[0.25, 0.5, 1, 2, 3].map(n => (
                <button
                  key={n}
                  onClick={() => setDays(n)}
                  className={`text-xs px-1.5 py-0.5 rounded border transition-colors
                              ${Number(days) === n
                                ? 'bg-teal-100 border-teal-400 text-teal-800'
                                : 'bg-stone-50 border-stone-200 text-stone-600 hover:border-stone-300'
                              }`}
                >
                  {n}天
                </button>
              ))}
            </div>
          </div>
        </div>

        {error && (
          <p className="text-xs text-red-600">{error}</p>
        )}

        <div className="flex gap-2 pt-1">
          <button
            onClick={handleSubmit}
            className="px-4 py-1.5 bg-teal-700 text-white text-sm font-medium rounded
                       hover:bg-teal-800 transition-colors"
          >
            {isEditing ? '儲存變更' : '新增'}
          </button>
          {isEditing && (
            <button
              onClick={resetForm}
              className="px-4 py-1.5 text-stone-600 text-sm rounded hover:bg-stone-100
                         transition-colors"
            >
              取消
            </button>
          )}
        </div>
      </div>

      {/* ── Records list ──────────────────────────────────────────────── */}
      {records.length === 0 ? (
        <p className="text-center text-sm text-stone-400 py-6">
          本週年度尚無請假記錄
        </p>
      ) : (
        <div className="space-y-1">
          {[...records]
            .sort((a, b) => a.startDate.localeCompare(b.startDate))
            .map(record => (
              <RecordRow
                key={record.id}
                record={record}
                isEditing={editingRecord?.id === record.id}
                onEdit={() => onEdit(record)}
                onDelete={() => onDelete(record.id)}
              />
            ))
          }
          <div className="pt-2 border-t border-stone-100 flex justify-between text-xs text-stone-500">
            <span>共 {records.length} 筆</span>
            <span>
              合計{' '}
              <span className="font-semibold text-stone-700">
                {records.reduce((s, r) => s + r.days, 0)} 天
              </span>
            </span>
          </div>
        </div>
      )}
    </div>
  )
}

function RecordRow({ record, isEditing, onEdit, onDelete }) {
  return (
    <div className={`flex items-center justify-between px-3 py-2 rounded-lg text-sm
                     ${isEditing ? 'bg-teal-50 ring-1 ring-teal-300' : 'hover:bg-stone-50'}`}>
      <div className="flex items-center gap-3">
        <span className="text-stone-700 font-medium tabular-nums">{record.startDate}</span>
        <span
          data-testid="record-days"
          className={`text-xs px-2 py-0.5 rounded-full font-medium
                          ${record.days < 1
                            ? 'bg-stone-100 text-stone-600'
                            : 'bg-teal-100 text-teal-700'
                          }`}>
          {record.days} 天
        </span>
      </div>
      <div className="flex gap-1">
        <button
          onClick={onEdit}
          className="p-1.5 text-stone-400 hover:text-teal-700 rounded transition-colors"
          aria-label="編輯"
        >
          <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round"
              d="M16.862 4.487l1.687-1.688a1.875 1.875 0 112.652 2.652L10.582 16.07a4.5 4.5 0 01-1.897 1.13L6 18l.8-2.685a4.5 4.5 0 011.13-1.897l8.932-8.931z" />
          </svg>
        </button>
        <button
          onClick={onDelete}
          className="p-1.5 text-stone-400 hover:text-red-500 rounded transition-colors"
          aria-label="刪除"
        >
          <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round"
              d="M14.74 9l-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 01-2.244 2.077H8.084a2.25 2.25 0 01-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 00-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 013.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 00-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.667 0 00-7.5 0" />
          </svg>
        </button>
      </div>
    </div>
  )
}
