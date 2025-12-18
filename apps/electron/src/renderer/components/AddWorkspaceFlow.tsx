/**
 * AddWorkspaceFlow - Wrapper that mounts/unmounts the hook with the wizard
 *
 * This component exists so the useAddWorkspace hook only runs when the wizard
 * is visible. Previously the hook was called at the App level unconditionally,
 * causing API calls even when the wizard wasn't shown.
 */
import { useAddWorkspace } from '@/hooks/useAddWorkspace'
import { AddWorkspaceWizard } from '@/components/AddWorkspaceWizard'

interface AddWorkspaceFlowProps {
  onComplete: () => void
  onCancel: () => void
  existingWorkspaceNames: string[]
}

export function AddWorkspaceFlow({
  onComplete,
  onCancel,
  existingWorkspaceNames,
}: AddWorkspaceFlowProps) {
  const addWorkspace = useAddWorkspace({
    onComplete,
    onCancel,
    existingWorkspaceNames,
  })

  return (
    <AddWorkspaceWizard
      state={addWorkspace.state}
      spaceCategories={addWorkspace.spaceCategories}
      onLogin={addWorkspace.handleLogin}
      onSelectSpace={addWorkspace.handleSelectSpace}
      onContinue={addWorkspace.handleContinue}
      onBack={addWorkspace.handleBack}
      onCancel={addWorkspace.handleCancel}
    />
  )
}
