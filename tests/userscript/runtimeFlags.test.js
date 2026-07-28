import test from 'node:test';
import assert from 'node:assert/strict';

import { isTimingDebugEnabled, shouldUseInlineWorker } from '../../src/userscript/runtimeFlags.js';

function createStorage(initialValue = null) {
  let value = initialValue;
  return {
    getItem(key) {
      if (key !== '__gwr_force_inline_worker__' && key !== '__gwr_debug_timings__') return null;
      return value;
    },
    setItem(key, nextValue) {
      if (key !== '__gwr_force_inline_worker__' && key !== '__gwr_debug_timings__') return;
      value = String(nextValue);
    }
  };
}

test('shouldUseInlineWorker should stay disabled by default when build flag is off', () => {
  const env = {
    Worker: class {},
    Blob,
    localStorage: createStorage(null)
  };

  assert.equal(shouldUseInlineWorker('self.onmessage = () => {};', env), false);
});

test('shouldUseInlineWorker should allow forcing worker mode through a runtime global flag', () => {
  const env = {
    __GWR_FORCE_INLINE_WORKER__: true,
    Worker: class {},
    Blob,
    localStorage: createStorage(null)
  };

  assert.equal(shouldUseInlineWorker('self.onmessage = () => {};', env), true);
});

test('shouldUseInlineWorker should allow forcing worker mode through localStorage', () => {
  const env = {
    Worker: class {},
    Blob,
    localStorage: createStorage('1')
  };

  assert.equal(shouldUseInlineWorker('self.onmessage = () => {};', env), true);
});

test('shouldUseInlineWorker should read force flag from unsafeWindow global', () => {
  const env = {
    Worker: class {},
    Blob,
    unsafeWindow: {
      __GWR_FORCE_INLINE_WORKER__: true
    },
    localStorage: createStorage(null)
  };

  assert.equal(shouldUseInlineWorker('self.onmessage = () => {};', env), true);
});

test('shouldUseInlineWorker should read force flag from unsafeWindow localStorage', () => {
  const env = {
    Worker: class {},
    Blob,
    unsafeWindow: {
      localStorage: createStorage('true')
    },
    localStorage: createStorage(null)
  };

  assert.equal(shouldUseInlineWorker('self.onmessage = () => {};', env), true);
});

test('shouldUseInlineWorker should ignore force flags when worker primitives are unavailable', () => {
  const env = {
    __GWR_FORCE_INLINE_WORKER__: true,
    localStorage: createStorage('1')
  };

  assert.equal(shouldUseInlineWorker('self.onmessage = () => {};', env), false);
});

test('isTimingDebugEnabled should stay disabled by default', () => {
  const env = {
    localStorage: createStorage(null)
  };

  assert.equal(isTimingDebugEnabled(env), false);
});

test('isTimingDebugEnabled should allow enabling through a runtime global flag', () => {
  const env = {
    __GWR_DEBUG_TIMINGS__: true,
    localStorage: createStorage(null)
  };

  assert.equal(isTimingDebugEnabled(env), true);
});

test('isTimingDebugEnabled should allow enabling through localStorage', () => {
  const env = {
    localStorage: createStorage('1')
  };

  assert.equal(isTimingDebugEnabled(env), true);
});

test('isTimingDebugEnabled should read debug flag from unsafeWindow localStorage', () => {
  const env = {
    unsafeWindow: {
      localStorage: createStorage('true')
    },
    localStorage: createStorage(null)
  };

  assert.equal(isTimingDebugEnabled(env), true);
});
