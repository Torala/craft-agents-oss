import type { CommandPlugin } from './types.ts'
import { labelPlugin } from './label.ts'
import { sourcePlugin } from './source.ts'
import { skillPlugin } from './skill.ts'
import { automationPlugin } from './automation.ts'
import { permissionPlugin } from './permission.ts'
import { themePlugin } from './theme.ts'

export const commandPlugins: CommandPlugin[] = [
  labelPlugin,
  sourcePlugin,
  skillPlugin,
  automationPlugin,
  permissionPlugin,
  themePlugin,
]

export function getPlugin(namespace: string): CommandPlugin | undefined {
  return commandPlugins.find(plugin => plugin.namespace === namespace)
}
