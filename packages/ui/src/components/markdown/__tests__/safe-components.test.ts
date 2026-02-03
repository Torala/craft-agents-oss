/**
 * Tests for safe-components.tsx — handling invalid HTML-like tags in markdown.
 *
 * When users type `<sq+qr>` or similar invalid tag names, rehype-raw interprets
 * them as HTML. React crashes on invalid component names. These tests verify
 * the proxy correctly handles all cases.
 */

import { describe, it, expect } from 'bun:test'
import { isValidTagName, wrapWithSafeProxy } from '../safe-components'

// ============================================================================
// isValidTagName — tag name validation
// ============================================================================

describe('isValidTagName', () => {
  describe('valid HTML tags (lowercase)', () => {
    it('accepts standard HTML tags', () => {
      expect(isValidTagName('div')).toBe(true)
      expect(isValidTagName('span')).toBe(true)
      expect(isValidTagName('p')).toBe(true)
      expect(isValidTagName('a')).toBe(true)
      expect(isValidTagName('strong')).toBe(true)
      expect(isValidTagName('em')).toBe(true)
    })

    it('accepts HTML5 semantic tags', () => {
      expect(isValidTagName('article')).toBe(true)
      expect(isValidTagName('section')).toBe(true)
      expect(isValidTagName('header')).toBe(true)
      expect(isValidTagName('footer')).toBe(true)
    })

    it('accepts tags with numbers', () => {
      expect(isValidTagName('h1')).toBe(true)
      expect(isValidTagName('h2')).toBe(true)
      expect(isValidTagName('h6')).toBe(true)
    })
  })

  describe('valid React components (PascalCase)', () => {
    it('accepts simple PascalCase names', () => {
      expect(isValidTagName('MyComponent')).toBe(true)
      expect(isValidTagName('Button')).toBe(true)
      expect(isValidTagName('App')).toBe(true)
    })

    it('accepts names with numbers', () => {
      expect(isValidTagName('Card2')).toBe(true)
      expect(isValidTagName('Layout3D')).toBe(true)
    })

    it('accepts names with underscores', () => {
      expect(isValidTagName('My_Component')).toBe(true)
      expect(isValidTagName('Button_Primary')).toBe(true)
    })
  })

  describe('invalid tag names', () => {
    it('rejects tags with plus sign', () => {
      expect(isValidTagName('sq+qr')).toBe(false)
      expect(isValidTagName('foo+bar')).toBe(false)
      expect(isValidTagName('a+b')).toBe(false)
    })

    it('rejects tags with at sign', () => {
      expect(isValidTagName('@mention')).toBe(false)
      expect(isValidTagName('user@example')).toBe(false)
    })

    it('rejects tags with hyphens', () => {
      // Note: custom elements use hyphens, but react-markdown treats these
      // as component names, not custom elements
      expect(isValidTagName('my-component')).toBe(false)
      expect(isValidTagName('foo-bar')).toBe(false)
    })

    it('rejects tags with spaces', () => {
      expect(isValidTagName('foo bar')).toBe(false)
      expect(isValidTagName(' span')).toBe(false)
    })

    it('rejects tags starting with numbers', () => {
      expect(isValidTagName('3d')).toBe(false)
      expect(isValidTagName('123')).toBe(false)
    })

    it('rejects empty string', () => {
      expect(isValidTagName('')).toBe(false)
    })

    it('rejects special characters', () => {
      expect(isValidTagName('foo!bar')).toBe(false)
      expect(isValidTagName('foo#bar')).toBe(false)
      expect(isValidTagName('foo$bar')).toBe(false)
      expect(isValidTagName('foo%bar')).toBe(false)
      expect(isValidTagName('foo&bar')).toBe(false)
      expect(isValidTagName('foo*bar')).toBe(false)
      expect(isValidTagName('foo/bar')).toBe(false)
      expect(isValidTagName('foo=bar')).toBe(false)
      expect(isValidTagName('foo<bar')).toBe(false)
      expect(isValidTagName('foo>bar')).toBe(false)
    })
  })
})

// ============================================================================
// wrapWithSafeProxy — proxy behavior
// ============================================================================

describe('wrapWithSafeProxy', () => {
  // Create a mock components object with some defined components
  const mockComponent = () => null
  const mockComponents = {
    code: mockComponent,
    pre: mockComponent,
    a: mockComponent,
    MyCustom: mockComponent,
  }

  const safeComponents = wrapWithSafeProxy(mockComponents)

  describe('returns defined components', () => {
    it('returns component for defined lowercase tags', () => {
      expect(safeComponents.code).toBe(mockComponent)
      expect(safeComponents.pre).toBe(mockComponent)
      expect(safeComponents.a).toBe(mockComponent)
    })

    it('returns component for defined PascalCase components', () => {
      // @ts-expect-error - MyCustom is not in standard Components type
      expect(safeComponents.MyCustom).toBe(mockComponent)
    })
  })

  describe('returns undefined for valid but undefined tags', () => {
    it('returns undefined for valid HTML tags not in components', () => {
      expect(safeComponents.div).toBeUndefined()
      expect(safeComponents.span).toBeUndefined()
      expect(safeComponents.p).toBeUndefined()
    })

    it('returns undefined for valid PascalCase names not in components', () => {
      // @ts-expect-error - accessing undefined component
      expect(safeComponents.SomeOther).toBeUndefined()
    })
  })

  describe('returns fallback for invalid tag names', () => {
    it('returns fallback function for tag with plus sign', () => {
      // @ts-expect-error - accessing invalid tag name
      const fallback = safeComponents['sq+qr']
      expect(typeof fallback).toBe('function')
    })

    it('returns fallback function for tag with at sign', () => {
      // @ts-expect-error - accessing invalid tag name
      const fallback = safeComponents['@mention']
      expect(typeof fallback).toBe('function')
    })

    it('returns fallback function for tag with hyphen', () => {
      // @ts-expect-error - accessing invalid tag name
      const fallback = safeComponents['my-element']
      expect(typeof fallback).toBe('function')
    })

    it('returns fallback function for various special characters', () => {
      const invalidNames = ['foo+bar', 'user@domain', 'a&b', 'x*y', 'path/to']
      for (const name of invalidNames) {
        // @ts-expect-error - accessing invalid tag name
        const fallback = safeComponents[name]
        expect(typeof fallback).toBe('function')
      }
    })
  })

  describe('fallback component behavior', () => {
    it('fallback is callable and returns a React element', () => {
      // @ts-expect-error - accessing invalid tag name
      const Fallback = safeComponents['sq+qr']
      // Call the component function
      const result = Fallback({ children: 'test content' })
      // Should return a React element (object with type and props)
      expect(result).toBeDefined()
      expect(typeof result).toBe('object')
    })
  })
})

// ============================================================================
// has trap (the 'in' operator) — critical for react-markdown integration
// ============================================================================

describe('wrapWithSafeProxy has trap', () => {
  const mockComponent = () => null
  const mockComponents = {
    code: mockComponent,
    pre: mockComponent,
  }

  const safeComponents = wrapWithSafeProxy(mockComponents)

  describe('returns true for defined components', () => {
    it('returns true for components in target', () => {
      expect('code' in safeComponents).toBe(true)
      expect('pre' in safeComponents).toBe(true)
    })
  })

  describe('returns false for valid but undefined tags', () => {
    it('returns false for valid HTML tags not in target', () => {
      expect('div' in safeComponents).toBe(false)
      expect('span' in safeComponents).toBe(false)
      expect('p' in safeComponents).toBe(false)
    })

    it('returns false for valid PascalCase not in target', () => {
      expect('MyComponent' in safeComponents).toBe(false)
      expect('Button' in safeComponents).toBe(false)
    })
  })

  describe('returns true for invalid tag names (so get trap provides fallback)', () => {
    it('returns true for tags with plus sign', () => {
      expect('sq+qr' in safeComponents).toBe(true)
      expect('SQ+QR' in safeComponents).toBe(true)
      expect('foo+bar' in safeComponents).toBe(true)
    })

    it('returns true for tags with special characters', () => {
      expect('@mention' in safeComponents).toBe(true)
      expect('my-element' in safeComponents).toBe(true)
      expect('P 150' in safeComponents).toBe(true)
    })
  })

  describe('handles symbols correctly', () => {
    it('passes through symbol checks to target', () => {
      expect(Symbol.iterator in safeComponents).toBe(false)
      expect(Symbol.toStringTag in safeComponents).toBe(false)
    })
  })
})

// ============================================================================
// Symbol handling in get trap
// ============================================================================

describe('wrapWithSafeProxy symbol handling', () => {
  const safeComponents = wrapWithSafeProxy({})

  it('handles Symbol.iterator access without crashing', () => {
    // This should not throw, should return undefined
    // @ts-expect-error - accessing symbol
    expect(() => safeComponents[Symbol.iterator]).not.toThrow()
  })

  it('handles Symbol.toStringTag access', () => {
    // @ts-expect-error - accessing symbol
    expect(() => safeComponents[Symbol.toStringTag]).not.toThrow()
  })
})

// ============================================================================
// getOwnPropertyDescriptor trap — critical for hast-util-to-jsx-runtime
// ============================================================================

describe('wrapWithSafeProxy getOwnPropertyDescriptor trap', () => {
  // hast-util-to-jsx-runtime uses Object.hasOwnProperty to check for components:
  //   own.call(state.components, name) ? state.components[name] : name
  // Object.hasOwnProperty internally calls getOwnPropertyDescriptor

  const mockComponent = () => null
  const mockComponents = { code: mockComponent }
  const safeComponents = wrapWithSafeProxy(mockComponents)

  describe('Object.hasOwnProperty behavior', () => {
    it('returns true for defined components', () => {
      expect(Object.hasOwnProperty.call(safeComponents, 'code')).toBe(true)
    })

    it('returns false for valid but undefined tags', () => {
      expect(Object.hasOwnProperty.call(safeComponents, 'div')).toBe(false)
      expect(Object.hasOwnProperty.call(safeComponents, 'span')).toBe(false)
      expect(Object.hasOwnProperty.call(safeComponents, 'MyComponent')).toBe(false)
    })

    it('returns true for invalid tag names (so fallback is used)', () => {
      expect(Object.hasOwnProperty.call(safeComponents, 'sq+qr')).toBe(true)
      expect(Object.hasOwnProperty.call(safeComponents, 'SQ+QR')).toBe(true)
      expect(Object.hasOwnProperty.call(safeComponents, 'P 150')).toBe(true)
      expect(Object.hasOwnProperty.call(safeComponents, '@mention')).toBe(true)
      expect(Object.hasOwnProperty.call(safeComponents, 'my-element')).toBe(true)
    })
  })

  describe('simulates hast-util-to-jsx-runtime component lookup', () => {
    // This is exactly what hast-util-to-jsx-runtime does:
    // own.call(state.components, name) ? state.components[name] : name

    it('uses fallback component for invalid tags instead of tag name', () => {
      const name = 'sq+qr'
      const own = Object.hasOwnProperty

      // This is the exact check from hast-util-to-jsx-runtime
      const result = own.call(safeComponents, name)
        // @ts-expect-error - accessing invalid tag
        ? safeComponents[name]
        : name

      // Should NOT return the string 'sq+qr', should return a function
      expect(result).not.toBe(name)
      expect(typeof result).toBe('function')
    })

    it('returns tag name for valid undefined tags (native elements)', () => {
      const name = 'div'
      const own = Object.hasOwnProperty

      const result = own.call(safeComponents, name)
        ? safeComponents[name]
        : name

      // Should return 'div' string for native element rendering
      expect(result).toBe('div')
    })
  })
})

// ============================================================================
// Edge cases and real-world scenarios
// ============================================================================

describe('real-world scenarios', () => {
  const safeComponents = wrapWithSafeProxy({})

  it('handles "I love <3 you" heart emoticon case', () => {
    // The <3 part might be parsed as a tag
    // @ts-expect-error - accessing potentially invalid tag
    const fallback = safeComponents['3']
    // '3' starts with a number, so it's invalid
    expect(typeof fallback).toBe('function')
  })

  it('handles TypeScript generic syntax in text', () => {
    // If someone types <T> it might be parsed
    // @ts-expect-error - accessing tag
    expect(safeComponents.T).toBeUndefined() // Valid uppercase, let React handle
  })

  it('handles arrow expressions like <=>', () => {
    // @ts-expect-error - accessing invalid tag
    const fallback = safeComponents['=']
    expect(typeof fallback).toBe('function')
  })
})

// ============================================================================
// Actual crash case from user report
// ============================================================================

describe('actual crash case: QR code label text', () => {
  // This is the actual text that caused the crash:
  // <P 150><SQ+QR>[QR_Dokumenttyp: LieferscheinLS-NR:{LiefSchNr}...]
  const safeComponents = wrapWithSafeProxy({})

  it('handles <SQ+QR> tag from QR label', () => {
    // Uppercase with plus sign - must be caught
    expect(isValidTagName('SQ+QR')).toBe(false)
    expect('SQ+QR' in safeComponents).toBe(true)
    // @ts-expect-error - accessing invalid tag
    expect(typeof safeComponents['SQ+QR']).toBe('function')
  })

  it('handles <P 150> tag (P with space and number)', () => {
    // Tag with space - must be caught
    expect(isValidTagName('P 150')).toBe(false)
    expect('P 150' in safeComponents).toBe(true)
    // @ts-expect-error - accessing invalid tag
    expect(typeof safeComponents['P 150']).toBe('function')
  })

  it('handles lowercase version sq+qr (from rehype-raw)', () => {
    // rehype-raw may lowercase tag names
    expect(isValidTagName('sq+qr')).toBe(false)
    expect('sq+qr' in safeComponents).toBe(true)
    // @ts-expect-error - accessing invalid tag
    expect(typeof safeComponents['sq+qr']).toBe('function')
  })

  it('complete flow: invalid tag in components check then get', () => {
    // Simulate what react-markdown does:
    // 1. Check if tag is in components
    // 2. If yes, get the component
    // 3. Render it
    const tagName = 'SQ+QR'

    // Step 1: Check (must return true for invalid tags)
    const hasComponent = tagName in safeComponents
    expect(hasComponent).toBe(true)

    // Step 2: Get (must return fallback function)
    // @ts-expect-error - accessing invalid tag
    const Component = safeComponents[tagName]
    expect(typeof Component).toBe('function')

    // Step 3: Render (must not crash)
    const result = Component({ children: 'content' })
    expect(result).toBeDefined()
    expect(typeof result).toBe('object')
  })
})
