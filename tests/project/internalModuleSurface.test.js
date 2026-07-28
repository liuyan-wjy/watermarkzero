import test from 'node:test';
import assert from 'node:assert/strict';

test('internal helper modules should not expose implementation-detail exports', async () => {
  const [
    adaptiveDetector,
    candidateSelector,
    geminiSizeCatalog,
    errorUtils,
    imageProcessing,
    originalBlob
  ] = await Promise.all([
    import('../../src/core/adaptiveDetector.js'),
    import('../../src/core/candidateSelector.js'),
    import('../../src/core/geminiSizeCatalog.js'),
    import('../../src/shared/errorUtils.js'),
    import('../../src/shared/imageProcessing.js'),
    import('../../src/shared/originalBlob.js')
  ]);

  assert.equal('shiftAlphaMap' in adaptiveDetector, false);

  assert.equal('resolveAlphaMapForSize' in candidateSelector, false);
  assert.equal('pickBestValidatedCandidate' in candidateSelector, false);
  assert.equal('findBestTemplateWarp' in candidateSelector, false);

  assert.equal('isOfficialOrKnownGeminiDimensions' in geminiSizeCatalog, false);
  assert.equal('buildErrorDebugInfo' in errorUtils, false);

  assert.equal('createMainThreadBlobProcessor' in imageProcessing, false);
  assert.equal('processWatermarkBlobOnMainThread' in imageProcessing, false);

  assert.equal('shouldFetchBlobDirectly' in originalBlob, false);
});
