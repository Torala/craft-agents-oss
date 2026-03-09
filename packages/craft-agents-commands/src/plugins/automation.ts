import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import {
  AUTOMATIONS_HISTORY_FILE,
  generateShortId,
  parsePromptReferences,
  resolveAutomationsConfigPath,
  validateAutomations,
  validateAutomationsConfig,
} from '@craft-agent/shared/automations'
import { getCliDomainPolicy } from '@craft-agent/shared/config'
import type { PermissionMode } from '@craft-agent/shared/agent/mode-types'
import {
  assertKnownAction,
  parseBoolean,
  parseLabels,
  parseStructuredInput,
  parseTokens,
  usageError,
  validateActions,
  validatePermissionMode,
} from '../utils.ts'
import { ensureLabelsExist } from '@craft-agent/shared/labels/crud'
import type { CommandPlugin } from './types.ts'

interface NormalizedAutomationsConfig {
  version: number
  automations: Record<string, Record<string, unknown>[]>
}

interface HistoryEntry {
  id: string
  ts?: number
  ok?: boolean
  sessionId?: string
  prompt?: string
  error?: string
  [key: string]: unknown
}

const actions = [
  'list',
  'get',
  'create',
  'update',
  'delete',
  'validate',
  'enable',
  'disable',
  'duplicate',
  'history',
  'last-executed',
  'test',
  'lint',
] as const
const automationPolicy = getCliDomainPolicy('automation')

function loadAutomationsConfig(workspaceRootPath: string): NormalizedAutomationsConfig {
  const configPath = resolveAutomationsConfigPath(workspaceRootPath)
  if (!existsSync(configPath)) {
    return { version: 2, automations: {} }
  }

  let parsed: unknown
  try {
    parsed = JSON.parse(readFileSync(configPath, 'utf-8'))
  } catch (error) {
    usageError(
      `Failed to parse automations config at ${configPath}`,
      'Fix automations.json JSON syntax before using CLI',
      error instanceof Error ? error.message : String(error)
    )
  }

  const validation = validateAutomationsConfig(parsed)
  if (!validation.valid || !validation.config) {
    usageError('Automations config is invalid', 'Run: craft-agent automation validate', validation.errors)
  }

  const parsedVersion =
    parsed && typeof parsed === 'object' && 'version' in parsed && typeof (parsed as { version?: unknown }).version === 'number'
      ? (parsed as { version: number }).version
      : 2

  return {
    version: parsedVersion,
    automations: (validation.config.automations ?? {}) as Record<string, Record<string, unknown>[]>,
  }
}

function saveAutomationsConfig(workspaceRootPath: string, config: NormalizedAutomationsConfig): void {
  const payload = {
    version: config.version,
    automations: config.automations,
  }

  const validation = validateAutomationsConfig(payload)
  if (!validation.valid) {
    usageError('Refusing to write invalid automations config', 'Fix matcher/action fields and retry', validation.errors)
  }

  const configPath = resolveAutomationsConfigPath(workspaceRootPath)
  mkdirSync(dirname(configPath), { recursive: true })
  writeFileSync(configPath, `${JSON.stringify(payload, null, 2)}\n`, 'utf-8')
}

function findAutomationById(
  config: NormalizedAutomationsConfig,
  matcherId: string
): { event: string; index: number; matcher: Record<string, unknown> } | null {
  for (const [event, matchers] of Object.entries(config.automations)) {
    for (let i = 0; i < matchers.length; i++) {
      const matcher = matchers[i]
      if (matcher?.id === matcherId) {
        return { event, index: i, matcher }
      }
    }
  }
  return null
}

function buildAutomationMatcherInput(structured: Record<string, unknown>, options: Record<string, string | boolean>): Record<string, unknown> {
  const matcher: Record<string, unknown> = {}

  const name = structured.name ?? options.name
  const regexMatcher = structured.matcher ?? options.matcher
  const cron = structured.cron ?? options.cron
  const timezone = structured.timezone ?? options.timezone
  const permissionMode = structured.permissionMode ?? options['permission-mode']
  const enabled = parseBoolean((structured.enabled as string | boolean | undefined) ?? options.enabled, 'enabled')
  const labels = structured.labels ?? parseLabels(options.labels)

  if (name !== undefined) matcher.name = name
  if (regexMatcher !== undefined) matcher.matcher = regexMatcher
  if (cron !== undefined) matcher.cron = cron
  if (timezone !== undefined) matcher.timezone = timezone

  const validPermissionMode = validatePermissionMode(permissionMode)
  if (validPermissionMode !== undefined) matcher.permissionMode = validPermissionMode as PermissionMode

  if (enabled !== undefined) matcher.enabled = enabled
  if (labels !== undefined) matcher.labels = labels

  if (structured.actions !== undefined) {
    matcher.actions = validateActions(structured.actions)
  }

  const prompt = structured.prompt ?? options.prompt
  if (!matcher.actions && typeof prompt === 'string' && prompt.trim()) {
    const action: Record<string, unknown> = {
      type: 'prompt',
      prompt,
    }
    const llmConnection = structured.llmConnection ?? options['llm-connection']
    const model = structured.model ?? options.model
    if (typeof llmConnection === 'string' && llmConnection) {
      action.llmConnection = llmConnection
    }
    if (typeof model === 'string' && model) {
      action.model = model
    }
    matcher.actions = [action]
  }

  if (structured.id !== undefined) matcher.id = structured.id

  return matcher
}

function historyPath(workspaceRootPath: string): string {
  return join(workspaceRootPath, AUTOMATIONS_HISTORY_FILE)
}

function loadHistory(workspaceRootPath: string): HistoryEntry[] {
  const path = historyPath(workspaceRootPath)
  if (!existsSync(path)) return []

  const raw = readFileSync(path, 'utf-8')
  const rows: HistoryEntry[] = []
  for (const line of raw.split('\n')) {
    const trimmed = line.trim()
    if (!trimmed) continue
    try {
      const entry = JSON.parse(trimmed) as HistoryEntry
      if (typeof entry.id === 'string' && entry.id) {
        rows.push(entry)
      }
    } catch {
      // ignore malformed lines
    }
  }
  return rows
}

function flattenAutomations(config: NormalizedAutomationsConfig): Array<{ event: string; index: number; matcher: Record<string, unknown> }> {
  return Object.entries(config.automations).flatMap(([event, matchers]) =>
    matchers.map((matcher, index) => ({ event, index, matcher }))
  )
}

function lintAutomations(config: NormalizedAutomationsConfig): {
  valid: boolean
  issues: Array<{ id?: string; event: string; severity: 'error' | 'warning'; message: string }>
} {
  const issues: Array<{ id?: string; event: string; severity: 'error' | 'warning'; message: string }> = []

  for (const { event, matcher } of flattenAutomations(config)) {
    const id = typeof matcher.id === 'string' ? matcher.id : undefined

    if (event === 'SchedulerTick') {
      if (!matcher.cron || typeof matcher.cron !== 'string') {
        issues.push({ id, event, severity: 'error', message: 'SchedulerTick matcher is missing cron' })
      }
    }

    if (matcher.matcher && typeof matcher.matcher === 'string') {
      try {
        new RegExp(matcher.matcher)
      } catch (error) {
        issues.push({ id, event, severity: 'error', message: `Invalid regex: ${error instanceof Error ? error.message : String(error)}` })
      }
    }

    if (Array.isArray(matcher.actions)) {
      matcher.actions.forEach((action, idx) => {
        if (!action || typeof action !== 'object') return
        const prompt = (action as { prompt?: unknown }).prompt
        if (typeof prompt === 'string' && prompt.trim()) {
          const refs = parsePromptReferences(prompt)
          if (refs.mentions.length > 8) {
            issues.push({ id, event, severity: 'warning', message: `Action ${idx} prompt references many @mentions (${refs.mentions.length})` })
          }
        }
      })
    }

    if (!Array.isArray(matcher.actions) || matcher.actions.length === 0) {
      issues.push({ id, event, severity: 'error', message: 'Matcher must include at least one action' })
    }
  }

  return {
    valid: !issues.some(issue => issue.severity === 'error'),
    issues,
  }
}

export const automationPlugin: CommandPlugin = {
  namespace: 'automation',
  actions,
  docsMarker: 'automation',
  docsHeading: 'Automation',
  policy: {
    preToolGuards: {
      redirectHelpCommand: automationPolicy.helpCommand,
      workspacePathScopes: [...automationPolicy.workspacePathScopes],
    },
    exploreAllowlist: {
      readActions: [...automationPolicy.readActions],
      allowGlobalFlags: true,
    },
  },
  async execute(action, tokens, context) {
    assertKnownAction('automation', action, actions)

    const { positional, options } = parseTokens(tokens)
    const structured = parseStructuredInput(options)
    const workspaceRootPath = context.workspaceRootPath

    if (action === 'validate') {
      return validateAutomations(workspaceRootPath)
    }

    const config = loadAutomationsConfig(workspaceRootPath)

    if (action === 'list') {
      const flat = flattenAutomations(config).map(({ event, index, matcher }) => ({
        event,
        index,
        id: matcher.id,
        name: matcher.name,
        enabled: matcher.enabled !== false,
      }))

      return {
        version: config.version,
        automations: config.automations,
        flat,
      }
    }

    if (action === 'get') {
      const matcherId = positional[0]
      if (!matcherId) usageError('automation get requires <id>', 'Run: craft-agent automation get <id>')

      const found = findAutomationById(config, matcherId)
      if (!found) usageError(`Automation not found: ${matcherId}`)

      return { event: found.event, index: found.index, matcher: found.matcher }
    }

    if (action === 'create') {
      const event = (structured.event ?? options.event) as string | undefined
      if (!event) usageError('automation create requires --event <EventName>')

      const matcher = buildAutomationMatcherInput(structured, options)
      matcher.id = matcher.id ?? generateShortId()

      if (!matcher.actions) {
        usageError('automation create requires actions', 'Provide --prompt or --json/--stdin with actions')
      }

      if (Array.isArray(matcher.labels) && matcher.labels.length > 0) {
        const stringLabels = (matcher.labels as unknown[]).filter((l): l is string => typeof l === 'string')
        if (stringLabels.length > 0) {
          matcher.labels = ensureLabelsExist(workspaceRootPath, stringLabels)
        }
      }

      const list = config.automations[event] ?? []
      list.push(matcher)
      config.automations[event] = list
      saveAutomationsConfig(workspaceRootPath, config)

      return { event, matcher }
    }

    if (action === 'update') {
      const matcherId = positional[0]
      if (!matcherId) usageError('automation update requires <id>', 'Run: craft-agent automation update <id> --json "{...}"')

      const found = findAutomationById(config, matcherId)
      if (!found) usageError(`Automation not found: ${matcherId}`)

      const updates = buildAutomationMatcherInput(structured, options)
      const targetEvent = (structured.event ?? options.event ?? found.event) as string

      const merged: Record<string, unknown> = { ...found.matcher, ...updates, id: found.matcher.id ?? matcherId }

      if (!merged.actions || !Array.isArray(merged.actions) || merged.actions.length === 0) {
        usageError('Updated automation must contain at least one action')
      }

      if (Array.isArray(merged.labels) && merged.labels.length > 0) {
        const stringLabels = (merged.labels as unknown[]).filter((l): l is string => typeof l === 'string')
        if (stringLabels.length > 0) {
          merged.labels = ensureLabelsExist(workspaceRootPath, stringLabels)
        }
      }

      config.automations[found.event]!.splice(found.index, 1)
      if (config.automations[found.event]!.length === 0) {
        delete config.automations[found.event]
      }

      const targetMatchers = config.automations[targetEvent] ?? []
      targetMatchers.push(merged)
      config.automations[targetEvent] = targetMatchers

      saveAutomationsConfig(workspaceRootPath, config)
      return { event: targetEvent, matcher: merged }
    }

    if (action === 'delete') {
      const matcherId = positional[0]
      if (!matcherId) usageError('automation delete requires <id>', 'Run: craft-agent automation delete <id>')

      const found = findAutomationById(config, matcherId)
      if (!found) usageError(`Automation not found: ${matcherId}`)

      config.automations[found.event]!.splice(found.index, 1)
      if (config.automations[found.event]!.length === 0) {
        delete config.automations[found.event]
      }

      saveAutomationsConfig(workspaceRootPath, config)
      return { deleted: matcherId, event: found.event }
    }

    if (action === 'enable' || action === 'disable') {
      const matcherId = positional[0]
      if (!matcherId) usageError(`automation ${action} requires <id>`, `Run: craft-agent automation ${action} <id>`)

      const found = findAutomationById(config, matcherId)
      if (!found) usageError(`Automation not found: ${matcherId}`)

      found.matcher.enabled = action === 'enable'
      config.automations[found.event]![found.index] = found.matcher
      saveAutomationsConfig(workspaceRootPath, config)

      return { id: matcherId, event: found.event, enabled: found.matcher.enabled !== false }
    }

    if (action === 'duplicate') {
      const matcherId = positional[0]
      if (!matcherId) usageError('automation duplicate requires <id>', 'Run: craft-agent automation duplicate <id>')

      const found = findAutomationById(config, matcherId)
      if (!found) usageError(`Automation not found: ${matcherId}`)

      const clone: Record<string, unknown> = {
        ...found.matcher,
        id: generateShortId(),
        name:
          typeof found.matcher.name === 'string' && found.matcher.name.trim()
            ? `${found.matcher.name} (copy)`
            : undefined,
      }

      const list = config.automations[found.event] ?? []
      list.push(clone)
      config.automations[found.event] = list
      saveAutomationsConfig(workspaceRootPath, config)

      return { originalId: matcherId, duplicated: clone, event: found.event }
    }

    if (action === 'history') {
      const matcherId = positional[0]
      const limitRaw = (structured.limit ?? options.limit) as string | number | undefined
      const limit = typeof limitRaw === 'number' ? limitRaw : typeof limitRaw === 'string' ? Number.parseInt(limitRaw, 10) : 20

      const all = loadHistory(workspaceRootPath)
      const filtered = matcherId ? all.filter(row => row.id === matcherId) : all
      const bounded = filtered.slice(-Math.max(1, Number.isFinite(limit) ? limit : 20))

      return {
        matcherId: matcherId ?? null,
        count: bounded.length,
        history: bounded,
      }
    }

    if (action === 'last-executed') {
      const matcherId = positional[0]
      if (!matcherId) usageError('automation last-executed requires <id>', 'Run: craft-agent automation last-executed <id>')

      const entries = loadHistory(workspaceRootPath)
        .filter(row => row.id === matcherId)
        .sort((a, b) => (a.ts ?? 0) - (b.ts ?? 0))

      const last = entries.at(-1) ?? null
      return {
        id: matcherId,
        lastExecuted: last,
        executions: entries.length,
      }
    }

    if (action === 'test') {
      const matcherId = positional[0]
      if (!matcherId) usageError('automation test requires <id>', 'Run: craft-agent automation test <id> --match "text"')

      const found = findAutomationById(config, matcherId)
      if (!found) usageError(`Automation not found: ${matcherId}`)

      const matchText = (structured.match ?? options.match ?? '') as string
      const matcherPattern = found.matcher.matcher

      let matched = true
      if (typeof matcherPattern === 'string' && matcherPattern) {
        try {
          matched = new RegExp(matcherPattern).test(matchText)
        } catch (error) {
          usageError(
            `Invalid matcher regex on automation ${matcherId}`,
            'Run: craft-agent automation lint to inspect matcher issues',
            error instanceof Error ? error.message : String(error)
          )
        }
      }

      const actions = Array.isArray(found.matcher.actions) ? found.matcher.actions : []
      const promptMentions = actions
        .filter(a => a && typeof a === 'object' && (a as { type?: unknown }).type === 'prompt')
        .map(a => {
          const prompt = (a as { prompt?: unknown }).prompt
          return typeof prompt === 'string' ? parsePromptReferences(prompt).mentions : []
        })

      return {
        id: matcherId,
        event: found.event,
        matcher: found.matcher,
        input: matchText,
        matched,
        enabled: found.matcher.enabled !== false,
        promptMentions,
      }
    }

    if (action === 'lint') {
      const lint = lintAutomations(config)
      return {
        valid: lint.valid,
        issueCount: lint.issues.length,
        issues: lint.issues,
      }
    }

    usageError(`Unhandled automation action: ${action}`)
  },
}
