const LOCALIZED_HOME_PATHS = [
  '/',
  '/es/',
  '/fr/',
  '/ja/',
  '/ko/',
  '/de/',
  '/pt/',
  '/it/',
  '/no/',
  '/nl/',
  '/sv/',
  '/da/',
  '/fi/',
  '/he/',
  '/ar/',
  '/zh-cn/',
  '/zh-tw/'
];

const SITEMAP_PATHS = [
  ...LOCALIZED_HOME_PATHS,
  '/gemini-watermark-remover/',
  '/remove-gemini-watermark/',
  '/remove-gemini-watermark-from-image/',
  '/nano-banana-watermark-remover/',
  '/batch-gemini-watermark-remover/',
  '/blog/',
  '/blog/how-gemini-watermarks-work/',
  '/blog/how-to-remove-gemini-watermark/',
  '/blog/remove-gemini-watermark-online/',
  '/blog/gemini-logo-remover/',
  '/blog/gemini-watermark-remover-test-results/',
  '/blog/visible-gemini-watermark-vs-synthid/',
  '/blog/gemini-watermark-remover-troubleshooting/',
  '/blog/free-gemini-watermark-remover/',
  '/blog/gemini-watermark-remover-github/',
  '/blog/gemini-watermark-remover-extension/',
  '/blog/gemini-watermark-remover-pdf/',
  '/blog/lossless-gemini-watermark-removal/'
];
const NOINDEX_PATHS = new Set(['/privacy/', '/terms/', '/privacy.html', '/terms.html']);
const TRAILING_SLASH_PATHS = new Set(
  [...SITEMAP_PATHS, '/privacy/', '/terms/']
    .filter((path) => path !== '/' && path.endsWith('/'))
    .map((path) => path.slice(0, -1))
);
const LEGACY_PATH_REDIRECTS = new Map([
  ['/privacy.html', '/privacy/'],
  ['/terms.html', '/terms/']
]);
const OG_IMAGE_PATH = '/og-cover.png';
const GOOGLE_TAG_SCRIPT_ORIGIN = 'https://www.googletagmanager.com';
const CLOUDFLARE_INSIGHTS_ORIGIN = 'https://static.cloudflareinsights.com';
const GOOGLE_ANALYTICS_ORIGINS = [
  'https://www.google-analytics.com',
  'https://region1.google-analytics.com'
];
const AD_SCRIPT_ORIGINS = [
  'https://pl29298869.profitablecpmratenetwork.com',
  'https://www.highperformanceformat.com'
];

function xmlEscape(value) {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&apos;');
}

function buildSitemap(origin) {
  const urls = SITEMAP_PATHS.map(
    (path) => `<url><loc>${xmlEscape(`${origin}${path}`)}</loc></url>`
  ).join('');

  return `<?xml version="1.0" encoding="UTF-8"?>` +
    `<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${urls}</urlset>`;
}

function withHeaders(response, options = {}) {
  const headers = new Headers(response.headers);
  const { robotsTag = '' } = options;
  headers.set('Referrer-Policy', 'strict-origin-when-cross-origin');
  headers.set('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
  headers.set('X-Content-Type-Options', 'nosniff');
  headers.set('X-Frame-Options', 'SAMEORIGIN');
  if (robotsTag) {
    headers.set('X-Robots-Tag', robotsTag);
  }

  const contentType = headers.get('content-type') || '';
  if (contentType.includes('text/html')) {
    headers.set(
      'Content-Security-Policy',
      `default-src 'self'; img-src 'self' data: https: blob:; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com https://cdn.tailwindcss.com; font-src 'self' https://fonts.gstatic.com data:; script-src 'self' 'unsafe-inline' https://cdn.tailwindcss.com ${GOOGLE_TAG_SCRIPT_ORIGIN} ${CLOUDFLARE_INSIGHTS_ORIGIN} ${AD_SCRIPT_ORIGINS.join(' ')}; connect-src 'self' ${GOOGLE_ANALYTICS_ORIGINS.join(' ')} https:; frame-src 'self' https:; worker-src 'self' blob:; base-uri 'self'; form-action 'self';`
    );
  }

  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers
  });
}

function resolveSiteOrigin(env, url) {
  try {
    if (typeof env?.SITE_ORIGIN === 'string' && env.SITE_ORIGIN.trim().length > 0) {
      return new URL(env.SITE_ORIGIN.trim()).origin;
    }
  } catch {
    // fall back to request origin
  }

  return url.origin;
}

function isCanonicalRequest(url, siteOrigin) {
  return url.origin === siteOrigin;
}

function getRobotsTag(url, canonicalRequest) {
  if (!canonicalRequest) {
    return 'noindex, nofollow';
  }

  if (NOINDEX_PATHS.has(url.pathname)) {
    return 'noindex, follow';
  }

  return '';
}

function getCanonicalUrl(url) {
  return url.pathname.endsWith('/') || url.pathname.includes('.')
    ? new URL(url.pathname, url.origin).toString()
    : new URL(`${url.pathname}/`, url.origin).toString();
}

function isValidGoogleTagId(value) {
  return typeof value === 'string' && /^(G|GT)-[A-Z0-9]+$/i.test(value.trim());
}

function buildGa4Snippet(measurementId) {
  return `
  <!-- Google tag (gtag.js) -->
  <script async src="${GOOGLE_TAG_SCRIPT_ORIGIN}/gtag/js?id=${measurementId}"></script>
  <script>
    window.dataLayer = window.dataLayer || [];
    function gtag(){dataLayer.push(arguments);}
    gtag('js', new Date());
    gtag('config', '${measurementId}');
  </script>`;
}

async function rewriteHtmlMetadata(response, url, env) {
  const siteOrigin = resolveSiteOrigin(env, url);
  const ogImageUrl = new URL(OG_IMAGE_PATH, siteOrigin).toString();
  const canonicalUrl = getCanonicalUrl(new URL(url.pathname + url.search, siteOrigin));
  const measurementId = isValidGoogleTagId(env?.GA4_MEASUREMENT_ID)
    ? env.GA4_MEASUREMENT_ID.trim()
    : '';
  const shouldInjectGa4 = measurementId && isCanonicalRequest(url, siteOrigin);
  const html = await response.text();
  let rewrittenHtml = html
    .replace(/<link rel="canonical" href="[^"]*">/i, `<link rel="canonical" href="${canonicalUrl}">`)
    .replace(/<meta property="og:url" content="[^"]*">/i, `<meta property="og:url" content="${canonicalUrl}">`)
    .replace(/<meta property="og:image" content="[^"]*">/i, `<meta property="og:image" content="${ogImageUrl}">`)
    .replace(/<meta name="twitter:image" content="[^"]*">/i, `<meta name="twitter:image" content="${ogImageUrl}">`);

  if (shouldInjectGa4 && !rewrittenHtml.includes(`gtag/js?id=${measurementId}`)) {
    rewrittenHtml = rewrittenHtml.replace(/<head>/i, `<head>${buildGa4Snippet(measurementId)}`);
  }

  return new Response(rewrittenHtml, {
    status: response.status,
    statusText: response.statusText,
    headers: response.headers
  });
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const siteOrigin = resolveSiteOrigin(env, url);
    const canonicalRequest = isCanonicalRequest(url, siteOrigin);
    const siteUrl = new URL(siteOrigin);
    const apexHostname = siteUrl.hostname;
    const redirectOrigin = canonicalRequest ? siteOrigin : url.origin;

    if (
      (url.protocol === 'http:' && siteUrl.protocol === 'https:' && url.hostname === apexHostname) ||
      url.hostname === `www.${apexHostname}`
    ) {
      return Response.redirect(`${siteOrigin}${url.pathname}${url.search}`, 301);
    }

    if (url.pathname === '/robots.txt') {
      const body = canonicalRequest
        ? `User-agent: *\nAllow: /\nSitemap: ${siteOrigin}/sitemap.xml\n`
        : 'User-agent: *\nDisallow: /\n';
      return new Response(
        body,
        {
          headers: {
            'content-type': 'text/plain; charset=utf-8',
            'cache-control': 'public, max-age=3600'
          }
        }
      );
    }

    if (url.pathname === '/sitemap.xml') {
      return new Response(buildSitemap(siteOrigin), {
        headers: {
          'content-type': 'application/xml; charset=utf-8',
          'cache-control': 'public, max-age=3600'
        }
      });
    }

    const legacyTarget = LEGACY_PATH_REDIRECTS.get(url.pathname);
    if (legacyTarget) {
      return Response.redirect(`${redirectOrigin}${legacyTarget}${url.search}`, 301);
    }

    if (TRAILING_SLASH_PATHS.has(url.pathname)) {
      return Response.redirect(`${redirectOrigin}${url.pathname}/${url.search}`, 301);
    }

    const assetResponse = await env.ASSETS.fetch(request);
    const contentType = assetResponse.headers.get('content-type') || '';
    const rewrittenResponse = contentType.includes('text/html')
      ? await rewriteHtmlMetadata(assetResponse, url, env)
      : assetResponse;
    return withHeaders(rewrittenResponse, {
      robotsTag: getRobotsTag(url, canonicalRequest)
    });
  }
};
