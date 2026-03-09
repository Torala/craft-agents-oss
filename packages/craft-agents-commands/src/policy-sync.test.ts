import { describe, it, expect } from 'bun:test'
import { getCliDomainPolicy } from '@craft-agent/shared/config'
import type { CliDomainNamespace } from '@craft-agent/shared/config'
import { commandPlugins } from './plugins/registry.ts'

describe('command plugin policy sync', () => {
  it('keeps plugin preToolGuards and exploreAllowlist aligned with shared CLI domain policy', () => {
    for (const plugin of commandPlugins) {
      const namespace = plugin.namespace as CliDomainNamespace
      const sharedPolicy = getCliDomainPolicy(namespace)

      expect(plugin.policy?.preToolGuards?.redirectHelpCommand).toBe(sharedPolicy.helpCommand)
      expect(plugin.policy?.preToolGuards?.workspacePathScopes).toEqual(sharedPolicy.workspacePathScopes)
      expect(plugin.policy?.exploreAllowlist?.readActions).toEqual(sharedPolicy.readActions)
      expect(plugin.policy?.exploreAllowlist?.allowGlobalFlags).toBe(true)
    }
  })
})
