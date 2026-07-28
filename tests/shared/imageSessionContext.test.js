import test from 'node:test';
import assert from 'node:assert/strict';

import { createImageSessionStore } from '../../src/shared/imageSessionStore.js';
import { resolveImageSessionContext } from '../../src/shared/imageSessionContext.js';
import {
  hasImportedBinding,
  loadModuleSource,
  normalizeWhitespace
} from '../testUtils/moduleStructure.js';

test('imageSessionContext should resolve actionContext directly through the shared helper', () => {
  const source = normalizeWhitespace(loadModuleSource('../../src/shared/imageSessionContext.js', import.meta.url));

  assert.equal(
    hasImportedBinding(source, './actionContextCompat.js', 'resolveCompatibleActionContext'),
    true
  );
  assert.match(source, /const resolvedActionContext = resolveCompatibleActionContext\(actionContext\)/);
});

test('resolveImageSessionContext should merge action asset ids and return the processed session resource', () => {
  const imageSessionStore = createImageSessionStore({
    now: () => 123456
  });
  const sessionKey = imageSessionStore.getOrCreateByAssetIds({
    responseId: 'r_context_example',
    draftId: 'rc_context_example',
    conversationId: 'c_context_example'
  });
  imageSessionStore.updateProcessedResult(sessionKey, {
    slot: 'full',
    objectUrl: 'blob:https://gemini.google.com/context-processed',
    blobType: 'image/png',
    processedFrom: 'original-download'
  });

  const resolvedImageElement = {
    dataset: {
      gwrResponseId: 'r_context_example',
      gwrConversationId: 'c_context_example'
    }
  };

  const context = resolveImageSessionContext({
    action: 'clipboard',
    actionContext: {
      assetIds: {
        draftId: 'rc_context_example'
      }
    },
    resolveImageElement: () => resolvedImageElement,
    imageSessionStore
  });

  assert.equal(context?.sessionKey, 'draft:rc_context_example');
  assert.equal(context?.imageElement, resolvedImageElement);
  assert.deepEqual(context?.assetIds, {
    responseId: 'r_context_example',
    draftId: 'rc_context_example',
    conversationId: 'c_context_example'
  });
  assert.deepEqual(context?.resource, {
    kind: 'processed',
    url: 'blob:https://gemini.google.com/context-processed',
    mimeType: 'image/png',
    processedMeta: null,
    source: 'original-download',
    slot: 'full'
  });
});

test('resolveImageSessionContext should prefer the full processed slot for download actions', () => {
  const imageSessionStore = createImageSessionStore({
    now: () => 123456
  });
  const sessionKey = imageSessionStore.getOrCreateByAssetIds({
    responseId: 'r_context_download',
    draftId: 'rc_context_download',
    conversationId: 'c_context_download'
  });
  imageSessionStore.updateProcessedResult(sessionKey, {
    slot: 'preview',
    objectUrl: 'blob:https://gemini.google.com/context-preview',
    blobType: 'image/png',
    processedFrom: 'preview-candidate'
  });
  imageSessionStore.updateProcessedResult(sessionKey, {
    slot: 'full',
    objectUrl: 'blob:https://gemini.google.com/context-full',
    blobType: 'image/png',
    processedFrom: 'original-download'
  });

  const context = resolveImageSessionContext({
    action: 'download',
    actionContext: {
      assetIds: {
        draftId: 'rc_context_download'
      }
    },
    imageSessionStore
  });

  assert.deepEqual(context?.resource, {
    kind: 'processed',
    url: 'blob:https://gemini.google.com/context-full',
    mimeType: 'image/png',
    processedMeta: null,
    source: 'original-download',
    slot: 'full'
  });
});
