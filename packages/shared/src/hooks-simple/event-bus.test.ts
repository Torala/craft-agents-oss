/**
 * Tests for WorkspaceEventBus
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { WorkspaceEventBus, type EventHandler, type AnyEventHandler } from './event-bus.ts';

describe('WorkspaceEventBus', () => {
  let bus: WorkspaceEventBus;

  beforeEach(() => {
    bus = new WorkspaceEventBus('test-workspace');
  });

  afterEach(() => {
    bus.dispose();
  });

  describe('constructor', () => {
    it('should create a bus with the given workspace ID', () => {
      expect(bus.getWorkspaceId()).toBe('test-workspace');
      expect(bus.isDisposed()).toBe(false);
    });
  });

  describe('emit', () => {
    it('should emit events to registered handlers', async () => {
      const handler = vi.fn();
      bus.on('LabelAdd', handler);

      await bus.emit('LabelAdd', {
        sessionId: 'session-1',
        workspaceId: 'test-workspace',
        timestamp: Date.now(),
        label: 'test-label',
      });

      expect(handler).toHaveBeenCalledTimes(1);
      expect(handler).toHaveBeenCalledWith(expect.objectContaining({
        label: 'test-label',
      }));
    });

    it('should emit to multiple handlers for the same event', async () => {
      const handler1 = vi.fn();
      const handler2 = vi.fn();
      bus.on('LabelAdd', handler1);
      bus.on('LabelAdd', handler2);

      await bus.emit('LabelAdd', {
        sessionId: 'session-1',
        workspaceId: 'test-workspace',
        timestamp: Date.now(),
        label: 'test-label',
      });

      expect(handler1).toHaveBeenCalledTimes(1);
      expect(handler2).toHaveBeenCalledTimes(1);
    });

    it('should not emit to handlers for different events', async () => {
      const labelHandler = vi.fn();
      const flagHandler = vi.fn();
      bus.on('LabelAdd', labelHandler);
      bus.on('FlagChange', flagHandler);

      await bus.emit('LabelAdd', {
        sessionId: 'session-1',
        workspaceId: 'test-workspace',
        timestamp: Date.now(),
        label: 'test-label',
      });

      expect(labelHandler).toHaveBeenCalledTimes(1);
      expect(flagHandler).not.toHaveBeenCalled();
    });

    it('should catch and log handler errors without stopping other handlers', async () => {
      const errorHandler = vi.fn().mockRejectedValue(new Error('Test error'));
      const successHandler = vi.fn();
      bus.on('LabelAdd', errorHandler);
      bus.on('LabelAdd', successHandler);

      // Should not throw
      await bus.emit('LabelAdd', {
        sessionId: 'session-1',
        workspaceId: 'test-workspace',
        timestamp: Date.now(),
        label: 'test-label',
      });

      expect(errorHandler).toHaveBeenCalledTimes(1);
      expect(successHandler).toHaveBeenCalledTimes(1);
    });

    it('should not emit after disposal', async () => {
      const handler = vi.fn();
      bus.on('LabelAdd', handler);
      bus.dispose();

      await bus.emit('LabelAdd', {
        sessionId: 'session-1',
        workspaceId: 'test-workspace',
        timestamp: Date.now(),
        label: 'test-label',
      });

      expect(handler).not.toHaveBeenCalled();
    });
  });

  describe('on/off', () => {
    it('should register handlers', () => {
      const handler = vi.fn();
      bus.on('LabelAdd', handler);
      expect(bus.getHandlerCount('LabelAdd')).toBe(1);
    });

    it('should unregister handlers', async () => {
      const handler = vi.fn();
      bus.on('LabelAdd', handler);
      bus.off('LabelAdd', handler);

      await bus.emit('LabelAdd', {
        sessionId: 'session-1',
        workspaceId: 'test-workspace',
        timestamp: Date.now(),
        label: 'test-label',
      });

      expect(handler).not.toHaveBeenCalled();
    });

    it('should not register handlers after disposal', () => {
      bus.dispose();
      const handler = vi.fn();
      bus.on('LabelAdd', handler);
      expect(bus.getHandlerCount('LabelAdd')).toBe(0);
    });
  });

  describe('onAny/offAny', () => {
    it('should receive all events', async () => {
      const anyHandler = vi.fn();
      bus.onAny(anyHandler);

      await bus.emit('LabelAdd', {
        sessionId: 'session-1',
        workspaceId: 'test-workspace',
        timestamp: Date.now(),
        label: 'test-label',
      });

      await bus.emit('FlagChange', {
        sessionId: 'session-1',
        workspaceId: 'test-workspace',
        timestamp: Date.now(),
        isFlagged: true,
      });

      expect(anyHandler).toHaveBeenCalledTimes(2);
      expect(anyHandler).toHaveBeenCalledWith('LabelAdd', expect.anything());
      expect(anyHandler).toHaveBeenCalledWith('FlagChange', expect.anything());
    });

    it('should unregister any-handlers', async () => {
      const anyHandler = vi.fn();
      bus.onAny(anyHandler);
      bus.offAny(anyHandler);

      await bus.emit('LabelAdd', {
        sessionId: 'session-1',
        workspaceId: 'test-workspace',
        timestamp: Date.now(),
        label: 'test-label',
      });

      expect(anyHandler).not.toHaveBeenCalled();
    });
  });

  describe('dispose', () => {
    it('should clear all handlers', () => {
      bus.on('LabelAdd', vi.fn());
      bus.on('FlagChange', vi.fn());
      bus.onAny(vi.fn());

      expect(bus.getHandlerCount()).toBeGreaterThan(0);

      bus.dispose();

      expect(bus.getHandlerCount()).toBe(0);
      expect(bus.isDisposed()).toBe(true);
    });

    it('should be idempotent', () => {
      bus.dispose();
      bus.dispose(); // Should not throw
      expect(bus.isDisposed()).toBe(true);
    });
  });

  describe('getHandlerCount', () => {
    it('should return count for specific event', () => {
      bus.on('LabelAdd', vi.fn());
      bus.on('LabelAdd', vi.fn());
      bus.on('FlagChange', vi.fn());

      expect(bus.getHandlerCount('LabelAdd')).toBe(2);
      expect(bus.getHandlerCount('FlagChange')).toBe(1);
      expect(bus.getHandlerCount('LabelRemove')).toBe(0);
    });

    it('should return total count without argument', () => {
      bus.on('LabelAdd', vi.fn());
      bus.on('FlagChange', vi.fn());
      bus.onAny(vi.fn());

      expect(bus.getHandlerCount()).toBe(3);
    });
  });
});
