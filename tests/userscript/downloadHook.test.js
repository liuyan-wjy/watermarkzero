import test from 'node:test';
import assert from 'node:assert/strict';

import {
  createGeminiDirectDownloadActionHandler,
  createGeminiDownloadFetchHook,
  createGeminiDownloadRpcFetchHook,
  installGeminiDownloadRpcXmlHttpRequestHook,
  createGeminiDownloadIntentGate,
  extractGeminiAssetIdsFromRpcRequestBody,
  extractGeminiAssetBindingsFromResponseText,
  extractGeminiGeneratedAssetUrlsFromResponseText,
  extractGeminiOriginalAssetUrlsFromResponseText,
  isGeminiDownloadRpcUrl,
  isGeminiDownloadActionTarget,
  installGeminiDownloadHook,
  resolveGeminiActionKind
} from '../../src/userscript/downloadHook.js';
import { isGeminiOriginalAssetUrl } from '../../src/userscript/urlUtils.js';

function createButtonLikeTarget(label = '下载完整尺寸的图片') {
  const button = {
    getAttribute(name) {
      if (name === 'aria-label') {
        return label;
      }
      return '';
    },
    innerText: '',
    textContent: '',
    closest(selector) {
      return /button/.test(selector) ? button : null;
    }
  };

  return {
    button,
    target: {
      closest(selector) {
        return /button/.test(selector) ? button : null;
      }
    }
  };
}

test('createGeminiDownloadFetchHook should delegate non-target requests untouched', async () => {
  const calls = [];
  const originalFetch = async (...args) => {
    calls.push(args);
    return new Response('plain', {
      status: 200,
      headers: { 'content-type': 'text/plain' }
    });
  };

  const hook = createGeminiDownloadFetchHook({
    originalFetch,
    isTargetUrl: () => false,
    normalizeUrl: (url) => `${url}?normalized`,
    processBlob: async () => {
      throw new Error('should not run');
    }
  });

  const response = await hook('https://example.com/file.txt');

  assert.equal(calls.length, 1);
  assert.equal(calls[0][0], 'https://example.com/file.txt');
  assert.equal(await response.text(), 'plain');
});

test('createGeminiDownloadFetchHook should normalize Gemini asset url and replace response body with processed blob', async () => {
  const seenUrls = [];
  const originalFetch = async (input) => {
    seenUrls.push(typeof input === 'string' ? input : input.url);
    return new Response(new Blob(['original'], { type: 'image/png' }), {
      status: 200,
      statusText: 'OK',
      headers: { 'content-type': 'image/png', 'x-source': 'origin' }
    });
  };

  const hook = createGeminiDownloadFetchHook({
    originalFetch,
    isTargetUrl: (url) => url.includes('googleusercontent.com'),
    normalizeUrl: () => 'https://lh3.googleusercontent.com/rd-gg/token=s0',
    processBlob: async (blob) => {
      assert.equal(await blob.text(), 'original');
      return new Blob(['processed'], { type: 'image/png' });
    }
  });

  const response = await hook('https://lh3.googleusercontent.com/rd-gg/token=s1024');

  assert.deepEqual(seenUrls, ['https://lh3.googleusercontent.com/rd-gg/token=s0']);
  assert.equal(await response.text(), 'processed');
  assert.equal(response.status, 200);
  assert.equal(response.statusText, 'OK');
  assert.equal(response.headers.get('x-source'), 'origin');
  assert.equal(response.headers.get('content-type'), 'image/png');
});

test('createGeminiDownloadFetchHook should pass a serializable processing context without the raw Response object', async () => {
  const originalFetch = async () => new Response(new Blob(['original'], { type: 'image/png' }), {
    status: 200,
    statusText: 'OK',
    headers: { 'content-type': 'image/png', 'x-source': 'origin' }
  });

  let seenContext = null;
  const hook = createGeminiDownloadFetchHook({
    originalFetch,
    isTargetUrl: () => true,
    normalizeUrl: () => 'https://lh3.googleusercontent.com/gg/token=s0-d-I?alr=yes',
    processBlob: async (_blob, context) => {
      seenContext = context;
      return new Blob(['processed'], { type: 'image/png' });
    }
  });

  await hook('https://lh3.googleusercontent.com/gg/token=d-I?alr=yes');

  assert.deepEqual(seenContext, {
    url: 'https://lh3.googleusercontent.com/gg/token=d-I?alr=yes',
    normalizedUrl: 'https://lh3.googleusercontent.com/gg/token=s0-d-I?alr=yes',
    responseStatus: 200,
    responseStatusText: 'OK',
    responseHeaders: {
      'content-type': 'image/png',
      'x-source': 'origin'
    }
  });
});

test('createGeminiDownloadFetchHook should bypass non-image Gemini responses', async () => {
  let processCalls = 0;
  const originalFetch = async () => new Response('https://lh3.google.com/rd-gg/token=s0-d-I?alr=yes', {
    status: 200,
    statusText: 'OK',
    headers: { 'content-type': 'text/plain; charset=UTF-8' }
  });

  const hook = createGeminiDownloadFetchHook({
    originalFetch,
    isTargetUrl: () => true,
    normalizeUrl: () => 'https://lh3.googleusercontent.com/gg/token=s0-d-I?alr=yes',
    processBlob: async () => {
      processCalls += 1;
      return new Blob(['processed'], { type: 'image/png' });
    }
  });

  const response = await hook('https://lh3.googleusercontent.com/gg/token=s0-d-I?alr=yes');

  assert.equal(processCalls, 0);
  assert.equal(response.headers.get('content-type'), 'text/plain; charset=UTF-8');
  assert.equal(await response.text(), 'https://lh3.google.com/rd-gg/token=s0-d-I?alr=yes');
});

test('createGeminiDownloadFetchHook should reject the request when processing fails', async () => {
  const originalFetch = async () => new Response(new Blob(['original'], { type: 'image/png' }), {
    status: 200,
    headers: { 'content-type': 'image/png' }
  });

  const hook = createGeminiDownloadFetchHook({
    originalFetch,
    isTargetUrl: () => true,
    normalizeUrl: (url) => url,
    logger: { warn() {} },
    processBlob: async () => {
      throw new Error('boom');
    }
  });

  await assert.rejects(
    hook('https://lh3.googleusercontent.com/rd-gg/token=s1024'),
    /boom/
  );
});

test('createGeminiDownloadFetchHook should fail open when processing fails and failOpenOnProcessingError is enabled', async () => {
  let notifiedFailure = false;
  const originalFetch = async () => new Response(new Blob(['preview-original'], { type: 'image/webp' }), {
    status: 200,
    headers: {
      'content-type': 'image/webp',
      'x-source': 'origin'
    }
  });

  const hook = createGeminiDownloadFetchHook({
    originalFetch,
    isTargetUrl: () => true,
    normalizeUrl: () => 'https://lh3.googleusercontent.com/gg/token=s0-rj',
    failOpenOnProcessingError: true,
    onActionCriticalFailure: async () => {
      notifiedFailure = true;
    },
    logger: { warn() {} },
    processBlob: async () => {
      throw new Error('preview-boom');
    }
  });

  const response = await hook('https://lh3.googleusercontent.com/gg/token=s1024-rj');

  assert.equal(await response.text(), 'preview-original');
  assert.equal(response.headers.get('content-type'), 'image/webp');
  assert.equal(response.headers.get('x-source'), 'origin');
  assert.equal(notifiedFailure, false);
});

test('createGeminiDownloadFetchHook should notify action-critical failures before rejecting', async () => {
  const originalFetch = async () => new Response(new Blob(['original'], { type: 'image/png' }), {
    status: 200,
    headers: { 'content-type': 'image/png' }
  });

  let seenPayload = null;
  const hook = createGeminiDownloadFetchHook({
    originalFetch,
    isTargetUrl: () => true,
    normalizeUrl: () => 'https://lh3.googleusercontent.com/rd-gg/token=s0',
    provideActionContext: () => ({
      action: 'download',
      sessionKey: 'draft:rc_download_failure_notice',
      assetIds: {
        draftId: 'rc_download_failure_notice'
      }
    }),
    onActionCriticalFailure: async (payload) => {
      seenPayload = {
        message: payload.error?.message || '',
        normalizedUrl: payload.normalizedUrl,
        sessionKey: payload.actionContext?.sessionKey
      };
    },
    logger: { warn() {} },
    processBlob: async () => {
      throw new Error('boom');
    }
  });

  await assert.rejects(
    hook('https://lh3.googleusercontent.com/rd-gg/token=s1024'),
    /boom/
  );
  assert.deepEqual(seenPayload, {
    message: 'boom',
    normalizedUrl: 'https://lh3.googleusercontent.com/rd-gg/token=s0',
    sessionKey: 'draft:rc_download_failure_notice'
  });
});

test('createGeminiDownloadFetchHook should notify when a processed full-quality blob is produced', async () => {
  const originalFetch = async () => new Response(new Blob(['original'], { type: 'image/png' }), {
    status: 200,
    headers: { 'content-type': 'image/png' }
  });

  let seenPayload = null;
  const hook = createGeminiDownloadFetchHook({
    originalFetch,
    isTargetUrl: () => true,
    normalizeUrl: () => 'https://lh3.googleusercontent.com/rd-gg/token=s0',
    provideActionContext: () => ({
      action: 'clipboard',
      sessionKey: 'draft:rc_clipboard_full',
      assetIds: {
        draftId: 'rc_clipboard_full'
      }
    }),
    onProcessedBlobResolved: async (payload) => {
      seenPayload = {
        ...payload,
        processedText: await payload.processedBlob.text()
      };
    },
    processBlob: async () => new Blob(['processed'], { type: 'image/png' })
  });

  const response = await hook('https://lh3.googleusercontent.com/rd-gg/token=s1024');

  assert.equal(await response.text(), 'processed');
  assert.deepEqual(seenPayload && {
    action: seenPayload.actionContext?.action,
    sessionKey: seenPayload.actionContext?.sessionKey,
    normalizedUrl: seenPayload.normalizedUrl,
    processedText: seenPayload.processedText
  }, {
    action: 'clipboard',
    sessionKey: 'draft:rc_clipboard_full',
    normalizedUrl: 'https://lh3.googleusercontent.com/rd-gg/token=s0',
    processedText: 'processed'
  });
});

test('createGeminiDownloadFetchHook should reprocess repeated normalized url requests after the in-flight cache settles', async () => {
  let processCount = 0;
  const originalFetch = async () => new Response(new Blob(['original'], { type: 'image/png' }), {
    status: 200,
    headers: { 'content-type': 'image/png' }
  });

  const hook = createGeminiDownloadFetchHook({
    originalFetch,
    isTargetUrl: () => true,
    normalizeUrl: () => 'https://lh3.googleusercontent.com/rd-gg/token=s0',
    processBlob: async () => {
      processCount += 1;
      return new Blob([`processed-${processCount}`], { type: 'image/png' });
    }
  });

  const first = await hook('https://lh3.googleusercontent.com/rd-gg/token=s1024');
  const second = await hook('https://lh3.googleusercontent.com/rd-gg/token=s512');

  assert.equal(await first.text(), 'processed-1');
  assert.equal(await second.text(), 'processed-2');
  assert.equal(processCount, 2);
});

test('createGeminiDownloadFetchHook should only keep in-flight cache entries and release them after success', async () => {
  let processCount = 0;
  let releaseProcessing = null;
  let notifyProcessingStarted = null;
  const processingStarted = new Promise((resolve) => {
    notifyProcessingStarted = resolve;
  });
  const cache = new Map();
  const originalFetch = async () => new Response(new Blob(['original'], { type: 'image/png' }), {
    status: 200,
    headers: { 'content-type': 'image/png' }
  });

  const hook = createGeminiDownloadFetchHook({
    originalFetch,
    cache,
    isTargetUrl: () => true,
    normalizeUrl: () => 'https://lh3.googleusercontent.com/rd-gg/token=s0',
    processBlob: async () => {
      processCount += 1;
      notifyProcessingStarted();
      await new Promise((resolve) => {
        releaseProcessing = resolve;
      });
      return new Blob([`processed-${processCount}`], { type: 'image/png' });
    }
  });

  const firstPromise = hook('https://lh3.googleusercontent.com/rd-gg/token=s1024');
  const secondPromise = hook('https://lh3.googleusercontent.com/rd-gg/token=s512');
  await processingStarted;

  releaseProcessing();

  const [first, second] = await Promise.all([firstPromise, secondPromise]);

  assert.equal(await first.text(), 'processed-1');
  assert.equal(await second.text(), 'processed-1');
  assert.equal(processCount, 1);
  assert.equal(cache.size, 0);
});

test('createGeminiDownloadFetchHook should bypass interception when gwr bypass flag is present', async () => {
  const calls = [];
  const originalFetch = async (...args) => {
    calls.push(args);
    return new Response('plain', {
      status: 200,
      headers: { 'content-type': 'text/plain' }
    });
  };

  const hook = createGeminiDownloadFetchHook({
    originalFetch,
    isTargetUrl: () => true,
    normalizeUrl: () => 'https://lh3.googleusercontent.com/rd-gg/token=s0',
    processBlob: async () => {
      throw new Error('should not run');
    }
  });

  const response = await hook('https://lh3.googleusercontent.com/rd-gg/token=s1024', {
    gwrBypass: true
  });

  assert.equal(await response.text(), 'plain');
  assert.equal(calls.length, 1);
});

test('createGeminiDownloadFetchHook should bypass Gemini preview fetches when only original/download assets are targeted', async () => {
  let processCalls = 0;
  const originalFetch = async (input) => {
    const url = typeof input === 'string' ? input : input?.url || '';
    return new Response(url, {
      status: 200,
      headers: { 'content-type': 'text/plain; charset=UTF-8' }
    });
  };

  const hook = createGeminiDownloadFetchHook({
    originalFetch,
    isTargetUrl: isGeminiOriginalAssetUrl,
    normalizeUrl: () => 'https://lh3.googleusercontent.com/gg/example-token=s0-rj?alr=yes',
    processBlob: async () => {
      processCalls += 1;
      return new Blob(['processed'], { type: 'image/png' });
    }
  });

  const response = await hook('https://lh3.googleusercontent.com/gg/example-token=s1024-rj?alr=yes');

  assert.equal(processCalls, 0);
  assert.equal(response.headers.get('content-type'), 'text/plain; charset=UTF-8');
  assert.equal(
    await response.text(),
    'https://lh3.googleusercontent.com/gg/example-token=s1024-rj?alr=yes'
  );
});

test('createGeminiDownloadFetchHook should process Gemini preview fetches when preview interception is enabled', async () => {
  const seenUrls = [];
  const hook = createGeminiDownloadFetchHook({
    originalFetch: async (input) => {
      seenUrls.push(typeof input === 'string' ? input : input.url);
      return new Response(new Blob(['preview-original'], { type: 'image/webp' }), {
        status: 200,
        headers: { 'content-type': 'image/webp' }
      });
    },
    isTargetUrl: (url) => url.includes('/gg/'),
    normalizeUrl: () => 'https://lh3.googleusercontent.com/gg/token=s0-rj',
    processBlob: async (blob, context) => {
      assert.equal(await blob.text(), 'preview-original');
      assert.equal(context.normalizedUrl, 'https://lh3.googleusercontent.com/gg/token=s0-rj');
      return new Blob(['preview-processed'], { type: 'image/png' });
    }
  });

  const response = await hook('https://lh3.googleusercontent.com/gg/token=s1024-rj');

  assert.deepEqual(seenUrls, ['https://lh3.googleusercontent.com/gg/token=s0-rj']);
  assert.equal(await response.text(), 'preview-processed');
  assert.equal(response.headers.get('content-type'), 'image/png');
});

test('isGeminiDownloadActionTarget should recognize copy and download buttons but ignore share actions', () => {
  assert.equal(isGeminiDownloadActionTarget({
    closest() {
      return {
        getAttribute(name) {
          return name === 'aria-label' ? '下载完整尺寸的图片' : '';
        },
        textContent: ''
      };
    }
  }), true);

  assert.equal(isGeminiDownloadActionTarget({
    closest() {
      return {
        getAttribute(name) {
          return name === 'aria-label' ? 'Copy image' : '';
        },
        textContent: ''
      };
    }
  }), true);

  assert.equal(isGeminiDownloadActionTarget({
    closest() {
      return {
        getAttribute(name) {
          return name === 'aria-label' ? '分享图片' : '';
        },
        textContent: ''
      };
    }
  }), false);
});

test('resolveGeminiActionKind should distinguish copy and download gestures from button labels', () => {
  assert.equal(resolveGeminiActionKind({
    closest() {
      return {
        getAttribute(name) {
          return name === 'aria-label' ? 'Copy image' : '';
        },
        textContent: ''
      };
    }
  }), 'clipboard');

  assert.equal(resolveGeminiActionKind({
    closest() {
      return {
        getAttribute(name) {
          return name === 'aria-label' ? '下载完整尺寸的图片' : '';
        },
        textContent: ''
      };
    }
  }), 'download');

  assert.equal(resolveGeminiActionKind({
    closest() {
      return {
        getAttribute(name) {
          return name === 'aria-label' ? '分享图片' : '';
        },
        textContent: ''
      };
    }
  }), '');
});

test('createGeminiDownloadIntentGate should arm only for explicit copy or download gestures', () => {
  let now = 100;
  const listeners = new Map();
  const targetWindow = {
    addEventListener(type, listener) {
      listeners.set(type, listener);
    },
    removeEventListener(type) {
      listeners.delete(type);
    }
  };

  const gate = createGeminiDownloadIntentGate({
    targetWindow,
    now: () => now,
    windowMs: 5000
  });

  listeners.get('click')?.({
    target: {
      closest() {
        return {
          getAttribute(name) {
            return name === 'aria-label' ? '分享图片' : '';
          },
          textContent: ''
        };
      }
    }
  });
  assert.equal(gate.hasRecentIntent(), false);

  listeners.get('click')?.({
    target: {
      closest() {
        return {
          getAttribute(name) {
            return name === 'aria-label' ? '复制图片' : '';
          },
          textContent: ''
        };
      }
    }
  });
  assert.equal(gate.hasRecentIntent(), true);

  now += 6000;
  assert.equal(gate.hasRecentIntent(), false);

  gate.dispose();
  assert.equal(listeners.size, 0);
});

test('createGeminiDownloadIntentGate should retain asset ids for the latest explicit download action context', () => {
  let now = 100;
  const listeners = new Map();
  const targetWindow = {
    addEventListener(type, listener) {
      listeners.set(type, listener);
    },
    removeEventListener(type) {
      listeners.delete(type);
    }
  };

  const gate = createGeminiDownloadIntentGate({
    targetWindow,
    now: () => now,
    windowMs: 5000,
    resolveActionContext: () => ({
      assetIds: {
        responseId: 'r_d7ef418292ede05c',
        draftId: 'rc_2315ec0b5621fce5',
        conversationId: 'c_cdec91057e5fdcaf'
      }
    })
  });

  listeners.get('click')?.({
    target: {
      closest() {
        return {
          getAttribute(name) {
            return name === 'aria-label' ? '下载完整尺寸的图片' : '';
          },
          textContent: ''
        };
      }
    }
  });

  assert.deepEqual(gate.getRecentActionContext(), {
    assetIds: {
      responseId: 'r_d7ef418292ede05c',
      draftId: 'rc_2315ec0b5621fce5',
      conversationId: 'c_cdec91057e5fdcaf'
    }
  });

  now += 6000;
  assert.equal(gate.getRecentActionContext(), null);
});

test('createGeminiDownloadIntentGate should retain session-scoped action context for the latest explicit download intent', () => {
  let now = 100;
  const listeners = new Map();
  const targetWindow = {
    addEventListener(type, listener) {
      listeners.set(type, listener);
    },
    removeEventListener(type) {
      listeners.delete(type);
    }
  };

  const gate = createGeminiDownloadIntentGate({
    targetWindow,
    now: () => now,
    windowMs: 5000,
    resolveActionContext: () => ({
      action: 'download',
      sessionKey: 'draft:rc_download_context',
      assetIds: {
        responseId: 'r_download_context',
        draftId: 'rc_download_context',
        conversationId: 'c_download_context'
      },
      resource: {
        kind: 'processed',
        url: 'blob:https://gemini.google.com/download-context-processed',
        mimeType: 'image/png',
        processedMeta: null,
        source: 'page-fetch'
      }
    })
  });

  listeners.get('click')?.({
    target: {
      closest() {
        return {
          getAttribute(name) {
            return name === 'aria-label' ? 'Download image' : '';
          },
          textContent: ''
        };
      }
    }
  });

  assert.deepEqual(gate.getRecentActionContext(), {
    action: 'download',
    sessionKey: 'draft:rc_download_context',
    assetIds: {
      responseId: 'r_download_context',
      draftId: 'rc_download_context',
      conversationId: 'c_download_context'
    },
    resource: {
      kind: 'processed',
      url: 'blob:https://gemini.google.com/download-context-processed',
      mimeType: 'image/png',
      processedMeta: null,
      source: 'page-fetch'
    }
  });
});

test('createGeminiDownloadIntentGate should refresh recent action context from the latest resolver state', () => {
  let now = 100;
  const listeners = new Map();
  const targetWindow = {
    addEventListener(type, listener) {
      listeners.set(type, listener);
    },
    removeEventListener(type) {
      listeners.delete(type);
    }
  };
  const refreshedFullBlob = new Blob(['full-refresh'], { type: 'image/png' });
  let latestActionContext = {
    action: 'download',
    sessionKey: 'draft:rc_refresh_context',
    assetIds: {
      responseId: 'r_refresh_context',
      draftId: 'rc_refresh_context',
      conversationId: 'c_refresh_context'
    },
    resource: {
      kind: 'processed',
      url: 'blob:https://gemini.google.com/refresh-preview',
      mimeType: 'image/png',
      processedMeta: null,
      source: 'preview-candidate',
      slot: 'preview'
    }
  };

  const gate = createGeminiDownloadIntentGate({
    targetWindow,
    now: () => now,
    windowMs: 5000,
    resolveActionContext: () => latestActionContext
  });

  listeners.get('click')?.({
    target: {
      closest() {
        return {
          getAttribute(name) {
            return name === 'aria-label' ? 'Download image' : '';
          },
          textContent: ''
        };
      }
    }
  });

  latestActionContext = {
    ...latestActionContext,
    resource: {
      kind: 'processed',
      url: 'blob:https://gemini.google.com/refresh-full',
      blob: refreshedFullBlob,
      mimeType: 'image/png',
      processedMeta: null,
      source: 'original-download',
      slot: 'full'
    }
  };

  assert.deepEqual(gate.getRecentActionContext(), latestActionContext);
});

test('createGeminiDownloadIntentGate should support resolveActionContext as the primary resolver name', () => {
  let now = 100;
  const listeners = new Map();
  const targetWindow = {
    addEventListener(type, listener) {
      listeners.set(type, listener);
    },
    removeEventListener(type) {
      listeners.delete(type);
    }
  };

  const gate = createGeminiDownloadIntentGate({
    targetWindow,
    now: () => now,
    windowMs: 5000,
    resolveActionContext: () => ({
      action: 'download',
      sessionKey: 'draft:rc_action_context_alias',
      assetIds: {
        responseId: 'r_action_context_alias',
        draftId: 'rc_action_context_alias',
        conversationId: 'c_action_context_alias'
      }
    })
  });

  listeners.get('click')?.({
    target: {
      closest() {
        return {
          getAttribute(name) {
            return name === 'aria-label' ? 'Download image' : '';
          },
          textContent: ''
        };
      }
    }
  });

  assert.deepEqual(gate.getRecentActionContext(), {
    action: 'download',
    sessionKey: 'draft:rc_action_context_alias',
    assetIds: {
      responseId: 'r_action_context_alias',
      draftId: 'rc_action_context_alias',
      conversationId: 'c_action_context_alias'
    }
  });
});

test('createGeminiDownloadIntentGate should retain explicit download intent for Gemini download asset urls beyond the base window', () => {
  let now = 100;
  const listeners = new Map();
  const actionContext = {
    action: 'download',
    sessionKey: 'draft:rc_sticky_download_window',
    assetIds: {
      responseId: 'r_sticky_download_window',
      draftId: 'rc_sticky_download_window',
      conversationId: 'c_sticky_download_window'
    }
  };
  const targetWindow = {
    addEventListener(type, listener) {
      listeners.set(type, listener);
    },
    removeEventListener(type) {
      listeners.delete(type);
    }
  };

  const gate = createGeminiDownloadIntentGate({
    targetWindow,
    now: () => now,
    windowMs: 5000,
    resolveActionContext: () => actionContext
  });

  listeners.get('click')?.({
    target: {
      closest() {
        return {
          getAttribute(name) {
            return name === 'aria-label' ? '下载完整尺寸的图片' : '';
          },
          textContent: ''
        };
      }
    }
  });

  now += 6000;

  assert.equal(gate.hasRecentIntent(), false);
  assert.equal(
    gate.hasRecentIntent({
      url: 'https://lh3.googleusercontent.com/rd-gg-dl/token=s0-d-I?authuser=1&alr=yes'
    }),
    true
  );
  assert.deepEqual(
    gate.getRecentActionContext({
      url: 'https://lh3.googleusercontent.com/rd-gg-dl/token=s0-d-I?authuser=1&alr=yes'
    }),
    actionContext
  );
  assert.equal(
    gate.hasRecentIntent({
      url: 'https://lh3.googleusercontent.com/rd-gg/token=s0-rj?authuser=1&alr=yes'
    }),
    false
  );
});

test('createGeminiDownloadIntentGate should expose getRecentActionContext as the primary accessor', () => {
  let now = 100;
  const listeners = new Map();
  const targetWindow = {
    addEventListener(type, listener) {
      listeners.set(type, listener);
    },
    removeEventListener(type) {
      listeners.delete(type);
    }
  };

  const gate = createGeminiDownloadIntentGate({
    targetWindow,
    now: () => now,
    windowMs: 5000,
    resolveActionContext: () => ({
      action: 'clipboard',
      sessionKey: 'draft:rc_recent_action_context',
      assetIds: {
        responseId: 'r_recent_action_context',
        draftId: 'rc_recent_action_context',
        conversationId: 'c_recent_action_context'
      }
    })
  });

  listeners.get('click')?.({
    target: {
      closest() {
        return {
          getAttribute(name) {
            return name === 'aria-label' ? 'Copy image' : '';
          },
          textContent: ''
        };
      }
    }
  });

  assert.deepEqual(gate.getRecentActionContext(), {
    action: 'clipboard',
    sessionKey: 'draft:rc_recent_action_context',
    assetIds: {
      responseId: 'r_recent_action_context',
      draftId: 'rc_recent_action_context',
      conversationId: 'c_recent_action_context'
    }
  });
});

test('createGeminiDownloadFetchHook should bypass targeted Gemini asset requests until a processing intent is armed', async () => {
  const seenUrls = [];
  let processCalls = 0;
  let allowProcessing = false;
  const originalFetch = async (input) => {
    const url = typeof input === 'string' ? input : input?.url || '';
    seenUrls.push(url);
    return new Response(new Blob(['original'], { type: 'image/png' }), {
      status: 200,
      headers: { 'content-type': 'image/png' }
    });
  };

  const hook = createGeminiDownloadFetchHook({
    originalFetch,
    isTargetUrl: isGeminiOriginalAssetUrl,
    normalizeUrl: () => 'https://lh3.googleusercontent.com/rd-gg/token=s0',
    shouldProcessRequest: () => allowProcessing,
    processBlob: async () => {
      processCalls += 1;
      return new Blob(['processed'], { type: 'image/png' });
    }
  });

  const bypassed = await hook('https://lh3.googleusercontent.com/rd-gg/token=s1024');
  assert.equal(await bypassed.text(), 'original');
  assert.equal(processCalls, 0);
  assert.deepEqual(seenUrls, ['https://lh3.googleusercontent.com/rd-gg/token=s1024']);

  allowProcessing = true;
  const processed = await hook('https://lh3.googleusercontent.com/rd-gg/token=s1024');
  assert.equal(await processed.text(), 'processed');
  assert.equal(processCalls, 1);
  assert.deepEqual(seenUrls, [
    'https://lh3.googleusercontent.com/rd-gg/token=s1024',
    'https://lh3.googleusercontent.com/rd-gg/token=s0'
  ]);
});

test('installGeminiDownloadHook should keep processing Gemini download asset requests after the base intent window for explicit download actions', async () => {
  let now = 100;
  const listeners = new Map();
  let processCalls = 0;
  const targetWindow = {
    fetch: async () => new Response(new Blob(['original'], { type: 'image/png' }), {
      status: 200,
      headers: { 'content-type': 'image/png' }
    }),
    addEventListener(type, listener) {
      listeners.set(type, listener);
    },
    removeEventListener(type) {
      listeners.delete(type);
    }
  };
  const intentGate = createGeminiDownloadIntentGate({
    targetWindow,
    now: () => now,
    windowMs: 5000,
    resolveActionContext: () => ({
      action: 'download',
      sessionKey: 'draft:rc_install_sticky_download_window',
      assetIds: {
        responseId: 'r_install_sticky_download_window',
        draftId: 'rc_install_sticky_download_window',
        conversationId: 'c_install_sticky_download_window'
      }
    })
  });

  installGeminiDownloadHook(targetWindow, {
    intentGate,
    originalFetch: targetWindow.fetch,
    isTargetUrl: isGeminiOriginalAssetUrl,
    normalizeUrl: () => 'https://lh3.googleusercontent.com/rd-gg-dl/token=s0-d-I',
    processBlob: async () => {
      processCalls += 1;
      return new Blob(['processed'], { type: 'image/png' });
    }
  });

  listeners.get('click')?.({
    target: {
      closest() {
        return {
          getAttribute(name) {
            return name === 'aria-label' ? 'Download image' : '';
          },
          textContent: ''
        };
      }
    }
  });

  now += 6000;

  const response = await targetWindow.fetch('https://lh3.googleusercontent.com/rd-gg-dl/token=s1024-d-I');

  assert.equal(await response.text(), 'processed');
  assert.equal(processCalls, 1);
});

test('isGeminiDownloadRpcUrl should only match Gemini batchexecute download rpc requests', () => {
  assert.equal(
    isGeminiDownloadRpcUrl('https://gemini.google.com/_/BardChatUi/data/batchexecute?rpcids=c8o8Fe&rt=c'),
    true
  );
  assert.equal(
    isGeminiDownloadRpcUrl('https://gemini.google.com/_/BardChatUi/data/batchexecute?rpcids=ESY5D&rt=c'),
    false
  );
  assert.equal(
    isGeminiDownloadRpcUrl('https://example.com/_/BardChatUi/data/batchexecute?rpcids=c8o8Fe&rt=c'),
    false
  );
});

test('extractGeminiOriginalAssetUrlsFromResponseText should recover googleusercontent original asset urls from escaped rpc payloads', () => {
  const responseText = ')]}\'\n123\n[["wrb.fr","c8o8Fe","[null,\\\"https:\\\\/\\\\/lh3.googleusercontent.com\\\\/rd-gg-dl\\\\/token=s1024-rj?foo=1\\\",\\\"https:\\\\/\\\\/lh3.googleusercontent.com\\\\/rd-gg-dl\\\\/token=s1024-rj?foo=1\\\"]",null,null,null,"generic"]]';

  assert.deepEqual(extractGeminiOriginalAssetUrlsFromResponseText(responseText), [
    'https://lh3.googleusercontent.com/rd-gg-dl/token=s0-rj?foo=1'
  ]);
});

test('extractGeminiGeneratedAssetUrlsFromResponseText should recover normalized Gemini preview asset urls from escaped rpc payloads', () => {
  const responseText = ')]}\'\n123\n[["wrb.fr","hNvQHb","[[[[\\\"c_cdec91057e5fdcaf\\\",\\\"r_d7ef418292ede05c\\\",\\\"rc_2315ec0b5621fce5\\\"],[[[\\\"rc_1dfd19ae1152c42a\\\",[\\\"http://googleusercontent.com/image_generation_content/1\\\"],[null,null,null,null,[null,null,8]],null,null,null,null,null,[2],\\\"und\\\",null,null,[null,null,null,null,null,null,[3],[[[[null,null,null,[null,1,\\\"2399453241942556798.png\\\",\\\"https:\\\\/\\\\/lh3.googleusercontent.com\\\\/gg\\\\/AMW1TPruenvvhqGkK0ivNZat8rOQAWX2D9MYOb3rnxDwPU2y0V9oAp2bsFbJaGpRuuRsL19W2GwrpLRLqs5NydfTKFgw1rS01x9Kw8LtVbLdozlk8xgDCA2JiQ2Zs-12nq3o1OoxCKkT2LDl0lstjozOVQLHVtPA3kTduYB8-vwLSw3mWY0EkGE6RaL5_-8nRGZKXMmfpfjKRwLeFBv129SAVZKrV_cd9vypDV_Kqf7RZv4cvvuS8iOdfgEVvBHfoPQ268hode9yEG4uafOs_cCKU_vrcI2Bv06Yu3zTjLn1YxHVbUzXbKKsywKxtNeiCvlpvoxgeIlF8x_GgMAWinNf46vQ\\\"]]]]]]]]]",null,null,null,"generic"]]';

  assert.deepEqual(extractGeminiGeneratedAssetUrlsFromResponseText(responseText), [
    'https://lh3.googleusercontent.com/gg/AMW1TPruenvvhqGkK0ivNZat8rOQAWX2D9MYOb3rnxDwPU2y0V9oAp2bsFbJaGpRuuRsL19W2GwrpLRLqs5NydfTKFgw1rS01x9Kw8LtVbLdozlk8xgDCA2JiQ2Zs-12nq3o1OoxCKkT2LDl0lstjozOVQLHVtPA3kTduYB8-vwLSw3mWY0EkGE6RaL5_-8nRGZKXMmfpfjKRwLeFBv129SAVZKrV_cd9vypDV_Kqf7RZv4cvvuS8iOdfgEVvBHfoPQ268hode9yEG4uafOs_cCKU_vrcI2Bv06Yu3zTjLn1YxHVbUzXbKKsywKxtNeiCvlpvoxgeIlF8x_GgMAWinNf46vQ=s0'
  ]);
});

test('extractGeminiAssetIdsFromRpcRequestBody should recover response draft and conversation ids from encoded batchexecute payload', () => {
  const requestBody = 'f.req=%5Bnull%2C%22%5Bnull%2C%5B%5C%22image_generation_content%5C%22%2C0%2C%5C%22r_d7ef418292ede05c%5C%22%2C%5C%22rc_2315ec0b5621fce5%5C%22%2C%5C%22c_cdec91057e5fdcaf%5C%22%5D%5D%22%5D&at=abc';

  assert.deepEqual(extractGeminiAssetIdsFromRpcRequestBody(requestBody), {
    responseId: 'r_d7ef418292ede05c',
    draftId: 'rc_2315ec0b5621fce5',
    conversationId: 'c_cdec91057e5fdcaf'
  });
});

test('extractGeminiAssetBindingsFromResponseText should pair response asset ids with discovered Gemini asset urls', () => {
  const responseText = ')]}\'\n123\n[["wrb.fr","hNvQHb","[[[[\\\"c_cdec91057e5fdcaf\\\",\\\"r_d7ef418292ede05c\\\",\\\"rc_2315ec0b5621fce5\\\"],[[[\\\"rc_1dfd19ae1152c42a\\\",[\\\"http://googleusercontent.com/image_generation_content/1\\\"],[null,null,null,null,[null,null,8]],null,null,null,null,null,[2],\\\"und\\\",null,null,[null,null,null,null,null,null,[3],[[[[null,null,null,[null,1,\\\"2399453241942556798.png\\\",\\\"https:\\\\/\\\\/lh3.googleusercontent.com\\\\/gg\\\\/AMW1TPruenvvhqGkK0ivNZat8rOQAWX2D9MYOb3rnxDwPU2y0V9oAp2bsFbJaGpRuuRsL19W2GwrpLRLqs5NydfTKFgw1rS01x9Kw8LtVbLdozlk8xgDCA2JiQ2Zs-12nq3o1OoxCKkT2LDl0lstjozOVQLHVtPA3kTduYB8-vwLSw3mWY0EkGE6RaL5_-8nRGZKXMmfpfjKRwLeFBv129SAVZKrV_cd9vypDV_Kqf7RZv4cvvuS8iOdfgEVvBHfoPQ268hode9yEG4uafOs_cCKU_vrcI2Bv06Yu3zTjLn1YxHVbUzXbKKsywKxtNeiCvlpvoxgeIlF8x_GgMAWinNf46vQ\\\"]]]]]]]]]",null,null,null,"generic"]]';

  assert.deepEqual(extractGeminiAssetBindingsFromResponseText(responseText), [{
    discoveredUrl: 'https://lh3.googleusercontent.com/gg/AMW1TPruenvvhqGkK0ivNZat8rOQAWX2D9MYOb3rnxDwPU2y0V9oAp2bsFbJaGpRuuRsL19W2GwrpLRLqs5NydfTKFgw1rS01x9Kw8LtVbLdozlk8xgDCA2JiQ2Zs-12nq3o1OoxCKkT2LDl0lstjozOVQLHVtPA3kTduYB8-vwLSw3mWY0EkGE6RaL5_-8nRGZKXMmfpfjKRwLeFBv129SAVZKrV_cd9vypDV_Kqf7RZv4cvvuS8iOdfgEVvBHfoPQ268hode9yEG4uafOs_cCKU_vrcI2Bv06Yu3zTjLn1YxHVbUzXbKKsywKxtNeiCvlpvoxgeIlF8x_GgMAWinNf46vQ=s0',
    assetIds: {
      responseId: 'r_d7ef418292ede05c',
      draftId: 'rc_2315ec0b5621fce5',
      conversationId: 'c_cdec91057e5fdcaf'
    }
  }]);
});

test('extractGeminiAssetBindingsFromResponseText should still recover a usable binding when history tuples and content blocks are offset', () => {
  const responseText = ')]}\'\n123\n[["wrb.fr","hNvQHb","[[[[\\\"c_cdec91057e5fdcaf\\\",\\\"r_134f73283381ab82\\\",\\\"rc_e48e309fb05102e2\\\"],[\\\"c_cdec91057e5fdcaf\\\",\\\"r_8564c2370ec24b62\\\",\\\"rc_1dfd19ae1152c42a\\\"],[[\\\"性感，白皙，清纯\\\"],1,null,0,\\\"fbb127bbb056c959\\\",0,14,null,false,null,[]],[[[\\\"rc_e48e309fb05102e2\\\",[\\\"http://googleusercontent.com/image_generation_content/2\\\"],[null,null,null,null,[null,null,8]],null,null,null,null,null,[2],\\\"und\\\",null,null,[null,null,null,null,null,null,[3],[[[[null,null,null,[null,1,\\\"8289315647847911722.png\\\",\\\"https:\\\\/\\\\/lh3.googleusercontent.com\\\\/gg\\\\/AMW1TPoUzF0DJQYiXY7_Zpzxr1R77yq-C47kmFP35SHjv1jiPds5Sim4iy_N2Hho7mEicd7kf5vfjCCjCpn1c7IbqVbvkahV2G3Ciea0Z50SIDu_uL0JWCqI5OQRUZQnP99am2fIo41kPSPjQxRl7N_nVKHrtSn6Tgks6pBGfguzfdBfFTTrhsLJXMfC3ZehqcPKBj7X3yhgthbJCBMqo7VuqGkNNMaUawRdqEKGD0AXksBQN6FBSj1cy8sHPyApHK-XLMmQnb3BNwsayLUetPB3gkaw-qY-qTmjaN_zXHeJzW4_3YvB1aQ5hO-33kmP896VfyWQLiWeuInMem2cooiP54zt\\\"]]]]]]]]]",null,null,null,"generic"]]';

  assert.deepEqual(extractGeminiAssetBindingsFromResponseText(responseText), [{
    discoveredUrl: 'https://lh3.googleusercontent.com/gg/AMW1TPoUzF0DJQYiXY7_Zpzxr1R77yq-C47kmFP35SHjv1jiPds5Sim4iy_N2Hho7mEicd7kf5vfjCCjCpn1c7IbqVbvkahV2G3Ciea0Z50SIDu_uL0JWCqI5OQRUZQnP99am2fIo41kPSPjQxRl7N_nVKHrtSn6Tgks6pBGfguzfdBfFTTrhsLJXMfC3ZehqcPKBj7X3yhgthbJCBMqo7VuqGkNNMaUawRdqEKGD0AXksBQN6FBSj1cy8sHPyApHK-XLMmQnb3BNwsayLUetPB3gkaw-qY-qTmjaN_zXHeJzW4_3YvB1aQ5hO-33kmP896VfyWQLiWeuInMem2cooiP54zt=s0',
    assetIds: {
      responseId: 'r_8564c2370ec24b62',
      draftId: 'rc_1dfd19ae1152c42a',
      conversationId: 'c_cdec91057e5fdcaf'
    }
  }]);
});

test('extractGeminiAssetBindingsFromResponseText should align response order with later draft blocks when the first history tuple has no draft id', () => {
  const historyPayload = [[
    ['c_cdec91057e5fdcaf', 'r_8a95cf3da7dcab7d'],
    ['c_cdec91057e5fdcaf', 'r_19c04baf39a68931', 'rc_45d85da14e2d5ef4'],
    [['我喜欢少女'], 1, null, 0, 'fbb127bbb056c959', 0, 14, null, false, null, []],
    [[[
      'rc_33808c0f8008f500',
      ['http://googleusercontent.com/image_generation_content/4'],
      [null, null, null, null, [null, null, 8]],
      null,
      null,
      null,
      null,
      null,
      [2],
      'und',
      null,
      null,
      [
        null,
        null,
        null,
        null,
        null,
        null,
        [3],
        [[[[null, null, null, [
          null,
          1,
          '9531565739231490508.png',
          'https://lh3.googleusercontent.com/gg/AMW1TPp-e0_45VrFA-EWdr1L6KKaMyKsAQiBnonsEgxm1XhMhnARJhL8mCtxfBYwk3mR1qgy4IakOTXBaGRO_WIi28IMKmqJXLDz09jgfAa7XOD45TFp4q5kkbj'
        ]]]]]
      ]
    ]]]
  ]];
  const responseText = `)]}'\n123\n${JSON.stringify([['wrb.fr', 'hNvQHb', JSON.stringify(historyPayload), null, null, null, 'generic']])}`;

  assert.deepEqual(extractGeminiAssetBindingsFromResponseText(responseText), [{
    discoveredUrl: 'https://lh3.googleusercontent.com/gg/AMW1TPp-e0_45VrFA-EWdr1L6KKaMyKsAQiBnonsEgxm1XhMhnARJhL8mCtxfBYwk3mR1qgy4IakOTXBaGRO_WIi28IMKmqJXLDz09jgfAa7XOD45TFp4q5kkbj=s0',
    assetIds: {
      responseId: 'r_8a95cf3da7dcab7d',
      draftId: 'rc_33808c0f8008f500',
      conversationId: 'c_cdec91057e5fdcaf'
    }
  }]);
});

test('extractGeminiAssetBindingsFromResponseText should prefer parsed draft-id matches when later history tuples complete the response binding', () => {
  const historyPayload = [[
    ['c_d3cd7d14852ecd3b', 'r_ecd789e187b4c4b2'],
    ['c_d3cd7d14852ecd3b', 'r_35365858287e3a62', 'rc_5f608bd973202fb4'],
    ['c_d3cd7d14852ecd3b', 'r_9c04fbd9e3211afa', 'rc_acb9ecbca3658e44'],
    [['ignored metadata'], 1, null, 0, 'debug', 0, 14, null, false, null, []],
    [[[
      'rc_5f608bd973202fb4',
      ['http://googleusercontent.com/image_generation_content/1'],
      [null, null, null, null, [null, null, 8]],
      null,
      null,
      null,
      null,
      null,
      [2],
      'und',
      null,
      null,
      [null, null, null, null, null, null, [3], [[[[null, null, null, [
        null,
        1,
        'first.png',
        'https://lh3.googleusercontent.com/gg/AMW1TP-example-first'
      ]]]]]]
    ]]],
    [[[
      'rc_acb9ecbca3658e44',
      ['http://googleusercontent.com/image_generation_content/2'],
      [null, null, null, null, [null, null, 8]],
      null,
      null,
      null,
      null,
      null,
      [2],
      'und',
      null,
      null,
      [null, null, null, null, null, null, [3], [[[[null, null, null, [
        null,
        1,
        'second.png',
        'https://lh3.googleusercontent.com/gg/AMW1TP-example-second'
      ]]]]]]
    ]]],
    [[[
      'rc_4612c87a713bcafa',
      ['http://googleusercontent.com/image_generation_content/3'],
      [null, null, null, null, [null, null, 8]],
      null,
      null,
      null,
      null,
      null,
      [2],
      'und',
      null,
      null,
      [null, null, null, null, null, null, [3], [[[[null, null, null, [
        null,
        1,
        'third.png',
        'https://lh3.googleusercontent.com/gg/AMW1TP-example-third'
      ]]]]]]
    ]]],
    ['c_d3cd7d14852ecd3b', 'r_ecd789e187b4c4b2', 'rc_4612c87a713bcafa']
  ]];
  const responseText = `)]}'\n123\n${JSON.stringify([['wrb.fr', 'hNvQHb', JSON.stringify(historyPayload), null, null, null, 'generic']])}`;

  assert.deepEqual(extractGeminiAssetBindingsFromResponseText(responseText), [{
    discoveredUrl: 'https://lh3.googleusercontent.com/gg/AMW1TP-example-first=s0',
    assetIds: {
      responseId: 'r_35365858287e3a62',
      draftId: 'rc_5f608bd973202fb4',
      conversationId: 'c_d3cd7d14852ecd3b'
    }
  }, {
    discoveredUrl: 'https://lh3.googleusercontent.com/gg/AMW1TP-example-second=s0',
    assetIds: {
      responseId: 'r_9c04fbd9e3211afa',
      draftId: 'rc_acb9ecbca3658e44',
      conversationId: 'c_d3cd7d14852ecd3b'
    }
  }, {
    discoveredUrl: 'https://lh3.googleusercontent.com/gg/AMW1TP-example-third=s0',
    assetIds: {
      responseId: 'r_ecd789e187b4c4b2',
      draftId: 'rc_4612c87a713bcafa',
      conversationId: 'c_d3cd7d14852ecd3b'
    }
  }]);
});

test('extractGeminiAssetBindingsFromResponseText should bind preview urls that live outside draft blocks to the leading response tuple and trailing draft id of each parsed history segment', () => {
  const historyPayload = [[
    [
      ['c_d3cd7d14852ecd3b', 'r_ecd789e187b4c4b2'],
      ['c_d3cd7d14852ecd3b', 'r_35365858287e3a62', 'rc_5f608bd973202fb4'],
      ['metadata', 'https://lh3.googleusercontent.com/gg/AMW1TP-actual-shape-a'],
      [[['rc_4612c87a713bcafa', ['http://googleusercontent.com/image_generation_content/2']]]]
    ],
    [
      ['c_d3cd7d14852ecd3b', 'r_35365858287e3a62'],
      ['c_d3cd7d14852ecd3b', 'r_9c04fbd9e3211afa', 'rc_acb9ecbca3658e44'],
      ['metadata', 'https://lh3.googleusercontent.com/gg/AMW1TP-actual-shape-b'],
      [[['rc_5f608bd973202fb4', ['http://googleusercontent.com/image_generation_content/3']]]]
    ],
    [
      ['c_d3cd7d14852ecd3b', 'r_9c04fbd9e3211afa'],
      ['metadata', 'https://lh3.googleusercontent.com/gg/AMW1TP-actual-shape-c'],
      [[['rc_acb9ecbca3658e44', ['http://googleusercontent.com/image_generation_content/4']]]]
    ]
  ]];
  const responseText = `)]}'\n123\n${JSON.stringify([['wrb.fr', 'hNvQHb', JSON.stringify(historyPayload), null, null, null, 'generic']])}`;

  assert.deepEqual(extractGeminiAssetBindingsFromResponseText(responseText), [{
    discoveredUrl: 'https://lh3.googleusercontent.com/gg/AMW1TP-actual-shape-a=s0',
    assetIds: {
      responseId: 'r_ecd789e187b4c4b2',
      draftId: 'rc_4612c87a713bcafa',
      conversationId: 'c_d3cd7d14852ecd3b'
    }
  }, {
    discoveredUrl: 'https://lh3.googleusercontent.com/gg/AMW1TP-actual-shape-b=s0',
    assetIds: {
      responseId: 'r_35365858287e3a62',
      draftId: 'rc_5f608bd973202fb4',
      conversationId: 'c_d3cd7d14852ecd3b'
    }
  }, {
    discoveredUrl: 'https://lh3.googleusercontent.com/gg/AMW1TP-actual-shape-c=s0',
    assetIds: {
      responseId: 'r_9c04fbd9e3211afa',
      draftId: 'rc_acb9ecbca3658e44',
      conversationId: 'c_d3cd7d14852ecd3b'
    }
  }]);
});

test('extractGeminiAssetBindingsFromResponseText should reserve explicit draft ids for their owning response tuple before pairing earlier tuples', () => {
  const historyPayload = [[
    ['c_cdec91057e5fdcaf', 'r_early_response'],
    ['c_cdec91057e5fdcaf', 'r_late_response', 'rc_late_owned'],
    [[[
      'rc_late_owned',
      ['http://googleusercontent.com/image_generation_content/4'],
      [null, null, null, null, [null, null, 8]],
      null,
      null,
      null,
      null,
      null,
      [2],
      'und',
      null,
      null,
      [
        null,
        null,
        null,
        null,
        null,
        null,
        [3],
        [[[[null, null, null, [
          null,
          1,
          'late.png',
          'https://lh3.googleusercontent.com/gg/AMW1TPlatelateOwnedUrl'
        ]]]]]
      ]
    ]]],
    [[[
      'rc_early_missing',
      ['http://googleusercontent.com/image_generation_content/4'],
      [null, null, null, null, [null, null, 8]],
      null,
      null,
      null,
      null,
      null,
      [2],
      'und',
      null,
      null,
      [
        null,
        null,
        null,
        null,
        null,
        null,
        [3],
        [[[[null, null, null, [
          null,
          1,
          'early.png',
          'https://lh3.googleusercontent.com/gg/AMW1TPearlyMissingUrl'
        ]]]]]
      ]
    ]]]
  ]];
  const responseText = `)]}'\n123\n${JSON.stringify([['wrb.fr', 'hNvQHb', JSON.stringify(historyPayload), null, null, null, 'generic']])}`;

  assert.deepEqual(extractGeminiAssetBindingsFromResponseText(responseText), [
    {
      discoveredUrl: 'https://lh3.googleusercontent.com/gg/AMW1TPlatelateOwnedUrl=s0',
      assetIds: {
        responseId: 'r_late_response',
        draftId: 'rc_late_owned',
        conversationId: 'c_cdec91057e5fdcaf'
      }
    },
    {
      discoveredUrl: 'https://lh3.googleusercontent.com/gg/AMW1TPearlyMissingUrl=s0',
      assetIds: {
        responseId: 'r_early_response',
        draftId: 'rc_early_missing',
        conversationId: 'c_cdec91057e5fdcaf'
      }
    }
  ]);
});

test('extractGeminiAssetBindingsFromResponseText should recover draft urls nested inside object-shaped history nodes', () => {
  const historyPayload = [[
    [
      ['c_cdec91057e5fdcaf', 'r_ea71y0001'],
      ['c_cdec91057e5fdcaf', 'r_1a7e2222', 'rc_1a7e3333'],
      [[[
        'rc_ea71y4444',
        ['http://googleusercontent.com/image_generation_content/2'],
        [null, null, null, null, [null, null, 8]],
        'rc_ea71y4444',
        null,
        null,
        null,
        null,
        [2],
        'und',
        null,
        null,
        [
          {
            7: [3],
            8: [[[[null, null, null, [
              null,
              1,
              'early.png',
              'https://lh3.googleusercontent.com/gg/AMW1TPobjectWrappedEarlyUrl'
            ]]]]],
            46: []
          }
        ]
      ]]],
      [[[
        'rc_1a7e3333',
        ['http://googleusercontent.com/image_generation_content/2'],
        [null, null, null, null, [null, null, 8]],
        null,
        null,
        null,
        null,
        null,
        [2],
        'und',
        null,
        null,
        [
          {
            7: [3],
            8: [[[[null, null, null, [
              null,
              1,
              'late.png',
              'https://lh3.googleusercontent.com/gg/AMW1TPobjectWrappedLateUrl'
            ]]]]],
            46: []
          }
        ]
      ]]]
    ]
  ]];
  const responseText = `)]}'\n123\n${JSON.stringify([['wrb.fr', 'hNvQHb', JSON.stringify(historyPayload), null, null, null, 'generic']])}`;

  const sortBindings = (bindings) => [...bindings].sort((left, right) => (
    left.discoveredUrl.localeCompare(right.discoveredUrl)
  ));

  assert.deepEqual(sortBindings(extractGeminiAssetBindingsFromResponseText(responseText)), sortBindings([
    {
      discoveredUrl: 'https://lh3.googleusercontent.com/gg/AMW1TPobjectWrappedLateUrl=s0',
      assetIds: {
        responseId: 'r_1a7e2222',
        draftId: 'rc_1a7e3333',
        conversationId: 'c_cdec91057e5fdcaf'
      }
    },
    {
      discoveredUrl: 'https://lh3.googleusercontent.com/gg/AMW1TPobjectWrappedEarlyUrl=s0',
      assetIds: {
        responseId: 'r_ea71y0001',
        draftId: 'rc_ea71y4444',
        conversationId: 'c_cdec91057e5fdcaf'
      }
    }
  ]));
});

test('createGeminiDownloadRpcFetchHook should notify discovered original asset urls from download rpc responses', async () => {
  const seen = [];
  const originalFetch = async () => new Response(
    ')]}\'\n123\n[["wrb.fr","c8o8Fe","[null,\\\"https:\\\\/\\\\/lh3.googleusercontent.com\\\\/rd-gg-dl\\\\/token=s1024-rj\\\"]",null,null,null,"generic"]]',
    {
      status: 200,
      headers: { 'content-type': 'text/plain; charset=UTF-8' }
    }
  );

  const hook = createGeminiDownloadRpcFetchHook({
    originalFetch,
    getActionContext: () => ({
      assetIds: {
        responseId: 'r_d7ef418292ede05c',
        draftId: 'rc_2315ec0b5621fce5',
        conversationId: 'c_cdec91057e5fdcaf'
      }
    }),
    onOriginalAssetDiscovered: (payload) => {
      seen.push(payload);
    }
  });

  const response = await hook('https://gemini.google.com/_/BardChatUi/data/batchexecute?rpcids=c8o8Fe&rt=c');

  assert.equal(response.status, 200);
  assert.equal(await response.text(), ')]}\'\n123\n[["wrb.fr","c8o8Fe","[null,\\\"https:\\\\/\\\\/lh3.googleusercontent.com\\\\/rd-gg-dl\\\\/token=s1024-rj\\\"]",null,null,null,"generic"]]');
  assert.deepEqual(seen, [{
    rpcUrl: 'https://gemini.google.com/_/BardChatUi/data/batchexecute?rpcids=c8o8Fe&rt=c',
    discoveredUrl: 'https://lh3.googleusercontent.com/rd-gg-dl/token=s0-rj',
    actionContext: {
      assetIds: {
        responseId: 'r_d7ef418292ede05c',
        draftId: 'rc_2315ec0b5621fce5',
        conversationId: 'c_cdec91057e5fdcaf'
      }
    }
  }]);
});

test('createGeminiDownloadRpcFetchHook should prefer provideActionContext over getter aliases', async () => {
  const seen = [];
  const originalFetch = async () => new Response(
    ')]}\'\n123\n[["wrb.fr","c8o8Fe","[null,\\\"https:\\\\/\\\\/lh3.googleusercontent.com\\\\/rd-gg-dl\\\\/token=s1024-rj\\\"]",null,null,null,"generic"]]',
    {
      status: 200,
      headers: { 'content-type': 'text/plain; charset=UTF-8' }
    }
  );

  const hook = createGeminiDownloadRpcFetchHook({
    originalFetch,
    provideActionContext: () => ({
      action: 'download',
      sessionKey: 'draft:rc_provided_rpc_context',
      assetIds: {
        responseId: 'r_provided_rpc_context',
        draftId: 'rc_provided_rpc_context',
        conversationId: 'c_provided_rpc_context'
      }
    }),
    getActionContext: () => ({
      action: 'download',
      sessionKey: 'draft:rc_wrong_rpc_action_context',
      assetIds: {
        responseId: 'r_wrong_rpc_action_context',
        draftId: 'rc_wrong_rpc_action_context',
        conversationId: 'c_wrong_rpc_action_context'
      }
    }),
    onOriginalAssetDiscovered: (payload) => {
      seen.push(payload);
    }
  });

  await hook('https://gemini.google.com/_/BardChatUi/data/batchexecute?rpcids=c8o8Fe&rt=c');

  assert.deepEqual(seen, [{
    rpcUrl: 'https://gemini.google.com/_/BardChatUi/data/batchexecute?rpcids=c8o8Fe&rt=c',
    discoveredUrl: 'https://lh3.googleusercontent.com/rd-gg-dl/token=s0-rj',
    actionContext: {
      action: 'download',
      sessionKey: 'draft:rc_provided_rpc_context',
      assetIds: {
        responseId: 'r_provided_rpc_context',
        draftId: 'rc_provided_rpc_context',
        conversationId: 'c_provided_rpc_context'
      }
    }
  }]);
});

test('createGeminiDownloadRpcFetchHook should fallback to parsing asset ids from rpc request body when action context is missing', async () => {
  const seen = [];
  const originalFetch = async () => new Response(
    ')]}\'\n123\n[["wrb.fr","c8o8Fe","[null,\\\"https:\\\\/\\\\/lh3.googleusercontent.com\\\\/rd-gg-dl\\\\/token=s1024-rj\\\"]",null,null,null,"generic"]]',
    {
      status: 200,
      headers: { 'content-type': 'text/plain; charset=UTF-8' }
    }
  );

  const hook = createGeminiDownloadRpcFetchHook({
    originalFetch,
    onOriginalAssetDiscovered: (payload) => {
      seen.push(payload);
    }
  });

  await hook('https://gemini.google.com/_/BardChatUi/data/batchexecute?rpcids=c8o8Fe&rt=c', {
    method: 'POST',
    body: 'f.req=%5Bnull%2C%22%5Bnull%2C%5B%5C%22image_generation_content%5C%22%2C0%2C%5C%22r_d7ef418292ede05c%5C%22%2C%5C%22rc_2315ec0b5621fce5%5C%22%2C%5C%22c_cdec91057e5fdcaf%5C%22%5D%5D%22%5D&at=abc'
  });

  assert.deepEqual(seen, [{
    rpcUrl: 'https://gemini.google.com/_/BardChatUi/data/batchexecute?rpcids=c8o8Fe&rt=c',
    discoveredUrl: 'https://lh3.googleusercontent.com/rd-gg-dl/token=s0-rj',
    actionContext: {
      assetIds: {
        responseId: 'r_d7ef418292ede05c',
        draftId: 'rc_2315ec0b5621fce5',
        conversationId: 'c_cdec91057e5fdcaf'
      }
    }
  }]);
});

test('createGeminiDownloadRpcFetchHook should inspect non-c8o8Fe Gemini batchexecute responses when asset ids and original urls are present', async () => {
  const seen = [];
  const originalFetch = async () => new Response(
    ')]}\'\n123\n[["wrb.fr","ESY5D","[null,\\\"https:\\\\/\\\\/lh3.googleusercontent.com\\\\/gg-dl\\\\/token=s1024-rj\\\"]",null,null,null,"generic"]]',
    {
      status: 200,
      headers: { 'content-type': 'text/plain; charset=UTF-8' }
    }
  );

  const hook = createGeminiDownloadRpcFetchHook({
    originalFetch,
    onOriginalAssetDiscovered: (payload) => {
      seen.push(payload);
    }
  });

  await hook('https://gemini.google.com/_/BardChatUi/data/batchexecute?rpcids=ESY5D&rt=c', {
    method: 'POST',
    body: 'f.req=%5Bnull%2C%22%5Bnull%2C%5B%5C%22image_generation_content%5C%22%2C0%2C%5C%22r_auto1234567890ab%5C%22%2C%5C%22rc_auto1234567890ab%5C%22%2C%5C%22c_auto1234567890ab%5C%22%5D%5D%22%5D&at=abc'
  });

  assert.deepEqual(seen, [{
    rpcUrl: 'https://gemini.google.com/_/BardChatUi/data/batchexecute?rpcids=ESY5D&rt=c',
    discoveredUrl: 'https://lh3.googleusercontent.com/gg-dl/token=s0-rj',
    actionContext: {
      assetIds: {
        responseId: 'r_auto1234567890ab',
        draftId: 'rc_auto1234567890ab',
        conversationId: 'c_auto1234567890ab'
      }
    }
  }]);
});

test('createGeminiDownloadRpcFetchHook should use response-derived asset ids for Gemini preview urls in history payloads', async () => {
  const seen = [];
  const originalFetch = async () => new Response(
    ')]}\'\n123\n[["wrb.fr","hNvQHb","[[[[\\\"c_cdec91057e5fdcaf\\\",\\\"r_d7ef418292ede05c\\\",\\\"rc_2315ec0b5621fce5\\\"],[[[\\\"rc_1dfd19ae1152c42a\\\",[\\\"http://googleusercontent.com/image_generation_content/1\\\"],[null,null,null,null,[null,null,8]],null,null,null,null,null,[2],\\\"und\\\",null,null,[null,null,null,null,null,null,[3],[[[[null,null,null,[null,1,\\\"2399453241942556798.png\\\",\\\"https:\\\\/\\\\/lh3.googleusercontent.com\\\\/gg\\\\/AMW1TPruenvvhqGkK0ivNZat8rOQAWX2D9MYOb3rnxDwPU2y0V9oAp2bsFbJaGpRuuRsL19W2GwrpLRLqs5NydfTKFgw1rS01x9Kw8LtVbLdozlk8xgDCA2JiQ2Zs-12nq3o1OoxCKkT2LDl0lstjozOVQLHVtPA3kTduYB8-vwLSw3mWY0EkGE6RaL5_-8nRGZKXMmfpfjKRwLeFBv129SAVZKrV_cd9vypDV_Kqf7RZv4cvvuS8iOdfgEVvBHfoPQ268hode9yEG4uafOs_cCKU_vrcI2Bv06Yu3zTjLn1YxHVbUzXbKKsywKxtNeiCvlpvoxgeIlF8x_GgMAWinNf46vQ\\\"]]]]]]]]]",null,null,null,"generic"]]',
    {
      status: 200,
      headers: { 'content-type': 'text/plain; charset=UTF-8' }
    }
  );

  const hook = createGeminiDownloadRpcFetchHook({
    originalFetch,
    getActionContext: () => ({
      assetIds: {
        conversationId: 'c_cdec91057e5fdcaf'
      }
    }),
    onOriginalAssetDiscovered: (payload) => {
      seen.push(payload);
    }
  });

  await hook('https://gemini.google.com/_/BardChatUi/data/batchexecute?rpcids=hNvQHb&rt=c', {
    method: 'POST',
    body: 'f.req=%5B%5B%5B%22hNvQHb%22%2C%22%5B%5C%22c_cdec91057e5fdcaf%5C%22%2C10%2Cnull%2C1%2C%5B0%5D%2C%5B4%5D%2Cnull%2C1%5D%22%2Cnull%2C%22generic%22%5D%5D%5D&at=abc'
  });

  assert.deepEqual(seen, [{
    rpcUrl: 'https://gemini.google.com/_/BardChatUi/data/batchexecute?rpcids=hNvQHb&rt=c',
    discoveredUrl: 'https://lh3.googleusercontent.com/gg/AMW1TPruenvvhqGkK0ivNZat8rOQAWX2D9MYOb3rnxDwPU2y0V9oAp2bsFbJaGpRuuRsL19W2GwrpLRLqs5NydfTKFgw1rS01x9Kw8LtVbLdozlk8xgDCA2JiQ2Zs-12nq3o1OoxCKkT2LDl0lstjozOVQLHVtPA3kTduYB8-vwLSw3mWY0EkGE6RaL5_-8nRGZKXMmfpfjKRwLeFBv129SAVZKrV_cd9vypDV_Kqf7RZv4cvvuS8iOdfgEVvBHfoPQ268hode9yEG4uafOs_cCKU_vrcI2Bv06Yu3zTjLn1YxHVbUzXbKKsywKxtNeiCvlpvoxgeIlF8x_GgMAWinNf46vQ=s0',
    actionContext: {
      assetIds: {
        responseId: 'r_d7ef418292ede05c',
        draftId: 'rc_2315ec0b5621fce5',
        conversationId: 'c_cdec91057e5fdcaf'
      }
    }
  }]);
});

test('installGeminiDownloadRpcXmlHttpRequestHook should inspect Gemini batchexecute XHR responses and notify response-derived asset bindings', async () => {
  const seen = [];

  class FakeXMLHttpRequest {
    constructor() {
      this.listeners = new Map();
      this.responseType = '';
      this.status = 0;
      this.responseText = '';
      this.response = '';
    }

    addEventListener(type, listener) {
      const listeners = this.listeners.get(type) || [];
      listeners.push(listener);
      this.listeners.set(type, listeners);
    }

    removeEventListener(type, listener) {
      const listeners = this.listeners.get(type) || [];
      this.listeners.set(type, listeners.filter((entry) => entry !== listener));
    }

    open(method, url) {
      this.method = method;
      this.url = url;
    }

    send(body) {
      this.body = body;
    }

    dispatch(type) {
      for (const listener of this.listeners.get(type) || []) {
        listener.call(this, { type, target: this, currentTarget: this });
      }
    }

    respond({ status = 200, responseText = '' } = {}) {
      this.status = status;
      this.responseText = responseText;
      this.response = responseText;
      this.dispatch('loadend');
    }
  }

  const targetWindow = {
    XMLHttpRequest: FakeXMLHttpRequest
  };

  installGeminiDownloadRpcXmlHttpRequestHook(targetWindow, {
    getActionContext: () => ({
      assetIds: {
        conversationId: 'c_cdec91057e5fdcaf'
      }
    }),
    onOriginalAssetDiscovered: (payload) => {
      seen.push(payload);
    },
    logger: { warn() {} }
  });

  const xhr = new targetWindow.XMLHttpRequest();
  xhr.open('POST', 'https://gemini.google.com/_/BardChatUi/data/batchexecute?rpcids=hNvQHb&rt=c');
  xhr.send('f.req=%5B%5B%5B%22hNvQHb%22%2C%22%5B%5C%22c_cdec91057e5fdcaf%5C%22%2C10%2Cnull%2C1%2C%5B0%5D%2C%5B4%5D%2Cnull%2C1%5D%22%2Cnull%2C%22generic%22%5D%5D%5D&at=abc');
  xhr.respond({
    status: 200,
    responseText: ')]}\'\n123\n[["wrb.fr","hNvQHb","[[[[\\\"c_cdec91057e5fdcaf\\\",\\\"r_d7ef418292ede05c\\\",\\\"rc_2315ec0b5621fce5\\\"],[[[\\\"rc_1dfd19ae1152c42a\\\",[\\\"http://googleusercontent.com/image_generation_content/1\\\"],[null,null,null,null,[null,null,8]],null,null,null,null,null,[2],\\\"und\\\",null,null,[null,null,null,null,null,null,[3],[[[[null,null,null,[null,1,\\\"2399453241942556798.png\\\",\\\"https:\\\\/\\\\/lh3.googleusercontent.com\\\\/gg\\\\/AMW1TPruenvvhqGkK0ivNZat8rOQAWX2D9MYOb3rnxDwPU2y0V9oAp2bsFbJaGpRuuRsL19W2GwrpLRLqs5NydfTKFgw1rS01x9Kw8LtVbLdozlk8xgDCA2JiQ2Zs-12nq3o1OoxCKkT2LDl0lstjozOVQLHVtPA3kTduYB8-vwLSw3mWY0EkGE6RaL5_-8nRGZKXMmfpfjKRwLeFBv129SAVZKrV_cd9vypDV_Kqf7RZv4cvvuS8iOdfgEVvBHfoPQ268hode9yEG4uafOs_cCKU_vrcI2Bv06Yu3zTjLn1YxHVbUzXbKKsywKxtNeiCvlpvoxgeIlF8x_GgMAWinNf46vQ\\\"]]]]]]]]]",null,null,null,"generic"]]'
  });
  await new Promise((resolve) => setTimeout(resolve, 0));

  assert.deepEqual(seen, [{
    rpcUrl: 'https://gemini.google.com/_/BardChatUi/data/batchexecute?rpcids=hNvQHb&rt=c',
    discoveredUrl: 'https://lh3.googleusercontent.com/gg/AMW1TPruenvvhqGkK0ivNZat8rOQAWX2D9MYOb3rnxDwPU2y0V9oAp2bsFbJaGpRuuRsL19W2GwrpLRLqs5NydfTKFgw1rS01x9Kw8LtVbLdozlk8xgDCA2JiQ2Zs-12nq3o1OoxCKkT2LDl0lstjozOVQLHVtPA3kTduYB8-vwLSw3mWY0EkGE6RaL5_-8nRGZKXMmfpfjKRwLeFBv129SAVZKrV_cd9vypDV_Kqf7RZv4cvvuS8iOdfgEVvBHfoPQ268hode9yEG4uafOs_cCKU_vrcI2Bv06Yu3zTjLn1YxHVbUzXbKKsywKxtNeiCvlpvoxgeIlF8x_GgMAWinNf46vQ=s0',
    actionContext: {
      assetIds: {
        responseId: 'r_d7ef418292ede05c',
        draftId: 'rc_2315ec0b5621fce5',
        conversationId: 'c_cdec91057e5fdcaf'
      }
    }
  }]);
});

test('createGeminiDownloadFetchHook should forward recent action context and notify discovered original assets', async () => {
  let notified = null;
  let seenContext = null;
  const originalFetch = async () => new Response(new Blob(['original'], { type: 'image/png' }), {
    status: 200,
    headers: { 'content-type': 'image/png' }
  });

  const hook = createGeminiDownloadFetchHook({
    originalFetch,
    isTargetUrl: () => true,
    normalizeUrl: () => 'https://lh3.googleusercontent.com/rd-gg-dl/token=s0',
    getActionContext: () => ({
      action: 'download',
      sessionKey: 'draft:rc_d7ef418292ede05c',
      assetIds: {
        responseId: 'r_d7ef418292ede05c',
        draftId: 'rc_2315ec0b5621fce5',
        conversationId: 'c_cdec91057e5fdcaf'
      },
      resource: {
        kind: 'processed',
        url: 'blob:https://gemini.google.com/download-processed',
        mimeType: 'image/png',
        processedMeta: null,
        source: 'page-fetch'
      }
    }),
    onOriginalAssetDiscovered: async (context) => {
      notified = context;
    },
    processBlob: async (_blob, context) => {
      seenContext = context;
      return new Blob(['processed'], { type: 'image/png' });
    }
  });

  const response = await hook('https://lh3.googleusercontent.com/rd-gg-dl/token=s1024');

  assert.equal(await response.text(), 'processed');
  assert.deepEqual(seenContext.actionContext, {
    action: 'download',
    sessionKey: 'draft:rc_d7ef418292ede05c',
    assetIds: {
      responseId: 'r_d7ef418292ede05c',
      draftId: 'rc_2315ec0b5621fce5',
      conversationId: 'c_cdec91057e5fdcaf'
    },
    resource: {
      kind: 'processed',
      url: 'blob:https://gemini.google.com/download-processed',
      mimeType: 'image/png',
      processedMeta: null,
      source: 'page-fetch'
    }
  });
  assert.equal('intentMetadata' in seenContext, false);
  assert.deepEqual(notified.actionContext, seenContext.actionContext);
  assert.equal(notified.normalizedUrl, 'https://lh3.googleusercontent.com/rd-gg-dl/token=s0');
});

test('createGeminiDownloadFetchHook should reuse an existing full processed session blob without refetching or reprocessing', async () => {
  let fetchCalls = 0;
  let processCalls = 0;
  const processedBlob = new Blob(['session-full-processed'], { type: 'image/png' });
  const originalFetch = async () => {
    fetchCalls += 1;
    return new Response(new Blob(['original'], { type: 'image/png' }), {
      status: 200,
      headers: { 'content-type': 'image/png' }
    });
  };

  const hook = createGeminiDownloadFetchHook({
    originalFetch,
    isTargetUrl: () => true,
    normalizeUrl: () => 'https://lh3.googleusercontent.com/rd-gg-dl/token=s0',
    getActionContext: () => ({
      action: 'download',
      sessionKey: 'draft:rc_reuse_download',
      assetIds: {
        responseId: 'r_reuse_download',
        draftId: 'rc_reuse_download',
        conversationId: 'c_reuse_download'
      },
      resource: {
        kind: 'processed',
        url: 'blob:https://gemini.google.com/reuse-download',
        blob: processedBlob,
        mimeType: 'image/png',
        processedMeta: null,
        source: 'original-download',
        slot: 'full'
      }
    }),
    processBlob: async () => {
      processCalls += 1;
      return new Blob(['processed'], { type: 'image/png' });
    }
  });

  const response = await hook('https://lh3.googleusercontent.com/rd-gg-dl/token=s1024');

  assert.equal(await response.text(), 'session-full-processed');
  assert.equal(response.headers.get('content-type'), 'image/png');
  assert.equal(fetchCalls, 0);
  assert.equal(processCalls, 0);
});

test('createGeminiDownloadFetchHook should prefer provideActionContext over getter aliases', async () => {
  let fetchCalls = 0;
  let processCalls = 0;
  const processedBlob = new Blob(['provided-action-context-full-processed'], { type: 'image/png' });
  const originalFetch = async () => {
    fetchCalls += 1;
    return new Response(new Blob(['original'], { type: 'image/png' }), {
      status: 200,
      headers: { 'content-type': 'image/png' }
    });
  };

  const hook = createGeminiDownloadFetchHook({
    originalFetch,
    isTargetUrl: () => true,
    normalizeUrl: () => 'https://lh3.googleusercontent.com/rd-gg-dl/token=s0',
    provideActionContext: () => ({
      action: 'download',
      sessionKey: 'draft:rc_provided_download_context',
      assetIds: {
        responseId: 'r_provided_download_context',
        draftId: 'rc_provided_download_context',
        conversationId: 'c_provided_download_context'
      },
      resource: {
        kind: 'processed',
        url: 'blob:https://gemini.google.com/provided-download-context',
        blob: processedBlob,
        mimeType: 'image/png',
        processedMeta: null,
        source: 'original-download',
        slot: 'full'
      }
    }),
    getActionContext: () => ({
      action: 'download',
      sessionKey: 'draft:rc_wrong_download_action_context',
      assetIds: {
        responseId: 'r_wrong_download_action_context',
        draftId: 'rc_wrong_download_action_context',
        conversationId: 'c_wrong_download_action_context'
      }
    }),
    processBlob: async () => {
      processCalls += 1;
      return new Blob(['processed'], { type: 'image/png' });
    }
  });

  const response = await hook('https://lh3.googleusercontent.com/rd-gg-dl/token=s1024');

  assert.equal(await response.text(), 'provided-action-context-full-processed');
  assert.equal(fetchCalls, 0);
  assert.equal(processCalls, 0);
});

test('createGeminiDirectDownloadActionHandler should actively download a processed original blob for download actions', async () => {
  const { target } = createButtonLikeTarget();
  const anchorClicks = [];
  const appendedNodes = [];
  const createdObjectUrls = [];
  const revokedObjectUrls = [];
  let seenFetch = null;
  let seenProcessedPayload = null;
  let seenProcessedNotification = null;

  const handler = createGeminiDirectDownloadActionHandler({
    targetWindow: {
      document: {
        body: {
          appendChild(node) {
            appendedNodes.push(node);
          },
          removeChild() {}
        },
        createElement(tagName) {
          assert.equal(tagName, 'a');
          return {
            href: '',
            download: '',
            click() {
              anchorClicks.push({
                href: this.href,
                download: this.download
              });
            },
            remove() {}
          };
        }
      },
      URL: {
        createObjectURL(blob) {
          createdObjectUrls.push(blob);
          return 'blob:https://gemini.google.com/direct-download';
        },
        revokeObjectURL(url) {
          revokedObjectUrls.push(url);
        }
      }
    },
    resolveActionContext: () => ({
      action: 'download',
      sessionKey: 'draft:rc_direct_download',
      assetIds: {
        draftId: 'rc_direct_download'
      },
      resource: {
        kind: 'original',
        url: 'https://lh3.googleusercontent.com/rd-gg/token=s1024-rj'
      }
    }),
    fetchImpl: async (url, init = {}) => {
      seenFetch = {
        url,
        gwrBypass: init.gwrBypass === true
      };
      return new Response(new Blob(['original'], { type: 'image/png' }), {
        status: 200,
        statusText: 'OK',
        headers: {
          'content-type': 'image/png'
        }
      });
    },
    normalizeUrl: () => 'https://lh3.googleusercontent.com/rd-gg/token=s0-rj',
    processBlob: async (blob, payload) => {
      seenProcessedPayload = {
        payload,
        text: await blob.text()
      };
      return new Blob(['processed'], { type: 'image/png' });
    },
    onProcessedBlobResolved: async (payload) => {
      seenProcessedNotification = {
        normalizedUrl: payload.normalizedUrl,
        processedText: await payload.processedBlob.text(),
        sessionKey: payload.actionContext?.sessionKey
      };
    },
    logger: { warn() {} }
  });

  let prevented = false;
  let stopped = false;
  let stoppedImmediate = false;
  const handled = await handler({
    target,
    preventDefault() {
      prevented = true;
    },
    stopPropagation() {
      stopped = true;
    },
    stopImmediatePropagation() {
      stoppedImmediate = true;
    }
  });

  assert.equal(handled, true);
  assert.equal(prevented, true);
  assert.equal(stopped, true);
  assert.equal(stoppedImmediate, true);
  assert.deepEqual(seenFetch, {
    url: 'https://lh3.googleusercontent.com/rd-gg/token=s0-rj',
    gwrBypass: true
  });
  assert.equal(seenProcessedPayload.text, 'original');
  assert.deepEqual(seenProcessedPayload.payload, {
    url: 'https://lh3.googleusercontent.com/rd-gg/token=s1024-rj',
    normalizedUrl: 'https://lh3.googleusercontent.com/rd-gg/token=s0-rj',
    responseStatus: 200,
    responseStatusText: 'OK',
    responseHeaders: {
      'content-type': 'image/png'
    },
    actionContext: {
      action: 'download',
      sessionKey: 'draft:rc_direct_download',
      assetIds: {
        draftId: 'rc_direct_download'
      },
      resource: {
        kind: 'original',
        url: 'https://lh3.googleusercontent.com/rd-gg/token=s1024-rj'
      }
    }
  });
  assert.deepEqual(seenProcessedNotification, {
    normalizedUrl: 'https://lh3.googleusercontent.com/rd-gg/token=s0-rj',
    processedText: 'processed',
    sessionKey: 'draft:rc_direct_download'
  });
  assert.equal(appendedNodes.length, 1);
  assert.deepEqual(anchorClicks, [{
    href: 'blob:https://gemini.google.com/direct-download',
    download: 'gemini-image.png'
  }]);
  assert.equal(createdObjectUrls.length, 1);
  assert.deepEqual(revokedObjectUrls, ['blob:https://gemini.google.com/direct-download']);
});

test('createGeminiDirectDownloadActionHandler should support userscript-side blob fetching for cross-origin Gemini assets', async () => {
  const { target } = createButtonLikeTarget();
  const anchorClicks = [];
  const createdObjectUrls = [];
  let fetchCalls = 0;
  let seenProcessedPayload = null;

  const handler = createGeminiDirectDownloadActionHandler({
    targetWindow: {
      document: {
        body: {
          appendChild() {},
          removeChild() {}
        },
        createElement(tagName) {
          assert.equal(tagName, 'a');
          return {
            href: '',
            download: '',
            click() {
              anchorClicks.push({
                href: this.href,
                download: this.download
              });
            },
            remove() {}
          };
        }
      },
      URL: {
        createObjectURL(blob) {
          createdObjectUrls.push(blob);
          return 'blob:https://gemini.google.com/direct-download';
        },
        revokeObjectURL() {}
      }
    },
    resolveActionContext: () => ({
      action: 'download',
      sessionKey: 'draft:rc_direct_download_cross_origin',
      assetIds: {
        draftId: 'rc_direct_download_cross_origin'
      },
      resource: {
        kind: 'original',
        url: 'https://lh3.googleusercontent.com/gg/token=s0'
      }
    }),
    fetchImpl: async () => {
      fetchCalls += 1;
      throw new Error('page fetch should not run');
    },
    fetchBlobImpl: async (url) => {
      assert.equal(url, 'https://lh3.googleusercontent.com/gg/token=s0');
      return new Blob(['original'], { type: 'image/png' });
    },
    normalizeUrl: (url) => url,
    processBlob: async (blob, payload) => {
      seenProcessedPayload = {
        payload,
        text: await blob.text()
      };
      return new Blob(['processed'], { type: 'image/png' });
    },
    logger: { warn() {} }
  });

  const handled = await handler({
    target,
    preventDefault() {},
    stopPropagation() {},
    stopImmediatePropagation() {}
  });

  assert.equal(handled, true);
  assert.equal(fetchCalls, 0);
  assert.equal(seenProcessedPayload.text, 'original');
  assert.deepEqual(seenProcessedPayload.payload, {
    url: 'https://lh3.googleusercontent.com/gg/token=s0',
    normalizedUrl: 'https://lh3.googleusercontent.com/gg/token=s0',
    responseStatus: 200,
    responseStatusText: 'OK',
    responseHeaders: {
      'content-type': 'image/png'
    },
    actionContext: {
      action: 'download',
      sessionKey: 'draft:rc_direct_download_cross_origin',
      assetIds: {
        draftId: 'rc_direct_download_cross_origin'
      },
      resource: {
        kind: 'original',
        url: 'https://lh3.googleusercontent.com/gg/token=s0'
      }
    }
  });
  assert.deepEqual(anchorClicks, [{
    href: 'blob:https://gemini.google.com/direct-download',
    download: 'gemini-image.png'
  }]);
  assert.equal(createdObjectUrls.length, 1);
});

test('createGeminiDirectDownloadActionHandler should fail closed when the original asset is unavailable', async () => {
  const { target } = createButtonLikeTarget();
  let seenFailure = null;
  let fetchCalls = 0;

  const handler = createGeminiDirectDownloadActionHandler({
    targetWindow: {
      document: {
        body: {
          appendChild() {
            throw new Error('should not append anchor');
          }
        },
        createElement() {
          throw new Error('should not create anchor');
        }
      },
      URL: {
        createObjectURL() {
          throw new Error('should not create object url');
        },
        revokeObjectURL() {}
      }
    },
    resolveActionContext: () => ({
      action: 'download',
      sessionKey: 'draft:rc_missing_original',
      assetIds: {
        draftId: 'rc_missing_original'
      },
      resource: {
        kind: 'preview',
        url: 'blob:https://gemini.google.com/preview-only'
      }
    }),
    fetchImpl: async () => {
      fetchCalls += 1;
      return new Response(new Blob(['original'], { type: 'image/png' }), {
        status: 200,
        headers: { 'content-type': 'image/png' }
      });
    },
    normalizeUrl: (url) => url,
    processBlob: async () => {
      throw new Error('should not process');
    },
    onActionCriticalFailure: async (payload) => {
      seenFailure = {
        message: payload.error?.message || '',
        sessionKey: payload.actionContext?.sessionKey
      };
    },
    logger: { warn() {} }
  });

  const handled = await handler({
    target,
    preventDefault() {},
    stopPropagation() {},
    stopImmediatePropagation() {}
  });

  assert.equal(handled, true);
  assert.equal(fetchCalls, 0);
  assert.deepEqual(seenFailure, {
    message: 'Original image is unavailable for download processing',
    sessionKey: 'draft:rc_missing_original'
  });
});
