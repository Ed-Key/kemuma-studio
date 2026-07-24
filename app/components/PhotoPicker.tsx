'use client'

import { useState } from 'react'

/**
 * Compact file picker: a ghost "Add photos" button that is itself the file
 * input trigger (native control hidden but kept focusable), plus an
 * "N selected" note. Field name stays `photos` for the upload action.
 */
export default function PhotoPicker({ name = 'photos' }: { name?: string }) {
  const [count, setCount] = useState(0)
  return (
    <span className="picker-row">
      <span className="file-trigger btn btn--ghost">
        Add photos
        <input
          type="file"
          name={name}
          accept=".jpg,.jpeg,.png,.webp,.heic"
          multiple
          required
          className="file-trigger-input"
          onChange={(e) => setCount(e.target.files?.length ?? 0)}
        />
      </span>
      {count > 0 && <span className="picker-count">{count} selected</span>}
    </span>
  )
}
