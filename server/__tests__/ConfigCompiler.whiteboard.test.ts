import { describe, it, expect, beforeAll } from 'vitest'
import { readFile } from 'fs/promises'
import { join } from 'path'
import { SkillManager } from '../config/SkillManager'
import { HooksConfigManager } from '../runtime/HooksConfigManager'
import { ConfigCompiler } from '../runtime/ConfigCompiler'
import type { Agent } from '../config/types'

const ROOT = join(__dirname, '..', '..')
const BUILTIN_SKILLS_DIR = join(ROOT, 'ai-assets', 'skills')

function makeAgent(overrides: Partial<Agent> = {}): Agent {
  return {
    id: 'test-agent',
    name: 'test-agent',
    description: 'test',
    icon: '🤖',
    systemPrompt: { mode: 'append', content: 'Basic tips' },
    tags: [],
    source: 'builtin',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    ...overrides,
  }
}

describe('ConfigCompiler default injects whiteboard skill', () => {
  let compiler: ConfigCompiler

  beforeAll(async () => {
    const sm = new SkillManager(BUILTIN_SKILLS_DIR)
    await sm.loadBuiltinSkills()
    const hcm = new HooksConfigManager()
    compiler = new ConfigCompiler(sm, hcm, undefined, undefined, ROOT)
  })

  it('skills is empty → still injects whiteboard content', async () => {
    const agent = makeAgent({ skills: [] })
    const compiled = await compiler.compile(
      agent,
      {
        repositories: [{ path: ROOT }],
        serverPort: 3210,
        chatId: 'chat-x',
        instanceId: 'test-agent#1',
      },
      'claude',
    )
    const promptIdx = compiled.args.indexOf('--append-system-prompt')
    expect(promptIdx).toBeGreaterThanOrEqual(0)
    const prompt = compiled.args[promptIdx + 1]
    expect(prompt).toContain('whiteboard')
    expect(prompt).toContain('wb-write.sh')
    await compiled.cleanup()
  })

  it('skills already contains whiteboard → no duplicate injection', async () => {
    const agent = makeAgent({ skills: ['whiteboard'] })
    const compiled = await compiler.compile(
      agent,
      {
        repositories: [{ path: ROOT }],
        serverPort: 3210,
        chatId: 'chat-x',
        instanceId: 'test-agent#1',
      },
      'claude',
    )
    const promptIdx = compiled.args.indexOf('--append-system-prompt')
    const prompt = compiled.args[promptIdx + 1]
    const matches = prompt.match(/# War[- ]Room Write Instructions/g) || []
    expect(matches.length).toBe(1)
    await compiled.cleanup()
  })

  it('Placeholder {SKILL_DIR} is replaced with absolute path', async () => {
    const agent = makeAgent({ skills: [] })
    const compiled = await compiler.compile(
      agent,
      {
        repositories: [{ path: ROOT }],
        serverPort: 3210,
        chatId: 'chat-x',
        instanceId: 'test-agent#1',
      },
      'claude',
    )
    const promptIdx = compiled.args.indexOf('--append-system-prompt')
    const prompt = compiled.args[promptIdx + 1]
    expect(prompt).not.toContain('{SKILL_DIR}')
    expect(prompt).toMatch(/\/ai-assets\/skills\/whiteboard\/scripts\/wb-write\.sh/)
    await compiled.cleanup()
  })

  it('settings.json auto-injects war room stop hook (fallback mechanism)', async () => {
    const agent = makeAgent({ skills: [] })
    const compiled = await compiler.compile(
      agent,
      {
        repositories: [{ path: ROOT }],
        serverPort: 3210,
        chatId: 'chat-x',
        instanceId: 'test-agent#1',
      },
      'claude',
    )
    const settingsIdx = compiled.args.indexOf('--settings')
    expect(settingsIdx).toBeGreaterThanOrEqual(0)
    const settingsPath = compiled.args[settingsIdx + 1]
    const settings = JSON.parse(await readFile(settingsPath, 'utf-8'))
    expect(settings.hooks).toBeDefined()
    expect(settings.hooks.Stop).toBeDefined()
    const stopCmd = settings.hooks.Stop[0].hooks[0].command
    expect(stopCmd).toMatch(/wb-auto-extract\.sh/)

    expect(settings.hooks.PostToolUse).toBeDefined()
    const ptuCmd = settings.hooks.PostToolUse[0].hooks[0].command
    expect(ptuCmd).toMatch(/wb-cursor-diff\.sh/)

    await compiled.cleanup()
  })
})
