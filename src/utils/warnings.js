/**
 * @typedef {'incomplete' | 'error' | 'advisory'} WarningTier
 * @typedef {{
 *   id: string,
 *   tier: WarningTier,
 *   scope: 'field' | 'row' | 'form',
 *   rowId?: string,
 *   field?: string,           // 分派顯示位置/W15 前置判斷用，不解析 id 字串
 *   touchedKeys?: string[],   // 見計畫 §2；空陣列或省略 = 不設限，永遠可見
 *   dedupeKey?: string,       // 僅集中清單去重用，見計畫 §2
 *   message: string,
 * }} Warning
 */

// incomplete/error 會阻擋動作按鈕；advisory 只是建議，不擋。
export function isBlocking(tier) {
  return tier === 'incomplete' || tier === 'error'
}

// 0.25 倍數判斷用 (x*4)%1 而不是 x%0.25，是既有 settingsValidation.js 的既有
// idiom（避開 %0.25 在某些十進位小數上的浮點精度問題）。
// 這個判斷跟 `x % 0.25 !== 0` 並非在所有極端值下都等價，有兩條分開的邊界
// 路徑：
//   - x 本身就是 ±Infinity 或 NaN：被 `Number.isFinite(x)` 直接擋下，回傳
//     false。
//   - x 是一個非常大的有限數（例如 Number.MAX_VALUE），是 `x*4` 才會溢位成
//     Infinity：這時 `Number.isFinite(x)` 會通過，但 `(x*4) % 1` 算出
//     `Infinity % 1 === NaN`，`NaN === 0` 為 false，是在這一步被擋下，
//     不是被 isFinite 擋下。
// LeaveForm 天數欄位刻意沒有 max（#30），這個量級的輸入無論走哪條路徑，最
// 後都回報「不是 0.25 的倍數」。舊版 `x % 0.25` 在同樣極端值下的行為不完全
// 相同——例如 `Number.MAX_VALUE % 0.25 === 0`，舊版會判定合法，新版判定
// 不合法，這才是兩版真正的行為差異點。這是刻意接受的差異：這個量級的輸入
// 無論如何都會被 validateRecordsChain 的超支檢查擋下，不影響最終是否能
// 送出。
export function isQuarterStep(x) {
  return Number.isFinite(x) && (x * 4) % 1 === 0
}

export function isWarningVisible(warning, touched) {
  const keys = warning.touchedKeys
  if (!keys || keys.length === 0) return true
  return keys.some(k => touched[k])
}

// 依 keyFn(item) 去重，保留每個 key 第一次出現的項目，順序不變。
// 集中清單用它依 dedupeKey ?? id 去重（W12）。
export function dedupeBy(items, keyFn) {
  const seen = new Set()
  const result = []
  for (const item of items) {
    const key = keyFn(item)
    if (seen.has(key)) continue
    seen.add(key)
    result.push(item)
  }
  return result
}
