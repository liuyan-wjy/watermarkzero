import test from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import { mkdtemp, rm } from 'node:fs/promises';

import { packProjectTarball, runCommand } from './testUtils.js';

test('pnpm pack should publish sdk entrypoints without shipping test fixtures', async () => {
    const tempDir = await mkdtemp(path.join(os.tmpdir(), 'wm-pack-'));
    try {
        const tarballPath = await packProjectTarball(tempDir);
        const listing = runCommand('tar', ['-tf', tarballPath]).stdout
            .split(/\r?\n/)
            .filter(Boolean);

        assert.ok(listing.includes('package/package.json'));
        assert.ok(listing.includes('package/src/sdk/index.js'));
        assert.ok(listing.includes('package/src/sdk/browser.js'));
        assert.ok(listing.includes('package/src/sdk/image-data.js'));
        assert.ok(listing.includes('package/src/sdk/node.js'));
        assert.ok(listing.includes('package/src/core/watermarkProcessor.js'));
        assert.ok(listing.includes('package/src/cli/gwrCli.js'));
        assert.ok(listing.includes('package/src/cli/gwrRemoveCommand.js'));
        assert.ok(listing.includes('package/bin/gwr.mjs'));
        assert.ok(listing.includes('package/skills/gemini-watermark-remover/SKILL.md'));
        assert.ok(listing.includes('package/skills/gemini-watermark-remover/agents/openai.yaml'));
        assert.ok(listing.includes('package/skills/gemini-watermark-remover/references/usage.md'));
        assert.ok(listing.includes('package/skills/gemini-watermark-remover/references/inputs-and-outputs.md'));
        assert.ok(listing.includes('package/skills/gemini-watermark-remover/references/limitations.md'));
        assert.ok(listing.includes('package/skills/gemini-watermark-remover/scripts/run.mjs'));
        assert.ok(listing.includes('package/README.md'));
        assert.ok(listing.includes('package/LICENSE'));
        assert.equal(listing.some((item) => item.startsWith('package/tests/')), false);
        assert.equal(listing.some((item) => item.startsWith('package/public/')), false);
        assert.equal(listing.some((item) => item.startsWith('package/src/assets/')), false);
    } finally {
        await rm(tempDir, { recursive: true, force: true });
    }
});
