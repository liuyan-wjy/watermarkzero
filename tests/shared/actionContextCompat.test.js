import test from 'node:test';
import assert from 'node:assert/strict';

import {
  appendCompatibleActionContext,
  createActionContextProvider,
  getActionContextFromIntentGate,
  resolveCompatibleActionContext,
  resolveCompatibleActionContextFromPayload,
  resolveActionContextFromProviders
} from '../../src/shared/actionContextCompat.js';

test('resolveCompatibleActionContext should keep explicit actionContext only', () => {
  const actionContext = {
    action: 'clipboard',
    sessionKey: 'draft:rc_action_context'
  };

  assert.deepEqual(resolveCompatibleActionContext(actionContext), actionContext);
  assert.equal(resolveCompatibleActionContext(null), null);
});

test('resolveActionContextFromProviders should read only the actionContext getter', () => {
  const actionContext = {
    action: 'download',
    sessionKey: 'draft:rc_provider_context'
  };

  assert.deepEqual(resolveActionContextFromProviders({
    getActionContext: () => actionContext,
    args: [{ url: 'https://example.com' }]
  }), actionContext);
});

test('appendCompatibleActionContext should expose only the actionContext field', () => {
  const actionContext = {
    action: 'download',
    sessionKey: 'draft:rc_payload_context'
  };

  assert.deepEqual(appendCompatibleActionContext({
    discoveredUrl: 'https://example.com/image.png'
  }, actionContext), {
    discoveredUrl: 'https://example.com/image.png',
    actionContext
  });
});

test('resolveCompatibleActionContextFromPayload should read the actionContext field only', () => {
  const actionContext = {
    action: 'clipboard',
    sessionKey: 'draft:rc_payload_primary'
  };

  assert.deepEqual(resolveCompatibleActionContextFromPayload({
    actionContext
  }), actionContext);
  assert.equal(resolveCompatibleActionContextFromPayload({}), null);
});

test('getActionContextFromIntentGate should read the primary gate getter only', () => {
  const actionContext = {
    action: 'download',
    sessionKey: 'draft:rc_gate_context'
  };

  assert.deepEqual(getActionContextFromIntentGate({
    getRecentActionContext: () => actionContext
  }), actionContext);
  assert.equal(getActionContextFromIntentGate({}), null);
});

test('createActionContextProvider should wrap getActionContext directly', () => {
  const actionContext = {
    action: 'clipboard',
    sessionKey: 'draft:rc_provider_action_context'
  };
  const provider = createActionContextProvider({
    getActionContext: () => actionContext
  });

  assert.deepEqual(provider({ url: 'https://example.com' }), actionContext);
});
