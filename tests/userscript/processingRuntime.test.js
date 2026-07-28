import test from 'node:test';
import assert from 'node:assert/strict';

import { WatermarkEngine } from '../../src/core/watermarkEngine.js';
import { createUserscriptProcessingRuntime } from '../../src/userscript/processingRuntime.js';

test('createUserscriptProcessingRuntime should allow detached removeWatermarkFromBlob calls', async () => {
  const runtime = createUserscriptProcessingRuntime({
    workerCode: '',
    env: {},
    logger: { warn() {}, log() {} }
  });

  let receivedOptions = null;
  runtime.processWatermarkBlob = async (_blob, options = {}) => {
    receivedOptions = options;
    return {
      processedBlob: new Blob(['processed'], { type: 'image/png' }),
      processedMeta: { source: 'stub' }
    };
  };

  const detachedRemoveWatermarkFromBlob = runtime.removeWatermarkFromBlob;
  const processedBlob = await detachedRemoveWatermarkFromBlob(
    new Blob(['raw'], { type: 'image/png' }),
    { adaptiveMode: 'never', maxPasses: 2 }
  );

  assert.equal(await processedBlob.text(), 'processed');
  assert.deepEqual(receivedOptions, {
    adaptiveMode: 'never',
    maxPasses: 2
  });
});

test('createUserscriptProcessingRuntime should include selectionDebug in main-thread timing payload', async () => {
  const originalEngineCreate = WatermarkEngine.create;
  const originalImage = globalThis.Image;
  const originalURL = globalThis.URL;
  const originalCreateObjectURL = globalThis.URL?.createObjectURL;
  const originalRevokeObjectURL = globalThis.URL?.revokeObjectURL;

  const selectionDebug = {
    candidateSource: 'official-nearby-catalog',
    initialConfig: { logoSize: 96, marginRight: 64, marginBottom: 64 },
    initialPosition: { x: 608, y: 1216, width: 96, height: 96 },
    finalConfig: { logoSize: 94, marginRight: 64, marginBottom: 62 },
    finalPosition: { x: 611, y: 1214, width: 94, height: 94 },
    texturePenalty: 0.04,
    tooDark: false,
    tooFlat: false,
    hardReject: false,
    usedCatalogVariant: true,
    usedSizeJitter: true,
    usedLocalShift: true,
    usedAdaptive: false,
    usedPreviewAnchor: false
  };
  const revokedUrls = [];
  const logs = [];

  class MockImage {
    constructor() {
      this.width = 0;
      this.height = 0;
      this.onload = null;
      this.onerror = null;
    }

    set src(value) {
      this._src = value;
      this.width = 1536;
      this.height = 2304;
      queueMicrotask(() => {
        this.onload?.();
      });
    }

    get src() {
      return this._src;
    }
  }

  const mockCanvas = {
    __watermarkMeta: {
      applied: true,
      selectionDebug
    },
    __watermarkTiming: {
      drawMs: 1,
      getImageDataMs: 2,
      processWatermarkImageDataMs: 3,
      putImageDataMs: 4,
      processor: {
        initialSelectionMs: 5,
        firstPassMetricsMs: 6,
        extraPassMs: 7,
        finalMetricsMs: 8,
        recalibrationMs: 9,
        subpixelRefinementMs: 10,
        previewEdgeCleanupMs: 11,
        totalMs: 12
      }
    },
    toBlob(callback) {
      callback(new Blob(['processed'], { type: 'image/png' }));
    }
  };

  WatermarkEngine.create = async () => ({
    async removeWatermarkFromImage(image, options = {}) {
      assert.equal(image.width, 1536);
      assert.equal(image.height, 2304);
      assert.equal(options.debugTimings, true);
      return mockCanvas;
    }
  });
  globalThis.Image = MockImage;
  globalThis.URL = originalURL;
  globalThis.URL.createObjectURL = () => 'blob:runtime-test';
  globalThis.URL.revokeObjectURL = (url) => revokedUrls.push(url);

  try {
    const runtime = createUserscriptProcessingRuntime({
      workerCode: '',
      env: {
        __GWR_DEBUG_TIMINGS__: true
      },
      logger: {
        info(message, payload) {
          logs.push([message, payload]);
        },
        warn() {},
        log() {}
      }
    });

    const result = await runtime.processWatermarkBlob(
      new Blob(['raw'], { type: 'image/jpeg' }),
      { adaptiveMode: 'always', maxPasses: 1 }
    );

    assert.equal(result.processedMeta?.selectionDebug, selectionDebug);
    assert.equal(logs.length, 1);
    assert.equal(logs[0][0], '[Gemini Watermark Remover] timing process-blob-main-thread');
    assert.deepEqual(logs[0][1].selectionDebug, selectionDebug);
    assert.equal(logs[0][1].processorTotalMs, 12);
    assert.deepEqual(revokedUrls, ['blob:runtime-test']);
  } finally {
    WatermarkEngine.create = originalEngineCreate;
    globalThis.Image = originalImage;
    globalThis.URL = originalURL;
    if (globalThis.URL) {
      globalThis.URL.createObjectURL = originalCreateObjectURL;
      globalThis.URL.revokeObjectURL = originalRevokeObjectURL;
    }
  }
});

test('createUserscriptProcessingRuntime should report engine wait time when engine creation is slow', async () => {
  const originalEngineCreate = WatermarkEngine.create;
  const originalImage = globalThis.Image;
  const originalURL = globalThis.URL;
  const originalCreateObjectURL = globalThis.URL?.createObjectURL;
  const originalRevokeObjectURL = globalThis.URL?.revokeObjectURL;

  const logs = [];

  class MockImage {
    constructor() {
      this.width = 0;
      this.height = 0;
      this.onload = null;
      this.onerror = null;
    }

    set src(value) {
      this._src = value;
      this.width = 512;
      this.height = 512;
      queueMicrotask(() => {
        this.onload?.();
      });
    }
  }

  const mockCanvas = {
    __watermarkMeta: {
      applied: true
    },
    __watermarkTiming: {
      processor: {
        totalMs: 1
      }
    },
    toBlob(callback) {
      callback(new Blob(['processed'], { type: 'image/png' }));
    }
  };

  WatermarkEngine.create = async () => {
    await new Promise((resolve) => setTimeout(resolve, 25));
    return {
      async removeWatermarkFromImage() {
        return mockCanvas;
      }
    };
  };
  globalThis.Image = MockImage;
  globalThis.URL = originalURL;
  globalThis.URL.createObjectURL = () => 'blob:runtime-engine-wait';
  globalThis.URL.revokeObjectURL = () => {};

  try {
    const runtime = createUserscriptProcessingRuntime({
      workerCode: '',
      env: {
        __GWR_DEBUG_TIMINGS__: true
      },
      logger: {
        info(message, payload) {
          logs.push([message, payload]);
        },
        warn() {},
        log() {}
      }
    });

    await runtime.processWatermarkBlob(
      new Blob(['raw'], { type: 'image/png' }),
      { adaptiveMode: 'always' }
    );

    assert.equal(logs.length, 1);
    assert.equal(logs[0][0], '[Gemini Watermark Remover] timing process-blob-main-thread');
    assert.ok(
      typeof logs[0][1].engineWaitMs === 'number' && logs[0][1].engineWaitMs >= 20,
      `expected engineWaitMs to capture engine initialization delay, got ${logs[0][1].engineWaitMs}`
    );
  } finally {
    WatermarkEngine.create = originalEngineCreate;
    globalThis.Image = originalImage;
    globalThis.URL = originalURL;
    if (globalThis.URL) {
      globalThis.URL.createObjectURL = originalCreateObjectURL;
      globalThis.URL.revokeObjectURL = originalRevokeObjectURL;
    }
  }
});
