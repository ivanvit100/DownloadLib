import { describe, it, expect, vi, beforeEach } from 'vitest';

let EventBus;

beforeEach(async () => {
    const path = require.resolve('../../core/EventBus.js');
    delete require.cache[path];
    await import('../../core/EventBus.js');
    EventBus = global.EventBus;
});

describe('EventBus', () => {
    it('Registers and emits events', () => {
        const bus = new EventBus();
        const handler = vi.fn();
        bus.on('test', handler);
        bus.emit('test', 42);
        expect(handler).toHaveBeenCalledWith(42);
    });

    it('Removes event listener with off', () => {
        const bus = new EventBus();
        const handler = vi.fn();
        bus.on('test', handler);
        bus.off('test', handler);
        bus.emit('test', 1);
        expect(handler).not.toHaveBeenCalled();
    });

    it('Removes event listener with returned unsubscribe', () => {
        const bus = new EventBus();
        const handler = vi.fn();
        const unsubscribe = bus.on('test', handler);
        unsubscribe();
        bus.emit('test', 1);
        expect(handler).not.toHaveBeenCalled();
    });

    it('Once only fires once', () => {
        const bus = new EventBus();
        const handler = vi.fn();
        bus.once('test', handler);
        bus.emit('test', 'a');
        bus.emit('test', 'b');
        expect(handler).toHaveBeenCalledTimes(1);
        expect(handler).toHaveBeenCalledWith('a');
    });

    it('Clear removes all listeners for event', () => {
        const bus = new EventBus();
        const handler = vi.fn();
        bus.on('test', handler);
        bus.clear('test');
        bus.emit('test', 1);
        expect(handler).not.toHaveBeenCalled();
    });

    it('Clear without argument removes all listeners', () => {
        const bus = new EventBus();
        const handler1 = vi.fn();
        const handler2 = vi.fn();
        bus.on('a', handler1);
        bus.on('b', handler2);
        bus.clear();
        bus.emit('a', 1);
        bus.emit('b', 2);
        expect(handler1).not.toHaveBeenCalled();
        expect(handler2).not.toHaveBeenCalled();
    });

    it('Handles errors in listeners and logs them', () => {
        const bus = new EventBus();
        const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
        const badHandler = () => { throw new Error('fail'); };
        bus.on('err', badHandler);
        bus.emit('err', 123);
        expect(errorSpy).toHaveBeenCalledWith(
            '[EventBus] Error in listener for err:',
            expect.any(Error)
        );
        errorSpy.mockRestore();
    });

    it('Warns when adding a listener for an existing event', () => {
        const bus = new EventBus();
        const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
        const handler1 = vi.fn();
        const handler2 = vi.fn();
        bus.on('test', handler1);
        bus.on('test', handler2);
        expect(warnSpy).toHaveBeenCalledWith('[EventBus] Listener added for existing event: test');
        warnSpy.mockRestore();
    });

    it('Warns when removing a listener for a non-existent event', () => {
        const bus = new EventBus();
        const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
        const handler = vi.fn();
        bus.off('not_exist', handler);
        expect(warnSpy).toHaveBeenCalledWith('[EventBus] No listeners found for event: not_exist');
        warnSpy.mockRestore();
    });
});