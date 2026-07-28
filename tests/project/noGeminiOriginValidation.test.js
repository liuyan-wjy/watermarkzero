import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { hasImportedBinding, loadModuleSource } from '../testUtils/moduleStructure.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..', '..');
const i18nDir = path.join(repoRoot, 'src', 'i18n');

test('app should not depend on Gemini original-source validation helpers', () => {
    const appSource = loadModuleSource('../../src/app.js', import.meta.url);

    assert.equal(hasImportedBinding(appSource, './utils.js', 'checkOriginal'), false);
    assert.equal(hasImportedBinding(appSource, './utils.js', 'getOriginalStatus'), false);
    assert.equal(hasImportedBinding(appSource, './utils.js', 'resolveOriginalValidation'), false);
    assert.equal(appSource.includes('checkOriginal('), false);
    assert.equal(appSource.includes('getOriginalStatus('), false);
    assert.equal(appSource.includes('resolveOriginalValidation('), false);
});

test('locale files should not expose Gemini original-source status copy', () => {
    const localeFiles = readdirSync(i18nDir).filter((name) => name.endsWith('.json'));

    for (const fileName of localeFiles) {
        const locale = JSON.parse(readFileSync(path.join(i18nDir, fileName), 'utf8'));
        assert.equal('original.not_gemini' in locale, false, `${fileName} should not define original.not_gemini`);
        assert.equal('original.unconfirmed' in locale, false, `${fileName} should not define original.unconfirmed`);
        assert.equal('original.pass' in locale, false, `${fileName} should not define original.pass`);
    }
});
