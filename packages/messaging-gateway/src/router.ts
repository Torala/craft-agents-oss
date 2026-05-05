/**
 * Router — routes inbound messages from platform adapters to sessions.
 *
 * Looks up the ChannelBinding for (platform, channelId).
 * If found → access-control gate, then resolves any `IncomingAttachment.localPath`
 * entries to `FileAttachment`s via `readFileAttachment()` and forwards to
 * SessionManager.
 * If not found → delegates to Commands for /bind, /new, etc. (Commands
 * applies its own pre-binding access gate.)
 */

import type { ISessionManager } from '@craft-agent/server-core/handlers'
import { readFileAttachment } from '@craft-agent/shared/utils'
import type { FileAttachment } from '@craft-agent/shared/protocol'
import {
  buildRejectionReply,
  evaluateBindingAccess,
  type AccessRejectReason,
} from './access-control'
import type { BindingStore } from './binding-store'
import type { Commands } from './commands'
import type { PendingSendersStore } from './pending-senders'
import type {
  IncomingMessage,
  MessagingConfig,
  MessagingLogger,
  PlatformAdapter,
} from './types'

const NOOP_LOGGER: MessagingLogger = {
  info: () => {},
  warn: () => {},
  error: () => {},
  child: () => NOOP_LOGGER,
}

export interface RouterDeps {
  /** Reads the workspace's current MessagingConfig. Called per-message
   *  so config edits take effect without restart. */
  getWorkspaceConfig: () => MessagingConfig
  /** Optional pending-senders store; rejected attempts are recorded here so
   *  the Settings UI can surface them with one-click "Allow" buttons. */
  pendingStore?: PendingSendersStore
}

/**
 * Per-(platform, sender) rate limit on rejection replies. Without this, a
 * non-owner spamming the bot would receive a reply on every message which
 * looks like a self-inflicted DoS.
 */
const REJECT_REPLY_COOLDOWN_MS = 60 * 60 * 1000

export class Router {
  private readonly deps: RouterDeps
  private readonly recentRejectReplies = new Map<string, number>()

  constructor(
    private readonly sessionManager: ISessionManager,
    private readonly bindingStore: BindingStore,
    private readonly commands: Commands,
    private readonly log: MessagingLogger = NOOP_LOGGER,
    deps: RouterDeps = { getWorkspaceConfig: () => ({ enabled: false, platforms: {} }) },
  ) {
    this.deps = deps
  }

  async route(adapter: PlatformAdapter, msg: IncomingMessage): Promise<void> {
    // Threads (Telegram supergroup forum topics) participate in the binding
    // lookup key, so two topics in the same supergroup route to different
    // sessions even though they share `chat.id`.
    const binding = this.bindingStore.findByChannel(msg.platform, msg.channelId, msg.threadId)

    if (binding) {
      const verdict = evaluateBindingAccess({
        msg,
        workspaceConfig: this.deps.getWorkspaceConfig(),
        binding,
      })
      if (!verdict.allow) {
        await this.handleReject(adapter, msg, verdict.reason, {
          bindingId: binding.id,
          sessionId: binding.sessionId,
        })
        return
      }

      try {
        const fileAttachments = this.resolveAttachments(msg)
        this.log.info('routing inbound chat message to session', {
          event: 'message_routed',
          platform: msg.platform,
          channelId: msg.channelId,
          threadId: msg.threadId,
          sessionId: binding.sessionId,
          bindingId: binding.id,
          attachmentCount: fileAttachments?.length ?? 0,
        })
        await this.sessionManager.sendMessage(
          binding.sessionId,
          msg.text,
          fileAttachments,
          undefined, // storedAttachments (handled by session layer)
          undefined, // SendMessageOptions
        )
      } catch (err) {
        const errorMsg = err instanceof Error ? err.message : 'Unknown error'
        this.log.error('failed to route inbound chat message', {
          event: 'message_route_failed',
          platform: msg.platform,
          channelId: msg.channelId,
          threadId: msg.threadId,
          sessionId: binding.sessionId,
          bindingId: binding.id,
          error: err,
        })
        await adapter.sendText(
          msg.channelId,
          `Failed to send message to session: ${errorMsg}`,
          { threadId: msg.threadId },
        )
      }
      return
    }

    this.log.info('routing inbound chat message to command handler', {
      event: 'message_unbound',
      platform: msg.platform,
      channelId: msg.channelId,
      threadId: msg.threadId,
      messageId: msg.messageId,
    })
    await this.commands.handle(adapter, msg)
  }

  /**
   * Common reject path for both bound (this file) and pre-binding (Commands)
   * gating. Records the rejection in the pending store and replies with a
   * friendly message — but only once per sender per cooldown window so a
   * spammer doesn't wedge the bot into a tight reply loop.
   *
   * Public so `Commands.handle` can reuse the exact same logic from the
   * unbound path.
   */
  async handleReject(
    adapter: PlatformAdapter,
    msg: IncomingMessage,
    reason: AccessRejectReason,
    extra?: { bindingId?: string; sessionId?: string },
  ): Promise<void> {
    this.log.info('access-control rejected message', {
      event: 'message_rejected',
      reason,
      platform: msg.platform,
      channelId: msg.channelId,
      threadId: msg.threadId,
      senderId: msg.senderId,
      senderUsername: msg.senderUsername,
      bindingId: extra?.bindingId,
      sessionId: extra?.sessionId,
    })

    if (reason !== 'bot-sender') {
      this.deps.pendingStore?.recordRejection({
        platform: msg.platform,
        senderId: msg.senderId,
        senderName: msg.senderName,
        senderUsername: msg.senderUsername,
      })
    }

    const replyText = buildRejectionReply(reason)
    if (!replyText) return

    const key = `${msg.platform}:${msg.senderId}`
    const last = this.recentRejectReplies.get(key) ?? 0
    if (Date.now() - last < REJECT_REPLY_COOLDOWN_MS) return
    this.recentRejectReplies.set(key, Date.now())

    try {
      await adapter.sendText(msg.channelId, replyText, {
        ...(msg.threadId !== undefined ? { threadId: msg.threadId } : {}),
      })
    } catch (err) {
      this.log.warn('failed to send rejection reply (non-fatal)', {
        event: 'reject_reply_failed',
        platform: msg.platform,
        channelId: msg.channelId,
        error: err,
      })
    }
  }

  /**
   * Convert adapter-emitted `IncomingAttachment[]` into the session's
   * `FileAttachment[]` shape. Adapters that download the blob to disk
   * populate `localPath`; we wrap it with `readFileAttachment()` which
   * handles image→base64 / pdf→base64 / text→utf-8 encoding.
   *
   * Attachments without a `localPath`, or whose file can't be read, are
   * silently skipped — the upstream adapter already logged/notified on
   * download failure, so re-surfacing here would double up.
   */
  private resolveAttachments(msg: IncomingMessage): FileAttachment[] | undefined {
    if (!msg.attachments?.length) return undefined
    const built: FileAttachment[] = []
    for (const a of msg.attachments) {
      if (!a.localPath) continue
      const att = readFileAttachment(a.localPath) as FileAttachment | null
      if (!att) continue
      if (a.fileName) att.name = a.fileName
      built.push(att)
    }
    return built.length > 0 ? built : undefined
  }
}
