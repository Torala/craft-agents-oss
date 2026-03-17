import { describe, expect, it } from 'bun:test'
import { resolveClaudeThinkingOptions } from '../claude-agent.ts'
import { getThinkingTokens } from '../thinking-levels.ts'

describe('resolveClaudeThinkingOptions', () => {
  it('uses adaptive thinking for true Anthropic backends', () => {
    const result = resolveClaudeThinkingOptions({
      thinkingLevel: 'medium',
      model: 'claude-opus-4-6',
      providerType: 'anthropic',
      minimizeThinking: false,
    })

    expect(result).toEqual({
      thinking: { type: 'adaptive' },
      effort: 'medium',
    })
  })

  it('falls back to token budgets for anthropic_compat endpoints', () => {
    const result = resolveClaudeThinkingOptions({
      thinkingLevel: 'high',
      model: 'claude-opus-4-6',
      providerType: 'anthropic_compat',
      minimizeThinking: false,
    })

    expect(result).toEqual({
      maxThinkingTokens: getThinkingTokens('high', 'claude-opus-4-6'),
    })
  })

  it('disables thinking entirely when level is off on adaptive backends', () => {
    const result = resolveClaudeThinkingOptions({
      thinkingLevel: 'off',
      model: 'claude-sonnet-4-6',
      providerType: 'anthropic',
      minimizeThinking: false,
    })

    expect(result).toEqual({
      thinking: { type: 'disabled' },
    })
  })
})
