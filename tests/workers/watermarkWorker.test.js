import test from 'node:test';
import assert from 'node:assert/strict';

test('watermark worker should respond to ping messages before image processing', async () => {
  const listeners = new Map();
  const messages = [];
  const originalSelf = globalThis.self;

  globalThis.self = {
    addEventListener(type, listener) {
      listeners.set(type, listener);
    },
    postMessage(payload) {
      messages.push(payload);
    }
  };

  try {
    const cacheBustUrl = new URL(`../../src/workers/watermarkWorker.js?ts=${Date.now()}`, import.meta.url);
    await import(cacheBustUrl.href);

    const messageHandler = listeners.get('message');
    assert.equal(typeof messageHandler, 'function');

    await messageHandler({
      data: {
        id: 'ping-1',
        type: 'ping'
      }
    });

    assert.deepEqual(messages, [{
      id: 'ping-1',
      ok: true,
      result: {
        ready: true
      }
    }]);
  } finally {
    globalThis.self = originalSelf;
  }
});
