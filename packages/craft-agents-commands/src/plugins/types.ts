export interface CommandPolicy {
  preToolGuards?: {
    redirectHelpCommand: string
    workspacePathScopes?: string[]
  }
  exploreAllowlist?: {
    readActions: string[]
    allowGlobalFlags?: boolean
  }
}

export interface CommandPluginContext {
  workspaceRootPath: string
}

export interface CommandPlugin {
  namespace: string
  actions: readonly string[]
  docsMarker: string
  docsHeading: string
  policy?: CommandPolicy
  execute(action: string, tokens: string[], context: CommandPluginContext): Promise<unknown>
}
