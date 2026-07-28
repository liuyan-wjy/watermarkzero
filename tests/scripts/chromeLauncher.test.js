import test from 'node:test';
import assert from 'node:assert/strict';

import {
  buildChromeLaunchSpec,
  resolveChromeExecutablePath
} from '../../scripts/chrome-launcher.js';

test('resolveChromeExecutablePath should return the macOS Chrome app bundle when present', () => {
  const resolved = resolveChromeExecutablePath(
    {},
    {
      platform: 'darwin',
      exists: (candidate) => candidate === '/Applications/Google Chrome.app'
    }
  );

  assert.equal(resolved, '/Applications/Google Chrome.app');
});

test('resolveChromeExecutablePath should normalize an overridden macOS app binary path', () => {
  const resolved = resolveChromeExecutablePath(
    {
      GWR_DEBUG_EXECUTABLE_PATH: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
    },
    {
      platform: 'darwin',
      exists: () => true
    }
  );

  assert.equal(resolved, '/Applications/Google Chrome.app');
});

test('buildChromeLaunchSpec should use open for macOS app bundles', () => {
  const launchSpec = buildChromeLaunchSpec({
    executablePath: '/Applications/Google Chrome.app',
    chromeArgs: ['--remote-debugging-port=9226', 'https://example.com'],
    platform: 'darwin'
  });

  assert.equal(launchSpec.command, '/usr/bin/open');
  assert.deepEqual(launchSpec.args, [
    '-na',
    '/Applications/Google Chrome.app',
    '--args',
    '--remote-debugging-port=9226',
    'https://example.com'
  ]);
});

test('buildChromeLaunchSpec should launch executable paths directly on win32', () => {
  const launchSpec = buildChromeLaunchSpec({
    executablePath: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    chromeArgs: ['--remote-debugging-port=9226'],
    platform: 'win32'
  });

  assert.equal(launchSpec.command, 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe');
  assert.deepEqual(launchSpec.args, ['--remote-debugging-port=9226']);
});
