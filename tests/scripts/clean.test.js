import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';

test('clean script should default to generated artifacts and keep the fixed Chrome profile optional', async () => {
  const scriptUrl = new URL('../../scripts/clean.js', import.meta.url);
  assert.equal(existsSync(scriptUrl), true, 'expected scripts/clean.js to exist');
  if (!existsSync(scriptUrl)) {
    return;
  }

  const {
    DEFAULT_CLEAN_PATHS,
    OPTIONAL_CLEAN_PATHS,
    resolveCleanupTargets
  } = await import(scriptUrl.href);

  assert.deepEqual(DEFAULT_CLEAN_PATHS, [
    'dist',
    '.artifacts',
    'src/assets/samples/fix'
  ]);
  assert.deepEqual(OPTIONAL_CLEAN_PATHS, ['.chrome-debug']);
  assert.deepEqual(resolveCleanupTargets(), [
    'dist',
    '.artifacts',
    'src/assets/samples/fix'
  ]);
  assert.deepEqual(resolveCleanupTargets({ includeProfile: true }), [
    'dist',
    '.artifacts',
    'src/assets/samples/fix',
    '.chrome-debug'
  ]);
});
