import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync } from 'node:fs';

function listRelativeFiles(directoryUrl, prefix = '') {
  if (!existsSync(directoryUrl)) {
    return [];
  }

  const files = [];

  for (const entry of readdirSync(directoryUrl, { withFileTypes: true })) {
    const relativePath = `${prefix}${entry.name}`;
    const entryUrl = new URL(`${entry.name}${entry.isDirectory() ? '/' : ''}`, directoryUrl);

    if (entry.isDirectory()) {
      files.push(...listRelativeFiles(entryUrl, `${relativePath}/`));
      continue;
    }

    files.push(relativePath);
  }

  return files;
}

const obsoleteSuperpowersDocs = [
  'plans/2026-03-20-extension-offscreen-worker-bridge.md',
  'plans/2026-03-20-extension-worker-mvp.md'
];

function readRepoText(relativePath) {
  return readFileSync(new URL(`../../${relativePath}`, import.meta.url), 'utf8');
}

test('package should not expose removed Chrome extension workflows', () => {
  const packageJson = JSON.parse(readRepoText('package.json'));

  for (const scriptName of [
    'test:extension-smoke',
    'debug:auto',
    'debug:auto:clean',
    'debug:manual',
    'debug:manual:clean',
    'debug:chrome',
    'debug:chrome:clean'
  ]) {
    assert.equal(
      packageJson.scripts?.[scriptName],
      undefined,
      `expected package.json to stop exposing ${scriptName}`
    );
  }
});

test('build and ci config should not reference removed Chrome extension bundle outputs', () => {
  const buildScript = readRepoText('build.js');
  const workflow = readRepoText('.github/workflows/ci.yml');

  for (const pattern of [
    /src\/extension\/pageHook\.js/,
    /src\/extension\/contentScript\.js/,
    /src\/extension\/popup\.js/,
    /dist\/extension\//,
    /manifest\.json/,
    /popup\.html/
  ]) {
    assert.doesNotMatch(buildScript, pattern);
  }

  assert.doesNotMatch(workflow, /name:\s+Extension smoke/i);
  assert.doesNotMatch(workflow, /run:\s+pnpm test:extension-smoke/i);
});

test('README files should not document removed Chrome extension workflows', () => {
  const readmeZh = readRepoText('README_zh.md');
  const readmeEn = readRepoText('README.md');

  for (const pattern of [
    /Chrome 插件/i,
    /dist\/extension/,
    /加载已解压缩的扩展程序|Load unpacked/i,
    /pnpm debug:auto/,
    /pnpm debug:manual/
  ]) {
    assert.doesNotMatch(readmeZh, pattern);
  }

  for (const pattern of [
    /Chrome Extension/i,
    /dist\/extension/,
    /Load unpacked/i,
    /pnpm debug:auto/,
    /pnpm debug:manual/
  ]) {
    assert.doesNotMatch(readmeEn, pattern);
  }
});

test('removed plugin source directory should not remain as an empty placeholder', () => {
  assert.equal(
    existsSync(new URL('../../src/extension', import.meta.url)),
    false,
    'expected src/extension to be removed after the plugin cleanup'
  );
});

test('public directory should not keep removed plugin fixture pages', () => {
  const removedFixturePages = [
    'extension-blob-source-fixture.html',
    'extension-canvas-fallback-fixture.html',
    'extension-rendered-fallback-fixture.html',
    'extension-src-rerender-fixture.html'
  ];

  for (const filename of removedFixturePages) {
    assert.equal(
      existsSync(new URL(`../../public/${filename}`, import.meta.url)),
      false,
      `expected public/${filename} to be removed`
    );
  }
});

test('obsolete plugin design notes should not stay in active docs', () => {
  for (const filename of obsoleteSuperpowersDocs) {
    assert.equal(
      existsSync(new URL(`../../docs/superpowers/${filename}`, import.meta.url)),
      false,
      `expected docs/superpowers/${filename} to be removed`
    );
  }
});

test('orphaned superpowers plan directories should not remain after removing obsolete notes', () => {
  const superpowersPlansDir = new URL('../../docs/superpowers/plans/', import.meta.url);
  const superpowersDir = new URL('../../docs/superpowers/', import.meta.url);

  if (existsSync(superpowersPlansDir)) {
    const activePlanFiles = listRelativeFiles(superpowersPlansDir).filter(
      (relativePath) => !obsoleteSuperpowersDocs.includes(`plans/${relativePath}`)
    );
    assert.notEqual(
      activePlanFiles.length,
      0,
      'expected docs/superpowers/plans to contain active docs when the directory remains'
    );
  }

  if (existsSync(superpowersDir)) {
    const activeSuperpowersFiles = listRelativeFiles(superpowersDir).filter(
      (relativePath) => !obsoleteSuperpowersDocs.includes(relativePath)
    );
    assert.notEqual(
      activeSuperpowersFiles.length,
      0,
      'expected docs/superpowers to contain active docs when the directory remains'
    );
  }
});

test('historical implementation plan docs should not remain in docs/plans', () => {
  const removedPlanDocs = [
    '2026-03-19-5png-residual-repair-plan.md',
    '2026-03-19-algorithm-improvements.md',
    '2026-03-19-delayed-adaptive-fallback-plan.md'
  ];

  for (const filename of removedPlanDocs) {
    assert.equal(
      existsSync(new URL(`../../docs/plans/${filename}`, import.meta.url)),
      false,
      `expected docs/plans/${filename} to be removed`
    );
  }

  assert.equal(
    existsSync(new URL('../../docs/plans', import.meta.url)),
    false,
    'expected docs/plans to be removed once historical implementation plans are deleted'
  );
});

test('AGENTS guide should not reference removed historical validation docs', () => {
  const agents = readFileSync(new URL('../../AGENTS.md', import.meta.url), 'utf8');

  assert.equal(
    existsSync(new URL('../../docs/tests/2026-03-20-tampermonkey-worker-validation.md', import.meta.url)),
    false,
    'expected historical tampermonkey validation timeline doc to be removed'
  );
  assert.doesNotMatch(
    agents,
    /docs\/tests\/2026-03-20-tampermonkey-worker-validation\.md/
  );
});

test('standalone sample asset notes should not remain when they are not part of the active docs surface', () => {
  assert.equal(
    existsSync(new URL('../../docs/tests/sample-assets.md', import.meta.url)),
    false,
    'expected docs/tests/sample-assets.md to be removed'
  );
  assert.equal(
    existsSync(new URL('../../docs/tests', import.meta.url)),
    false,
    'expected docs/tests to be removed once stale test notes are deleted'
  );
});

test('local agent rules should not be committed into the project tree', () => {
  assert.equal(
    existsSync(new URL('../../.agents/rules/locale.md', import.meta.url)),
    false,
    'expected .agents/rules/locale.md to stay out of the repository'
  );
});

test('primary sample directory should not keep committed derived after snapshots', () => {
  const sampleFiles = listRelativeFiles(new URL('../../src/assets/samples/', import.meta.url));
  const derivedAfterFiles = sampleFiles.filter((relativePath) => /-after\.(png|webp|jpg|jpeg)$/i.test(relativePath));

  assert.deepEqual(
    derivedAfterFiles,
    [],
    `expected derived after snapshots to stay out of src/assets/samples, found: ${derivedAfterFiles.join(', ')}`
  );
});
