/**
 * Safe Mode Configuration
 *
 * Allows customization of Safe Mode rules per workspace and per source.
 * Users can create safe-mode.json files to extend the default rules.
 *
 * File locations:
 * - Workspace: ~/.craft-agent/workspaces/{slug}/safe-mode.json
 * - Per-source: ~/.craft-agent/workspaces/{slug}/sources/{sourceSlug}/safe-mode.json
 *
 * Rules are additive - custom configs extend the defaults (more permissive).
 */

import { existsSync, readFileSync } from 'fs';
import { join } from 'path';
import { z } from 'zod';
import { debug } from '../utils/debug.ts';
import { getWorkspacePath } from '../workspaces/storage.ts';
import { getSourcePath } from '../sources/storage.ts';
import { MODE_CONFIGS } from './mode-manager.ts';

// ============================================================
// Zod Schemas
// ============================================================

/**
 * API endpoint rule - method + path pattern
 */
const ApiEndpointRuleSchema = z.object({
  method: z.enum(['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS']),
  path: z.string().describe('Regex pattern for API path'),
  comment: z.string().optional(),
});

export type ApiEndpointRule = z.infer<typeof ApiEndpointRuleSchema>;

/**
 * Pattern with optional comment
 */
const PatternSchema = z.union([
  z.string(),
  z.object({
    pattern: z.string(),
    comment: z.string().optional(),
  }),
]);

/**
 * Safe mode JSON configuration schema
 */
export const SafeModeConfigSchema = z.object({
  /** Additional tools to block */
  blockedTools: z.array(z.string()).optional(),
  /** Bash command patterns to allow (regex strings) */
  allowedBashPatterns: z.array(PatternSchema).optional(),
  /** MCP tool patterns to allow (regex strings) */
  allowedMcpPatterns: z.array(PatternSchema).optional(),
  /** API endpoint rules - method + path pattern */
  allowedApiEndpoints: z.array(ApiEndpointRuleSchema).optional(),
  /** Legacy: API methods to allow (use allowedApiEndpoints for finer control) */
  allowedApiMethods: z.array(z.string()).optional(),
});

export type SafeModeConfigFile = z.infer<typeof SafeModeConfigSchema>;

// ============================================================
// Types
// ============================================================

/**
 * Parsed and normalized safe mode configuration
 */
export interface SafeModeCustomConfig {
  /** Additional tools to block */
  blockedTools: string[];
  /** Additional bash patterns to allow (as regex strings) */
  allowedBashPatterns: string[];
  /** Additional MCP patterns to allow (as regex strings) */
  allowedMcpPatterns: string[];
  /** Additional API methods to allow (legacy, coarse-grained) */
  allowedApiMethods: string[];
  /** API endpoint rules for fine-grained control */
  allowedApiEndpoints: ApiEndpointRule[];
}

/**
 * Compiled API endpoint rule for runtime
 */
export interface CompiledApiEndpointRule {
  method: string;
  pathPattern: RegExp;
}

/**
 * Merged safe mode config for runtime use
 */
export interface MergedSafeModeConfig {
  blockedTools: Set<string>;
  readOnlyBashPatterns: RegExp[];
  readOnlyMcpPatterns: RegExp[];
  readOnlyApiMethods: Set<string>;
  /** Fine-grained API endpoint rules */
  allowedApiEndpoints: CompiledApiEndpointRule[];
  /** Display name for error messages */
  displayName: string;
  /** Keyboard shortcut hint */
  shortcutHint: string;
}

/**
 * Context for safe mode checking (includes workspace/source info)
 */
export interface SafeModeContext {
  workspaceSlug: string;
  /** Active source slugs for source-specific rules */
  activeSourceSlugs?: string[];
}

// ============================================================
// JSON Parser
// ============================================================

/**
 * Parse and validate safe-mode.json file
 */
export function parseSafeModeJson(content: string): SafeModeCustomConfig {
  const emptyConfig: SafeModeCustomConfig = {
    blockedTools: [],
    allowedBashPatterns: [],
    allowedMcpPatterns: [],
    allowedApiMethods: [],
    allowedApiEndpoints: [],
  };

  try {
    const json = JSON.parse(content);
    const result = SafeModeConfigSchema.safeParse(json);

    if (!result.success) {
      debug('[SafeMode] Validation errors:', result.error.issues);
      // Log specific errors for debugging
      for (const issue of result.error.issues) {
        debug(`[SafeMode]   - ${issue.path.join('.')}: ${issue.message}`);
      }
      return emptyConfig;
    }

    const data = result.data;

    // Normalize patterns (extract string from pattern objects)
    const normalizePatterns = (patterns: Array<string | { pattern: string; comment?: string }> | undefined): string[] => {
      if (!patterns) return [];
      return patterns.map(p => typeof p === 'string' ? p : p.pattern);
    };

    return {
      blockedTools: data.blockedTools ?? [],
      allowedBashPatterns: normalizePatterns(data.allowedBashPatterns),
      allowedMcpPatterns: normalizePatterns(data.allowedMcpPatterns),
      allowedApiMethods: data.allowedApiMethods ?? [],
      allowedApiEndpoints: data.allowedApiEndpoints ?? [],
    };
  } catch (error) {
    debug('[SafeMode] JSON parse error:', error);
    return emptyConfig;
  }
}

/**
 * Validate a regex pattern string, return null if invalid
 */
function validateRegex(pattern: string): RegExp | null {
  try {
    return new RegExp(pattern);
  } catch {
    return null;
  }
}

/**
 * Validate safe mode config and return errors
 */
export function validateSafeModeConfig(config: SafeModeConfigFile): string[] {
  const errors: string[] = [];

  // Validate regex patterns
  const checkPatterns = (patterns: Array<string | { pattern: string }> | undefined, name: string) => {
    if (!patterns) return;
    for (let i = 0; i < patterns.length; i++) {
      const p = patterns[i];
      if (!p) continue;
      const patternStr = typeof p === 'string' ? p : p.pattern;
      if (!validateRegex(patternStr)) {
        errors.push(`${name}[${i}]: Invalid regex pattern: ${patternStr}`);
      }
    }
  };

  checkPatterns(config.allowedBashPatterns, 'allowedBashPatterns');
  checkPatterns(config.allowedMcpPatterns, 'allowedMcpPatterns');

  // Validate API endpoint patterns
  if (config.allowedApiEndpoints) {
    for (let i = 0; i < config.allowedApiEndpoints.length; i++) {
      const rule = config.allowedApiEndpoints[i];
      if (!validateRegex(rule.path)) {
        errors.push(`allowedApiEndpoints[${i}].path: Invalid regex pattern: ${rule.path}`);
      }
    }
  }

  return errors;
}

// ============================================================
// Storage Functions
// ============================================================

/**
 * Get path to workspace safe-mode.json
 */
export function getWorkspaceSafeModePath(workspaceSlug: string): string {
  return join(getWorkspacePath(workspaceSlug), 'safe-mode.json');
}

/**
 * Get path to source safe-mode.json
 */
export function getSourceSafeModePath(workspaceSlug: string, sourceSlug: string): string {
  return join(getSourcePath(workspaceSlug, sourceSlug), 'safe-mode.json');
}

/**
 * Load workspace-level safe mode config
 */
export function loadWorkspaceSafeModeConfig(workspaceSlug: string): SafeModeCustomConfig | null {
  const path = getWorkspaceSafeModePath(workspaceSlug);
  if (!existsSync(path)) return null;

  try {
    const content = readFileSync(path, 'utf-8');
    const config = parseSafeModeJson(content);
    debug(`[SafeMode] Loaded workspace config from ${path}:`, config);
    return config;
  } catch (error) {
    debug(`[SafeMode] Error loading workspace config:`, error);
    return null;
  }
}

/**
 * Load source-level safe mode config
 */
export function loadSourceSafeModeConfig(
  workspaceSlug: string,
  sourceSlug: string
): SafeModeCustomConfig | null {
  const path = getSourceSafeModePath(workspaceSlug, sourceSlug);
  if (!existsSync(path)) return null;

  try {
    const content = readFileSync(path, 'utf-8');
    const config = parseSafeModeJson(content);
    debug(`[SafeMode] Loaded source config from ${path}:`, config);
    return config;
  } catch (error) {
    debug(`[SafeMode] Error loading source config:`, error);
    return null;
  }
}

// ============================================================
// API Endpoint Checking
// ============================================================

/**
 * Check if an API call is allowed by endpoint rules
 */
export function isApiEndpointAllowed(
  method: string,
  path: string,
  config: MergedSafeModeConfig
): boolean {
  const upperMethod = method.toUpperCase();

  // GET is always allowed
  if (upperMethod === 'GET') return true;

  // Check legacy method-based rules
  if (config.readOnlyApiMethods.has(upperMethod)) return true;

  // Check fine-grained endpoint rules
  for (const rule of config.allowedApiEndpoints) {
    if (rule.method === upperMethod && rule.pathPattern.test(path)) {
      return true;
    }
  }

  return false;
}

// ============================================================
// Config Cache
// ============================================================

/**
 * In-memory cache for parsed safe mode configs
 * Invalidated on file changes via ConfigWatcher
 */
class SafeModeConfigCache {
  private workspaceConfigs: Map<string, SafeModeCustomConfig | null> = new Map();
  private sourceConfigs: Map<string, SafeModeCustomConfig | null> = new Map();
  private mergedConfigs: Map<string, MergedSafeModeConfig> = new Map();

  /**
   * Get or load workspace config
   */
  getWorkspaceConfig(workspaceSlug: string): SafeModeCustomConfig | null {
    if (!this.workspaceConfigs.has(workspaceSlug)) {
      this.workspaceConfigs.set(workspaceSlug, loadWorkspaceSafeModeConfig(workspaceSlug));
    }
    return this.workspaceConfigs.get(workspaceSlug) ?? null;
  }

  /**
   * Get or load source config
   */
  getSourceConfig(workspaceSlug: string, sourceSlug: string): SafeModeCustomConfig | null {
    const key = `${workspaceSlug}::${sourceSlug}`;
    if (!this.sourceConfigs.has(key)) {
      this.sourceConfigs.set(key, loadSourceSafeModeConfig(workspaceSlug, sourceSlug));
    }
    return this.sourceConfigs.get(key) ?? null;
  }

  /**
   * Invalidate workspace config (called by ConfigWatcher)
   */
  invalidateWorkspace(workspaceSlug: string): void {
    debug(`[SafeMode] Invalidating workspace config: ${workspaceSlug}`);
    this.workspaceConfigs.delete(workspaceSlug);
    // Clear all merged configs for this workspace
    for (const key of this.mergedConfigs.keys()) {
      if (key.startsWith(`${workspaceSlug}::`)) {
        this.mergedConfigs.delete(key);
      }
    }
  }

  /**
   * Invalidate source config (called by ConfigWatcher)
   */
  invalidateSource(workspaceSlug: string, sourceSlug: string): void {
    debug(`[SafeMode] Invalidating source config: ${workspaceSlug}/${sourceSlug}`);
    this.sourceConfigs.delete(`${workspaceSlug}::${sourceSlug}`);
    // Clear merged configs that include this source
    for (const key of this.mergedConfigs.keys()) {
      if (key.startsWith(`${workspaceSlug}::`) && key.includes(sourceSlug)) {
        this.mergedConfigs.delete(key);
      }
    }
  }

  /**
   * Get merged config for a context (workspace + active sources)
   * Uses additive merging: custom configs extend defaults
   */
  getMergedConfig(context: SafeModeContext): MergedSafeModeConfig {
    const cacheKey = this.buildCacheKey(context);

    if (!this.mergedConfigs.has(cacheKey)) {
      const merged = this.buildMergedConfig(context);
      this.mergedConfigs.set(cacheKey, merged);
    }

    return this.mergedConfigs.get(cacheKey)!;
  }

  private buildMergedConfig(context: SafeModeContext): MergedSafeModeConfig {
    const defaults = MODE_CONFIGS.safe;

    // Start with defaults
    const merged: MergedSafeModeConfig = {
      blockedTools: new Set(defaults.blockedTools),
      readOnlyBashPatterns: [...defaults.readOnlyBashPatterns],
      readOnlyMcpPatterns: [...defaults.readOnlyMcpPatterns],
      readOnlyApiMethods: new Set(defaults.readOnlyApiMethods),
      allowedApiEndpoints: [],
      displayName: defaults.displayName,
      shortcutHint: defaults.shortcutHint,
    };

    // Add workspace-level customizations
    const wsConfig = this.getWorkspaceConfig(context.workspaceSlug);
    if (wsConfig) {
      this.applyCustomConfig(merged, wsConfig);
    }

    // Add source-level customizations (additive)
    if (context.activeSourceSlugs) {
      for (const sourceSlug of context.activeSourceSlugs) {
        const srcConfig = this.getSourceConfig(context.workspaceSlug, sourceSlug);
        if (srcConfig) {
          this.applyCustomConfig(merged, srcConfig);
        }
      }
    }

    return merged;
  }

  private applyCustomConfig(merged: MergedSafeModeConfig, custom: SafeModeCustomConfig): void {
    // Add blocked tools
    for (const tool of custom.blockedTools) {
      merged.blockedTools.add(tool);
    }

    // Add allowed bash patterns (making config more permissive)
    for (const pattern of custom.allowedBashPatterns) {
      const regex = validateRegex(pattern);
      if (regex) {
        merged.readOnlyBashPatterns.push(regex);
      } else {
        debug(`[SafeMode] Invalid bash pattern, skipping: ${pattern}`);
      }
    }

    // Add allowed MCP patterns
    for (const pattern of custom.allowedMcpPatterns) {
      const regex = validateRegex(pattern);
      if (regex) {
        merged.readOnlyMcpPatterns.push(regex);
      } else {
        debug(`[SafeMode] Invalid MCP pattern, skipping: ${pattern}`);
      }
    }

    // Add allowed API methods (legacy)
    for (const method of custom.allowedApiMethods) {
      merged.readOnlyApiMethods.add(method.toUpperCase());
    }

    // Add allowed API endpoints (fine-grained)
    for (const rule of custom.allowedApiEndpoints) {
      const pathRegex = validateRegex(rule.path);
      if (pathRegex) {
        merged.allowedApiEndpoints.push({
          method: rule.method,
          pathPattern: pathRegex,
        });
      } else {
        debug(`[SafeMode] Invalid API endpoint path pattern, skipping: ${rule.path}`);
      }
    }
  }

  private buildCacheKey(context: SafeModeContext): string {
    const sources = context.activeSourceSlugs?.sort().join(',') ?? '';
    return `${context.workspaceSlug}::${sources}`;
  }

  /**
   * Clear all cached configs
   */
  clear(): void {
    this.workspaceConfigs.clear();
    this.sourceConfigs.clear();
    this.mergedConfigs.clear();
  }
}

// Singleton instance
export const safeModeConfigCache = new SafeModeConfigCache();
