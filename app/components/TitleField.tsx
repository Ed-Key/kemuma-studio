'use client'

import { useState } from 'react'

const LIMIT = 140

export default function TitleField({ defaultValue }: { defaultValue: string }) {
  const [len, setLen] = useState(defaultValue.length)
  return (
    <label className="field">
      <div className="between">
        <span className="field-label">Title</span>
        <span className={`counter${len > LIMIT ? ' counter--over' : ''}`}>
          {len}/{LIMIT}
        </span>
      </div>
      <input
        className="input"
        name="title"
        defaultValue={defaultValue}
        onChange={(e) => setLen(e.target.value.length)}
      />
    </label>
  )
}
