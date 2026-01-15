import { useState, useEffect, useCallback, useMemo } from 'react'
import { formatDistanceToNow } from 'date-fns'
import { Search, X, ChevronDown, Check } from 'lucide-react'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogDescription,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Separator } from '@/components/ui/separator'
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
} from '@/components/ui/dropdown-menu'
import { cn } from '@/lib/utils'
import type { ClaudeCodeSessionInfo } from '../../../shared/types'

/**
 * Safely get timestamp from a date that may come from IPC as string or invalid Date
 */
function safeGetTime(date: Date | string | undefined | null): number {
  if (!date) return 0
  try {
    const parsed = typeof date === 'string' ? new Date(date) : date
    const time = parsed.getTime()
    return isNaN(time) ? 0 : time
  } catch {
    return 0
  }
}

/**
 * Safely format a date that may come from IPC as string or invalid Date
 */
function safeFormatDistanceToNow(date: Date | string | undefined | null): string {
  if (!date) return 'Unknown'
  try {
    const parsed = typeof date === 'string' ? new Date(date) : date
    if (isNaN(parsed.getTime())) return 'Unknown'
    return formatDistanceToNow(parsed, { addSuffix: true })
  } catch {
    return 'Unknown'
  }
}

interface ImportClaudeCodeDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  onImportComplete: (sessionIds: string[]) => void
}

/**
 * Get project name from session (prefer originalCwd for accuracy)
 */
function getProjectName(session: ClaudeCodeSessionInfo): string {
  const path = session.originalCwd || session.projectPath
  const parts = path.split('/').filter(Boolean)
  return parts[parts.length - 1] || path
}

/**
 * Get display path from session (prefer originalCwd for accuracy)
 */
function getDisplayPath(session: ClaudeCodeSessionInfo): string {
  return session.originalCwd || session.projectPath
}

/**
 * Group sessions by project
 */
function groupSessionsByProject(
  sessions: ClaudeCodeSessionInfo[]
): Array<{ projectName: string; projectPath: string; sessions: ClaudeCodeSessionInfo[] }> {
  const groups = new Map<string, { projectName: string; projectPath: string; sessions: ClaudeCodeSessionInfo[] }>()

  for (const session of sessions) {
    const projectPath = getDisplayPath(session)
    const projectName = getProjectName(session)

    if (!groups.has(projectPath)) {
      groups.set(projectPath, { projectName, projectPath, sessions: [] })
    }
    groups.get(projectPath)!.sessions.push(session)
  }

  // Sort groups by project name, sessions within each group by date descending
  return Array.from(groups.values())
    .sort((a, b) => a.projectName.localeCompare(b.projectName))
    .map(group => ({
      ...group,
      sessions: group.sessions.sort((a, b) =>
        safeGetTime(b.lastMessageAt) - safeGetTime(a.lastMessageAt)
      ),
    }))
}

/**
 * ProjectHeader - Sticky section header showing project name
 */
function ProjectHeader({ name, path }: { name: string; path: string }) {
  return (
    <div className="sticky top-0 z-20 bg-background px-4 py-2" title={path}>
      <span className="text-[11px] font-medium text-muted-foreground uppercase tracking-wider">
        {name}
      </span>
    </div>
  )
}

interface ImportSessionItemProps {
  session: ClaudeCodeSessionInfo
  isSelected: boolean
  isFirstInGroup: boolean
  onToggle: () => void
}

/**
 * ImportSessionItem - Individual session item with selection checkbox
 */
function ImportSessionItem({
  session,
  isSelected,
  isFirstInGroup,
  onToggle,
}: ImportSessionItemProps) {
  return (
    <div
      className="import-item"
      data-selected={isSelected || undefined}
    >
      {/* Separator - only show if not first in group */}
      {!isFirstInGroup && (
        <div className="import-separator pl-12 pr-4">
          <Separator />
        </div>
      )}
      {/* Wrapper for content, group for hover state */}
      <div className="relative group select-none pl-2 mr-2">
        {/* Checkbox - positioned absolutely */}
        <div className="absolute left-4 top-3.5 z-10">
          <div
            className={cn(
              "w-4 h-4 flex items-center justify-center rounded border transition-colors cursor-pointer",
              isSelected
                ? "bg-accent border-accent text-background"
                : "border-muted-foreground/30 hover:border-muted-foreground/50"
            )}
            onClick={(e) => {
              e.stopPropagation()
              onToggle()
            }}
          >
            {isSelected && <Check className="w-3 h-3" />}
          </div>
        </div>
        {/* Main content button */}
        <button
          className={cn(
            "flex w-full items-start gap-2 pl-2 pr-4 py-3 text-left text-sm outline-none rounded-[8px]",
            "transition-[background-color] duration-75",
            isSelected
              ? "bg-foreground/5 hover:bg-foreground/7"
              : "hover:bg-foreground/2"
          )}
          onClick={onToggle}
        >
          {/* Spacer for checkbox */}
          <div className="w-4 h-5 shrink-0" />
          {/* Content column */}
          <div className="flex flex-col gap-1.5 min-w-0 flex-1">
            {/* Title - preview text, up to 2 lines */}
            <div className="flex items-start gap-2 w-full pr-6 min-w-0">
              <div className="font-medium font-sans line-clamp-2 min-w-0 -mb-[2px]">
                {session.preview || 'No preview available'}
              </div>
            </div>
            {/* Metadata row */}
            <div className="flex items-center gap-1.5 text-xs text-foreground/70 w-full -mb-[2px] pr-6 min-w-0">
              {session.gitBranch && (
                <span className="shrink-0 px-1.5 py-0.5 text-[10px] font-medium rounded bg-foreground/10">
                  {session.gitBranch}
                </span>
              )}
              <span className="shrink-0 px-1.5 py-0.5 text-[10px] font-medium rounded bg-foreground/5">
                {session.messageCount} msgs
              </span>
              <span className="truncate">
                {safeFormatDistanceToNow(session.lastMessageAt)}
              </span>
            </div>
          </div>
        </button>
      </div>
    </div>
  )
}

export function ImportClaudeCodeDialog({
  open,
  onOpenChange,
  onImportComplete,
}: ImportClaudeCodeDialogProps) {
  const [sessions, setSessions] = useState<ClaudeCodeSessionInfo[]>([])
  const [selectedPaths, setSelectedPaths] = useState<Set<string>>(new Set())
  const [loading, setLoading] = useState(false)
  const [importing, setImporting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [searchFilter, setSearchFilter] = useState('')
  const [projectFilter, setProjectFilter] = useState<Set<string>>(new Set())

  // Load sessions when dialog opens
  useEffect(() => {
    if (!open) return

    const loadSessions = async () => {
      setLoading(true)
      setError(null)
      try {
        const discovered = await window.electronAPI.discoverClaudeCodeSessions()
        // Filter out Craft Agent sessions
        setSessions(discovered.filter(s => !s.isFromCraftAgent))
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to discover sessions')
      } finally {
        setLoading(false)
      }
    }

    loadSessions()
  }, [open])

  // Reset state when dialog closes
  useEffect(() => {
    if (!open) {
      setSessions([])
      setSelectedPaths(new Set())
      setSearchFilter('')
      setProjectFilter(new Set())
      setError(null)
    }
  }, [open])

  // Get unique projects for filter dropdown
  const uniqueProjects = useMemo(() => {
    const projects = new Map<string, string>()
    for (const session of sessions) {
      const path = getDisplayPath(session)
      const name = getProjectName(session)
      if (!projects.has(path)) {
        projects.set(path, name)
      }
    }
    return Array.from(projects.entries())
      .map(([path, name]) => ({ path, name }))
      .sort((a, b) => a.name.localeCompare(b.name))
  }, [sessions])

  // Filter sessions
  const filteredSessions = useMemo(() => {
    return sessions.filter(session => {
      // Search filter (by preview/title)
      if (searchFilter.trim()) {
        const query = searchFilter.toLowerCase()
        const preview = (session.preview || '').toLowerCase()
        if (!preview.includes(query)) return false
      }
      // Project filter
      if (projectFilter.size > 0) {
        const path = getDisplayPath(session)
        if (!projectFilter.has(path)) return false
      }
      return true
    })
  }, [sessions, searchFilter, projectFilter])

  // Group filtered sessions by project
  const projectGroups = useMemo(() => {
    return groupSessionsByProject(filteredSessions)
  }, [filteredSessions])

  const toggleSession = useCallback((filePath: string) => {
    setSelectedPaths(prev => {
      const next = new Set(prev)
      if (next.has(filePath)) {
        next.delete(filePath)
      } else {
        next.add(filePath)
      }
      return next
    })
  }, [])

  const toggleProjectFilter = useCallback((projectPath: string) => {
    setProjectFilter(prev => {
      const next = new Set(prev)
      if (next.has(projectPath)) {
        next.delete(projectPath)
      } else {
        next.add(projectPath)
      }
      return next
    })
  }, [])

  const handleImport = useCallback(async () => {
    if (selectedPaths.size === 0) return

    setImporting(true)
    setError(null)
    try {
      const result = await window.electronAPI.importClaudeCodeSessions(
        Array.from(selectedPaths)
      )

      if (result.failCount > 0 && result.successCount === 0) {
        setError(`Failed to import all ${result.failCount} session(s)`)
      } else if (result.failCount > 0) {
        setError(`Imported ${result.successCount} session(s), ${result.failCount} failed`)
      }

      if (result.successCount > 0) {
        const importedIds = result.results
          .filter(r => r.success && r.sessionId)
          .map(r => r.sessionId!)
        onImportComplete(importedIds)
        onOpenChange(false)
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Import failed')
    } finally {
      setImporting(false)
    }
  }, [selectedPaths, onImportComplete, onOpenChange])

  const selectedCount = selectedPaths.size

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="sm:max-w-[600px] max-h-[80vh] flex flex-col"
        onOpenAutoFocus={(e) => e.preventDefault()}
      >
        <DialogHeader>
          <DialogTitle>Import Claude Code Sessions</DialogTitle>
          <DialogDescription>
            Select sessions from Claude Code to import into Craft Agent
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-3 flex-1 min-h-0">
          {/* Filter bar */}
          <div className="flex items-center gap-2">
            {/* Search input */}
            <div className="relative flex-1">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
              <input
                type="text"
                value={searchFilter}
                onChange={(e) => setSearchFilter(e.target.value)}
                placeholder="Search by title..."
                className="w-full h-8 pl-8 pr-8 text-sm bg-foreground/5 border-0 rounded-[8px] outline-none focus:ring-1 focus:ring-ring placeholder:text-muted-foreground/50"
              />
              {searchFilter && (
                <button
                  onClick={() => setSearchFilter('')}
                  className="absolute right-2 top-1/2 -translate-y-1/2 p-0.5 hover:bg-foreground/10 rounded"
                >
                  <X className="h-3.5 w-3.5 text-muted-foreground" />
                </button>
              )}
            </div>
            {/* Project filter dropdown */}
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="outline" size="sm" className="h-8 gap-1.5">
                  Projects
                  {projectFilter.size > 0 && (
                    <span className="px-1.5 py-0.5 text-[10px] font-medium rounded bg-accent text-background">
                      {projectFilter.size}
                    </span>
                  )}
                  <ChevronDown className="h-3.5 w-3.5" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="max-h-[300px] overflow-auto">
                {uniqueProjects.map(({ path, name }) => (
                  <DropdownMenuItem
                    key={path}
                    onClick={() => toggleProjectFilter(path)}
                    className="gap-2"
                  >
                    <div className={cn(
                      "w-4 h-4 flex items-center justify-center rounded border",
                      projectFilter.has(path)
                        ? "bg-accent border-accent text-background"
                        : "border-muted-foreground/30"
                    )}>
                      {projectFilter.has(path) && <Check className="w-3 h-3" />}
                    </div>
                    <span className="truncate">{name}</span>
                  </DropdownMenuItem>
                ))}
                {projectFilter.size > 0 && (
                  <>
                    <Separator className="my-1" />
                    <DropdownMenuItem onClick={() => setProjectFilter(new Set())}>
                      Clear filters
                    </DropdownMenuItem>
                  </>
                )}
              </DropdownMenuContent>
            </DropdownMenu>
          </div>

          {/* Sessions list */}
          <div className="flex-1 min-h-0 -mx-6">
            {loading ? (
              <div className="h-[300px] flex items-center justify-center text-muted-foreground">
                <div className="flex flex-col items-center gap-2">
                  <div className="animate-pulse text-sm">Discovering Claude Code sessions...</div>
                  <div className="text-xs text-muted-foreground/60">Scanning ~/.claude/projects/</div>
                </div>
              </div>
            ) : error && sessions.length === 0 ? (
              <div className="h-[300px] flex items-center justify-center">
                <div className="flex flex-col items-center gap-2 text-destructive">
                  <span className="text-sm font-medium">Failed to discover sessions</span>
                  <span className="text-xs text-muted-foreground">{error}</span>
                </div>
              </div>
            ) : filteredSessions.length === 0 ? (
              <div className="h-[300px] flex items-center justify-center">
                <div className="flex flex-col items-center gap-1 text-muted-foreground">
                  <span>No sessions found</span>
                  {(searchFilter || projectFilter.size > 0) && (
                    <button
                      onClick={() => {
                        setSearchFilter('')
                        setProjectFilter(new Set())
                      }}
                      className="text-xs text-foreground hover:underline mt-1"
                    >
                      Clear filters
                    </button>
                  )}
                </div>
              </div>
            ) : (
              <ScrollArea className="h-[400px]">
                <div className="flex flex-col pb-4">
                  {projectGroups.map((group) => (
                    <div key={group.projectPath}>
                      <ProjectHeader name={group.projectName} path={group.projectPath} />
                      {group.sessions.map((session, indexInGroup) => (
                        <ImportSessionItem
                          key={session.filePath}
                          session={session}
                          isSelected={selectedPaths.has(session.filePath)}
                          isFirstInGroup={indexInGroup === 0}
                          onToggle={() => toggleSession(session.filePath)}
                        />
                      ))}
                    </div>
                  ))}
                </div>
              </ScrollArea>
            )}
          </div>

          {/* Show partial success/failure message */}
          {error && !loading && sessions.length > 0 && (
            <p className="text-sm text-amber-500">{error}</p>
          )}
        </div>

        <DialogFooter>
          <div className="flex items-center gap-2 mr-auto text-sm text-muted-foreground">
            {selectedCount > 0 && `${selectedCount} selected`}
          </div>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            onClick={handleImport}
            disabled={selectedCount === 0 || importing}
          >
            {importing ? 'Importing...' : `Import${selectedCount > 0 ? ` (${selectedCount})` : ''}`}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
