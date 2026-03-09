#!/usr/bin/env bun

import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { getPlugin, commandPlugins } from './plugins/registry.ts'
import {
  type CliEnvelope,
  type CliExit,
  getEntityDocSection,
  getWorkspacePath,
  normalizeError,
  resolveCommandsDocPath,
  usageError,
} from './utils.ts'

function printEnvelope(envelope: CliEnvelope, exitCode: CliExit): never {
  process.stdout.write(`${JSON.stringify(envelope)}\n`)
  process.exit(exitCode)
}

function success(data: unknown, warnings: string[] = []): never {
  printEnvelope({ ok: true, data, warnings }, 0)
}

function fail(error: { code: string; message: string; suggestion?: string; details?: unknown }, exitCode: CliExit): never {
  printEnvelope({ ok: false, error, warnings: [] }, exitCode)
}

function readVersionFromPackage(path: string): string | null {
  try {
    const parsed = JSON.parse(readFileSync(path, 'utf-8')) as { version?: unknown }
    if (typeof parsed.version === 'string' && parsed.version.trim()) {
      return parsed.version.trim()
    }
  } catch {
    // ignore and fall through
  }
  return null
}

function getCliVersion(): string {
  const envVersion = process.env.CRAFT_AGENT_VERSION?.trim()
  if (envVersion) return envVersion

  const moduleDir = dirname(fileURLToPath(import.meta.url))
  const appRoot = process.env.CRAFT_APP_ROOT?.trim()
  const candidates = [
    join(moduleDir, '..', 'package.json'),
    join(moduleDir, '..', '..', 'craft-cli', 'package.json'),
    join(moduleDir, '..', '..', '..', 'package.json'),
    ...(appRoot
      ? [
          join(appRoot, 'packages', 'craft-agents-commands', 'package.json'),
          join(appRoot, 'packages', 'craft-cli', 'package.json'),
          join(appRoot, 'package.json'),
        ]
      : []),
    join(process.cwd(), 'packages', 'craft-agents-commands', 'package.json'),
    join(process.cwd(), 'packages', 'craft-cli', 'package.json'),
    join(process.cwd(), 'package.json'),
  ]

  for (const candidate of candidates) {
    const version = readVersionFromPackage(candidate)
    if (version) return version
  }

  return '0.0.0'
}

function getReadOnlyActions(actions: readonly string[], readActions: readonly string[] | undefined): string[] {
  const readSet = new Set(readActions ?? [])
  return actions.filter(action => readSet.has(action))
}

function buildActionDetails(namespace: string, actions: readonly string[], readActions: readonly string[] | undefined) {
  const readSet = new Set(readActions ?? [])
  return actions.map(action => ({
    action,
    readOnly: readSet.has(action),
    mode: readSet.has(action) ? 'read' : 'mutate',
    usage: `craft-agent ${namespace} ${action}`,
  }))
}

function buildHelpData(namespace?: string): Record<string, unknown> {
  const docsPath = resolveCommandsDocPath()
  const global = {
    usage: 'craft-agent <namespace> <action> [args] [--flags] [--json <json> | --stdin]',
    namespaces: commandPlugins.map(plugin => plugin.namespace),
    globals: ['--help', '--version', '--discover'],
    docs: {
      command: 'craft-agent <namespace> --help',
      ...(docsPath ? { sourcePath: docsPath } : { sourcePath: '~/.craft-agent/docs/craft-cli.md' }),
    },
  }

  if (!namespace) return global

  const plugin = getPlugin(namespace)
  if (!plugin) return global

  const section = getEntityDocSection(plugin.docsMarker, plugin.docsHeading)

  return {
    ...global,
    [namespace]: {
      actions: plugin.actions,
      actionDetails: buildActionDetails(plugin.namespace, plugin.actions, plugin.policy?.exploreAllowlist?.readActions),
      ...(section.markdown ? { markdown: section.markdown } : {}),
      ...(section.sourcePath ? { sourcePath: section.sourcePath } : {}),
      ...(section.warning ? { warning: section.warning } : {}),
      ...(plugin.policy ? { policy: plugin.policy } : {}),
    },
  }
}

function buildDiscoverData(): Record<string, unknown> {
  return {
    builtin: commandPlugins.map(plugin => ({
      entity: plugin.namespace,
      commands: [...plugin.actions],
      namespace: plugin.namespace,
      actions: [...plugin.actions],
      readOnlyActions: getReadOnlyActions(plugin.actions, plugin.policy?.exploreAllowlist?.readActions),
      actionDetails: buildActionDetails(plugin.namespace, plugin.actions, plugin.policy?.exploreAllowlist?.readActions),
      policy: plugin.policy,
    })),
    user: [],
    path: [],
  }
}

export async function runCli(argv: string[] = process.argv.slice(2)): Promise<never> {
  const first = argv[0]

  if (!first || first === '--help') {
    success(buildHelpData())
  }

  if (first === '--version') {
    success({ version: getCliVersion() })
  }

  if (first === '--discover') {
    success(buildDiscoverData())
  }

  const namespace = first
  const action = argv[1]

  if (!action || action === '--help') {
    success(buildHelpData(namespace))
  }

  const plugin = getPlugin(namespace)
  if (!plugin) {
    usageError(`Unknown namespace: ${namespace}`, 'Run: craft-agent --help')
  }

  const workspaceRootPath = getWorkspacePath()
  const data = await plugin.execute(action!, argv.slice(2), { workspaceRootPath })
  success(data)
}

if (import.meta.main) {
  runCli().catch((error) => {
    const { envelope, exitCode } = normalizeError(error)
    fail(envelope.error, exitCode)
  })
}
