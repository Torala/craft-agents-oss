import * as React from 'react'
import type { ComponentEntry } from './types'
import { AttachmentPreview } from '@/components/chat/AttachmentPreview'
import { PermissionBanner } from '@/components/chat/PermissionBanner'
import { SetupAuthBanner } from '@/components/chat/SetupAuthBanner'
import { Button } from '@/components/ui/button'
import { motion } from 'motion/react'
import { ArrowUp, Paperclip, ChevronDown, Sparkles } from 'lucide-react'
import type { FileAttachment, PermissionRequest } from '../../../shared/types'

// Sample file attachments for testing
const sampleImageAttachment: FileAttachment = {
  type: 'image',
  path: '/Users/test/screenshot.png',
  name: 'screenshot.png',
  mimeType: 'image/png',
  size: 245000,
  base64: 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
}

const samplePdfAttachment: FileAttachment = {
  type: 'pdf',
  path: '/Users/test/report.pdf',
  name: 'quarterly-report-2024.pdf',
  mimeType: 'application/pdf',
  size: 1024000,
}

const sampleCodeAttachment: FileAttachment = {
  type: 'text',
  path: '/Users/test/app.tsx',
  name: 'App.tsx',
  mimeType: 'text/typescript',
  size: 8500,
}

const samplePermissionRequest: PermissionRequest = {
  requestId: 'perm-1',
  sessionId: 'session-1',
  toolName: 'bash',
  description: 'Run shell command',
  command: 'npm install --save-dev typescript @types/react',
}

const longPermissionRequest: PermissionRequest = {
  requestId: 'perm-2',
  sessionId: 'session-1',
  toolName: 'bash',
  description: 'Run shell command',
  command: 'find /Users/test/project -type f -name "*.ts" | xargs grep -l "deprecated" | head -20',
}

const veryLongPermissionRequest: PermissionRequest = {
  requestId: 'perm-3',
  sessionId: 'session-1',
  toolName: 'bash',
  description: 'Run complex deployment script',
  command: `#!/bin/bash
set -e

echo "Starting deployment..."
cd /Users/project/app

# Build the application
npm run build
npm run test

# Docker operations
docker build -t myapp:latest .
docker tag myapp:latest registry.example.com/myapp:latest
docker push registry.example.com/myapp:latest

# Deploy to kubernetes
kubectl apply -f k8s/deployment.yaml
kubectl rollout status deployment/myapp`,
}

/**
 * Interactive test component for Permission UI ↔ Input View animation transitions
 * Allows toggling between states to inspect the animate in/out behavior
 */
interface PermissionInputToggleProps {
  autoToggle?: boolean
  autoToggleInterval?: number
  useLongCommand?: boolean
}

function PermissionInputToggle({ autoToggle = false, autoToggleInterval = 3000, useLongCommand = false }: PermissionInputToggleProps) {
  const [showPermission, setShowPermission] = React.useState(false)
  const [input, setInput] = React.useState('')

  const permissionRequest = useLongCommand ? veryLongPermissionRequest : samplePermissionRequest

  // Auto-toggle for continuous animation testing
  React.useEffect(() => {
    if (!autoToggle) return
    const interval = setInterval(() => {
      setShowPermission(prev => !prev)
    }, autoToggleInterval)
    return () => clearInterval(interval)
  }, [autoToggle, autoToggleInterval])

  const handlePermissionResponse = (allowed: boolean, alwaysAllow: boolean) => {
    console.log('[Playground] Permission response:', { allowed, alwaysAllow })
    setShowPermission(false)
  }

  return (
    <div className="w-full max-w-[960px] h-full flex flex-col px-4 pb-4">
      {/* Spacer to push content to bottom */}
      <div className="flex-1" />

      {/* Control buttons */}
      <div className="flex items-center gap-2 mb-20">
        <Button
          variant={showPermission ? 'default' : 'outline'}
          size="sm"
          onClick={() => setShowPermission(true)}
          className="gap-1.5"
        >
          <Sparkles className="h-3.5 w-3.5" />
          Show Permission
        </Button>
        <Button
          variant={!showPermission ? 'default' : 'outline'}
          size="sm"
          onClick={() => setShowPermission(false)}
          className="gap-1.5"
        >
          Show Input
        </Button>
        <div className="flex-1" />
        <span className="text-xs text-muted-foreground">
          Current: <span className="font-medium">{showPermission ? 'Permission Banner' : 'Input View'}</span>
        </span>
      </div>

      {/* Animated container - mimics ChatDisplay input area */}
      <div className="relative">
        {/* Permission banner - overlays input, anchored to bottom */}
        <motion.div
          initial={false}
          animate={{
            opacity: showPermission ? 1 : 0,
          }}
          transition={{
            duration: 0.2,
            ease: [0.4, 0, 0.2, 1],
          }}
          className="absolute inset-x-0 bottom-0 z-10"
          style={{ pointerEvents: showPermission ? 'auto' : 'none' }}
        >
          <PermissionBanner
            request={permissionRequest}
            onRespond={handlePermissionResponse}
          />
        </motion.div>

        {/* Input form - always rendered, fades when permission shows */}
        <motion.form
          initial={false}
          animate={{ opacity: showPermission ? 0 : 1 }}
          transition={{
            duration: 0.2,
            ease: [0.4, 0, 0.2, 1],
          }}
          onSubmit={(e) => {
            e.preventDefault()
            console.log('[Playground] Submit:', input)
          }}
          style={{ pointerEvents: showPermission ? 'none' : 'auto' }}
        >
          <div className="rounded-[8px] bg-background overflow-hidden shadow-middle border border-border/50">
            {/* Textarea - mimics actual input */}
            <textarea
              className="w-full min-h-[100px] pl-5 pr-4 pt-4 pb-3 bg-transparent outline-none text-sm placeholder:text-muted-foreground resize-none focus-visible:ring-0"
              placeholder="Message Craft Agent..."
              value={input}
              onChange={(e) => setInput(e.target.value)}
              rows={3}
              disabled={showPermission}
            />

            {/* Bottom Row: Attach, Model selector, Send */}
            <div className="flex items-center gap-1 px-2 py-2 border-t border-border/50">
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="h-7 w-7 shrink-0"
                disabled={showPermission}
              >
                <Paperclip className="h-4 w-4" />
              </Button>

              <Button
                variant="ghost"
                size="sm"
                className="h-7 gap-1 text-xs shrink-0 hover:bg-foreground/5"
                disabled={showPermission}
              >
                Sonnet
                <ChevronDown className="h-3 w-3 opacity-50" />
              </Button>

              <div className="flex-1" />

              <Button
                type="submit"
                size="icon"
                className="h-7 w-7 rounded-full shrink-0"
                disabled={!input.trim() || showPermission}
              >
                <ArrowUp className="h-4 w-4" />
              </Button>
            </div>
          </div>
        </motion.form>
      </div>
    </div>
  )
}

export const chatComponents: ComponentEntry[] = [
  {
    id: 'attachment-preview',
    name: 'AttachmentPreview',
    category: 'Chat',
    description: 'ChatGPT-style attachment preview strip showing attached files as bubbles above textarea',
    component: AttachmentPreview,
    props: [
      {
        name: 'disabled',
        description: 'Disable remove buttons',
        control: { type: 'boolean' },
        defaultValue: false,
      },
      {
        name: 'loadingCount',
        description: 'Number of loading placeholders to show',
        control: { type: 'number', min: 0, max: 5, step: 1 },
        defaultValue: 0,
      },
    ],
    variants: [
      { name: 'Empty', props: { attachments: [], loadingCount: 0 } },
      { name: 'With Images', props: { attachments: [sampleImageAttachment, sampleImageAttachment] } },
      { name: 'With Documents', props: { attachments: [samplePdfAttachment, sampleCodeAttachment] } },
      { name: 'Mixed', props: { attachments: [sampleImageAttachment, samplePdfAttachment, sampleCodeAttachment] } },
      { name: 'Loading', props: { attachments: [], loadingCount: 3 } },
      { name: 'Disabled', props: { attachments: [sampleImageAttachment, samplePdfAttachment], disabled: true } },
    ],
    mockData: () => ({
      attachments: [sampleImageAttachment, samplePdfAttachment],
      onRemove: (index: number) => console.log('[Playground] Remove attachment:', index),
    }),
  },
  {
    id: 'permission-banner',
    name: 'PermissionBanner',
    category: 'Chat',
    description: 'Shows when agent needs approval for a bash command with Allow/Always Allow/Deny options',
    component: PermissionBanner,
    props: [],
    variants: [
      { name: 'Default', props: { request: samplePermissionRequest } },
      { name: 'Long Command', props: { request: longPermissionRequest } },
    ],
    mockData: () => ({
      request: samplePermissionRequest,
      onRespond: (allowed: boolean, alwaysAllow: boolean) => {
        console.log('[Playground] Permission response:', { allowed, alwaysAllow })
      },
    }),
  },
  {
    id: 'setup-auth-banner',
    name: 'SetupAuthBanner',
    category: 'Chat',
    description: 'Shows when an agent needs activation or authentication',
    component: SetupAuthBanner,
    props: [
      {
        name: 'state',
        description: 'Banner state',
        control: {
          type: 'select',
          options: [
            { label: 'Hidden', value: 'hidden' },
            { label: 'Setup', value: 'setup' },
            { label: 'Auth', value: 'auth' },
          ],
        },
        defaultValue: 'setup',
      },
      {
        name: 'agentName',
        description: 'Name of the agent',
        control: { type: 'string', placeholder: 'Agent name' },
        defaultValue: 'GitHub Copilot',
      },
      {
        name: 'reason',
        description: 'Custom reason message',
        control: { type: 'string', placeholder: 'Optional custom reason' },
        defaultValue: '',
      },
    ],
    variants: [
      { name: 'Setup Needed', props: { state: 'setup', agentName: 'GitHub Copilot' } },
      { name: 'Auth Needed', props: { state: 'auth', agentName: 'Linear' } },
      { name: 'Custom Reason', props: { state: 'auth', agentName: 'Slack', reason: 'Your OAuth token has expired. Please re-authenticate to continue.' } },
      { name: 'Hidden', props: { state: 'hidden' } },
    ],
    mockData: () => ({
      onAction: () => console.log('[Playground] Setup/Auth action clicked'),
    }),
  },
  {
    id: 'permission-input-toggle',
    name: 'Permission ↔ Input Toggle',
    category: 'Chat',
    description: 'Interactive test for animating between Permission Banner and Input View. Click buttons to toggle states and inspect animations.',
    component: PermissionInputToggle,
    props: [
      {
        name: 'useLongCommand',
        description: 'Use a very long multi-line command',
        control: { type: 'boolean' },
        defaultValue: false,
      },
      {
        name: 'autoToggle',
        description: 'Automatically toggle between states',
        control: { type: 'boolean' },
        defaultValue: false,
      },
      {
        name: 'autoToggleInterval',
        description: 'Auto-toggle interval in milliseconds',
        control: { type: 'number', min: 1000, max: 10000, step: 500 },
        defaultValue: 3000,
      },
    ],
    variants: [
      { name: 'Short Command', props: { useLongCommand: false } },
      { name: 'Long Command (10+ lines)', props: { useLongCommand: true } },
      { name: 'Auto Toggle', props: { autoToggle: true, autoToggleInterval: 2000 } },
    ],
    mockData: () => ({}),
  },
]
