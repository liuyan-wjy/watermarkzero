import {
  FALLBACK_LOCALE,
  LOCALE_CONFIG,
  SUPPORTED_LOCALES,
  getLocaleFromPath,
  getLocalePath,
  resolveLocale as toCanonicalLocale
} from './i18n/locales.js';

const LOCALE_SHORT = Object.freeze(
  Object.fromEntries(SUPPORTED_LOCALES.map((locale) => [locale, LOCALE_CONFIG[locale].short]))
);

function safeGetStoredLocale() {
  try {
    return localStorage.getItem('locale');
  } catch {
    return null;
  }
}

function safeGetPathLocale() {
  try {
    return getLocaleFromPath(window.location.pathname);
  } catch {
    return null;
  }
}

function safeGetNavigatorLocale() {
  try {
    const languages = Array.isArray(navigator.languages) && navigator.languages.length > 0
      ? navigator.languages
      : [navigator.language];
    for (const language of languages) {
      const locale = toCanonicalLocale(language);
      if (locale) return locale;
    }
  } catch {
    return null;
  }

  return null;
}

function resolveInitialLocale() {
  const pathLocale = safeGetPathLocale();
  if (pathLocale) return pathLocale;

  const stored = toCanonicalLocale(safeGetStoredLocale());
  if (stored) return stored;

  const navigatorLocale = safeGetNavigatorLocale();
  if (navigatorLocale) return navigatorLocale;

  return FALLBACK_LOCALE;
}

const i18n = {
  locale: resolveInitialLocale(),
  translations: {},
  supportedLocales: SUPPORTED_LOCALES,

  resolveLocale(locale) {
    return toCanonicalLocale(locale) || FALLBACK_LOCALE;
  },

  persistLocale(locale) {
    try {
      localStorage.setItem('locale', locale);
    } catch {
      // ignore storage errors in non-browser contexts
    }
  },

  getNextLocale(current = this.locale) {
    const currentLocale = this.resolveLocale(current);
    const index = this.supportedLocales.indexOf(currentLocale);
    const nextIndex = (index + 1) % this.supportedLocales.length;
    return this.supportedLocales[nextIndex];
  },

  getLocaleShort(locale) {
    const normalized = this.resolveLocale(locale);
    return LOCALE_SHORT[normalized] || normalized;
  },

  getLocalePath(locale) {
    return getLocalePath(locale);
  },

  async init() {
    try {
      await this.loadTranslations(this.locale);
    } catch (error) {
      console.error('i18n init failed for locale:', this.locale, error);
      if (this.locale !== FALLBACK_LOCALE) {
        try {
          await this.loadTranslations(FALLBACK_LOCALE);
        } catch (fallbackError) {
          console.error('i18n fallback failed:', fallbackError);
          this.locale = FALLBACK_LOCALE;
          this.translations = {};
          this.persistLocale(this.locale);
        }
      }
    } finally {
      this.applyTranslations();
      if (typeof document !== 'undefined' && document?.body?.classList) {
        document.body.classList.remove('loading');
      }
    }
  },

  async loadTranslations(locale) {
    const resolvedLocale = this.resolveLocale(locale);
    const res = await fetch(`/i18n/${resolvedLocale}.json`);
    if (!res.ok) {
      throw new Error(`failed to load locale ${resolvedLocale}: ${res.status}`);
    }

    this.translations = await res.json();
    this.locale = resolvedLocale;
    this.persistLocale(resolvedLocale);
    return this.translations;
  },

  t(key) {
    let text = this.translations[key] || key;
    if (typeof text === 'string') {
      text = text.replace('{{year}}', new Date().getFullYear());
    }
    return text;
  },

  applyTranslations() {
    if (typeof document === 'undefined') return;

    if (document.documentElement) {
      const config = LOCALE_CONFIG[this.locale] || LOCALE_CONFIG[FALLBACK_LOCALE];
      document.documentElement.lang = config.htmlLang;
      document.documentElement.dir = config.dir;
    }
    document.title = this.t('title');
    document.querySelectorAll('[data-i18n]').forEach((el) => {
      const key = el.getAttribute('data-i18n');
      if (el.tagName === 'INPUT' && el.placeholder !== undefined) {
        el.placeholder = this.t(key);
      } else {
        el.textContent = this.t(key);
      }
    });
  },

  async switchLocale(locale) {
    await this.loadTranslations(locale);
    this.applyTranslations();
  },
};

export default i18n;
