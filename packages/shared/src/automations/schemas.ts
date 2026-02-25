/**
 * Automations Schema Definitions
 *
 * Zod schemas for validating automations.json configuration.
 * Extracted from index.ts for better separation of concerns.
 */

import { z } from 'zod';
import type { ValidationIssue } from '../config/validators.ts';

// ============================================================================
// Zod Schemas
// ============================================================================

export const PromptActionSchema = z.object({
  type: z.literal('prompt'),
  prompt: z.string().min(1, 'Prompt cannot be empty'),
  llmConnection: z.string().min(1).optional(),
  model: z.string().min(1).optional(),
});

/** Accepts prompt actions strictly; passes through legacy/unknown action types without erroring */
export const ActionDefinitionSchema = z.union([
  PromptActionSchema,
  z.object({ type: z.string() }).passthrough(),
]);

export const AutomationMatcherSchema = z.object({
  id: z.string().optional(),
  name: z.string().optional(),
  matcher: z.string().optional(),
  cron: z.string().optional(),
  timezone: z.string().optional(),
  permissionMode: z.enum(['safe', 'ask', 'allow-all']).optional(),
  labels: z.array(z.string()).optional(),
  enabled: z.boolean().optional(),
  // Accept both "actions" (v2) and "hooks" (v1) — normalized to "actions" internally
  hooks: z.array(ActionDefinitionSchema).optional(),
  actions: z.array(ActionDefinitionSchema).optional(),
}).refine(
  (data) => (data.hooks?.length ?? 0) + (data.actions?.length ?? 0) > 0,
  { message: 'At least one action required (in "actions" or "hooks" array)' },
).transform((data) => {
  // Normalize: merge hooks into actions, drop hooks key
  const merged = [...(data.actions ?? []), ...(data.hooks ?? [])];
  // Convert legacy command actions to prompt actions
  let hasCommand = false;
  const normalized = merged.map((action) => {
    if (action.type === 'command' && 'command' in action) {
      hasCommand = true;
      return { type: 'prompt' as const, prompt: `Run this command: ${(action as unknown as { command: string }).command}` };
    }
    return action;
  });
  const { hooks: _hooks, ...rest } = data;
  // Command actions need unrestricted shell execution
  const permissionMode = hasCommand && !rest.permissionMode ? 'allow-all' as const : rest.permissionMode;
  return { ...rest, permissionMode, actions: normalized };
});

/**
 * Deprecated event name aliases.
 * Old names are accepted during schema validation and silently rewritten to canonical names.
 * A console.warn() is emitted at runtime so users know to update their configs.
 */
export const DEPRECATED_EVENT_ALIASES: Record<string, string> = {
  'TodoStateChange': 'SessionStatusChange',
};

export const VALID_EVENTS = [
  // App events
  'LabelAdd', 'LabelRemove', 'LabelConfigChange', 'PermissionModeChange', 'FlagChange', 'SessionStatusChange', 'SchedulerTick',
  // Deprecated aliases (still accepted, rewritten in transform)
  'TodoStateChange',
  // Agent/SDK events
  'PreToolUse', 'PostToolUse', 'PostToolUseFailure', 'Notification',
  'UserPromptSubmit', 'SessionStart', 'SessionEnd', 'Stop',
  'SubagentStart', 'SubagentStop', 'PreCompact', 'PermissionRequest', 'Setup',
] as const;

export const AutomationsConfigSchema = z.object({
  version: z.number().optional(),
  // Accept "automations" (v2), "tasks" (v2-legacy), and "hooks" (v1) top-level keys
  hooks: z.record(z.string(), z.array(AutomationMatcherSchema)).optional(),
  tasks: z.record(z.string(), z.array(AutomationMatcherSchema)).optional(),
  automations: z.record(z.string(), z.array(AutomationMatcherSchema)).optional(),
}).transform((data) => {
  // Normalize: merge all into automations, use automations as canonical internal key
  const merged = { ...(data.hooks ?? {}), ...(data.tasks ?? {}), ...(data.automations ?? {}) };
  data.automations = Object.keys(merged).length > 0 ? merged : {};
  delete (data as Record<string, unknown>).hooks;
  delete (data as Record<string, unknown>).tasks;
  // Filter out invalid event names, rewrite deprecated aliases, and warn
  const validAutomations: Record<string, z.infer<typeof AutomationMatcherSchema>[]> = {};
  const invalidEvents: string[] = [];

  for (const [event, matchers] of Object.entries(data.automations)) {
    if (VALID_EVENTS.includes(event as (typeof VALID_EVENTS)[number])) {
      // Rewrite deprecated aliases to canonical names
      const canonical = DEPRECATED_EVENT_ALIASES[event];
      if (canonical) {
        console.warn(`[automations] Deprecated event name "${event}" — use "${canonical}" instead`);
        // Merge with existing matchers for the canonical name if any
        validAutomations[canonical] = [...(validAutomations[canonical] ?? []), ...matchers];
      } else {
        validAutomations[event] = [...(validAutomations[event] ?? []), ...matchers];
      }
    } else {
      invalidEvents.push(event);
    }
  }

  if (invalidEvents.length > 0) {
    console.warn(`[automations] Unknown event types ignored: ${invalidEvents.join(', ')}`);
  }

  return { version: data.version, automations: validAutomations };
});

// ============================================================================
// Schema Utilities
// ============================================================================

/**
 * Convert Zod error to ValidationIssues (matches validators.ts pattern)
 */
export function zodErrorToIssues(error: z.ZodError, file: string): ValidationIssue[] {
  return error.issues.map((issue) => ({
    file,
    path: issue.path.join('.') || 'root',
    message: issue.message,
    severity: 'error' as const,
  }));
}
