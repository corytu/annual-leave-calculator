import { useState, useEffect } from 'react'
import { toISODateString } from '../utils/leaveCalculations.js'

export function useToday(intervalMs = 60_000) {
  const [today, setToday] = useState(() => new Date())

  useEffect(() => {
    const id = setInterval(() => {
      const now = new Date()
      setToday(previous =>
        toISODateString(previous) === toISODateString(now) ? previous : now
      )
    }, intervalMs)
    return () => clearInterval(id)
  }, [intervalMs])

  return today
}
