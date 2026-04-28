import { beforeAll, describe, expect, it } from 'bun:test';

let validateOpenAiChatBody: typeof import('../unified-network-interceptor.ts').validateOpenAiChatBody;
let validateOpenAiResponsesBody: typeof import('../unified-network-interceptor.ts').validateOpenAiResponsesBody;
let MalformedBodyError: typeof import('../unified-network-interceptor.ts').MalformedBodyError;

describe('unified-network-interceptor validators (#613)', () => {
  beforeAll(async () => {
    process.env.CRAFT_INTERCEPTOR_DISABLE_AUTO_INSTALL = '1';
    const mod = await import('../unified-network-interceptor.ts');
    validateOpenAiChatBody = mod.validateOpenAiChatBody;
    validateOpenAiResponsesBody = mod.validateOpenAiResponsesBody;
    MalformedBodyError = mod.MalformedBodyError;
  });

  describe('OpenAI Chat Completions', () => {
    it('accepts a well-formed body with one tool call + one tool result', () => {
      const body = {
        messages: [
          { role: 'user', content: 'list files' },
          {
            role: 'assistant',
            tool_calls: [
              { id: 'call_1', type: 'function', function: { name: 'ls', arguments: '{}' } },
            ],
          },
          { role: 'tool', tool_call_id: 'call_1', content: 'a.txt b.txt' },
        ],
      };
      expect(() => validateOpenAiChatBody(body)).not.toThrow();
    });

    it('throws duplicate_tool_call_id when same id appears in two tool_calls', () => {
      const body = {
        messages: [
          {
            role: 'assistant',
            tool_calls: [
              { id: 'call_1', type: 'function', function: { name: 'ls', arguments: '{}' } },
              { id: 'call_1', type: 'function', function: { name: 'pwd', arguments: '{}' } },
            ],
          },
        ],
      };
      try {
        validateOpenAiChatBody(body);
        throw new Error('expected throw');
      } catch (err) {
        expect(err).toBeInstanceOf(MalformedBodyError);
        expect((err as InstanceType<typeof MalformedBodyError>).code).toBe('duplicate_tool_call_id');
      }
    });

    it('throws empty_tool_name when assistant emits a tool_call with blank name', () => {
      const body = {
        messages: [
          {
            role: 'assistant',
            tool_calls: [
              { id: 'call_1', type: 'function', function: { name: '', arguments: '{}' } },
            ],
          },
        ],
      };
      try {
        validateOpenAiChatBody(body);
        throw new Error('expected throw');
      } catch (err) {
        expect(err).toBeInstanceOf(MalformedBodyError);
        expect((err as InstanceType<typeof MalformedBodyError>).code).toBe('empty_tool_name');
      }
    });

    it('throws missing_tool_call_id on tool message without tool_call_id', () => {
      const body = {
        messages: [
          {
            role: 'assistant',
            tool_calls: [
              { id: 'call_1', type: 'function', function: { name: 'ls', arguments: '{}' } },
            ],
          },
          { role: 'tool', content: 'oops' },
        ],
      };
      try {
        validateOpenAiChatBody(body);
        throw new Error('expected throw');
      } catch (err) {
        expect(err).toBeInstanceOf(MalformedBodyError);
        expect((err as InstanceType<typeof MalformedBodyError>).code).toBe('missing_tool_call_id');
      }
    });

    it('throws orphaned_function_call_output when tool result references unknown id', () => {
      const body = {
        messages: [
          {
            role: 'assistant',
            tool_calls: [
              { id: 'call_1', type: 'function', function: { name: 'ls', arguments: '{}' } },
            ],
          },
          { role: 'tool', tool_call_id: 'call_999', content: 'ghost' },
        ],
      };
      try {
        validateOpenAiChatBody(body);
        throw new Error('expected throw');
      } catch (err) {
        expect(err).toBeInstanceOf(MalformedBodyError);
        expect((err as InstanceType<typeof MalformedBodyError>).code).toBe('orphaned_function_call_output');
      }
    });

    it('is a no-op when body has no messages array', () => {
      expect(() => validateOpenAiChatBody({})).not.toThrow();
      expect(() => validateOpenAiChatBody({ messages: 'not-an-array' })).not.toThrow();
    });
  });

  describe('OpenAI Responses API', () => {
    it('accepts a well-formed input[] with paired function_call + function_call_output', () => {
      const body = {
        input: [
          { type: 'message', role: 'user', content: 'ping' },
          { type: 'function_call', call_id: 'call_1', name: 'ping', arguments: '{}' },
          { type: 'function_call_output', call_id: 'call_1', output: 'pong' },
        ],
      };
      expect(() => validateOpenAiResponsesBody(body)).not.toThrow();
    });

    it('throws missing_call_id on function_call without call_id (#613 primary symptom)', () => {
      const body = {
        input: [
          { type: 'function_call', name: 'ls', arguments: '{}' },
        ],
      };
      try {
        validateOpenAiResponsesBody(body);
        throw new Error('expected throw');
      } catch (err) {
        expect(err).toBeInstanceOf(MalformedBodyError);
        expect((err as InstanceType<typeof MalformedBodyError>).code).toBe('missing_call_id');
      }
    });

    it('throws duplicate_tool_call_id on repeated call_id in function_calls', () => {
      const body = {
        input: [
          { type: 'function_call', call_id: 'call_1', name: 'ls', arguments: '{}' },
          { type: 'function_call', call_id: 'call_1', name: 'pwd', arguments: '{}' },
        ],
      };
      try {
        validateOpenAiResponsesBody(body);
        throw new Error('expected throw');
      } catch (err) {
        expect(err).toBeInstanceOf(MalformedBodyError);
        expect((err as InstanceType<typeof MalformedBodyError>).code).toBe('duplicate_tool_call_id');
      }
    });

    it('throws empty_tool_name on function_call with blank name', () => {
      const body = {
        input: [
          { type: 'function_call', call_id: 'call_1', name: '   ', arguments: '{}' },
        ],
      };
      try {
        validateOpenAiResponsesBody(body);
        throw new Error('expected throw');
      } catch (err) {
        expect(err).toBeInstanceOf(MalformedBodyError);
        expect((err as InstanceType<typeof MalformedBodyError>).code).toBe('empty_tool_name');
      }
    });

    it('throws orphaned_function_call_output when output references unknown call_id', () => {
      const body = {
        input: [
          { type: 'function_call', call_id: 'call_1', name: 'ls', arguments: '{}' },
          { type: 'function_call_output', call_id: 'call_999', output: 'ghost' },
        ],
      };
      try {
        validateOpenAiResponsesBody(body);
        throw new Error('expected throw');
      } catch (err) {
        expect(err).toBeInstanceOf(MalformedBodyError);
        expect((err as InstanceType<typeof MalformedBodyError>).code).toBe('orphaned_function_call_output');
      }
    });

    it('is a no-op when body has no input array', () => {
      expect(() => validateOpenAiResponsesBody({})).not.toThrow();
      expect(() => validateOpenAiResponsesBody({ input: 'not-an-array' })).not.toThrow();
    });
  });

  describe('MalformedBodyError', () => {
    it('carries code, detail, and adapter for telemetry', () => {
      try {
        validateOpenAiChatBody({
          messages: [{ role: 'tool', content: 'no id' }],
        });
        throw new Error('expected throw');
      } catch (err) {
        const e = err as InstanceType<typeof MalformedBodyError>;
        expect(e).toBeInstanceOf(MalformedBodyError);
        expect(e.code).toBe('missing_tool_call_id');
        expect(e.adapter).toBe('openai');
        expect(e.detail).toContain('messages[0]');
        expect(e.message).toContain('[openai]');
      }
    });
  });
});
