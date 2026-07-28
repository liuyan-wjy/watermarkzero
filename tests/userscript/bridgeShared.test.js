import test from 'node:test';
import assert from 'node:assert/strict';

import {
  buildBlobBridgeResult,
  blobBridgeResultToPayload,
  createBlobBridgeResultFromResponse,
  createBridgeRequestId,
  installWindowMessageBridge
} from '../../src/userscript/bridgeShared.js';

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
    }
  };
  return windowLike;
}

test('buildBlobBridgeResult should preserve blob and meta', async () => {
  const blob = new Blob(['raw'], { type: 'image/png' });
  const result = buildBlobBridgeResult(blob, { source: 'test' });

  assert.equal(result.processedBlob, blob);
  assert.deepEqual(result.processedMeta, { source: 'test' });
});

test('blobBridgeResultToPayload should normalize bare blob responses', async () => {
  const payload = await blobBridgeResultToPayload(new Blob(['raw'], { type: 'image/png' }));

  const restoredBlob = new Blob([payload.processedBuffer], { type: payload.mimeType });
  assert.equal(await restoredBlob.text(), 'raw');
  assert.equal(payload.mimeType, 'image/png');
  assert.equal(payload.meta, null);
});

test('createBlobBridgeResultFromResponse should rebuild blob results from payload', async () => {
  const inputBlob = new Blob(['processed'], { type: 'image/png' });
  const payload = await blobBridgeResultToPayload({
    processedBlob: inputBlob,
    processedMeta: { source: 'page-runtime' }
  });

  const result = createBlobBridgeResultFromResponse(payload);

  assert.equal(await result.processedBlob.text(), 'processed');
  assert.deepEqual(result.processedMeta, { source: 'page-runtime' });
});

test('createBridgeRequestId should prefix generated ids', () => {
  const requestId = createBridgeRequestId('gwr-test');
  assert.match(requestId, /^gwr-test-\d+-[a-z0-9]+$/);
});

test('installWindowMessageBridge should install once and dispose cleanly', () => {
  const targetWindow = createMockWindow();
  let createHandlerCallCount = 0;

  const first = installWindowMessageBridge({
    targetWindow,
    bridgeFlag: '__testBridge__',
    createHandler() {
      createHandlerCallCount++;
      return () => {};
    }
  });
  const second = installWindowMessageBridge({
    targetWindow,
    bridgeFlag: '__testBridge__',
    createHandler() {
      throw new Error('should not create a second handler');
    }
  });

  assert.equal(first, second);
  assert.equal(createHandlerCallCount, 1);

  first.dispose();
  assert.equal(targetWindow.__testBridge__, undefined);
});
