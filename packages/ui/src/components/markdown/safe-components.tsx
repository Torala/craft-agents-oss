/**
 * Safe component handling for react-markdown
 *
 * When users type HTML-like content (e.g., `<sq+qr>`), rehype-raw interprets
 * it as an HTML tag. React crashes if the tag name contains invalid characters.
 * This module provides utilities to handle such cases gracefully.
 */

import React from 'react'
import type { Components } from 'react-markdown'

/**
 * UnknownTag - Fallback component for invalid HTML-like tags
 *
 * Renders tags with invalid names (containing +, @, etc.) as plain text
 * instead of crashing React.
 */
export const UnknownTag: React.FC<{ tagName: string; children?: React.ReactNode }> = ({
  tagName,
  children,
}) => (
  <span className="text-muted-foreground">
    {`<${tagName}>`}
    {children}
    {children != null && `</${tagName}>`}
  </span>
)

/**
 * Checks if a tag name is valid for React/HTML rendering.
 *
 * Valid tags are:
 * - Lowercase HTML elements: div, span, p, etc. (matches /^[a-z][a-z0-9]*$/)
 * - PascalCase React components: MyComponent, etc. (matches /^[A-Z][a-zA-Z0-9_]*$/)
 *
 * Invalid tags contain characters like +, @, -, spaces, etc.
 */
export function isValidTagName(tagName: string): boolean {
  // Lowercase HTML tags (div, span, etc.)
  if (/^[a-z][a-z0-9]*$/.test(tagName)) return true
  // PascalCase React components (MyComponent, etc.)
  if (/^[A-Z][a-zA-Z0-9_]*$/.test(tagName)) return true
  return false
}

/**
 * Wraps a components object with a Proxy to handle unknown/invalid tag names.
 *
 * Returns:
 * - The original component if defined in the components map
 * - undefined for valid HTML/React tag names (lets React handle them)
 * - UnknownTag fallback for invalid tag names (containing +, @, etc.)
 *
 * @example
 * const safeComponents = wrapWithSafeProxy(components)
 * // <div> → handled by React (valid HTML)
 * // <MyComponent> → handled by React (valid component name)
 * // <sq+qr> → rendered as text by UnknownTag
 */
export function wrapWithSafeProxy(components: Partial<Components>): Partial<Components> {
  return new Proxy(components, {
    get(target, prop) {
      // Handle symbols (like Symbol.iterator) - pass through to target
      if (typeof prop === 'symbol') {
        return Reflect.get(target, prop)
      }

      // Return defined component if exists
      if (prop in target) return target[prop as keyof typeof target]

      // Let React handle valid tag names
      if (isValidTagName(prop)) return undefined

      // Return fallback for invalid tag names (like sq+qr, foo@bar)
      return ({ children }: { children?: React.ReactNode }) => (
        <UnknownTag tagName={prop}>{children}</UnknownTag>
      )
    },

    has(target, prop) {
      // Handle symbols
      if (typeof prop === 'symbol') {
        return Reflect.has(target, prop)
      }

      // Return true if explicitly defined in target
      if (prop in target) return true

      // Claim we have invalid tag names so `get` can provide the fallback
      if (!isValidTagName(prop)) return true

      // Valid tags not in target - return false, let React handle natively
      return false
    },

    // CRITICAL: hast-util-to-jsx-runtime uses Object.hasOwnProperty to check
    // for components, which calls getOwnPropertyDescriptor, not the `has` trap.
    // We must return a descriptor for invalid tags so hasOwnProperty returns true.
    getOwnPropertyDescriptor(target, prop) {
      // Handle symbols
      if (typeof prop === 'symbol') {
        return Reflect.getOwnPropertyDescriptor(target, prop)
      }

      // Return actual descriptor if property exists in target
      const descriptor = Reflect.getOwnPropertyDescriptor(target, prop)
      if (descriptor) return descriptor

      // For invalid tag names, return a fake descriptor so hasOwnProperty returns true
      // This makes hast-util-to-jsx-runtime use our component from `get` trap
      if (!isValidTagName(prop)) {
        return {
          configurable: true,
          enumerable: true,
          value: undefined, // The actual value comes from `get` trap
          writable: true,
        }
      }

      // Valid tags not in target - return undefined (no own property)
      return undefined
    },
  })
}
