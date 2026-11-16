import { useState, useCallback, useEffect } from 'react'
import { v4 as uuidv4 } from 'uuid'
import MainPage from './components/MainPage.jsx'
import Settings from './components/Settings.jsx'
import { loadSettings, saveSettings, loadRecords, saveRecords, clearAll, affectedAppData, DEFAULT_SETTINGS } from './utils/storage.js'
import { useHolidayCache } from './hooks/useHolidayCache.js'

export default function App() {
  const [page, setPage] = useState('main')
  const [settings, setSettings] = useState(() => loadSettings())
  const [records, setRecords] = useState(() => loadRecords())
  const { cache: holidayCache, ensureYear, clearCache } = useHolidayCache()

  // ── Cross-tab sync ──────────────────────────────────────────────────────────

  // Bumped whenever another tab changes settings/records; used as the `key`
  // of both pages below so they remount from the freshly loaded data.
  const [syncVersion, setSyncVersion] = useState(0)

  // Another tab saved/cleared app data: reload it instead of letting this
  // tab's stale snapshot overwrite it on the next save. The `storage` event
  // only fires in *other* tabs, so this tab's own saves never trigger it.
  // Holiday-cache writes are ignored (affectedAppData returns all false), so
  // another tab merely downloading holiday data never resets this tab's forms.
  useEffect(() => {
    function handleStorage(e) {
      const affected = affectedAppData(e.key)
      if (!affected.settings && !affected.records) return
      if (affected.settings) setSettings(loadSettings())
      if (affected.records) setRecords(loadRecords())
      setSyncVersion(v => v + 1)
    }
    window.addEventListener('storage', handleStorage)
    return () => window.removeEventListener('storage', handleStorage)
  }, [])

  // ── Settings ────────────────────────────────────────────────────────────────

  const handleSaveSettings = useCallback((newSettings) => {
    setSettings(newSettings)
    saveSettings(newSettings)
    setPage('main')
  }, [])

  // ── Records ─────────────────────────────────────────────────────────────────

  const handleAddRecord = useCallback((record) => {
    const newRecord = { id: uuidv4(), ...record }
    setRecords(prev => {
      const next = [...prev, newRecord].sort((a, b) => a.startDate.localeCompare(b.startDate))
      saveRecords(next)
      return next
    })
  }, [])

  const handleUpdateRecord = useCallback((id, updates) => {
    setRecords(prev => {
      const next = prev
        .map(r => r.id === id ? { ...r, ...updates } : r)
        .sort((a, b) => a.startDate.localeCompare(b.startDate))
      saveRecords(next)
      return next
    })
  }, [])

  const handleDeleteRecord = useCallback((id) => {
    setRecords(prev => {
      const next = prev.filter(r => r.id !== id)
      saveRecords(next)
      return next
    })
  }, [])

  // ── Resignation reset ──────────────────────────────────────────────────────

  const handleResign = useCallback(() => {
    clearAll()
    // Deliberately no saveSettings/saveRecords call here (unlike every handler
    // above) -- the point is for both localStorage keys to stay removed.
    // Doesn't touch the holiday cache: its storage keys use a different
    // prefix and a resignation reset has nothing to do with holiday data.
    setSettings({ ...DEFAULT_SETTINGS, customRules: [] })
    setRecords([])
    setPage('main')
  }, [])

  // ── Settings page "清除所有本機資料" ────────────────────────────────────────

  const handleClearAllData = useCallback(() => {
    clearAll()
    clearCache()
    setSettings({ ...DEFAULT_SETTINGS, customRules: [] })
    setRecords([])
    setPage('main')
  }, [clearCache])

  // ── Render ──────────────────────────────────────────────────────────────────

  return (
    <div className="min-h-screen bg-stone-50 flex flex-col">
      {/* Top navigation */}
      <header className="bg-white border-b border-stone-200 sticky top-0 z-10">
        <div className="max-w-3xl mx-auto px-4 h-14 flex items-center justify-between">
          <div className="flex items-center gap-2">
            {/* Simple calendar icon */}
            <svg
              className="w-5 h-5 text-teal-700"
              fill="none" stroke="currentColor" strokeWidth={2}
              viewBox="0 0 24 24"
            >
              <rect x="3" y="4" width="18" height="18" rx="2" />
              <path d="M16 2v4M8 2v4M3 10h18" />
            </svg>
            <span className="font-semibold text-stone-800 text-base tracking-tight">
              特休計算機
            </span>
          </div>
          <nav className="flex gap-1">
            <NavButton
              active={page === 'main'}
              onClick={() => setPage('main')}
            >
              首頁
            </NavButton>
            <NavButton
              active={page === 'settings'}
              onClick={() => setPage('settings')}
            >
              設定
            </NavButton>
          </nav>
        </div>
      </header>

      {/* Page content */}
      <main className="flex-1 max-w-3xl mx-auto w-full px-4 py-6">
        {/* key={syncVersion}: remount after another tab changes data.
            Settings only seeds its form state from `settings` at mount, so
            without a remount it would show this tab's stale, now-locked form.
            MainPage/LeaveForm could be mid-edit on a record another tab just
            deleted; merely clearing editingRecord would leave its values in
            an "add" form (see handleSelectPeriod in MainPage.jsx), so a
            remount -- like reloading the page -- is the consistent fix. */}
        {page === 'main' ? (
          <MainPage
            key={syncVersion}
            settings={settings}
            records={records}
            holidayCache={holidayCache}
            ensureYear={ensureYear}
            onAddRecord={handleAddRecord}
            onUpdateRecord={handleUpdateRecord}
            onDeleteRecord={handleDeleteRecord}
            onGoToSettings={() => setPage('settings')}
          />
        ) : (
          <Settings
            key={syncVersion}
            settings={settings}
            records={records}
            holidayCache={holidayCache}
            onSave={handleSaveSettings}
            onCancel={() => setPage('main')}
            onResign={handleResign}
            onClearHolidayCache={clearCache}
            onClearAllData={handleClearAllData}
          />
        )}
      </main>

      <Footer />
    </div>
  )
}

function NavButton({ active, onClick, children }) {
  return (
    <button
      onClick={onClick}
      className={`px-3 py-1.5 rounded-md text-sm font-medium transition-colors ${
        active
          ? 'bg-teal-50 text-teal-700'
          : 'text-stone-600 hover:text-stone-900 hover:bg-stone-100'
      }`}
    >
      {children}
    </button>
  )
}

function Footer() {
  const buildDate = import.meta.env.VITE_BUILD_DATE || null

  return (
    <footer className="border-t border-stone-200 bg-white mt-8">
      <div className="max-w-3xl mx-auto px-4 py-5 text-xs text-stone-400 space-y-1">
        {buildDate && (
          <p>最後更新：{buildDate}</p>
        )}
        <p>
          本網頁依據最後更新日當時最新的中華民國勞動基準法設計，若與現行法規有任何落差，請以最新相關法規為準。
        </p>
        <p>
          本網站以 MIT 授權，原始碼請見{' '}
          <a
            href="https://github.com/corytu/annual-leave-calculator"
            target="_blank"
            rel="noopener noreferrer"
            className="underline hover:text-stone-600"
          >
            GitHub
          </a>
        </p>
      </div>
    </footer>
  )
}
