import { ipcMain } from 'electron'
import { IPC_CHANNELS } from '../../shared/types'
import { getWorkspaceByNameOrId } from '@craft-agent/shared/config'
import type { IpcContext } from './types'

export const HANDLED_CHANNELS = [
  IPC_CHANNELS.labels.LIST,
  IPC_CHANNELS.labels.CREATE,
  IPC_CHANNELS.labels.DELETE,
] as const

export function registerLabelsHandlers({ windowManager }: IpcContext): void {
  // List all labels for a workspace
  ipcMain.handle(IPC_CHANNELS.labels.LIST, async (_event, workspaceId: string) => {
    const workspace = getWorkspaceByNameOrId(workspaceId)
    if (!workspace) throw new Error('Workspace not found')

    const { listLabels } = await import('@craft-agent/shared/labels/storage')
    return listLabels(workspace.rootPath)
  })

  // Create a new label in a workspace
  ipcMain.handle(IPC_CHANNELS.labels.CREATE, async (_event, workspaceId: string, input: import('@craft-agent/shared/labels').CreateLabelInput) => {
    const workspace = getWorkspaceByNameOrId(workspaceId)
    if (!workspace) throw new Error('Workspace not found')

    const { createLabel } = await import('@craft-agent/shared/labels/crud')
    const label = createLabel(workspace.rootPath, input)
    windowManager.broadcastToAll(IPC_CHANNELS.labels.CHANGED, workspaceId)
    return label
  })

  // Delete a label (and descendants) from a workspace
  ipcMain.handle(IPC_CHANNELS.labels.DELETE, async (_event, workspaceId: string, labelId: string) => {
    const workspace = getWorkspaceByNameOrId(workspaceId)
    if (!workspace) throw new Error('Workspace not found')

    const { deleteLabel } = await import('@craft-agent/shared/labels/crud')
    const result = deleteLabel(workspace.rootPath, labelId)
    windowManager.broadcastToAll(IPC_CHANNELS.labels.CHANGED, workspaceId)
    return result
  })
}
