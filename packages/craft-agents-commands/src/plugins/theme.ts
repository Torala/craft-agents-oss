import { existsSync, readFileSync, unlinkSync } from 'node:fs'
import {
  getAppThemePath,
  getCliDomainPolicy,
  getColorTheme,
  loadAppTheme,
  loadPresetTheme,
  loadPresetThemes,
  saveAppTheme,
  setColorTheme,
  validateThemeContent,
  validateThemeOverrideContent,
} from '@craft-agent/shared/config'
import type { ThemeOverrides } from '@craft-agent/shared/config'
import { loadWorkspaceConfig, saveWorkspaceConfig } from '@craft-agent/shared/workspaces'
import {
  assertKnownAction,
  parseStructuredInput,
  parseTokens,
  usageError,
} from '../utils.ts'
import type { CommandPlugin } from './types.ts'

const actions = [
  'get',
  'validate',
  'list-presets',
  'get-preset',
  'set-color-theme',
  'set-workspace-color-theme',
  'set-override',
  'reset-override',
] as const

const themePolicy = getCliDomainPolicy('theme')

function normalizeThemeId(raw: unknown): string {
  if (typeof raw !== 'string' || !raw.trim()) {
    usageError('theme id is required')
  }
  return raw.trim()
}

function assertKnownPreset(themeId: string): void {
  if (themeId === 'default') return
  const preset = loadPresetTheme(themeId)
  if (!preset) {
    usageError(`Theme preset not found: ${themeId}`, 'Run: craft-agent theme list-presets')
  }
}

function getWorkspaceColorTheme(workspaceRootPath: string): string | undefined {
  const config = loadWorkspaceConfig(workspaceRootPath)
  return config?.defaults?.colorTheme
}

function setWorkspaceColorTheme(workspaceRootPath: string, themeId: string | undefined): void {
  const config = loadWorkspaceConfig(workspaceRootPath)
  if (!config) {
    usageError(`Workspace config not found: ${workspaceRootPath}/config.json`)
  }

  if (!config.defaults) config.defaults = {}

  if (themeId) {
    config.defaults.colorTheme = themeId
  } else {
    delete config.defaults.colorTheme
  }

  saveWorkspaceConfig(workspaceRootPath, config)
}

export const themePlugin: CommandPlugin = {
  namespace: 'theme',
  actions,
  docsMarker: 'theme',
  docsHeading: 'Theme',
  policy: {
    preToolGuards: {
      redirectHelpCommand: themePolicy.helpCommand,
      workspacePathScopes: [...themePolicy.workspacePathScopes],
    },
    exploreAllowlist: {
      readActions: [...themePolicy.readActions],
      allowGlobalFlags: true,
    },
  },
  async execute(action, tokens, context) {
    assertKnownAction('theme', action, actions)

    const { positional, options } = parseTokens(tokens)
    const structured = parseStructuredInput(options)
    const workspaceRootPath = context.workspaceRootPath
    const appThemePath = getAppThemePath()

    if (action === 'get') {
      const workspaceColorTheme = getWorkspaceColorTheme(workspaceRootPath)
      const colorTheme = getColorTheme()
      const appOverride = loadAppTheme()

      return {
        appOverridePath: appThemePath,
        appOverrideExists: existsSync(appThemePath),
        appOverride,
        colorTheme,
        workspaceColorTheme: workspaceColorTheme ?? null,
        effectiveWorkspaceTheme: workspaceColorTheme ?? colorTheme,
      }
    }

    if (action === 'validate') {
      const presetId = (structured.preset ?? options.preset) as string | undefined

      if (presetId) {
        const preset = loadPresetTheme(presetId)
        if (!preset) usageError(`Theme preset not found: ${presetId}`, 'Run: craft-agent theme list-presets')

        const raw = readFileSync(preset.path, 'utf-8')
        const result = validateThemeContent(raw, preset.path)

        return {
          target: 'preset',
          presetId,
          path: preset.path,
          valid: result.valid,
          errors: result.errors,
          warnings: result.warnings,
        }
      }

      if (!existsSync(appThemePath)) {
        return {
          target: 'app-override',
          path: appThemePath,
          exists: false,
          valid: true,
          errors: [],
          warnings: [],
          message: 'No app override file exists (using defaults/preset only).',
        }
      }

      const raw = readFileSync(appThemePath, 'utf-8')
      const result = validateThemeOverrideContent(raw, appThemePath)
      return {
        target: 'app-override',
        path: appThemePath,
        exists: true,
        valid: result.valid,
        errors: result.errors,
        warnings: result.warnings,
      }
    }

    if (action === 'list-presets') {
      const presets = loadPresetThemes().map((preset) => ({
        id: preset.id,
        name: preset.theme.name ?? preset.id,
        description: preset.theme.description,
        supportedModes: preset.theme.supportedModes ?? ['light', 'dark'],
        hasScenic: preset.theme.mode === 'scenic',
        path: preset.path,
      }))

      return { presets }
    }

    if (action === 'get-preset') {
      const presetId = normalizeThemeId(positional[0] ?? structured.id ?? options.id)
      const preset = loadPresetTheme(presetId)
      if (!preset) usageError(`Theme preset not found: ${presetId}`, 'Run: craft-agent theme list-presets')

      return {
        preset: {
          id: preset.id,
          path: preset.path,
          theme: preset.theme,
        },
      }
    }

    if (action === 'set-color-theme') {
      const themeId = normalizeThemeId(positional[0] ?? structured.id ?? options.id)
      assertKnownPreset(themeId)

      setColorTheme(themeId)
      return { colorTheme: getColorTheme() }
    }

    if (action === 'set-workspace-color-theme') {
      const raw = normalizeThemeId(positional[0] ?? structured.id ?? options.id)
      if (raw !== 'default') {
        assertKnownPreset(raw)
      }

      const nextTheme = raw === 'default' ? undefined : raw
      setWorkspaceColorTheme(workspaceRootPath, nextTheme)

      return {
        workspaceColorTheme: getWorkspaceColorTheme(workspaceRootPath) ?? null,
      }
    }

    if (action === 'set-override') {
      if (Object.keys(structured).length === 0) {
        usageError('theme set-override requires --json with override fields', 'Run: craft-agent theme set-override --json "{...}"')
      }

      const validation = validateThemeOverrideContent(JSON.stringify(structured), appThemePath)
      if (!validation.valid) {
        usageError('Theme override is invalid', 'Fix invalid fields and retry', validation.errors)
      }

      saveAppTheme(structured as ThemeOverrides)
      return {
        appOverridePath: appThemePath,
        appOverride: loadAppTheme(),
      }
    }

    if (action === 'reset-override') {
      if (!existsSync(appThemePath)) {
        return {
          reset: false,
          appOverridePath: appThemePath,
          message: 'No app override file exists',
        }
      }

      unlinkSync(appThemePath)
      return {
        reset: true,
        appOverridePath: appThemePath,
      }
    }

    usageError(`Unhandled theme action: ${action}`)
  },
}
