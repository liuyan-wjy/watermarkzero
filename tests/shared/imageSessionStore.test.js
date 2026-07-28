import test from 'node:test';
import assert from 'node:assert/strict';

import {
  buildImageSessionKey,
  createImageSessionStore,
  normalizeImageSessionAssetIds
} from '../../src/shared/imageSessionStore.js';

test('buildImageSessionKey should prefer draft ids for stable Gemini image sessions', () => {
  assert.equal(
    buildImageSessionKey({
      responseId: 'r_example',
      draftId: 'rc_example',
      conversationId: 'c_example'
    }),
    'draft:rc_example'
  );
});

test('normalizeImageSessionAssetIds should keep individually valid Gemini ids', () => {
  assert.deepEqual(
    normalizeImageSessionAssetIds({
      responseId: 'invalid',
      draftId: '',
      conversationId: 'c_example'
    }),
    {
      responseId: '',
      draftId: '',
      conversationId: 'c_example'
    }
  );
});

test('createImageSessionStore should keep original, processed, and surface state under one session', () => {
  const store = createImageSessionStore({
    now: () => 123456
  });
  const assetIds = {
    responseId: 'r_example',
    draftId: 'rc_example',
    conversationId: 'c_example'
  };
  const sessionKey = store.getOrCreateByAssetIds(assetIds);
  const previewElement = {};

  store.attachElement(sessionKey, 'preview', previewElement);
  store.updateOriginalSource(sessionKey, 'https://lh3.googleusercontent.com/rd-gg/example=s0-rp');
  store.updateSourceSnapshot(sessionKey, {
    sourceUrl: 'blob:https://gemini.google.com/example-preview',
    isPreviewSource: true
  });
  store.markProcessing(sessionKey, 'preview', 'processing');
  store.updateProcessedResult(sessionKey, {
    objectUrl: 'blob:https://gemini.google.com/example-processed',
    blobType: 'image/png',
    processedFrom: 'page-fetch'
  });
  store.markProcessing(sessionKey, 'preview', 'ready');

  const snapshot = store.getSnapshot(sessionKey);
  assert.equal(snapshot?.sources?.originalUrl, 'https://lh3.googleusercontent.com/rd-gg/example=s0-rp');
  assert.equal(snapshot?.sources?.currentBlobUrl, 'blob:https://gemini.google.com/example-preview');
  assert.equal(snapshot?.derived?.processedBlobUrl, 'blob:https://gemini.google.com/example-processed');
  assert.equal(snapshot?.derived?.processedFrom, 'page-fetch');
  assert.equal(snapshot?.state?.preview, 'ready');
  assert.equal(snapshot?.surfaces?.previewCount, 1);

  const resource = store.getBestResource(sessionKey, 'clipboard');
  assert.deepEqual(resource, {
    kind: 'original',
    url: 'https://lh3.googleusercontent.com/rd-gg/example=s0-rp',
    mimeType: '',
    processedMeta: null,
    source: 'original'
  });
});

test('createImageSessionStore should keep preview and full processed resources in separate slots', () => {
  const store = createImageSessionStore({
    now: () => 123456
  });
  const sessionKey = store.getOrCreateByAssetIds({
    responseId: 'r_slots_example',
    draftId: 'rc_slots_example',
    conversationId: 'c_slots_example'
  });

  store.updateOriginalSource(sessionKey, 'https://lh3.googleusercontent.com/rd-gg/slots=s0-rp');
  store.updateProcessedResult(sessionKey, {
    slot: 'preview',
    objectUrl: 'blob:https://gemini.google.com/slots-preview',
    blobType: 'image/png',
    processedFrom: 'preview-candidate'
  });
  store.updateProcessedResult(sessionKey, {
    slot: 'full',
    objectUrl: 'blob:https://gemini.google.com/slots-full',
    blobType: 'image/png',
    processedFrom: 'original-download'
  });

  assert.deepEqual(store.getBestResource(sessionKey, 'display'), {
    kind: 'processed',
    url: 'blob:https://gemini.google.com/slots-preview',
    mimeType: 'image/png',
    processedMeta: null,
    source: 'preview-candidate',
    slot: 'preview'
  });

  assert.deepEqual(store.getBestResource(sessionKey, 'clipboard'), {
    kind: 'processed',
    url: 'blob:https://gemini.google.com/slots-full',
    mimeType: 'image/png',
    processedMeta: null,
    source: 'original-download',
    slot: 'full'
  });

  assert.deepEqual(store.getBestResource(sessionKey, 'download'), {
    kind: 'processed',
    url: 'blob:https://gemini.google.com/slots-full',
    mimeType: 'image/png',
    processedMeta: null,
    source: 'original-download',
    slot: 'full'
  });
});

test('createImageSessionStore should keep the raw processed blob on a slot resource when provided', () => {
  const store = createImageSessionStore({
    now: () => 123456
  });
  const sessionKey = store.getOrCreateByAssetIds({
    responseId: 'r_blob_example',
    draftId: 'rc_blob_example',
    conversationId: 'c_blob_example'
  });
  const fullBlob = new Blob(['full-processed'], { type: 'image/png' });

  store.updateProcessedResult(sessionKey, {
    slot: 'full',
    objectUrl: 'blob:https://gemini.google.com/blob-full',
    blob: fullBlob,
    blobType: 'image/png',
    processedFrom: 'original-download'
  });

  const resource = store.getBestResource(sessionKey, 'download');
  assert.equal(resource?.blob, fullBlob);
  assert.equal(resource?.slot, 'full');
});

test('createImageSessionStore should not treat preview-only processed resources as valid clipboard or download output', () => {
  const store = createImageSessionStore({
    now: () => 123456
  });
  const sessionKey = store.getOrCreateByAssetIds({
    responseId: 'r_preview_only_example',
    draftId: 'rc_preview_only_example',
    conversationId: 'c_preview_only_example'
  });

  store.updateOriginalSource(sessionKey, 'https://lh3.googleusercontent.com/rd-gg/preview-only=s0-rp');
  store.updateProcessedResult(sessionKey, {
    slot: 'preview',
    objectUrl: 'blob:https://gemini.google.com/preview-only',
    blobType: 'image/png',
    processedFrom: 'preview-candidate'
  });

  assert.deepEqual(store.getBestResource(sessionKey, 'clipboard'), {
    kind: 'original',
    url: 'https://lh3.googleusercontent.com/rd-gg/preview-only=s0-rp',
    mimeType: '',
    processedMeta: null,
    source: 'original'
  });

  assert.deepEqual(store.getBestResource(sessionKey, 'download'), {
    kind: 'original',
    url: 'https://lh3.googleusercontent.com/rd-gg/preview-only=s0-rp',
    mimeType: '',
    processedMeta: null,
    source: 'original'
  });
});

test('createImageSessionStore should keep request-layer preview resources display-only while full slot remains action-critical', () => {
  const store = createImageSessionStore({
    now: () => 123456
  });
  const previewBlob = new Blob(['preview'], { type: 'image/png' });
  const sessionKey = store.getOrCreateByAssetIds({
    responseId: 'r_preview_phase2',
    draftId: 'rc_preview_phase2',
    conversationId: 'c_preview_phase2'
  });

  store.updateProcessedResult(sessionKey, {
    slot: 'preview',
    objectUrl: 'blob:https://gemini.google.com/preview-phase2',
    blob: previewBlob,
    blobType: 'image/png',
    processedFrom: 'request-preview'
  });

  assert.deepEqual(store.getBestResource(sessionKey, 'display'), {
    kind: 'processed',
    url: 'blob:https://gemini.google.com/preview-phase2',
    blob: previewBlob,
    mimeType: 'image/png',
    processedMeta: null,
    source: 'request-preview',
    slot: 'preview'
  });
  assert.equal(store.getBestResource(sessionKey, 'clipboard')?.slot, undefined);
  assert.equal(store.getBestResource(sessionKey, 'download')?.slot, undefined);
});

test('createImageSessionStore should prefer a processed preview element for clipboard-style actions', () => {
  const store = createImageSessionStore({
    now: () => 123456
  });
  const sessionKey = store.getOrCreateByAssetIds({
    responseId: 'r_element_example',
    draftId: 'rc_element_example',
    conversationId: 'c_element_example'
  });
  const fullscreenElement = {
    dataset: {}
  };
  const previewElement = {
    dataset: {
      gwrWatermarkObjectUrl: 'blob:https://gemini.google.com/element-preview'
    }
  };

  store.attachElement(sessionKey, 'fullscreen', fullscreenElement);
  store.attachElement(sessionKey, 'preview', previewElement);

  assert.equal(store.getPreferredElement(sessionKey, 'clipboard'), previewElement);
  assert.equal(store.getPreferredElement(sessionKey, 'display'), previewElement);
  assert.equal(store.getPreferredElement(sessionKey, 'download'), previewElement);
});
