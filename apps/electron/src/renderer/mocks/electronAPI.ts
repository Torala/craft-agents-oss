import type { ElectronAPI, Session, SessionEvent, FileAttachment, StoredAttachment } from '../../shared/types'
import { generateMessageId } from '../../shared/types'
import { mockWorkspaces, mockSessions, mockStreamingResponses } from './dummyData'

// Mutable copy of sessions for the mock
let sessions = [...mockSessions]

// Store event callback for streaming simulation
let eventCallback: ((event: SessionEvent) => void) | null = null

// Track which streaming response to use next (cycles through them)
let responseIndex = 0

/**
 * Simulates streaming text character by character with realistic delays
 */
async function simulateStreaming(
  sessionId: string,
  text: string,
  chunkSize = 3,
  delayMs = 20
): Promise<void> {
  for (let i = 0; i < text.length; i += chunkSize) {
    const chunk = text.slice(i, i + chunkSize)
    eventCallback?.({ type: 'text_delta', sessionId, delta: chunk })
    await sleep(delayMs)
  }
  eventCallback?.({ type: 'text_complete', sessionId, text })
}

/**
 * Simulates a tool call with start and result events
 */
async function simulateToolCall(
  sessionId: string,
  toolName: string,
  toolInput: Record<string, unknown>,
  toolResult: string
): Promise<void> {
  const toolUseId = `tool-${Date.now()}`

  eventCallback?.({
    type: 'tool_start',
    sessionId,
    toolName,
    toolUseId,
    toolInput,
  })

  // Simulate tool execution time
  await sleep(800)

  eventCallback?.({
    type: 'tool_result',
    sessionId,
    toolUseId,
    toolName,
    result: toolResult,
  })
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms))
}

// Mock agent data
const mockAgents: import('../../shared/types').SubAgentMetadata[] = [
  { id: 'agent-writer', name: 'Writer', documentId: 'doc-writer', workspaceId: 'ws-personal', createdAt: Date.now() - 86400000 },
  { id: 'agent-coder', name: 'Coder', documentId: 'doc-coder', workspaceId: 'ws-work', createdAt: Date.now() - 86400000 * 2, folderPath: ['work'] },
  { id: 'agent-reviewer', name: 'Reviewer', documentId: 'doc-reviewer', workspaceId: 'ws-work', createdAt: Date.now() - 86400000 * 3, folderPath: ['work'] },
]

export const mockElectronAPI: ElectronAPI = {
  // ===== Session Management =====

  async getSessions(): Promise<Session[]> {
    await sleep(100) // Simulate network delay
    return [...sessions].sort((a, b) => b.lastMessageAt - a.lastMessageAt)
  },

  async createSession(workspaceId: string, agentId?: string): Promise<Session> {
    await sleep(150)

    const workspace = mockWorkspaces.find(w => w.id === workspaceId)
    if (!workspace) {
      throw new Error(`Workspace ${workspaceId} not found`)
    }

    const agent = agentId ? mockAgents.find(a => a.id === agentId) : undefined

    const newSession: Session = {
      id: `session-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      workspaceId: workspace.id,
      workspaceName: workspace.name,
      lastMessageAt: Date.now(),
      messages: [],
      isProcessing: false,
      agentId: agent?.id,
      agentName: agent?.name,
      isArchived: false,
    }

    sessions = [newSession, ...sessions]
    return newSession
  },

  async deleteSession(sessionId: string): Promise<void> {
    await sleep(100)
    sessions = sessions.filter(s => s.id !== sessionId)
  },

  async renameSession(sessionId: string, name: string): Promise<void> {
    await sleep(100)
    const session = sessions.find(s => s.id === sessionId)
    if (session) {
      session.name = name
    }
  },

  async archiveSession(sessionId: string): Promise<void> {
    await sleep(100)
    const session = sessions.find(s => s.id === sessionId)
    if (session) {
      session.isArchived = true
    }
  },

  async unarchiveSession(sessionId: string): Promise<void> {
    await sleep(100)
    const session = sessions.find(s => s.id === sessionId)
    if (session) {
      session.isArchived = false
    }
  },

  async sendMessage(sessionId: string, message: string, _attachments?: FileAttachment[]): Promise<void> {
    // This returns immediately - results stream via events
    const session = sessions.find(s => s.id === sessionId)
    if (!session) {
      eventCallback?.({ type: 'error', sessionId, error: 'Session not found' })
      return
    }

    // Get next mock response (cycles through available responses)
    const mockResponse = mockStreamingResponses[responseIndex % mockStreamingResponses.length]
    responseIndex++

    // Start async streaming (don't await - returns immediately like real IPC)
    ;(async () => {
      try {
        // Small delay before starting
        await sleep(300)

        // Optionally simulate a tool call first
        if (mockResponse.includeToolCall && mockResponse.toolName) {
          await simulateToolCall(
            sessionId,
            mockResponse.toolName,
            mockResponse.toolInput,
            mockResponse.toolResult || 'Success'
          )
          await sleep(200)
        }

        // Stream the response text
        await simulateStreaming(sessionId, mockResponse.text)

        // Mark complete
        eventCallback?.({ type: 'complete', sessionId })
      } catch (error) {
        eventCallback?.({
          type: 'error',
          sessionId,
          error: error instanceof Error ? error.message : 'Unknown error',
        })
        eventCallback?.({ type: 'complete', sessionId })
      }
    })()
  },

  async cancelProcessing(sessionId: string): Promise<void> {
    // In a real implementation, this would abort the stream
    // For mock, we just send complete
    eventCallback?.({ type: 'complete', sessionId })
  },

  // ===== Workspace Management =====

  async getWorkspaces() {
    await sleep(100)
    return [...mockWorkspaces]
  },

  // ===== Agent Management =====

  async getAgents(_workspaceId: string) {
    await sleep(150)
    return [...mockAgents]
  },

  async refreshAgents(_workspaceId: string) {
    await sleep(300) // Longer delay for "refresh"
    return [...mockAgents]
  },

  async checkAgentAuth(_workspaceId: string, _agentId: string) {
    await sleep(100)
    // Mock: assume agents don't need auth for testing
    return { needsAuth: false }
  },

  async getAgentSetupStatus(_workspaceId: string, _agentId: string) {
    await sleep(100)
    // Mock: assume agents are already set up
    return { needsSetup: false, needsAuth: false }
  },

  async getAgentAuthStatus(_workspaceId: string, _agentId: string) {
    await sleep(100)
    // Mock: return mock auth status
    return {
      mcpServers: [
        { name: 'Mock MCP', url: 'https://mcp.example.com', requiresAuth: true, hasAuth: true }
      ],
      apis: []
    }
  },

  async getAgentDefinition(_workspaceId: string, agentId: string) {
    await sleep(300)
    // Mock: return a fake agent definition
    const agent = mockAgents.find(a => a.id === agentId)
    if (!agent) return null
    return {
      name: agent.name,
      instructions: `This is a mock agent for ${agent.name}`,
      mcpServers: [],
      apis: [],
      capabilities: ['Mock capability 1', 'Mock capability 2'],
      info: ['This is a mock agent for testing purposes'],
      rawContent: '',
      parsedAt: Date.now(),
    }
  },

  async reloadAgent(_workspaceId: string, _agentId: string) {
    await sleep(500)
    console.log('[Mock] Reload agent called')
    return true
  },

  async resetAgent(_workspaceId: string, _agentId: string) {
    await sleep(500)
    console.log('[Mock] Reset agent called')
    return true
  },

  // ===== Agent Authentication =====

  async getAgentAuthRequirements(_workspaceId: string, _agentId: string) {
    await sleep(200)
    console.log('[Mock] getAgentAuthRequirements called')
    // Mock: return empty arrays (no auth needed)
    return { mcpServers: [], apis: [] }
  },

  async startMcpOAuth(_workspaceId: string, _agentId: string, _serverUrl: string, serverName: string) {
    await sleep(1000)
    console.log('[Mock] startMcpOAuth called for:', serverName)
    // Mock: simulate successful OAuth
    return { success: true }
  },

  async saveMcpBearer(_workspaceId: string, _agentId: string, serverName: string, _token: string) {
    await sleep(200)
    console.log('[Mock] saveMcpBearer called for:', serverName)
  },

  async saveApiCredentials(_workspaceId: string, _agentId: string, apiName: string, _credential: string) {
    await sleep(200)
    console.log('[Mock] saveApiCredentials called for:', apiName)
  },

  async validateMcpConnection(_serverUrl: string, _accessToken?: string) {
    await sleep(300)
    console.log('[Mock] validateMcpConnection called')
    // Mock: return success
    return { success: true, tools: ['mock_tool_1', 'mock_tool_2'] }
  },

  // ===== Event Listener =====

  onSessionEvent(callback: (event: SessionEvent) => void): () => void {
    eventCallback = callback

    // Return cleanup function
    return () => {
      eventCallback = null
    }
  },

  // ===== File Operations =====

  async openFileDialog(): Promise<string[]> {
    // Mock: return empty array (user cancelled) - can't open real file dialog in browser
    console.log('[Mock] openFileDialog called - returning empty array (browser mode)')
    return []
  },

  async readFileAttachment(path: string): Promise<FileAttachment | null> {
    await sleep(100)
    // Mock: return a fake text file attachment
    console.log('[Mock] readFileAttachment called for:', path)
    return {
      type: 'text',
      path,
      name: path.split('/').pop() || 'mock-file.txt',
      mimeType: 'text/plain',
      text: 'Mock file content for browser development mode.',
      size: 50,
    }
  },

  async readFile(path: string): Promise<string> {
    await sleep(200)

    // Return mock markdown content
    return `# Mock File Content

**Path:** \`${path}\`

This is placeholder content for the file viewer. In browser development mode, actual file reading is not available.

## Sample Content

- Item one
- Item two
- Item three

\`\`\`typescript
const example = "code block";
console.log(example);
\`\`\`

> This is a blockquote to test markdown rendering.
`
  },

  async storeAttachment(_sessionId: string, attachment: FileAttachment): Promise<StoredAttachment> {
    await sleep(100)
    // Mock: return a fake StoredAttachment without actually storing anything
    console.log('[Mock] storeAttachment called for:', attachment.name)
    const mockId = `mock-${Date.now()}`
    return {
      id: mockId,
      type: attachment.type,
      name: attachment.name,
      mimeType: attachment.mimeType,
      size: attachment.size,
      storedPath: `/mock/attachments/${mockId}_${attachment.name}`,
      thumbnailPath: attachment.type === 'image' ? `/mock/attachments/${mockId}_thumb.png` : undefined,
      markdownPath: attachment.type === 'office' ? `/mock/attachments/${mockId}_${attachment.name}.md` : undefined,
    }
  },

  async generateThumbnail(_base64: string, _mimeType: string): Promise<string | null> {
    await sleep(100)
    // Mock: return null (no thumbnail generated in browser mode)
    console.log('[Mock] generateThumbnail called - returning null (browser mode)')
    return null
  },

  // ===== Theme =====

  async getSystemTheme(): Promise<boolean> {
    // Use browser's media query to detect system preference
    return window.matchMedia('(prefers-color-scheme: dark)').matches
  },

  onSystemThemeChange(callback: (isDark: boolean) => void): () => void {
    const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)')
    const handler = (e: MediaQueryListEvent) => callback(e.matches)

    mediaQuery.addEventListener('change', handler)
    return () => mediaQuery.removeEventListener('change', handler)
  },

  // ===== System =====

  getVersions() {
    return {
      node: '20.0.0',
      chrome: '120.0.0',
      electron: 'browser-mock',
    }
  },

  // ===== Shell Operations =====

  async openUrl(url: string): Promise<void> {
    console.log('[Mock] Opening URL:', url)
    // In browser dev mode, open in new tab
    window.open(url, '_blank', 'noopener,noreferrer')
  },

  async openFile(path: string): Promise<void> {
    console.log('[Mock] Opening file:', path)
    // In browser dev mode, we can't open local files
    // Just log a message
    alert(`[Dev Mode] Would open file:\n${path}`)
  },
}
