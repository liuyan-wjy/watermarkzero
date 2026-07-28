export const FALLBACK_LOCALE = 'en-US';

export const LOCALE_CONFIG = Object.freeze({
  'en-US': {
    label: '🇺🇸 English',
    short: 'EN',
    slug: '',
    htmlLang: 'en',
    hreflang: 'en',
    dir: 'ltr'
  },
  'es-ES': {
    label: '🇪🇸 Español',
    short: 'ES',
    slug: 'es',
    htmlLang: 'es',
    hreflang: 'es',
    dir: 'ltr'
  },
  'fr-FR': {
    label: '🇫🇷 Français',
    short: 'FR',
    slug: 'fr',
    htmlLang: 'fr',
    hreflang: 'fr',
    dir: 'ltr'
  },
  'ja-JP': {
    label: '🇯🇵 日本語',
    short: 'JA',
    slug: 'ja',
    htmlLang: 'ja',
    hreflang: 'ja',
    dir: 'ltr'
  },
  'ko-KR': {
    label: '🇰🇷 한국어',
    short: 'KO',
    slug: 'ko',
    htmlLang: 'ko',
    hreflang: 'ko',
    dir: 'ltr'
  },
  'de-DE': {
    label: '🇩🇪 Deutsch',
    short: 'DE',
    slug: 'de',
    htmlLang: 'de',
    hreflang: 'de',
    dir: 'ltr'
  },
  'pt-BR': {
    label: '🇧🇷 Português',
    short: 'PT',
    slug: 'pt',
    htmlLang: 'pt-BR',
    hreflang: 'pt-BR',
    dir: 'ltr'
  },
  'it-IT': {
    label: '🇮🇹 Italiano',
    short: 'IT',
    slug: 'it',
    htmlLang: 'it',
    hreflang: 'it',
    dir: 'ltr'
  },
  'nb-NO': {
    label: '🇳🇴 Norsk (Bokmål)',
    short: 'NO',
    slug: 'no',
    htmlLang: 'nb',
    hreflang: 'nb',
    dir: 'ltr'
  },
  'nl-NL': {
    label: '🇳🇱 Nederlands',
    short: 'NL',
    slug: 'nl',
    htmlLang: 'nl',
    hreflang: 'nl',
    dir: 'ltr'
  },
  'sv-SE': {
    label: '🇸🇪 Svenska',
    short: 'SV',
    slug: 'sv',
    htmlLang: 'sv',
    hreflang: 'sv',
    dir: 'ltr'
  },
  'da-DK': {
    label: '🇩🇰 Dansk',
    short: 'DA',
    slug: 'da',
    htmlLang: 'da',
    hreflang: 'da',
    dir: 'ltr'
  },
  'fi-FI': {
    label: '🇫🇮 Suomi',
    short: 'FI',
    slug: 'fi',
    htmlLang: 'fi',
    hreflang: 'fi',
    dir: 'ltr'
  },
  'he-IL': {
    label: '🇮🇱 עברית',
    short: 'HE',
    slug: 'he',
    htmlLang: 'he',
    hreflang: 'he',
    dir: 'rtl'
  },
  'ar-SA': {
    label: '🇸🇦 العربية',
    short: 'AR',
    slug: 'ar',
    htmlLang: 'ar',
    hreflang: 'ar',
    dir: 'rtl'
  },
  'zh-CN': {
    label: '🇨🇳 简体中文',
    short: '简中',
    slug: 'zh-cn',
    htmlLang: 'zh-CN',
    hreflang: 'zh-CN',
    dir: 'ltr'
  },
  'zh-TW': {
    label: '🇹🇼 繁體中文',
    short: '繁中',
    slug: 'zh-tw',
    htmlLang: 'zh-TW',
    hreflang: 'zh-TW',
    dir: 'ltr'
  }
});

export const SUPPORTED_LOCALES = Object.freeze(Object.keys(LOCALE_CONFIG));

const SLUG_TO_LOCALE = Object.freeze(
  Object.fromEntries(
    SUPPORTED_LOCALES
      .filter((locale) => LOCALE_CONFIG[locale].slug)
      .map((locale) => [LOCALE_CONFIG[locale].slug, locale])
  )
);

export function resolveLocale(locale) {
  if (!locale || typeof locale !== 'string') return null;
  if (SUPPORTED_LOCALES.includes(locale)) return locale;

  const normalized = locale.toLowerCase().replace('_', '-');
  if (SLUG_TO_LOCALE[normalized]) return SLUG_TO_LOCALE[normalized];
  if (normalized === 'zh-hant' || normalized.startsWith('zh-hk') || normalized.startsWith('zh-tw')) return 'zh-TW';
  if (normalized === 'zh-hans' || normalized.startsWith('zh-cn') || normalized.startsWith('zh-sg')) return 'zh-CN';
  if (normalized.startsWith('zh')) return 'zh-CN';
  if (normalized.startsWith('pt')) return 'pt-BR';
  if (normalized.startsWith('nb') || normalized.startsWith('nn') || normalized === 'no') return 'nb-NO';

  const language = normalized.split('-')[0];
  return SUPPORTED_LOCALES.find((supportedLocale) => supportedLocale.toLowerCase().startsWith(`${language}-`)) || null;
}

export function getLocalePath(locale) {
  const resolvedLocale = resolveLocale(locale) || FALLBACK_LOCALE;
  const slug = LOCALE_CONFIG[resolvedLocale].slug;
  return slug ? `/${slug}/` : '/';
}

export function getLocaleFromPath(pathname = '/') {
  const slug = pathname.split('/').filter(Boolean)[0] || '';
  return SLUG_TO_LOCALE[slug] || null;
}
