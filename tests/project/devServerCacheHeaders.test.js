import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

test('dev static server should disable browser caching for local dist assets', async () => {
    const source = await readFile(new URL('../../build.js', import.meta.url), 'utf8');

    assert.match(source, /Cache-Control/);
    assert.match(source, /no-store/);
});
