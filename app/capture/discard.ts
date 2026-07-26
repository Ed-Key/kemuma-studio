'use server'

import { revalidatePath } from 'next/cache'
import { rm } from 'node:fs/promises'
import path from 'node:path'
import { logEvent } from '@/lib/catalog/catalog'
import { getCatalogDb, dataDir } from '@/lib/catalog/instance'
import { getIntake } from '@/lib/catalog/intakes'
import type { ActionResult } from '../components/action-result'

/**
 * Throw away a captured object.
 *
 * Photographing something and then deciding not to catalogue it is ordinary,
 * and until now there was no way to say so: an unwanted intake sat pending for
 * ever and the only escape was editing the database.
 *
 * The row goes rather than gaining a discarded status, because an intake that
 * was never confirmed carries no signal worth keeping. The matcher's accuracy
 * is measured from match.confirmed events, and there is none here. The event
 * log still records that it happened.
 */
export async function discardCapturedAction(
  _prev: ActionResult | null,
  formData: FormData
): Promise<ActionResult> {
  try {
    const db = getCatalogDb()
    const intakeId = Number(formData.get('intake_id'))
    const intake = getIntake(db, intakeId)
    if (!intake) throw new Error('already gone')
    if (intake.status !== 'pending') throw new Error('this one was already catalogued')

    // Only ever a directory this app created under data/intake. A path that is
    // not one is a bug, and deleting whatever it pointed at would be worse.
    const root = path.join(dataDir(), 'intake')
    const dir = path.resolve(intake.dir)
    if (!dir.startsWith(path.resolve(root) + path.sep)) {
      throw new Error(`refusing to delete ${dir}, which is outside the intake directory`)
    }
    await rm(dir, { recursive: true, force: true })

    db.prepare('DELETE FROM intakes WHERE intake_id = ?').run(intakeId)
    logEvent(db, 'intake.discarded', { intake_id: intakeId, dir: intake.dir })
    revalidatePath('/capture')
    revalidatePath('/intake')
    return { ok: true, message: 'Discarded.' }
  } catch (err) {
    return {
      ok: false,
      message: 'Could not discard it.',
      detail: err instanceof Error ? err.message : String(err),
    }
  }
}
