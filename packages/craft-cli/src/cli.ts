#!/usr/bin/env bun

/**
 * Compatibility shim.
 *
 * The command implementation now lives in packages/craft-agents-commands.
 * Keep this file so existing wrappers/env vars continue to work during migration.
 */

process.env.CRAFT_CLI_JSON_ONLY = process.env.CRAFT_CLI_JSON_ONLY ?? '1'

import { runCli } from '../../craft-agents-commands/src/main.ts'

runCli().catch((error) => {
  const message = error instanceof Error ? error.message : String(error)
  process.stdout.write(JSON.stringify({
    ok: false,
    error: {
      code: 'EXEC_ERROR',
      message,
      suggestion: 'Run: craft-agent --help',
    },
    warnings: [],
  }) + '\n')
  process.exit(1)
})
