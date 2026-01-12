/**
 * SourceInfoPage
 *
 * Displays source details including connection info, authentication status,
 * documentation (guide.md), and metadata. View-only.
 */

import * as React from 'react'
import { useEffect, useState, useMemo, useCallback } from 'react'
import {
  AlertCircle,
  FolderOpen,
  Trash2,
} from 'lucide-react'
import { SourceAvatar } from '@/components/ui/source-avatar'
import { HeaderMenu } from '@/components/ui/HeaderMenu'
import { StyledDropdownMenuItem, StyledDropdownMenuSeparator } from '@/components/ui/styled-dropdown'
import { cn } from '@/lib/utils'
import { routes, navigate } from '@/lib/navigate'
import { toast } from 'sonner'
import {
  Info_Page,
  Info_Section,
  Info_Table,
  Info_DataTable,
  Info_Alert,
  Info_GroupedList,
  Info_StatusBadge,
  Info_Markdown,
} from '@/components/info'
import type { LoadedSource, McpToolWithPermission } from '../../shared/types'
import type { PermissionsConfigFile } from '@craft-agent/shared/agent'

interface SourceInfoPageProps {
  sourceSlug: string
  workspaceId: string
  /** Optional callback when source is deleted */
  onDelete?: () => void
}

/**
 * Format timestamp to relative time
 */
function formatRelativeTime(timestamp?: number): string {
  if (!timestamp) return 'Never'

  const now = Date.now()
  const diff = now - timestamp
  const minutes = Math.floor(diff / 60000)
  const hours = Math.floor(diff / 3600000)
  const days = Math.floor(diff / 86400000)

  if (minutes < 1) return 'Just now'
  if (minutes < 60) return `${minutes} minute${minutes !== 1 ? 's' : ''} ago`
  if (hours < 24) return `${hours} hour${hours !== 1 ? 's' : ''} ago`
  return `${days} day${days !== 1 ? 's' : ''} ago`
}

/**
 * Get source URL for display
 */
function getSourceUrl(source: LoadedSource): string | null {
  const { type, mcp, api, local } = source.config

  if (type === 'mcp' && mcp?.url) return mcp.url
  if (type === 'api' && api?.baseUrl) return api.baseUrl
  if (type === 'local' && local?.path) return local.path

  return null
}

export default function SourceInfoPage({ sourceSlug, workspaceId, onDelete }: SourceInfoPageProps) {
  const [source, setSource] = useState<LoadedSource | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [permissionsConfig, setPermissionsConfig] = useState<PermissionsConfigFile | null>(null)
  const [mcpTools, setMcpTools] = useState<McpToolWithPermission[] | null>(null)
  const [mcpToolsLoading, setMcpToolsLoading] = useState(false)
  const [mcpToolsError, setMcpToolsError] = useState<string | null>(null)
  const [localMcpEnabled, setLocalMcpEnabled] = useState(true)

  // Load source data
  useEffect(() => {
    let isMounted = true
    setLoading(true)
    setError(null)

    const loadSource = async () => {
      try {
        const sources = await window.electronAPI.getSources(workspaceId)

        if (!isMounted) return

        const found = sources.find((s) => s.config.slug === sourceSlug)
        if (found) {
          setSource(found)

          const config = await window.electronAPI.getSourcePermissionsConfig(workspaceId, sourceSlug)
          if (isMounted) {
            setPermissionsConfig(config)
          }
        } else {
          setError('Source not found')
        }
      } catch (err) {
        if (!isMounted) return
        setError(err instanceof Error ? err.message : 'Failed to load source')
      } finally {
        if (isMounted) setLoading(false)
      }
    }

    loadSource()

    return () => {
      isMounted = false
    }
  }, [workspaceId, sourceSlug])

  // Load MCP tools when source is loaded and is MCP type
  useEffect(() => {
    if (!source || source.config.type !== 'mcp') {
      setMcpTools(null)
      setMcpToolsError(null)
      return
    }

    let isMounted = true
    setMcpToolsLoading(true)
    setMcpToolsError(null)

    const loadTools = async () => {
      try {
        const result = await window.electronAPI.getMcpTools(workspaceId, sourceSlug)
        if (!isMounted) return

        if (result.success && result.tools) {
          setMcpTools(result.tools)
        } else {
          setMcpToolsError(result.error || 'Failed to load tools')
        }
      } catch (err) {
        if (!isMounted) return
        setMcpToolsError(err instanceof Error ? err.message : 'Failed to load tools')
      } finally {
        if (isMounted) setMcpToolsLoading(false)
      }
    }

    loadTools()

    return () => {
      isMounted = false
    }
  }, [source, workspaceId, sourceSlug])

  // Load workspace settings (for localMcpEnabled)
  useEffect(() => {
    if (!workspaceId) return
    window.electronAPI.getWorkspaceSettings(workspaceId).then((settings) => {
      if (settings) {
        setLocalMcpEnabled(settings.localMcpEnabled ?? true)
      }
    }).catch((err) => {
      console.error('[SourceInfoPage] Failed to load workspace settings:', err)
    })
  }, [workspaceId])

  // Listen for source folder changes
  useEffect(() => {
    if (!window.electronAPI?.onSourcesChanged) return

    const cleanup = window.electronAPI.onSourcesChanged((sources) => {
      const updated = sources.find((s) => s.config.slug === sourceSlug)

      if (updated) {
        console.log('[SourceInfoPage] Source changed, reloading...')
        setSource(updated)

        const loadPermissionsConfig = async () => {
          try {
            const config = await window.electronAPI.getSourcePermissionsConfig(workspaceId, sourceSlug)
            setPermissionsConfig(config)
          } catch (err) {
            console.error('[SourceInfoPage] Failed to reload permissions config:', err)
          }
        }
        loadPermissionsConfig()
      }
    })

    return cleanup
  }, [sourceSlug, workspaceId])

  // Compute source URL
  const sourceUrl = useMemo(() => source ? getSourceUrl(source) : null, [source])

  // Group MCP tools by permission status
  const groupedTools = useMemo(() => {
    if (!mcpTools) return null
    const allowed = mcpTools.filter(t => t.allowed)
    const requiresPermission = mcpTools.filter(t => !t.allowed)
    return { allowed, requiresPermission }
  }, [mcpTools])

  // Handle opening URL (website or folder)
  const handleOpenUrl = useCallback(async () => {
    if (!source || !sourceUrl) return
    if (window.electronAPI) {
      if (sourceUrl.startsWith('http://') || sourceUrl.startsWith('https://')) {
        await window.electronAPI.openUrl(sourceUrl)
      } else {
        await window.electronAPI.showInFolder(sourceUrl)
      }
    }
  }, [source, sourceUrl])

  // Handle opening source folder
  const handleOpenSourceFolder = useCallback(async () => {
    if (!source) return
    if (window.electronAPI) {
      await window.electronAPI.showInFolder(source.folderPath)
    }
  }, [source])

  // Handle editing guide.md in Monaco markdown editor
  const handleEditGuide = useCallback(async () => {
    if (!source) return

    const guidePath = `${source.folderPath}/guide.md`

    await window.electronAPI.openPreview({
      mode: 'markdown',
      sessionId: 'workspace',
      previewId: `source-guide:${sourceSlug}`,
      markdown: {
        mode: 'readWrite',
        filePath: guidePath,
        title: `${source.config.name} - guide.md`,
      },
    })
  }, [source, sourceSlug])

  // Handle deleting source
  const handleDelete = useCallback(async () => {
    if (!source) return
    try {
      await window.electronAPI.deleteSource(workspaceId, sourceSlug)
      toast.success(`Deleted source: ${source.config.name}`)
      navigate(routes.view.sources())
      onDelete?.()
    } catch (err) {
      toast.error('Failed to delete source', {
        description: err instanceof Error ? err.message : 'Unknown error',
      })
    }
  }, [source, workspaceId, sourceSlug, onDelete])

  // Get source name for header
  const sourceName = source?.config.name || sourceSlug

  return (
    <Info_Page
      loading={loading}
      error={error ?? undefined}
      empty={!source && !loading && !error ? 'Source not found' : undefined}
    >
      <Info_Page.Header
        title={sourceName}
        actions={
          <HeaderMenu route={routes.view.sources({ sourceSlug })}>
            <StyledDropdownMenuItem onClick={handleOpenSourceFolder}>
              <FolderOpen className="h-3.5 w-3.5" />
              <span className="flex-1">Show in Finder</span>
            </StyledDropdownMenuItem>
            <StyledDropdownMenuSeparator />
            <StyledDropdownMenuItem onClick={handleDelete} variant="destructive">
              <Trash2 className="h-3.5 w-3.5" />
              <span className="flex-1">Delete</span>
            </StyledDropdownMenuItem>
          </HeaderMenu>
        }
      />

      {source && (
        <Info_Page.Content>
          {/* Hero: Avatar and tagline */}
          <Info_Page.Hero
            avatar={<SourceAvatar source={source} className="h-full w-full" />}
            tagline={source.config.tagline}
          />

          {/* Disabled Warning */}
          {source.config.mcp?.transport === 'stdio' && !localMcpEnabled && (
            <Info_Alert variant="warning" icon={<AlertCircle className="h-4 w-4" />}>
              <Info_Alert.Title>Source Disabled</Info_Alert.Title>
              <Info_Alert.Description>
                Local MCP servers are disabled in Settings &gt; Advanced.
                Enable them to use this source.
              </Info_Alert.Description>
            </Info_Alert>
          )}

          {/* Connection */}
          <Info_Section title="Connection">
            <Info_Table
              footer={source.config.connectionError && (
                <div className="px-[22px] py-2 border-t border-border/30 bg-destructive/5">
                  <div className="flex items-start gap-2 text-sm text-destructive">
                    <AlertCircle className="h-4 w-4 shrink-0 mt-0.5" />
                    <span>{source.config.connectionError}</span>
                  </div>
                </div>
              )}
            >
              <Info_Table.Row label="Type" value={source.config.type.toUpperCase()} />
              {sourceUrl && (
                <Info_Table.Row label="URL">
                  <button
                    onClick={handleOpenUrl}
                    className="font-mono truncate hover:underline text-foreground focus:outline-none focus-visible:underline text-left block w-full"
                  >
                    {sourceUrl}
                  </button>
                </Info_Table.Row>
              )}
              <Info_Table.Row label="Last Tested" value={formatRelativeTime(source.config.lastTestedAt)} />
            </Info_Table>
          </Info_Section>

          {/* Permissions - for API and local sources */}
          {source.config.type !== 'mcp' && permissionsConfig && (
            <Info_Section title="Permissions">
              <Info_DataTable>
                <Info_DataTable.Header>
                  <Info_DataTable.Column width={100}>Access</Info_DataTable.Column>
                  <Info_DataTable.Column width={80}>Type</Info_DataTable.Column>
                  <Info_DataTable.Column>Pattern</Info_DataTable.Column>
                  <Info_DataTable.Column>Comment</Info_DataTable.Column>
                </Info_DataTable.Header>
                <Info_DataTable.Body>
                  {/* Blocked Tools */}
                  {permissionsConfig.blockedTools?.map((tool, i) => (
                    <Info_DataTable.Row key={`blocked-${i}`}>
                      <Info_DataTable.Cell>
                        <Info_StatusBadge status="blocked" />
                      </Info_DataTable.Cell>
                      <Info_DataTable.Cell muted>Tool</Info_DataTable.Cell>
                      <Info_DataTable.Cell>
                        <code className="font-mono text-xs">{tool}</code>
                      </Info_DataTable.Cell>
                      <Info_DataTable.Cell muted>-</Info_DataTable.Cell>
                    </Info_DataTable.Row>
                  ))}

                  {/* Allowed Bash Patterns */}
                  {permissionsConfig.allowedBashPatterns?.map((item, i) => {
                    const pattern = typeof item === 'string' ? item : item.pattern
                    const comment = typeof item === 'string' ? null : item.comment
                    return (
                      <Info_DataTable.Row key={`bash-${i}`}>
                        <Info_DataTable.Cell>
                          <Info_StatusBadge status="allowed" />
                        </Info_DataTable.Cell>
                        <Info_DataTable.Cell muted>Bash</Info_DataTable.Cell>
                        <Info_DataTable.Cell>
                          <code className="font-mono text-xs">{pattern}</code>
                        </Info_DataTable.Cell>
                        <Info_DataTable.Cell muted>{comment || '-'}</Info_DataTable.Cell>
                      </Info_DataTable.Row>
                    )
                  })}

                  {/* Allowed API Endpoints */}
                  {permissionsConfig.allowedApiEndpoints?.map((item, i) => {
                    const pattern = `${item.method} ${item.path}`
                    const comment = typeof item === 'object' && 'comment' in item ? item.comment : null
                    return (
                      <Info_DataTable.Row key={`api-${i}`}>
                        <Info_DataTable.Cell>
                          <Info_StatusBadge status="allowed" />
                        </Info_DataTable.Cell>
                        <Info_DataTable.Cell muted>API</Info_DataTable.Cell>
                        <Info_DataTable.Cell>
                          <code className="font-mono text-xs">{pattern}</code>
                        </Info_DataTable.Cell>
                        <Info_DataTable.Cell muted>{comment || '-'}</Info_DataTable.Cell>
                      </Info_DataTable.Row>
                    )
                  })}
                </Info_DataTable.Body>
              </Info_DataTable>
            </Info_Section>
          )}

          {/* Tools - for MCP sources */}
          {source.config.type === 'mcp' && (
            <Info_Section title="Tools">
              <Info_GroupedList
                loading={mcpToolsLoading}
                error={mcpToolsError ?? undefined}
                empty={groupedTools && groupedTools.allowed.length === 0 && groupedTools.requiresPermission.length === 0 ? 'No tools available' : undefined}
              >
                {groupedTools?.allowed && groupedTools.allowed.length > 0 && (
                  <Info_GroupedList.Group label="Allowed" variant="success" count={groupedTools.allowed.length}>
                    {groupedTools.allowed.map((tool) => (
                      <Info_GroupedList.Item key={tool.name}>
                        <code className="font-mono text-xs">{tool.name}</code>
                        {tool.description && (
                          <p className="text-xs text-foreground/60 mt-0.5">{tool.description}</p>
                        )}
                      </Info_GroupedList.Item>
                    ))}
                  </Info_GroupedList.Group>
                )}

                {groupedTools?.requiresPermission && groupedTools.requiresPermission.length > 0 && (
                  <Info_GroupedList.Group label="Requires Permission" variant="info" count={groupedTools.requiresPermission.length}>
                    {groupedTools.requiresPermission.map((tool) => (
                      <Info_GroupedList.Item key={tool.name}>
                        <code className="font-mono text-xs">{tool.name}</code>
                        {tool.description && (
                          <p className="text-xs text-foreground/60 mt-0.5">{tool.description}</p>
                        )}
                      </Info_GroupedList.Item>
                    ))}
                  </Info_GroupedList.Group>
                )}
              </Info_GroupedList>
            </Info_Section>
          )}

          {/* Permissions - for MCP sources */}
          {source.config.type === 'mcp' && permissionsConfig && (
            <Info_Section title="Permissions">
              <Info_DataTable>
                <Info_DataTable.Header>
                  <Info_DataTable.Column width={100}>Access</Info_DataTable.Column>
                  <Info_DataTable.Column>Pattern</Info_DataTable.Column>
                  <Info_DataTable.Column>Comment</Info_DataTable.Column>
                </Info_DataTable.Header>
                <Info_DataTable.Body>
                  {/* Blocked Tools */}
                  {permissionsConfig.blockedTools?.map((tool, i) => (
                    <Info_DataTable.Row key={`blocked-${i}`}>
                      <Info_DataTable.Cell>
                        <Info_StatusBadge status="blocked" />
                      </Info_DataTable.Cell>
                      <Info_DataTable.Cell>
                        <code className="font-mono text-xs">{tool}</code>
                      </Info_DataTable.Cell>
                      <Info_DataTable.Cell muted>-</Info_DataTable.Cell>
                    </Info_DataTable.Row>
                  ))}

                  {/* Allowed MCP Patterns */}
                  {permissionsConfig.allowedMcpPatterns?.map((item, i) => {
                    const pattern = typeof item === 'string' ? item : item.pattern
                    const comment = typeof item === 'string' ? null : item.comment
                    return (
                      <Info_DataTable.Row key={`mcp-${i}`}>
                        <Info_DataTable.Cell>
                          <Info_StatusBadge status="allowed" />
                        </Info_DataTable.Cell>
                        <Info_DataTable.Cell>
                          <code className="font-mono text-xs">{pattern}</code>
                        </Info_DataTable.Cell>
                        <Info_DataTable.Cell muted>{comment || '-'}</Info_DataTable.Cell>
                      </Info_DataTable.Row>
                    )
                  })}
                </Info_DataTable.Body>
              </Info_DataTable>
            </Info_Section>
          )}

          {/* Documentation */}
          {source.guide?.raw && (
            <Info_Section
              title="Documentation"
              actions={
                <button
                  onClick={handleEditGuide}
                  className={cn(
                    "transition-colors text-[13px] cursor-pointer",
                    "text-muted-foreground hover:text-foreground hover:underline",
                    "focus:outline-none focus-visible:underline"
                  )}
                >
                  Edit
                </button>
              }
            >
              <Info_Markdown maxHeight={540}>
                {source.guide.raw}
              </Info_Markdown>
            </Info_Section>
          )}
        </Info_Page.Content>
      )}
    </Info_Page>
  )
}
