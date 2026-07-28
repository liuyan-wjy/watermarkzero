import test from 'node:test';
import assert from 'node:assert/strict';

import { hasImportedBinding, loadModuleSource } from '../testUtils/moduleStructure.js';

test('page process runtime should reuse shared image-processing helpers', () => {
  const source = loadModuleSource('../../src/page/pageProcessRuntime.js', import.meta.url);

  assert.equal(hasImportedBinding(source, '../shared/imageProcessing.js', 'createCachedImageProcessor'), true);
  assert.equal(hasImportedBinding(source, '../shared/imageProcessing.js', 'loadImageElementFromBlob'), true);
  assert.equal(hasImportedBinding(source, '../core/watermarkEngine.js', 'WatermarkEngine'), false);
  assert.equal(hasImportedBinding(source, '../core/canvasBlob.js', 'canvasToBlob'), false);
});
