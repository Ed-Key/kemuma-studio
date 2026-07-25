import { describe, expect, it } from 'vitest'
import { parseJobInput } from '@/lib/jobs/operations'

describe('parseJobInput', () => {
  it('reads back the call a staging batch was started with', () => {
    const input = parseJobInput(
      'staging_batch',
      JSON.stringify({
        kind: 'staging_batch',
        designId: 7,
        sceneKey: 'oak-dining-table',
        sourcePhotoId: 45,
        variance: true,
      })
    )
    expect(input).toEqual({
      kind: 'staging_batch',
      designId: 7,
      sceneKey: 'oak-dining-table',
      sourcePhotoId: 45,
      variance: true,
    })
  })

  it('keeps an absent scene absent rather than inventing one', () => {
    // "auto" is stored as no scene at all, and a retry that quietly picked a
    // named scene would not be a repeat of the run that was interrupted.
    const input = parseJobInput(
      'staging_batch',
      JSON.stringify({ kind: 'staging_batch', designId: 7, variance: false })
    )
    expect(input).toEqual({
      kind: 'staging_batch',
      designId: 7,
      sceneKey: undefined,
      sourcePhotoId: undefined,
      variance: false,
    })
  })

  it('refuses a job that never recorded its inputs', () => {
    expect(parseJobInput('staging_batch', null)).toBeNull()
  })

  it('refuses input that is not the shape its kind needs', () => {
    // A director turn without its message would re-run as an empty prompt,
    // which is a different conversation rather than the same one repeated.
    expect(
      parseJobInput('director_turn', JSON.stringify({ designId: 7, chatId: 3 }))
    ).toBeNull()
    expect(
      parseJobInput('planned_batch', JSON.stringify({ designId: 7, chatId: 3 }))
    ).toBeNull()
    expect(parseJobInput('listing_copy', JSON.stringify({ chatId: 3 }))).toBeNull()
  })

  it('refuses input that is not readable at all', () => {
    expect(parseJobInput('listing_copy', 'not json')).toBeNull()
    expect(parseJobInput('listing_copy', 'null')).toBeNull()
  })

  it('refuses a kind it does not know how to run', () => {
    expect(parseJobInput('etsy_push', JSON.stringify({ designId: 7 }))).toBeNull()
  })
})
