import { beforeEach, describe, expect, it, mock } from 'bun:test'
import type { IpcContext } from '../types'

type RegistrationKind = 'handle' | 'on'

const registrationCounts = new Map<string, number>()
const registrations: Array<{ channel: string; kind: RegistrationKind }> = []

function recordRegistration(channel: string, kind: RegistrationKind): void {
  registrationCounts.set(channel, (registrationCounts.get(channel) ?? 0) + 1)
  registrations.push({ channel, kind })
}

mock.module('electron', () => ({
  ipcMain: {
    handle: (channel: string, _handler: unknown) => recordRegistration(channel, 'handle'),
    on: (channel: string, _handler: unknown) => recordRegistration(channel, 'on'),
  },
  // Minimal stubs for symbols imported by IPC domain modules
  app: {
    isPackaged: false,
    getAppPath: () => '/',
    quit: () => {},
    dock: { setIcon: () => {}, setBadge: () => {} },
  },
  nativeTheme: { shouldUseDarkColors: false },
  nativeImage: {
    createFromPath: () => ({ isEmpty: () => true }),
    createFromDataURL: () => ({}),
  },
  dialog: {
    showOpenDialog: async () => ({ canceled: true, filePaths: [] }),
    showMessageBox: async () => ({ response: 0 }),
  },
  shell: {
    openExternal: async () => {},
    openPath: async () => '',
    showItemInFolder: () => {},
  },
  BrowserWindow: {
    fromWebContents: () => null,
    getFocusedWindow: () => null,
    getAllWindows: () => [],
  },
  BrowserView: class {},
  Menu: {
    buildFromTemplate: () => ({ popup: () => {} }),
  },
  session: {},
}))

function createMockContext(): IpcContext {
  const sessionManager = {} as IpcContext['sessionManager']
  const windowManager = {} as IpcContext['windowManager']
  const browserPaneManager = {
    onStateChange: () => {},
    onRemoved: () => {},
    onInteracted: () => {},
  } as unknown as NonNullable<IpcContext['browserPaneManager']>

  return {
    sessionManager,
    windowManager,
    browserPaneManager,
  }
}

async function getExpectedChannels(): Promise<Set<string>> {
  const [
    auth,
    automations,
    browser,
    files,
    labels,
    llm,
    sessions,
    settings,
    skills,
    sources,
    statuses,
    system,
    workspace,
    onboarding,
  ] = await Promise.all([
    import('../auth'),
    import('../automations'),
    import('../browser'),
    import('../files'),
    import('../labels'),
    import('../llm-connections'),
    import('../sessions'),
    import('../settings'),
    import('../skills'),
    import('../sources'),
    import('../statuses'),
    import('../system'),
    import('../workspace'),
    import('../../onboarding'),
  ])

  return new Set([
    ...auth.HANDLED_CHANNELS,
    ...automations.HANDLED_CHANNELS,
    ...browser.HANDLED_CHANNELS,
    ...files.HANDLED_CHANNELS,
    ...labels.HANDLED_CHANNELS,
    ...llm.HANDLED_CHANNELS,
    ...sessions.HANDLED_CHANNELS,
    ...settings.HANDLED_CHANNELS,
    ...skills.HANDLED_CHANNELS,
    ...sources.HANDLED_CHANNELS,
    ...statuses.HANDLED_CHANNELS,
    ...system.HANDLED_CHANNELS,
    ...workspace.HANDLED_CHANNELS,
    ...onboarding.HANDLED_CHANNELS,
  ])
}

describe('IPC handler registration', () => {
  beforeEach(() => {
    registrationCounts.clear()
    registrations.length = 0
  })

  it('registers all declared handled channels exactly once', async () => {
    const expected = await getExpectedChannels()
    const { registerAllIpcHandlers } = await import('../index')

    registerAllIpcHandlers(createMockContext())

    const appChannels = registrations
      .map(r => r.channel)
      .filter(ch => ch.includes(':'))
    const actual = new Set(appChannels)

    const missing = [...expected].filter(ch => !actual.has(ch)).sort()
    const unexpected = [...actual].filter(ch => !expected.has(ch)).sort()

    expect(missing).toEqual([])
    expect(unexpected).toEqual([])

    const duplicates = [...registrationCounts.entries()]
      .filter(([channel, count]) => channel.includes(':') && count > 1)
      .map(([channel, count]) => `${channel} (${count}x)`)
      .sort()

    expect(duplicates).toEqual([])
  })

  it('keeps onboarding channels in registration coverage', async () => {
    const { HANDLED_CHANNELS } = await import('../../onboarding')
    const { registerAllIpcHandlers } = await import('../index')

    registerAllIpcHandlers(createMockContext())

    const actual = new Set(registrations.map(r => r.channel))
    const missingOnboarding = HANDLED_CHANNELS.filter(ch => !actual.has(ch))

    expect(missingOnboarding).toEqual([])
  })
})
