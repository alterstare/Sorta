import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { DELETED_DIR, trashFor } from '../src/core/trash'

let dir: string
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'sorta-'))
})
afterEach(() => rmSync(dir, { recursive: true, force: true }))

describe('trashFor', () => {
  it('moves into 삭제됨 when the OS recycle bin refuses the file (mapped network drive)', async () => {
    const org = join(dir, 'org')
    mkdirSync(join(org, 'Game'), { recursive: true })
    const file = join(org, 'Game', 'a.png')
    writeFileSync(file, 'x')
    await trashFor(org, async () => {
      throw new Error('Failed to move item to trash')
    })(file)
    expect(existsSync(file)).toBe(false)
    expect(existsSync(join(org, DELETED_DIR, 'Game', 'a.png'))).toBe(true)
  })

  it('keeps the error when there is no organize folder', async () => {
    const file = join(dir, 'a.png')
    writeFileSync(file, 'x')
    await expect(
      trashFor('', async () => {
        throw new Error('nope')
      })(file)
    ).rejects.toThrow('nope')
    expect(existsSync(file)).toBe(true)
  })
})
