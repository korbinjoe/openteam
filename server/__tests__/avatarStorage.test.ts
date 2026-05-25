import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { promises as fs } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'

const TMP_HOME = join(tmpdir(), `openteam-avatar-test-${Date.now()}-${Math.random().toString(36).slice(2)}`)

vi.mock('os', async () => {
  const actual = await vi.importActual<typeof import('os')>('os')
  return { ...actual, homedir: () => TMP_HOME }
})

let avatarStorage: typeof import('../lib/avatarStorage')

beforeEach(async () => {
  vi.resetModules()
  avatarStorage = await import('../lib/avatarStorage')
  await fs.mkdir(TMP_HOME, { recursive: true })
})

afterEach(async () => {
  await fs.rm(TMP_HOME, { recursive: true, force: true })
})

describe('avatarStorage', () => {
  it('ensureAvatarDir creates ~/.openteam/avatars', async () => {
    await avatarStorage.ensureAvatarDir()
    const stat = await fs.stat(avatarStorage.AVATAR_ROOT)
    expect(stat.isDirectory()).toBe(true)
  })

  it('saveAvatar writes png and resolveAvatarPath returns it', async () => {
    const buf = Buffer.from('FAKEPNG')
    const file = await avatarStorage.saveAvatar('custom-001', 'brush', buf)
    expect(file.endsWith('custom-001/brush.png')).toBe(true)

    const resolved = await avatarStorage.resolveAvatarPath('custom-001', 'brush')
    expect(resolved).toBe(file)

    const round = await fs.readFile(file)
    expect(round.toString()).toBe('FAKEPNG')
  })

  it('saveAvatar rejects invalid agentId', async () => {
    await expect(avatarStorage.saveAvatar('Bad/ID', 'brush', Buffer.alloc(1))).rejects.toThrow()
    await expect(avatarStorage.saveAvatar('UPPER', 'brush', Buffer.alloc(1))).rejects.toThrow()
    await expect(avatarStorage.saveAvatar('', 'brush', Buffer.alloc(1))).rejects.toThrow()
  })

  it('saveAvatar rejects unknown style', async () => {
    await expect(
      avatarStorage.saveAvatar('custom-001', 'mystery' as never, Buffer.alloc(1)),
    ).rejects.toThrow()
  })

  it('resolveAvatarPath returns null for missing file', async () => {
    const out = await avatarStorage.resolveAvatarPath('custom-002', 'brush')
    expect(out).toBeNull()
  })

  it('resolveAvatarPath rejects path traversal attempts', async () => {
    expect(await avatarStorage.resolveAvatarPath('../etc', 'brush')).toBeNull()
    expect(await avatarStorage.resolveAvatarPath('custom-001', '../passwd')).toBeNull()
    expect(await avatarStorage.resolveAvatarPath('CUSTOM', 'brush')).toBeNull()
  })

  it('deleteAgentAvatars removes the entire agent folder', async () => {
    await avatarStorage.saveAvatar('custom-001', 'brush', Buffer.from('a'))
    await avatarStorage.saveAvatar('custom-001', 'default', Buffer.from('b'))
    await avatarStorage.deleteAgentAvatars('custom-001')

    const after = await avatarStorage.resolveAvatarPath('custom-001', 'brush')
    expect(after).toBeNull()
  })

  it('deleteAgentAvatars on non-existent agent is a no-op', async () => {
    await expect(avatarStorage.deleteAgentAvatars('never-existed')).resolves.toBeUndefined()
  })

  it('listAvatarStyles returns saved styles only', async () => {
    await avatarStorage.saveAvatar('custom-003', 'default', Buffer.from('a'))
    await avatarStorage.saveAvatar('custom-003', 'brush', Buffer.from('b'))
    const styles = await avatarStorage.listAvatarStyles('custom-003')
    expect(styles.sort()).toEqual(['brush', 'default'])
  })
})
