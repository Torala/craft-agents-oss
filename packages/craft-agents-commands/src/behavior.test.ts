import { describe, expect, it } from 'bun:test'
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

interface CliResult {
  exitCode: number
  stdout: string
  stderr: string
  json: any
}

function runCli(args: string[], workspaceRoot: string, extraEnv: Record<string, string> = {}): CliResult {
  const cliPath = resolve(import.meta.dir, 'main.ts')
  const docPath = resolve(import.meta.dir, '../../../apps/electron/resources/docs/craft-cli.md')

  const proc = Bun.spawnSync({
    cmd: ['bun', 'run', cliPath, ...args],
    env: {
      ...process.env,
      CRAFT_WORKSPACE_PATH: workspaceRoot,
      CRAFT_COMMANDS_DOC_PATH: docPath,
      CRAFT_CLI_DOC_PATH: docPath,
      ...extraEnv,
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
    json = null
  }

  return {
    exitCode: proc.exitCode,
    stdout,
    stderr,
    json,
  }
}

function createWorkspaceFixture(): string {
  const root = mkdtempSync(join(tmpdir(), 'craft-commands-'))
  mkdirSync(join(root, 'sources'), { recursive: true })
  mkdirSync(join(root, 'skills'), { recursive: true })
  writeFileSync(join(root, 'automations.json'), JSON.stringify({ version: 2, automations: {} }, null, 2))
  writeFileSync(join(root, 'config.json'), JSON.stringify({ id: 'ws-test', name: 'Test Workspace' }, null, 2))
  return root
}

function createConfigFixture(): string {
  const configDir = mkdtempSync(join(tmpdir(), 'craft-config-'))
  writeFileSync(join(configDir, 'config.json'), JSON.stringify({
    workspaces: [],
    activeWorkspaceId: null,
    activeSessionId: null,
    colorTheme: 'default',
  }, null, 2))

  mkdirSync(join(configDir, 'themes'), { recursive: true })
  writeFileSync(join(configDir, 'themes', 'nord.json'), JSON.stringify({
    name: 'Nord',
    accent: '#88c0d0',
    background: '#2e3440',
  }, null, 2))

  return configDir
}

describe('craft-agents-commands behavior', () => {
  it('source create/update/validate/test/delete flow works with immutability checks', () => {
    const ws = createWorkspaceFixture()

    const create = runCli([
      'source',
      'create',
      '--name',
      'Local Docs',
      '--provider',
      'filesystem',
      '--type',
      'local',
      '--path',
      ws,
      '--icon',
      '📁',
    ], ws)
    expect(create.exitCode).toBe(0)
    const slug = create.json?.data?.source?.config?.slug as string
    expect(typeof slug).toBe('string')

    const update = runCli([
      'source',
      'update',
      slug,
      '--json',
      JSON.stringify({ enabled: false }),
    ], ws)
    expect(update.exitCode).toBe(0)
    expect(update.json?.data?.source?.config?.enabled).toBe(false)

    const immutableReject = runCli([
      'source',
      'update',
      slug,
      '--json',
      JSON.stringify({ slug: 'nope' }),
    ], ws)
    expect(immutableReject.exitCode).toBe(2)
    expect(immutableReject.json?.error?.message).toContain('cannot change slug')

    const validate = runCli(['source', 'validate', slug], ws)
    expect(validate.exitCode).toBe(0)
    expect(validate.json?.data?.valid).toBe(true)
    expect(Array.isArray(validate.json?.data?.warnings)).toBe(true)

    const test = runCli(['source', 'test', slug], ws)
    expect(test.exitCode).toBe(0)
    expect(Array.isArray(test.json?.data?.checks)).toBe(true)
    expect(Array.isArray(test.json?.data?.limitations)).toBe(true)

    const del = runCli(['source', 'delete', slug], ws)
    expect(del.exitCode).toBe(0)
    expect(del.json?.data?.deleted).toBe(slug)
  })

  it('skill update is transactional and does not persist invalid content', () => {
    const ws = createWorkspaceFixture()

    const create = runCli([
      'skill',
      'create',
      '--name',
      'Commit Helper',
      '--description',
      'Helps with commits',
      '--slug',
      'commit-helper',
      '--body',
      'Use concise commit messages.',
    ], ws)
    expect(create.exitCode).toBe(0)

    const skillPath = join(ws, 'skills', 'commit-helper', 'SKILL.md')
    const before = readFileSync(skillPath, 'utf-8')

    const invalidUpdate = runCli([
      'skill',
      'update',
      'commit-helper',
      '--json',
      JSON.stringify({ description: '' }),
    ], ws)

    expect(invalidUpdate.exitCode).toBe(2)
    const after = readFileSync(skillPath, 'utf-8')
    expect(after).toBe(before)
  })

  it('automation operational actions work across create/enable/disable/duplicate/test/lint', () => {
    const ws = createWorkspaceFixture()

    const create = runCli([
      'automation',
      'create',
      '--event',
      'UserPromptSubmit',
      '--prompt',
      'Summarize @linear updates',
    ], ws)
    expect(create.exitCode).toBe(0)

    const id = create.json?.data?.matcher?.id as string
    expect(typeof id).toBe('string')

    const disable = runCli(['automation', 'disable', id], ws)
    expect(disable.exitCode).toBe(0)
    expect(disable.json?.data?.enabled).toBe(false)

    const enable = runCli(['automation', 'enable', id], ws)
    expect(enable.exitCode).toBe(0)
    expect(enable.json?.data?.enabled).toBe(true)

    const duplicate = runCli(['automation', 'duplicate', id], ws)
    expect(duplicate.exitCode).toBe(0)
    expect(duplicate.json?.data?.duplicated?.id).toBeTruthy()

    const test = runCli(['automation', 'test', id, '--match', 'UserPromptSubmit'], ws)
    expect(test.exitCode).toBe(0)
    expect(test.json?.data?.matched).toBe(true)

    const lint = runCli(['automation', 'lint'], ws)
    expect(lint.exitCode).toBe(0)
    expect(typeof lint.json?.data?.valid).toBe('boolean')
  })

  it('automation update accepts prompt shorthand in --json payload', () => {
    const ws = createWorkspaceFixture()

    const create = runCli([
      'automation',
      'create',
      '--event',
      'UserPromptSubmit',
      '--prompt',
      'Initial prompt',
    ], ws)
    expect(create.exitCode).toBe(0)

    const id = create.json?.data?.matcher?.id as string
    const update = runCli([
      'automation',
      'update',
      id,
      '--json',
      JSON.stringify({ prompt: 'Updated prompt from json payload' }),
    ], ws)

    expect(update.exitCode).toBe(0)
    expect(update.json?.data?.matcher?.actions?.[0]?.prompt).toBe('Updated prompt from json payload')
  })

  it('skill validate returns usage error when skill is missing', () => {
    const ws = createWorkspaceFixture()
    const result = runCli(['skill', 'validate', 'does-not-exist'], ws)

    expect(result.exitCode).toBe(2)
    expect(result.json?.ok).toBe(false)
    expect(result.json?.error?.message).toContain('Skill not found')
  })

  it('json-only mode suppresses debug/perf stderr noise', () => {
    const ws = createWorkspaceFixture()

    const create = runCli([
      'source',
      'create',
      '--name',
      'Json Only Source',
      '--provider',
      'filesystem',
      '--type',
      'local',
      '--path',
      ws,
    ], ws, {
      CRAFT_DEBUG: '1',
      CRAFT_CLI_JSON_ONLY: '1',
    })

    expect(create.exitCode).toBe(0)
    expect(create.stderr).toBe('')
  })

  it('label auto-rule commands manage regex rules end-to-end', () => {
    const ws = createWorkspaceFixture()

    const create = runCli(['label', 'create', '--name', 'Linear Issue'], ws)
    expect(create.exitCode).toBe(0)
    const id = create.json?.data?.label?.id as string

    const add = runCli([
      'label',
      'auto-rule-add',
      id,
      '--pattern',
      '\\b([A-Z]{2,5}-\\d+)\\b',
      '--value-template',
      '$1',
      '--description',
      'Issue key matcher',
    ], ws)
    expect(add.exitCode).toBe(0)
    expect(add.json?.data?.autoRules?.length).toBe(1)

    const list = runCli(['label', 'auto-rule-list', id], ws)
    expect(list.exitCode).toBe(0)
    expect(list.json?.data?.autoRules?.[0]?.pattern).toBe('\\b([A-Z]{2,5}-\\d+)\\b')

    const validate = runCli(['label', 'auto-rule-validate', id], ws)
    expect(validate.exitCode).toBe(0)
    expect(Array.isArray(validate.json?.data?.issues)).toBe(true)

    const remove = runCli(['label', 'auto-rule-remove', id, '--index', '0'], ws)
    expect(remove.exitCode).toBe(0)
    expect(remove.json?.data?.autoRules?.length).toBe(0)
  })

  it('source helper commands scaffold guide and permissions and provide auth help', () => {
    const ws = createWorkspaceFixture()

    const create = runCli([
      'source',
      'create',
      '--name',
      'Linear',
      '--provider',
      'linear',
      '--type',
      'mcp',
      '--json',
      JSON.stringify({ mcp: { transport: 'http', url: 'https://mcp.linear.app/sse', authType: 'oauth' } }),
    ], ws)
    expect(create.exitCode).toBe(0)
    const slug = create.json?.data?.source?.config?.slug as string

    const initGuide = runCli(['source', 'init-guide', slug, '--template', 'mcp'], ws)
    expect(initGuide.exitCode).toBe(0)
    expect(initGuide.json?.data?.template).toBe('mcp')

    const initPermissions = runCli(['source', 'init-permissions', slug], ws)
    expect(initPermissions.exitCode).toBe(0)
    expect(initPermissions.json?.data?.valid).toBe(true)

    const authHelp = runCli(['source', 'auth-help', slug], ws)
    expect(authHelp.exitCode).toBe(0)
    expect(authHelp.json?.data?.auth?.recommendedTool).toContain('source_oauth_trigger')
  })

  it('theme commands manage app defaults, workspace overrides, and theme.json overrides', () => {
    const ws = createWorkspaceFixture()
    const configDir = createConfigFixture()

    const list = runCli(['theme', 'list-presets'], ws, { CRAFT_CONFIG_DIR: configDir })
    expect(list.exitCode).toBe(0)
    expect(Array.isArray(list.json?.data?.presets)).toBe(true)
    expect(list.json?.data?.presets?.some((preset: any) => preset.id === 'nord')).toBe(true)

    const setColor = runCli(['theme', 'set-color-theme', 'nord'], ws, { CRAFT_CONFIG_DIR: configDir })
    expect(setColor.exitCode).toBe(0)
    expect(setColor.json?.data?.colorTheme).toBe('nord')

    const setWorkspace = runCli(['theme', 'set-workspace-color-theme', 'nord'], ws, { CRAFT_CONFIG_DIR: configDir })
    expect(setWorkspace.exitCode).toBe(0)
    expect(setWorkspace.json?.data?.workspaceColorTheme).toBe('nord')

    const get = runCli(['theme', 'get'], ws, { CRAFT_CONFIG_DIR: configDir })
    expect(get.exitCode).toBe(0)
    expect(get.json?.data?.colorTheme).toBe('nord')
    expect(get.json?.data?.workspaceColorTheme).toBe('nord')
    expect(get.json?.data?.effectiveWorkspaceTheme).toBe('nord')

    const setOverride = runCli([
      'theme',
      'set-override',
      '--json',
      JSON.stringify({ accent: '#3b82f6', dark: { accent: '#60a5fa' } }),
    ], ws, { CRAFT_CONFIG_DIR: configDir })
    expect(setOverride.exitCode).toBe(0)
    expect(setOverride.json?.data?.appOverride?.accent).toBe('#3b82f6')

    const validate = runCli(['theme', 'validate'], ws, { CRAFT_CONFIG_DIR: configDir })
    expect(validate.exitCode).toBe(0)
    expect(validate.json?.data?.target).toBe('app-override')
    expect(validate.json?.data?.valid).toBe(true)

    const resetWorkspace = runCli(['theme', 'set-workspace-color-theme', 'default'], ws, { CRAFT_CONFIG_DIR: configDir })
    expect(resetWorkspace.exitCode).toBe(0)
    expect(resetWorkspace.json?.data?.workspaceColorTheme).toBe(null)

    const resetOverride = runCli(['theme', 'reset-override'], ws, { CRAFT_CONFIG_DIR: configDir })
    expect(resetOverride.exitCode).toBe(0)
    expect(resetOverride.json?.data?.reset).toBe(true)

    const invalidOverride = runCli([
      'theme',
      'set-override',
      '--json',
      JSON.stringify({ nope: '#fff' }),
    ], ws, { CRAFT_CONFIG_DIR: configDir })
    expect(invalidOverride.exitCode).toBe(2)
    expect(invalidOverride.json?.error?.message).toContain('Theme override is invalid')
  })
})
