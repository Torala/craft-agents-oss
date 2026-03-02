import { ipcMain } from 'electron'
import { IPC_CHANNELS } from '../../shared/types'
import { getWorkspaceByNameOrId } from '@craft-agent/shared/config'
import type { IpcContext } from './types'

export const HANDLED_CHANNELS = [
  IPC_CHANNELS.statuses.LIST,
  IPC_CHANNELS.statuses.REORDER,
] as const

export function registerStatusesHandlers(_ctx: IpcContext): void {
  // List all statuses for a workspace
  ipcMain.handle(IPC_CHANNELS.statuses.LIST, async (_event, workspaceId: string) => {
    const workspace = getWorkspaceByNameOrId(workspaceId)
    if (!workspace) throw new Error('Workspace not found')

    const { listStatuses } = await import('@craft-agent/shared/statuses')
    return listStatuses(workspace.rootPath)
  })

  // Reorder statuses (drag-and-drop). Receives new ordered array of status IDs.
  // Config watcher will detect the file change and broadcast STATUSES_CHANGED.
  ipcMain.handle(IPC_CHANNELS.statuses.REORDER, async (_event, workspaceId: string, orderedIds: string[]) => {
    const workspace = getWorkspaceByNameOrId(workspaceId)
    if (!workspace) throw new Error('Workspace not found')

    const { reorderStatuses } = await import('@craft-agent/shared/statuses')
    reorderStatuses(workspace.rootPath, orderedIds)
  })
}
