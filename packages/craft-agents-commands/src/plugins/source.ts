import { existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { createSource, deleteSource, loadAllSources, loadSource, loadSourceConfig, saveSourceConfig, saveSourceGuide } from '@craft-agent/shared/sources'
import type { CreateSourceInput, FolderSourceConfig } from '@craft-agent/shared/sources'
import { getSourcePermissionsPath } from '@craft-agent/shared/agent'
import { getCliDomainPolicy, validateSource, validateSourceConfig, validateSourcePermissions } from '@craft-agent/shared/config'
import {
  assertKnownAction,
  parseBoolean,
  parseStructuredInput,
  parseTokens,
  usageError,
} from '../utils.ts'
import type { CommandPlugin } from './types.ts'

const actions = ['list', 'get', 'create', 'update', 'delete', 'validate', 'test', 'init-guide', 'init-permissions', 'auth-help'] as const
const sourcePolicy = getCliDomainPolicy('source')

function parseSourceType(value: unknown): 'mcp' | 'api' | 'local' {
  if (value === 'mcp' || value === 'api' || value === 'local') return value
  usageError('source create requires --type mcp|api|local')
}

function parseCreateInput(structured: Record<string, unknown>, options: Record<string, string | boolean>): CreateSourceInput {
  const type = parseSourceType(structured.type ?? options.type)
  const name = (structured.name ?? options.name) as string | undefined
  const provider = (structured.provider ?? options.provider) as string | undefined

  if (!name?.trim()) usageError('source create requires --name "..."')
  if (!provider?.trim()) usageError('source create requires --provider "..."')

  const enabled = parseBoolean(structured.enabled as string | boolean | undefined ?? options.enabled, 'enabled')
  const icon = (structured.icon ?? options.icon) as string | undefined

  const input: CreateSourceInput = {
    name,
    provider,
    type,
    enabled,
    icon,
  }

  if (type === 'mcp') {
    const mcpFromStructured = structured.mcp
    if (mcpFromStructured && typeof mcpFromStructured === 'object' && !Array.isArray(mcpFromStructured)) {
      input.mcp = mcpFromStructured as any
    } else {
      const url = (structured.url ?? options.url) as string | undefined
      const transport = (structured.transport ?? options.transport) as string | undefined
      const authType = (structured.authType ?? options['auth-type']) as string | undefined
      input.mcp = {
        ...(transport ? { transport: transport as any } : {}),
        ...(url ? { url } : {}),
        ...(authType ? { authType: authType as any } : {}),
      }
    }
  }

  if (type === 'api') {
    const apiFromStructured = structured.api
    if (apiFromStructured && typeof apiFromStructured === 'object' && !Array.isArray(apiFromStructured)) {
      input.api = apiFromStructured as any
    } else {
      const baseUrl = (structured.baseUrl ?? options['base-url']) as string | undefined
      const authType = (structured.authType ?? options['auth-type']) as string | undefined
      if (!baseUrl) usageError('source create for api requires --base-url')
      if (!authType) usageError('source create for api requires --auth-type')
      input.api = { baseUrl, authType: authType as any }
    }
  }

  if (type === 'local') {
    const localFromStructured = structured.local
    if (localFromStructured && typeof localFromStructured === 'object' && !Array.isArray(localFromStructured)) {
      input.local = localFromStructured as any
    } else {
      const path = (structured.path ?? options.path) as string | undefined
      if (!path) usageError('source create for local requires --path')
      input.local = { path }
    }
  }

  return input
}

function applyPatch(config: FolderSourceConfig, patch: Record<string, unknown>): FolderSourceConfig {
  const next: FolderSourceConfig = {
    ...config,
    ...patch,
    mcp: patch.mcp !== undefined ? patch.mcp as any : config.mcp,
    api: patch.api !== undefined ? patch.api as any : config.api,
    local: patch.local !== undefined ? patch.local as any : config.local,
    updatedAt: Date.now(),
  }

  if (next.slug !== config.slug) {
    usageError('source update cannot change slug')
  }
  if (next.id !== config.id) {
    usageError('source update cannot change id')
  }

  return next
}

function runSourceTest(
  workspaceRootPath: string,
  slug: string,
  config: FolderSourceConfig,
): {
  valid: boolean
  checks: Array<{ name: string; category: 'structural' | 'completeness' | 'runtime'; ok: boolean; details?: string }>
} {
  const checks: Array<{ name: string; category: 'structural' | 'completeness' | 'runtime'; ok: boolean; details?: string }> = []

  const validation = validateSourceConfig(config)
  checks.push({
    name: 'schema',
    category: 'structural',
    ok: validation.valid,
    ...(validation.valid ? {} : { details: validation.errors.map(e => `${e.path}: ${e.message}`).join('; ') }),
  })

  const sourceDir = resolve(workspaceRootPath, 'sources', slug)
  const guidePath = resolve(sourceDir, 'guide.md')
  const permissionsPath = resolve(sourceDir, 'permissions.json')

  checks.push({
    name: 'guide',
    category: 'completeness',
    ok: existsSync(guidePath),
    details: existsSync(guidePath) ? `Found: ${guidePath}` : 'guide.md is missing',
  })

  checks.push({
    name: 'permissions',
    category: 'completeness',
    ok: existsSync(permissionsPath),
    details: existsSync(permissionsPath)
      ? `Found: ${permissionsPath}`
      : 'permissions.json is optional but recommended for source-level Explore rules',
  })

  if (config.type === 'local') {
    const localPath = config.local?.path
    if (!localPath) {
      checks.push({ name: 'local-path', category: 'structural', ok: false, details: 'Missing local.path' })
    } else {
      const resolvedPath = resolve(localPath)
      checks.push({
        name: 'local-path',
        category: 'runtime',
        ok: existsSync(resolvedPath),
        details: existsSync(resolvedPath) ? resolvedPath : `Path does not exist: ${resolvedPath}`,
      })
    }
  }

  if (config.type === 'mcp' && (config.mcp?.transport === undefined || config.mcp?.transport === 'http' || config.mcp?.transport === 'sse')) {
    const url = config.mcp?.url
    checks.push({
      name: 'mcp-url',
      category: 'runtime',
      ok: typeof url === 'string' && url.length > 0,
      details: url ? `Configured URL: ${url}` : 'Missing mcp.url',
    })
  }

  if (config.type === 'api') {
    const baseUrl = config.api?.baseUrl
    checks.push({
      name: 'api-base-url',
      category: 'runtime',
      ok: typeof baseUrl === 'string' && baseUrl.length > 0,
      details: baseUrl ? `Configured baseUrl: ${baseUrl}` : 'Missing api.baseUrl',
    })
  }

  const valid = checks.every(check => check.ok || check.category === 'completeness')
  return { valid, checks }
}

function buildGuideTemplate(config: FolderSourceConfig, template: 'generic' | 'mcp' | 'api' | 'local'): string {
  const kind = template === 'generic' ? config.type : template
  const title = config.name

  if (kind === 'mcp') {
    return `# ${title}

MCP source for ${config.provider}. Use this source for repeatable, tool-driven workflows.

## Scope

- Provider: ${config.provider}
- Type: MCP
- Slug: ${config.slug}

## Guidelines

- Prefer read operations first (list/get/search) before mutations.
- Confirm assumptions against current tool outputs.
- Document rate limits and auth caveats for this provider.

## Examples

- List relevant entities for this workspace.
- Fetch a specific entity by identifier.
`
  }

  if (kind === 'api') {
    return `# ${title}

API source for ${config.provider}. Use this source for structured HTTP workflows.

## Scope

- Provider: ${config.provider}
- Type: API
- Base URL: ${config.api?.baseUrl ?? '(unset)'}

## Guidelines

- Keep requests minimal and explicit.
- Prefer GET endpoints for exploration.
- Record endpoint-specific constraints (auth, pagination, quotas).

## API Notes

- Auth type: ${config.api?.authType ?? '(unset)'}
- Test endpoint: ${config.api?.testEndpoint ? `${config.api.testEndpoint.method} ${config.api.testEndpoint.path}` : '(unset)'}
`
  }

  if (kind === 'local') {
    return `# ${title}

Local source for ${config.provider}. Use this source to work with files/folders on disk.

## Scope

- Provider: ${config.provider}
- Type: Local
- Path: ${config.local?.path ?? '(unset)'}

## Guidelines

- Prefer read-only file operations unless explicitly asked to modify files.
- Keep path usage scoped and predictable.
- Note any large directories or indexing constraints.
`
  }

  return `# ${title}

Brief description of what this source provides.

## Scope

What data/functionality this source provides access to.

## Guidelines

- Best practices for using this source
- Rate limits or quotas to be aware of
- Common patterns and examples
`
}

function buildPermissionsTemplate(config: FolderSourceConfig): Record<string, unknown> {
  if (config.type === 'mcp') {
    return {
      allowedMcpPatterns: [
        { pattern: 'list', comment: 'Allow list operations' },
        { pattern: 'get', comment: 'Allow get/read operations' },
        { pattern: 'search', comment: 'Allow search operations' },
        { pattern: 'find', comment: 'Allow find operations' },
      ],
    }
  }

  if (config.type === 'api') {
    return {
      allowedApiEndpoints: [
        { method: 'GET', path: '.*', comment: 'Allow all GET requests (read-only)' },
      ],
    }
  }

  return {
    allowedBashPatterns: [
      {
        pattern: '^(ls|cat|head|tail|grep|find|tree)\\s',
        comment: 'Allow read-only local filesystem commands',
      },
    ],
  }
}

function getSourceAuthHelp(source: FolderSourceConfig): {
  state: 'authenticated' | 'needs_auth' | 'no_auth' | 'unknown'
  recommendedTool?: string
  mode?: string
  hints: string[]
} {
  if (source.isAuthenticated === true) {
    return {
      state: 'authenticated',
      hints: ['Source is already authenticated according to config.isAuthenticated.'],
    }
  }

  if (source.type === 'mcp') {
    const authType = source.mcp?.authType
    if (authType === 'oauth') {
      return {
        state: 'needs_auth',
        recommendedTool: 'mcp__session__source_oauth_trigger',
        mode: 'oauth',
        hints: ['Run source_oauth_trigger in-session to start OAuth login.'],
      }
    }
    if (authType === 'bearer') {
      return {
        state: 'needs_auth',
        recommendedTool: 'mcp__session__source_credential_prompt',
        mode: 'bearer',
        hints: ['Prompt for bearer token credentials in-session.'],
      }
    }
    return { state: 'no_auth', hints: ['MCP source is configured as authType=none.'] }
  }

  if (source.type === 'api') {
    if (source.provider === 'google') {
      return {
        state: 'needs_auth',
        recommendedTool: 'mcp__session__source_google_oauth_trigger',
        mode: 'oauth-google',
        hints: ['Use Google OAuth trigger in-session. Ensure client credentials are configured if required.'],
      }
    }
    if (source.provider === 'microsoft') {
      return {
        state: 'needs_auth',
        recommendedTool: 'mcp__session__source_microsoft_oauth_trigger',
        mode: 'oauth-microsoft',
        hints: ['Use Microsoft OAuth trigger in-session.'],
      }
    }
    if (source.provider === 'slack') {
      return {
        state: 'needs_auth',
        recommendedTool: 'mcp__session__source_slack_oauth_trigger',
        mode: 'oauth-slack',
        hints: ['Use Slack OAuth trigger in-session.'],
      }
    }

    const authType = source.api?.authType
    if (authType === 'none') {
      return { state: 'no_auth', hints: ['API source is configured as authType=none.'] }
    }

    if (authType === 'basic') {
      return {
        state: 'needs_auth',
        recommendedTool: 'mcp__session__source_credential_prompt',
        mode: 'basic',
        hints: ['Prompt for basic auth credentials in-session.'],
      }
    }

    if (authType === 'query') {
      return {
        state: 'needs_auth',
        recommendedTool: 'mcp__session__source_credential_prompt',
        mode: 'query',
        hints: ['Prompt for query-param API key in-session.'],
      }
    }

    if (authType === 'header') {
      if (Array.isArray(source.api?.headerNames) && source.api.headerNames.length > 1) {
        return {
          state: 'needs_auth',
          recommendedTool: 'mcp__session__source_credential_prompt',
          mode: 'multi-header',
          hints: [`Prompt for all required headers: ${source.api.headerNames.join(', ')}`],
        }
      }

      return {
        state: 'needs_auth',
        recommendedTool: 'mcp__session__source_credential_prompt',
        mode: 'header',
        hints: ['Prompt for single-header API key in-session.'],
      }
    }

    return {
      state: 'needs_auth',
      recommendedTool: 'mcp__session__source_credential_prompt',
      mode: 'bearer',
      hints: ['Prompt for bearer token credentials in-session.'],
    }
  }

  return {
    state: 'unknown',
    hints: ['Local sources typically do not require auth.'],
  }
}

export const sourcePlugin: CommandPlugin = {
  namespace: 'source',
  actions,
  docsMarker: 'source',
  docsHeading: 'Source',
  policy: {
    preToolGuards: {
      redirectHelpCommand: sourcePolicy.helpCommand,
      workspacePathScopes: [...sourcePolicy.workspacePathScopes],
    },
    exploreAllowlist: {
      readActions: [...sourcePolicy.readActions],
      allowGlobalFlags: true,
    },
  },
  async execute(action, tokens, context) {
    assertKnownAction('source', action, actions)

    const { positional, options } = parseTokens(tokens)
    const structured = parseStructuredInput(options)
    const workspaceRootPath = context.workspaceRootPath

    if (action === 'list') {
      const includeBuiltins = parseBoolean(options['include-builtins'], 'include-builtins') ?? false
      const sources = loadAllSources(workspaceRootPath)
      return {
        sources: includeBuiltins ? sources : sources.filter(source => !source.isBuiltin),
      }
    }

    if (action === 'get') {
      const slug = positional[0]
      if (!slug) usageError('source get requires <slug>', 'Run: craft-agent source get <slug>')

      const source = loadSource(workspaceRootPath, slug)
      if (!source) usageError(`Source not found: ${slug}`)

      return { source }
    }

    if (action === 'create') {
      const input = parseCreateInput(structured, options)
      const config = await createSource(workspaceRootPath, input)
      return { source: loadSource(workspaceRootPath, config.slug) }
    }

    if (action === 'update') {
      const slug = positional[0]
      if (!slug) usageError('source update requires <slug>', 'Run: craft-agent source update <slug> --json "{...}"')

      const existing = loadSourceConfig(workspaceRootPath, slug)
      if (!existing) usageError(`Source not found: ${slug}`)

      const patch = structured
      if (Object.keys(patch).length === 0) {
        usageError('source update requires --json with fields to update')
      }

      const next = applyPatch(existing, patch)
      const validation = validateSourceConfig(next)
      if (!validation.valid) {
        usageError('Updated source config is invalid', 'Fix invalid fields and retry', validation.errors)
      }

      saveSourceConfig(workspaceRootPath, next)
      return { source: loadSource(workspaceRootPath, slug) }
    }

    if (action === 'delete') {
      const slug = positional[0]
      if (!slug) usageError('source delete requires <slug>', 'Run: craft-agent source delete <slug>')

      const existing = loadSourceConfig(workspaceRootPath, slug)
      if (!existing) usageError(`Source not found: ${slug}`)

      deleteSource(workspaceRootPath, slug)
      return { deleted: slug }
    }

    if (action === 'validate') {
      const slug = positional[0]
      if (!slug) usageError('source validate requires <slug>', 'Run: craft-agent source validate <slug>')

      const existing = loadSourceConfig(workspaceRootPath, slug)
      if (!existing) usageError(`Source not found: ${slug}`)

      const result = validateSource(workspaceRootPath, slug)
      return {
        valid: result.valid,
        errors: result.errors,
        warnings: result.warnings,
        source: {
          slug,
          type: existing.type,
          provider: existing.provider,
          enabled: existing.enabled,
        },
      }
    }

    if (action === 'test') {
      const slug = positional[0]
      if (!slug) usageError('source test requires <slug>', 'Run: craft-agent source test <slug>')

      const existing = loadSourceConfig(workspaceRootPath, slug)
      if (!existing) usageError(`Source not found: ${slug}`)

      const result = runSourceTest(workspaceRootPath, slug, existing)
      return {
        sourceSlug: slug,
        valid: result.valid,
        checks: result.checks,
        limitations: [
          'CLI source test performs structural/completeness checks only.',
          'For full runtime auth and connection probing, run mcp__session__source_test in-session.',
        ],
      }
    }

    if (action === 'init-guide') {
      const slug = positional[0]
      if (!slug) usageError('source init-guide requires <slug>', 'Run: craft-agent source init-guide <slug>')

      const existing = loadSourceConfig(workspaceRootPath, slug)
      if (!existing) usageError(`Source not found: ${slug}`)

      const templateRaw = (structured.template ?? options.template) as string | undefined
      const template = templateRaw === 'generic' || templateRaw === 'mcp' || templateRaw === 'api' || templateRaw === 'local'
        ? templateRaw
        : existing.type

      const raw = buildGuideTemplate(existing, template)
      saveSourceGuide(workspaceRootPath, slug, { raw })

      return {
        sourceSlug: slug,
        template,
        guidePath: join(resolve(workspaceRootPath, 'sources', slug), 'guide.md'),
      }
    }

    if (action === 'init-permissions') {
      const slug = positional[0]
      if (!slug) usageError('source init-permissions requires <slug>', 'Run: craft-agent source init-permissions <slug>')

      const existing = loadSourceConfig(workspaceRootPath, slug)
      if (!existing) usageError(`Source not found: ${slug}`)

      const modeRaw = (structured.mode ?? options.mode) as string | undefined
      if (modeRaw && modeRaw !== 'read-only') {
        usageError('source init-permissions currently supports only --mode read-only')
      }

      const payload = buildPermissionsTemplate(existing)
      const permissionsPath = getSourcePermissionsPath(workspaceRootPath, slug)
      mkdirSync(resolve(workspaceRootPath, 'sources', slug), { recursive: true })
      writeFileSync(permissionsPath, `${JSON.stringify(payload, null, 2)}\n`, 'utf-8')

      const validation = validateSourcePermissions(workspaceRootPath, slug)
      return {
        sourceSlug: slug,
        permissionsPath,
        valid: validation.valid,
        errors: validation.errors,
        warnings: validation.warnings,
      }
    }

    if (action === 'auth-help') {
      const slug = positional[0]
      if (!slug) usageError('source auth-help requires <slug>', 'Run: craft-agent source auth-help <slug>')

      const existing = loadSourceConfig(workspaceRootPath, slug)
      if (!existing) usageError(`Source not found: ${slug}`)

      return {
        sourceSlug: slug,
        type: existing.type,
        provider: existing.provider,
        auth: getSourceAuthHelp(existing),
      }
    }

    usageError(`Unhandled source action: ${action}`)
  },
}
