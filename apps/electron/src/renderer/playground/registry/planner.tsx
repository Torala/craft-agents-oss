import * as React from 'react'
import {
  DndContext,
  PointerSensor,
  KeyboardSensor,
  closestCenter,
  pointerWithin,
  useSensor,
  useSensors,
  useDroppable,
  DragOverlay,
  type CollisionDetection,
  type DropAnimation,
  type DragStartEvent,
  type DragEndEvent,
  type DragOverEvent,
  type DragCancelEvent,
} from '@dnd-kit/core'
import {
  SortableContext,
  useSortable,
  verticalListSortingStrategy,
  sortableKeyboardCoordinates,
} from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { AnimatePresence, motion } from 'motion/react'
import {
  AlertTriangle,
  CheckCircle2,
  Circle,
  Cloud,
  CloudAlert,
  CloudCheck,
  CloudOff,
  CloudUpload,
  GripVertical,
  ListTodo,
  PauseCircle,
  XCircle,
} from 'lucide-react'
import { Tooltip, TooltipTrigger, TooltipContent } from '@craft-agent/ui'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Badge } from '@/components/ui/badge'
import { ScrollArea } from '@/components/ui/scroll-area'
import { cn } from '@/lib/utils'
import type { ComponentEntry } from './types'

type TaskState = 'todo' | 'in_progress' | 'blocked' | 'done' | 'cancelled'
type SyncState = 'local_only' | 'pending_upload' | 'uploaded' | 'remote_only' | 'unavailable' | 'upload_failed'

function hasNoDndAncestor(element: HTMLElement | null): boolean {
  while (element) {
    if (element.dataset?.noDnd === 'true') return true
    element = element.parentElement
  }
  return false
}

class SmartPointerSensor extends PointerSensor {
  static activators = [
    {
      eventName: 'onPointerDown' as const,
      handler: ({ nativeEvent }: { nativeEvent: PointerEvent }) => {
        if (hasNoDndAncestor(nativeEvent.target as HTMLElement)) return false
        return true
      },
    },
  ]
}

const MIDPOINT_DEADZONE_PX = 8

const composedCollisionDetection: CollisionDetection = (args) => {
  const pointerCollisions = pointerWithin(args)
  if (pointerCollisions.length > 0) return pointerCollisions
  return closestCenter(args)
}

const overlayDropAnimation: DropAnimation = {
  duration: 180,
  easing: 'cubic-bezier(0.22, 1, 0.36, 1)',
}

interface PlannerTask {
  id: string
  title: string
  notes: string
  state: TaskState
  due: string
  syncState: SyncState
}

interface PlannerHeading {
  id: string
  title: string
  tasks: PlannerTask[]
}

const TASK_STATE_META: Record<TaskState, { label: string; icon: React.ComponentType<{ className?: string }>; className: string }> = {
  todo: { label: 'Todo', icon: Circle, className: 'text-foreground/40' },
  in_progress: { label: 'In Progress', icon: PauseCircle, className: 'text-info' },
  blocked: { label: 'Blocked', icon: AlertTriangle, className: 'text-warning' },
  done: { label: 'Done', icon: CheckCircle2, className: 'text-success' },
  cancelled: { label: 'Cancelled', icon: XCircle, className: 'text-destructive/80' },
}

const SYNC_META: Record<SyncState, { label: string; icon: React.ComponentType<{ className?: string }>; className: string }> = {
  local_only: { label: 'Local only', icon: CloudOff, className: 'text-foreground/50 bg-foreground/5' },
  pending_upload: { label: 'Pending upload', icon: CloudUpload, className: 'text-info bg-info/10' },
  uploaded: { label: 'Uploaded', icon: CloudCheck, className: 'text-success bg-success/10' },
  remote_only: { label: 'Remote only', icon: Cloud, className: 'text-accent bg-accent/10' },
  unavailable: { label: 'Unavailable', icon: CloudAlert, className: 'text-warning bg-warning/10' },
  upload_failed: { label: 'Upload failed', icon: AlertTriangle, className: 'text-destructive bg-destructive/10' },
}

function createBoard(dense: boolean): PlannerHeading[] {
  const base: PlannerHeading[] = [
    {
      id: 'today',
      title: 'Today',
      tasks: [
        {
          id: 'task-1',
          title: 'Refine planner drag interactions',
          notes: 'Tune spring + overlay shadow for tactile movement.',
          state: 'in_progress',
          due: 'Today · 16:30',
          syncState: 'pending_upload',
        },
        {
          id: 'task-2',
          title: 'Add animated completion checkmark',
          notes: 'Morph icon and fade metadata with low-motion fallback.',
          state: 'todo',
          due: 'Today · 18:00',
          syncState: 'uploaded',
        },
      ],
    },
    {
      id: 'upcoming',
      title: 'Upcoming',
      tasks: [
        {
          id: 'task-3',
          title: 'Session snapshot cards for missing links',
          notes: 'Cards must remain useful even without live session resolution.',
          state: 'blocked',
          due: 'Tomorrow',
          syncState: 'unavailable',
        },
        {
          id: 'task-4',
          title: 'Quick-add natural language parser',
          notes: 'Parse “tomorrow 9am” and estimate defaults.',
          state: 'todo',
          due: 'Mon',
          syncState: 'local_only',
        },
      ],
    },
  ]

  if (!dense) return base

  const filler: PlannerTask[] = Array.from({ length: 36 }).map((_, i) => {
    const id = `dense-${i + 1}`
    const states: TaskState[] = ['todo', 'in_progress', 'blocked', 'done', 'cancelled']
    const syncStates: SyncState[] = ['local_only', 'pending_upload', 'uploaded', 'remote_only', 'unavailable', 'upload_failed']

    return {
      id,
      title: `Design polish pass #${i + 1}`,
      notes: 'Validate spacing rhythm, icon alignment, and hover depth.',
      state: states[i % states.length],
      due: i % 2 === 0 ? 'This week' : 'Next week',
      syncState: syncStates[i % syncStates.length],
    }
  })

  return [
    {
      id: 'today',
      title: 'Today',
      tasks: base[0].tasks,
    },
    {
      id: 'upcoming',
      title: 'Upcoming',
      tasks: [...base[1].tasks, ...filler],
    },
  ]
}

function findContainer(headings: PlannerHeading[], id: string): string | undefined {
  if (headings.some(h => h.id === id)) return id
  return headings.find(h => h.tasks.some(t => t.id === id))?.id
}

function findTask(headings: PlannerHeading[], taskId: string): PlannerTask | undefined {
  for (const heading of headings) {
    const match = heading.tasks.find(t => t.id === taskId)
    if (match) return match
  }
  return undefined
}

function shortDue(due: string): string {
  const lower = due.toLowerCase()
  if (lower.includes('today')) return 'Today'
  if (lower.includes('tomorrow')) return 'Tom'
  if (lower.includes('this week')) return 'Week'
  if (lower.includes('next week')) return 'Nxt'
  return due.length > 10 ? `${due.slice(0, 10)}…` : due
}

function shortSync(label: string): string {
  if (label === 'Pending upload') return 'Pending'
  if (label === 'Upload failed') return 'Failed'
  if (label === 'Local only') return 'Local'
  if (label === 'Remote only') return 'Remote'
  return label
}

const TASK_DND_PREFIX = 'task:'
const HEADING_DND_PREFIX = 'heading:'
const HEADING_DROP_DND_PREFIX = 'heading-drop:'

const taskDndId = (taskId: string) => `${TASK_DND_PREFIX}${taskId}`
const headingDndId = (headingId: string) => `${HEADING_DND_PREFIX}${headingId}`
const headingDropDndId = (headingId: string) => `${HEADING_DROP_DND_PREFIX}${headingId}`

const parseTaskDndId = (id: string) => id.startsWith(TASK_DND_PREFIX) ? id.slice(TASK_DND_PREFIX.length) : null
const parseHeadingDndId = (id: string) => id.startsWith(HEADING_DND_PREFIX) ? id.slice(HEADING_DND_PREFIX.length) : null
const parseHeadingDropDndId = (id: string) => id.startsWith(HEADING_DROP_DND_PREFIX) ? id.slice(HEADING_DROP_DND_PREFIX.length) : null

interface DropTarget {
  containerId: string
  index: number
}

function moveInArray<T>(arr: T[], fromIndex: number, toIndex: number): T[] {
  const next = [...arr]
  const [item] = next.splice(fromIndex, 1)
  next.splice(toIndex, 0, item)
  return next
}

function resolveOverHeadingId(headings: PlannerHeading[], overDndId: string): string | null {
  const headingId = parseHeadingDndId(overDndId)
  if (headingId) return headingId

  const dropHeadingId = parseHeadingDropDndId(overDndId)
  if (dropHeadingId) return dropHeadingId

  const overTaskId = parseTaskDndId(overDndId)
  if (overTaskId) return findContainer(headings, overTaskId) ?? null

  return null
}

function getDropTarget(
  headings: PlannerHeading[],
  activeTaskId: string,
  overDndId: string,
  isBelowOverItem: boolean,
): DropTarget | null {
  const activeContainer = findContainer(headings, activeTaskId)
  if (!activeContainer) return null

  const overTaskId = parseTaskDndId(overDndId)
  const overHeadingId = resolveOverHeadingId(headings, overDndId)
  if (!overHeadingId) return null

  const targetHeading = headings.find(h => h.id === overHeadingId)
  if (!targetHeading) return null

  // Dropping over heading container/header means append
  if (!overTaskId) {
    const activeIndexInTarget = targetHeading.tasks.findIndex(t => t.id === activeTaskId)
    const baseIndex = targetHeading.tasks.length
    const adjustedIndex = activeContainer === overHeadingId && activeIndexInTarget >= 0 ? baseIndex - 1 : baseIndex
    return { containerId: overHeadingId, index: Math.max(0, adjustedIndex) }
  }

  const overIndex = targetHeading.tasks.findIndex(t => t.id === overTaskId)
  if (overIndex < 0) return null

  let targetIndex = overIndex + (isBelowOverItem ? 1 : 0)

  if (activeContainer === overHeadingId) {
    const activeIndex = targetHeading.tasks.findIndex(t => t.id === activeTaskId)
    if (activeIndex >= 0 && activeIndex < targetIndex) {
      targetIndex -= 1
    }
  }

  targetIndex = Math.max(0, Math.min(targetIndex, targetHeading.tasks.length))
  return { containerId: overHeadingId, index: targetIndex }
}

function applyDropTarget(headings: PlannerHeading[], activeTaskId: string, target: DropTarget | null): PlannerHeading[] {
  if (!target) return headings

  const sourceContainerId = findContainer(headings, activeTaskId)
  if (!sourceContainerId) return headings

  const sourceHeadingIndex = headings.findIndex(h => h.id === sourceContainerId)
  const targetHeadingIndex = headings.findIndex(h => h.id === target.containerId)
  if (sourceHeadingIndex < 0 || targetHeadingIndex < 0) return headings

  const sourceTasks = headings[sourceHeadingIndex].tasks
  const sourceIndex = sourceTasks.findIndex(t => t.id === activeTaskId)
  if (sourceIndex < 0) return headings

  const movingTask = sourceTasks[sourceIndex]

  if (sourceContainerId === target.containerId) {
    if (sourceIndex === target.index) return headings
    const withoutTask = sourceTasks.filter(t => t.id !== activeTaskId)
    const nextIndex = Math.max(0, Math.min(target.index, withoutTask.length))
    const nextTasks = [...withoutTask.slice(0, nextIndex), movingTask, ...withoutTask.slice(nextIndex)]
    const next = [...headings]
    next[sourceHeadingIndex] = { ...next[sourceHeadingIndex], tasks: nextTasks }
    return next
  }

  const targetTasks = headings[targetHeadingIndex].tasks
  const cleanSourceTasks = sourceTasks.filter(t => t.id !== activeTaskId)
  const insertIndex = Math.max(0, Math.min(target.index, targetTasks.length))
  const nextTargetTasks = [...targetTasks.slice(0, insertIndex), movingTask, ...targetTasks.slice(insertIndex)]

  const next = [...headings]
  next[sourceHeadingIndex] = { ...next[sourceHeadingIndex], tasks: cleanSourceTasks }
  next[targetHeadingIndex] = { ...next[targetHeadingIndex], tasks: nextTargetTasks }
  return next
}

function reorderHeadings(headings: PlannerHeading[], activeHeadingId: string, overDndId: string): PlannerHeading[] {
  const fromIndex = headings.findIndex(h => h.id === activeHeadingId)
  if (fromIndex < 0) return headings

  const targetHeadingId = resolveOverHeadingId(headings, overDndId)
  if (!targetHeadingId || targetHeadingId === activeHeadingId) return headings

  const toIndex = headings.findIndex(h => h.id === targetHeadingId)
  if (toIndex < 0 || toIndex === fromIndex) return headings

  return moveInArray(headings, fromIndex, toIndex)
}

interface PlannerPlaygroundProps {
  dense?: boolean
  reducedMotion?: boolean
}

function PlannerPlayground({ dense = false, reducedMotion = false }: PlannerPlaygroundProps) {
  const [headings, setHeadings] = React.useState<PlannerHeading[]>(() => createBoard(dense))
  const [selectedTaskId, setSelectedTaskId] = React.useState<string>(() => createBoard(dense)[0].tasks[0]?.id ?? '')
  const [quickAdd, setQuickAdd] = React.useState('')
  const [activeTaskId, setActiveTaskId] = React.useState<string | null>(null)
  const [activeHeadingId, setActiveHeadingId] = React.useState<string | null>(null)
  const [activePreviewWidth, setActivePreviewWidth] = React.useState<number | null>(null)
  const [dropTarget, setDropTarget] = React.useState<DropTarget | null>(null)
  const lastOverIdRef = React.useRef<string | null>(null)
  const lastSideRef = React.useRef<'before' | 'after'>('after')

  const sensors = useSensors(
    useSensor(SmartPointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
  )

  const selectedTask = React.useMemo(() => findTask(headings, selectedTaskId), [headings, selectedTaskId])
  const activeTask = React.useMemo(() => (activeTaskId ? findTask(headings, activeTaskId) : undefined), [headings, activeTaskId])
  const activeHeading = React.useMemo(() => (activeHeadingId ? headings.find(h => h.id === activeHeadingId) : undefined), [headings, activeHeadingId])

  const updateTask = React.useCallback((taskId: string, patch: Partial<PlannerTask>) => {
    setHeadings(prev => prev.map(heading => ({
      ...heading,
      tasks: heading.tasks.map(task => task.id === taskId ? { ...task, ...patch } : task),
    })))
  }, [])

  const addTaskToToday = React.useCallback(() => {
    const title = quickAdd.trim()
    if (!title) return

    const next: PlannerTask = {
      id: `task-${Date.now()}`,
      title,
      notes: '',
      state: 'todo',
      due: 'Inbox',
      syncState: 'local_only',
    }

    setHeadings(prev => prev.map(heading =>
      heading.id === 'today'
        ? { ...heading, tasks: [next, ...heading.tasks] }
        : heading
    ))

    setSelectedTaskId(next.id)
    setQuickAdd('')
  }, [quickAdd])

  const onDragStart = React.useCallback((event: DragStartEvent) => {
    const activeDndId = String(event.active.id)
    const taskId = parseTaskDndId(activeDndId)
    const headingId = parseHeadingDndId(activeDndId)

    if (taskId) {
      setActiveTaskId(taskId)
      setActiveHeadingId(null)
    } else if (headingId) {
      setActiveHeadingId(headingId)
      setActiveTaskId(null)
    }

    setActivePreviewWidth(event.active.rect.current.initial?.width ?? null)
    setDropTarget(null)
    lastOverIdRef.current = null
    lastSideRef.current = 'after'
  }, [])

  const onDragOver = React.useCallback((event: DragOverEvent) => {
    if (!activeTaskId) return

    const { active, over } = event
    const resolvedOverId = over ? String(over.id) : lastOverIdRef.current
    if (!resolvedOverId) {
      setDropTarget(null)
      return
    }

    const overRect = over?.rect
    const pointerY = (active.rect.current.translated?.top ?? 0)
      + (active.rect.current.translated?.height ?? active.rect.current.initial?.height ?? 0) / 2

    let side: 'before' | 'after' = lastSideRef.current

    if (overRect) {
      const overMidY = overRect.top + overRect.height / 2
      const delta = pointerY - overMidY
      const deadzone = Math.min(MIDPOINT_DEADZONE_PX, overRect.height * 0.2)

      if (Math.abs(delta) > deadzone || lastOverIdRef.current !== resolvedOverId) {
        side = delta >= 0 ? 'after' : 'before'
      }
    }

    lastOverIdRef.current = resolvedOverId
    lastSideRef.current = side

    setDropTarget(getDropTarget(headings, activeTaskId, resolvedOverId, side === 'after'))
  }, [headings, activeTaskId])

  const onDragEnd = React.useCallback((event: DragEndEvent) => {
    const { over } = event
    const resolvedOverId = over ? String(over.id) : lastOverIdRef.current

    if (activeHeadingId && resolvedOverId) {
      setHeadings(prev => reorderHeadings(prev, activeHeadingId, resolvedOverId))
    }

    if (activeTaskId && resolvedOverId) {
      setHeadings(prev => applyDropTarget(prev, activeTaskId, getDropTarget(prev, activeTaskId, resolvedOverId, lastSideRef.current === 'after')))
    }

    setActiveTaskId(null)
    setActiveHeadingId(null)
    setActivePreviewWidth(null)
    setDropTarget(null)
    lastOverIdRef.current = null
  }, [activeTaskId, activeHeadingId])

  const onDragCancel = React.useCallback((_event: DragCancelEvent) => {
    setActiveTaskId(null)
    setActiveHeadingId(null)
    setActivePreviewWidth(null)
    setDropTarget(null)
    lastOverIdRef.current = null
  }, [])

  return (
    <div className="w-[1120px] h-[740px] border border-border rounded-xl bg-background shadow-sm overflow-hidden">
      <div className="h-full grid grid-cols-[2fr_1fr]">
        <div className="border-r border-border/60 flex flex-col">
          <div className="px-5 pt-4 pb-3 border-b border-border/50">
            <div className="flex items-center gap-2 mb-3">
              <div className="h-8 w-8 rounded-lg bg-accent/10 text-accent flex items-center justify-center">
                <ListTodo className="h-4 w-4" />
              </div>
              <div>
                <div className="text-sm font-semibold">Planner</div>
                <div className="text-xs text-foreground/50">Things-style interaction playground</div>
              </div>
              <Badge variant="secondary" className="ml-auto text-[10px]">Premium Motion</Badge>
            </div>

            <div className="flex gap-2">
              <Input
                value={quickAdd}
                onChange={(e) => setQuickAdd(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') addTaskToToday()
                }}
                placeholder="Quick add task… (Enter)"
                className="h-8 text-sm"
              />
              <Button size="sm" onClick={addTaskToToday}>Add</Button>
            </div>
          </div>

          <ScrollArea className="flex-1">
            <DndContext
              sensors={sensors}
              collisionDetection={composedCollisionDetection}
              onDragStart={onDragStart}
              onDragOver={onDragOver}
              onDragEnd={onDragEnd}
              onDragCancel={onDragCancel}
            >
              <div className="px-4 py-4 space-y-5">
                <SortableContext items={headings.map(heading => headingDndId(heading.id))} strategy={verticalListSortingStrategy}>
                  {headings.map(heading => (
                    <SortableHeading key={heading.id} heading={heading} reducedMotion={reducedMotion}>
                      <HeadingDropZone id={headingDropDndId(heading.id)}>
                        <SortableContext items={heading.tasks.map(task => taskDndId(task.id))} strategy={verticalListSortingStrategy}>
                          <div className="space-y-1.5">
                            <AnimatePresence initial={false}>
                              {heading.tasks.map((task, index) => (
                                <React.Fragment key={task.id}>
                                  <AnimatePresence initial={false}>
                                    {activeTaskId && dropTarget?.containerId === heading.id && dropTarget.index === index ? (
                                      <InsertionMarker key={`marker-${heading.id}-${index}`} />
                                    ) : null}
                                  </AnimatePresence>
                                  <SortableTaskRow
                                    task={task}
                                    selected={selectedTaskId === task.id}
                                    reducedMotion={reducedMotion}
                                    onSelect={() => setSelectedTaskId(task.id)}
                                    onToggleDone={() => {
                                      const next = task.state === 'done' ? 'todo' : 'done'
                                      updateTask(task.id, { state: next })
                                    }}
                                  />
                                </React.Fragment>
                              ))}
                              <AnimatePresence initial={false}>
                                {activeTaskId && dropTarget?.containerId === heading.id && dropTarget.index === heading.tasks.length ? (
                                  <InsertionMarker key={`marker-${heading.id}-end`} />
                                ) : null}
                              </AnimatePresence>
                            </AnimatePresence>
                          </div>
                        </SortableContext>
                      </HeadingDropZone>
                    </SortableHeading>
                  ))}
                </SortableContext>
              </div>

              <DragOverlay dropAnimation={overlayDropAnimation}>
                {activeTask ? <TaskDragPreview task={activeTask} width={activePreviewWidth ?? undefined} /> : null}
                {activeHeading ? <HeadingDragPreview heading={activeHeading} width={activePreviewWidth ?? undefined} /> : null}
              </DragOverlay>
            </DndContext>
          </ScrollArea>
        </div>

        <TaskEditorPanel
          task={selectedTask}
          onUpdate={(patch) => {
            if (!selectedTask) return
            updateTask(selectedTask.id, patch)
          }}
        />
      </div>
    </div>
  )
}

function SortableHeading({ heading, reducedMotion, children }: { heading: PlannerHeading; reducedMotion: boolean; children: React.ReactNode }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: headingDndId(heading.id) })

  return (
    <motion.div
      ref={setNodeRef}
      layout={!reducedMotion}
      initial={{ opacity: 0, y: reducedMotion ? 0 : 4 }}
      animate={{ opacity: isDragging ? 0 : 1, y: 0 }}
      exit={{ opacity: 0, y: reducedMotion ? 0 : -4 }}
      transition={reducedMotion ? { duration: 0 } : { type: 'spring', stiffness: 420, damping: 34 }}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      className="space-y-2"
    >
      <div
        className="px-1 py-1 text-xs font-semibold tracking-wide uppercase text-foreground/45 cursor-grab active:cursor-grabbing flex items-center gap-1"
        {...attributes}
        {...listeners}
      >
        <GripVertical className="h-3.5 w-3.5 text-foreground/30" />
        {heading.title}
      </div>
      {children}
    </motion.div>
  )
}

function HeadingDropZone({ id, children }: { id: string; children: React.ReactNode }) {
  const { setNodeRef, isOver } = useDroppable({ id })

  return (
    <div
      ref={setNodeRef}
      className={cn(
        'rounded-xl p-1 transition-colors',
        isOver && 'bg-accent/5 ring-1 ring-accent/20'
      )}
    >
      {children}
    </div>
  )
}

interface SortableTaskRowProps {
  task: PlannerTask
  selected: boolean
  reducedMotion: boolean
  onSelect: () => void
  onToggleDone: () => void
}

function InsertionMarker() {
  return (
    <motion.div
      layout
      initial={{ height: 0, opacity: 0 }}
      animate={{ height: 36, opacity: 1 }}
      exit={{ height: 0, opacity: 0 }}
      transition={{ type: 'spring', stiffness: 420, damping: 34 }}
      className="rounded-lg bg-foreground/25"
    />
  )
}

function TaskRowContent({ task, onToggleDone, showTooltips = true }: { task: PlannerTask; onToggleDone?: () => void; showTooltips?: boolean }) {
  const TaskIcon = TASK_STATE_META[task.state].icon
  const sync = SYNC_META[task.syncState]
  const SyncIcon = sync.icon

  const dueBadge = (
    <span className="inline-flex items-center rounded-md bg-foreground/5 px-1.5 py-0.5 text-[10px] text-foreground/60">
      {shortDue(task.due)}
    </span>
  )

  const syncBadge = (
    <span className={cn('inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[10px]', sync.className)}>
      <SyncIcon className="h-3 w-3" />
      {shortSync(sync.label)}
    </span>
  )

  return (
    <div className="flex items-center gap-2">
      <button
        type="button"
        data-no-dnd="true"
        onClick={(e) => {
          e.stopPropagation()
          onToggleDone?.()
        }}
        className="h-5 w-5 rounded flex items-center justify-center hover:bg-foreground/5 shrink-0"
      >
        <TaskIcon className={cn('h-4 w-4 transition-all', TASK_STATE_META[task.state].className)} />
      </button>

      <div className={cn('min-w-0 flex-1 text-sm truncate', task.state === 'done' && 'line-through text-foreground/40')}>
        {task.title}
      </div>

      <div className="flex items-center gap-1.5 shrink-0">
        {showTooltips ? (
          <Tooltip>
            <TooltipTrigger asChild>{dueBadge}</TooltipTrigger>
            <TooltipContent side="top" className="text-xs">Due: {task.due}</TooltipContent>
          </Tooltip>
        ) : dueBadge}

        {showTooltips ? (
          <Tooltip>
            <TooltipTrigger asChild>{syncBadge}</TooltipTrigger>
            <TooltipContent side="top" className="text-xs">Sync: {sync.label}</TooltipContent>
          </Tooltip>
        ) : syncBadge}

        <div
          className="h-6 w-6 rounded-md flex items-center justify-center text-foreground/35 hover:text-foreground/60 hover:bg-foreground/5"
          aria-label="Drag handle"
        >
          <GripVertical className="h-4 w-4" />
        </div>
      </div>
    </div>
  )
}

function SortableTaskRow({ task, selected, reducedMotion, onSelect, onToggleDone }: SortableTaskRowProps) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: taskDndId(task.id) })

  return (
    <motion.div
      ref={setNodeRef}
      layout={!reducedMotion}
      initial={{ opacity: 0, y: reducedMotion ? 0 : 4 }}
      animate={{ opacity: isDragging ? 0 : 1, y: 0 }}
      exit={{ opacity: 0, y: reducedMotion ? 0 : -4 }}
      transition={reducedMotion ? { duration: 0 } : { type: 'spring', stiffness: 420, damping: 34 }}
      style={{
        transform: CSS.Transform.toString(transform),
        transition,
      }}
      className={cn(
        'group rounded-xl border px-2.5 py-2.5 cursor-grab active:cursor-grabbing',
        selected
          ? 'bg-accent/10 border-accent/25 shadow-[0_0_0_1px_rgba(149,112,190,0.18)]'
          : 'bg-background border-border/60 hover:bg-foreground/[0.02] hover:border-border',
      )}
      onClick={onSelect}
      {...attributes}
      {...listeners}
    >
      <TaskRowContent task={task} onToggleDone={onToggleDone} showTooltips />
    </motion.div>
  )
}

function TaskDragPreview({ task, width }: { task: PlannerTask; width?: number }) {
  return (
    <div
      className="rounded-xl border border-accent/30 bg-background px-2.5 py-2.5 shadow-[0_16px_38px_rgba(0,0,0,0.22)] scale-[1.01]"
      style={{ width: width ?? 520 }}
    >
      <TaskRowContent task={task} showTooltips={false} />
    </div>
  )
}

function HeadingDragPreview({ heading, width }: { heading: PlannerHeading; width?: number }) {
  return (
    <div
      className="rounded-lg border border-accent/30 bg-background px-2 py-1.5 shadow-[0_16px_38px_rgba(0,0,0,0.22)]"
      style={{ width: width ?? 280 }}
    >
      <div className="text-xs font-semibold tracking-wide uppercase text-foreground/70 flex items-center gap-1">
        <GripVertical className="h-3.5 w-3.5 text-foreground/35" />
        {heading.title}
      </div>
    </div>
  )
}

interface TaskEditorPanelProps {
  task: PlannerTask | undefined
  onUpdate: (patch: Partial<PlannerTask>) => void
}

function TaskEditorPanel({ task, onUpdate }: TaskEditorPanelProps) {
  return (
    <div className="h-full flex flex-col bg-foreground/[0.015]">
      <div className="px-4 pt-4 pb-3 border-b border-border/50">
        <div className="text-sm font-semibold">Task Editor</div>
        <div className="text-xs text-foreground/50">Static detail panel + sync semantics</div>
      </div>

      {!task ? (
        <div className="p-5 text-sm text-foreground/50">Select a task to edit.</div>
      ) : (
        <div className="flex-1 min-h-0">
          <ScrollArea className="h-full">
            <div className="p-4 space-y-4">
              <div className="space-y-1.5">
                <div className="text-xs text-foreground/50">Title</div>
                <Input value={task.title} onChange={(e) => onUpdate({ title: e.target.value })} className="h-8 text-sm" />
              </div>

              <div className="space-y-1.5">
                <div className="text-xs text-foreground/50">Notes</div>
                <Textarea
                  value={task.notes}
                  onChange={(e) => onUpdate({ notes: e.target.value })}
                  rows={5}
                  className="text-sm resize-none"
                />
              </div>

              <div className="space-y-2">
                <div className="text-xs text-foreground/50">State</div>
                <div className="flex flex-wrap gap-1.5">
                  {(Object.keys(TASK_STATE_META) as TaskState[]).map((state) => {
                    const meta = TASK_STATE_META[state]
                    const Icon = meta.icon
                    const active = state === task.state
                    return (
                      <Button
                        key={state}
                        size="sm"
                        variant={active ? 'default' : 'outline'}
                        className={cn('h-7 text-xs gap-1.5', !active && 'text-foreground/70')}
                        onClick={() => onUpdate({ state })}
                      >
                        <Icon className={cn('h-3.5 w-3.5', active ? '' : meta.className)} />
                        {meta.label}
                      </Button>
                    )
                  })}
                </div>
              </div>

              <div className="space-y-2">
                <div className="text-xs text-foreground/50">Linked Session Sync</div>
                <div className="grid grid-cols-2 gap-1.5">
                  {(Object.keys(SYNC_META) as SyncState[]).map((syncState) => {
                    const meta = SYNC_META[syncState]
                    const Icon = meta.icon
                    const active = task.syncState === syncState

                    return (
                      <button
                        key={syncState}
                        type="button"
                        className={cn(
                          'text-left rounded-lg border px-2 py-1.5 transition-colors',
                          active
                            ? 'border-accent/35 bg-accent/10'
                            : 'border-border/60 bg-background hover:bg-foreground/[0.02]',
                        )}
                        onClick={() => onUpdate({ syncState })}
                      >
                        <div className="flex items-center gap-1.5 text-xs">
                          <Icon className={cn('h-3.5 w-3.5', meta.className.split(' ')[0])} />
                          <span className="font-medium">{meta.label}</span>
                        </div>
                      </button>
                    )
                  })}
                </div>
              </div>
            </div>
          </ScrollArea>
        </div>
      )}
    </div>
  )
}

function SyncStatesShowcase() {
  return (
    <div className="w-[780px] border border-border rounded-xl bg-background p-4">
      <div className="text-sm font-semibold mb-3">Session Link Sync State Cards</div>
      <div className="grid grid-cols-2 gap-2.5">
        {(Object.keys(SYNC_META) as SyncState[]).map((syncState) => {
          const meta = SYNC_META[syncState]
          const Icon = meta.icon
          return (
            <motion.div
              key={syncState}
              whileHover={{ y: -1.5, transition: { type: 'spring', stiffness: 440, damping: 30 } }}
              className="rounded-lg border border-border/60 px-3 py-2 bg-foreground/[0.015]"
            >
              <div className="flex items-center gap-2 text-sm font-medium mb-1">
                <Icon className={cn('h-4 w-4', meta.className.split(' ')[0])} />
                {meta.label}
              </div>
              <div className="text-xs text-foreground/50">
                Snapshot-first rendering keeps cards useful even when live sessions are missing.
              </div>
            </motion.div>
          )
        })}
      </div>
    </div>
  )
}

export const plannerComponents: ComponentEntry[] = [
  {
    id: 'planner-premium-board',
    name: 'Planner Premium Board',
    category: 'Planner',
    description: 'Things/Superlist-inspired planner surface with tactile drag-and-drop, animated rows, and task editor.',
    component: PlannerPlayground,
    layout: 'centered',
    props: [
      { name: 'dense', description: 'Stress mode with many tasks', control: { type: 'boolean' }, defaultValue: false },
      { name: 'reducedMotion', description: 'Disable spring-heavy motion for accessibility', control: { type: 'boolean' }, defaultValue: false },
    ],
    variants: [
      {
        name: 'Daily Planning',
        description: 'Balanced list with focus on fluid interactions and editor transitions.',
        props: { dense: false, reducedMotion: false },
      },
      {
        name: 'Dense Stress Test',
        description: 'High-density board for drag performance validation.',
        props: { dense: true, reducedMotion: false },
      },
      {
        name: 'Reduced Motion',
        description: 'Accessible fallback behavior with motion minimized.',
        props: { dense: false, reducedMotion: true },
      },
    ],
  },
  {
    id: 'planner-sync-cards',
    name: 'Planner Sync Cards',
    category: 'Planner',
    description: 'Polished sync-state visual language for linked sessions.',
    component: SyncStatesShowcase,
    layout: 'centered',
    props: [],
  },
]
