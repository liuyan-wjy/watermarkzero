import test from 'node:test';
import assert from 'node:assert/strict';

import { createImageSessionStore } from '../../src/shared/imageSessionStore.js';
import {
  createGeminiActionContextResolver,
  findGeminiImageElementForSourceUrl,
  findNearbyGeminiImageElement
} from '../../src/userscript/actionContext.js';

function createImageElement(dataset = {}) {
  return {
    tagName: 'IMG',
    dataset: { ...dataset },
    currentSrc: '',
    src: '',
    closest: () => null
  };
}

test('findGeminiImageElementForSourceUrl should match images by bound or stable Gemini source url', () => {
  const previewImage = createImageElement({
    gwrSourceUrl: 'https://lh3.googleusercontent.com/gg/example-token=s0-rj',
    gwrStableSource: 'https://lh3.googleusercontent.com/gg/example-token=s0-rj'
  });
  previewImage.src = 'blob:https://gemini.google.com/runtime-preview';
  previewImage.currentSrc = previewImage.src;

  const fallbackImage = createImageElement();
  fallbackImage.src = 'https://lh3.googleusercontent.com/gg/other-token=s1024-rj';
  fallbackImage.currentSrc = fallbackImage.src;

  const root = {
    querySelectorAll(selector) {
      return selector === 'generated-image img,.generated-image-container img'
        ? [previewImage, fallbackImage]
        : [];
    }
  };

  const resolved = findGeminiImageElementForSourceUrl(
    root,
    'https://lh3.googleusercontent.com/gg/example-token=s1024-rj'
  );

  assert.equal(resolved, previewImage);
});

test('findGeminiImageElementForSourceUrl should fall back to a single unbound blob image when it is the only Gemini candidate', () => {
  const previewImage = createImageElement({
    gwrResponseId: 'r_single_preview',
    gwrDraftId: 'rc_single_preview',
    gwrConversationId: 'c_single_preview'
  });
  previewImage.src = 'blob:https://gemini.google.com/runtime-preview';
  previewImage.currentSrc = previewImage.src;

  const root = {
    querySelectorAll(selector) {
      return selector === 'generated-image img,.generated-image-container img'
        ? [previewImage]
        : [];
    }
  };

  const resolved = findGeminiImageElementForSourceUrl(
    root,
    'https://lh3.googleusercontent.com/gg-dl/example-preview=s1024-rj?alr=yes'
  );

  assert.equal(resolved, previewImage);
});

test('findNearbyGeminiImageElement should prefer the processed global asset match when fullscreen root image is still unprocessed', () => {
  const previewImage = createImageElement({
    gwrResponseId: 'r_action_example',
    gwrDraftId: 'rc_action_example',
    gwrConversationId: 'c_action_example',
    gwrWatermarkObjectUrl: 'blob:https://gemini.google.com/processed-preview'
  });
  const fullscreenImage = createImageElement({
    gwrResponseId: 'r_action_example',
    gwrDraftId: 'rc_action_example',
    gwrConversationId: 'c_action_example'
  });

  const documentImages = [previewImage, fullscreenImage];
  const dialogRoot = {
    querySelectorAll(selector) {
      return selector === 'img' ? [fullscreenImage] : [];
    }
  };
  const buttonLike = {
    closest(selector) {
      return selector === 'expansion-dialog,[role="dialog"],.image-expansion-dialog-panel,.cdk-overlay-pane'
        ? dialogRoot
        : null;
    }
  };
  const target = {
    closest(selector) {
      return selector === 'button,[role="button"]' ? buttonLike : null;
    }
  };
  const targetWindow = {
    document: {
      querySelectorAll() {
        return documentImages;
      }
    }
  };

  const resolved = findNearbyGeminiImageElement(targetWindow, target, {
    responseId: 'r_action_example',
    draftId: 'rc_action_example',
    conversationId: 'c_action_example'
  });

  assert.equal(resolved, previewImage);
});

test('createGeminiActionContextResolver should resolve a target into the shared Gemini image session context', () => {
  const imageSessionStore = createImageSessionStore({
    now: () => 123456
  });
  const sessionKey = imageSessionStore.getOrCreateByAssetIds({
    responseId: 'r_action_context',
    draftId: 'rc_action_context',
    conversationId: 'c_action_context'
  });
  imageSessionStore.updateProcessedResult(sessionKey, {
    objectUrl: 'blob:https://gemini.google.com/action-context-processed',
    blobType: 'image/png',
    processedFrom: 'page-fetch'
  });

  const previewImage = createImageElement({
    gwrResponseId: 'r_action_context',
    gwrDraftId: 'rc_action_context',
    gwrConversationId: 'c_action_context',
    gwrWatermarkObjectUrl: 'blob:https://gemini.google.com/action-context-processed'
  });
  const fullscreenImage = createImageElement({
    gwrResponseId: 'r_action_context',
    gwrDraftId: 'rc_action_context',
    gwrConversationId: 'c_action_context'
  });

  const documentImages = [previewImage, fullscreenImage];
  const dialogRoot = {
    querySelectorAll(selector) {
      return selector === 'img' ? [fullscreenImage] : [];
    }
  };
  const buttonLike = {
    closest(selector) {
      return selector === 'expansion-dialog,[role="dialog"],.image-expansion-dialog-panel,.cdk-overlay-pane'
        ? dialogRoot
        : null;
    }
  };
  const target = {
    closest(selector) {
      return selector === 'button,[role="button"]' ? buttonLike : null;
    }
  };
  const targetWindow = {
    document: {
      querySelectorAll() {
        return documentImages;
      }
    }
  };

  const resolver = createGeminiActionContextResolver({
    targetWindow,
    imageSessionStore
  });

  const context = resolver.resolveActionContext(target);

  assert.equal(context.sessionKey, 'draft:rc_action_context');
  assert.equal(context.imageElement, previewImage);
  assert.deepEqual(context.assetIds, {
    responseId: 'r_action_context',
    draftId: 'rc_action_context',
    conversationId: 'c_action_context'
  });
  assert.deepEqual(context.resource, {
    kind: 'processed',
    url: 'blob:https://gemini.google.com/action-context-processed',
    mimeType: 'image/png',
    processedMeta: null,
    source: 'page-fetch',
    slot: 'preview'
  });
});

test('createGeminiActionContextResolver should prefer the store-attached processed preview element even when nearby DOM lookup misses it', () => {
  const imageSessionStore = createImageSessionStore({
    now: () => 123456
  });
  const sessionKey = imageSessionStore.getOrCreateByAssetIds({
    responseId: 'r_store_preferred_element',
    draftId: 'rc_store_preferred_element',
    conversationId: 'c_store_preferred_element'
  });
  imageSessionStore.updateProcessedResult(sessionKey, {
    slot: 'preview',
    objectUrl: 'blob:https://gemini.google.com/store-preferred-processed',
    blobType: 'image/png',
    processedFrom: 'page-fetch'
  });
  imageSessionStore.updateProcessedResult(sessionKey, {
    slot: 'full',
    objectUrl: 'blob:https://gemini.google.com/store-preferred-full',
    blobType: 'image/png',
    processedFrom: 'original-download'
  });

  const previewImage = createImageElement({
    gwrResponseId: 'r_store_preferred_element',
    gwrDraftId: 'rc_store_preferred_element',
    gwrConversationId: 'c_store_preferred_element',
    gwrWatermarkObjectUrl: 'blob:https://gemini.google.com/store-preferred-processed'
  });
  imageSessionStore.attachElement(sessionKey, 'preview', previewImage);

  const fullscreenImage = createImageElement({
    gwrResponseId: 'r_store_preferred_element',
    gwrDraftId: 'rc_store_preferred_element',
    gwrConversationId: 'c_store_preferred_element'
  });
  const dialogRoot = {
    querySelectorAll(selector) {
      return selector === 'img' ? [fullscreenImage] : [];
    }
  };
  const buttonLike = {
    closest(selector) {
      return selector === 'expansion-dialog,[role="dialog"],.image-expansion-dialog-panel,.cdk-overlay-pane'
        ? dialogRoot
        : null;
    }
  };
  const target = {
    closest(selector) {
      return selector === 'button,[role="button"]' ? buttonLike : null;
    }
  };
  const targetWindow = {
    document: {
      querySelectorAll() {
        return [fullscreenImage];
      }
    }
  };

  const resolver = createGeminiActionContextResolver({
    targetWindow,
    imageSessionStore
  });

  const context = resolver.resolveActionContext(target, {
    action: 'clipboard'
  });

  assert.equal(context.imageElement, previewImage);
  assert.equal(context.sessionKey, 'draft:rc_store_preferred_element');
  assert.equal(context.resource?.slot, 'full');
});
