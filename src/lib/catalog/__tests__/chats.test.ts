import { describe, it, expect, beforeEach } from 'vitest'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { openDb, type Db } from '@/lib/catalog/db'
import { createDesign } from '@/lib/catalog/catalog'
import {
  getOrCreateChatForDesign, appendChatMessages, setStagingNotes, setPendingPlan,
  getChatForDesign, stagingNotesForDesign,
} from '@/lib/catalog/chats'

function tempDbPath(): string {
  return path.join(mkdtempSync(path.join(tmpdir(), 'kemuma-chat-')), 'catalog.sqlite')
}

describe('staging chats', () => {
  let db: Db
  let designId: number

  beforeEach(() => {
    db = openDb(tempDbPath())
    designId = createDesign(db, { family: 'trinket dish', name: 'Canoe Trinket Dish' })
  })

  it('creates one chat per design and returns the same one afterward', () => {
    const a = getOrCreateChatForDesign(db, designId)
    const b = getOrCreateChatForDesign(db, designId)
    expect(b.chat_id).toBe(a.chat_id)
    expect(JSON.parse(a.messages_json)).toEqual([])
  })

  it('appends messages in order', () => {
    const chat = getOrCreateChatForDesign(db, designId)
    appendChatMessages(db, chat.chat_id, [{ role: 'user', text: 'it holds my jewelry' }])
    appendChatMessages(db, chat.chat_id, [{ role: 'assistant', text: 'noted, planning a scene' }])
    const msgs = JSON.parse(getChatForDesign(db, designId)!.messages_json)
    expect(msgs.map((m: { role: string }) => m.role)).toEqual(['user', 'assistant'])
  })

  it('stores staging notes and pending plans', () => {
    const chat = getOrCreateChatForDesign(db, designId)
    setStagingNotes(db, chat.chat_id, 'jewelry catch-all; chain drapes over the gunwale')
    setPendingPlan(db, chat.chat_id, '{"n":4}')
    expect(stagingNotesForDesign(db, designId)).toMatch(/catch-all/)
    expect(getChatForDesign(db, designId)!.pending_plan_json).toBe('{"n":4}')
    setPendingPlan(db, chat.chat_id, null)
    expect(getChatForDesign(db, designId)!.pending_plan_json).toBeNull()
  })

  it('returns null notes for designs without a chat', () => {
    expect(stagingNotesForDesign(db, designId)).toBeNull()
  })
})
