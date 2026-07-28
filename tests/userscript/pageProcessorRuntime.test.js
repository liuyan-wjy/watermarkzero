import test from 'node:test';
import assert from 'node:assert/strict';

import { installInjectedPageProcessorRuntime } from '../../src/userscript/pageProcessorRuntime.js';

const PAGE_PROCESS_RUNTIME_FLAG = '__gwrPageProcessRuntimeInstalled__';

function createMockDocument({
  nonce = 'nonce-123',
  onAppend
} = {}) {
  return {
    head: {
      appendChild(node) {
        onAppend?.(node);
      }
    },
    createElement(tagName) {
      return {
        tagName,
        nonce: '',
        textContent: '',
        src: '',
        removed: false,
        onload: null,
        onerror: null,
        setAttribute(name, value) {
          this[name] = value;
        },
        remove() {
          this.removed = true;
        }
      };
    },
    querySelector(selector) {
      if (selector !== 'script[nonce]') {
        return null;
      }
      return {
        nonce,
        getAttribute(name) {
          return name === 'nonce' ? nonce : '';
        }
      };
    }
  };
}

test('installInjectedPageProcessorRuntime should register via inline script when inline execution succeeds', async () => {
  const targetWindow = {
    setTimeout,
    clearTimeout
  };
  targetWindow.document = createMockDocument({
    onAppend(node) {
      assert.equal(node.nonce, 'nonce-inline');
      if (node.textContent) {
        targetWindow[PAGE_PROCESS_RUNTIME_FLAG] = { mode: 'inline' };
      }
    },
    nonce: 'nonce-inline'
  });

  const runtime = await installInjectedPageProcessorRuntime({
    targetWindow,
    scriptCode: 'window.__inline = true;',
    logger: { info() {}, warn() {} }
  });

  assert.deepEqual(runtime, { mode: 'inline' });
});

test('installInjectedPageProcessorRuntime should fall back to blob script when inline injection does not register', async () => {
  const targetWindow = {
    setTimeout,
    clearTimeout
  };
  const appendedNodes = [];
  targetWindow.document = createMockDocument({
    onAppend(node) {
      appendedNodes.push({
        nonce: node.nonce,
        hasInlineCode: Boolean(node.textContent),
        src: node.src
      });
      if (node.src) {
        targetWindow[PAGE_PROCESS_RUNTIME_FLAG] = { mode: 'blob' };
        node.onload?.();
      }
    },
    nonce: 'nonce-blob'
  });

  const runtime = await installInjectedPageProcessorRuntime({
    targetWindow,
    scriptCode: 'window.__blob = true;',
    logger: { info() {}, warn() {} }
  });

  assert.deepEqual(runtime, { mode: 'blob' });
  assert.equal(appendedNodes.length, 2);
  assert.equal(appendedNodes[0].hasInlineCode, true);
  assert.equal(appendedNodes[0].nonce, 'nonce-blob');
  assert.equal(appendedNodes[1].nonce, 'nonce-blob');
  assert.match(String(appendedNodes[1].src), /^blob:/);
});
