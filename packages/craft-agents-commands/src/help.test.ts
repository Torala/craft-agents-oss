import { describe, it, expect } from 'bun:test'
import { resolve } from 'node:path'

function runCommands(args: string[], extraEnv: Record<string, string> = {}) {
  const entryPath = resolve(import.meta.dir, 'main.ts')
  const docPath = resolve(import.meta.dir, '../../../apps/electron/resources/docs/craft-cli.md')

  const proc = Bun.spawnSync({
    cmd: ['bun', 'run', entryPath, ...args],
    env: {
      ...process.env,
      CRAFT_COMMANDS_DOC_PATH: docPath,
      CRAFT_WORKSPACE_PATH: process.cwd(),
      ...extraEnv,
    },
    stdout: 'pipe',
    stderr: 'pipe',
  })

  const stdout = proc.stdout.toString('utf-8').trim()

  let json: any = null
  try {
    json = JSON.parse(stdout)
  } catch {
    // keep null for assertions
  }

  return { exitCode: proc.exitCode, stdout, json }
}

describe('craft-agents-commands help sections', () => {
  it('label help returns relevant section markdown', () => {
    const result = runCommands(['label', '--help'])

    expect(result.exitCode).toBe(0)
    expect(result.json?.ok).toBe(true)
    expect(typeof result.json?.data?.label?.markdown).toBe('string')
    expect(result.json.data.label.markdown).toContain('## Label')
    expect(result.json.data.label.markdown).toContain('craft-agent label list')
  })

  it('automation help returns relevant section markdown', () => {
    const result = runCommands(['automation', '--help'])

    expect(result.exitCode).toBe(0)
    expect(result.json?.ok).toBe(true)
    expect(typeof result.json?.data?.automation?.markdown).toBe('string')
    expect(result.json.data.automation.markdown).toContain('## Automation')
    expect(result.json.data.automation.markdown).toContain('craft-agent automation validate')
  })

  it('source help returns relevant section markdown', () => {
    const result = runCommands(['source', '--help'])

    expect(result.exitCode).toBe(0)
    expect(result.json?.ok).toBe(true)
    expect(typeof result.json?.data?.source?.markdown).toBe('string')
    expect(result.json.data.source.markdown).toContain('## Source')
    expect(result.json.data.source.markdown).toContain('craft-agent source list')
  })

  it('skill help returns relevant section markdown', () => {
    const result = runCommands(['skill', '--help'])

    expect(result.exitCode).toBe(0)
    expect(result.json?.ok).toBe(true)
    expect(typeof result.json?.data?.skill?.markdown).toBe('string')
    expect(result.json.data.skill.markdown).toContain('## Skill')
    expect(result.json.data.skill.markdown).toContain('craft-agent skill list')
  })

  it('theme help returns relevant section markdown', () => {
    const result = runCommands(['theme', '--help'])

    expect(result.exitCode).toBe(0)
    expect(result.json?.ok).toBe(true)
    expect(typeof result.json?.data?.theme?.markdown).toBe('string')
    expect(result.json.data.theme.markdown).toContain('## Theme')
    expect(result.json.data.theme.markdown).toContain('craft-agent theme get')
  })

  it('discover output includes compatibility entity field and plugin metadata', () => {
    const result = runCommands(['--discover'])

    expect(result.exitCode).toBe(0)
    expect(result.json?.ok).toBe(true)

    const builtin = result.json?.data?.builtin ?? []
    expect(Array.isArray(builtin)).toBe(true)

    const labelEntry = builtin.find((entry: any) => entry.entity === 'label')
    expect(labelEntry).toBeTruthy()
    expect(Array.isArray(labelEntry.commands)).toBe(true)
    expect(labelEntry.namespace).toBe('label')
    expect(Array.isArray(labelEntry.actions)).toBe(true)
    expect(Array.isArray(labelEntry.readOnlyActions)).toBe(true)
    expect(labelEntry.readOnlyActions).toContain('list')
    expect(labelEntry.readOnlyActions).toContain('get')
    expect(labelEntry.readOnlyActions).not.toContain('create')
  })

  it('--version prefers CRAFT_AGENT_VERSION when provided', () => {
    const result = runCommands(['--version'], { CRAFT_AGENT_VERSION: '9.9.9-test' })

    expect(result.exitCode).toBe(0)
    expect(result.json?.ok).toBe(true)
    expect(result.json?.data?.version).toBe('9.9.9-test')
  })
})
