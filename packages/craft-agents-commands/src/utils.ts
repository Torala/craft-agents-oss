import { existsSync, readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'

export interface CliOk {
  ok: true
  data: unknown
  warnings: string[]
}

export interface CliErr {
  ok: false
  error: {
    code: string
    message: string
    suggestion?: string
    details?: unknown
  }
  warnings: string[]
}

export type CliEnvelope = CliOk | CliErr
export type CliExit = 0 | 1 | 2
export type OptionValue = string | boolean

export interface ParsedTokens {
  positional: string[]
  options: Record<string, OptionValue>
}

export class CliError extends Error {
  readonly code: string
  readonly exitCode: CliExit
  readonly suggestion?: string
  readonly details?: unknown

  constructor(code: string, message: string, exitCode: CliExit, suggestion?: string, details?: unknown) {
    super(message)
    this.code = code
    this.exitCode = exitCode
    this.suggestion = suggestion
    this.details = details
  }
}

export function usageError(message: string, suggestion?: string, details?: unknown): never {
  throw new CliError('USAGE_ERROR', message, 2, suggestion, details)
}

export function execError(message: string, suggestion?: string, details?: unknown): never {
  throw new CliError('EXEC_ERROR', message, 1, suggestion, details)
}

export function normalizeError(error: unknown): { envelope: CliErr; exitCode: CliExit } {
  if (error instanceof CliError) {
    return {
      envelope: {
        ok: false,
        error: {
          code: error.code,
          message: error.message,
          suggestion: error.suggestion,
          details: error.details,
        },
        warnings: [],
      },
      exitCode: error.exitCode,
    }
  }

  const message = error instanceof Error ? error.message : String(error)
  return {
    envelope: {
      ok: false,
      error: {
        code: 'EXEC_ERROR',
        message,
      },
      warnings: [],
    },
    exitCode: 1,
  }
}

export function parseTokens(tokens: string[]): ParsedTokens {
  const positional: string[] = []
  const options: Record<string, OptionValue> = {}

  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i]
    if (!token) continue

    if (!token.startsWith('--')) {
      positional.push(token)
      continue
    }

    const key = token.slice(2)
    if (!key) {
      usageError('Invalid empty option name', 'Use --help for usage examples')
    }

    const next = tokens[i + 1]
    if (!next || next.startsWith('--')) {
      options[key] = true
      continue
    }

    options[key] = next
    i++
  }

  return { positional, options }
}

export function getWorkspacePath(): string {
  const fromEnv = process.env.CRAFT_WORKSPACE_PATH
  if (fromEnv && fromEnv.trim()) return fromEnv.trim()
  return process.cwd()
}

function readStdinIfNeeded(options: Record<string, OptionValue>): unknown {
  if (!options.stdin) return undefined
  const raw = readFileSync(0, 'utf-8').trim()
  if (!raw) usageError('--stdin was provided but stdin is empty', 'Pipe valid JSON into stdin')

  try {
    return JSON.parse(raw)
  } catch (error) {
    usageError(
      'Invalid JSON provided via --stdin',
      'Ensure stdin contains a valid JSON object',
      error instanceof Error ? error.message : String(error)
    )
  }
}

function readJsonOption(options: Record<string, OptionValue>): unknown {
  const value = options.json
  if (value === undefined) return undefined
  if (typeof value !== 'string') usageError('--json requires a JSON string value')

  try {
    return JSON.parse(value)
  } catch (error) {
    usageError(
      'Invalid JSON in --json option',
      'Wrap JSON in single quotes and ensure it is valid JSON',
      error instanceof Error ? error.message : String(error)
    )
  }
}

export function parseStructuredInput(options: Record<string, OptionValue>): Record<string, unknown> {
  if (options.stdin && options.json !== undefined) {
    usageError('Use either --stdin or --json, not both')
  }

  const jsonObj = readJsonOption(options)
  const stdinObj = readStdinIfNeeded(options)

  if (jsonObj !== undefined) {
    if (!jsonObj || typeof jsonObj !== 'object' || Array.isArray(jsonObj)) {
      usageError('--json must contain a JSON object')
    }
    return jsonObj as Record<string, unknown>
  }

  if (stdinObj !== undefined) {
    if (!stdinObj || typeof stdinObj !== 'object' || Array.isArray(stdinObj)) {
      usageError('--stdin must contain a JSON object')
    }
    return stdinObj as Record<string, unknown>
  }

  return {}
}

export function parseBoolean(value: OptionValue | undefined, key: string): boolean | undefined {
  if (value === undefined) return undefined
  if (typeof value === 'boolean') return value

  const normalized = value.toLowerCase()
  if (normalized === 'true') return true
  if (normalized === 'false') return false

  usageError(`Option --${key} must be true or false`, `Received: ${value}`)
}

export function parseNullableParent(value: OptionValue | undefined): string | null | undefined {
  if (value === undefined) return undefined
  if (typeof value !== 'string') return null
  const normalized = value.trim().toLowerCase()
  if (!normalized || normalized === 'root' || normalized === 'null') return null
  return value
}

export function parseLabels(value: OptionValue | undefined): string[] | undefined {
  if (value === undefined) return undefined
  if (typeof value !== 'string') usageError('--labels expects a comma-separated string')
  return value.split(',').map(v => v.trim()).filter(Boolean)
}

export function parseEntityColor(input: unknown): unknown {
  if (input === undefined) return undefined
  if (typeof input === 'string') {
    const trimmed = input.trim()
    if ((trimmed.startsWith('{') && trimmed.endsWith('}')) || (trimmed.startsWith('[') && trimmed.endsWith(']'))) {
      try {
        return JSON.parse(trimmed)
      } catch {
        return input
      }
    }
  }
  return input
}

export function ensureString(value: unknown, field: string): string {
  if (typeof value !== 'string' || !value.trim()) {
    usageError(`Missing required field: ${field}`)
  }
  return value
}

export function validateValueType(value: unknown): 'string' | 'number' | 'date' | undefined {
  if (value === undefined || value === null || value === '') return undefined
  if (value === 'string' || value === 'number' || value === 'date') return value
  usageError('valueType must be one of: string, number, date')
}

export function validatePermissionMode(value: unknown): 'safe' | 'ask' | 'allow-all' | undefined {
  if (value === undefined || value === null || value === '') return undefined
  if (value === 'safe' || value === 'ask' || value === 'allow-all') return value
  usageError('permissionMode must be one of: safe, ask, allow-all')
}

export function validateActions(actions: unknown): Record<string, unknown>[] {
  if (!Array.isArray(actions) || actions.length === 0) {
    usageError('Automation matcher requires a non-empty actions array')
  }
  return actions as Record<string, unknown>[]
}

export function assertKnownAction(namespace: string, action: string, allowed: readonly string[]): void {
  if (!allowed.includes(action)) {
    usageError(
      `Unknown action: ${namespace} ${action}`,
      `Run: craft-agent ${namespace} --help`
    )
  }
}

export interface EntityHelpSection {
  markdown?: string
  sourcePath?: string
  warning?: string
}

export function resolveCommandsDocPath(): string | null {
  const candidates = [
    process.env.CRAFT_COMMANDS_DOC_PATH,
    process.env.CRAFT_CLI_DOC_PATH,
    process.env.CRAFT_RESOURCES_BASE ? join(process.env.CRAFT_RESOURCES_BASE, 'resources', 'docs', 'craft-cli.md') : null,
    join(process.cwd(), 'apps', 'electron', 'resources', 'docs', 'craft-cli.md'),
  ].filter((value): value is string => Boolean(value && value.trim()))

  for (const candidate of candidates) {
    const full = resolve(candidate)
    if (existsSync(full)) return full
  }

  return null
}

function extractSectionWithMarkers(markdown: string, markerKey: string): string | null {
  const startMarker = `<!-- cli:${markerKey}:start -->`
  const endMarker = `<!-- cli:${markerKey}:end -->`
  const start = markdown.indexOf(startMarker)
  if (start === -1) return null
  const from = start + startMarker.length
  const end = markdown.indexOf(endMarker, from)
  if (end === -1) return null
  const section = markdown.slice(from, end).trim()
  return section || null
}

function extractSectionByH2(markdown: string, heading: string): string | null {
  const escaped = heading.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const headingRegex = new RegExp(`^##\\s+${escaped}\\s*$`, 'm')
  const startMatch = headingRegex.exec(markdown)
  if (!startMatch || startMatch.index === undefined) return null

  const sectionStart = startMatch.index
  const rest = markdown.slice(sectionStart)
  const nextHeadingMatch = /^##\s+/m.exec(rest.slice(startMatch[0].length))
  if (!nextHeadingMatch || nextHeadingMatch.index === undefined) {
    return rest.trim() || null
  }

  const endIndex = sectionStart + startMatch[0].length + nextHeadingMatch.index
  const section = markdown.slice(sectionStart, endIndex).trim()
  return section || null
}

export function getEntityDocSection(markerKey: string, heading: string): EntityHelpSection {
  const docPath = resolveCommandsDocPath()
  if (!docPath) {
    return { warning: 'craft-cli.md not found. Showing fallback help.' }
  }

  try {
    const markdown = readFileSync(docPath, 'utf-8')
    const markerSection = extractSectionWithMarkers(markdown, markerKey)
    if (markerSection) return { markdown: markerSection, sourcePath: docPath }

    const h2Section = extractSectionByH2(markdown, heading)
    if (h2Section) return { markdown: h2Section, sourcePath: docPath }

    return {
      warning: `No section found for ${markerKey} in craft-cli.md. Showing fallback help.`,
      sourcePath: docPath,
    }
  } catch (error) {
    return {
      warning: `Failed to read craft-cli.md (${error instanceof Error ? error.message : String(error)}). Showing fallback help.`,
      sourcePath: docPath,
    }
  }
}
