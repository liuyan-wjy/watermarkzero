import path from 'node:path';
import { mkdir, writeFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';

import { chromium } from 'playwright';

import { calculateAlphaMap } from '../src/core/alphaMap.js';
import {
  computeRegionGradientCorrelation,
  computeRegionSpatialCorrelation,
  interpolateAlphaMap
} from '../src/core/adaptiveDetector.js';
import { processWatermarkImageData } from '../src/core/watermarkProcessor.js';
import { calculateNearBlackRatio } from '../src/core/restorationMetrics.js';
import { decodeImageDataInPage } from '../tests/regression/sampleAssetTestUtils.js';

export const DEFAULT_REAL_PAGE_PIXEL_COMPARE_CDP_URL = 'http://127.0.0.1:9226';
export const DEFAULT_REAL_PAGE_PIXEL_COMPARE_OUTPUT_ROOT = path.resolve('.artifacts/real-page-pixel-compare');
const DEFAULT_REAL_PAGE_PIXEL_COMPARE_PAGE_PREFIX = 'https://gemini.google.com/app';

function assertNonNegativeInteger(value, flagName) {
  const parsed = Number.parseInt(String(value ?? ''), 10);
  if (!Number.isInteger(parsed) || parsed < 0) {
    throw new Error(`${flagName} must be a non-negative integer`);
  }
  return parsed;
}

function sanitizeTimestamp(date = new Date()) {
  return date.toISOString().replace(/[:.]/g, '-');
}

function dataUrlToBuffer(dataUrl) {
  const marker = ';base64,';
  const markerIndex = typeof dataUrl === 'string' ? dataUrl.indexOf(marker) : -1;
  if (markerIndex === -1) {
    throw new Error('Invalid data URL');
  }
  return Buffer.from(dataUrl.slice(markerIndex + marker.length), 'base64');
}

export function findReadyProcessedImageIndex(images = [], targetIndex = 0) {
  const readyImages = images
    .map((image, index) => ({ ...image, index }))
    .filter((image) => image?.state === 'ready' && typeof image?.objectUrl === 'string' && image.objectUrl.startsWith('blob:'));

  return readyImages[targetIndex]?.index ?? -1;
}

export function collectReadyProcessedImageIndexes(images = []) {
  return images
    .map((image, index) => ({ ...image, index }))
    .filter((image) => image?.state === 'ready' && typeof image?.objectUrl === 'string' && image.objectUrl.startsWith('blob:'))
    .map((image) => image.index);
}

export function resolveComparableBeforeUrl(target = {}) {
  const candidates = [
    target?.stableSource,
    target?.sourceUrl,
    target?.currentSrc,
    target?.src
  ];

  for (const candidate of candidates) {
    const value = typeof candidate === 'string' ? candidate.trim() : '';
    if (!value) {
      continue;
    }
    if (value === target?.objectUrl) {
      continue;
    }
    return value;
  }

  return '';
}

export function parseRealPagePixelCompareCliArgs(argv = []) {
  const args = [...argv];
  const parsed = {
    cdpUrl: DEFAULT_REAL_PAGE_PIXEL_COMPARE_CDP_URL,
    outputRoot: DEFAULT_REAL_PAGE_PIXEL_COMPARE_OUTPUT_ROOT,
    pageUrlPrefix: DEFAULT_REAL_PAGE_PIXEL_COMPARE_PAGE_PREFIX,
    imageIndex: 0,
    all: false
  };

  while (args.length > 0) {
    const arg = args.shift();
    if (arg === '--cdp') {
      parsed.cdpUrl = String(args.shift() || parsed.cdpUrl);
      continue;
    }
    if (arg === '--output-root') {
      parsed.outputRoot = path.resolve(args.shift() || parsed.outputRoot);
      continue;
    }
    if (arg === '--page-prefix') {
      parsed.pageUrlPrefix = String(args.shift() || parsed.pageUrlPrefix);
      continue;
    }
    if (arg === '--image-index') {
      parsed.imageIndex = assertNonNegativeInteger(args.shift(), '--image-index');
      continue;
    }
    if (arg === '--all') {
      parsed.all = true;
      continue;
    }
    throw new Error(`Unknown argument: ${arg}`);
  }

  return parsed;
}

async function listCandidateImages(page) {
  return page.evaluate(() => {
    return Array.from(document.querySelectorAll('img')).map((img, index) => ({
      index,
      src: img.getAttribute('src') || '',
      currentSrc: img.currentSrc || '',
      complete: img.complete,
      naturalWidth: img.naturalWidth,
      naturalHeight: img.naturalHeight,
      width: img.width,
      height: img.height,
      state: img.dataset?.gwrPageImageState || '',
      stableSource: img.dataset?.gwrStableSource || '',
      sourceUrl: img.dataset?.gwrSourceUrl || '',
      objectUrl: img.dataset?.gwrWatermarkObjectUrl || '',
      className: img.className || ''
    }));
  });
}

async function captureTargetPair(page, domImageIndex) {
  return page.evaluate(async (targetIndex) => {
    const target = Array.from(document.querySelectorAll('img'))[targetIndex];
    if (!target) {
      throw new Error(`Target image not found: ${targetIndex}`);
    }

    const toPngDataUrl = async (url) => {
      const img = new Image();
      img.src = url;
      await img.decode();
      const canvas = document.createElement('canvas');
      canvas.width = img.naturalWidth;
      canvas.height = img.naturalHeight;
      const ctx = canvas.getContext('2d', { willReadFrequently: true });
      ctx.drawImage(img, 0, 0);
      const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
      return {
        width: imageData.width,
        height: imageData.height,
        data: Array.from(imageData.data),
        pngDataUrl: canvas.toDataURL('image/png')
      };
    };

    const targetInfo = {
      domImageIndex: targetIndex,
      stableSource: target.dataset.gwrStableSource || '',
      sourceUrl: target.dataset.gwrSourceUrl || '',
      objectUrl: target.dataset.gwrWatermarkObjectUrl || '',
      currentSrc: target.currentSrc || '',
      src: target.getAttribute('src') || '',
      naturalWidth: target.naturalWidth,
      naturalHeight: target.naturalHeight,
      width: target.width,
      height: target.height
    };
    const beforeUrl = [
      targetInfo.stableSource,
      targetInfo.sourceUrl,
      targetInfo.currentSrc,
      targetInfo.src
    ].find((candidate) => {
      const value = typeof candidate === 'string' ? candidate.trim() : '';
      return value && value !== targetInfo.objectUrl;
    }) || '';
    if (!beforeUrl) {
      throw new Error(`No comparable before url found for target image ${targetIndex}`);
    }

    const before = await toPngDataUrl(beforeUrl);
    const after = await toPngDataUrl(targetInfo.objectUrl);

    return {
      target: {
        ...targetInfo,
        beforeUrl
      },
      before,
      after
    };
  }, domImageIndex);
}

async function captureDerivedVisuals(page, {
  beforeUrl,
  afterUrl,
  position
}) {
  return page.evaluate(async ({ beforeUrl, afterUrl, position }) => {
    const loadCanvas = async (url) => {
      const img = new Image();
      img.src = url;
      await img.decode();
      const canvas = document.createElement('canvas');
      canvas.width = img.naturalWidth;
      canvas.height = img.naturalHeight;
      const ctx = canvas.getContext('2d', { willReadFrequently: true });
      ctx.drawImage(img, 0, 0);
      return { canvas, ctx };
    };

    const cropCanvas = (sourceCanvas, rect) => {
      const canvas = document.createElement('canvas');
      canvas.width = rect.width;
      canvas.height = rect.height;
      const ctx = canvas.getContext('2d', { willReadFrequently: true });
      ctx.drawImage(
        sourceCanvas,
        rect.x,
        rect.y,
        rect.width,
        rect.height,
        0,
        0,
        rect.width,
        rect.height
      );
      return canvas;
    };

    const createDiffCanvas = (beforeCanvas, afterCanvas) => {
      const width = beforeCanvas.width;
      const height = beforeCanvas.height;
      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext('2d', { willReadFrequently: true });
      const beforeData = beforeCanvas.getContext('2d', { willReadFrequently: true }).getImageData(0, 0, width, height);
      const afterData = afterCanvas.getContext('2d', { willReadFrequently: true }).getImageData(0, 0, width, height);
      const diff = ctx.createImageData(width, height);

      for (let offset = 0; offset < diff.data.length; offset += 4) {
        diff.data[offset] = Math.abs(beforeData.data[offset] - afterData.data[offset]);
        diff.data[offset + 1] = Math.abs(beforeData.data[offset + 1] - afterData.data[offset + 1]);
        diff.data[offset + 2] = Math.abs(beforeData.data[offset + 2] - afterData.data[offset + 2]);
        diff.data[offset + 3] = 255;
      }

      ctx.putImageData(diff, 0, 0);
      return canvas;
    };

    const { canvas: beforeCanvas } = await loadCanvas(beforeUrl);
    const { canvas: afterCanvas } = await loadCanvas(afterUrl);
    const beforeCropCanvas = cropCanvas(beforeCanvas, position);
    const afterCropCanvas = cropCanvas(afterCanvas, position);
    const diffCropCanvas = createDiffCanvas(beforeCropCanvas, afterCropCanvas);

    return {
      beforeCropPngDataUrl: beforeCropCanvas.toDataURL('image/png'),
      afterCropPngDataUrl: afterCropCanvas.toDataURL('image/png'),
      diffCropPngDataUrl: diffCropCanvas.toDataURL('image/png')
    };
  }, {
    beforeUrl,
    afterUrl,
    position
  });
}

async function writeArtifactFile(filePath, contents) {
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, contents);
}

export async function runRealPagePixelCompare({
  cdpUrl = DEFAULT_REAL_PAGE_PIXEL_COMPARE_CDP_URL,
  outputRoot = DEFAULT_REAL_PAGE_PIXEL_COMPARE_OUTPUT_ROOT,
  pageUrlPrefix = DEFAULT_REAL_PAGE_PIXEL_COMPARE_PAGE_PREFIX,
  imageIndex = 0,
  domImageIndex: requestedDomImageIndex = null
} = {}) {
  const browser = await chromium.connectOverCDP(cdpUrl);

  try {
    const page = browser
      .contexts()
      .flatMap((context) => context.pages())
      .find((candidatePage) => candidatePage.url().startsWith(pageUrlPrefix));
    if (!page) {
      throw new Error(`No page matched prefix: ${pageUrlPrefix}`);
    }

    const images = await listCandidateImages(page);
    const domImageIndex = Number.isInteger(requestedDomImageIndex)
      ? requestedDomImageIndex
      : findReadyProcessedImageIndex(images, imageIndex);
    if (domImageIndex < 0) {
      throw new Error(`No ready processed image found for ordinal ${imageIndex}`);
    }

    const captured = await captureTargetPair(page, domImageIndex);
    const beforeImageData = {
      width: captured.before.width,
      height: captured.before.height,
      data: new Uint8ClampedArray(captured.before.data)
    };
    const afterImageData = {
      width: captured.after.width,
      height: captured.after.height,
      data: new Uint8ClampedArray(captured.after.data)
    };

    const alpha48 = calculateAlphaMap(await decodeImageDataInPage(page, path.resolve('src/assets/bg_48.png')));
    const alpha96 = calculateAlphaMap(await decodeImageDataInPage(page, path.resolve('src/assets/bg_96.png')));
    const processed = processWatermarkImageData(beforeImageData, {
      alpha48,
      alpha96,
      adaptiveMode: 'never',
      debugTimings: true,
      getAlphaMap: (size) => interpolateAlphaMap(alpha96, 96, size)
    });
    const position = processed.meta.position;
    const alphaMap = interpolateAlphaMap(alpha96, 96, position.width);

    const visuals = await captureDerivedVisuals(page, {
      beforeUrl: captured.target.beforeUrl,
      afterUrl: captured.target.objectUrl,
      position
    });

    const outputDir = path.join(outputRoot, sanitizeTimestamp());
    const beforePath = path.join(outputDir, 'before-original.png');
    const afterPath = path.join(outputDir, 'after-processed.png');
    const beforeCropPath = path.join(outputDir, 'before-crop.png');
    const afterCropPath = path.join(outputDir, 'after-crop.png');
    const diffCropPath = path.join(outputDir, 'diff-crop.png');
    const comparePath = path.join(outputDir, 'compare.json');

    await writeArtifactFile(beforePath, dataUrlToBuffer(captured.before.pngDataUrl));
    await writeArtifactFile(afterPath, dataUrlToBuffer(captured.after.pngDataUrl));
    await writeArtifactFile(beforeCropPath, dataUrlToBuffer(visuals.beforeCropPngDataUrl));
    await writeArtifactFile(afterCropPath, dataUrlToBuffer(visuals.afterCropPngDataUrl));
    await writeArtifactFile(diffCropPath, dataUrlToBuffer(visuals.diffCropPngDataUrl));

    const report = {
      generatedAt: new Date().toISOString(),
      cdpUrl,
      pageUrl: page.url(),
      pageUrlPrefix,
      imageOrdinal: imageIndex,
      domImageIndex,
      target: captured.target,
      predictedDetection: {
        source: processed.meta.source,
        decisionTier: processed.meta.decisionTier,
        position,
        debugTimings: processed.debugTimings ?? null
      },
      metrics: {
        beforeSpatial: computeRegionSpatialCorrelation({
          imageData: beforeImageData,
          alphaMap,
          region: { x: position.x, y: position.y, size: position.width }
        }),
        beforeGradient: computeRegionGradientCorrelation({
          imageData: beforeImageData,
          alphaMap,
          region: { x: position.x, y: position.y, size: position.width }
        }),
        beforeNearBlack: calculateNearBlackRatio(beforeImageData, position),
        afterSpatial: computeRegionSpatialCorrelation({
          imageData: afterImageData,
          alphaMap,
          region: { x: position.x, y: position.y, size: position.width }
        }),
        afterGradient: computeRegionGradientCorrelation({
          imageData: afterImageData,
          alphaMap,
          region: { x: position.x, y: position.y, size: position.width }
        }),
        afterNearBlack: calculateNearBlackRatio(afterImageData, position)
      },
      artifacts: {
        beforePath,
        afterPath,
        beforeCropPath,
        afterCropPath,
        diffCropPath
      }
    };

    await writeArtifactFile(comparePath, `${JSON.stringify(report, null, 2)}\n`);
    return {
      outputDir,
      comparePath,
      report
    };
  } finally {
    await browser.close();
  }
}

export async function runRealPagePixelCompareAll({
  cdpUrl = DEFAULT_REAL_PAGE_PIXEL_COMPARE_CDP_URL,
  outputRoot = DEFAULT_REAL_PAGE_PIXEL_COMPARE_OUTPUT_ROOT,
  pageUrlPrefix = DEFAULT_REAL_PAGE_PIXEL_COMPARE_PAGE_PREFIX
} = {}) {
  const browser = await chromium.connectOverCDP(cdpUrl);

  try {
    const page = browser
      .contexts()
      .flatMap((context) => context.pages())
      .find((candidatePage) => candidatePage.url().startsWith(pageUrlPrefix));
    if (!page) {
      throw new Error(`No page matched prefix: ${pageUrlPrefix}`);
    }

    const images = await listCandidateImages(page);
    const imageIndexes = collectReadyProcessedImageIndexes(images);
    const results = [];
    for (let ordinal = 0; ordinal < imageIndexes.length; ordinal += 1) {
      const result = await runRealPagePixelCompare({
        cdpUrl,
        outputRoot,
        pageUrlPrefix,
        imageIndex: ordinal,
        domImageIndex: imageIndexes[ordinal]
      });
      results.push(result);
    }

    const summary = results.map((item) => ({
      imageIndex: item.report.imageOrdinal,
      domImageIndex: item.report.domImageIndex,
      outputDir: item.outputDir,
      metrics: item.report.metrics
    }));

    const summaryPath = path.join(outputRoot, 'latest-summary.json');
    await writeArtifactFile(summaryPath, `${JSON.stringify({
      generatedAt: new Date().toISOString(),
      cdpUrl,
      pageUrlPrefix,
      total: results.length,
      results: summary
    }, null, 2)}\n`);

    return {
      total: results.length,
      summaryPath,
      results
    };
  } finally {
    await browser.close();
  }
}

async function runCli() {
  const options = parseRealPagePixelCompareCliArgs(process.argv.slice(2));
  if (options.all) {
    const result = await runRealPagePixelCompareAll(options);
    console.log(`total: ${result.total}`);
    console.log(`summary: ${result.summaryPath}`);
    for (const item of result.results) {
      console.log(
        `imageIndex=${item.report.imageOrdinal} ` +
        `afterSpatial=${item.report.metrics.afterSpatial.toFixed(6)} ` +
        `afterGradient=${item.report.metrics.afterGradient.toFixed(6)} ` +
        `outputDir=${item.outputDir}`
      );
    }
    return;
  }

  const result = await runRealPagePixelCompare(options);
  console.log(`outputDir: ${result.outputDir}`);
  console.log(`compare: ${result.comparePath}`);
  console.log(
    `metrics: beforeSpatial=${result.report.metrics.beforeSpatial.toFixed(6)} ` +
    `afterSpatial=${result.report.metrics.afterSpatial.toFixed(6)} ` +
    `beforeGradient=${result.report.metrics.beforeGradient.toFixed(6)} ` +
    `afterGradient=${result.report.metrics.afterGradient.toFixed(6)}`
  );
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  runCli().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
