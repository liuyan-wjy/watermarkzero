import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  FALLBACK_LOCALE,
  LOCALE_CONFIG,
  SUPPORTED_LOCALES,
  getLocalePath
} from '../src/i18n/locales.js';
import { TRANSLATIONS } from '../src/i18n/translations.js';

const SITE_ORIGIN = 'https://watermarkzero.org';
const repoRoot = resolve(fileURLToPath(new URL('..', import.meta.url)));
const distRoot = join(repoRoot, 'dist');
const sourcePath = join(distRoot, 'index.html');

function escapeHtml(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function escapeAttr(value) {
  return escapeHtml(value);
}

function t(locale, key) {
  const text = TRANSLATIONS[locale]?.[key] || TRANSLATIONS[FALLBACK_LOCALE][key] || key;
  return typeof text === 'string'
    ? text.replace('{{year}}', String(new Date().getFullYear()))
    : text;
}

function buildAbsoluteUrl(locale) {
  return `${SITE_ORIGIN}${getLocalePath(locale)}`;
}

function buildHreflangLinks() {
  const links = [
    `<link rel="alternate" hreflang="x-default" href="${buildAbsoluteUrl(FALLBACK_LOCALE)}">`
  ];

  for (const locale of SUPPORTED_LOCALES) {
    links.push(
      `<link rel="alternate" hreflang="${LOCALE_CONFIG[locale].hreflang}" href="${buildAbsoluteUrl(locale)}">`
    );
  }

  return links.join('\n  ');
}

function replaceMeta(html, locale) {
  const config = LOCALE_CONFIG[locale];
  const canonical = buildAbsoluteUrl(locale);
  const title = t(locale, 'title');
  const description = t(locale, 'meta.description');
  const ogTitle = t(locale, 'meta.og.title');
  const ogDescription = t(locale, 'meta.og.description');
  const dirAttribute = config.dir === 'rtl' ? ' dir="rtl"' : '';

  let localized = html
    .replace(/<html\b[^>]*>/i, `<html lang="${escapeAttr(config.htmlLang)}"${dirAttribute}>`)
    .replace(/<title>[\s\S]*?<\/title>/i, `<title>${escapeHtml(title)}</title>`)
    .replace(/<meta name="description" content="[^"]*">/i, `<meta name="description" content="${escapeAttr(description)}">`)
    .replace(
      /<link rel="canonical" href="[^"]*">\s*/i,
      `<link rel="canonical" href="${canonical}">\n  ${buildHreflangLinks()}\n  `
    )
    .replace(/<meta property="og:title" content="[^"]*">/i, `<meta property="og:title" content="${escapeAttr(ogTitle)}">`)
    .replace(/<meta property="og:description" content="[^"]*">/i, `<meta property="og:description" content="${escapeAttr(ogDescription)}">`)
    .replace(/<meta property="og:url" content="[^"]*">/i, `<meta property="og:url" content="${canonical}">`)
    .replace(/<meta name="twitter:title" content="[^"]*">/i, `<meta name="twitter:title" content="${escapeAttr(ogTitle)}">`)
    .replace(/<meta name="twitter:description" content="[^"]*">/i, `<meta name="twitter:description" content="${escapeAttr(ogDescription)}">`);

  localized = localized.replace(/<option value="([^"]+)"(?: selected)?>/g, (match, optionLocale) => {
    const selected = optionLocale === locale ? ' selected' : '';
    return `<option value="${optionLocale}"${selected}>`;
  });

  return localized;
}

function replaceI18nText(html, locale) {
  return html.replace(
    /(<([a-zA-Z0-9:-]+)\b[^>]*\bdata-i18n="([^"]+)"[^>]*>)([\s\S]*?)(<\/\2>)/g,
    (match, openTag, tagName, key, innerHtml, closeTag) => {
      const text = t(locale, key);
      if (text === key && !TRANSLATIONS[FALLBACK_LOCALE][key]) return match;
      return `${openTag}${escapeHtml(text)}${closeTag}`;
    }
  );
}

function writeLocalizedPage(template, locale) {
  const slug = LOCALE_CONFIG[locale].slug;
  const outputPath = slug ? join(distRoot, slug, 'index.html') : join(distRoot, 'index.html');
  const html = replaceI18nText(replaceMeta(template, locale), locale);

  mkdirSync(dirname(outputPath), { recursive: true });
  writeFileSync(outputPath, html);
}

if (!existsSync(sourcePath)) {
  throw new Error(`Missing built homepage at ${sourcePath}`);
}

const template = readFileSync(sourcePath, 'utf8');
for (const locale of SUPPORTED_LOCALES) {
  writeLocalizedPage(template, locale);
}

console.log(`generated ${SUPPORTED_LOCALES.length} localized homepage routes`);
