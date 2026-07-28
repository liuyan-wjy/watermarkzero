import test from 'node:test';
import assert from 'node:assert/strict';

import {
  createPageProcessBridgeClient,
  createPageProcessBridgeServer,
  installPageProcessBridge,
  PAGE_PROCESS_REQUEST,
  PAGE_PROCESS_RESPONSE
} from '../../src/userscript/pageProcessBridge.js';

function createMockWindow() {
  const listeners = new Set();
  const windowLike = {
    addEventListener(type, listener) {
      if (type !== 'message') return;
      listeners.add(listener);
    },
    removeEventListener(type, listener) {
      if (type !== 'message') return;
      listeners.delete(listener);
    },
    postMessage(message) {
      const event = {
        data: message,
        source: windowLike
      };
      for (const listener of [...listeners]) {
        listener(event);
      }
    }
  };
  return windowLike;
}

function createStructuredCloneWindow() {
  const listeners = new Set();
  const windowLike = {
    addEventListener(type, listener) {
      if (type !== 'message') return;
      listeners.add(listener);
    },
    removeEventListener(type, listener) {
      if (type !== 'message') return;
      listeners.delete(listener);
    },
    postMessage(message) {
      const clonedMessage = structuredClone(message);
      const event = {
        data: clonedMessage,
        source: windowLike
      };
      for (const listener of [...listeners]) {
        listener(event);
      }
    }
  };
  return windowLike;
}

test('createPageProcessBridgeServer should process watermark requests and reply with meta', async () => {
  const mockWindow = createMockWindow();
  installPageProcessBridge({
    targetWindow: mockWindow,
    logger: { warn() {} },
    processWatermarkBlob: async (blob) => ({
      processedBlob: new Blob([await blob.text() + '-page'], { type: 'image/png' }),
      processedMeta: { source: 'page-runtime' }
    }),
    removeWatermarkFromBlob: async () => {
      throw new Error('should not call remove path');
    }
  });

  const client = createPageProcessBridgeClient({
    targetWindow: mockWindow,
    logger: { warn() {} },
    fallbackProcessWatermarkBlob: async () => {
      throw new Error('should not fallback');
    },
    fallbackRemoveWatermarkFromBlob: async () => {
      throw new Error('should not fallback');
    }
  });

  const result = await client.processWatermarkBlob(new Blob(['raw'], { type: 'image/png' }));
  assert.equal(await result.processedBlob.text(), 'raw-page');
  assert.deepEqual(result.processedMeta, { source: 'page-runtime' });
});

test('createPageProcessBridgeClient should fall back locally when page runtime bridge times out', async () => {
  const isolatedWindow = {
    addEventListener() {},
    removeEventListener() {},
    postMessage(message) {
      assert.equal(message.type, PAGE_PROCESS_REQUEST);
    }
  };

  const client = createPageProcessBridgeClient({
    targetWindow: isolatedWindow,
    timeoutMs: 10,
    logger: { warn() {} },
    fallbackProcessWatermarkBlob: async (blob) => ({
      processedBlob: new Blob([await blob.text() + '-fallback'], { type: 'image/png' }),
      processedMeta: { source: 'fallback' }
    }),
    fallbackRemoveWatermarkFromBlob: async () => new Blob(['unused'], { type: 'image/png' })
  });

  const result = await client.processWatermarkBlob(new Blob(['raw'], { type: 'image/png' }));
  assert.equal(await result.processedBlob.text(), 'raw-fallback');
  assert.deepEqual(result.processedMeta, { source: 'fallback' });
});

test('createPageProcessBridgeServer should respond to remove-watermark requests', async () => {
  const bridgeMessages = [];
  const scopedWindow = {
    addEventListener(type, listener) {
      if (type !== 'message') return;
      this.listener = listener;
    },
    removeEventListener() {},
    postMessage(message) {
      bridgeMessages.push(message);
    }
  };

  const bridge = installPageProcessBridge({
    targetWindow: scopedWindow,
    logger: { warn() {} },
    processWatermarkBlob: async () => {
      throw new Error('should not call process path');
    },
    removeWatermarkFromBlob: async (blob) => new Blob([await blob.text() + '-page-done'], { type: 'image/png' })
  });

  const inputBuffer = await new Blob(['raw'], { type: 'image/png' }).arrayBuffer();
  await bridge.handler({
    source: scopedWindow,
    data: {
      type: PAGE_PROCESS_REQUEST,
      requestId: 'req-1',
      action: 'remove-watermark-blob',
      inputBuffer,
      mimeType: 'image/png',
      options: { adaptiveMode: 'never' }
    }
  });

  assert.equal(bridgeMessages.length, 1);
  assert.equal(bridgeMessages[0].type, PAGE_PROCESS_RESPONSE);
  assert.equal(bridgeMessages[0].requestId, 'req-1');
  const blob = new Blob([bridgeMessages[0].result.processedBuffer], {
    type: bridgeMessages[0].result.mimeType
  });
  assert.equal(await blob.text(), 'raw-page-done');
});

test('page process bridge should accept wrapped same-window sources across realms', async () => {
  const listeners = new Set();
  const mockWindow = {
    addEventListener(type, listener) {
      if (type !== 'message') return;
      listeners.add(listener);
    },
    removeEventListener(type, listener) {
      if (type !== 'message') return;
      listeners.delete(listener);
    },
    postMessage(message) {
      const event = {
        data: message,
        source: {
          window: mockWindow
        }
      };
      for (const listener of [...listeners]) {
        listener(event);
      }
    }
  };

  installPageProcessBridge({
    targetWindow: mockWindow,
    logger: { warn() {} },
    processWatermarkBlob: async (blob) => ({
      processedBlob: new Blob([await blob.text() + '-wrapped'], { type: 'image/png' }),
      processedMeta: { source: 'wrapped-window' }
    }),
    removeWatermarkFromBlob: async () => {
      throw new Error('should not call remove path');
    }
  });

  const client = createPageProcessBridgeClient({
    targetWindow: mockWindow,
    logger: { warn() {} },
    fallbackProcessWatermarkBlob: async () => {
      throw new Error('should not fallback');
    },
    fallbackRemoveWatermarkFromBlob: async () => {
      throw new Error('should not fallback');
    }
  });

  const result = await client.processWatermarkBlob(new Blob(['raw'], { type: 'image/png' }));
  assert.equal(await result.processedBlob.text(), 'raw-wrapped');
  assert.deepEqual(result.processedMeta, { source: 'wrapped-window' });
});

test('createPageProcessBridgeClient should sanitize actionContext before postMessage', async () => {
  const mockWindow = createStructuredCloneWindow();
  let seenOptions = null;

  installPageProcessBridge({
    targetWindow: mockWindow,
    logger: { warn() {} },
    processWatermarkBlob: async () => {
      throw new Error('should not call process path');
    },
    removeWatermarkFromBlob: async (blob, options = {}) => {
      seenOptions = options;
      return new Blob([await blob.text() + '-sanitized'], { type: 'image/png' });
    }
  });

  const client = createPageProcessBridgeClient({
    targetWindow: mockWindow,
    logger: { warn() {} },
    fallbackProcessWatermarkBlob: async () => {
      throw new Error('should not fallback');
    },
    fallbackRemoveWatermarkFromBlob: async () => new Blob(['fallback'], { type: 'image/png' })
  });

  const result = await client.removeWatermarkFromBlob(new Blob(['raw'], { type: 'image/png' }), {
    adaptiveMode: 'always',
    actionContext: {
      action: 'download',
      sessionKey: 'draft:rc_bridge_sanitize',
      assetIds: {
        responseId: 'r_bridge_sanitize',
        draftId: 'rc_bridge_sanitize',
        conversationId: 'c_bridge_sanitize'
      },
      target: {
        click() {}
      },
      imageElement: {
        remove() {}
      },
      resource: {
        kind: 'processed',
        url: 'blob:https://gemini.google.com/full-processed',
        mimeType: 'image/png',
        source: 'original-download',
        slot: 'full',
        blob: new Blob(['processed'], { type: 'image/png' }),
        processedMeta: {
          source: 'page-runtime'
        }
      }
    }
  });

  assert.equal(await result.text(), 'raw-sanitized');
  assert.deepEqual(seenOptions, {
    adaptiveMode: 'always',
    actionContext: {
      action: 'download',
      sessionKey: 'draft:rc_bridge_sanitize',
      assetIds: {
        responseId: 'r_bridge_sanitize',
        draftId: 'rc_bridge_sanitize',
        conversationId: 'c_bridge_sanitize'
      },
      resource: {
        kind: 'processed',
        url: 'blob:https://gemini.google.com/full-processed',
        mimeType: 'image/png',
        source: 'original-download',
        slot: 'full',
        processedMeta: {
          source: 'page-runtime'
        }
      }
    }
  });
});
