const TIER_CLASSNAME = {
  incomplete: 'text-xs text-stone-500',
  error: 'text-xs text-red-600',
}

export default function FieldWarnings({ warnings }) {
  if (warnings.length === 0) return null
  return warnings.map(w => (
    <p key={w.id} className={TIER_CLASSNAME[w.tier]}>{w.message}</p>
  ))
}
