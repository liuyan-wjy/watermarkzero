import path from 'node:path';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { pathToFileURL } from 'node:url';

import { chromium } from 'playwright';

export const DEFAULT_TAMPERMONKEY_FRESHNESS_CDP_URL = 'http://127.0.0.1:9226';
export const DEFAULT_TAMPERMONKEY_EXTENSION_ID = 'dhdgffkkebhmkfjojejmpbldmpobfkfo';
export const DEFAULT_TAMPERMONKEY_FRESHNESS_SCRIPT_PATH = path.resolve(
  process.cwd(),
  'dist/userscript/gemini-watermark-remover.user.js'
);
export const DEFAULT_TAMPERMONKEY_FRESHNESS_REPORT_PATH = path.resolve(
  process.cwd(),
  '.artifacts/tampermonkey-freshness/latest.json'
);
export const DEFAULT_TAMPERMONKEY_FRESHNESS_REQUIRED_MARKERS = [
  'DEFAULT_DOWNLOAD_STICKY_WINDOW_MS',
  'downloadStickyUntil',
  'getActionContextFromIntentGate(intentGate = null, candidate = null)'
];

function sha256(value = '') {
  return createHash('sha256').update(String(value), 'utf8').digest('hex');
}

function normalizeUserscriptSource(source = '') {
  return String(source || '').replace(/\r\n?/g, '\n');
}

export function parseTampermonkeyFreshnessCliArgs(argv = []) {
  const args = [...argv];
  const parsed = {
    cdpUrl: DEFAULT_TAMPERMONKEY_FRESHNESS_CDP_URL,
    scriptPath: DEFAULT_TAMPERMONKEY_FRESHNESS_SCRIPT_PATH,
    reportPath: DEFAULT_TAMPERMONKEY_FRESHNESS_REPORT_PATH,
    extensionId: DEFAULT_TAMPERMONKEY_EXTENSION_ID
  };

  while (args.length > 0) {
    const arg = args.shift();
    if (arg === '--cdp') {
      parsed.cdpUrl = String(args.shift() || parsed.cdpUrl).trim() || parsed.cdpUrl;
      continue;
    }
    if (arg === '--script') {
      parsed.scriptPath = path.resolve(process.cwd(), args.shift() || parsed.scriptPath);
      continue;
    }
    if (arg === '--report') {
      parsed.reportPath = path.resolve(process.cwd(), args.shift() || parsed.reportPath);
      continue;
    }
    if (arg === '--extension-id') {
      parsed.extensionId = String(args.shift() || parsed.extensionId).trim() || parsed.extensionId;
      continue;
    }
    throw new Error(`Unknown argument: ${arg}`);
  }

  return parsed;
}

export function chooseBestEditorSourceCandidate(candidates = []) {
  return [...candidates]
    .filter((candidate) => typeof candidate?.value === 'string' && candidate.value.trim())
    .sort((left, right) => (right.valueLength || right.value.length) - (left.valueLength || left.value.length))[0] || null;
}

export function computeUserscriptFreshness({
  installedSource = '',
  localSource = '',
  requiredMarkers = DEFAULT_TAMPERMONKEY_FRESHNESS_REQUIRED_MARKERS
} = {}) {
  const normalizedInstalledSource = normalizeUserscriptSource(installedSource);
  const normalizedLocalSource = normalizeUserscriptSource(localSource);
  const installedMissingMarkers = requiredMarkers.filter((marker) => !normalizedInstalledSource.includes(marker));
  const localMissingMarkers = requiredMarkers.filter((marker) => !normalizedLocalSource.includes(marker));
  const exactMatch = normalizedInstalledSource === normalizedLocalSource;

  return {
    status: exactMatch && installedMissingMarkers.length === 0 && localMissingMarkers.length === 0
      ? 'fresh'
      : 'stale',
    exactMatch,
    installedLength: normalizedInstalledSource.length,
    localLength: normalizedLocalSource.length,
    installedSha256: sha256(normalizedInstalledSource),
    localSha256: sha256(normalizedLocalSource),
    installedMissingMarkers,
    localMissingMarkers
  };
}

export function shouldFailTampermonkeyFreshnessCheck(freshness = null) {
  return freshness?.status !== 'fresh';
}

function findTampermonkeyEditorPage(browser, extensionId) {
  const pagePrefix = `chrome-extension://${extensionId}/options.html#nav=`;
  return browser
    .contexts()
    .flatMap((context) => context.pages())
    .find((page) => page.url().startsWith(pagePrefix) && page.url().includes('+editor')) || null;
}

function findTampermonkeyInstalledPage(browser, extensionId) {
  const pagePrefix = `chrome-extension://${extensionId}/options.html#nav=installed`;
  return browser
    .contexts()
    .flatMap((context) => context.pages())
    .find((page) => page.url().startsWith(pagePrefix)) || null;
}

export async function ensureTampermonkeyEditorPage(browser, extensionId) {
  const existingEditorPage = findTampermonkeyEditorPage(browser, extensionId);
  if (existingEditorPage) {
    return existingEditorPage;
  }

  const context = browser.contexts()[0];
  if (!context) {
    throw new Error('CDP browser does not expose a usable browser context');
  }

  const page = findTampermonkeyInstalledPage(browser, extensionId) || await context.newPage();
  await page.goto(`chrome-extension://${extensionId}/options.html#nav=installed`, {
    waitUntil: 'domcontentloaded',
    timeout: 30000
  });
  await page.waitForTimeout(1500);

  const targetLocator = page.locator('span.clickable', {
    hasText: 'Gemini NanoBanana 图片水印移除'
  }).first();
  if (await targetLocator.count() === 0) {
    throw new Error('Tampermonkey 已安装脚本列表中未找到 Gemini NanoBanana 图片水印移除');
  }

  await targetLocator.click();
  await page.waitForURL(new RegExp(`chrome-extension://${extensionId}/options\\.html#nav=.*\\+editor`), {
    timeout: 30000
  });
  await page.waitForTimeout(1500);
  return page;
}

async function collectEditorSourceCandidates(page) {
  return page.evaluate(() => {
    return Array.from(document.querySelectorAll('.CodeMirror')).map((element, index) => {
      const value = typeof element?.CodeMirror?.getValue === 'function'
        ? element.CodeMirror.getValue()
        : '';
      return {
        index,
        value,
        valueLength: value.length,
        textLength: (element.textContent || '').length
      };
    });
  });
}

export async function runTampermonkeyFreshnessCheck({
  cdpUrl = DEFAULT_TAMPERMONKEY_FRESHNESS_CDP_URL,
  scriptPath = DEFAULT_TAMPERMONKEY_FRESHNESS_SCRIPT_PATH,
  reportPath = DEFAULT_TAMPERMONKEY_FRESHNESS_REPORT_PATH,
  extensionId = DEFAULT_TAMPERMONKEY_EXTENSION_ID,
  requiredMarkers = DEFAULT_TAMPERMONKEY_FRESHNESS_REQUIRED_MARKERS
} = {}) {
  const localSource = await readFile(scriptPath, 'utf8');
  const browser = await chromium.connectOverCDP(cdpUrl);

  try {
    const editorPage = await ensureTampermonkeyEditorPage(browser, extensionId);

    const candidates = await collectEditorSourceCandidates(editorPage);
    const bestCandidate = chooseBestEditorSourceCandidate(candidates);
    if (!bestCandidate) {
      throw new Error('Tampermonkey 编辑器页面中没有可读取的 CodeMirror 脚本源码');
    }

    const freshness = computeUserscriptFreshness({
      installedSource: bestCandidate.value,
      localSource,
      requiredMarkers
    });
    const report = {
      generatedAt: new Date().toISOString(),
      cdpUrl,
      scriptPath,
      editorPage: {
        url: editorPage.url(),
        title: await editorPage.title().catch(() => ''),
        candidateCount: candidates.length,
        selectedIndex: bestCandidate.index
      },
      freshness
    };

    await mkdir(path.dirname(reportPath), { recursive: true });
    await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`);

    return {
      reportPath,
      report
    };
  } finally {
    await browser.close();
  }
}

async function runCli() {
  const options = parseTampermonkeyFreshnessCliArgs(process.argv.slice(2));
  const result = await runTampermonkeyFreshnessCheck(options);
  console.log(`status: ${result.report.freshness.status}`);
  console.log(`exactMatch: ${result.report.freshness.exactMatch}`);
  console.log(`report: ${result.reportPath}`);
  console.log(`installedSha256: ${result.report.freshness.installedSha256}`);
  console.log(`localSha256: ${result.report.freshness.localSha256}`);
  if (result.report.freshness.installedMissingMarkers.length > 0) {
    console.log(`installedMissingMarkers: ${result.report.freshness.installedMissingMarkers.join(', ')}`);
  }
  if (shouldFailTampermonkeyFreshnessCheck(result.report.freshness)) {
    process.exitCode = 1;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  runCli().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
