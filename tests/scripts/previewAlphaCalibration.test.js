import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { readFile } from 'node:fs/promises';

import {
    buildPreviewAlphaOutputPath,
    parsePreviewAlphaCalibrationCliArgs
} from '../../scripts/calibrate-preview-alpha.js';

test('parsePreviewAlphaCalibrationCliArgs should default to sample pair manifest and artifact output', () => {
    const parsed = parsePreviewAlphaCalibrationCliArgs([]);

    assert.equal(
        parsed.outputPath,
        path.resolve('.artifacts/preview-alpha-map/preview-alpha-map.json')
    );
    assert.deepEqual(parsed.pairs, []);
});

test('parsePreviewAlphaCalibrationCliArgs should parse repeated source-preview pairs and explicit output', () => {
    const parsed = parsePreviewAlphaCalibrationCliArgs([
        '--pair',
        'src/assets/samples/21-9.webp',
        'src/assets/samples/21-9-preview.png',
        '--pair',
        'src/assets/samples/9-16.webp',
        'src/assets/samples/9-16-preview.png',
        '--output',
        'tmp/preview-alpha.json'
    ]);

    assert.deepEqual(parsed.pairs, [
        {
            sourcePath: path.resolve('src/assets/samples/21-9.webp'),
            previewPath: path.resolve('src/assets/samples/21-9-preview.png')
        },
        {
            sourcePath: path.resolve('src/assets/samples/9-16.webp'),
            previewPath: path.resolve('src/assets/samples/9-16-preview.png')
        }
    ]);
    assert.equal(parsed.outputPath, path.resolve('tmp/preview-alpha.json'));
});

test('buildPreviewAlphaOutputPath should bucket results by detected preview watermark size', () => {
    const output = buildPreviewAlphaOutputPath({
        outputRoot: path.resolve('.artifacts/preview-alpha-map'),
        size: 30
    });

    assert.equal(output, path.resolve('.artifacts/preview-alpha-map/preview-alpha-map-30.json'));
});

test('preview alpha calibration script should stay node-only without playwright', async () => {
    const source = await readFile(new URL('../../scripts/calibrate-preview-alpha.js', import.meta.url), 'utf8');

    assert.doesNotMatch(source, /playwright/);
    assert.doesNotMatch(source, /chromium\.launch/);
});
