import { useState, useEffect, useCallback, useMemo } from 'react'
import type { ColumnDef } from '@tanstack/react-table'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogDescription,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { DataTable, SortableHeader } from '@/components/ui/data-table'
import type { ClaudeCodeSessionInfo } from '../../../shared/types'

interface ImportClaudeCodeDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  onImportComplete: (sessionIds: string[]) => void
}

interface SessionRow extends ClaudeCodeSessionInfo {
  selected: boolean
}

export function ImportClaudeCodeDialog({
  open,
  onOpenChange,
  onImportComplete,
}: ImportClaudeCodeDialogProps) {
  const [sessions, setSessions] = useState<SessionRow[]>([])
  const [loading, setLoading] = useState(false)
  const [importing, setImporting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [searchFilter, setSearchFilter] = useState('')

  // Load sessions when dialog opens
  useEffect(() => {
    if (!open) return

    const loadSessions = async () => {
      setLoading(true)
      setError(null)
      try {
        const discovered = await window.electronAPI.discoverClaudeCodeSessions()
        setSessions(discovered.map(s => ({ ...s, selected: false })))
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
      setSearchFilter('')
      setError(null)
    }
  }, [open])

  const toggleSession = useCallback((filePath: string) => {
    setSessions(prev =>
      prev.map(s =>
        s.filePath === filePath ? { ...s, selected: !s.selected } : s
      )
    )
  }, [])

  const toggleAll = useCallback(() => {
    setSessions(prev => {
      const allSelected = prev.every(s => s.selected)
      return prev.map(s => ({ ...s, selected: !allSelected }))
    })
  }, [])

  const selectedCount = useMemo(
    () => sessions.filter(s => s.selected).length,
    [sessions]
  )

  const handleImport = useCallback(async () => {
    const selectedSessions = sessions.filter(s => s.selected)
    if (selectedSessions.length === 0) return

    setImporting(true)
    setError(null)
    try {
      const result = await window.electronAPI.importClaudeCodeSessions(
        selectedSessions.map(s => s.filePath)
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
  }, [sessions, onImportComplete, onOpenChange])

  // Format date for display
  const formatDate = (date: Date | string) => {
    const d = typeof date === 'string' ? new Date(date) : date
    return d.toLocaleDateString(undefined, {
      month: 'short',
      day: 'numeric',
      year: d.getFullYear() !== new Date().getFullYear() ? 'numeric' : undefined,
    })
  }

  // Format file size
  const formatSize = (bytes: number) => {
    if (bytes < 1024) return `${bytes} B`
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
  }

  // Track if all filtered sessions are selected (for header checkbox)
  const allSelected = useMemo(
    () => sessions.length > 0 && sessions.every(s => s.selected),
    [sessions]
  )

  // Column definitions - only depend on callbacks, not on sessions array
  const columns: ColumnDef<SessionRow, unknown>[] = useMemo(
    () => [
      {
        id: 'select',
        header: () => (
          <button
            onClick={toggleAll}
            className="w-4 h-4 border border-border rounded flex items-center justify-center hover:bg-accent/50"
            aria-label="Select all sessions"
            role="checkbox"
            aria-checked={allSelected}
          >
            {allSelected && <span className="text-xs">✓</span>}
          </button>
        ),
        cell: ({ row }) => (
          <button
            onClick={() => toggleSession(row.original.filePath)}
            className="w-4 h-4 border border-border rounded flex items-center justify-center hover:bg-accent/50"
            aria-label={`Select session from ${row.original.projectPath}`}
            role="checkbox"
            aria-checked={row.original.selected}
          >
            {row.original.selected && <span className="text-xs">✓</span>}
          </button>
        ),
        size: 40,
        enableSorting: false,
        enableResizing: false,
      },
      {
        id: 'project',
        accessorFn: (row) => row.projectPath,
        header: ({ column }) => <SortableHeader column={column} title="Project" />,
        cell: ({ row }) => (
          <div className="truncate max-w-[200px]" title={row.original.projectPath}>
            {row.original.projectPath}
          </div>
        ),
        meta: { truncate: true, fillWidth: true },
      },
      {
        id: 'branch',
        accessorFn: (row) => row.gitBranch,
        header: ({ column }) => <SortableHeader column={column} title="Branch" />,
        cell: ({ row }) => (
          <span className="text-muted-foreground">
            {row.original.gitBranch || '—'}
          </span>
        ),
        size: 100,
      },
      {
        id: 'messages',
        accessorFn: (row) => row.messageCount,
        header: ({ column }) => <SortableHeader column={column} title="Messages" />,
        cell: ({ row }) => row.original.messageCount,
        size: 80,
      },
      {
        id: 'date',
        accessorFn: (row) => new Date(row.lastMessageAt).getTime(),
        header: ({ column }) => <SortableHeader column={column} title="Last Used" />,
        cell: ({ row }) => formatDate(row.original.lastMessageAt),
        size: 100,
      },
      {
        id: 'size',
        accessorFn: (row) => row.fileSize,
        header: ({ column }) => <SortableHeader column={column} title="Size" />,
        cell: ({ row }) => formatSize(row.original.fileSize),
        size: 80,
      },
    ],
    [allSelected, toggleAll, toggleSession]
  )

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="sm:max-w-[800px] max-h-[80vh] flex flex-col"
        onOpenAutoFocus={(e) => e.preventDefault()}
      >
        <DialogHeader>
          <DialogTitle>Import Claude Code Sessions</DialogTitle>
          <DialogDescription>
            Select sessions from Claude Code to import into Craft Agent
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-4 flex-1 min-h-0">
          {/* Search input */}
          <Input
            placeholder="Filter by project path..."
            value={searchFilter}
            onChange={(e) => setSearchFilter(e.target.value)}
          />

          {/* Sessions table */}
          <div className="flex-1 min-h-0 overflow-auto">
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
            ) : (
              <DataTable
                columns={columns}
                data={sessions}
                globalFilter={searchFilter}
                pagination
                pageSize={50}
                emptyContent={
                  <div className="flex flex-col items-center gap-1 text-muted-foreground">
                    <span>No Claude Code sessions found</span>
                    <span className="text-xs">Sessions are stored in ~/.claude/projects/</span>
                  </div>
                }
                noBorder
              />
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
