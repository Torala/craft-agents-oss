import { Info, RotateCw, KeyRound, Trash2 } from "lucide-react"
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from "@/components/ui/context-menu"
import type { SubAgentMetadata } from "../../../shared/types"

export type AgentAction =
  | { type: 'info'; agent: SubAgentMetadata }
  | { type: 'reload'; agent: SubAgentMetadata }
  | { type: 'reauthenticate'; agent: SubAgentMetadata }
  | { type: 'reset'; agent: SubAgentMetadata }

interface AgentContextMenuProps {
  agent: SubAgentMetadata
  children: React.ReactNode
  onAction: (action: AgentAction) => void
  onOpenChange?: (open: boolean) => void
}

/**
 * Context menu for agent items in the sidebar
 * Actions: Info, Reload, Reauthenticate, Reset
 */
export function AgentContextMenu({
  agent,
  children,
  onAction,
  onOpenChange,
}: AgentContextMenuProps) {
  return (
    <ContextMenu onOpenChange={onOpenChange}>
      <ContextMenuTrigger asChild>
        {children}
      </ContextMenuTrigger>
      <ContextMenuContent className="w-48">
        <ContextMenuItem onClick={() => onAction({ type: 'info', agent })} shortcut="I">
          <Info />
          Info
        </ContextMenuItem>
        <ContextMenuSeparator />
        <ContextMenuItem onClick={() => onAction({ type: 'reload', agent })} shortcut="L">
          <RotateCw />
          Reload
        </ContextMenuItem>
        <ContextMenuItem onClick={() => onAction({ type: 'reauthenticate', agent })} shortcut="A">
          <KeyRound />
          Reauthenticate
        </ContextMenuItem>
        <ContextMenuSeparator />
        <ContextMenuItem onClick={() => onAction({ type: 'reset', agent })} variant="destructive" shortcut="R">
          <Trash2 />
          Reset
        </ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>
  )
}
