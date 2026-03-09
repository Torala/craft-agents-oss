import { existsSync, readdirSync, unlinkSync } from 'node:fs'
import { join } from 'node:path'
import {
  getWorkspacePermissionsPath,
  getSourcePermissionsPath,
  loadRawWorkspacePermissions,
  loadRawSourcePermissions,
  saveWorkspacePermissions,
  saveSourcePermissions,
  validatePermissionsConfig,
  type PermissionsConfigFile,
} from '@craft-agent/shared/agent'
import { getCliDomainPolicy, validateAllPermissions, validateWorkspacePermissions, validateSourcePermissions } from '@craft-agent/shared/config'
import { loadSourceConfig } from '@craft-agent/shared/sources'
import { PermissionsConfigSchema } from '@craft-agent/shared/agent/mode-types'
import {
  assertKnownAction,
  parseStructuredInput,
  parseTokens,
  usageError,
  execError,
} from '../utils.ts'
import type { CommandPlugin } from './types.ts'

const actions = [
  'list',
  'get',
  'set',
  'add-mcp-pattern',
  'add-api-endpoint',
  'add-bash-pattern',
  'add-write-path',
  'remove',
  'validate',
  'reset',
] as const

const permissionPolicy = getCliDomainPolicy('permission')

type PatternEntry = string | { pattern: string; comment?: string }

function resolveScope(options: Record<string, string | boolean>, structured: Record<string, unknown>): string | undefined {
  return (structured.source ?? options.source) as string | undefined
}

function loadRaw(workspaceRootPath: string, sourceSlug: string | undefined): PermissionsConfigFile | null {
  return sourceSlug
    ? loadRawSourcePermissions(workspaceRootPath, sourceSlug)
    : loadRawWorkspacePermissions(workspaceRootPath)
}

function save(workspaceRootPath: string, sourceSlug: string | undefined, config: PermissionsConfigFile): void {
  if (sourceSlug) {
    saveSourcePermissions(workspaceRootPath, sourceSlug, config)
  } else {
    saveWorkspacePermissions(workspaceRootPath, config)
  }
}

function filePath(workspaceRootPath: string, sourceSlug: string | undefined): string {
  return sourceSlug
    ? getSourcePermissionsPath(workspaceRootPath, sourceSlug)
    : getWorkspacePermissionsPath(workspaceRootPath)
}

function ensureSourceExists(workspaceRootPath: string, sourceSlug: string): void {
  const config = loadSourceConfig(workspaceRootPath, sourceSlug)
  if (!config) usageError(`Source not found: ${sourceSlug}`)
}

function validateBeforeSave(config: PermissionsConfigFile, target: string): void {
  const schemaResult = PermissionsConfigSchema.safeParse(config)
  if (!schemaResult.success) {
    usageError('Permissions config would be invalid after change', 'Fix the pattern and retry', schemaResult.error.issues)
  }

  const regexErrors = validatePermissionsConfig(config)
  if (regexErrors.length > 0) {
    usageError('Permissions config contains invalid regex patterns', 'Fix patterns and retry', regexErrors)
  }
}

function getSourceSlugs(workspaceRootPath: string): string[] {
  const sourcesDir = join(workspaceRootPath, 'sources')
  if (!existsSync(sourcesDir)) return []
  return readdirSync(sourcesDir, { withFileTypes: true })
    .filter(e => e.isDirectory())
    .map(e => e.name)
}

export const permissionPlugin: CommandPlugin = {
  namespace: 'permission',
  actions,
  docsMarker: 'permission',
  docsHeading: 'Permission',
  policy: {
    preToolGuards: {
      redirectHelpCommand: permissionPolicy.helpCommand,
      workspacePathScopes: [...permissionPolicy.workspacePathScopes],
    },
    exploreAllowlist: {
      readActions: [...permissionPolicy.readActions],
      allowGlobalFlags: true,
    },
  },
  async execute(action, tokens, context) {
    assertKnownAction('permission', action, actions)

    const { positional, options } = parseTokens(tokens)
    const structured = parseStructuredInput(options)
    const workspaceRootPath = context.workspaceRootPath
    const sourceSlug = resolveScope(options, structured)

    if (sourceSlug) ensureSourceExists(workspaceRootPath, sourceSlug)

    // ── list ──────────────────────────────────────────────
    if (action === 'list') {
      const wsPath = getWorkspacePermissionsPath(workspaceRootPath)
      const wsExists = existsSync(wsPath)
      const wsConfig = wsExists ? loadRawWorkspacePermissions(workspaceRootPath) : null

      const sources = getSourceSlugs(workspaceRootPath)
        .map(slug => {
          const srcPath = getSourcePermissionsPath(workspaceRootPath, slug)
          const exists = existsSync(srcPath)
          const config = exists ? loadRawSourcePermissions(workspaceRootPath, slug) : null
          return {
            slug,
            exists,
            mcpPatterns: config?.allowedMcpPatterns?.length ?? 0,
            apiEndpoints: config?.allowedApiEndpoints?.length ?? 0,
            bashPatterns: config?.allowedBashPatterns?.length ?? 0,
            writePaths: config?.allowedWritePaths?.length ?? 0,
          }
        })
        .filter(s => s.exists)

      return {
        workspace: wsExists
          ? {
              exists: true,
              path: wsPath,
              mcpPatterns: wsConfig?.allowedMcpPatterns?.length ?? 0,
              apiEndpoints: wsConfig?.allowedApiEndpoints?.length ?? 0,
              bashPatterns: wsConfig?.allowedBashPatterns?.length ?? 0,
              writePaths: wsConfig?.allowedWritePaths?.length ?? 0,
            }
          : { exists: false, path: wsPath },
        sources,
      }
    }

    // ── get ───────────────────────────────────────────────
    if (action === 'get') {
      const config = loadRaw(workspaceRootPath, sourceSlug)
      return {
        scope: sourceSlug ?? 'workspace',
        path: filePath(workspaceRootPath, sourceSlug),
        exists: config !== null,
        config,
      }
    }

    // ── set ───────────────────────────────────────────────
    if (action === 'set') {
      if (Object.keys(structured).length === 0) {
        usageError('permission set requires --json with the full config', 'Example: craft-agent permission set --json \'{"allowedMcpPatterns":[...]}\'')
      }

      const schemaResult = PermissionsConfigSchema.safeParse(structured)
      if (!schemaResult.success) {
        usageError('Invalid permissions config', 'Check schema and retry', schemaResult.error.issues)
      }

      validateBeforeSave(schemaResult.data, sourceSlug ?? 'workspace')
      save(workspaceRootPath, sourceSlug, schemaResult.data)

      return {
        scope: sourceSlug ?? 'workspace',
        path: filePath(workspaceRootPath, sourceSlug),
        config: schemaResult.data,
      }
    }

    // ── add-mcp-pattern ──────────────────────────────────
    if (action === 'add-mcp-pattern') {
      const pattern = positional[0] ?? (structured.pattern as string | undefined) ?? (options.pattern as string | undefined)
      if (!pattern?.trim()) usageError('add-mcp-pattern requires a pattern', 'Example: craft-agent permission add-mcp-pattern "list" --source linear')

      const comment = (structured.comment ?? options.comment) as string | undefined
      const entry: PatternEntry = comment ? { pattern, comment } : pattern

      const config = loadRaw(workspaceRootPath, sourceSlug) ?? {}
      const arr = [...(config.allowedMcpPatterns ?? []), entry]
      const next: PermissionsConfigFile = { ...config, allowedMcpPatterns: arr }

      validateBeforeSave(next, sourceSlug ?? 'workspace')
      save(workspaceRootPath, sourceSlug, next)

      return { scope: sourceSlug ?? 'workspace', added: entry, allowedMcpPatterns: arr }
    }

    // ── add-api-endpoint ─────────────────────────────────
    if (action === 'add-api-endpoint') {
      const method = ((structured.method ?? options.method) as string | undefined)?.toUpperCase()
      const path = (structured.path ?? options.path) as string | undefined
      const comment = (structured.comment ?? options.comment) as string | undefined

      if (!method) usageError('add-api-endpoint requires --method GET|POST|PUT|PATCH|DELETE')
      if (!path?.trim()) usageError('add-api-endpoint requires --path "<regex>"')

      const entry = { method, path, ...(comment ? { comment } : {}) }

      const config = loadRaw(workspaceRootPath, sourceSlug) ?? {}
      const arr = [...(config.allowedApiEndpoints ?? []), entry as any]
      const next: PermissionsConfigFile = { ...config, allowedApiEndpoints: arr }

      validateBeforeSave(next, sourceSlug ?? 'workspace')
      save(workspaceRootPath, sourceSlug, next)

      return { scope: sourceSlug ?? 'workspace', added: entry, allowedApiEndpoints: arr }
    }

    // ── add-bash-pattern ─────────────────────────────────
    if (action === 'add-bash-pattern') {
      const pattern = positional[0] ?? (structured.pattern as string | undefined) ?? (options.pattern as string | undefined)
      if (!pattern?.trim()) usageError('add-bash-pattern requires a pattern', 'Example: craft-agent permission add-bash-pattern "^ls\\\\s"')

      const comment = (structured.comment ?? options.comment) as string | undefined
      const entry: PatternEntry = comment ? { pattern, comment } : pattern

      const config = loadRaw(workspaceRootPath, sourceSlug) ?? {}
      const arr = [...(config.allowedBashPatterns ?? []), entry]
      const next: PermissionsConfigFile = { ...config, allowedBashPatterns: arr }

      validateBeforeSave(next, sourceSlug ?? 'workspace')
      save(workspaceRootPath, sourceSlug, next)

      return { scope: sourceSlug ?? 'workspace', added: entry, allowedBashPatterns: arr }
    }

    // ── add-write-path ───────────────────────────────────
    if (action === 'add-write-path') {
      const pathGlob = positional[0] ?? (structured.path as string | undefined) ?? (options.path as string | undefined)
      if (!pathGlob?.trim()) usageError('add-write-path requires a glob path', 'Example: craft-agent permission add-write-path "/tmp/**"')

      const config = loadRaw(workspaceRootPath, sourceSlug) ?? {}
      const arr = [...(config.allowedWritePaths ?? []), pathGlob]
      const next: PermissionsConfigFile = { ...config, allowedWritePaths: arr }

      validateBeforeSave(next, sourceSlug ?? 'workspace')
      save(workspaceRootPath, sourceSlug, next)

      return { scope: sourceSlug ?? 'workspace', added: pathGlob, allowedWritePaths: arr }
    }

    // ── remove ───────────────────────────────────────────
    if (action === 'remove') {
      const indexRaw = positional[0] ?? (structured.index as string | number | undefined) ?? (options.index as string | undefined)
      const index = typeof indexRaw === 'number' ? indexRaw : Number.parseInt(String(indexRaw ?? ''), 10)
      if (!Number.isFinite(index) || index < 0) usageError('remove requires a non-negative index', 'Example: craft-agent permission remove 0 --type mcp --source linear')

      const ruleType = (structured.type ?? options.type) as string | undefined
      if (!ruleType) usageError('remove requires --type mcp|api|bash|write-path|blocked')

      const config = loadRaw(workspaceRootPath, sourceSlug)
      if (!config) usageError('No permissions file found', `Create one first with: craft-agent permission set --json '{...}'${sourceSlug ? ` --source ${sourceSlug}` : ''}`)

      let removed: unknown
      const next = { ...config }

      switch (ruleType) {
        case 'mcp': {
          const arr = [...(config.allowedMcpPatterns ?? [])]
          if (index >= arr.length) usageError(`Index ${index} out of range (${arr.length} MCP patterns)`)
          removed = arr.splice(index, 1)[0]
          next.allowedMcpPatterns = arr.length > 0 ? arr : undefined
          break
        }
        case 'api': {
          const arr = [...(config.allowedApiEndpoints ?? [])]
          if (index >= arr.length) usageError(`Index ${index} out of range (${arr.length} API endpoints)`)
          removed = arr.splice(index, 1)[0]
          next.allowedApiEndpoints = arr.length > 0 ? arr : undefined
          break
        }
        case 'bash': {
          const arr = [...(config.allowedBashPatterns ?? [])]
          if (index >= arr.length) usageError(`Index ${index} out of range (${arr.length} bash patterns)`)
          removed = arr.splice(index, 1)[0]
          next.allowedBashPatterns = arr.length > 0 ? arr : undefined
          break
        }
        case 'write-path': {
          const arr = [...(config.allowedWritePaths ?? [])]
          if (index >= arr.length) usageError(`Index ${index} out of range (${arr.length} write paths)`)
          removed = arr.splice(index, 1)[0]
          next.allowedWritePaths = arr.length > 0 ? arr : undefined
          break
        }
        case 'blocked': {
          const arr = [...(config.blockedTools ?? [])]
          if (index >= arr.length) usageError(`Index ${index} out of range (${arr.length} blocked tools)`)
          removed = arr.splice(index, 1)[0]
          next.blockedTools = arr.length > 0 ? arr : undefined
          break
        }
        default:
          usageError('--type must be one of: mcp, api, bash, write-path, blocked')
      }

      validateBeforeSave(next, sourceSlug ?? 'workspace')
      save(workspaceRootPath, sourceSlug, next)

      return { scope: sourceSlug ?? 'workspace', removed, ruleType, index }
    }

    // ── validate ─────────────────────────────────────────
    if (action === 'validate') {
      if (sourceSlug) {
        return validateSourcePermissions(workspaceRootPath, sourceSlug)
      }
      return validateAllPermissions(workspaceRootPath)
    }

    // ── reset ────────────────────────────────────────────
    if (action === 'reset') {
      const target = filePath(workspaceRootPath, sourceSlug)
      if (!existsSync(target)) {
        return { scope: sourceSlug ?? 'workspace', reset: false, message: 'No permissions file exists' }
      }

      unlinkSync(target)
      return { scope: sourceSlug ?? 'workspace', reset: true, deletedPath: target }
    }

    usageError(`Unhandled permission action: ${action}`)
  },
}
