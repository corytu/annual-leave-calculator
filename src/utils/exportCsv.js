/**
 * exportCsv.js
 *
 * Builds a plain-text CSV backup of a user's settings/records/settlement for
 * download before a resignation reset. Not intended to be re-imported.
 */

export function buildBackupCsv(settings, records, summary) {
  const settlementDays = summary.hasLeave
    ? summary.periods[summary.periods.length - 1].remaining
    : 0;

  const lines = [];
  lines.push(`到職日,${settings.onboardDate}`);
  lines.push(`特休規則,${settings.ruleType === 'custom' ? '公司自訂' : '勞基法'}`);
  lines.push(`允許遞延,${settings.allowCarryover ? '是' : '否'}`);
  if (settings.ruleType === 'custom') {
    for (const rule of settings.customRules) {
      lines.push(`${rule.months},${rule.days}`);
    }
  }
  lines.push('');
  lines.push('請假記錄');
  lines.push('開始日期,天數');
  const sortedRecords = [...records].sort((a, b) => a.startDate.localeCompare(b.startDate));
  for (const r of sortedRecords) {
    lines.push(`${r.startDate},${r.days}`);
  }
  lines.push('');
  lines.push('離職結清');
  lines.push(`應結清工資天數,${settlementDays}`);

  return lines.join('\n');
}

/** Triggers a browser download of `csvContent` as `filename`. */
export function downloadCsv(filename, csvContent) {
  const blob = new Blob(['﻿' + csvContent], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
