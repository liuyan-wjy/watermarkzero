import test from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { readFile, stat } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { promisify } from 'node:util';
import JSZip from 'jszip';

const execFileAsync = promisify(execFile);
const rootUrl = new URL('../../', import.meta.url);

async function readJson(relativePath) {
  const text = await readFile(new URL(relativePath, rootUrl), 'utf8');
  return JSON.parse(text);
}

test('extension manifest should use MV3 without broad permissions', async () => {
  const manifest = await readJson('extension/manifest.json');

  assert.equal(manifest.manifest_version, 3);
  assert.equal(manifest.name, 'Gemini Watermark Remover');
  assert.equal(manifest.homepage_url, 'https://watermarkzero.org');
  assert.equal(manifest.action.default_popup, 'popup.html');
  assert.deepEqual(manifest.permissions || [], []);
  assert.deepEqual(manifest.host_permissions || [], []);
  assert.match(manifest.description, /local|uploads/i);

  for (const size of ['16', '32', '48', '128']) {
    assert.equal(manifest.icons[size], `icons/icon-${size}.png`);
    assert.equal(manifest.action.default_icon[size], `icons/icon-${size}.png`);
  }
});

test('extension popup should not load remote scripts or iframe the website', async () => {
  const popupHtml = await readFile(new URL('extension/popup.html', rootUrl), 'utf8');

  assert.doesNotMatch(popupHtml, /<iframe/i);
  assert.doesNotMatch(popupHtml, /<script[^>]+src=["']https?:\/\//i);
  assert.match(popupHtml, /popup\.js/);
  assert.match(popupHtml, /https:\/\/watermarkzero\.org/);
  assert.match(popupHtml, /https:\/\/watermarkzero\.org\/privacy\//);
});

test('extension package should place manifest.json at the ZIP root', async () => {
  await execFileAsync('node', ['scripts/package-chrome-extension.js', '--prod'], {
    cwd: new URL('.', rootUrl)
  });

  const packageDir = new URL('.artifacts/chrome-extension/', rootUrl);
  const zipFile = new URL('.artifacts/chrome-extension.zip', rootUrl);

  assert.equal(existsSync(new URL('manifest.json', packageDir)), true);
  assert.equal(existsSync(new URL('popup.js', packageDir)), true);
  assert.equal(existsSync(new URL('icons/icon-128.png', packageDir)), true);

  const zipBytes = await readFile(zipFile);
  const zip = await JSZip.loadAsync(zipBytes);
  assert.notEqual(zip.file('manifest.json'), null);
  assert.notEqual(zip.file('popup.html'), null);
  assert.notEqual(zip.file('popup.js'), null);
  assert.notEqual(zip.file('icons/icon-128.png'), null);

  const iconStats = await stat(new URL('icons/icon-128.png', packageDir));
  assert.ok(iconStats.size > 0, 'expected generated 128px icon to be non-empty');
});
