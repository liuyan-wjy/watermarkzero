import test from 'node:test';
import assert from 'node:assert/strict';
import { countOccurrences, hasImportedBinding, loadModuleSource } from '../testUtils/moduleStructure.js';

test('development preview and userscript runtime should both use shared watermark engine entry', () => {
    const appSource = loadModuleSource('../../src/app.js', import.meta.url);
    const userscriptEntrySource = loadModuleSource('../../src/userscript/index.js', import.meta.url);
    const userscriptRuntimeSource = loadModuleSource('../../src/userscript/processingRuntime.js', import.meta.url);

    assert.equal(hasImportedBinding(appSource, './core/watermarkEngine.js', 'WatermarkEngine'), true);
    assert.equal(hasImportedBinding(userscriptEntrySource, './processingRuntime.js', 'createUserscriptProcessingRuntime'), true);
    assert.equal(hasImportedBinding(userscriptRuntimeSource, '../shared/imageProcessing.js', 'createCachedCanvasProcessor'), true);
    assert.equal(hasImportedBinding(userscriptRuntimeSource, '../shared/imageProcessing.js', 'loadImageElementFromBlob'), true);
    assert.equal(hasImportedBinding(userscriptRuntimeSource, '../core/watermarkEngine.js', 'WatermarkEngine'), false);
    assert.equal(hasImportedBinding(appSource, './core/watermarkProcessor.js', 'processWatermarkImageData'), false);
    assert.equal(hasImportedBinding(userscriptRuntimeSource, '../core/watermarkProcessor.js', 'processWatermarkImageData'), false);
});

test('website worker bundle and userscript inline worker should both build from the shared worker entry', () => {
    const buildScript = loadModuleSource('../../build.js', import.meta.url);

    assert.equal(
        countOccurrences(buildScript, "entryPoints: ['src/workers/watermarkWorker.js']"),
        2,
        'build should reuse the same worker entry for the website worker bundle and userscript inline worker'
    );
});
