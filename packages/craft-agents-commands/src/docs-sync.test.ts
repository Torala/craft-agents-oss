import { describe, expect, it } from 'bun:test'
import { commandPlugins } from './plugins/registry.ts'
import { getEntityDocSection } from './utils.ts'

describe('craft-cli docs sync', () => {
  it('documents all plugin actions in marker sections', () => {
    for (const plugin of commandPlugins) {
      const section = getEntityDocSection(plugin.docsMarker, plugin.docsHeading)
      expect(typeof section.markdown).toBe('string')

      const markdown = section.markdown ?? ''
      for (const action of plugin.actions) {
        expect(markdown).toContain(`craft-agent ${plugin.namespace} ${action}`)
      }
    }
  })
})
