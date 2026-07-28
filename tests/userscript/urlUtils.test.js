import test from 'node:test';
import assert from 'node:assert/strict';

import {
    classifyGeminiAssetUrl,
    isGeminiDisplayPreviewAssetUrl,
    isGeminiPreviewAssetUrl,
    isGeminiOriginalAssetUrl,
    isGeminiGeneratedAssetUrl,
    normalizeGoogleusercontentImageUrl
} from '../../src/userscript/urlUtils.js';

test('normalizeGoogleusercontentImageUrl should force =s0 on Gemini rd-gg URL', () => {
    const input = 'https://lh3.googleusercontent.com/rd-gg/abc123=s2048';
    const out = normalizeGoogleusercontentImageUrl(input);
    assert.equal(out, 'https://lh3.googleusercontent.com/rd-gg/abc123=s0');
});

test('normalizeGoogleusercontentImageUrl should preserve query and hash', () => {
    const input = 'https://lh3.googleusercontent.com/rd-gg/abc123=s1024?foo=1#frag';
    const out = normalizeGoogleusercontentImageUrl(input);
    assert.equal(out, 'https://lh3.googleusercontent.com/rd-gg/abc123=s0?foo=1#frag');
});

test('normalizeGoogleusercontentImageUrl should keep -d flag when present', () => {
    const input = 'https://lh3.googleusercontent.com/rd-gg-dl/abc123=s2048-d';
    const out = normalizeGoogleusercontentImageUrl(input);
    assert.equal(out, 'https://lh3.googleusercontent.com/rd-gg-dl/abc123=s0-d');
});

test('normalizeGoogleusercontentImageUrl should preserve preview render suffix on Gemini rd-gg URL', () => {
    const input = 'https://lh3.googleusercontent.com/rd-gg/abc123=s1024-rj';
    const out = normalizeGoogleusercontentImageUrl(input);
    assert.equal(out, 'https://lh3.googleusercontent.com/rd-gg/abc123=s0-rj');
});

test('normalizeGoogleusercontentImageUrl should normalize Gemini gg render urls to original-size fetch urls', () => {
    const input = 'https://lh3.googleusercontent.com/gg/example-token=s1024-rj';
    const out = normalizeGoogleusercontentImageUrl(input);
    assert.equal(out, 'https://lh3.googleusercontent.com/gg/example-token=s0-rj');
});

test('normalizeGoogleusercontentImageUrl should normalize Gemini gg-dl urls to original-size fetch urls', () => {
    const input = 'https://lh3.googleusercontent.com/gg-dl/example-token=s1024-rj';
    const out = normalizeGoogleusercontentImageUrl(input);
    assert.equal(out, 'https://lh3.googleusercontent.com/gg-dl/example-token=s0-rj');
});

test('normalizeGoogleusercontentImageUrl should normalize Gemini tiered gg download urls to original-size fetch urls', () => {
    const input = 'https://lh3.googleusercontent.com/gg-premium-dl/example-token=s1024-rj';
    const out = normalizeGoogleusercontentImageUrl(input);
    assert.equal(out, 'https://lh3.googleusercontent.com/gg-premium-dl/example-token=s0-rj');
});

test('normalizeGoogleusercontentImageUrl should normalize Gemini native download token urls with d-I suffix', () => {
    const input = 'https://lh3.googleusercontent.com/gg/example-token=d-I?alr=yes';
    const out = normalizeGoogleusercontentImageUrl(input);
    assert.equal(out, 'https://lh3.googleusercontent.com/gg/example-token=s0-d-I?alr=yes');
});

test('normalizeGoogleusercontentImageUrl should normalize Gemini native download token urls with d suffix', () => {
    const input = 'https://lh3.googleusercontent.com/gg/example-token=d';
    const out = normalizeGoogleusercontentImageUrl(input);
    assert.equal(out, 'https://lh3.googleusercontent.com/gg/example-token=s0-d');
});

test('normalizeGoogleusercontentImageUrl should replace width-height transform at tail', () => {
    const input = 'https://lh3.googleusercontent.com/rd-gg/abc123=w2048-h2048';
    const out = normalizeGoogleusercontentImageUrl(input);
    assert.equal(out, 'https://lh3.googleusercontent.com/rd-gg/abc123=s0');
});

test('normalizeGoogleusercontentImageUrl should append transform when missing', () => {
    const input = 'https://lh3.googleusercontent.com/rd-gg/abc123';
    const out = normalizeGoogleusercontentImageUrl(input);
    assert.equal(out, 'https://lh3.googleusercontent.com/rd-gg/abc123=s0');
});

test('normalizeGoogleusercontentImageUrl should not truncate token when path already contains "="', () => {
    const input = 'https://lh3.googleusercontent.com/rd-gg/abc=def';
    const out = normalizeGoogleusercontentImageUrl(input);
    assert.equal(out, 'https://lh3.googleusercontent.com/rd-gg/abc=def=s0');
});

test('normalizeGoogleusercontentImageUrl should keep non-googleusercontent url unchanged', () => {
    const input = 'https://example.com/a.png?s=1024';
    const out = normalizeGoogleusercontentImageUrl(input);
    assert.equal(out, input);
});

test('isGeminiGeneratedAssetUrl should only match Gemini asset url', () => {
    assert.equal(isGeminiGeneratedAssetUrl('https://lh3.googleusercontent.com/rd-gg/abc=s1024'), true);
    assert.equal(isGeminiGeneratedAssetUrl('https://lh3.googleusercontent.com/rd-gg-dl/abc=s1024-d'), true);
    assert.equal(isGeminiGeneratedAssetUrl('https://lh3.googleusercontent.com/rd-new-path/abc=s1024-d'), true);
    assert.equal(isGeminiGeneratedAssetUrl('https://lh3.googleusercontent.com/gg/abc=s1024-rj'), true);
    assert.equal(isGeminiGeneratedAssetUrl('https://lh3.googleusercontent.com/gg-ultra/abc=s1024-rj'), true);
    assert.equal(isGeminiGeneratedAssetUrl('https://lh3.googleusercontent.com/gg-dl/abc=s1024-rj'), true);
    assert.equal(isGeminiGeneratedAssetUrl('https://lh3.googleusercontent.com/gg-premium-dl/abc=s1024-rj'), true);
    assert.equal(isGeminiGeneratedAssetUrl('https://lh3.googleusercontent.com/abc=s1024'), false);
    assert.equal(isGeminiGeneratedAssetUrl('https://example.com/rd-gg/abc=s1024'), false);
});

test('isGeminiPreviewAssetUrl should match gg family preview urls across user tiers', () => {
    assert.equal(isGeminiPreviewAssetUrl('https://lh3.googleusercontent.com/gg/abc=s1024-rj'), true);
    assert.equal(isGeminiPreviewAssetUrl('https://lh3.googleusercontent.com/gg-premium/abc=s1024-rj'), true);
    assert.equal(isGeminiPreviewAssetUrl('https://lh3.googleusercontent.com/gg-ultra/abc=s1024-rj'), true);
    assert.equal(isGeminiPreviewAssetUrl('https://lh3.googleusercontent.com/gg-dl/abc=s1024-rj'), false);
    assert.equal(isGeminiPreviewAssetUrl('https://lh3.googleusercontent.com/gg-premium-dl/abc=s1024-rj'), false);
    assert.equal(isGeminiPreviewAssetUrl('https://lh3.googleusercontent.com/rd-gg/abc=s1024'), false);
    assert.equal(isGeminiPreviewAssetUrl('https://example.com/gg/abc=s1024-rj'), false);
});

test('isGeminiDisplayPreviewAssetUrl should include real-page gg-dl render urls used for preview display', () => {
    assert.equal(isGeminiDisplayPreviewAssetUrl('https://lh3.googleusercontent.com/gg/abc=s1024-rj'), true);
    assert.equal(isGeminiDisplayPreviewAssetUrl('https://lh3.googleusercontent.com/gg-premium/abc=s1024-rj'), true);
    assert.equal(isGeminiDisplayPreviewAssetUrl('https://lh3.googleusercontent.com/gg-dl/abc=s1024-rj'), true);
    assert.equal(isGeminiDisplayPreviewAssetUrl('https://lh3.googleusercontent.com/gg-premium-dl/abc=s1024-rj'), true);
    assert.equal(isGeminiDisplayPreviewAssetUrl('https://lh3.googleusercontent.com/gg/abc=d-I?alr=yes'), false);
    assert.equal(isGeminiDisplayPreviewAssetUrl('https://lh3.googleusercontent.com/rd-gg-dl/abc=s1024-rj'), false);
    assert.equal(isGeminiDisplayPreviewAssetUrl('https://example.com/gg-dl/abc=s1024-rj'), false);
});

test('isGeminiOriginalAssetUrl should only match non-preview Gemini asset urls', () => {
    assert.equal(isGeminiOriginalAssetUrl('https://lh3.googleusercontent.com/gg/abc=s1024-rj?alr=yes'), false);
    assert.equal(isGeminiOriginalAssetUrl('https://lh3.googleusercontent.com/gg-premium/abc=s1024-rj'), false);
    assert.equal(isGeminiOriginalAssetUrl('https://lh3.googleusercontent.com/rd-gg/abc=s1024'), true);
    assert.equal(isGeminiOriginalAssetUrl('https://lh3.googleusercontent.com/gg-dl/abc=s1024-rj'), true);
    assert.equal(isGeminiOriginalAssetUrl('https://lh3.googleusercontent.com/gg/example-token=d-I?alr=yes'), true);
    assert.equal(isGeminiOriginalAssetUrl('https://example.com/rd-gg/abc=s1024'), false);
});

test('classifyGeminiAssetUrl should distinguish rd, preview, and download path families', () => {
    assert.deepEqual(
        classifyGeminiAssetUrl('https://lh3.googleusercontent.com/rd-new-path/abc=s1024-d'),
        {
            family: 'rd',
            variant: 'new-path',
            isPreview: false,
            isDownload: false
        }
    );
    assert.deepEqual(
        classifyGeminiAssetUrl('https://lh3.googleusercontent.com/gg-ultra/abc=s1024-rj'),
        {
            family: 'gg',
            variant: 'ultra',
            isPreview: true,
            isDownload: false
        }
    );
    assert.deepEqual(
        classifyGeminiAssetUrl('https://lh3.googleusercontent.com/gg-premium-dl/abc=s1024-rj'),
        {
            family: 'gg',
            variant: 'premium',
            isPreview: false,
            isDownload: true
        }
    );
    assert.equal(classifyGeminiAssetUrl('https://example.com/gg-ultra/abc=s1024-rj'), null);
});
