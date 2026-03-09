import { describe, expect, it } from 'bun:test'
import { CliError, parseBoolean, parseStructuredInput, parseTokens } from './utils.ts'

describe('commands utils', () => {
  it('parseTokens supports positional and flag-style options', () => {
    const parsed = parseTokens(['get', 'abc', '--limit', '5', '--verbose'])
    expect(parsed.positional).toEqual(['get', 'abc'])
    expect(parsed.options.limit).toBe('5')
    expect(parsed.options.verbose).toBe(true)
  })

  it('parseStructuredInput rejects using --json and --stdin together', () => {
    expect(() => parseStructuredInput({ json: '{}' as any, stdin: true as any })).toThrow(CliError)
  })

  it('parseStructuredInput rejects non-object --json payloads', () => {
    expect(() => parseStructuredInput({ json: '[]' as any })).toThrow(CliError)
    expect(() => parseStructuredInput({ json: '"text"' as any })).toThrow(CliError)
  })

  it('parseBoolean parses valid values and rejects invalid ones', () => {
    expect(parseBoolean(true, 'enabled')).toBe(true)
    expect(parseBoolean('true', 'enabled')).toBe(true)
    expect(parseBoolean('false', 'enabled')).toBe(false)
    expect(() => parseBoolean('yes' as any, 'enabled')).toThrow(CliError)
  })
})
