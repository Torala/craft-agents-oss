import { describe, it, expect } from 'bun:test'
import { resolve } from 'node:path'

function runCli(args: string[]) {
  const cliPath = resolve(import.meta.dir, 'cli.ts')
  const docPath = resolve(import.meta.dir, '../../../apps/electron/resources/docs/craft-cli.md')

  const proc = Bun.spawnSync({
    cmd: ['bun', 'run', cliPath, ...args],
    env: {
      ...process.env,
      CRAFT_CLI_DOC_PATH: docPath,
      CRAFT_WORKSPACE_PATH: process.cwd(),
    },
    stdout: 'pipe',
    stderr: 'pipe',
  })

  const stdout = proc.stdout.toString('utf-8').trim()
  const stderr = proc.stderr.toString('utf-8').trim()

  let json: any = null
  try {
    json = JSON.parse(stdout)
  } catch {
    // Keep json null for assertion diagnostics
  }

  return { exitCode: proc.exitCode, stdout, stderr, json }
}

describe('craft-agent help sections', () => {
  it('label help returns relevant label section markdown', () => {
    const result = runCli(['label', '--help'])

    expect(result.exitCode).toBe(0)
    expect(result.json?.ok).toBe(true)
    expect(typeof result.json?.data?.label?.markdown).toBe('string')
    expect(result.json.data.label.markdown).toContain('## Label')
    expect(result.json.data.label.markdown).toContain('craft-agent label list')
  })

  it('automation help returns relevant automation section markdown', () => {
    const result = runCli(['automation', '--help'])

    expect(result.exitCode).toBe(0)
    expect(result.json?.ok).toBe(true)
    expect(typeof result.json?.data?.automation?.markdown).toBe('string')
    expect(result.json.data.automation.markdown).toContain('## Automation')
    expect(result.json.data.automation.markdown).toContain('craft-agent automation validate')
  })

  it('source help returns relevant source section markdown', () => {
    const result = runCli(['source', '--help'])

    expect(result.exitCode).toBe(0)
    expect(result.json?.ok).toBe(true)
    expect(typeof result.json?.data?.source?.markdown).toBe('string')
    expect(result.json.data.source.markdown).toContain('## Source')
    expect(result.json.data.source.markdown).toContain('craft-agent source list')
  })

  it('skill help returns relevant skill section markdown', () => {
    const result = runCli(['skill', '--help'])

    expect(result.exitCode).toBe(0)
    expect(result.json?.ok).toBe(true)
    expect(typeof result.json?.data?.skill?.markdown).toBe('string')
    expect(result.json.data.skill.markdown).toContain('## Skill')
    expect(result.json.data.skill.markdown).toContain('craft-agent skill list')
  })

  it('every discoverable entity returns a dedicated help section', () => {
    const discover = runCli(['--discover'])
    expect(discover.exitCode).toBe(0)
    expect(discover.json?.ok).toBe(true)

    const entities: string[] = (discover.json?.data?.builtin ?? []).map((entry: any) => entry.entity)
    expect(entities.length).toBeGreaterThan(0)

    for (const entity of entities) {
      const help = runCli([entity, '--help'])
      expect(help.exitCode).toBe(0)
      expect(help.json?.ok).toBe(true)
      expect(typeof help.json?.data?.[entity]?.markdown).toBe('string')
      expect(help.json.data[entity].markdown.length).toBeGreaterThan(40)
    }
  })
})
