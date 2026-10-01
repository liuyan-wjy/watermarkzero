import assert from 'node:assert/strict';
import { readFile, readdir, mkdtemp, mkdir, cp, rm } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import siteWorker from '../../worker.mjs';
import { TRANSLATIONS } from '../../src/i18n/translations.js';

const SITE_ORIGIN = 'https://watermarkzero.org';

test('localized generation keeps tutorial links and hreflang stable across repeated builds', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'watermarkzero-locales-'));
  try {
    for (const path of ['scripts', 'src/i18n', 'public']) await mkdir(join(directory, path), { recursive: true });
    for (const path of ['package.json', 'scripts/generate-localized-pages.js', 'src/i18n/locales.js', 'src/i18n/translations.js', 'public/index.html']) {
      await cp(path, join(directory, path));
    }
    const generate = () => execFileSync(process.execPath, [join(directory, 'scripts/generate-localized-pages.js')]);
    generate();
    const first = await readFile(join(directory, 'dist/it/index.html'), 'utf8');
    generate();
    assert.equal(await readFile(join(directory, 'dist/it/index.html'), 'utf8'), first);
    assert.equal((first.match(/hreflang=/g) || []).length, 18);
    for (const [locale, route] of [['it', 'come-rimuovere-logo-gemini'], ['es', 'como-quitar-marca-de-agua-gemini'], ['pt', 'remover-marca-dagua-gemini']]) {
      const html = await readFile(join(directory, `dist/${locale}/index.html`), 'utf8');
      assert.ok(html.includes(`href="/${locale}/${route}/"`), locale);
      assert.doesNotMatch(html, /处理进度/);
    }
    for (const [slug, locale, lang] of [['zh-cn', 'zh-CN', 'zh-CN'], ['es', 'es-ES', 'es'], ['he', 'he-IL', 'he']]) {
      const html = await readFile(join(directory, `dist/${slug}/index.html`), 'utf8');
      const schemas = [...html.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)]
        .map(([, json]) => JSON.parse(json));
      const app = schemas.find((schema) => schema['@type'] === 'SoftwareApplication');
      assert.equal(app.url, `${SITE_ORIGIN}/${slug}/`);
      assert.equal(app.inLanguage, lang);
      assert.equal(app.description, TRANSLATIONS[locale]['meta.description']);
      assert.ok(html.includes(`<link rel="canonical" href="${SITE_ORIGIN}/${slug}/">`));
      assert.ok(html.includes(TRANSLATIONS[locale]['main.subtitle']));
    }
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('initial batch progress uses the same translation key as runtime updates', async () => {
  const html = await readFile('public/index.html', 'utf8');
  const app = await readFile('src/app.js', 'utf8');
  assert.match(html, /id="progressText"><span data-i18n="progress.text">Progress<\/span>: 0\/0/);
  assert.match(app, /i18n\.t\('progress.text'\)/);
  for (const [locale, dictionary] of Object.entries(TRANSLATIONS)) {
    assert.ok(dictionary['progress.text'], locale);
  }
});

function createEnv(html = '<!doctype html><html><head><link rel="canonical" href="/"></head><body></body></html>') {
  return {
    SITE_ORIGIN,
    ASSETS: {
      fetch: async () => new Response(html, {
        headers: { 'content-type': 'text/html; charset=utf-8' }
      })
    }
  };
}

test('production routes force HTTPS and expose HSTS', async () => {
  const redirect = await siteWorker.fetch(
    new Request('http://watermarkzero.org/nano-banana-watermark-remover/'),
    createEnv()
  );

  assert.equal(redirect.status, 301);
  assert.equal(
    redirect.headers.get('location'),
    'https://watermarkzero.org/nano-banana-watermark-remover/'
  );

  const response = await siteWorker.fetch(
    new Request('https://watermarkzero.org/nano-banana-watermark-remover/'),
    createEnv()
  );

  assert.match(
    response.headers.get('strict-transport-security') || '',
    /max-age=31536000/
  );
});

test('indexable content routes consistently redirect to trailing slashes', async () => {
  for (const path of [
    '/gemini-watermark-remover',
    '/nano-banana-watermark-remover',
    '/batch-gemini-watermark-remover',
    '/ai-metadata-remover',
    '/turn-off-gemini-watermark',
    '/pt/remover-marca-dagua-gemini',
    '/it/come-rimuovere-logo-gemini',
    '/es/como-quitar-marca-de-agua-gemini',
    '/blog/does-gemini-watermark-text',
    '/blog/how-to-remove-gemini-watermark',
    '/blog/remove-gemini-watermark-on-iphone-android',
    '/blog/check-ai-image-metadata'
  ]) {
    const response = await siteWorker.fetch(
      new Request(`${SITE_ORIGIN}${path}`),
      createEnv()
    );

    assert.equal(response.status, 301, path);
    assert.equal(response.headers.get('location'), `${SITE_ORIGIN}${path}/`, path);
  }
});

test('preview hosts keep their host while normalizing paths', async () => {
  const response = await siteWorker.fetch(
    new Request('https://preview.example.workers.dev/nano-banana-watermark-remover'),
    createEnv()
  );

  assert.equal(response.status, 301);
  assert.equal(
    response.headers.get('location'),
    'https://preview.example.workers.dev/nano-banana-watermark-remover/'
  );
});

test('known index.html aliases and origin variants converge in one redirect', async () => {
  for (const [input, expected] of [
    ['http://www.watermarkzero.org/zh-cn/index.html?utm_source=test', `${SITE_ORIGIN}/zh-cn/?utm_source=test`],
    [`${SITE_ORIGIN}/index.html`, `${SITE_ORIGIN}/`],
    [`${SITE_ORIGIN}/privacy/index.html`, `${SITE_ORIGIN}/privacy/`],
    [`${SITE_ORIGIN}/blog/how-to-remove-gemini-watermark/index.html`, `${SITE_ORIGIN}/blog/how-to-remove-gemini-watermark/`],
    ['http://www.watermarkzero.org/terms.html', `${SITE_ORIGIN}/terms/`],
    ['https://preview.example.workers.dev/it/index.html', 'https://preview.example.workers.dev/it/']
  ]) {
    const response = await siteWorker.fetch(new Request(input), createEnv());
    assert.equal(response.status, 301, input);
    assert.equal(response.headers.get('location'), expected, input);
  }
});

test('HTML errors remain errors without an indexable canonical', async () => {
  const env = createEnv();
  env.ASSETS.fetch = async () => new Response('<html><head></head><body>Not found</body></html>', {
    status: 404, headers: { 'content-type': 'text/html' }
  });
  const response = await siteWorker.fetch(new Request(`${SITE_ORIGIN}/missing/`), env);
  assert.equal(response.status, 404);
  assert.match(response.headers.get('x-robots-tag') || '', /noindex/);
  assert.doesNotMatch(await response.text(), /rel="canonical"/);
});

test('new landing pages stay in the canonical sitemap', async () => {
  const response = await siteWorker.fetch(
    new Request(`${SITE_ORIGIN}/sitemap.xml`),
    createEnv()
  );
  const sitemap = await response.text();

  assert.match(sitemap, /https:\/\/watermarkzero\.org\/nano-banana-watermark-remover\//);
  assert.match(sitemap, /https:\/\/watermarkzero\.org\/batch-gemini-watermark-remover\//);
  assert.match(sitemap, /https:\/\/watermarkzero\.org\/ai-metadata-remover\//);
  assert.match(sitemap, /https:\/\/watermarkzero\.org\/turn-off-gemini-watermark\//);
  assert.match(sitemap, /https:\/\/watermarkzero\.org\/pt\/remover-marca-dagua-gemini\//);
  assert.ok(sitemap.includes(`${SITE_ORIGIN}/it/come-rimuovere-logo-gemini/`));
  assert.ok(sitemap.includes(`${SITE_ORIGIN}/es/como-quitar-marca-de-agua-gemini/`));
  assert.match(sitemap, /https:\/\/watermarkzero\.org\/blog\/does-gemini-watermark-text\//);
  for (const slug of ['remove-gemini-watermark-on-iphone-android', 'check-ai-image-metadata']) {
    assert.ok(sitemap.includes(`${SITE_ORIGIN}/blog/${slug}/`));
  }
});

test('keyword pages have unique metadata and answer their stated task', async () => {
  const pages = [
    {
      file: 'public/blog/remove-gemini-watermark-on-iphone-android/index.html',
      canonical: `${SITE_ORIGIN}/blog/remove-gemini-watermark-on-iphone-android/`,
      h1: /remove gemini watermark on iphone &amp; android/i,
      required: [/20 MB/, /Safari/, /Chrome/, /SynthID/]
    },
    {
      file: 'public/blog/check-ai-image-metadata/index.html',
      canonical: `${SITE_ORIGIN}/blog/check-ai-image-metadata/`,
      h1: /check ai image metadata/i,
      required: [/EXIF/, /C2PA/, /SynthID/, /href="\/ai-metadata-remover\/"/]
    },
    {
      file: 'public/it/come-rimuovere-logo-gemini/index.html',
      canonical: `${SITE_ORIGIN}/it/come-rimuovere-logo-gemini/`,
      h1: /come rimuovere il logo gemini/i,
      required: [/\/it\/#uploadArea/, /gemini-remover-it\.png/]
    },
    {
      file: 'public/es/como-quitar-marca-de-agua-gemini/index.html',
      canonical: `${SITE_ORIGIN}/es/como-quitar-marca-de-agua-gemini/`,
      h1: /c[oó]mo quitar la marca de agua de gemini/i,
      required: [/\/es\/#uploadArea/, /gemini-remover-es\.png/]
    },
    {
      file: 'public/turn-off-gemini-watermark/index.html',
      canonical: `${SITE_ORIGIN}/turn-off-gemini-watermark/`,
      h1: /how to turn off the gemini watermark/i,
      required: [/Media watermark/i, /does not affect SynthID/i]
    },
    {
      file: 'public/pt/remover-marca-dagua-gemini/index.html',
      canonical: `${SITE_ORIGIN}/pt/remover-marca-dagua-gemini/`,
      h1: /remover marca d['’]água do gemini/i,
      required: [/processamento local/i, /\/pt\/#uploadArea/i]
    },
    {
      file: 'public/blog/does-gemini-watermark-text/index.html',
      canonical: `${SITE_ORIGIN}/blog/does-gemini-watermark-text/`,
      h1: /does gemini watermark text/i,
      required: [/SynthID Text/i, /token/i]
    }
  ];
  const titles = new Set();
  const descriptions = new Set();

  for (const page of pages) {
    const html = await readFile(page.file, 'utf8');
    const title = html.match(/<title>([^<]+)<\/title>/i)?.[1] || '';
    const description = html.match(/<meta name="description" content="([^"]+)">/i)?.[1] || '';
    const canonical = html.match(/<link rel="canonical" href="([^"]+)">/i)?.[1] || '';

    assert.ok(title.length >= 30 && title.length <= 60, `${page.file} title ${title.length}/60`);
    assert.ok(description.length >= 120 && description.length <= 160, `${page.file} description ${description.length}/160`);
    assert.equal(canonical, page.canonical, page.file);
    assert.equal((html.match(/<h1\b/gi) || []).length, 1, page.file);
    assert.match(html, new RegExp(`<h1[^>]*>[^<]*${page.h1.source}[^<]*<\\/h1>`, 'i'), page.file);
    assert.match(html, /<html lang="(?:en|pt-BR|it|es)">/i, page.file);
    assert.match(html, /href="\/(?:(?:pt|it|es)\/)?"/, page.file);
    for (const pattern of page.required) assert.match(html, pattern, page.file);
    if (/public\/(?:it|es)\//.test(page.file)) {
      assert.doesNotMatch(html, /hreflang=/i, 'Tutorials must not be grouped with tool homepages');
      assert.match(html, /"@type":\s*"Article"/);
      assert.match(html, /"@type":\s*"BreadcrumbList"/);
      for (const [, path] of html.matchAll(/<img[^>]+src="(\/[^\"]+)"/g)) {
        assert.ok((await readFile(`public${path}`)).length > 0, `${page.file}: ${path}`);
      }
    }

    for (const [, json] of html.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)) {
      assert.doesNotThrow(() => JSON.parse(json), page.file);
    }

    titles.add(title);
    descriptions.add(description);
  }

  assert.equal(titles.size, pages.length);
  assert.equal(descriptions.size, pages.length);
});

test('new keyword pages are linked from site hubs and llms.txt', async () => {
  const home = await readFile('public/index.html', 'utf8');
  const blog = await readFile('public/blog/index.html', 'utf8');
  const llms = await readFile('public/llms.txt', 'utf8');
  const paths = [
    '/it/come-rimuovere-logo-gemini/',
    '/es/como-quitar-marca-de-agua-gemini/',
    '/turn-off-gemini-watermark/',
    '/pt/remover-marca-dagua-gemini/',
    '/blog/does-gemini-watermark-text/'
  ];

  for (const path of paths) {
    assert.ok(home.includes(`href="${path}"`) || blog.includes(`href="${path}"`), path);
    assert.ok(llms.includes(`https://watermarkzero.org${path}`), path);
  }
});

test('public copy does not expose internal SEO production language', async () => {
  const blogFiles = (await readdir('public/blog', { recursive: true }))
    .filter((file) => file.endsWith('.html'));

  for (const file of blogFiles) {
    const blog = await readFile(`public/blog/${file}`, 'utf8');
    assert.doesNotMatch(
      blog,
      /keyword-focused|search-focused|search intent|search pages|give Google|long-tail[^<]*quer(?:y|ies)|this page targets people searching|product landing page|PDF intent|The MVP/i,
      file
    );
  }
});

test('landing-page structured data omits unsupported rich-result boilerplate', async () => {
  const nano = await readFile('public/nano-banana-watermark-remover/index.html', 'utf8');
  const batch = await readFile('public/batch-gemini-watermark-remover/index.html', 'utf8');

  assert.doesNotMatch(nano, /"@type": "FAQPage"/);
  assert.doesNotMatch(batch, /"@type": "(?:FAQPage|HowTo)"/);
});

test('core content pages use distinct titles instead of repeating the main keyword', async () => {
  const expectedTitles = new Map([
    ['public/index.html', 'Free Gemini Watermark Remover Online | Remove Locally'],
    ['public/gemini-watermark-remover/index.html', 'WatermarkZero Features | Supported Gemini Images'],
    ['public/remove-gemini-watermark/index.html', 'How to Remove a Visible Gemini Watermark Safely'],
    ['public/remove-gemini-watermark-from-image/index.html', 'Gemini Image File Support | JPG, PNG & WebP'],
    ['public/ai-metadata-remover/index.html', 'AI Metadata Remover | Clean PNG & JPEG Locally'],
    ['public/blog/remove-gemini-watermark-online/index.html', 'Private Browser Processing for Gemini Images | WatermarkZero']
  ]);

  for (const [file, expectedTitle] of expectedTitles) {
    const html = await readFile(file, 'utf8');
    const title = html.match(/<title>([^<]+)<\/title>/i)?.[1].replaceAll('&amp;', '&');
    assert.equal(title, expectedTitle, file);
  }
});

test('homepage search snippet stays within common preview limits', async () => {
  const home = await readFile('public/index.html', 'utf8');
  const title = home.match(/<title>([^<]+)<\/title>/i)?.[1] || '';
  const description = home.match(/<meta name="description" content="([^"]+)">/i)?.[1] || '';
  const dictionary = TRANSLATIONS['en-US'];

  assert.equal(
    description,
    'Remove the visible Gemini watermark online for free. Images stay in your browser for local processing, with no uploads or signup and batch support.'
  );
  assert.equal(dictionary.title, title);
  assert.equal(dictionary['meta.description'], description);
  assert.equal(dictionary['meta.og.title'], title);
  assert.equal(dictionary['meta.og.description'], description);
  assert.ok(title.length <= 60, `${title.length}/60`);
  assert.ok(description.length <= 160, `${description.length}/160`);
});

test('homepage links directly to the Nano Banana, batch, and metadata tools', async () => {
  const home = await readFile('public/index.html', 'utf8');
  const header = home.match(/<header[\s\S]*?<\/header>/i)?.[0] || '';

  assert.match(home, /href="\/nano-banana-watermark-remover\/"/);
  assert.match(home, /href="\/batch-gemini-watermark-remover\/"/);
  assert.match(header, /href="\/ai-metadata-remover\/"/);
});

test('AI metadata remover exposes the local batch tool with an honest scope', async () => {
  const page = await readFile('public/ai-metadata-remover/index.html', 'utf8');
  const app = await readFile('src/metadataApp.js', 'utf8');
  const description = page.match(/<meta name="description" content="([^"]+)">/i)?.[1] || '';

  assert.ok(description.length <= 160, `${description.length}/160`);
  assert.match(page, /id="metadataFileInput"[^>]*multiple/);
  assert.match(page, /src="\/metadata-app\.js"/);
  assert.match(page, /href="\/metadata-page\.css"/);
  assert.match(page, /<h1>AI metadata remover<\/h1>/);
  assert.match(page, /Claude, ChatGPT, and Gemini/i);
  assert.match(page, /format-based, not model detection/i);
  assert.match(page, /does not detect or remove SynthID/i);
  assert.match(page, /No uploads/i);
  assert.doesNotMatch(page, /SynthID remover|bypass.*detect/i);
  assert.doesNotMatch(page, /<script[^>]+src="https?:\/\//i);
  assert.doesNotMatch(app, /\bfetch\s*\(/);
  for (const [locale, dictionary] of Object.entries(TRANSLATIONS)) {
    assert.doesNotMatch(dictionary['learn.article3.desc'], /WebP/i, `${locale}: metadata tool accepts only PNG/JPEG`);
  }
});

test('AI metadata remover blocks third-party scripts, connections, and analytics injection', async () => {
  const env = createEnv();
  env.GA4_MEASUREMENT_ID = 'G-TEST123';
  const response = await siteWorker.fetch(
    new Request(`${SITE_ORIGIN}/ai-metadata-remover/`),
    env
  );
  const html = await response.text();
  const csp = response.headers.get('content-security-policy') || '';

  assert.doesNotMatch(html, /googletagmanager|gtag\(/i);
  assert.match(response.headers.get('cache-control') || '', /no-transform/);
  assert.match(csp, /script-src 'self'/);
  assert.match(csp, /connect-src 'self'/);
  assert.doesNotMatch(csp, /https:|google|cloudflare|profitable|highperformance/i);
});

test('landing-page JSON-LD remains valid after schema cleanup', async () => {
  for (const file of [
    'public/nano-banana-watermark-remover/index.html',
    'public/batch-gemini-watermark-remover/index.html'
  ]) {
    const html = await readFile(file, 'utf8');
    const blocks = [...html.matchAll(
      /<script type="application\/ld\+json">([\s\S]*?)<\/script>/g
    )];

    assert.ok(blocks.length > 0, file);
    for (const [, json] of blocks) {
      assert.doesNotThrow(() => JSON.parse(json), file);
    }
  }
});

test('llms.txt follows the proposed format and links core site resources', async () => {
  const llms = await readFile('public/llms.txt', 'utf8');

  assert.match(llms, /^# WatermarkZero\n\n> \S/);
  assert.match(llms, /\n## Primary pages\n/);
  assert.match(llms, /\n## Technical and trust resources\n/);
  assert.match(llms, /\n## Optional\n/);

  for (const url of [
    'https://watermarkzero.org/',
    'https://watermarkzero.org/nano-banana-watermark-remover/',
    'https://watermarkzero.org/batch-gemini-watermark-remover/',
    'https://watermarkzero.org/ai-metadata-remover/',
    'https://watermarkzero.org/blog/visible-gemini-watermark-vs-synthid/',
    'https://github.com/liuyan-wjy/watermarkzero'
  ]) {
    assert.ok(llms.includes(`](${url})`), url);
  }

  assert.match(llms, /visible .*watermark/i);
  assert.match(llms, /does not remove SynthID/i);
  assert.match(llms, /processed locally/i);
});
