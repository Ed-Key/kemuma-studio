import { describe, it, expect } from 'vitest'
import { SCENES, FAMILIES, getScene, scenesForFamily, pickScene } from '@/lib/staging/scenes'

describe('scene templates', () => {
  it('has unique keys', () => {
    const keys = SCENES.map((s) => s.key)
    expect(new Set(keys).size).toBe(keys.length)
  })

  it('covers every catalog family with at least two scenes', () => {
    expect(FAMILIES).toEqual([
      'coaster set', 'trinket dish', 'jewelry box', 'bowl', 'heart dish', 'figure', 'sculpture',
    ])
    for (const family of FAMILIES) {
      expect(scenesForFamily(family).length, family).toBeGreaterThanOrEqual(2)
    }
  })

  it('embeds the validated integration language in every lighting section', () => {
    for (const s of SCENES) {
      expect(s.lighting, s.key).toContain('never composited')
      expect(s.lighting, s.key).toMatch(/relight/i)
      expect(s.lighting, s.key).toMatch(/contact shadow/i)
      expect(s.scene, s.key).toMatch(/^Photorealistic/)
    }
  })

  it('only references known families', () => {
    for (const s of SCENES) {
      for (const f of s.families) expect(FAMILIES, `${s.key} -> ${f}`).toContain(f)
    }
  })

  it('rotates to the least-used scene', () => {
    const coaster = scenesForFamily('coaster set').map((s) => s.key)
    expect(pickScene('coaster set', {}).key).toBe(coaster[0])
    expect(pickScene('coaster set', { [coaster[0]]: 1 }).key).toBe(coaster[1])
    const even = Object.fromEntries(coaster.map((k) => [k, 2]))
    expect(pickScene('coaster set', even).key).toBe(coaster[0])
  })

  it('throws on unknown keys and families', () => {
    expect(() => getScene('nope')).toThrow(/unknown scene/)
    expect(() => scenesForFamily('vase')).toThrow(/no scenes/)
  })

  it('never stages readable text props', () => {
    for (const s of SCENES) {
      expect(s.scene.toLowerCase(), s.key).not.toContain('titled')
      if (s.scene.includes('book')) expect(s.scene, s.key).toMatch(/blank spines?/)
    }
  })
})
