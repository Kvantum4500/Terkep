import { useEffect, useState } from 'react'
import { onUpdateAvailable } from '../pwa/register'

export function UpdateToast() {
  const [apply, setApply] = useState<(() => void) | null>(null)
  useEffect(() => onUpdateAvailable((fn) => setApply(() => fn)), [])
  if (!apply) return null
  return (
    <div className="toast" role="status">
      <span>Új verzió érhető el.</span>
      <button type="button" className="btn" onClick={apply}>
        Frissítés
      </button>
      <button type="button" className="icon-btn" aria-label="Később" onClick={() => setApply(null)}>
        ✕
      </button>
    </div>
  )
}
