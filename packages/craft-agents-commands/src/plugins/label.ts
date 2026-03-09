import { listLabels, getLabel, loadLabelConfig, saveLabelConfig } from '@craft-agent/shared/labels/storage'
import { findLabelById, type AutoLabelRule } from '@craft-agent/shared/labels'
import { createLabel, updateLabel, deleteLabel, moveLabel, reorderLabels } from '@craft-agent/shared/labels/crud'
import { getCliDomainPolicy, validateLabelsContent } from '@craft-agent/shared/config'
import {
  assertKnownAction,
  ensureString,
  parseEntityColor,
  parseNullableParent,
  parseStructuredInput,
  parseTokens,
  validateValueType,
  usageError,
} from '../utils.ts'
import type { CommandPlugin } from './types.ts'

const actions = [
  'list',
  'get',
  'create',
  'update',
  'delete',
  'move',
  'reorder',
  'auto-rule-list',
  'auto-rule-add',
  'auto-rule-remove',
  'auto-rule-clear',
  'auto-rule-validate',
] as const
const labelPolicy = getCliDomainPolicy('label')

function validateAndSaveLabelConfig(workspaceRootPath: string, config: ReturnType<typeof loadLabelConfig>): void {
  const raw = JSON.stringify(config)
  const validation = validateLabelsContent(raw)
  if (!validation.valid) {
    usageError('Updated label config is invalid', 'Fix autoRules/valueType fields and retry', validation.errors)
  }
  saveLabelConfig(workspaceRootPath, config)
}

function getLabelOrThrow(workspaceRootPath: string, labelId: string) {
  const config = loadLabelConfig(workspaceRootPath)
  const label = findLabelById(config.labels, labelId)
  if (!label) usageError(`Label not found: ${labelId}`)
  return { config, label }
}

export const labelPlugin: CommandPlugin = {
  namespace: 'label',
  actions,
  docsMarker: 'label',
  docsHeading: 'Label',
  policy: {
    preToolGuards: {
      redirectHelpCommand: labelPolicy.helpCommand,
      workspacePathScopes: [...labelPolicy.workspacePathScopes],
    },
    exploreAllowlist: {
      readActions: [...labelPolicy.readActions],
      allowGlobalFlags: true,
    },
  },
  async execute(action, tokens, context) {
    assertKnownAction('label', action, actions)

    const { positional, options } = parseTokens(tokens)
    const structured = parseStructuredInput(options)
    const workspaceRootPath = context.workspaceRootPath

    if (action === 'list') {
      return { labels: listLabels(workspaceRootPath) }
    }

    if (action === 'get') {
      const labelId = positional[0]
      if (!labelId) usageError('label get requires <id>', 'Run: craft-agent label get <id>')
      const label = getLabel(workspaceRootPath, labelId)
      if (!label) usageError(`Label not found: ${labelId}`)
      return { label }
    }

    if (action === 'create') {
      const name = (structured.name ?? options.name) as unknown
      const parentIdRaw = (structured.parentId ?? options['parent-id']) as string | boolean | undefined
      const color = parseEntityColor(structured.color ?? options.color)
      const valueType = validateValueType(structured.valueType ?? options['value-type'])

      const created = createLabel(workspaceRootPath, {
        name: ensureString(name, 'name'),
        parentId: parseNullableParent(parentIdRaw) ?? undefined,
        color: color as any,
        valueType,
      })

      return { label: created }
    }

    if (action === 'update') {
      const labelId = positional[0]
      if (!labelId) usageError('label update requires <id>', 'Run: craft-agent label update <id> --name "..."')

      const rawValueType = structured.valueType ?? options['value-type']
      const clearValueType =
        options['clear-value-type'] === true ||
        structured.clearValueType === true ||
        rawValueType === 'none' ||
        rawValueType === 'null' ||
        rawValueType === null

      const valueType = clearValueType
        ? ('' as unknown as 'string' | 'number' | 'date')
        : validateValueType(rawValueType)

      const updates = {
        name: (structured.name ?? options.name) as string | undefined,
        color: parseEntityColor(structured.color ?? options.color) as any,
        valueType,
      }

      if (updates.name === undefined && updates.color === undefined && rawValueType === undefined && !clearValueType) {
        usageError('label update requires at least one field to update', 'Use --name, --color, --value-type, --clear-value-type, or --json')
      }

      const updated = updateLabel(workspaceRootPath, labelId, updates)
      return { label: updated }
    }

    if (action === 'delete') {
      const labelId = positional[0]
      if (!labelId) usageError('label delete requires <id>', 'Run: craft-agent label delete <id>')
      const result = deleteLabel(workspaceRootPath, labelId)
      return { deleted: labelId, strippedSessions: result.stripped }
    }

    if (action === 'move') {
      const labelId = positional[0]
      if (!labelId) usageError('label move requires <id>', 'Run: craft-agent label move <id> --parent <id|root>')

      const parentRaw = (structured.parent ?? options.parent) as string | boolean | undefined
      const newParent = parseNullableParent(parentRaw)
      if (newParent === undefined) usageError('label move requires --parent <id|root>')

      moveLabel(workspaceRootPath, labelId, newParent)
      return { moved: labelId, parent: newParent }
    }

    if (action === 'reorder') {
      const parentRaw = (structured.parent ?? options.parent) as string | boolean | undefined
      const parentId = parseNullableParent(parentRaw)

      const orderedIdsFromStructured = Array.isArray(structured.orderedIds)
        ? structured.orderedIds.map(String)
        : undefined
      const orderedIds = orderedIdsFromStructured ?? positional

      if (!orderedIds || orderedIds.length === 0) {
        usageError('label reorder requires ordered label IDs', 'Run: craft-agent label reorder --parent root bug feature docs')
      }

      reorderLabels(workspaceRootPath, parentId ?? null, orderedIds)
      return { reordered: orderedIds, parent: parentId ?? null }
    }

    if (action === 'auto-rule-list') {
      const labelId = positional[0]
      if (!labelId) usageError('label auto-rule-list requires <id>', 'Run: craft-agent label auto-rule-list <id>')
      const { label } = getLabelOrThrow(workspaceRootPath, labelId)
      return { labelId, autoRules: label.autoRules ?? [] }
    }

    if (action === 'auto-rule-add') {
      const labelId = positional[0]
      if (!labelId) usageError('label auto-rule-add requires <id>', 'Run: craft-agent label auto-rule-add <id> --pattern "..."')

      const pattern = (structured.pattern ?? options.pattern) as string | undefined
      if (!pattern?.trim()) usageError('label auto-rule-add requires --pattern "..."')

      const rule: AutoLabelRule = {
        pattern,
        ...(typeof (structured.flags ?? options.flags) === 'string' ? { flags: String(structured.flags ?? options.flags) } : {}),
        ...(typeof (structured.valueTemplate ?? options['value-template']) === 'string'
          ? { valueTemplate: String(structured.valueTemplate ?? options['value-template']) }
          : {}),
        ...(typeof (structured.description ?? options.description) === 'string'
          ? { description: String(structured.description ?? options.description) }
          : {}),
      }

      const { config, label } = getLabelOrThrow(workspaceRootPath, labelId)
      label.autoRules = [...(label.autoRules ?? []), rule]
      validateAndSaveLabelConfig(workspaceRootPath, config)
      return { labelId, autoRules: label.autoRules }
    }

    if (action === 'auto-rule-remove') {
      const labelId = positional[0]
      if (!labelId) usageError('label auto-rule-remove requires <id>', 'Run: craft-agent label auto-rule-remove <id> --index 0')

      const indexRaw = (structured.index ?? options.index) as string | number | undefined
      const index = typeof indexRaw === 'number' ? indexRaw : Number.parseInt(String(indexRaw ?? ''), 10)
      if (!Number.isFinite(index)) usageError('label auto-rule-remove requires --index <n>')

      const { config, label } = getLabelOrThrow(workspaceRootPath, labelId)
      const existing = label.autoRules ?? []
      if (index < 0 || index >= existing.length) {
        usageError(`auto-rule index out of range: ${index}`, `Valid range: 0..${Math.max(existing.length - 1, 0)}`)
      }

      const removed = existing[index]
      label.autoRules = existing.filter((_, i) => i !== index)
      if (label.autoRules.length === 0) delete label.autoRules
      validateAndSaveLabelConfig(workspaceRootPath, config)
      return { labelId, removed, autoRules: label.autoRules ?? [] }
    }

    if (action === 'auto-rule-clear') {
      const labelId = positional[0]
      if (!labelId) usageError('label auto-rule-clear requires <id>', 'Run: craft-agent label auto-rule-clear <id>')
      const { config, label } = getLabelOrThrow(workspaceRootPath, labelId)
      const clearedCount = label.autoRules?.length ?? 0
      delete label.autoRules
      validateAndSaveLabelConfig(workspaceRootPath, config)
      return { labelId, clearedCount, autoRules: [] }
    }

    if (action === 'auto-rule-validate') {
      const labelId = positional[0]
      if (!labelId) usageError('label auto-rule-validate requires <id>', 'Run: craft-agent label auto-rule-validate <id>')
      const { config, label } = getLabelOrThrow(workspaceRootPath, labelId)
      const validation = validateLabelsContent(JSON.stringify(config))
      const ruleIssues = [...validation.errors, ...validation.warnings].filter(issue =>
        issue.path.includes(`${labelId}`) || issue.path.includes('autoRules')
      )
      return {
        labelId,
        valid: validation.valid,
        autoRules: label.autoRules ?? [],
        issues: ruleIssues,
      }
    }

    usageError(`Unhandled label action: ${action}`)
  },
}
