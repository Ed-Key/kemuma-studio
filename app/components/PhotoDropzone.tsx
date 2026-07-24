'use client'

import { useState } from 'react'

/**
 * File input styled as a dashed drop-zone. The native control is hidden but
 * kept focusable and stretched to cover the whole zone, so the entire dashed
 * area is the click/keyboard target. After a selection it reports the count.
 */
export default function PhotoDropzone({ name = 'photos' }: { name?: string }) {
  const [count, setCount] = useState(0)
  return (
    <label className="drop-zone">
      <span>Drop photos or click to choose</span>
      <span className="drop-count">
        {count > 0 ? `${count} photo${count === 1 ? '' : 's'} selected` : 'JPG, PNG, WEBP, or HEIC'}
      </span>
      <input
        type="file"
        name={name}
        accept=".jpg,.jpeg,.png,.webp,.heic"
        multiple
        required
        className="drop-input"
        onChange={(e) => setCount(e.target.files?.length ?? 0)}
      />
    </label>
  )
}
