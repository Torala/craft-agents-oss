import * as React from 'react'
import { CraftAgentsSymbol } from '@/components/icons/CraftAgentsSymbol'
import { ThemeToggle } from './ThemeToggle'
import { Sidebar } from './Sidebar'
import { ComponentPreview } from './ComponentPreview'
import { PropsPanel } from './PropsPanel'
import { getCategories, getComponentById, type ComponentVariant } from './registry'

const SELECTED_STORAGE_KEY = 'playground-selected-component'

export function PlaygroundApp() {
  const categories = React.useMemo(() => getCategories(), [])
  const [selectedId, setSelectedId] = React.useState<string | null>(() => {
    // Try to restore from localStorage
    try {
      const stored = localStorage.getItem(SELECTED_STORAGE_KEY)
      if (stored) {
        // Verify the component still exists
        const component = getComponentById(stored)
        if (component) {
          return stored
        }
      }
    } catch {
      // Ignore parse errors
    }
    return null
  })
  const [props, setProps] = React.useState<Record<string, unknown>>({})
  const [selectedVariant, setSelectedVariant] = React.useState<string | null>(null)

  // Persist selected component to localStorage
  React.useEffect(() => {
    try {
      if (selectedId) {
        localStorage.setItem(SELECTED_STORAGE_KEY, selectedId)
      } else {
        localStorage.removeItem(SELECTED_STORAGE_KEY)
      }
    } catch {
      // Ignore storage errors
    }
  }, [selectedId])

  const selectedComponent = selectedId ? getComponentById(selectedId) : null

  // Reset props when component changes
  React.useEffect(() => {
    if (selectedComponent) {
      const defaults: Record<string, unknown> = {}
      for (const prop of selectedComponent.props) {
        defaults[prop.name] = prop.defaultValue
      }
      setProps(defaults)
      setSelectedVariant(null)
    }
  }, [selectedComponent])

  const handleVariantSelect = (variant: ComponentVariant) => {
    if (selectedComponent) {
      // Start with defaults, then apply variant props
      const defaults: Record<string, unknown> = {}
      for (const prop of selectedComponent.props) {
        defaults[prop.name] = prop.defaultValue
      }
      setProps({ ...defaults, ...variant.props })
      setSelectedVariant(variant.name)
    }
  }

  const handlePropsChange = (newProps: Record<string, unknown>) => {
    setProps(newProps)
    // Clear variant selection when props are manually changed
    setSelectedVariant(null)
  }

  return (
    <div className="h-screen flex flex-col bg-background text-foreground">
      {/* Header */}
      <header className="h-12 shrink-0 flex items-center justify-between px-4 border-b border-border bg-background">
        <div className="flex items-center gap-3">
          <CraftAgentsSymbol className="h-5 w-5" />
          <h1 className="font-semibold text-foreground font-sans">
            Design System Playground
          </h1>
        </div>
        <ThemeToggle />
      </header>

      {/* Main content */}
      <div className="flex-1 flex overflow-hidden">
        {/* Sidebar */}
        <Sidebar
          categories={categories}
          selectedId={selectedId}
          onSelect={setSelectedId}
        />

        {/* Content area */}
        {selectedComponent ? (
          <div className="flex-1 flex flex-col overflow-hidden">
            {/* Preview */}
            <ComponentPreview
              component={selectedComponent}
              props={props}
            />

            {/* Props panel */}
            <PropsPanel
              component={selectedComponent}
              props={props}
              onPropsChange={handlePropsChange}
              selectedVariant={selectedVariant}
              onVariantSelect={handleVariantSelect}
            />
          </div>
        ) : (
          <div className="flex-1 flex items-center justify-center text-muted-foreground">
            Select a component from the sidebar
          </div>
        )}
      </div>
    </div>
  )
}
