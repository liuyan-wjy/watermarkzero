import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import test from 'node:test';

import siteWorker from '../../worker.mjs';

const SITE_ORIGIN = 'https://watermarkzero.org';

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
    '/blog/how-to-remove-gemini-watermark'
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

test('new landing pages stay in the canonical sitemap', async () => {
  const response = await siteWorker.fetch(
    new Request(`${SITE_ORIGIN}/sitemap.xml`),
    createEnv()
  );
  const sitemap = await response.text();

  assert.match(sitemap, /https:\/\/watermarkzero\.org\/nano-banana-watermark-remover\//);
  assert.match(sitemap, /https:\/\/watermarkzero\.org\/batch-gemini-watermark-remover\//);
});

test('public copy does not expose internal SEO production language', async () => {
  const blogFiles = (await readdir('public/blog', { recursive: true }))
    .filter((file) => file.endsWith('.html'));

  for (const file of blogFiles) {
    const blog = await readFile(`public/blog/${file}`, 'utf8');
    assert.doesNotMatch(
      blog,
      /keyword-focused|search-focused|search intent|search pages|give Google|long-tail[^<]*quer(?:y|ies)/i,
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
    ['public/index.html', 'Gemini Watermark Remover Online | Remove Gemini Watermark Locally'],
    ['public/gemini-watermark-remover/index.html', 'WatermarkZero Features | Supported Gemini Images'],
    ['public/remove-gemini-watermark/index.html', 'How to Remove a Visible Gemini Watermark Safely'],
    ['public/remove-gemini-watermark-from-image/index.html', 'Gemini Image File Support | JPG, PNG & WebP'],
    ['public/blog/remove-gemini-watermark-online/index.html', 'Private Browser Processing for Gemini Images | WatermarkZero']
  ]);

  for (const [file, expectedTitle] of expectedTitles) {
    const html = await readFile(file, 'utf8');
    const title = html.match(/<title>([^<]+)<\/title>/i)?.[1].replaceAll('&amp;', '&');
    assert.equal(title, expectedTitle, file);
  }
});

test('homepage links directly to the Nano Banana and batch workflows', async () => {
  const home = await readFile('public/index.html', 'utf8');

  assert.match(home, /href="\/nano-banana-watermark-remover\/"/);
  assert.match(home, /href="\/batch-gemini-watermark-remover\/"/);
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
