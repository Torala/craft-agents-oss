/**
 * Status Storage
 *
 * Filesystem-based storage for workspace status configurations.
 * Statuses are stored at {workspaceRootPath}/statuses/config.json
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import { join } from 'path';
import type { WorkspaceStatusConfig, StatusConfig, StatusCategory } from './types.ts';
import { DEFAULT_ICON_SVGS } from './default-icons.ts';

const STATUS_CONFIG_DIR = 'statuses';
const STATUS_CONFIG_FILE = 'statuses/config.json';
const STATUS_ICONS_DIR = 'statuses/icons';

/**
 * Get default status configuration (matches current hardcoded behavior)
 */
export function getDefaultStatusConfig(): WorkspaceStatusConfig {
  const now = Date.now();

  return {
    version: 1,
    statuses: [
      {
        id: 'todo',
        label: 'Todo',
        color: 'text-muted-foreground',
        icon: { type: 'file', value: 'todo.svg' },
        shortcut: 't',
        category: 'open',
        isFixed: true,
        isDefault: false,
        order: 0,
        createdAt: now,
        updatedAt: now,
      },
      {
        id: 'in-progress',
        label: 'In Progress',
        color: 'text-blue-500',
        icon: { type: 'file', value: 'in-progress.svg' },
        shortcut: 'p',
        category: 'open',
        isFixed: false,
        isDefault: true,
        order: 1,
        createdAt: now,
        updatedAt: now,
      },
      {
        id: 'needs-review',
        label: 'Needs Review',
        color: 'text-amber-500',
        icon: { type: 'file', value: 'needs-review.svg' },
        shortcut: 'v',
        category: 'open',
        isFixed: false,
        isDefault: true,
        order: 2,
        createdAt: now,
        updatedAt: now,
      },
      {
        id: 'done',
        label: 'Done',
        color: 'text-[#9570BE]',
        icon: { type: 'file', value: 'done.svg' },
        shortcut: 'd',
        category: 'closed',
        isFixed: true,
        isDefault: false,
        order: 3,
        createdAt: now,
        updatedAt: now,
      },
      {
        id: 'cancelled',
        label: 'Cancelled',
        color: 'text-muted-foreground/60',
        icon: { type: 'file', value: 'cancelled.svg' },
        shortcut: 'x',
        category: 'closed',
        isFixed: true,
        isDefault: false,
        order: 4,
        createdAt: now,
        updatedAt: now,
      },
    ],
    defaultStatusId: 'todo',
    updatedAt: now,
  };
}

/**
 * Ensure default icon files exist in statuses/icons/
 * Creates missing icon files from embedded SVG strings
 */
export function ensureDefaultIconFiles(workspaceRootPath: string): void {
  const iconsDir = join(workspaceRootPath, STATUS_ICONS_DIR);

  // Create icons directory if missing
  if (!existsSync(iconsDir)) {
    mkdirSync(iconsDir, { recursive: true });
  }

  // Write each default icon file if missing
  for (const [statusId, svgContent] of Object.entries(DEFAULT_ICON_SVGS)) {
    const iconPath = join(iconsDir, `${statusId}.svg`);

    if (!existsSync(iconPath)) {
      try {
        writeFileSync(iconPath, svgContent, 'utf-8');
      } catch (error) {
        console.error(`[ensureDefaultIconFiles] Failed to write ${statusId}.svg:`, error);
      }
    }
  }
}

/**
 * Validate status configuration has required fixed statuses
 */
function validateStatusConfig(config: WorkspaceStatusConfig): boolean {
  const requiredFixedStatuses = ['todo', 'done', 'cancelled'];

  return requiredFixedStatuses.every(id =>
    config.statuses.some(s => s.id === id && s.isFixed)
  );
}

/**
 * Load workspace status configuration
 * Returns defaults if no config exists or validation fails
 * Ensures icon files exist
 */
export function loadStatusConfig(workspaceRootPath: string): WorkspaceStatusConfig {
  // Ensure default icon files exist (self-healing)
  ensureDefaultIconFiles(workspaceRootPath);

  const configPath = join(workspaceRootPath, STATUS_CONFIG_FILE);

  // Return defaults if config doesn't exist
  if (!existsSync(configPath)) {
    return getDefaultStatusConfig();
  }

  try {
    const config = JSON.parse(readFileSync(configPath, 'utf-8')) as WorkspaceStatusConfig;

    // Validate required fixed statuses exist
    if (!validateStatusConfig(config)) {
      console.warn('[loadStatusConfig] Invalid config: missing required fixed statuses, returning defaults');
      return getDefaultStatusConfig();
    }

    return config;
  } catch (error) {
    console.error('[loadStatusConfig] Failed to parse config:', error);
    return getDefaultStatusConfig();
  }
}

/**
 * Save workspace status configuration to disk
 */
export function saveStatusConfig(
  workspaceRootPath: string,
  config: WorkspaceStatusConfig
): void {
  const statusDir = join(workspaceRootPath, STATUS_CONFIG_DIR);
  const configPath = join(workspaceRootPath, STATUS_CONFIG_FILE);

  // Create status directory if missing
  if (!existsSync(statusDir)) {
    mkdirSync(statusDir, { recursive: true });
  }

  // Update timestamp
  config.updatedAt = Date.now();

  // Write config to disk
  try {
    writeFileSync(configPath, JSON.stringify(config, null, 2), 'utf-8');
  } catch (error) {
    console.error('[saveStatusConfig] Failed to save config:', error);
    throw error;
  }
}

/**
 * Get a single status by ID
 * Returns null if not found
 */
export function getStatus(
  workspaceRootPath: string,
  statusId: string
): StatusConfig | null {
  const config = loadStatusConfig(workspaceRootPath);
  return config.statuses.find(s => s.id === statusId) || null;
}

/**
 * Get all statuses sorted by order
 */
export function listStatuses(workspaceRootPath: string): StatusConfig[] {
  const config = loadStatusConfig(workspaceRootPath);
  return [...config.statuses].sort((a, b) => a.order - b.order);
}

/**
 * Check if a status ID is valid for this workspace
 */
export function isValidStatusId(
  workspaceRootPath: string,
  statusId: string
): boolean {
  const config = loadStatusConfig(workspaceRootPath);
  return config.statuses.some(s => s.id === statusId);
}

/**
 * Get category for a status ID
 * Returns null if status not found
 */
export function getStatusCategory(
  workspaceRootPath: string,
  statusId: string
): StatusCategory | null {
  const status = getStatus(workspaceRootPath, statusId);
  return status?.category || null;
}
