import test from 'node:test';
import assert from 'node:assert/strict';
import {
  getCallSource,
  getConstArrayItems,
  hasImportedBinding,
  loadModuleSource,
  normalizeWhitespace
} from '../testUtils/moduleStructure.js';

test('userscript entry should install download hooks while keeping preview replacement enabled by default', () => {
  const source = loadModuleSource('../../src/userscript/index.js', import.meta.url);
  const installDownloadHookCall = normalizeWhitespace(getCallSource(source, 'installGeminiDownloadHook'));
  const clipboardHookCall = normalizeWhitespace(getCallSource(source, 'installGeminiClipboardImageHook'));

  assert.equal(hasImportedBinding(source, './downloadHook.js', 'installGeminiDownloadHook'), true);
  assert.equal(hasImportedBinding(source, './downloadHook.js', 'installGeminiDirectDownloadActionHook'), false);
  assert.equal(hasImportedBinding(source, './downloadHook.js', 'createGeminiDownloadRpcFetchHook'), true);
  assert.equal(hasImportedBinding(source, './downloadHook.js', 'installGeminiDownloadRpcXmlHttpRequestHook'), true);
  assert.equal(hasImportedBinding(source, './downloadHook.js', 'resolveGeminiActionKind'), true);
  assert.equal(hasImportedBinding(source, '../shared/pageImageReplacement.js', 'installPageImageReplacement'), true);
  assert.equal(hasImportedBinding(source, '../shared/imageSessionStore.js', 'getDefaultImageSessionStore'), true);
  assert.equal(hasImportedBinding(source, './actionContext.js', 'createGeminiActionContextResolver'), true);
  assert.equal(hasImportedBinding(source, './actionContext.js', 'findGeminiImageElementForSourceUrl'), true);
  assert.equal(hasImportedBinding(source, './historyBindingBootstrap.js', 'requestGeminiConversationHistoryBindings'), true);
  assert.equal(hasImportedBinding(source, './processBridge.js', 'installUserscriptProcessBridge'), true);
  assert.equal(hasImportedBinding(source, './userNotice.js', 'showUserNotice'), true);
  assert.equal(hasImportedBinding(source, './userNotice.js', 'GWR_ORIGINAL_ASSET_REFRESH_MESSAGE'), true);
   assert.equal(hasImportedBinding(source, './pageProcessBridge.js', 'createPageProcessBridgeClient'), true);
   assert.equal(hasImportedBinding(source, './pageProcessorRuntime.js', 'installInjectedPageProcessorRuntime'), true);
  assert.equal(hasImportedBinding(source, './downloadClick.js', 'installGeminiDownloadClickHandler'), false);
  assert.match(normalizeWhitespace(source), /function isPreviewReplacementEnabled\(targetWindow\)/);
  assert.match(normalizeWhitespace(source), /const handleActionCriticalFailure = \(\) => \{ showUserNotice\(targetWindow,\s*GWR_ORIGINAL_ASSET_REFRESH_MESSAGE\); \}/);
  assert.match(
    normalizeWhitespace(source),
    /const pageImageReplacementController = isPreviewReplacementEnabled\(targetWindow\)\s*\?\s*installPageImageReplacement\(/
  );
  assert.match(installDownloadHookCall, /onActionCriticalFailure:\s*handleActionCriticalFailure/);
  assert.match(clipboardHookCall, /onActionCriticalFailure:\s*handleActionCriticalFailure/);
  assert.doesNotMatch(normalizeWhitespace(source), /installGeminiDirectDownloadActionHook\(/);
});

test('userscript entry should skip initialization inside nested frames', () => {
  const source = loadModuleSource('../../src/userscript/index.js', import.meta.url);

  assert.match(normalizeWhitespace(source), /function shouldSkipFrame\(targetWindow\)/);
  assert.match(normalizeWhitespace(source), /if \(shouldSkipFrame\(targetWindow\)\) \{ return; \}/);
});

test('userscript entry should explicitly pass GM_xmlhttpRequest to preview fetching', () => {
  const source = loadModuleSource('../../src/userscript/index.js', import.meta.url);
  const createBlobFetcherCall = normalizeWhitespace(getCallSource(source, 'createUserscriptBlobFetcher'));

  assert.match(createBlobFetcherCall, /gmRequest:\s*userscriptRequest/);
  assert.match(normalizeWhitespace(source), /typeof GM_xmlhttpRequest === 'function'/);
});

test('userscript entry should not eagerly warm the main-thread engine during init', () => {
  const source = loadModuleSource('../../src/userscript/index.js', import.meta.url);

  assert.doesNotMatch(normalizeWhitespace(source), /getEngine\(\)\.catch/);
});

test('userscript entry should verify inline worker readiness before enabling acceleration', () => {
  const source = loadModuleSource('../../src/userscript/processingRuntime.js', import.meta.url);

  assert.match(normalizeWhitespace(source), /await workerClient\.ping\(\)/);
  assert.match(normalizeWhitespace(source), /Worker initialization failed,\s*using main thread/);
});

test('userscript entry should route page image processing through page runtime bridge with processingRuntime fallback', () => {
  const source = loadModuleSource('../../src/userscript/index.js', import.meta.url);
  const installDownloadHookCall = normalizeWhitespace(getCallSource(source, 'installGeminiDownloadHook'));
  const installDownloadRpcHookCall = normalizeWhitespace(getCallSource(source, 'createGeminiDownloadRpcFetchHook'));
  const installDownloadRpcXhrHookCall = normalizeWhitespace(getCallSource(source, 'installGeminiDownloadRpcXmlHttpRequestHook'));
  const installPageReplacementCall = normalizeWhitespace(getCallSource(source, 'installPageImageReplacement'));

  assert.equal(hasImportedBinding(source, './urlUtils.js', 'isGeminiOriginalAssetUrl'), true);
  assert.match(normalizeWhitespace(source), /await installInjectedPageProcessorRuntime\(/);
  assert.match(installDownloadHookCall, /isTargetUrl:\s*isGeminiOriginalAssetUrl/);
  assert.match(installDownloadRpcHookCall, /getActionContext:\s*\(\)\s*=>\s*downloadIntentGate\.getRecentActionContext\(\)/);
  assert.match(installDownloadRpcXhrHookCall, /getActionContext:\s*\(\)\s*=>\s*downloadIntentGate\.getRecentActionContext\(\)/);
  assert.match(normalizeWhitespace(source), /const removeWatermarkFromBestAvailablePath = \(blob,\s*options = \{\}\) => \(\s*pageProcessClient\?\.removeWatermarkFromBlob\s*\?\s*pageProcessClient\.removeWatermarkFromBlob\(blob,\s*options\)\s*:\s*processingRuntime\.removeWatermarkFromBlob\(blob,\s*options\)\s*\)/);
  assert.match(installDownloadHookCall, /processBlob:\s*removeWatermarkFromBestAvailablePath/);
  assert.match(installPageReplacementCall, /processWatermarkBlobImpl:\s*pageProcessClient\.processWatermarkBlob/);
  assert.match(installPageReplacementCall, /removeWatermarkFromBlobImpl:\s*pageProcessClient\.removeWatermarkFromBlob/);
  assert.doesNotMatch(installPageReplacementCall, /bridgeClient\./);
});

test('userscript entry should install preview request interception while keeping DOM preview replacement enabled by default', () => {
  const source = loadModuleSource('../../src/userscript/index.js', import.meta.url);
  const normalized = normalizeWhitespace(source);

  assert.equal(hasImportedBinding(source, './downloadHook.js', 'createGeminiDownloadFetchHook'), true);
  assert.equal(hasImportedBinding(source, './urlUtils.js', 'isGeminiDisplayPreviewAssetUrl'), true);
  assert.match(
    normalized,
    /const processPreviewBlobAtBestPath = async \(blob,\s*options = \{\}\) => \{[\s\S]*await pageProcessClient\.processWatermarkBlob\(blob,\s*options\)[\s\S]*await processingRuntime\.processWatermarkBlob\(blob,\s*options\)[\s\S]*return result\.processedBlob;\s*\}/
  );
  assert.match(normalized, /const previewFetch = createGeminiDownloadFetchHook\(/);
  assert.match(normalized, /isTargetUrl:\s*isGeminiDisplayPreviewAssetUrl/);
  assert.match(normalized, /getActionContext:\s*resolvePreviewRequestActionContext/);
  assert.match(normalized, /processBlob:\s*processPreviewBlobAtBestPath/);
  assert.match(normalized, /originalFetch:\s*previewFetch/);
  assert.match(normalized, /const pageImageReplacementController = isPreviewReplacementEnabled\(targetWindow\)\s*\?\s*installPageImageReplacement\(/);
});

test('userscript entry should store request-layer preview results in the preview session slot', () => {
  const source = loadModuleSource('../../src/userscript/index.js', import.meta.url);
  const normalized = normalizeWhitespace(source);

  assert.match(normalized, /const handlePreviewBlobResolved = \(payload = \{\}\) => \{/);
  assert.match(normalized, /slot:\s*'preview'/);
  assert.match(normalized, /processedFrom:\s*'request-preview'/);
  assert.match(normalized, /onProcessedBlobResolved:\s*handlePreviewBlobResolved/);
  assert.match(normalized, /imageSessionStore\.updateSourceSnapshot\?\.\(sessionKey,\s*\{/);
});

test('userscript entry should preserve the intent target for fullscreen clipboard fallback resolution', () => {
  const source = loadModuleSource('../../src/userscript/index.js', import.meta.url);
  const intentGateCall = normalizeWhitespace(getCallSource(source, 'createGeminiDownloadIntentGate'));
  const clipboardHookCall = normalizeWhitespace(getCallSource(source, 'installGeminiClipboardImageHook'));

  assert.match(intentGateCall, /resolveActionContext:\s*\(target\)\s*=>\s*\{/);
  assert.match(intentGateCall, /target,/);
  assert.match(intentGateCall, /const intentAction = resolveGeminiActionKind\(target\)\s*\|\|\s*'clipboard'/);
  assert.match(intentGateCall, /const sessionContext = actionContextResolver\.resolveActionContext\(/);
  assert.match(intentGateCall, /action:\s*intentAction/);
  assert.match(intentGateCall, /sessionKey:\s*sessionContext\.sessionKey/);
  assert.match(intentGateCall, /assetIds:\s*sessionContext\.assetIds/);
  assert.match(intentGateCall, /resource:\s*sessionContext\.resource/);
  assert.match(clipboardHookCall, /getActionContext:\s*\(\)\s*=>\s*downloadIntentGate\.getRecentActionContext\(\)/);
  assert.match(clipboardHookCall, /resolveImageElement:\s*\(actionContext\)\s*=>\s*actionContextResolver\.resolveImageElement\(actionContext\)/);
  assert.match(clipboardHookCall, /imageSessionStore:\s*imageSessionStore/);
});

test('userscript entry should process clipboard payload blobs when fullscreen processed object urls are stale', () => {
  const source = loadModuleSource('../../src/userscript/index.js', import.meta.url);
  const normalized = normalizeWhitespace(source);
  const clipboardHookCall = normalizeWhitespace(getCallSource(source, 'installGeminiClipboardImageHook'));

  assert.match(normalized, /const processClipboardImageBlobAtBestPath = \(blob,\s*options = \{\}\) => \(/);
  assert.match(normalized, /pageProcessClient\?\.processWatermarkBlob/);
  assert.match(normalized, /processingRuntime\.processWatermarkBlob/);
  assert.match(clipboardHookCall, /processClipboardImageBlob:\s*\(blob,\s*\{ actionContext \} = \{\}\)\s*=>\s*\(\s*processClipboardImageBlobAtBestPath\(blob,\s*\{ actionContext \}\)\s*\)/);
});

test('userscript entry should wire the action resolver directly into the intent gate', () => {
  const source = normalizeWhitespace(loadModuleSource('../../src/userscript/downloadHook.js', import.meta.url));

  assert.match(source, /const intentGate = options\?\.intentGate \|\| createGeminiDownloadIntentGate\(\{ targetWindow,\s*resolveActionContext:\s*options\?\.resolveActionContext \}\)/);
  assert.doesNotMatch(source, /resolveIntentMetadata/);
  assert.doesNotMatch(source, /resolveMetadata/);
});

test('userscript entry should search fullscreen dialog containers when resolving nearby Gemini images', () => {
  const source = normalizeWhitespace(loadModuleSource('../../src/userscript/actionContext.js', import.meta.url));

  assert.equal(
    source.includes(
      "buttonLike?.closest?.('expansion-dialog,[role=\"dialog\"],.image-expansion-dialog-panel,.cdk-overlay-pane')"
    ),
    true
  );
});

test('userscript entry should prefer a processed global asset match when fullscreen image is still unprocessed', () => {
  const source = normalizeWhitespace(loadModuleSource('../../src/userscript/actionContext.js', import.meta.url));

  assert.equal(
    source.includes('const globalAssetMatch = assetIds ? findGeminiImageElementForAssetIds(targetWindow?.document || document, assetIds) : null;'),
    true
  );
  assert.equal(
    source.includes('if (globalAssetMatch?.dataset?.gwrWatermarkObjectUrl) { return globalAssetMatch; }'),
    true
  );
  assert.equal(
    source.includes('fallbackMatch ||= imageElement;'),
    true
  );
});

test('userscript entry should install original-asset discovery hooks before async runtime initialization', () => {
  const source = normalizeWhitespace(loadModuleSource('../../src/userscript/index.js', import.meta.url));

  const rpcHookIndex = source.indexOf('const downloadRpcFetch = createGeminiDownloadRpcFetchHook(');
  const xhrHookIndex = source.indexOf('installGeminiDownloadRpcXmlHttpRequestHook(targetWindow,');
  const downloadHookIndex = source.indexOf('installGeminiDownloadHook(targetWindow,');
  const historyBootstrapIndex = source.indexOf('await requestGeminiConversationHistoryBindings(');
  const runtimeInitIndex = source.indexOf('await processingRuntime.initialize()');
  const pageRuntimeInitIndex = source.indexOf('await installInjectedPageProcessorRuntime(');

  assert.ok(rpcHookIndex >= 0, 'expected rpc fetch hook setup in userscript entry');
  assert.ok(xhrHookIndex >= 0, 'expected rpc xhr hook setup in userscript entry');
  assert.ok(downloadHookIndex >= 0, 'expected download hook setup in userscript entry');
  assert.ok(historyBootstrapIndex >= 0, 'expected conversation history bootstrap in userscript entry');
  assert.ok(runtimeInitIndex >= 0, 'expected processing runtime initialization in userscript entry');
  assert.ok(pageRuntimeInitIndex >= 0, 'expected page runtime initialization in userscript entry');
  assert.ok(rpcHookIndex < runtimeInitIndex, 'rpc fetch hook should be installed before processing runtime initialize await');
  assert.ok(xhrHookIndex < runtimeInitIndex, 'rpc xhr hook should be installed before processing runtime initialize await');
  assert.ok(downloadHookIndex < runtimeInitIndex, 'download hook should be installed before processing runtime initialize await');
  assert.ok(historyBootstrapIndex < runtimeInitIndex, 'conversation history bootstrap should run before processing runtime initialize await');
  assert.ok(rpcHookIndex < pageRuntimeInitIndex, 'rpc fetch hook should be installed before page runtime injection await');
  assert.ok(xhrHookIndex < pageRuntimeInitIndex, 'rpc xhr hook should be installed before page runtime injection await');
  assert.ok(downloadHookIndex < pageRuntimeInitIndex, 'download hook should be installed before page runtime injection await');
  assert.ok(historyBootstrapIndex < pageRuntimeInitIndex, 'conversation history bootstrap should run before page runtime injection await');
});

test('userscript entry should reuse one shared image session store across page replacement and original-asset binding', () => {
  const source = loadModuleSource('../../src/userscript/index.js', import.meta.url);
  const bindCall = normalizeWhitespace(getCallSource(source, 'bindOriginalAssetUrlToImages'));
  const pageReplacementCall = normalizeWhitespace(getCallSource(source, 'installPageImageReplacement'));

  assert.match(normalizeWhitespace(source), /const imageSessionStore = getDefaultImageSessionStore\(\)/);
  assert.match(bindCall, /imageSessionStore(?:\s*:\s*imageSessionStore)?/);
  assert.match(pageReplacementCall, /imageSessionStore(?:\s*:\s*imageSessionStore)?/);
});

test('userscript entry should resolve discovered asset payloads through the shared compat helper', () => {
  const source = normalizeWhitespace(loadModuleSource('../../src/userscript/index.js', import.meta.url));

  assert.equal(
    hasImportedBinding(source, '../shared/actionContextCompat.js', 'resolveCompatibleActionContextFromPayload'),
    true
  );
  assert.match(source, /const handleOriginalAssetDiscovered = \(payload = \{\}\) => \{/);
  assert.match(source, /const resolvedActionContext = resolveCompatibleActionContextFromPayload\(payload\)/);
  assert.doesNotMatch(source, /intentMetadata/);
});

test('userscript entry should delegate watermark runtime logic to processingRuntime module', () => {
  const source = loadModuleSource('../../src/userscript/index.js', import.meta.url);
  const bridgeInstallCall = normalizeWhitespace(getCallSource(source, 'installUserscriptProcessBridge'));

  assert.equal(hasImportedBinding(source, './processingRuntime.js', 'createUserscriptProcessingRuntime'), true);
  assert.match(normalizeWhitespace(source), /const processingRuntime = createUserscriptProcessingRuntime\(/);
  assert.match(normalizeWhitespace(source), /await processingRuntime\.initialize\(\)/);
  assert.match(bridgeInstallCall, /processWatermarkBlob:\s*processingRuntime\.processWatermarkBlob/);
  assert.match(bridgeInstallCall, /removeWatermarkFromBlob:\s*processingRuntime\.removeWatermarkFromBlob/);
});

test('userscript entry should not inline duplicate worker runtime implementation', () => {
  const source = loadModuleSource('../../src/userscript/index.js', import.meta.url);

  assert.doesNotMatch(normalizeWhitespace(source), /class InlineWorkerClient/);
  assert.doesNotMatch(normalizeWhitespace(source), /function getEngine\(/);
  assert.doesNotMatch(normalizeWhitespace(source), /function processBlobWithBestPath\(/);
});

test('page image replacement should not observe self-written stable source attributes', () => {
  const source = loadModuleSource('../../src/shared/pageImageReplacement.js', import.meta.url);
  const observedAttributes = getConstArrayItems(source, 'OBSERVED_ATTRIBUTES');
  assert.equal(observedAttributes.includes('data-gwr-stable-source'), false);
});
