import test from 'node:test';
import assert from 'node:assert/strict';

import {
  toTrustedScript,
  toTrustedScriptUrl,
  toWorkerScriptUrl
} from '../../src/userscript/trustedTypes.js';

test('trustedTypes helpers should return raw values when trustedTypes API is unavailable', () => {
  const env = {};
  assert.equal(toTrustedScript('window.__x = 1;', env), 'window.__x = 1;');
  assert.equal(toTrustedScriptUrl('blob:test', env), 'blob:test');
  assert.equal(toWorkerScriptUrl('blob:test', env), 'blob:test');
});

test('trustedTypes helpers should use a created policy when the API is available', () => {
  const calls = [];
  const policy = {
    createScript(value) {
      calls.push(['script', value]);
      return { __trustedScript: value };
    },
    createScriptURL(value) {
      calls.push(['scriptURL', value]);
      return { __trustedScriptURL: value };
    }
  };
  const env = {
    trustedTypes: {
      getPolicy() {
        return null;
      },
      createPolicy(name, rules) {
        assert.equal(typeof rules.createScript, 'function');
        assert.equal(typeof rules.createScriptURL, 'function');
        return policy;
      }
    }
  };

  assert.deepEqual(toTrustedScript('window.__x = 1;', env), { __trustedScript: 'window.__x = 1;' });
  assert.deepEqual(toTrustedScriptUrl('blob:test', env), { __trustedScriptURL: 'blob:test' });
  assert.deepEqual(toWorkerScriptUrl('blob:worker', env), { __trustedScriptURL: 'blob:worker' });
  assert.deepEqual(calls, [
    ['script', 'window.__x = 1;'],
    ['scriptURL', 'blob:test'],
    ['scriptURL', 'blob:worker']
  ]);
});
