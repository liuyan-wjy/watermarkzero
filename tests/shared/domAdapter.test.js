import test from 'node:test';
import assert from 'node:assert/strict';

import {
  extractGeminiImageAssetIds,
  getGeminiImageQuerySelector,
  getPreferredGeminiImageContainer,
  resolveCandidateImageUrl,
  isProcessableGeminiImageElement
} from '../../src/shared/domAdapter.js';

test('getGeminiImageQuerySelector should target img descendants for every Gemini container selector', () => {
  assert.equal(
    getGeminiImageQuerySelector(),
    'generated-image img,.generated-image-container img'
  );
});

test('resolveCandidateImageUrl should prefer explicit data-gwr-source-url over rendered src', () => {
    const url = resolveCandidateImageUrl({
    dataset: {
      gwrSourceUrl: 'https://lh3.googleusercontent.com/rd-gg/example=s1024'
    },
    currentSrc: 'http://127.0.0.1:8080/src/assets/samples/16-9.png',
    src: 'http://127.0.0.1:8080/src/assets/samples/16-9.png'
  });

  assert.equal(url, 'https://lh3.googleusercontent.com/rd-gg/example=s1024');
});

test('resolveCandidateImageUrl should ignore processed preview images', () => {
  const url = resolveCandidateImageUrl({
    dataset: {
      gwrPreviewImage: 'true',
      gwrSourceUrl: 'https://lh3.googleusercontent.com/rd-gg/example=s1024'
    },
    currentSrc: 'blob:https://gemini.google.com/processed',
    src: 'blob:https://gemini.google.com/processed'
  });

  assert.equal(url, '');
});

test('resolveCandidateImageUrl should keep stable source when current image src is replaced with blob url', () => {
  const url = resolveCandidateImageUrl({
    dataset: {
      gwrStableSource: 'https://lh3.googleusercontent.com/rd-gg/example=s1024'
    },
    currentSrc: 'blob:https://gemini.google.com/processed',
    src: 'blob:https://gemini.google.com/processed'
  });

  assert.equal(url, 'https://lh3.googleusercontent.com/rd-gg/example=s1024');
});

test('resolveCandidateImageUrl should fallback to currentSrc and src when no explicit source exists', () => {
  assert.equal(resolveCandidateImageUrl({
    dataset: {},
    currentSrc: 'https://lh3.googleusercontent.com/rd-gg/example=s512',
    src: 'https://lh3.googleusercontent.com/rd-gg/example=s256'
  }), 'https://lh3.googleusercontent.com/rd-gg/example=s512');

  assert.equal(resolveCandidateImageUrl({
    dataset: {},
    currentSrc: '',
    src: 'https://lh3.googleusercontent.com/rd-gg/example=s256'
  }), 'https://lh3.googleusercontent.com/rd-gg/example=s256');
});

test('isProcessableGeminiImageElement should accept generated-image descendants with Gemini source urls', () => {
  const element = {
    dataset: {
      gwrSourceUrl: 'https://lh3.googleusercontent.com/rd-gg/example=s1024'
    },
    naturalWidth: 1024,
    naturalHeight: 1024,
    clientWidth: 512,
    clientHeight: 512,
    currentSrc: 'http://127.0.0.1:8080/src/assets/samples/16-9.png',
    src: 'http://127.0.0.1:8080/src/assets/samples/16-9.png',
    closest: (selector) => selector === 'generated-image,.generated-image-container' ? {} : null
  };

  assert.equal(isProcessableGeminiImageElement(element), true);
});

test('isProcessableGeminiImageElement should reject processed preview images', () => {
  assert.equal(isProcessableGeminiImageElement({
    dataset: {
      gwrPreviewImage: 'true',
      gwrSourceUrl: 'https://lh3.googleusercontent.com/rd-gg/example=s1024'
    },
    naturalWidth: 1024,
    naturalHeight: 1024,
    clientWidth: 512,
    clientHeight: 512,
    currentSrc: 'blob:https://gemini.google.com/processed',
    src: 'blob:https://gemini.google.com/processed',
    closest: () => ({})
  }), false);
});

test('isProcessableGeminiImageElement should accept large Gemini images even outside known containers', () => {
  assert.equal(isProcessableGeminiImageElement({
    dataset: {
      gwrSourceUrl: 'https://lh3.googleusercontent.com/rd-gg/example=s1024'
    },
    naturalWidth: 1024,
    naturalHeight: 768,
    clientWidth: 480,
    clientHeight: 360,
    currentSrc: 'blob:https://gemini.google.com/example',
    src: 'blob:https://gemini.google.com/example',
    closest: () => null
  }), true);
});

test('isProcessableGeminiImageElement should accept opaque blob urls when they look like Gemini generated images', () => {
  const actionCluster = {
    querySelectorAll: () => [{}, {}, {}],
    parentElement: null
  };

  assert.equal(isProcessableGeminiImageElement({
    dataset: {},
    naturalWidth: 1024,
    naturalHeight: 768,
    clientWidth: 480,
    clientHeight: 360,
    currentSrc: 'blob:https://gemini.google.com/runtime-preview',
    src: 'blob:https://gemini.google.com/runtime-preview',
    parentElement: actionCluster,
    closest: () => null
  }), true);
});

test('isProcessableGeminiImageElement should accept fullscreen cached blob images inside Gemini image containers', () => {
  assert.equal(isProcessableGeminiImageElement({
    dataset: {},
    naturalWidth: 2048,
    naturalHeight: 1118,
    clientWidth: 951,
    clientHeight: 519,
    currentSrc: 'blob:https://gemini.google.com/fullscreen-cached',
    src: 'blob:https://gemini.google.com/fullscreen-cached',
    closest: (selector) => {
      if (selector === 'generated-image,.generated-image-container') return {};
      if (selector === 'expansion-dialog,[role="dialog"],.image-expansion-dialog-panel,.cdk-overlay-pane') return {};
      return null;
    },
    parentElement: null
  }), true);
});

test('isProcessableGeminiImageElement should accept zero-sized fullscreen blob images inside Gemini containers before they finish rendering', () => {
  assert.equal(isProcessableGeminiImageElement({
    dataset: {},
    naturalWidth: 0,
    naturalHeight: 0,
    clientWidth: 0,
    clientHeight: 0,
    complete: false,
    currentSrc: '',
    src: 'blob:https://gemini.google.com/fullscreen-pending',
    closest: (selector) => {
      if (selector === 'generated-image,.generated-image-container') return {};
      if (selector === 'expansion-dialog,[role="dialog"],.image-expansion-dialog-panel,.cdk-overlay-pane') return {};
      return null;
    },
    parentElement: null
  }), true);
});

test('isProcessableGeminiImageElement should reject inline blob images inside Gemini containers without Gemini evidence', () => {
  assert.equal(isProcessableGeminiImageElement({
    dataset: {},
    naturalWidth: 1024,
    naturalHeight: 768,
    clientWidth: 480,
    clientHeight: 360,
    currentSrc: 'blob:https://gemini.google.com/user-upload',
    src: 'blob:https://gemini.google.com/user-upload',
    closest: (selector) => selector === 'generated-image,.generated-image-container' ? {} : null,
    parentElement: null
  }), false);
});

test('isProcessableGeminiImageElement should reject uploader preview images even when blob fallback cues are present', () => {
  const actionCluster = {
    querySelectorAll: () => [{}, {}, {}],
    parentElement: null
  };

  assert.equal(isProcessableGeminiImageElement({
    dataset: {},
    naturalWidth: 1024,
    naturalHeight: 768,
    clientWidth: 480,
    clientHeight: 360,
    currentSrc: 'blob:https://gemini.google.com/user-upload-preview',
    src: 'blob:https://gemini.google.com/user-upload-preview',
    parentElement: actionCluster,
    closest: (selector) => selector === '[data-test-id="image-preview"],uploader-file-preview,uploader-file-preview-container,.attachment-preview-wrapper,.file-preview-container'
      ? {}
      : null
  }), false);
});

test('isProcessableGeminiImageElement should reject non-Gemini urls and tiny images outside Gemini containers', () => {
  assert.equal(isProcessableGeminiImageElement({
    dataset: {},
    naturalWidth: 512,
    naturalHeight: 512,
    clientWidth: 64,
    clientHeight: 64,
    currentSrc: 'https://example.com/image.png',
    src: 'https://example.com/image.png',
    closest: () => ({})
  }), false);

  assert.equal(isProcessableGeminiImageElement({
    dataset: {
      gwrSourceUrl: 'https://lh3.googleusercontent.com/rd-gg/example=s1024'
    },
    naturalWidth: 96,
    naturalHeight: 96,
    clientWidth: 48,
    clientHeight: 48,
    currentSrc: 'http://127.0.0.1:8080/src/assets/samples/16-9.png',
    src: 'http://127.0.0.1:8080/src/assets/samples/16-9.png',
    closest: () => null
  }), false);
});

test('getPreferredGeminiImageContainer should fallback to a nearby block ancestor when known container is missing', () => {
  const outer = { tagName: 'DIV', parentElement: null, closest: () => null };
  const inner = { tagName: 'DIV', parentElement: outer, closest: () => null };
  const img = {
    tagName: 'IMG',
    parentElement: inner,
    closest: () => null
  };

  assert.equal(getPreferredGeminiImageContainer(img), inner);
});

test('extractGeminiImageAssetIds should read response, draft, and conversation ids from nearby Gemini image metadata', () => {
  const singleImage = {
    getAttribute(name) {
      if (name === 'jslog') {
        return '185864;track:generic_click,impression,attention;BardVeMetadataKey:[["r_d7ef418292ede05c","c_cdec91057e5fdcaf",null,"rc_2315ec0b5621fce5"]];mutable:true';
      }
      return '';
    },
    closest: () => null,
    parentElement: null
  };

  const image = {
    dataset: {},
    parentElement: singleImage,
    closest(selector) {
      if (selector === 'single-image') return singleImage;
      if (selector === '[data-test-draft-id]') {
        return {
          getAttribute(name) {
            return name === 'data-test-draft-id' ? 'rc_2315ec0b5621fce5' : '';
          },
          closest: () => null,
          parentElement: null
        };
      }
      if (selector === 'generated-image,.generated-image-container') return {};
      return null;
    }
  };

  assert.deepEqual(extractGeminiImageAssetIds(image), {
    responseId: 'r_d7ef418292ede05c',
    draftId: 'rc_2315ec0b5621fce5',
    conversationId: 'c_cdec91057e5fdcaf'
  });
});

test('extractGeminiImageAssetIds should return null fields when nearby metadata is unavailable', () => {
  const image = {
    dataset: {},
    parentElement: null,
    closest: () => null
  };

  assert.deepEqual(extractGeminiImageAssetIds(image), {
    responseId: null,
    draftId: null,
    conversationId: null
  });
});
