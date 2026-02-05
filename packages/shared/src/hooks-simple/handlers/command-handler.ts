/**
 * CommandHandler - Executes shell commands from hooks
 *
 * Subscribes to all hook events and executes matching command hooks.
 * Uses the existing command-executor for permission checking and execution.
 */

import { createLogger } from '../../utils/debug.ts';
import type { EventBus, BaseEventPayload, EventPayloadMap } from '../event-bus.ts';
import type { HookHandler, CommandHandlerOptions, HooksConfigProvider } from './types.ts';
import type { HookEvent, HookMatcher, CommandHookDefinition } from '../index.ts';
import { executeCommand, setPermissionsContext, clearPermissionsContext } from '../command-executor.ts';
import { matchesCron } from '../cron-matcher.ts';
import { sanitizeForShell } from '../security.ts';

const log = createLogger('command-handler');

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Convert camelCase to SNAKE_CASE
 */
function toSnakeCase(str: string): string {
  return str.replace(/[A-Z]/g, (letter) => `_${letter.toLowerCase()}`);
}

/**
 * Build environment variables from event payload.
 */
function buildEnvFromPayload(event: HookEvent, payload: BaseEventPayload): Record<string, string> {
  const env: Record<string, string> = {
    ...process.env as Record<string, string>,
    CRAFT_EVENT: event,
    CRAFT_EVENT_DATA: JSON.stringify(payload),
  };

  if (payload.sessionId) env.CRAFT_SESSION_ID = payload.sessionId;
  if (payload.workspaceId) env.CRAFT_WORKSPACE_ID = payload.workspaceId;

  // Add payload fields as individual env vars
  for (const [key, value] of Object.entries(payload)) {
    if (key === 'sessionId' || key === 'workspaceId' || key === 'timestamp') continue;
    const envKey = `CRAFT_${toSnakeCase(key).toUpperCase()}`;
    // Sanitize user-controlled values
    const sanitized = typeof value === 'string' ? sanitizeForShell(value) : String(value);
    env[envKey] = sanitized;
  }

  return env;
}

/**
 * Get the match value for regex matching based on event type.
 */
function getMatchValue(event: HookEvent, payload: BaseEventPayload): string {
  const data = payload as unknown as Record<string, unknown>;
  switch (event) {
    case 'LabelAdd':
    case 'LabelRemove':
      return String(data.label ?? '');
    case 'LabelConfigChange':
      return ''; // Always matches
    case 'PermissionModeChange':
      return String(data.newMode ?? '');
    case 'FlagChange':
      return String(data.isFlagged ?? false);
    case 'TodoStateChange':
      return String(data.newState ?? '');
    case 'PreToolUse':
    case 'PostToolUse':
      return String(data.toolName ?? (data.data as Record<string, unknown>)?.tool_name ?? '');
    case 'SchedulerTick':
      return ''; // Uses cron matching
    default:
      return JSON.stringify(data);
  }
}

/**
 * Check if a matcher matches the given event payload.
 */
function matcherMatches(matcher: HookMatcher, event: HookEvent, payload: BaseEventPayload): boolean {
  if (event === 'SchedulerTick') {
    // Use cron matching for SchedulerTick
    return !!matcher.cron && matchesCron(matcher.cron, matcher.timezone);
  }

  // Use regex matching for other events
  const matchValue = getMatchValue(event, payload);
  if (!matcher.matcher) return true; // No matcher means match all
  return new RegExp(matcher.matcher).test(matchValue);
}

// ============================================================================
// CommandHandler Implementation
// ============================================================================

export class CommandHandler implements HookHandler {
  private readonly options: CommandHandlerOptions;
  private readonly configProvider: HooksConfigProvider;
  private bus: EventBus | null = null;
  private boundHandler: ((event: HookEvent, payload: BaseEventPayload) => Promise<void>) | null = null;

  constructor(options: CommandHandlerOptions, configProvider: HooksConfigProvider) {
    this.options = options;
    this.configProvider = configProvider;

    // Set up permissions context
    setPermissionsContext({
      workspaceRootPath: options.workspaceRootPath,
      activeSourceSlugs: options.activeSourceSlugs,
    });
  }

  /**
   * Subscribe to all events on the bus.
   */
  subscribe(bus: EventBus): void {
    this.bus = bus;
    this.boundHandler = this.handleEvent.bind(this);
    bus.onAny(this.boundHandler);
    log.debug(`[CommandHandler] Subscribed to event bus`);
  }

  /**
   * Handle an event by executing matching command hooks.
   */
  private async handleEvent(event: HookEvent, payload: BaseEventPayload): Promise<void> {
    const matchers = this.configProvider.getMatchersForEvent(event);
    if (matchers.length === 0) return;

    // Find matching command hooks
    const commandHooks: Array<{ command: CommandHookDefinition; permissionMode?: 'safe' | 'ask' | 'allow-all' }> = [];

    for (const matcher of matchers) {
      if (!matcherMatches(matcher, event, payload)) continue;

      for (const hook of matcher.hooks) {
        if (hook.type === 'command') {
          commandHooks.push({ command: hook, permissionMode: matcher.permissionMode });
        }
      }
    }

    if (commandHooks.length === 0) return;

    log.debug(`[CommandHandler] Executing ${commandHooks.length} commands for ${event}`);

    // Build environment variables
    const env = buildEnvFromPayload(event, payload);

    // Execute commands in parallel
    await Promise.all(
      commandHooks.map(async ({ command, permissionMode }) => {
        const startTime = Date.now();

        try {
          const result = await executeCommand(command.command, {
            env,
            timeout: command.timeout ?? 60000,
            cwd: this.options.workingDir,
            permissionMode,
          });

          const durationMs = Date.now() - startTime;

          if (result.blocked) {
            log.warn(`[CommandHandler] Blocked: ${command.command} - ${result.stderr}`);
          } else if (!result.success) {
            log.warn(`[CommandHandler] Failed: ${command.command}`, result.stderr);
          } else {
            log.debug(`[CommandHandler] Success: ${command.command} (${durationMs}ms)`);
          }
        } catch (error) {
          const err = error instanceof Error ? error : new Error(String(error));
          log.error(`[CommandHandler] Error executing ${command.command}:`, err);
          this.options.onError?.(event, err);
        }
      })
    );
  }

  /**
   * Clean up resources.
   */
  dispose(): void {
    if (this.bus && this.boundHandler) {
      this.bus.offAny(this.boundHandler);
      this.boundHandler = null;
    }
    this.bus = null;
    clearPermissionsContext();
    log.debug(`[CommandHandler] Disposed`);
  }
}
