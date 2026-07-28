import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

test('package.json should expose the expected local script entrypoints', () => {
  const pkg = JSON.parse(readFileSync(new URL('../../package.json', import.meta.url), 'utf8'));

  const expectedScripts = {
    clean: 'node scripts/clean.js',
    'clean:all': 'node scripts/clean.js --include-profile',
    'convert:samples:webp': 'node scripts/convert-samples-to-webp.js',
    'probe:tm': 'node scripts/tampermonkey-smoke.js run',
    'probe:tm:setup': 'node scripts/tampermonkey-smoke.js setup',
    'probe:tm:freshness': 'node scripts/tampermonkey-freshness.js',
    'probe:tm:profile': 'node scripts/open-tampermonkey-profile.js',
    'probe:real-page:compare': 'node scripts/real-page-pixel-compare.js',
    'benchmark:userscript': 'node scripts/userscript-benchmark.js',
    'cli:smoke': 'node bin/gwr.mjs --help'
  };

  for (const [scriptName, command] of Object.entries(expectedScripts)) {
    assert.equal(
      pkg.scripts?.[scriptName],
      command,
      `expected package.json to expose ${scriptName}`
    );
  }
});
