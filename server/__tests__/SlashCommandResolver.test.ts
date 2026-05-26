import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest'
import { mkdir, writeFile, rm } from 'fs/promises'
import { join } from 'path'
import { tmpdir } from 'os'

const FAKE_HOME = join(tmpdir(), `slash-resolver-${Date.now()}-${process.pid}`)

vi.mock('os', async () => {
  const actual = await vi.importActual<typeof import('os')>('os')
  return { ...actual, homedir: () => FAKE_HOME }
})

// Import AFTER the mock so the module captures the fake homedir.
const { expandSlashCommand } = await import('../runtime/SlashCommandResolver')

const PROJECT_CWD = join(FAKE_HOME, 'project')

const SLASH_MARKER_RE = /^<!--OT_SLASH:([A-Za-z0-9+/=]+)-->\n/

const decodeMarker = (text: string): { cmd: string; args: string; original: string } | null => {
  const m = text.match(SLASH_MARKER_RE)
  if (!m) return null
  return JSON.parse(Buffer.from(m[1], 'base64').toString('utf-8'))
}

const stripMarker = (text: string): string => text.replace(SLASH_MARKER_RE, '')

const writeFileAt = async (path: string, body: string) => {
  await mkdir(join(path, '..'), { recursive: true })
  await writeFile(path, body, 'utf-8')
}

beforeAll(async () => {
  await mkdir(FAKE_HOME, { recursive: true })
  await mkdir(PROJECT_CWD, { recursive: true })

  // Project-level command with frontmatter.
  await writeFileAt(
    join(PROJECT_CWD, '.claude/commands/openspec/proposal.md'),
    '---\nname: Test Proposal\n---\nProject body here.\n',
  )

  // User-level command with $ARGUMENTS placeholder.
  await writeFileAt(
    join(FAKE_HOME, '.claude/commands/team/review.md'),
    'Review the following:\n$ARGUMENTS\nDone.',
  )

  // Plugin command (both layouts: commands/ and .claude/commands/).
  const pluginA = join(FAKE_HOME, '.claude/plugins/cache/marketplace-a/plug-a/1.0.0')
  await writeFileAt(join(pluginA, 'commands/cmd.md'), 'Plugin A direct body.')
  const pluginB = join(FAKE_HOME, '.claude/plugins/cache/marketplace-b/plug-b/2.0.0')
  await writeFileAt(join(pluginB, '.claude/commands/cmd.md'), 'Plugin B dotted body.')
  // Plugin skill via SKILL.md
  const pluginC = join(FAKE_HOME, '.claude/plugins/cache/marketplace-c/plug-c/3.0.0')
  await writeFileAt(join(pluginC, 'skills/do-thing/SKILL.md'), 'Skill C body.')

  await writeFileAt(
    join(FAKE_HOME, '.claude/plugins/installed_plugins.json'),
    JSON.stringify({
      version: 2,
      plugins: {
        'plug-a@marketplace-a': [{ installPath: pluginA }],
        'plug-b@marketplace-b': [{ installPath: pluginB }],
        'plug-c@marketplace-c': [{ installPath: pluginC }],
      },
    }),
  )
})

afterAll(async () => {
  await rm(FAKE_HOME, { recursive: true, force: true }).catch(() => {})
})

describe('expandSlashCommand', () => {
  it('returns text unchanged when not a slash command', async () => {
    const out = await expandSlashCommand('hello world', PROJECT_CWD)
    expect(out).toBe('hello world')
  })

  it('returns text unchanged for built-in single-segment commands', async () => {
    const out = await expandSlashCommand('/clear', PROJECT_CWD)
    expect(out).toBe('/clear')
  })

  it('expands project-level command, stripping frontmatter and appending args', async () => {
    const out = await expandSlashCommand('/openspec:proposal build feature X', PROJECT_CWD)
    expect(out).toContain('Project body here.')
    expect(out).not.toContain('---')
    expect(out).toContain('## User arguments')
    expect(out).toContain('build feature X')
  })

  it('expands project command with no args (no User arguments section)', async () => {
    const out = await expandSlashCommand('/openspec:proposal', PROJECT_CWD)
    expect(stripMarker(out).trim()).toBe('Project body here.')
  })

  it('prefixes expanded output with OT_SLASH marker carrying cmd, args, original', async () => {
    const out = await expandSlashCommand('/openspec:proposal build feature X', PROJECT_CWD)
    const marker = decodeMarker(out)
    expect(marker).toEqual({
      cmd: '/openspec:proposal',
      args: 'build feature X',
      original: '/openspec:proposal build feature X',
    })
  })

  it('preserves marker round-trip for args containing special chars and unicode', async () => {
    const input = '/openspec:proposal IDE File 文件 "with quotes" --> tail'
    const out = await expandSlashCommand(input, PROJECT_CWD)
    const marker = decodeMarker(out)
    expect(marker?.args).toBe('IDE File 文件 "with quotes" --> tail')
    expect(marker?.original).toBe(input)
  })

  it('does not inject marker when command is not expanded', async () => {
    const out = await expandSlashCommand('/nonexistent:command args', PROJECT_CWD)
    expect(decodeMarker(out)).toBeNull()
  })

  it('falls back to user-level command and substitutes $ARGUMENTS', async () => {
    const out = await expandSlashCommand('/team:review PR-123', PROJECT_CWD)
    expect(out).toContain('Review the following:')
    expect(out).toContain('PR-123')
    expect(out).not.toContain('$ARGUMENTS')
  })

  it('expands plugin command via commands/ layout', async () => {
    const out = await expandSlashCommand('/plug-a:cmd', PROJECT_CWD)
    expect(out).toContain('Plugin A direct body.')
  })

  it('expands plugin command via .claude/commands/ layout', async () => {
    const out = await expandSlashCommand('/plug-b:cmd', PROJECT_CWD)
    expect(out).toContain('Plugin B dotted body.')
  })

  it('expands plugin skill via SKILL.md', async () => {
    const out = await expandSlashCommand('/plug-c:do-thing', PROJECT_CWD)
    expect(out).toContain('Skill C body.')
  })

  it('accepts slash separator equivalently', async () => {
    const out = await expandSlashCommand('/openspec/proposal', PROJECT_CWD)
    expect(out).toContain('Project body here.')
  })

  it('passes through unknown custom commands unchanged', async () => {
    const input = '/nonexistent:command some args'
    const out = await expandSlashCommand(input, PROJECT_CWD)
    expect(out).toBe(input)
  })

  it('project command wins over user command for same name', async () => {
    await writeFileAt(
      join(PROJECT_CWD, '.claude/commands/team/review.md'),
      'PROJECT review wins.',
    )
    const out = await expandSlashCommand('/team:review args', PROJECT_CWD)
    expect(out).toContain('PROJECT review wins.')
    expect(out).not.toContain('Review the following:')
  })
})
