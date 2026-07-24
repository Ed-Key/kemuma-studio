import type { Db } from './db'
import { logEvent } from './catalog'

export interface ChatMessage {
  role: 'user' | 'assistant'
  text: string
}

export interface StagingChatRecord {
  chat_id: number
  design_id: number
  messages_json: string
  staging_notes: string | null
  pending_plan_json: string | null
  created_at: string
}

export function getChatForDesign(db: Db, designId: number): StagingChatRecord | null {
  const row = db.prepare('SELECT * FROM staging_chats WHERE design_id = ?').get(designId) as
    | StagingChatRecord
    | undefined
  return row ?? null
}

export function getOrCreateChatForDesign(db: Db, designId: number): StagingChatRecord {
  const existing = getChatForDesign(db, designId)
  if (existing) return existing
  db.prepare('INSERT INTO staging_chats (design_id) VALUES (?)').run(designId)
  return getChatForDesign(db, designId)!
}

export function appendChatMessages(db: Db, chatId: number, msgs: ChatMessage[]): void {
  const row = db.prepare('SELECT messages_json FROM staging_chats WHERE chat_id = ?').get(chatId) as
    | { messages_json: string }
    | undefined
  if (!row) throw new Error(`chat ${chatId} not found`)
  const messages = JSON.parse(row.messages_json) as ChatMessage[]
  messages.push(...msgs)
  db.prepare('UPDATE staging_chats SET messages_json = ? WHERE chat_id = ?').run(JSON.stringify(messages), chatId)
}

export function setStagingNotes(db: Db, chatId: number, notes: string): void {
  db.prepare('UPDATE staging_chats SET staging_notes = ? WHERE chat_id = ?').run(notes, chatId)
  logEvent(db, 'chat.notes_saved', { chat_id: chatId })
}

export function setPendingPlan(db: Db, chatId: number, planJson: string | null): void {
  db.prepare('UPDATE staging_chats SET pending_plan_json = ? WHERE chat_id = ?').run(planJson, chatId)
}

export function stagingNotesForDesign(db: Db, designId: number): string | null {
  return getChatForDesign(db, designId)?.staging_notes ?? null
}
