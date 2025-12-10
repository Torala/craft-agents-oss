import type { Options } from "@anthropic-ai/claude-agent-sdk";
import { join } from "path";
import { homedir } from "os";

declare const CRAFT_AGENT_CLI_VERSION: string | undefined;

export function getDefaultOptions(): Partial<Options> {
    if (typeof CRAFT_AGENT_CLI_VERSION !== 'undefined' && CRAFT_AGENT_CLI_VERSION != null) {
        return {
            pathToClaudeCodeExecutable: join(homedir(), '.local', 'share', 'craft', 'versions', CRAFT_AGENT_CLI_VERSION, 'claude-agent-sdk', 'cli.js')
        }
    }
    return {};
}