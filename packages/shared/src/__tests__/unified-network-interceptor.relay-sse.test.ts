import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { toolMetadataStore } from '../interceptor-common.ts';

let createOpenAiSseStrippingStream: typeof import('../unified-network-interceptor.ts').createOpenAiSseStrippingStream;

const encoder = new TextEncoder();
const decoder = new TextDecoder();

async function runThroughProcessor(
  processor: TransformStream<Uint8Array, Uint8Array>,
  chunks: string[],
): Promise<string> {
  const input = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(encoder.encode(chunk));
      controller.close();
    },
  });

  const output = input.pipeThrough(processor);
  const reader = output.getReader();
  let result = '';
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    if (value) result += decoder.decode(value, { stream: true });
  }
  result += decoder.decode();
  return result;
}

/**
 * Counts how many SSE init events (the "first chunk" carrying id + name +
 * empty arguments) appear in the post-strip output for a given id. Each id
 * must appear in exactly one init event regardless of how many times the
 * upstream relay repeated it.
 */
function countInitEventsForId(out: string, toolCallId: string): number {
  const lines = out.split('\n');
  let count = 0;
  for (const line of lines) {
    if (!line.startsWith('data: ')) continue;
    const payload = line.slice(6).trim();
    if (!payload || payload === '[DONE]') continue;
    try {
      const parsed = JSON.parse(payload) as {
        choices?: Array<{
          delta?: {
            tool_calls?: Array<{
              id?: string;
              function?: { name?: string; arguments?: string };
            }>;
          };
        }>;
      };
      const tcs = parsed.choices?.[0]?.delta?.tool_calls;
      if (!tcs) continue;
      for (const tc of tcs) {
        if (tc.id === toolCallId && tc.function?.name) {
          count++;
        }
      }
    } catch {
      continue;
    }
  }
  return count;
}

describe('unified-network-interceptor relay SSE quirks (#613)', () => {
  let sessionDir: string;

  beforeAll(async () => {
    process.env.CRAFT_INTERCEPTOR_DISABLE_AUTO_INSTALL = '1';
    ({ createOpenAiSseStrippingStream } = await import('../unified-network-interceptor.ts'));
  });

  afterAll(() => {
    delete process.env.CRAFT_INTERCEPTOR_DISABLE_AUTO_INSTALL;
  });

  beforeEach(() => {
    sessionDir = mkdtempSync(join(tmpdir(), 'interceptor-relay-'));
    toolMetadataStore.setSessionDir(sessionDir);
  });

  afterEach(() => {
    toolMetadataStore._clearForTesting();
    rmSync(sessionDir, { recursive: true, force: true });
  });

  it('dedupes init events when a relay repeats tc.id on every chunk', async () => {
    // Reproduces the relay-style SSE stream that triggers the duplicate
    // tool_call_id 400. Every chunk includes both id and name — instead of
    // sending id once and arg-deltas after.
    const sse = [
      'data: {"choices":[{"index":0,"delta":{"tool_calls":[{"index":0,"id":"call_relay","type":"function","function":{"name":"ls","arguments":"{\\"pa"}}]}}]}\n\n',
      'data: {"choices":[{"index":0,"delta":{"tool_calls":[{"index":0,"id":"call_relay","type":"function","function":{"name":"ls","arguments":"th\\":"}}]}}]}\n\n',
      'data: {"choices":[{"index":0,"delta":{"tool_calls":[{"index":0,"id":"call_relay","type":"function","function":{"name":"ls","arguments":"\\"/tmp\\"}"}}]}}]}\n\n',
      'data: {"choices":[{"index":0,"finish_reason":"tool_calls"}]}\n\n',
      'data: [DONE]\n\n',
    ];

    const out = await runThroughProcessor(createOpenAiSseStrippingStream(), sse);

    // Exactly ONE init event for call_relay, regardless of repetitions
    expect(countInitEventsForId(out, 'call_relay')).toBe(1);
    // Final argument delta should contain the fully reassembled JSON
    expect(out).toContain('"arguments":"{\\"path\\":\\"/tmp\\"}"');
  });

  it('does not collide parallel tool calls when relay drops tc.index on later chunks', async () => {
    // Two parallel tool calls; subsequent argument-delta chunks omit
    // `index`. Naive code would bucket every later chunk under index 0 and
    // smash one call's args into the other's tracked entry.
    const sse = [
      // First chunk opens both calls with explicit indices
      'data: {"choices":[{"index":0,"delta":{"tool_calls":[{"index":0,"id":"call_A","type":"function","function":{"name":"ls","arguments":"{\\"a\\":"}}, {"index":1,"id":"call_B","type":"function","function":{"name":"pwd","arguments":"{\\"b\\":"}}]}}]}\n\n',
      // Subsequent argument-delta for call_B WITHOUT index — should bind to last opened (B)
      'data: {"choices":[{"index":0,"delta":{"tool_calls":[{"function":{"arguments":"2}"}}]}}]}\n\n',
      // Subsequent argument-delta for call_A WITH explicit index 0
      'data: {"choices":[{"index":0,"delta":{"tool_calls":[{"index":0,"function":{"arguments":"1}"}}]}}]}\n\n',
      'data: {"choices":[{"index":0,"finish_reason":"tool_calls"}]}\n\n',
      'data: [DONE]\n\n',
    ];

    const out = await runThroughProcessor(createOpenAiSseStrippingStream(), sse);

    expect(countInitEventsForId(out, 'call_A')).toBe(1);
    expect(countInitEventsForId(out, 'call_B')).toBe(1);
    // call_A should have {"a":1}, call_B should have {"b":2}
    expect(out).toContain('"arguments":"{\\"a\\":1}"');
    expect(out).toContain('"arguments":"{\\"b\\":2}"');
  });
});
