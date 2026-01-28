// ============================================================================
// ASCII renderer — class diagrams
//
// Renders classDiagram text to ASCII/Unicode art.
// Each class is a multi-compartment box (header | attributes | methods).
// Relationships are drawn as lines between classes with UML markers.
//
// Layout: level-based top-down. "From" classes are placed above "to" classes
// for all relationship types, matching dagre/mermaid.com behavior.
// Relationship lines use simple Manhattan routing (vertical + horizontal).
// ============================================================================

import { parseClassDiagram } from '../class/parser.ts'
import type { ClassDiagram, ClassNode, ClassMember, ClassRelationship, RelationshipType } from '../class/types.ts'
import type { Canvas, AsciiConfig } from './types.ts'
import { mkCanvas, canvasToString, increaseSize } from './canvas.ts'
import { drawMultiBox } from './draw.ts'

// ============================================================================
// Class member formatting
// ============================================================================

/** Format a class member as a display string: visibility + name + optional type */
function formatMember(m: ClassMember): string {
  const vis = m.visibility || ''
  const type = m.type ? `: ${m.type}` : ''
  return `${vis}${m.name}${type}`
}

/** Build the text sections for a class box: [header], [attributes], [methods] */
function buildClassSections(cls: ClassNode): string[][] {
  // Header section: optional annotation + class name (centered later by drawMultiBox)
  const header: string[] = []
  if (cls.annotation) header.push(`<<${cls.annotation}>>`)
  header.push(cls.label)

  // Attributes section
  const attrs = cls.attributes.map(formatMember)

  // Methods section
  const methods = cls.methods.map(formatMember)

  // If no attrs and no methods, just return header (1-section box)
  if (attrs.length === 0 && methods.length === 0) return [header]
  // If no methods, return header + attrs (2-section box)
  if (methods.length === 0) return [header, attrs]
  // Full 3-section box
  return [header, attrs, methods]
}

// ============================================================================
// Relationship marker characters
// ============================================================================

interface RelMarker {
  /** Characters drawn at the "from" end of the line */
  fromChar: string
  /** Characters drawn at the "to" end of the line */
  toChar: string
  /** Whether the line is dashed */
  dashed: boolean
}

/**
 * Build the marker for a relationship, placing the UML shape on the correct
 * end of the line based on `markerAt` (from the parser's arrow direction).
 */
function getRelMarker(type: RelationshipType, markerAt: 'from' | 'to', useAscii: boolean): RelMarker {
  const shape = getMarkerShape(type, useAscii)
  const dashed = type === 'dependency' || type === 'realization'

  // Place the shape character on whichever end the arrow syntax specified
  if (markerAt === 'from') {
    return { fromChar: shape, toChar: '', dashed }
  } else {
    return { fromChar: '', toChar: shape, dashed }
  }
}

/** Get the UML marker shape character for a relationship type */
function getMarkerShape(type: RelationshipType, useAscii: boolean): string {
  switch (type) {
    case 'inheritance':
    case 'realization':
      // Hollow triangle (inheritance/realization)
      return useAscii ? '<|' : '◁'
    case 'composition':
      // Filled diamond
      return useAscii ? '*' : '◆'
    case 'aggregation':
      // Hollow diamond
      return useAscii ? 'o' : '◇'
    case 'association':
    case 'dependency':
      // Open arrow
      return useAscii ? '>' : '▶'
  }
}

// ============================================================================
// Layout and rendering
// ============================================================================

/** Positioned class node on the canvas */
interface PlacedClass {
  cls: ClassNode
  sections: string[][]
  x: number
  y: number
  width: number
  height: number
}

/**
 * Render a Mermaid class diagram to ASCII/Unicode text.
 *
 * Pipeline: parse → build boxes → level-based layout → draw boxes → draw relationships → string.
 */
export function renderClassAscii(text: string, config: AsciiConfig): string {
  const lines = text.split('\n').map(l => l.trim()).filter(l => l.length > 0 && !l.startsWith('%%'))
  const diagram = parseClassDiagram(lines)

  if (diagram.classes.length === 0) return ''

  const useAscii = config.useAscii
  const hGap = 4  // horizontal gap between class boxes
  const vGap = 3  // vertical gap between levels (enough for relationship lines)

  // --- Build box dimensions for each class ---
  const classSections = new Map<string, string[][]>()
  const classBoxW = new Map<string, number>()
  const classBoxH = new Map<string, number>()

  for (const cls of diagram.classes) {
    const sections = buildClassSections(cls)
    classSections.set(cls.id, sections)

    // Compute box dimensions from drawMultiBox logic
    let maxTextW = 0
    for (const section of sections) {
      for (const line of section) maxTextW = Math.max(maxTextW, line.length)
    }
    const boxW = maxTextW + 4 // 2 border + 2 padding

    let totalLines = 0
    for (const section of sections) totalLines += Math.max(section.length, 1)
    const boxH = totalLines + (sections.length - 1) + 2 // section lines + dividers + top/bottom border

    classBoxW.set(cls.id, boxW)
    classBoxH.set(cls.id, boxH)
  }

  // --- Assign levels: topological sort based on directed relationships ---
  // All relationship types place "from" above "to" in the layout, matching
  // dagre's layered algorithm and the official mermaid.com renderer behavior.
  // For "Animal <|-- Dog": from="Animal", to="Dog" → Animal above Dog.
  //
  // Every relationship type (including association and dependency) forces nodes
  // to different levels. Same-row routing for mixed diagrams causes collisions:
  // detour lines overlap with cross-level routing, and labels overwrite box borders.

  const classById = new Map<string, ClassNode>()
  for (const cls of diagram.classes) classById.set(cls.id, cls)

  const parents = new Map<string, Set<string>>()  // child → set of parent IDs
  const children = new Map<string, Set<string>>() // parent → set of child IDs

  for (const rel of diagram.relationships) {
    if (!parents.has(rel.to)) parents.set(rel.to, new Set())
    parents.get(rel.to)!.add(rel.from)
    if (!children.has(rel.from)) children.set(rel.from, new Set())
    children.get(rel.from)!.add(rel.to)
  }

  // BFS from roots (classes that have no parents) to assign levels.
  // Cap at classes.length - 1 to prevent infinite loops on cyclic graphs
  // (e.g. View --> Model and Model ..> View would otherwise push levels
  // upward forever). In a DAG the longest path has at most N-1 edges.
  const level = new Map<string, number>()
  const roots = diagram.classes.filter(c => !parents.has(c.id) || parents.get(c.id)!.size === 0)
  const queue: string[] = roots.map(c => c.id)
  for (const id of queue) level.set(id, 0)

  const levelCap = diagram.classes.length - 1
  let qi = 0
  while (qi < queue.length) {
    const id = queue[qi++]!
    const childSet = children.get(id)
    if (!childSet) continue
    for (const childId of childSet) {
      const newLevel = (level.get(id) ?? 0) + 1
      if (newLevel > levelCap) continue // cycle detected — skip to prevent infinite loop
      if (!level.has(childId) || level.get(childId)! < newLevel) {
        level.set(childId, newLevel)
        queue.push(childId)
      }
    }
  }

  // Assign remaining (unconnected) classes to level 0
  for (const cls of diagram.classes) {
    if (!level.has(cls.id)) level.set(cls.id, 0)
  }

  // --- Position classes by level ---
  // Group classes by level
  const maxLevel = Math.max(...[...level.values()], 0)
  const levelGroups: string[][] = Array.from({ length: maxLevel + 1 }, () => [])
  for (const cls of diagram.classes) {
    levelGroups[level.get(cls.id)!]!.push(cls.id)
  }

  // Compute positions: each level is a row, classes in a row are spaced horizontally
  const placed = new Map<string, PlacedClass>()
  let currentY = 0

  for (let lv = 0; lv <= maxLevel; lv++) {
    const group = levelGroups[lv]!
    if (group.length === 0) continue

    let currentX = 0
    let maxH = 0

    for (const id of group) {
      const cls = classById.get(id)!
      const w = classBoxW.get(id)!
      const h = classBoxH.get(id)!
      placed.set(id, {
        cls,
        sections: classSections.get(id)!,
        x: currentX,
        y: currentY,
        width: w,
        height: h,
      })
      currentX += w + hGap
      maxH = Math.max(maxH, h)
    }

    currentY += maxH + vGap
  }

  // --- Create canvas ---
  let totalW = 0
  let totalH = 0
  for (const p of placed.values()) {
    totalW = Math.max(totalW, p.x + p.width)
    totalH = Math.max(totalH, p.y + p.height)
  }

  // Extra space for relationship lines that may go below/beside
  totalW += 4
  totalH += 2

  const canvas = mkCanvas(totalW - 1, totalH - 1)

  // --- Draw class boxes ---
  for (const p of placed.values()) {
    const boxCanvas = drawMultiBox(p.sections, useAscii)
    // Copy box onto main canvas at (p.x, p.y)
    for (let bx = 0; bx < boxCanvas.length; bx++) {
      for (let by = 0; by < boxCanvas[0]!.length; by++) {
        const ch = boxCanvas[bx]![by]!
        if (ch !== ' ') {
          const cx = p.x + bx
          const cy = p.y + by
          if (cx < totalW && cy < totalH) {
            canvas[cx]![cy] = ch
          }
        }
      }
    }
  }

  // --- Draw relationship lines ---
  const H = useAscii ? '-' : '─'
  const V = useAscii ? '|' : '│'
  const dashH = useAscii ? '.' : '╌'
  const dashV = useAscii ? ':' : '┊'

  for (const rel of diagram.relationships) {
    const fromP = placed.get(rel.from)
    const toP = placed.get(rel.to)
    if (!fromP || !toP) continue

    const marker = getRelMarker(rel.type, rel.markerAt, useAscii)
    const lineH = marker.dashed ? dashH : H
    const lineV = marker.dashed ? dashV : V

    // Connection points: center-bottom of source → center-top of target
    const fromCX = fromP.x + Math.floor(fromP.width / 2)
    const fromBY = fromP.y + fromP.height - 1
    const toCX = toP.x + Math.floor(toP.width / 2)
    const toTY = toP.y

    // Route: simple Manhattan routing
    // If target is below source: vertical down from source, horizontal if needed, vertical down to target
    // If same row: horizontal line with a small vertical detour above or below
    if (fromBY < toTY) {
      // Target is below source — simple vertical-first routing
      const midY = fromBY + Math.floor((toTY - fromBY) / 2)

      // Vertical from source bottom to midY
      for (let y = fromBY + 1; y <= midY; y++) {
        if (y < totalH) canvas[fromCX]![y] = lineV
      }

      // Horizontal from fromCX to toCX at midY
      if (fromCX !== toCX) {
        const lx = Math.min(fromCX, toCX)
        const rx = Math.max(fromCX, toCX)
        for (let x = lx; x <= rx; x++) {
          if (x < totalW && midY < totalH) canvas[x]![midY] = lineH
        }
        // Corner characters
        if (!useAscii && midY < totalH) {
          if (fromCX < toCX) {
            canvas[fromCX]![midY] = '└'
            canvas[toCX]![midY] = '┐'
          } else {
            canvas[fromCX]![midY] = '┘'
            canvas[toCX]![midY] = '┌'
          }
        }
      }

      // Vertical from midY to target top
      for (let y = midY + 1; y < toTY; y++) {
        if (y < totalH) canvas[toCX]![y] = lineV
      }

      // Draw markers
      if (marker.toChar.length > 0) {
        const my = toTY - 1
        if (my >= 0 && my < totalH) {
          // Place marker character(s) just above target box
          for (let i = 0; i < marker.toChar.length; i++) {
            const mx = toCX - Math.floor(marker.toChar.length / 2) + i
            if (mx >= 0 && mx < totalW) canvas[mx]![my] = marker.toChar[i]!
          }
        }
      }
      if (marker.fromChar.length > 0) {
        const my = fromBY + 1
        if (my < totalH) {
          for (let i = 0; i < marker.fromChar.length; i++) {
            const mx = fromCX - Math.floor(marker.fromChar.length / 2) + i
            if (mx >= 0 && mx < totalW) canvas[mx]![my] = marker.fromChar[i]!
          }
        }
      }
    } else if (toP.y + toP.height - 1 < fromP.y) {
      // Target is ABOVE source — draw upward from source top to target bottom
      const fromTY = fromP.y
      const toBY = toP.y + toP.height - 1
      const midY = toBY + Math.floor((fromTY - toBY) / 2)

      for (let y = fromTY - 1; y >= midY; y--) {
        if (y >= 0 && y < totalH) canvas[fromCX]![y] = lineV
      }

      if (fromCX !== toCX) {
        const lx = Math.min(fromCX, toCX)
        const rx = Math.max(fromCX, toCX)
        for (let x = lx; x <= rx; x++) {
          if (x < totalW && midY >= 0 && midY < totalH) canvas[x]![midY] = lineH
        }
        if (!useAscii && midY >= 0 && midY < totalH) {
          if (fromCX < toCX) {
            canvas[fromCX]![midY] = '┌'
            canvas[toCX]![midY] = '┘'
          } else {
            canvas[fromCX]![midY] = '┐'
            canvas[toCX]![midY] = '└'
          }
        }
      }

      for (let y = midY - 1; y > toBY; y--) {
        if (y >= 0 && y < totalH) canvas[toCX]![y] = lineV
      }

      // Markers (from: just above source box, to: just below target box)
      if (marker.fromChar.length > 0) {
        const my = fromTY - 1
        if (my >= 0 && my < totalH) {
          for (let i = 0; i < marker.fromChar.length; i++) {
            const mx = fromCX - Math.floor(marker.fromChar.length / 2) + i
            if (mx >= 0 && mx < totalW) canvas[mx]![my] = marker.fromChar[i]!
          }
        }
      }
      if (marker.toChar.length > 0) {
        const my = toBY + 1
        if (my < totalH) {
          for (let i = 0; i < marker.toChar.length; i++) {
            const mx = toCX - Math.floor(marker.toChar.length / 2) + i
            if (mx >= 0 && mx < totalW) canvas[mx]![my] = marker.toChar[i]!
          }
        }
      }
    } else {
      // Same level — draw horizontal line with a detour below both boxes
      const detourY = Math.max(fromBY, toP.y + toP.height - 1) + 2
      increaseSize(canvas, totalW, detourY + 1)

      // Vertical down from source
      for (let y = fromBY + 1; y <= detourY; y++) {
        canvas[fromCX]![y] = lineV
      }
      // Horizontal
      const lx = Math.min(fromCX, toCX)
      const rx = Math.max(fromCX, toCX)
      for (let x = lx; x <= rx; x++) {
        canvas[x]![detourY] = lineH
      }
      // Vertical up to target
      for (let y = detourY - 1; y >= toP.y + toP.height; y--) {
        canvas[toCX]![y] = lineV
      }

      // Markers (from: just below source box, to: just below target box)
      if (marker.fromChar.length > 0) {
        const my = fromBY + 1
        if (my < totalH) {
          for (let i = 0; i < marker.fromChar.length; i++) {
            const mx = fromCX - Math.floor(marker.fromChar.length / 2) + i
            if (mx >= 0 && mx < totalW) canvas[mx]![my] = marker.fromChar[i]!
          }
        }
      }
      if (marker.toChar.length > 0) {
        const my = toP.y + toP.height
        if (my < totalH) {
          for (let i = 0; i < marker.toChar.length; i++) {
            const mx = toCX - Math.floor(marker.toChar.length / 2) + i
            if (mx >= 0 && mx < totalW) canvas[mx]![my] = marker.toChar[i]!
          }
        }
      }
    }

    // Draw relationship label at midpoint if present
    if (rel.label) {
      const midX = Math.floor((fromCX + toCX) / 2)
      const midY = Math.floor(((fromBY + 1) + (toTY > fromBY ? toTY - 1 : fromP.y - 1)) / 2)
      const labelStart = midX - Math.floor(rel.label.length / 2)
      for (let i = 0; i < rel.label.length; i++) {
        const lx = labelStart + i
        if (lx >= 0 && lx < totalW && midY >= 0 && midY < totalH) {
          canvas[lx]![midY] = rel.label[i]!
        }
      }
    }
  }

  return canvasToString(canvas)
}
