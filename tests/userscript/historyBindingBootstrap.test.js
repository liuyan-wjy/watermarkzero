import test from 'node:test';
import assert from 'node:assert/strict';

import {
  buildGeminiConversationHistoryRequest,
  extractGeminiConversationIdFromPath,
  getGeminiBootstrapRpcConfig,
  requestGeminiConversationHistoryBindings
} from '../../src/userscript/historyBindingBootstrap.js';

test('extractGeminiConversationIdFromPath should normalize Gemini conversation routes', () => {
  assert.equal(extractGeminiConversationIdFromPath('/app/cdec91057e5fdcaf'), 'c_cdec91057e5fdcaf');
  assert.equal(extractGeminiConversationIdFromPath('/app/c_auto123'), 'c_auto123');
  assert.equal(extractGeminiConversationIdFromPath('/app'), '');
  assert.equal(extractGeminiConversationIdFromPath('/'), '');
});

test('getGeminiBootstrapRpcConfig should read required batchexecute params from WIZ_global_data', () => {
  const config = getGeminiBootstrapRpcConfig({
    WIZ_global_data: {
      SNlM0e: 'AJvLN6N-example:1774855312870',
      cfb2h: 'boq_assistant-bard-web-server_20260325.04_p0',
      FdrFJe: '-3468728888195759789',
      eptZe: '/_/BardChatUi/'
    }
  });

  assert.deepEqual(config, {
    at: 'AJvLN6N-example:1774855312870',
    buildLabel: 'boq_assistant-bard-web-server_20260325.04_p0',
    sessionId: '-3468728888195759789',
    endpointBase: '/_/BardChatUi/'
  });
});

test('buildGeminiConversationHistoryRequest should build a ListConversationTurns batchexecute request', () => {
  const request = buildGeminiConversationHistoryRequest({
    origin: 'https://gemini.google.com',
    sourcePath: '/app/cdec91057e5fdcaf',
    hl: 'zh-CN',
    reqId: 2755200,
    conversationId: 'c_cdec91057e5fdcaf',
    rpcConfig: {
      at: 'AJvLN6N-example:1774855312870',
      buildLabel: 'boq_assistant-bard-web-server_20260325.04_p0',
      sessionId: '-3468728888195759789',
      endpointBase: '/_/BardChatUi/'
    }
  });

  assert.equal(
    request.url,
    'https://gemini.google.com/_/BardChatUi/data/batchexecute?rpcids=hNvQHb&source-path=%2Fapp%2Fcdec91057e5fdcaf&bl=boq_assistant-bard-web-server_20260325.04_p0&f.sid=-3468728888195759789&hl=zh-CN&_reqid=2755200&rt=c'
  );
  assert.deepEqual(request.init, {
    method: 'POST',
    credentials: 'same-origin',
    headers: {
      'content-type': 'application/x-www-form-urlencoded;charset=UTF-8'
    },
    body: 'f.req=%5B%5B%5B%22hNvQHb%22%2C%22%5B%5C%22c_cdec91057e5fdcaf%5C%22%2C10%2Cnull%2C1%2C%5B0%5D%2C%5B4%5D%2Cnull%2C1%5D%22%2Cnull%2C%22generic%22%5D%5D%5D&at=AJvLN6N-example%3A1774855312870&'
  });
});

test('requestGeminiConversationHistoryBindings should call fetch with the current conversation request', async () => {
  const calls = [];
  const requested = await requestGeminiConversationHistoryBindings({
    targetWindow: {
      location: {
        origin: 'https://gemini.google.com',
        pathname: '/app/cdec91057e5fdcaf'
      },
      document: {
        documentElement: {
          lang: 'zh-CN'
        }
      },
      navigator: {
        language: 'zh-CN'
      },
      WIZ_global_data: {
        SNlM0e: 'AJvLN6N-example:1774855312870',
        cfb2h: 'boq_assistant-bard-web-server_20260325.04_p0',
        FdrFJe: '-3468728888195759789',
        eptZe: '/_/BardChatUi/'
      }
    },
    fetchImpl: async (url, init) => {
      calls.push({ url, init });
      return new Response('ok', { status: 200 });
    },
    logger: { warn() {} }
  });

  assert.equal(requested, true);
  assert.equal(calls.length, 1);
  assert.match(calls[0].url, /rpcids=hNvQHb/);
  assert.match(calls[0].url, /source-path=%2Fapp%2Fcdec91057e5fdcaf/);
  assert.match(calls[0].init.body, /^f\.req=/);
  assert.match(calls[0].init.body, /%22hNvQHb%22/);
});

test('requestGeminiConversationHistoryBindings should expose the response text to the bootstrap callback', async () => {
  let seenPayload = null;
  const requested = await requestGeminiConversationHistoryBindings({
    targetWindow: {
      location: {
        origin: 'https://gemini.google.com',
        pathname: '/app/cdec91057e5fdcaf'
      },
      document: {
        documentElement: {
          lang: 'zh-CN'
        }
      },
      navigator: {
        language: 'zh-CN'
      },
      WIZ_global_data: {
        SNlM0e: 'AJvLN6N-example:1774855312870',
        cfb2h: 'boq_assistant-bard-web-server_20260325.04_p0',
        FdrFJe: '-3468728888195759789',
        eptZe: '/_/BardChatUi/'
      }
    },
    fetchImpl: async () => new Response(')]}\'\n123\n[["wrb.fr","hNvQHb","[]",null,null,null,"generic"]]', { status: 200 }),
    onResponseText: async (responseText, payload) => {
      seenPayload = {
        responseText,
        requestUrl: payload.request.url
      };
    },
    logger: { warn() {} }
  });

  assert.equal(requested, true);
  assert.equal(seenPayload?.responseText, ')]}\'\n123\n[["wrb.fr","hNvQHb","[]",null,null,null,"generic"]]');
  assert.match(seenPayload?.requestUrl || '', /rpcids=hNvQHb/);
  assert.match(seenPayload?.requestUrl || '', /source-path=%2Fapp%2Fcdec91057e5fdcaf/);
});

test('requestGeminiConversationHistoryBindings should skip when current page is not a conversation route', async () => {
  let called = false;
  const requested = await requestGeminiConversationHistoryBindings({
    targetWindow: {
      location: {
        origin: 'https://gemini.google.com',
        pathname: '/app'
      },
      WIZ_global_data: {}
    },
    fetchImpl: async () => {
      called = true;
      return new Response('ok', { status: 200 });
    },
    logger: { warn() {} }
  });

  assert.equal(requested, false);
  assert.equal(called, false);
});
