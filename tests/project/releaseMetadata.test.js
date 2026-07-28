import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

async function readText(relativePath) {
    return readFile(new URL(`../../${relativePath}`, import.meta.url), 'utf8');
}

test('current package version should be documented in both changelog files', async () => {
    const packageJson = JSON.parse(await readText('package.json'));
    const versionHeadingPattern = new RegExp(`^##\\s+${packageJson.version}\\s+-\\s+`, 'm');
    const [changelogEn, changelogZh] = await Promise.all([
        readText('CHANGELOG.md'),
        readText('CHANGELOG_zh.md')
    ]);

    assert.match(changelogEn, versionHeadingPattern);
    assert.match(changelogZh, versionHeadingPattern);
});

test('release checklists should require updating both changelog files', async () => {
    const [releaseEn, releaseZh] = await Promise.all([
        readText('RELEASE.md'),
        readText('RELEASE_zh.md')
    ]);

    assert.match(releaseEn, /CHANGELOG\.md/);
    assert.match(releaseEn, /CHANGELOG_zh\.md/);
    assert.match(releaseZh, /CHANGELOG\.md/);
    assert.match(releaseZh, /CHANGELOG_zh\.md/);
});
