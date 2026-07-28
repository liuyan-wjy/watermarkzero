import path from 'node:path';
import { existsSync } from 'node:fs';

const MACOS_CHROME_APP = '/Applications/Google Chrome.app';
const MACOS_CHROME_BINARY_SUFFIX = '/Contents/MacOS/Google Chrome';

function normalizeChromeExecutablePath(executablePath = '', platform = process.platform) {
  const value = String(executablePath || '').trim();
  if (!value) {
    return '';
  }

  if (platform === 'darwin' && value.endsWith(MACOS_CHROME_BINARY_SUFFIX)) {
    return value.slice(0, -MACOS_CHROME_BINARY_SUFFIX.length);
  }

  return value;
}

export function resolveChromeExecutablePath(
  env = process.env,
  {
    platform = process.platform,
    exists = existsSync
  } = {}
) {
  if (env.GWR_DEBUG_EXECUTABLE_PATH) {
    return normalizeChromeExecutablePath(env.GWR_DEBUG_EXECUTABLE_PATH, platform);
  }

  const candidates = platform === 'win32'
    ? [
        'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
        'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
        path.join(env.LOCALAPPDATA || '', 'Google\\Chrome\\Application\\chrome.exe')
      ]
    : platform === 'darwin'
      ? [
          MACOS_CHROME_APP,
          path.join(env.HOME || '', 'Applications/Google Chrome.app')
        ]
      : [
          '/usr/bin/google-chrome',
          '/usr/bin/google-chrome-stable',
          '/opt/google/chrome/chrome'
        ];

  return candidates.find((candidate) => candidate && exists(candidate)) || '';
}

export function buildChromeLaunchSpec({
  executablePath = '',
  chromeArgs = [],
  platform = process.platform
} = {}) {
  const resolvedExecutablePath = normalizeChromeExecutablePath(executablePath, platform);
  if (!resolvedExecutablePath) {
    throw new Error('Chrome executable path is required');
  }

  if (platform === 'darwin' && resolvedExecutablePath.endsWith('.app')) {
    return {
      command: '/usr/bin/open',
      args: [
        '-na',
        resolvedExecutablePath,
        '--args',
        ...chromeArgs
      ]
    };
  }

  return {
    command: resolvedExecutablePath,
    args: [...chromeArgs]
  };
}
