import { mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { TRANSLATIONS } from '../src/i18n/translations.js';
import { SUPPORTED_LOCALES } from '../src/i18n/locales.js';

const repoRoot = resolve(fileURLToPath(new URL('..', import.meta.url)));
const i18nDir = join(repoRoot, 'src', 'i18n');
const baseKeys = Object.keys(TRANSLATIONS['en-US']).sort();

mkdirSync(i18nDir, { recursive: true });

for (const locale of SUPPORTED_LOCALES) {
  const dictionary = TRANSLATIONS[locale];
  if (!dictionary) {
    throw new Error(`Missing translation dictionary for ${locale}`);
  }

  const keys = Object.keys(dictionary).sort();
  const missing = baseKeys.filter((key) => !keys.includes(key));
  const extra = keys.filter((key) => !baseKeys.includes(key));
  if (missing.length || extra.length) {
    throw new Error(
      `${locale} translation keys differ from en-US. Missing: ${missing.join(', ')} Extra: ${extra.join(', ')}`
    );
  }

  writeFileSync(join(i18nDir, `${locale}.json`), `${JSON.stringify(dictionary, null, 2)}\n`);
}

console.log(`synced ${SUPPORTED_LOCALES.length} locale files`);

