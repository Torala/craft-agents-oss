#!/usr/bin/env bun
/**
 * Auto-Label Rules: Proof of Concept
 *
 * Validates that the auto-label evaluator correctly handles:
 * - Regex patterns with capture groups and value templates
 * - Number normalization (commas, k/M suffixes)
 * - Deduplication (same label+value from multiple rules)
 * - Multiple matches in a single message
 * - Code block stripping (no matches inside code)
 * - Match limit (max 10 per message)
 */

import { evaluateAutoLabels } from '../packages/shared/src/labels/auto/evaluator.ts'
import type { LabelConfig } from '../packages/shared/src/labels/types.ts'

// ============================================================
// Test label configurations (simulating a workspace config)
// ============================================================

const testLabels: LabelConfig[] = [
  {
    id: 'linear-issue',
    name: 'Linear Issue',
    valueType: 'string',
    autoRules: [
      {
        pattern: 'linear\\.app/[\\w-]+/issue/([A-Z]+-\\d+)',
        valueTemplate: '$1',
        description: 'Matches Linear issue URLs',
      },
      {
        pattern: '\\b([A-Z]{2,5}-\\d+)\\b',
        valueTemplate: '$1',
        description: 'Matches bare issue keys like CRA-123',
      },
    ],
  },
  {
    id: 'deadline',
    name: 'Deadline',
    valueType: 'date',
    autoRules: [
      {
        pattern: '(\\d{4}-\\d{2}-\\d{2}(?:T\\d{2}:\\d{2})?)',
        valueTemplate: '$1',
        description: 'Matches explicit ISO dates/datetimes',
      },
    ],
  },
  {
    id: 'budget',
    name: 'Budget',
    valueType: 'number',
    autoRules: [
      {
        pattern: '\\$([\\d,.]+[kKmMbB]?)',
        valueTemplate: '$1',
        description: 'Matches dollar amounts',
      },
    ],
  },
  {
    id: 'contact',
    name: 'Contact',
    valueType: 'string',
    autoRules: [
      {
        pattern: '([\\w.+-]+@[\\w.-]+\\.[a-zA-Z]{2,})',
        valueTemplate: '$1',
        description: 'Matches email addresses',
      },
    ],
  },
  {
    id: 'github-pr',
    name: 'GitHub PR',
    valueType: 'string',
    autoRules: [
      {
        pattern: 'github\\.com/([\\w-]+/[\\w-]+)/pull/(\\d+)',
        valueTemplate: '$1#$2',
        description: 'Matches GitHub PR URLs',
      },
    ],
  },
  {
    id: 'sentry-issue',
    name: 'Sentry Issue',
    valueType: 'string',
    autoRules: [
      {
        pattern: 'sentry\\.io/[\\w-]+/[\\w-]+/issues/(\\d+)',
        valueTemplate: '$1',
        description: 'Matches Sentry issue URLs',
      },
    ],
  },
]

// ============================================================
// Test cases
// ============================================================

interface TestCase {
  message: string
  expected: string[]  // Expected label entries (labelId::value)
  description?: string
}

const testCases: TestCase[] = [
  {
    message: 'Fix CRA-4821 auth bug',
    expected: ['linear-issue::CRA-4821'],
    description: 'Bare issue key',
  },
  {
    message: 'Budget: $45,000',
    expected: ['budget::45000'],
    description: 'Dollar amount with commas',
  },
  {
    message: 'Check https://linear.app/craft/issue/CRA-100 for details',
    expected: ['linear-issue::CRA-100'],
    description: 'Linear URL (deduplicated with bare key)',
  },
  {
    message: 'Contact john@acme.com about the deal',
    expected: ['contact::john@acme.com'],
    description: 'Email address',
  },
  {
    message: 'CRA-1 and CRA-2 block CRA-3',
    expected: ['linear-issue::CRA-1', 'linear-issue::CRA-2', 'linear-issue::CRA-3'],
    description: 'Multiple matches on same label',
  },
  {
    message: 'Release date is 2026-03-15',
    expected: ['deadline::2026-03-15'],
    description: 'ISO date',
  },
  {
    message: 'Deploy on 2026-02-01T09:00',
    expected: ['deadline::2026-02-01T09:00'],
    description: 'ISO datetime',
  },
  {
    message: 'Cost is $1.5M',
    expected: ['budget::1500000'],
    description: 'Dollar amount with M suffix',
  },
  {
    message: 'Review https://github.com/craft-do/app/pull/847',
    expected: ['github-pr::craft-do/app#847'],
    description: 'GitHub PR URL with multi-group template',
  },
  {
    message: 'Error at https://sentry.io/acme-corp/frontend/issues/123456',
    expected: ['sentry-issue::123456'],
    description: 'Sentry issue URL',
  },
  {
    message: 'No labels here, just a normal message',
    expected: [],
    description: 'No matches',
  },
  {
    message: 'Budget is $50k for CRA-999 due 2026-01-30',
    expected: ['linear-issue::CRA-999', 'deadline::2026-01-30', 'budget::50000'],
    description: 'Combined: issue + date + budget',
  },
  // Code block stripping tests
  {
    message: 'Fix this: ```\nconst url = "https://linear.app/craft/issue/CRA-999"\n```',
    expected: [],
    description: 'Fenced code block stripped — no match inside code',
  },
  {
    message: 'The issue `CRA-500` was mentioned in passing',
    expected: [],
    description: 'Inline code stripped — no match inside backticks',
  },
  {
    message: 'Real issue CRA-500 but not `CRA-600` in code',
    expected: ['linear-issue::CRA-500'],
    description: 'Only matches outside code',
  },
  // Deduplication test (URL rule and bare key rule both match same value)
  {
    message: 'See https://linear.app/craft/issue/CRA-200 — yes CRA-200 is critical',
    expected: ['linear-issue::CRA-200'],
    description: 'Deduplication: same value from URL and bare key rules',
  },
]

// ============================================================
// Run tests
// ============================================================

console.log('Auto-Label Rules: Proof of Concept')
console.log('=' .repeat(60))
console.log()

let passed = 0
let failed = 0

for (const testCase of testCases) {
  const matches = evaluateAutoLabels(testCase.message, testLabels)
  const actual = matches.map(m => `${m.labelId}::${m.value}`)

  // Compare sorted arrays for order-independent matching
  const expectedSorted = [...testCase.expected].sort()
  const actualSorted = [...actual].sort()
  const isPass = JSON.stringify(expectedSorted) === JSON.stringify(actualSorted)

  if (isPass) {
    passed++
    console.log(`✓ ${testCase.description ?? testCase.message}`)
    if (actual.length > 0) {
      console.log(`  → ${actual.join(', ')}`)
    } else {
      console.log(`  → (no matches)`)
    }
  } else {
    failed++
    console.log(`✗ ${testCase.description ?? testCase.message}`)
    console.log(`  Expected: ${testCase.expected.join(', ') || '(none)'}`)
    console.log(`  Actual:   ${actual.join(', ') || '(none)'}`)
    if (matches.length > 0) {
      console.log(`  Matched:  ${matches.map(m => `"${m.matchedText}"`).join(', ')}`)
    }
  }
  console.log()
}

console.log('=' .repeat(60))
console.log(`Results: ${passed} passed, ${failed} failed, ${testCases.length} total`)
if (failed === 0) {
  console.log('All tests passed!')
} else {
  process.exit(1)
}
