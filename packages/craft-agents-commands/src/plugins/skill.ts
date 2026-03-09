import { existsSync, mkdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import matter from 'gray-matter'
import {
  GLOBAL_AGENT_SKILLS_DIR,
  PROJECT_AGENT_SKILLS_DIR,
  deleteSkill,
  loadAllSkills,
  loadSkill,
  loadSkillBySlug,
  skillExists,
  downloadSkillIcon,
} from '@craft-agent/shared/skills'
import { getCliDomainPolicy, validateSkill, validateSkillContent } from '@craft-agent/shared/config'
import {
  assertKnownAction,
  parseBoolean,
  parseStructuredInput,
  parseTokens,
  usageError,
} from '../utils.ts'
import type { CommandPlugin } from './types.ts'

const actions = ['list', 'get', 'create', 'update', 'delete', 'validate', 'where'] as const
const skillPolicy = getCliDomainPolicy('skill')

function workspaceSkillsPath(workspaceRootPath: string): string {
  return join(workspaceRootPath, 'skills')
}

function slugify(input: string): string {
  const slug = input
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
  return slug || 'skill'
}

function parseCsv(value: unknown): string[] | undefined {
  if (value === undefined || value === null) return undefined
  if (Array.isArray(value)) return value.map(String).map(v => v.trim()).filter(Boolean)
  if (typeof value === 'string') return value.split(',').map(v => v.trim()).filter(Boolean)
  return undefined
}

function skillPaths(workspaceRootPath: string, slug: string, projectRoot?: string) {
  const workspacePath = join(workspaceSkillsPath(workspaceRootPath), slug, 'SKILL.md')
  const projectPath = projectRoot ? join(projectRoot, PROJECT_AGENT_SKILLS_DIR, slug, 'SKILL.md') : undefined
  const globalPath = join(GLOBAL_AGENT_SKILLS_DIR, slug, 'SKILL.md')
  return {
    workspacePath,
    projectPath,
    globalPath,
    exists: {
      workspace: existsSync(workspacePath),
      project: projectPath ? existsSync(projectPath) : false,
      global: existsSync(globalPath),
    },
  }
}

function buildSkillMarkdown(
  body: string,
  frontmatter: {
    name: string
    description: string
    globs?: string[]
    alwaysAllow?: string[]
    requiredSources?: string[]
    icon?: string
  }
): string {
  const normalizedBody = body.trim() ? `${body.trim()}\n` : '# Skill Instructions\n\n(Add skill behavior here)\n'
  return matter.stringify(normalizedBody, frontmatter)
}

function writeFileAtomic(filePath: string, content: string): void {
  const tmpPath = `${filePath}.tmp-${Date.now()}-${Math.random().toString(16).slice(2)}`
  writeFileSync(tmpPath, content, 'utf-8')
  try {
    renameSync(tmpPath, filePath)
  } catch (error) {
    try {
      unlinkSync(tmpPath)
    } catch {
      // ignore cleanup errors
    }
    throw error
  }
}

export const skillPlugin: CommandPlugin = {
  namespace: 'skill',
  actions,
  docsMarker: 'skill',
  docsHeading: 'Skill',
  policy: {
    preToolGuards: {
      redirectHelpCommand: skillPolicy.helpCommand,
      workspacePathScopes: [...skillPolicy.workspacePathScopes],
    },
    exploreAllowlist: {
      readActions: [...skillPolicy.readActions],
      allowGlobalFlags: true,
    },
  },
  async execute(action, tokens, context) {
    assertKnownAction('skill', action, actions)

    const { positional, options } = parseTokens(tokens)
    const structured = parseStructuredInput(options)
    const workspaceRootPath = context.workspaceRootPath
    const projectRoot = (structured.projectRoot ?? options['project-root']) as string | undefined

    if (action === 'list') {
      const workspaceOnly =
        parseBoolean((structured.workspaceOnly as string | boolean | undefined) ?? options['workspace-only'], 'workspace-only') ??
        false
      const skills = workspaceOnly
        ? loadAllSkills(workspaceRootPath).filter(skill => skill.source === 'workspace')
        : loadAllSkills(workspaceRootPath, projectRoot ?? process.cwd())
      return { skills }
    }

    if (action === 'get') {
      const slug = positional[0]
      if (!slug) usageError('skill get requires <slug>', 'Run: craft-agent skill get <slug>')

      const skill = loadSkillBySlug(workspaceRootPath, slug, projectRoot ?? process.cwd())
      if (!skill) usageError(`Skill not found: ${slug}`)

      return { skill }
    }

    if (action === 'where') {
      const slug = positional[0]
      if (!slug) usageError('skill where requires <slug>', 'Run: craft-agent skill where <slug>')

      const paths = skillPaths(workspaceRootPath, slug, projectRoot ?? process.cwd())
      return {
        slug,
        ...paths,
        resolvedSource: paths.exists.project ? 'project' : paths.exists.workspace ? 'workspace' : paths.exists.global ? 'global' : null,
      }
    }

    if (action === 'validate') {
      const slug = positional[0]
      if (!slug) usageError('skill validate requires <slug>', 'Run: craft-agent skill validate <slug>')

      const source = (structured.source ?? options.source) as 'workspace' | 'project' | 'global' | undefined
      const paths = skillPaths(workspaceRootPath, slug, projectRoot ?? process.cwd())

      if (!source || source === 'workspace') {
        if (!paths.exists.workspace) usageError(`Skill not found: ${slug}`)
        return validateSkill(workspaceRootPath, slug)
      }

      const targetPath = source === 'project' ? paths.projectPath : paths.globalPath
      if (!targetPath || !existsSync(targetPath)) {
        usageError(`Skill not found in ${source}: ${slug}`)
      }

      const content = readFileSync(targetPath, 'utf-8')
      return validateSkillContent(content, slug)
    }

    if (action === 'create') {
      const slug = ((structured.slug ?? options.slug) as string | undefined)
        ? slugify(String(structured.slug ?? options.slug))
        : slugify(String(structured.name ?? options.name ?? 'skill'))

      const name = (structured.name ?? options.name) as string | undefined
      const description = (structured.description ?? options.description) as string | undefined
      const body = (structured.body ?? options.body) as string | undefined
      const icon = (structured.icon ?? options.icon) as string | undefined
      const globs = parseCsv(structured.globs ?? options.globs)
      const alwaysAllow = parseCsv(structured.alwaysAllow ?? options['always-allow'])
      const requiredSources = parseCsv(structured.requiredSources ?? options['required-sources'])

      if (!name?.trim()) usageError('skill create requires --name "..."')
      if (!description?.trim()) usageError('skill create requires --description "..."')
      if (skillExists(workspaceRootPath, slug)) usageError(`Skill already exists: ${slug}`)

      const skillDir = join(workspaceSkillsPath(workspaceRootPath), slug)
      mkdirSync(skillDir, { recursive: true })

      const markdown = buildSkillMarkdown(body ?? '', {
        name,
        description,
        ...(globs ? { globs } : {}),
        ...(alwaysAllow ? { alwaysAllow } : {}),
        ...(requiredSources ? { requiredSources } : {}),
        ...(icon ? { icon } : {}),
      })

      const contentValidation = validateSkillContent(markdown, slug)
      if (!contentValidation.valid) {
        usageError('Created skill is invalid', 'Fix SKILL.md fields and retry', contentValidation.errors)
      }

      const skillPath = join(skillDir, 'SKILL.md')
      writeFileAtomic(skillPath, markdown)

      if (icon && /^https?:\/\//.test(icon)) {
        await downloadSkillIcon(skillDir, icon)
      }

      const validation = validateSkill(workspaceRootPath, slug)
      if (!validation.valid) {
        usageError('Created skill is invalid', 'Fix SKILL.md fields and retry', validation.errors)
      }

      return { skill: loadSkill(workspaceRootPath, slug) }
    }

    if (action === 'update') {
      const slug = positional[0]
      if (!slug) usageError('skill update requires <slug>', 'Run: craft-agent skill update <slug> --json "{...}"')

      const existing = loadSkill(workspaceRootPath, slug)
      if (!existing) usageError(`Workspace skill not found: ${slug}`)

      const updates = structured
      if (Object.keys(updates).length === 0) {
        usageError('skill update requires --json with fields to update')
      }

      const skillDir = join(workspaceSkillsPath(workspaceRootPath), slug)
      const skillPath = join(skillDir, 'SKILL.md')
      const parsed = matter(readFileSync(skillPath, 'utf-8'))

      const nextData: Record<string, unknown> = {
        ...parsed.data,
        ...(updates.name !== undefined ? { name: updates.name } : {}),
        ...(updates.description !== undefined ? { description: updates.description } : {}),
        ...(updates.globs !== undefined ? { globs: parseCsv(updates.globs) } : {}),
        ...(updates.alwaysAllow !== undefined ? { alwaysAllow: parseCsv(updates.alwaysAllow) } : {}),
        ...(updates.requiredSources !== undefined ? { requiredSources: parseCsv(updates.requiredSources) } : {}),
        ...(updates.icon !== undefined ? { icon: updates.icon } : {}),
      }

      const nextBody = typeof updates.body === 'string' ? updates.body : parsed.content
      const nextMarkdown = matter.stringify(nextBody, nextData)

      const contentValidation = validateSkillContent(nextMarkdown, slug)
      if (!contentValidation.valid) {
        usageError('Updated skill is invalid', 'Fix SKILL.md fields and retry', contentValidation.errors)
      }

      writeFileAtomic(skillPath, nextMarkdown)

      if (typeof updates.icon === 'string' && /^https?:\/\//.test(updates.icon)) {
        await downloadSkillIcon(skillDir, updates.icon)
      }

      const validation = validateSkill(workspaceRootPath, slug)
      if (!validation.valid) {
        usageError('Updated skill is invalid', 'Fix SKILL.md fields and retry', validation.errors)
      }

      return { skill: loadSkill(workspaceRootPath, slug) }
    }

    if (action === 'delete') {
      const slug = positional[0]
      if (!slug) usageError('skill delete requires <slug>', 'Run: craft-agent skill delete <slug>')

      const deleted = deleteSkill(workspaceRootPath, slug)
      if (!deleted) usageError(`Workspace skill not found: ${slug}`)
      return { deleted: slug }
    }

    usageError(`Unhandled skill action: ${action}`)
  },
}
