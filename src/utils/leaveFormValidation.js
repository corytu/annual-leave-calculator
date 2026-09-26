import { isBlocking, isQuarterStep } from './warnings.js'
import { validateRecordsChain, parseLocalDate } from './leaveCalculations.js'

export function computeLeaveFormWarnings({
  startDate, days, periodStart, periodEnd, allRecords, editingRecord, settings, today,
}) {
  const warnings = []
  const daysIsEmpty = days === '' || days === null || days === undefined
  const parsedDays = daysIsEmpty ? NaN : parseFloat(days)

  if (!startDate) {
    warnings.push({
      id: 'startDate-incomplete', tier: 'incomplete', scope: 'field', field: 'startDate',
      touchedKeys: ['startDate'], message: '請選擇請假開始日期',
    })
  } else {
    const d = parseLocalDate(startDate)
    if (d < periodStart || d > periodEnd) {
      warnings.push({
        id: 'startDate-range', tier: 'error', scope: 'field', field: 'startDate',
        touchedKeys: ['startDate'], message: '日期必須在本週年度範圍內',
      })
    }
  }

  if (daysIsEmpty) {
    warnings.push({
      id: 'days-incomplete', tier: 'incomplete', scope: 'field', field: 'days',
      touchedKeys: ['days'], message: '請輸入天數',
    })
  } else {
    if (!(parsedDays > 0)) {
      warnings.push({
        id: 'days-positive', tier: 'error', scope: 'field', field: 'days',
        touchedKeys: ['days'], message: '天數必須大於 0',
      })
    }
    if (!isQuarterStep(parsedDays)) {
      warnings.push({
        id: 'days-quarter-step', tier: 'error', scope: 'field', field: 'days',
        touchedKeys: ['days'], message: '天數最小單位為 0.25（2 小時）',
      })
    }
  }

  const hasBlockingField = warnings.some(w => isBlocking(w.tier))
  if (!hasBlockingField) {
    const candidateRecords = editingRecord
      ? allRecords.map(r => r.id === editingRecord.id ? { ...r, startDate, days: parsedDays } : r)
      : [...allRecords, { startDate, days: parsedDays }]
    const chainResult = validateRecordsChain(settings, candidateRecords, today)
    if (!chainResult.valid) {
      warnings.push({
        id: 'overspend', tier: 'error', scope: 'form', field: 'days',
        touchedKeys: ['startDate', 'days'],
        message: '這筆請假超支可用額度上限，請確認天數是否正確',
      })
    }
  }

  return warnings
}
