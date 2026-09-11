import { useState, useCallback } from 'react'
import { v4 as uuidv4 } from 'uuid'
import MainPage from './components/MainPage.jsx'
import Settings from './components/Settings.jsx'
import { loadSettings, saveSettings, loadRecords, saveRecords, clearAll, DEFAULT_SETTINGS } from './utils/storage.js'

export default function App() {
  const [page, setPage] = useState('main')
  const [settings, setSettings] = useState(() => loadSettings())
  const [records, setRecords] = useState(() => loadRecords())

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
    setSettings({ ...DEFAULT_SETTINGS, customRules: [] })
    setRecords([])
    setPage('main')
  }, [])

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
              特休計算器
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
        {page === 'main' ? (
          <MainPage
            settings={settings}
            records={records}
            onAddRecord={handleAddRecord}
            onUpdateRecord={handleUpdateRecord}
            onDeleteRecord={handleDeleteRecord}
            onGoToSettings={() => setPage('settings')}
          />
        ) : (
          <Settings
            settings={settings}
            records={records}
            onSave={handleSaveSettings}
            onCancel={() => setPage('main')}
            onResign={handleResign}
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
