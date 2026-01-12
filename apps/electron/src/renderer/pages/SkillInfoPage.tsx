/**
 * SkillInfoPage
 *
 * Displays comprehensive skill details including metadata, configuration,
 * permission modes, instructions, files, and statistics.
 * Uses the Info_ component system for consistent styling with SourceInfoPage.
 */

import * as React from 'react'
import { useEffect, useState, useCallback } from 'react'
import {
  FolderOpen,
  Pencil,
  Trash2,
  FileText,
  Folder,
  Image,
  Check,
  X,
  Minus,
} from 'lucide-react'
import { toast } from 'sonner'
import { HeaderIconButton } from '@/components/ui/HeaderIconButton'
import { HeaderMenu } from '@/components/ui/HeaderMenu'
import { StyledDropdownMenuItem, StyledDropdownMenuSeparator } from '@/components/ui/styled-dropdown'
import { SkillAvatar } from '@/components/ui/skill-avatar'
import { routes, navigate } from '@/lib/navigate'
import {
  Info_Page,
  Info_Section,
  Info_Table,
  Info_Markdown,
} from '@/components/info'
import { cn } from '@/lib/utils'
import type { LoadedSkill, SkillFile } from '../../shared/types'

interface SkillInfoPageProps {
  skillSlug: string
  workspaceId: string
}

function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B'
  const k = 1024
  const sizes = ['B', 'KB', 'MB']
  const i = Math.floor(Math.log(bytes) / Math.log(k))
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(1))} ${sizes[i]}`
}

function getFileIcon(file: SkillFile): React.ReactNode {
  if (file.type === 'directory') {
    return <Folder className="h-3.5 w-3.5 text-info" />
  }
  if (file.name.match(/\.(svg|png|jpg|jpeg|gif|webp)$/i)) {
    return <Image className="h-3.5 w-3.5 text-accent" />
  }
  return <FileText className="h-3.5 w-3.5 text-muted-foreground" />
}

export default function SkillInfoPage({ skillSlug, workspaceId }: SkillInfoPageProps) {
  const [skill, setSkill] = useState<LoadedSkill | null>(null)
  const [skillFiles, setSkillFiles] = useState<SkillFile[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  // Load skill data
  useEffect(() => {
    let isMounted = true
    setLoading(true)
    setError(null)

    const loadSkill = async () => {
      try {
        const skills = await window.electronAPI.getSkills(workspaceId)

        if (!isMounted) return

        // Find the skill by slug
        const found = skills.find((s) => s.slug === skillSlug)
        if (found) {
          setSkill(found)

          // Load skill files
          try {
            const files = await window.electronAPI.getSkillFiles?.(workspaceId, skillSlug)
            if (files && isMounted) {
              setSkillFiles(files)
            }
          } catch {
            // File listing is optional, don't fail if not available
          }
        } else {
          setError('Skill not found')
        }
      } catch (err) {
        if (!isMounted) return
        setError(err instanceof Error ? err.message : 'Failed to load skill')
      } finally {
        if (isMounted) setLoading(false)
      }
    }

    loadSkill()

    // Subscribe to skill changes
    const unsubscribe = window.electronAPI.onSkillsChanged?.((skills) => {
      const updated = skills.find((s) => s.slug === skillSlug)
      if (updated) {
        setSkill(updated)
      }
    })

    return () => {
      isMounted = false
      unsubscribe?.()
    }
  }, [workspaceId, skillSlug])

  // Handle edit button click
  const handleEdit = useCallback(async () => {
    if (!skill) return

    try {
      await window.electronAPI.openSkillInEditor(workspaceId, skillSlug)
    } catch (err) {
      console.error('Failed to open skill in editor:', err)
    }
  }, [skill, workspaceId, skillSlug])

  // Handle open in finder
  const handleOpenInFinder = useCallback(async () => {
    if (!skill) return

    try {
      await window.electronAPI.openSkillInFinder(workspaceId, skillSlug)
    } catch (err) {
      console.error('Failed to open skill in finder:', err)
    }
  }, [skill, workspaceId, skillSlug])

  // Handle delete
  const handleDelete = useCallback(async () => {
    if (!skill) return

    try {
      await window.electronAPI.deleteSkill(workspaceId, skillSlug)
      toast.success(`Deleted skill: ${skill.metadata.name}`)
      navigate(routes.view.skills())
    } catch (err) {
      toast.error('Failed to delete skill', {
        description: err instanceof Error ? err.message : 'Unknown error',
      })
    }
  }, [skill, workspaceId, skillSlug])

  // Get skill name for header
  const skillName = skill?.metadata.name || skillSlug

  // Extract icon filename from path
  const iconFilename = skill?.iconPath?.split('/').pop()

  // Calculate statistics
  const stats = skill ? {
    instructionLength: skill.content?.length || 0,
    filePatterns: skill.metadata.globs?.length || 0,
    allowedTools: skill.metadata.alwaysAllow?.length || 0,
    additionalFiles: skillFiles.filter(f => f.name !== 'SKILL.md' && !f.name.startsWith('icon.')).length,
  } : null

  return (
    <Info_Page
      loading={loading}
      error={error ?? undefined}
      empty={!skill && !loading && !error ? 'Skill not found' : undefined}
    >
      <Info_Page.Header
        title={skillName}
        actions={
          <div className="flex items-center gap-1">
            <HeaderIconButton
              icon={<Pencil className="h-4 w-4" />}
              onClick={handleEdit}
              tooltip="Edit SKILL.md"
            />
            <HeaderMenu route={routes.view.skills(skillSlug)}>
              <StyledDropdownMenuItem onClick={handleOpenInFinder}>
                <FolderOpen className="h-3.5 w-3.5" />
                <span className="flex-1">Show in Finder</span>
              </StyledDropdownMenuItem>
              <StyledDropdownMenuSeparator />
              <StyledDropdownMenuItem onClick={handleDelete} variant="destructive">
                <Trash2 className="h-3.5 w-3.5" />
                <span className="flex-1">Delete</span>
              </StyledDropdownMenuItem>
            </HeaderMenu>
          </div>
        }
      />

      {skill && (
        <Info_Page.Content>
          {/* Hero: Avatar, title, and description */}
          <Info_Page.Hero
            avatar={<SkillAvatar skill={skill} size="lg" workspaceId={workspaceId} />}
            title={skill.metadata.name}
            tagline={skill.metadata.description}
          />

          {/* Metadata */}
          <Info_Section title="Metadata">
            <Info_Table>
              <Info_Table.Row label="Slug">
                <span className="font-mono text-xs">{skill.slug}</span>
              </Info_Table.Row>
              <Info_Table.Row label="Name">{skill.metadata.name}</Info_Table.Row>
              <Info_Table.Row label="Description">
                <span className="text-foreground/80">{skill.metadata.description}</span>
              </Info_Table.Row>
            </Info_Table>
          </Info_Section>

          {/* Configuration */}
          <Info_Section title="Configuration">
            <div className="space-y-4">
              {/* Icon status */}
              <Info_Table>
                <Info_Table.Row label="Icon">
                  {skill.iconPath ? (
                    <span className="text-success flex items-center gap-1.5">
                      <Check className="h-3.5 w-3.5" />
                      {iconFilename}
                    </span>
                  ) : (
                    <span className="text-muted-foreground">No icon file</span>
                  )}
                </Info_Table.Row>
              </Info_Table>

              {/* File Patterns (globs) */}
              {skill.metadata.globs && skill.metadata.globs.length > 0 && (
                <div>
                  <p className="text-sm font-medium mb-1">File Patterns</p>
                  <p className="text-xs text-muted-foreground mb-2">
                    When working with matching files, this skill may be suggested.
                  </p>
                  <div className="flex flex-wrap gap-1">
                    {skill.metadata.globs.map((glob, i) => (
                      <span
                        key={i}
                        className="px-2 py-0.5 text-xs bg-foreground/5 rounded font-mono"
                      >
                        {glob}
                      </span>
                    ))}
                  </div>
                </div>
              )}

              {/* Always Allowed Tools */}
              {skill.metadata.alwaysAllow && skill.metadata.alwaysAllow.length > 0 && (
                <div>
                  <p className="text-sm font-medium mb-1">Always Allowed Tools</p>
                  <p className="text-xs text-muted-foreground mb-2">
                    These tools run without permission prompts when skill is active.
                  </p>
                  <div className="flex flex-wrap gap-1">
                    {skill.metadata.alwaysAllow.map((tool, i) => (
                      <span
                        key={i}
                        className="px-2 py-0.5 text-xs bg-success/10 text-success rounded font-mono"
                      >
                        {tool}
                      </span>
                    ))}
                  </div>
                </div>
              )}

              {/* Show message if no configuration */}
              {!skill.metadata.globs?.length && !skill.metadata.alwaysAllow?.length && !skill.iconPath && (
                <p className="text-sm text-muted-foreground">
                  No file patterns or tool permissions configured.
                </p>
              )}
            </div>
          </Info_Section>

          {/* Permission Modes */}
          {skill.metadata.alwaysAllow && skill.metadata.alwaysAllow.length > 0 && (
            <Info_Section title="Permission Modes">
              <div className="space-y-2">
                <p className="text-xs text-muted-foreground mb-3">
                  How "Always Allowed Tools" interacts with permission modes:
                </p>
                <div className="rounded-[8px] border border-border/50 overflow-hidden">
                  <table className="w-full text-sm">
                    <tbody>
                      <tr className="border-b border-border/30">
                        <td className="px-3 py-2 font-medium text-muted-foreground w-[140px]">Explore</td>
                        <td className="px-3 py-2 flex items-center gap-2">
                          <X className="h-3.5 w-3.5 text-destructive shrink-0" />
                          <span className="text-foreground/80">Blocked — write tools blocked regardless</span>
                        </td>
                      </tr>
                      <tr className="border-b border-border/30">
                        <td className="px-3 py-2 font-medium text-muted-foreground">Ask to Edit</td>
                        <td className="px-3 py-2 flex items-center gap-2">
                          <Check className="h-3.5 w-3.5 text-success shrink-0" />
                          <span className="text-foreground/80">Auto-approved — no prompts for allowed tools</span>
                        </td>
                      </tr>
                      <tr>
                        <td className="px-3 py-2 font-medium text-muted-foreground">Auto</td>
                        <td className="px-3 py-2 flex items-center gap-2">
                          <Minus className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                          <span className="text-foreground/80">No effect — all tools already auto-approved</span>
                        </td>
                      </tr>
                    </tbody>
                  </table>
                </div>
              </div>
            </Info_Section>
          )}

          {/* Instructions */}
          <Info_Section
            title="Instructions"
            actions={
              <button
                onClick={handleEdit}
                className="transition-colors text-[13px] cursor-pointer text-muted-foreground hover:text-foreground hover:underline focus:outline-none focus-visible:underline"
              >
                Edit
              </button>
            }
          >
            <Info_Markdown maxHeight={540}>
              {skill.content || '*No instructions provided.*'}
            </Info_Markdown>
          </Info_Section>

          {/* Files */}
          {skillFiles.length > 0 && (
            <Info_Section title="Files">
              <div className="space-y-0.5">
                {skillFiles.map((file, i) => (
                  <FileTreeItem key={i} file={file} depth={0} />
                ))}
              </div>
            </Info_Section>
          )}

          {/* Statistics */}
          {stats && (
            <Info_Section title="Statistics">
              <Info_Table>
                <Info_Table.Row label="Instruction Length">
                  {stats.instructionLength.toLocaleString()} characters
                </Info_Table.Row>
                <Info_Table.Row label="File Patterns">
                  {stats.filePatterns} pattern{stats.filePatterns !== 1 ? 's' : ''}
                </Info_Table.Row>
                <Info_Table.Row label="Auto-allowed Tools">
                  {stats.allowedTools} tool{stats.allowedTools !== 1 ? 's' : ''}
                </Info_Table.Row>
                {stats.additionalFiles > 0 && (
                  <Info_Table.Row label="Additional Files">
                    {stats.additionalFiles} file{stats.additionalFiles !== 1 ? 's' : ''}
                  </Info_Table.Row>
                )}
              </Info_Table>
            </Info_Section>
          )}

          {/* Location */}
          <Info_Section title="Location">
            <Info_Table>
              <Info_Table.Row label="Path">
                <span className="font-mono text-xs break-all">{skill.path}</span>
              </Info_Table.Row>
            </Info_Table>
          </Info_Section>
        </Info_Page.Content>
      )}
    </Info_Page>
  )
}

// File tree item component
function FileTreeItem({ file, depth }: { file: SkillFile; depth: number }) {
  const [expanded, setExpanded] = useState(true)

  return (
    <div>
      <div
        className={cn(
          'flex items-center gap-2 py-1 px-2 rounded text-sm hover:bg-foreground/5',
          file.type === 'directory' && 'cursor-pointer'
        )}
        style={{ paddingLeft: `${depth * 16 + 8}px` }}
        onClick={() => file.type === 'directory' && setExpanded(!expanded)}
      >
        {getFileIcon(file)}
        <span className="font-mono text-xs flex-1">{file.name}</span>
        {file.size !== undefined && (
          <span className="text-xs text-muted-foreground">{formatBytes(file.size)}</span>
        )}
        {file.type === 'directory' && file.children && (
          <span className="text-xs text-muted-foreground">
            {file.children.length} file{file.children.length !== 1 ? 's' : ''}
          </span>
        )}
      </div>
      {file.type === 'directory' && expanded && file.children && (
        <div>
          {file.children.map((child, i) => (
            <FileTreeItem key={i} file={child} depth={depth + 1} />
          ))}
        </div>
      )}
    </div>
  )
}
