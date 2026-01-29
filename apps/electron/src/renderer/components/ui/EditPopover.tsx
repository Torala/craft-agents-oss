/**
 * EditPopover
 *
 * A popover with title, subtitle, and multiline textarea for editing settings.
 * Supports two modes:
 * - Legacy: Opens a new focused window with a chat session
 * - Inline: Executes mini agent inline within the popover (for mini agent configs)
 */

import * as React from 'react'
import { useState, useRef, useEffect, useCallback } from 'react'
import { ArrowUp, GripHorizontal } from 'lucide-react'
import { Popover, PopoverTrigger, PopoverContent } from './popover'
import { Button } from './button'
import { cn } from '@/lib/utils'
import { usePlatform, InlineExecution, mapToolEventToActivity, type InlineActivityItem, type InlineExecutionStatus } from '@craft-agent/ui'
import type { ContentBadge, SessionEvent } from '../../../shared/types'
import { useActiveWorkspace } from '@/context/AppShellContext'

/**
 * Context passed to the new chat session so the agent knows exactly
 * what is being edited and can execute quickly.
 *
 * Simplified structure: label for display, filePath for the agent to know
 * where to edit, and optional context for additional instructions.
 */
export interface EditContext {
  /** Human-readable label for badge display and agent context (e.g., "Permissions") */
  label: string
  /** Absolute path to the file being edited */
  filePath: string
  /** Optional additional context/instructions for the agent */
  context?: string
}

/* ============================================================================
 * EDIT CONTEXT REGISTRY - SINGLE SOURCE OF TRUTH
 * ============================================================================
 * ALL edit contexts MUST be defined here. This is the canonical location.
 *
 * DO NOT create EditContext objects inline elsewhere in the codebase.
 * Instead, use getEditConfig() exported from this file.
 *
 * To add a new edit context:
 * 1. Add a new key to EditContextKey type
 * 2. Add the config to EDIT_CONFIGS
 * 3. Use via getEditConfig(key, location)
 *
 * This pattern ensures:
 * - All edit prompts and examples are reviewed in one place
 * - Consistent messaging to the agent
 * - Easy updates when context format changes
 * ============================================================================ */

/** Available edit context keys - add new ones here */
export type EditContextKey =
  | 'workspace-permissions'
  | 'default-permissions'
  | 'skill-instructions'
  | 'skill-metadata'
  | 'source-guide'
  | 'source-config'
  | 'source-permissions'
  | 'source-tool-permissions'
  | 'preferences-notes'
  | 'add-source'
  | 'add-source-api'   // Filter-specific: user is viewing APIs
  | 'add-source-mcp'   // Filter-specific: user is viewing MCPs
  | 'add-source-local' // Filter-specific: user is viewing Local Folders
  | 'add-skill'
  | 'edit-statuses'
  | 'edit-labels'
  | 'edit-auto-rules'
  | 'add-label'
  | 'edit-views'
  | 'edit-tool-icons'

/**
 * Full edit configuration including context for agent and example for UI.
 * Returned by getEditConfig() for use in EditPopover.
 */
export interface EditConfig {
  /** Context passed to the agent */
  context: EditContext
  /** Example text shown in the popover placeholder */
  example: string
  /** Optional custom placeholder text - overrides the default "Describe what you'd like to change" */
  overridePlaceholder?: string
  /** Optional model for mini agent (e.g., 'haiku', 'sonnet') */
  model?: string
  /** Optional system prompt preset for mini agent (e.g., 'mini' for focused edits) */
  systemPromptPreset?: 'default' | 'mini'
  /** When true, executes inline within the popover instead of opening a new window */
  inlineExecution?: boolean
}

/**
 * Registry of all edit configurations.
 * Each entry contains all strings needed for the edit popover and agent context.
 */
const EDIT_CONFIGS: Record<EditContextKey, (location: string) => EditConfig> = {
  'workspace-permissions': (location) => ({
    context: {
      label: 'Permission Settings',
      filePath: `${location}/permissions.json`,
      context:
        'The user is on the Settings Screen and pressed the edit button on Workspace Permission settings. ' +
        'Their intent is likely to update the setting immediately unless otherwise specified. ' +
        'The permissions.json file configures Explore mode rules. It can contain: allowedBashPatterns, ' +
        'allowedMcpPatterns, allowedApiEndpoints, blockedTools, and allowedWritePaths. ' +
        'After editing, call config_validate with target "permissions" to verify the changes. ' +
        'Confirm clearly when done.',
    },
    example: "Allow running 'make build' in Explore mode",
  }),

  'default-permissions': (location) => ({
    context: {
      label: 'Default Permissions',
      filePath: location, // location is the full path for default permissions
      context:
        'The user is editing app-level default permissions (~/.craft-agent/permissions/default.json). ' +
        'This file configures Explore mode rules that apply to ALL workspaces. ' +
        'It can contain: allowedBashPatterns, allowedMcpPatterns, allowedApiEndpoints, blockedTools, and allowedWritePaths. ' +
        'Each pattern can be a string or an object with pattern and comment fields. ' +
        'Be careful - these are app-wide defaults. ' +
        'After editing, call config_validate with target "permissions" to verify the changes. ' +
        'Confirm clearly when done.',
    },
    example: 'Allow git fetch command',
  }),

  // Skill editing contexts
  'skill-instructions': (location) => ({
    context: {
      label: 'Skill Instructions',
      filePath: `${location}/SKILL.md`,
      context:
        'The user is editing skill instructions in SKILL.md. ' +
        'IMPORTANT: Preserve the YAML frontmatter (between --- markers) at the top of the file. ' +
        'Focus on editing the markdown content after the frontmatter. ' +
        'The skill instructions guide the AI on how to use this skill. ' +
        'After editing, call skill_validate with the skill slug to verify the changes. ' +
        'Confirm clearly when done.',
    },
    example: 'Add error handling guidelines',
  }),

  'skill-metadata': (location) => ({
    context: {
      label: 'Skill Metadata',
      filePath: `${location}/SKILL.md`,
      context:
        'The user is editing skill metadata in the YAML frontmatter of SKILL.md. ' +
        'Frontmatter fields: name (required), description (required), globs (optional array), alwaysAllow (optional array). ' +
        'Keep the content after the frontmatter unchanged unless specifically requested. ' +
        'After editing, call skill_validate with the skill slug to verify the changes. ' +
        'Confirm clearly when done.',
    },
    example: 'Update the skill description',
  }),

  // Source editing contexts
  'source-guide': (location) => ({
    context: {
      label: 'Source Documentation',
      filePath: `${location}/guide.md`,
      context:
        'The user is editing source documentation (guide.md). ' +
        'This file provides context to the AI about how to use this source - rate limits, API patterns, best practices. ' +
        'Keep content clear and actionable. ' +
        'Confirm clearly when done.',
    },
    example: 'Add rate limit documentation',
  }),

  'source-config': (location) => ({
    context: {
      label: 'Source Configuration',
      filePath: `${location}/config.json`,
      context:
        'The user is editing source configuration (config.json). ' +
        'Be careful with JSON syntax. Fields include: type, slug, name, tagline, iconUrl, and transport-specific settings (mcp, api, local). ' +
        'Do NOT modify the slug unless explicitly requested. ' +
        'After editing, call source_test with the source slug to verify the configuration. ' +
        'Confirm clearly when done.',
    },
    example: 'Update the display name',
  }),

  'source-permissions': (location) => ({
    context: {
      label: 'Source Permissions',
      filePath: `${location}/permissions.json`,
      context:
        'The user is editing source-level permissions (permissions.json). ' +
        'These rules are auto-scoped to this source - write simple patterns without prefixes. ' +
        'For MCP: use allowedMcpPatterns (e.g., "list", "get"). For API: use allowedApiEndpoints. ' +
        'After editing, call config_validate with target "permissions" and the source slug to verify the changes. ' +
        'Confirm clearly when done.',
    },
    example: 'Allow list operations in Explore mode',
  }),

  'source-tool-permissions': (location) => ({
    context: {
      label: 'Tool Permissions',
      filePath: `${location}/permissions.json`,
      context:
        'The user is viewing the Tools list for an MCP source and wants to modify tool permissions. ' +
        'Edit the permissions.json file to control which tools are allowed in Explore mode. ' +
        'Use allowedMcpPatterns to allow specific tools (e.g., ["list_*", "get_*"] for read-only). ' +
        'Use blockedTools to explicitly block specific tools. ' +
        'Patterns are auto-scoped to this source. ' +
        'After editing, call config_validate with target "permissions" and the source slug to verify the changes. ' +
        'Confirm clearly when done.',
    },
    example: 'Only allow read operations (list, get, search)',
  }),

  // Preferences editing context
  'preferences-notes': (location) => ({
    context: {
      label: 'Preferences Notes',
      filePath: location, // location is the full path for preferences
      context:
        'The user is editing the notes field in their preferences (~/.craft-agent/preferences.json). ' +
        'This is a JSON file. Only modify the "notes" field unless explicitly asked otherwise. ' +
        'The notes field is free-form text that provides context about the user to the AI. ' +
        'After editing, call config_validate with target "preferences" to verify the changes. ' +
        'Confirm clearly when done.',
    },
    example: 'Add coding style preferences',
  }),

  // Add new source/skill contexts - use overridePlaceholder for inspiring, contextual prompts
  'add-source': (location) => ({
    context: {
      label: 'Add Source',
      filePath: `${location}/sources/`, // location is the workspace root path
      context:
        'The user wants to add a new source to their workspace. ' +
        'Sources can be MCP servers (HTTP/SSE or stdio), REST APIs, or local filesystems. ' +
        'Ask clarifying questions if needed: What service? MCP or API? Auth type? ' +
        'Create the source folder and config.json in the workspace sources directory. ' +
        'Follow the patterns in ~/.craft-agent/docs/sources.md. ' +
        'After creating the source, call source_test with the source slug to verify the configuration.',
    },
    example: 'Connect to my Craft space',
    overridePlaceholder: 'What would you like to connect?',
  }),

  // Filter-specific add-source contexts: user is viewing a filtered list and wants to add that type
  'add-source-api': (location) => ({
    context: {
      label: 'Add API',
      filePath: `${location}/sources/`,
      context:
        'The user is viewing API sources and wants to add a new REST API. ' +
        'Default to creating an API source (type: "api") unless they specify otherwise. ' +
        'APIs connect to REST endpoints with authentication (bearer, header, basic, or query). ' +
        'Ask about the API endpoint URL and auth type. ' +
        'Create the source folder and config.json in the workspace sources directory. ' +
        'Follow the patterns in ~/.craft-agent/docs/sources.md. ' +
        'After creating the source, call source_test with the source slug to verify the configuration.',
    },
    example: 'Connect to the OpenAI API',
    overridePlaceholder: 'What API would you like to connect?',
  }),

  'add-source-mcp': (location) => ({
    context: {
      label: 'Add MCP Server',
      filePath: `${location}/sources/`,
      context:
        'The user is viewing MCP sources and wants to add a new MCP server. ' +
        'Default to creating an MCP source (type: "mcp") unless they specify otherwise. ' +
        'MCP servers can use HTTP/SSE transport (remote) or stdio transport (local subprocess). ' +
        'Ask about the service they want to connect to and whether it\'s a remote URL or local command. ' +
        'Create the source folder and config.json in the workspace sources directory. ' +
        'Follow the patterns in ~/.craft-agent/docs/sources.md. ' +
        'After creating the source, call source_test with the source slug to verify the configuration.',
    },
    example: 'Connect to Linear',
    overridePlaceholder: 'What MCP server would you like to connect?',
  }),

  'add-source-local': (location) => ({
    context: {
      label: 'Add Local Folder',
      filePath: `${location}/sources/`,
      context:
        'The user wants to add a local folder source. ' +
        'First, look up the guide: mcp__craft-agents-docs__SearchCraftAgents({ query: "filesystem" }). ' +
        'Local folders are bookmarks - use type: "local" with a local.path field. ' +
        'They use existing Read, Write, Glob, Grep tools - no MCP server needed. ' +
        'If unclear, ask about the folder path they want to connect. ' +
        'Create the source folder and config.json in the workspace sources directory. ' +
        'Follow the patterns in ~/.craft-agent/docs/sources.md. ' +
        'After creating the source, call source_test with the source slug to verify the configuration.',
    },
    example: 'Connect to my Obsidian vault',
    overridePlaceholder: 'What folder would you like to connect?',
  }),

  'add-skill': (location) => ({
    context: {
      label: 'Add Skill',
      filePath: `${location}/skills/`, // location is the workspace root path
      context:
        'The user wants to add a new skill to their workspace. ' +
        'Skills are specialized instructions with a SKILL.md file containing YAML frontmatter (name, description) and markdown instructions. ' +
        'Ask clarifying questions if needed: What should the skill do? When should it trigger? ' +
        'Create the skill folder and SKILL.md in the workspace skills directory. ' +
        'Follow the patterns in ~/.craft-agent/docs/skills.md. ' +
        'After creating the skill, call skill_validate with the skill slug to verify the SKILL.md file.',
    },
    example: 'Review PRs following our code standards',
    overridePlaceholder: 'What should I learn to do?',
  }),

  // Status configuration context
  'edit-statuses': (location) => ({
    context: {
      label: 'Status Configuration',
      filePath: `${location}/statuses/config.json`,
      context:
        'The user wants to customize session statuses (workflow states). ' +
        'Statuses are stored in statuses/config.json with fields: id, label, icon, category (open/closed), order, isFixed, isDefault. ' +
        'Fixed statuses (todo, done, cancelled) cannot be deleted but can be reordered or have their label changed. ' +
        'Icon can be { type: "file", value: "name.svg" } for custom icons in statuses/icons/ or { type: "lucide", value: "icon-name" } for Lucide icons. ' +
        'Category "open" shows in inbox, "closed" shows in archive. ' +
        'After editing, call config_validate with target "statuses" to verify the changes. ' +
        'Confirm clearly when done.',
    },
    example: 'Add a "Blocked" status',
    model: 'haiku',               // Use fast model for quick config edits
    systemPromptPreset: 'mini',   // Use focused mini prompt
    inlineExecution: true,        // Execute inline in popover
  }),

  // Label configuration context
  'edit-labels': (location) => ({
    context: {
      label: 'Label Configuration',
      filePath: `${location}/labels/config.json`,
      context:
        'The user wants to customize session labels (tagging/categorization). ' +
        'Labels are stored in labels/config.json as a hierarchical tree. ' +
        'Each label has: id (slug, globally unique), name (display), color (optional EntityColor), children (sub-labels array). ' +
        'Colors use EntityColor format: string shorthand (e.g. "blue") or { light, dark } object for theme-aware colors. ' +
        'Labels are color-only (no icons) — rendered as colored circles in the UI. ' +
        'Children form a recursive tree structure — array position determines display order. ' +
        'Read ~/.craft-agent/docs/labels.md for full format reference. ' +
        'Confirm clearly when done.',
    },
    example: 'Add a "Bug" label with red color',
    model: 'haiku',               // Use fast model for quick config edits
    systemPromptPreset: 'mini',   // Use focused mini prompt
    inlineExecution: true,        // Execute inline in popover
  }),

  // Auto-label rules context (focused on regex patterns within labels)
  'edit-auto-rules': (location) => ({
    context: {
      label: 'Auto-Apply Rules',
      filePath: `${location}/labels/config.json`,
      context:
        'The user wants to edit auto-apply rules (regex patterns that auto-tag sessions). ' +
        'Rules live inside the autoRules array on individual labels in labels/config.json. ' +
        'Each rule has: pattern (regex with capture groups), flags (default "gi"), valueTemplate ($1/$2 substitution), description. ' +
        'Multiple rules on the same label = multiple ways to trigger. The "g" flag is always enforced. ' +
        'Avoid catastrophic backtracking patterns (e.g., (a+)+). ' +
        'Read ~/.craft-agent/docs/labels.md for full format reference. ' +
        'Confirm clearly when done.',
    },
    example: 'Add a rule to detect GitHub issue URLs',
    model: 'haiku',               // Use fast model for quick config edits
    systemPromptPreset: 'mini',   // Use focused mini prompt
    inlineExecution: true,        // Execute inline in popover
  }),

  // Add new label context (triggered from the # menu when no labels match)
  'add-label': (location) => ({
    context: {
      label: 'Add Label',
      filePath: `${location}/labels/config.json`,
      context:
        'The user wants to create a new label from the # inline menu. ' +
        'Labels are stored in labels/config.json as a hierarchical tree. ' +
        'Each label has: id (slug, globally unique), name (display), color (optional EntityColor), children (sub-labels array). ' +
        'Colors use EntityColor format: string shorthand (e.g. "blue") or { light, dark } object for theme-aware colors. ' +
        'Labels are color-only (no icons) — rendered as colored circles in the UI. ' +
        'Read ~/.craft-agent/docs/labels.md for full format reference. ' +
        'Confirm clearly when done.',
    },
    example: 'A red "Bug" label',
    overridePlaceholder: 'What label would you like to create?',
    model: 'haiku',               // Use fast model for quick config edits
    systemPromptPreset: 'mini',   // Use focused mini prompt
    inlineExecution: true,        // Execute inline in popover
  }),

  // Views configuration context
  'edit-views': (location) => ({
    context: {
      label: 'Views Configuration',
      filePath: `${location}/views.json`,
      context:
        'The user wants to edit views (dynamic, expression-based filters). ' +
        'Views are stored in views.json at the workspace root under a "views" array. ' +
        'Each view has: id (unique slug), name (display text), description (optional), color (optional EntityColor), expression (Filtrex string). ' +
        'Expressions are evaluated against session context fields: name, preview, todoState, permissionMode, model, lastMessageRole, ' +
        'lastUsedAt, createdAt, messageCount, labelCount, isFlagged, hasUnread, isProcessing, hasPendingPlan, tokenUsage.*, labels. ' +
        'Available functions: daysSince(timestamp), contains(array, value). ' +
        'Colors use EntityColor format: string shorthand (e.g. "orange") or { light, dark } object. ' +
        'Confirm clearly when done.',
    },
    example: 'Add a "Stale" view for sessions inactive > 7 days',
    model: 'haiku',               // Use fast model for quick config edits
    systemPromptPreset: 'mini',   // Use focused mini prompt
    inlineExecution: true,        // Execute inline in popover
  }),

  // Tool icons configuration context
  'edit-tool-icons': (location) => ({
    context: {
      label: 'Tool Icons',
      filePath: location, // location is the full path to tool-icons.json
      context:
        'The user wants to edit CLI tool icon mappings. ' +
        'The file is tool-icons.json in ~/.craft-agent/tool-icons/. Icon image files live in the same directory. ' +
        'Schema: { version: 1, tools: [{ id, displayName, icon, commands }] }. ' +
        'Each tool has: id (unique slug), displayName (shown in UI), icon (filename like "git.ico"), commands (array of CLI command names). ' +
        'Supported icon formats: .png, .ico, .svg, .jpg. Icons display at 20x20px. ' +
        'Read ~/.craft-agent/docs/tool-icons.md for full format reference. ' +
        'After editing, call config_validate with target "tool-icons" to verify the changes are valid. ' +
        'Confirm clearly when done.',
    },
    example: 'Add an icon for my custom CLI tool "deploy"',
    model: 'haiku',               // Use fast model for quick config edits
    systemPromptPreset: 'mini',   // Use focused mini prompt
    inlineExecution: true,        // Execute inline in popover
  }),
}

/**
 * Get full edit config by key. Returns both context (for agent) and example (for UI).
 *
 * @param key - The edit context key
 * @param location - Base path (e.g., workspace root path)
 *
 * @example
 * const { context, example } = getEditConfig('workspace-permissions', workspace.rootPath)
 */
export function getEditConfig(key: EditContextKey, location: string): EditConfig {
  const factory = EDIT_CONFIGS[key]
  if (!factory) {
    throw new Error(`Unknown edit context key: ${key}. Add it to EDIT_CONFIGS in EditPopover.tsx`)
  }
  return factory(location)
}

/**
 * Optional secondary action button displayed on the left side of the popover footer.
 * Styled as plain text with underline on hover - typically used for "Edit File" actions.
 */
export interface SecondaryAction {
  /** Button label (e.g., "Edit File") */
  label: string
  /** File path to open directly in the system editor (bypasses link interceptor) */
  filePath: string
}

export interface EditPopoverProps {
  /** Trigger element that opens the popover */
  trigger: React.ReactNode
  /** Example text shown in placeholder (e.g., "Allow 'make build' command") */
  example?: string
  /** Context passed to the new chat session */
  context: EditContext
  /** Permission mode for the new session (default: 'allow-all' for fast execution) */
  permissionMode?: 'safe' | 'ask' | 'allow-all'
  /**
   * Working directory for the new session:
   * - 'none' (default): No working directory (session folder only) - best for config edits
   * - 'user_default': Use workspace's configured default
   * - Absolute path string: Use this specific path
   */
  workingDirectory?: string | 'user_default' | 'none'
  /** Model override for mini agent (e.g., 'haiku', 'sonnet') */
  model?: string
  /** System prompt preset for mini agent (e.g., 'mini' for focused edits) */
  systemPromptPreset?: 'default' | 'mini'
  /** Width of the popover (default: 320) */
  width?: number
  /** Additional className for the trigger */
  triggerClassName?: string
  /** Side of the popover relative to trigger */
  side?: 'top' | 'right' | 'bottom' | 'left'
  /** Alignment of the popover */
  align?: 'start' | 'center' | 'end'
  /** Optional secondary action button on the left (e.g., "Edit File") */
  secondaryAction?: SecondaryAction
  /** Optional custom placeholder - overrides the default "Describe what you'd like to change" */
  overridePlaceholder?: string
  /**
   * Controlled open state - when provided, the popover becomes controlled.
   * Use this when opening the popover programmatically (e.g., from context menus).
   */
  open?: boolean
  /** Callback when open state changes (for controlled mode) */
  onOpenChange?: (open: boolean) => void
  /**
   * When true, prevents the popover from closing when clicking outside.
   * Useful for context menu triggered popovers where focus management is tricky.
   */
  modal?: boolean
  /**
   * Default value to pre-fill the input with.
   * Useful when the user types something (e.g., "#Test") and clicks "Add new label" -
   * the input can be pre-filled with "Add new label Test".
   */
  defaultValue?: string
  /**
   * When true, executes the mini agent inline within the popover instead of
   * opening a new window. Best for quick config edits with mini agents.
   */
  inlineExecution?: boolean
}

/**
 * Result from buildEditPrompt containing both the full prompt and badge metadata
 * for hiding the XML context in the UI while keeping it in the actual message.
 */
interface EditPromptResult {
  /** Full prompt including XML metadata and user instructions */
  prompt: string
  /** Badge marking the hidden metadata section */
  badges: ContentBadge[]
}

/**
 * Build the prompt that will be sent to the agent.
 * Uses XML-like tags for clear structure.
 *
 * Returns both the prompt and a context badge that marks the metadata section
 * so it can be hidden in the UI while still being sent to the agent.
 *
 * @param context - The edit context with label, filePath, and optional context
 * @param userInstructions - User's instructions (can be empty string for pre-filled context only)
 *
 * @example
 * // With user instructions (for EditPopover submit)
 * const { prompt, badges } = buildEditPrompt(context, "Add a Blocked status")
 *
 * // Without user instructions (for context menu - opens window with context pre-filled)
 * const { prompt, badges } = buildEditPrompt(context, "")
 */
export function buildEditPrompt(context: EditContext, userInstructions: string): EditPromptResult {
  // Build the metadata section (will be hidden by badge)
  // Simple structure: label (for display/context), file (where to edit), optional context
  const metadataSection = `<edit_request>
<label>${context.label}</label>
<file>${context.filePath}</file>
${context.context ? `<context>${context.context}</context>\n` : ''}</edit_request>

`

  // Badge display: just the label (no "Edit:" prefix for cleaner appearance)
  const collapsedLabel = context.label

  // Full prompt = metadata + user instructions
  const prompt = metadataSection + userInstructions

  // Create badge marking the metadata section (start=0, end=metadata length)
  const badge: ContentBadge = {
    type: 'context',
    label: collapsedLabel,
    rawText: metadataSection,
    start: 0,
    end: metadataSection.length,
    collapsedLabel,
  }

  return { prompt, badges: [badge] }
}

export function EditPopover({
  trigger,
  example,
  context,
  permissionMode = 'allow-all',
  workingDirectory = 'none', // Default to session folder for config edits
  model,
  systemPromptPreset,
  width = 320,
  triggerClassName,
  side = 'bottom',
  align = 'end',
  secondaryAction,
  overridePlaceholder,
  open: controlledOpen,
  onOpenChange: controlledOnOpenChange,
  modal = false,
  defaultValue = '',
  inlineExecution = false,
}: EditPopoverProps) {
  // Open files externally (bypasses link interceptor) for "Edit File" secondary actions
  const { onOpenFileExternal } = usePlatform()
  const workspace = useActiveWorkspace()

  // Build placeholder: use override if provided, otherwise default to "change" wording
  // overridePlaceholder allows contexts like add-source/add-skill to say "add" instead of "change"
  const basePlaceholder = overridePlaceholder ?? "Describe what you'd like to change..."
  const placeholder = example
    ? `${basePlaceholder.replace(/\.{3}$/, '')}, e.g., "${example}"`
    : basePlaceholder
  // Support both controlled and uncontrolled modes:
  // - Uncontrolled (default): internal state manages open/close
  // - Controlled: parent manages state via open/onOpenChange props
  const [internalOpen, setInternalOpen] = useState(false)
  const isControlled = controlledOpen !== undefined
  const open = isControlled ? controlledOpen : internalOpen
  const setOpen = (value: boolean) => {
    if (isControlled) {
      controlledOnOpenChange?.(value)
    } else {
      setInternalOpen(value)
    }
  }
  const [input, setInput] = useState('')
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  // Inline execution state
  type PopoverMode = 'input' | 'executing' | 'success' | 'error'
  const [popoverMode, setPopoverMode] = useState<PopoverMode>('input')
  const [inlineSessionId, setInlineSessionId] = useState<string | null>(null)
  const [activities, setActivities] = useState<InlineActivityItem[]>([])
  const [executionResult, setExecutionResult] = useState<string | undefined>()
  const [executionError, setExecutionError] = useState<string | undefined>()

  // Drag state for movable popover
  const [dragOffset, setDragOffset] = useState({ x: 0, y: 0 })
  const [isDragging, setIsDragging] = useState(false)
  const dragStartRef = useRef({ x: 0, y: 0, offsetX: 0, offsetY: 0 })
  const popoverRef = useRef<HTMLDivElement>(null)

  // Reset drag position when popover opens
  useEffect(() => {
    if (open) {
      setDragOffset({ x: 0, y: 0 })
    }
  }, [open])

  // Handle drag events
  const handleDragStart = useCallback((e: React.MouseEvent) => {
    e.preventDefault()
    setIsDragging(true)
    dragStartRef.current = {
      x: e.clientX,
      y: e.clientY,
      offsetX: dragOffset.x,
      offsetY: dragOffset.y,
    }
  }, [dragOffset])

  useEffect(() => {
    if (!isDragging) return

    const handleMouseMove = (e: MouseEvent) => {
      const deltaX = e.clientX - dragStartRef.current.x
      const deltaY = e.clientY - dragStartRef.current.y
      setDragOffset({
        x: dragStartRef.current.offsetX + deltaX,
        y: dragStartRef.current.offsetY + deltaY,
      })
    }

    const handleMouseUp = () => {
      setIsDragging(false)
    }

    document.addEventListener('mousemove', handleMouseMove)
    document.addEventListener('mouseup', handleMouseUp)
    return () => {
      document.removeEventListener('mousemove', handleMouseMove)
      document.removeEventListener('mouseup', handleMouseUp)
    }
  }, [isDragging])

  // Auto-focus textarea when popover opens
  useEffect(() => {
    if (open) {
      // Small delay to let the popover render and avoid focus race conditions
      const timer = setTimeout(() => {
        textareaRef.current?.focus()
      }, 0)
      return () => clearTimeout(timer)
    }
  }, [open])

  // Reset state when popover closes
  useEffect(() => {
    if (open) {
      setInput(defaultValue)
      setPopoverMode('input')
      setInlineSessionId(null)
      setActivities([])
      setExecutionResult(undefined)
      setExecutionError(undefined)
    } else {
      setInput('')
    }
  }, [open, defaultValue])

  // Subscribe to session events for inline execution
  useEffect(() => {
    if (!inlineSessionId || !inlineExecution) return

    const cleanup = window.electronAPI.onSessionEvent((event: SessionEvent) => {
      if (event.sessionId !== inlineSessionId) return

      switch (event.type) {
        case 'tool_start': {
          // Derive description from toolIntent or toolInput
          let description = event.toolIntent
          if (!description && event.toolInput) {
            // Fallback to meaningful info from toolInput for built-in tools
            const input = event.toolInput
            if (input.file_path) {
              // Read, Edit, Write - show full path
              description = input.file_path as string
            } else if (input.description) {
              // Bash - use the description field
              description = input.description as string
            } else if (input.pattern) {
              // Grep/Glob - show pattern
              description = input.pattern as string
            }
          }
          // Only add activity if we have meaningful description
          if (description) {
            setActivities(prev => [
              ...prev,
              mapToolEventToActivity(
                event.toolDisplayName || event.toolName,
                event.toolUseId,
                'running',
                description
              )
            ])
          }
          break
        }

        case 'tool_result':
          setActivities(prev =>
            prev.map(a =>
              a.id === event.toolUseId
                ? { ...a, status: event.isError ? 'error' : 'completed' }
                : a
            )
          )
          break

        case 'text_complete':
          // Capture final non-intermediate text as result
          if (!event.isIntermediate && event.text) {
            setExecutionResult(event.text)
          }
          break

        case 'complete':
          setPopoverMode('success')
          break

        case 'error':
          setExecutionError(event.error)
          setPopoverMode('error')
          break

        case 'interrupted':
          setExecutionError('Execution was interrupted')
          setPopoverMode('error')
          break
      }
    })

    return cleanup
  }, [inlineSessionId, inlineExecution])

  const handleSubmit = async () => {
    if (!input.trim()) return

    const { prompt, badges } = buildEditPrompt(context, input.trim())

    // Inline execution mode: create session and send message via IPC
    if (inlineExecution && workspace) {
      setPopoverMode('executing')
      setActivities([])

      try {
        // Create session with mini agent options
        const session = await window.electronAPI.createSession(workspace.id, {
          model: model || 'haiku',
          systemPromptPreset: systemPromptPreset || 'mini',
          permissionMode: permissionMode,
          workingDirectory: workingDirectory,
        })

        setInlineSessionId(session.id)

        // Send the message to start execution
        await window.electronAPI.sendMessage(session.id, prompt, [], [], { badges })
      } catch (error) {
        console.error('[EditPopover] Inline execution failed:', error)
        setExecutionError(error instanceof Error ? error.message : 'Failed to start execution')
        setPopoverMode('error')
      }
      return
    }

    // Legacy mode: open new focused window
    const encodedInput = encodeURIComponent(prompt)
    // Encode badges as JSON for passing through deep link
    const encodedBadges = encodeURIComponent(JSON.stringify(badges))

    // Open new focused window with auto-send
    // The ?window=focused creates a smaller window (900x700) focused on single session
    // The &send=true auto-sends the message immediately
    // The &mode= sets the permission mode for the new session
    // The &badges= passes badge metadata for hiding the XML context in UI
    // The &workdir= sets the working directory (user_default, none, or absolute path)
    // The &model= sets the model for mini agents (e.g., 'haiku')
    // The &systemPrompt= sets the system prompt preset (e.g., 'mini')
    const workdirParam = workingDirectory ? `&workdir=${encodeURIComponent(workingDirectory)}` : ''
    const modelParam = model ? `&model=${encodeURIComponent(model)}` : ''
    const systemPromptParam = systemPromptPreset ? `&systemPrompt=${encodeURIComponent(systemPromptPreset)}` : ''
    const url = `craftagents://action/new-chat?window=focused&input=${encodedInput}&send=true&mode=${permissionMode}&badges=${encodedBadges}${workdirParam}${modelParam}${systemPromptParam}`

    try {
      await window.electronAPI.openUrl(url)
    } catch (error) {
      console.error('[EditPopover] Failed to open new chat window:', error)
    }

    // Close the popover
    setOpen(false)
  }

  // Inline execution callbacks
  const handleCancel = useCallback(async () => {
    if (inlineSessionId) {
      try {
        await window.electronAPI.cancelProcessing(inlineSessionId)
      } catch (error) {
        console.error('[EditPopover] Failed to cancel:', error)
      }
    }
    setPopoverMode('input')
    setActivities([])
  }, [inlineSessionId])

  const handleDismiss = useCallback(() => {
    setOpen(false)
  }, [setOpen])

  const handleRetry = useCallback(() => {
    setPopoverMode('input')
    setActivities([])
    setExecutionError(undefined)
    // Focus the textarea for retry
    setTimeout(() => textareaRef.current?.focus(), 0)
  }, [])

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    // Enter submits, Shift+Enter inserts newline
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleSubmit()
    }
    // Escape closes the popover
    if (e.key === 'Escape') {
      setOpen(false)
    }
  }

  return (
    <>
      {/* Subtle backdrop when popover is open — rendered outside Popover to avoid
        * stacking context issues. Uses CSS @keyframes for reliable fade-in on mount. */}
      {open && (
        <div
          className="fixed inset-0 z-[99] pointer-events-none"
          style={{
            backgroundColor: 'rgba(0, 0, 0, 0.1)',
            animation: 'editPopoverFadeIn 100ms ease-out forwards',
          }}
          aria-hidden="true"
        />
      )}
      <Popover open={open} onOpenChange={setOpen} modal={modal}>
        <PopoverTrigger asChild className={triggerClassName}>
          {trigger}
        </PopoverTrigger>
        <PopoverContent
          ref={popoverRef}
          side={side}
          align={align}
          className="p-0"
          style={{
            width,
            borderRadius: 16,
            transform: `translate(${dragOffset.x}px, ${dragOffset.y}px)`,
          }}
        >
          {/* Drag handle */}
          <div
            onMouseDown={handleDragStart}
            className={cn(
              "flex items-center justify-center py-1.5 cursor-grab border-b border-border/30",
              isDragging && "cursor-grabbing"
            )}
          >
            <GripHorizontal className="w-4 h-4 text-muted-foreground/50" />
          </div>

          {/* Content wrapper with padding */}
          <div className="p-4 pt-2">
          {/* Inline Execution Mode */}
          {inlineExecution && popoverMode !== 'input' ? (
            <InlineExecution
              status={popoverMode as InlineExecutionStatus}
              activities={activities}
              result={executionResult}
              error={executionError}
              onCancel={handleCancel}
              onDismiss={handleDismiss}
              onRetry={handleRetry}
            />
          ) : (
            <>
              {/* Textarea */}
              <textarea
                ref={textareaRef}
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder={placeholder}
                autoFocus
                className={cn(
                  'w-full min-h-[100px] resize-none px-0 py-0 text-sm leading-relaxed',
                  'bg-transparent border-none',
                  'placeholder:text-muted-foreground placeholder:leading-relaxed',
                  'focus:outline-none focus-visible:outline-none focus-visible:ring-0',
                  'field-sizing-content'
                )}
              />

              {/* Footer row: secondary action on left, send button on right */}
              <div className="flex items-center justify-between mt-2">
                {/* Secondary action - plain text link */}
                {secondaryAction ? (
                  <button
                    type="button"
                    onClick={() => {
                      onOpenFileExternal?.(secondaryAction.filePath)
                      setOpen(false)
                    }}
                    className="text-sm text-muted-foreground hover:underline"
                  >
                    {secondaryAction.label}
                  </button>
                ) : (
                  <div />
                )}

                {/* Send button */}
                <Button
                  type="button"
                  size="icon"
                  className="h-7 w-7 rounded-full shrink-0"
                  onClick={handleSubmit}
                  disabled={!input.trim()}
                >
                  <ArrowUp className="h-4 w-4" />
                </Button>
              </div>
            </>
          )}
          </div>
        </PopoverContent>
      </Popover>
    </>
  )
}

/**
 * Standard Edit button styled for use with EditPopover.
 * Use this as the trigger prop for consistent styling across the app.
 *
 * Uses forwardRef to properly work with Radix's asChild pattern,
 * which requires the child to accept ref and spread props.
 *
 * @example
 * <EditPopover
 *   trigger={<EditButton />}
 *   context={getEditContext('workspace-permissions', { workspacePath })}
 * />
 */
export const EditButton = React.forwardRef<
  HTMLButtonElement,
  React.ComponentPropsWithoutRef<typeof Button>
>(function EditButton({ className, ...props }, ref) {
  return (
    <Button
      ref={ref}
      variant="ghost"
      size="sm"
      // Merge our base styles with any className from asChild props
      className={cn("h-8 px-3 rounded-[6px] bg-background shadow-minimal text-foreground/70 hover:text-foreground", className)}
      {...props}
    >
      Edit
    </Button>
  )
})
