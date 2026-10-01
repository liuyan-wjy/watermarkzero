import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { loadModuleSource } from '../testUtils/moduleStructure.js';

const source = loadModuleSource('../../src/app.js', import.meta.url);

function uploader() {
    const messages = [];
    const processed = [];
    const context = {
        setStatusMessage: (message) => messages.push(message),
        i18n: { t: (key) => key },
        trackEvent() {},
        summarizeFormats() {},
        imageQueue: [],
        processedCount: 0,
        fileInput: { value: 'previous-selection' },
        singlePreview: { style: {} },
        multiPreview: { style: {}, scrollIntoView() {} },
        imageList: {},
        updateProgress() {},
        createImageCard() {},
        processQueue() { processed.push(...context.imageQueue); },
        processSingle: (item) => processed.push(item),
    };
    vm.runInNewContext(source.match(/function handleFiles\(files, source = 'picker'\) \{[\s\S]*?\n\}/)[0], context);
    return { context, messages, processed };
}

test('upload validation reports rejected formats and oversize files while processing valid files', () => {
    const { context, messages, processed } = uploader();
    context.handleFiles([
        { name: 'ok.png', type: 'image/png', size: 20 * 1024 * 1024 },
        { name: 'ok.webp', type: 'image/webp', size: 100 },
        { name: 'big.jpg', type: 'image/jpeg', size: 20 * 1024 * 1024 + 1 },
        { name: 'not-an-image.pdf', type: 'application/pdf', size: 100 },
        { name: 'bad.png', type: 'image/png-invalid', size: 100 },
    ]);
    assert.deepEqual(processed.map(({ name }) => name), ['ok.png', 'ok.webp']);
    assert.match(messages.at(-1), /upload\.error\.format/);
    assert.match(messages.at(-1), /upload\.error\.size/);
    assert.equal(context.fileInput.value, '', 'allow choosing the same file again');
});

test('rejected-only uploads remain visible, do not replace results, and reset the picker', () => {
    const { context, messages, processed } = uploader();
    const existing = { name: 'previous.png' };
    context.imageQueue = [existing];
    context.handleFiles([{ name: 'photo.heic', type: 'image/heic', size: 100 }]);
    assert.match(messages.at(-1), /upload\.error\.format/);
    assert.equal(processed.length, 0);
    assert.equal(context.imageQueue[0], existing);
    assert.equal(context.fileInput.value, '');
    const html = loadModuleSource('../../public/index.html', import.meta.url);
    assert.ok(html.indexOf('id="statusMessage"') < html.indexOf('id="singlePreview"'));
    assert.match(html, /id="statusMessage"[^>]*role="status"[^>]*aria-live="polite"/);
});

test('batch downloads preserve every image when source filenames share a basename', async () => {
    const entries = new Map();
    const context = {
        imageQueue: ['photo.jpg', 'photo.png', 'photo.png'].map((name, index) => ({ name, status: 'completed', processedBlob: index })),
        trackEvent() {},
        getProcessingOutcome: () => 'removed',
        JSZip: class {
            file(name, blob) { entries.set(name, blob); }
            async generateAsync() { return {}; }
        },
        document: { createElement: () => ({ click() {} }) },
        URL: { createObjectURL: () => 'blob:zip' },
    };
    vm.runInNewContext(source.match(/async function downloadAll\(\) \{[\s\S]*?\n\}/)[0], context);
    await context.downloadAll();
    assert.equal(entries.size, 3, 'same-name files must not overwrite ZIP entries');
    assert.deepEqual([...entries.values()], [0, 1, 2]);
});

test('a broken image is reported without stopping valid images in the batch', async () => {
    const errors = [];
    let progressUpdates = 0;
    const context = {
        imageQueue: ['broken.png', 'valid.png'].map((name, id) => ({ id, file: name, status: 'pending' })),
        processedCount: 0,
        loadImage: async (name) => { if (name === 'broken.png') throw new Error('decode'); return { src: 'blob:valid' }; },
        processImageWithBestPath: async () => ({ blob: {}, meta: {} }),
        document: { getElementById: () => ({ classList: { remove() {} } }) },
        URL: { createObjectURL: () => 'blob:processed' },
        zoom: { attach() {} },
        renderImageCardStatus: (item) => { if (item.status === 'error') errors.push(item.id); },
        updateProgress() { progressUpdates++; },
        downloadAllBtn: { style: {} },
        trackEvent() {},
        summarizeFormats() {},
        getProcessingOutcome: () => 'removed',
        console: { error() {} },
    };
    vm.runInNewContext(source.match(/async function processQueue\(\) \{[\s\S]*?\n\}/)[0], context);
    await context.processQueue();
    assert.deepEqual(errors, [0]);
    assert.equal(context.imageQueue[1].status, 'completed');
    assert.equal(context.processedCount, 1);
    assert.equal(progressUpdates, 2, 'every finished attempt refreshes the progress');
});

test('batch progress counts failures as finished attempts without changing successful count', () => {
    const context = {
        imageQueue: [{ status: 'error' }, { status: 'completed' }],
        processedCount: 1,
        progressText: {},
        i18n: { t: () => 'Progress' },
    };
    vm.runInNewContext(source.match(/function updateProgress\(\) \{[\s\S]*?\n\}/)[0], context);
    context.updateProgress();
    assert.equal(context.progressText.textContent, 'Progress: 2/2');
    assert.equal(context.processedCount, 1);
});

test('single-image decoding failures show a user-facing message', async () => {
    const messages = [];
    const context = {
        loadImage: async () => { throw new Error('decode'); },
        setStatusMessage: (message) => messages.push(message),
        i18n: { t: (key) => key },
        trackEvent() {},
        console: { error() {} },
    };
    vm.runInNewContext(source.match(/async function processSingle\(item\) \{[\s\S]*?\n\}/)[0], context);
    await context.processSingle({ file: {} });
    assert.deepEqual(messages, ['upload.error.process']);
});
