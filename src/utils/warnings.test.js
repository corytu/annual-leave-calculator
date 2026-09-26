import { describe, it, expect } from 'vitest'
import { isBlocking, isQuarterStep, isWarningVisible, dedupeBy } from './warnings.js'

describe('isBlocking', () => {
  it('is true for incomplete', () => {
    expect(isBlocking('incomplete')).toBe(true)
  })

  it('is true for error', () => {
    expect(isBlocking('error')).toBe(true)
  })

  it('is false for advisory', () => {
    expect(isBlocking('advisory')).toBe(false)
  })
})

describe('isQuarterStep', () => {
  it.each([
    [0.25, true],
    [0.3, false],
    [1, true],
    [-0.25, true],
    [NaN, false],
  ])('isQuarterStep(%p) === %p', (x, expected) => {
    expect(isQuarterStep(x)).toBe(expected)
  })

  // x 本身是 Infinity -> 在 Number.isFinite(x) 這一步就被擋下，不是 x*4 溢位的路徑。
  it('rejects Infinity (blocked by Number.isFinite, not by x*4 overflow)', () => {
    expect(isQuarterStep(Infinity)).toBe(false)
  })

  // x 本身是有限值，會通過 Number.isFinite(x)；x*4 才真的溢位成 Infinity，
  // Infinity % 1 === NaN，NaN === 0 為 false —— 這才是程式註解描述的那條路
  // 徑，是刻意接受的邊界行為，不是要修的 bug。
  it('rejects Number.MAX_VALUE (x itself is finite, x*4 overflows to Infinity)', () => {
    expect(isQuarterStep(Number.MAX_VALUE)).toBe(false)
  })
})

describe('isWarningVisible', () => {
  it('is visible when touchedKeys is undefined', () => {
    expect(isWarningVisible({}, {})).toBe(true)
  })

  it('is visible when touchedKeys is empty', () => {
    expect(isWarningVisible({ touchedKeys: [] }, {})).toBe(true)
  })

  it('is visible when at least one key is touched', () => {
    expect(isWarningVisible({ touchedKeys: ['a', 'b'] }, { b: true })).toBe(true)
  })

  it('is not visible when none of the keys are touched', () => {
    expect(isWarningVisible({ touchedKeys: ['a', 'b'] }, { c: true })).toBe(false)
  })
})

describe('dedupeBy', () => {
  it('keeps only the first item per key, preserving order', () => {
    const items = [{ k: 'a', v: 1 }, { k: 'b', v: 2 }, { k: 'a', v: 3 }]
    expect(dedupeBy(items, i => i.k)).toEqual([{ k: 'a', v: 1 }, { k: 'b', v: 2 }])
  })

  it('keeps all items when keys are all different', () => {
    const items = [{ k: 'a' }, { k: 'b' }, { k: 'c' }]
    expect(dedupeBy(items, i => i.k)).toEqual(items)
  })

  it('threshold-duplicate scenario: two different threshold groups each keep one representative', () => {
    const items = [
      { rowId: 'r1', dedupeKey: 'months-duplicate-12' },
      { rowId: 'r2', dedupeKey: 'months-duplicate-12' },
      { rowId: 'r3', dedupeKey: 'months-duplicate-24' },
      { rowId: 'r4', dedupeKey: 'months-duplicate-24' },
    ]
    expect(dedupeBy(items, i => i.dedupeKey)).toEqual([
      { rowId: 'r1', dedupeKey: 'months-duplicate-12' },
      { rowId: 'r3', dedupeKey: 'months-duplicate-24' },
    ])
  })
})
