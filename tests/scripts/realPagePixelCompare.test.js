import test from 'node:test';
import assert from 'node:assert/strict';

import {
  DEFAULT_REAL_PAGE_PIXEL_COMPARE_CDP_URL,
  DEFAULT_REAL_PAGE_PIXEL_COMPARE_OUTPUT_ROOT,
  collectReadyProcessedImageIndexes,
  findReadyProcessedImageIndex,
  parseRealPagePixelCompareCliArgs,
  resolveComparableBeforeUrl
} from '../../scripts/real-page-pixel-compare.js';

test('parseRealPagePixelCompareCliArgs should default to fixed CDP endpoint and artifact root', () => {
  const parsed = parseRealPagePixelCompareCliArgs([]);

  assert.equal(parsed.cdpUrl, DEFAULT_REAL_PAGE_PIXEL_COMPARE_CDP_URL);
  assert.equal(parsed.outputRoot, DEFAULT_REAL_PAGE_PIXEL_COMPARE_OUTPUT_ROOT);
  assert.equal(parsed.pageUrlPrefix, 'https://gemini.google.com/app');
  assert.equal(parsed.imageIndex, 0);
  assert.equal(parsed.all, false);
});

test('parseRealPagePixelCompareCliArgs should accept explicit overrides', () => {
  const parsed = parseRealPagePixelCompareCliArgs([
    '--cdp',
    'http://127.0.0.1:9333',
    '--output-root',
    '.artifacts/custom-real-page',
    '--page-prefix',
    'https://gemini.google.com/app/thread',
    '--all',
    '--image-index',
    '3'
  ]);

  assert.equal(parsed.cdpUrl, 'http://127.0.0.1:9333');
  assert.match(parsed.outputRoot, /custom-real-page$/);
  assert.equal(parsed.pageUrlPrefix, 'https://gemini.google.com/app/thread');
  assert.equal(parsed.imageIndex, 3);
  assert.equal(parsed.all, true);
});

test('findReadyProcessedImageIndex should pick the Nth ready processed image', () => {
  const images = [
    { state: '', objectUrl: '' },
    { state: 'ready', objectUrl: 'blob:processed-1' },
    { state: 'processing', objectUrl: '' },
    { state: 'ready', objectUrl: 'blob:processed-2' }
  ];

  assert.equal(findReadyProcessedImageIndex(images, 0), 1);
  assert.equal(findReadyProcessedImageIndex(images, 1), 3);
  assert.equal(findReadyProcessedImageIndex(images, 2), -1);
});

test('collectReadyProcessedImageIndexes should return all ready processed image indexes in DOM order', () => {
  const images = [
    { state: 'ready', objectUrl: 'blob:processed-0' },
    { state: '', objectUrl: '' },
    { state: 'ready', objectUrl: 'blob:processed-2' },
    { state: 'ready', objectUrl: '' },
    { state: 'ready', objectUrl: 'blob:processed-4' }
  ];

  assert.deepEqual(collectReadyProcessedImageIndexes(images), [0, 2, 4]);
});

test('resolveComparableBeforeUrl should prefer stableSource then sourceUrl and avoid the processed object url', () => {
  assert.equal(
    resolveComparableBeforeUrl({
      stableSource: 'blob:https://gemini.google.com/stable',
      sourceUrl: 'https://lh3.googleusercontent.com/gg/source=s0-rj',
      currentSrc: 'blob:https://gemini.google.com/original',
      src: 'blob:https://gemini.google.com/original',
      objectUrl: 'blob:https://gemini.google.com/processed'
    }),
    'blob:https://gemini.google.com/stable'
  );

  assert.equal(
    resolveComparableBeforeUrl({
      stableSource: '',
      sourceUrl: 'https://lh3.googleusercontent.com/gg/source=s0-rj',
      currentSrc: 'blob:https://gemini.google.com/original',
      src: 'blob:https://gemini.google.com/original',
      objectUrl: 'blob:https://gemini.google.com/processed'
    }),
    'https://lh3.googleusercontent.com/gg/source=s0-rj'
  );

  assert.equal(
    resolveComparableBeforeUrl({
      stableSource: '',
      sourceUrl: '',
      currentSrc: 'blob:https://gemini.google.com/processed',
      src: 'blob:https://gemini.google.com/original',
      objectUrl: 'blob:https://gemini.google.com/processed'
    }),
    'blob:https://gemini.google.com/original'
  );
});
