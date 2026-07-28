import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import sharp from 'sharp';

const publicDir = resolve('public');
const examplesDir = resolve('public/examples');

const faviconSvg = `
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" fill="none">
  <rect width="64" height="64" rx="18" fill="#F3FBF7"/>
  <path d="M31.5 11.5 27.2 24.4 14.3 28.7l12.9 4.2 4.3 12.9 4.2-12.9 12.9-4.2-12.9-4.3z" stroke="#635BFF" stroke-width="4.5" stroke-linecap="round" stroke-linejoin="round"/>
  <circle cx="48" cy="48" r="5" fill="#10B981"/>
</svg>
`.trim();

const ogOverlaySvg = `
<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="630" viewBox="0 0 1200 630" fill="none">
  <rect width="1200" height="630" rx="40" fill="#F6FBF8"/>
  <rect x="48" y="48" width="1104" height="534" rx="32" fill="#FFFFFF" stroke="#D6F5E8" stroke-width="2"/>
  <rect x="72" y="76" width="240" height="34" rx="17" fill="#EAF9F2"/>
  <text x="98" y="98" font-family="Arial, sans-serif" font-size="15" font-weight="700" letter-spacing="3.5" fill="#0F9B70">LOCAL BROWSER TOOL</text>

  <text x="72" y="190" font-family="Arial, sans-serif" font-size="68" font-weight="700" fill="#15213B">Gemini Watermark</text>
  <text x="72" y="266" font-family="Arial, sans-serif" font-size="68" font-weight="700" fill="#15213B">Remover</text>
  <text x="72" y="332" font-family="Arial, sans-serif" font-size="28" fill="#5F6B85">Remove the visible Gemini watermark locally with</text>
  <text x="72" y="370" font-family="Arial, sans-serif" font-size="28" fill="#5F6B85">reverse alpha restoration and zero image uploads.</text>

  <rect x="72" y="430" width="152" height="44" rx="22" fill="#12203A"/>
  <text x="111" y="458" font-family="Arial, sans-serif" font-size="20" font-weight="700" fill="#FFFFFF">100% local</text>
  <rect x="236" y="430" width="266" height="44" rx="22" fill="#FFFFFF" stroke="#D9E3F0" stroke-width="2"/>
  <text x="266" y="458" font-family="Arial, sans-serif" font-size="20" fill="#344258">Visible Gemini watermark only</text>
  <rect x="72" y="490" width="220" height="44" rx="22" fill="#FFFFFF" stroke="#D9E3F0" stroke-width="2"/>
  <text x="102" y="518" font-family="Arial, sans-serif" font-size="20" fill="#344258">Batch friendly</text>
  <rect x="306" y="490" width="250" height="44" rx="22" fill="#FFFFFF" stroke="#D9E3F0" stroke-width="2"/>
  <text x="336" y="518" font-family="Arial, sans-serif" font-size="20" fill="#344258">Open-source algorithm</text>

  <rect x="686" y="92" width="204" height="42" rx="21" fill="#12203A"/>
  <text x="754" y="118" font-family="Arial, sans-serif" font-size="17" font-weight="700" letter-spacing="2" fill="#FFFFFF">BEFORE</text>
  <rect x="920" y="92" width="204" height="42" rx="21" fill="#10B981"/>
  <text x="995" y="118" font-family="Arial, sans-serif" font-size="17" font-weight="700" letter-spacing="2" fill="#FFFFFF">AFTER</text>

  <rect x="668" y="150" width="220" height="320" rx="28" fill="#FFFFFF" stroke="#E0E7EF" stroke-width="2"/>
  <rect x="902" y="150" width="220" height="320" rx="28" fill="#FFFFFF" stroke="#E0E7EF" stroke-width="2"/>
  <rect x="668" y="492" width="454" height="54" rx="18" fill="#F3FBF7"/>
  <text x="746" y="525" font-family="Arial, sans-serif" font-size="20" fill="#0F9B70">Real Gemini example processed locally</text>
</svg>
`.trim();

async function generate() {
    mkdirSync(publicDir, { recursive: true });

    writeFileSync(resolve(publicDir, 'favicon.svg'), `${faviconSvg}\n`);
    writeFileSync(resolve(publicDir, 'site.webmanifest'), JSON.stringify({
        name: 'Gemini Watermark Remover',
        short_name: 'Gemini Remover',
        icons: [
            { src: '/favicon-32x32.png', sizes: '32x32', type: 'image/png' },
            { src: '/apple-touch-icon.png', sizes: '180x180', type: 'image/png' }
        ],
        theme_color: '#10B981',
        background_color: '#F6FBF8',
        display: 'standalone'
    }, null, 2));

    await sharp(Buffer.from(faviconSvg))
        .resize(32, 32)
        .png()
        .toFile(resolve(publicDir, 'favicon-32x32.png'));

    await sharp(Buffer.from(faviconSvg))
        .resize(180, 180)
        .png()
        .toFile(resolve(publicDir, 'apple-touch-icon.png'));

    const beforeImage = await sharp(resolve(examplesDir, 'product-before.webp'))
        .resize(196, 296, { fit: 'cover', position: 'centre' })
        .toBuffer();
    const afterImage = await sharp(resolve(examplesDir, 'product-after.webp'))
        .resize(196, 296, { fit: 'cover', position: 'centre' })
        .toBuffer();

    await sharp({
        create: {
            width: 1200,
            height: 630,
            channels: 4,
            background: '#F6FBF8'
        }
    })
        .composite([
            { input: Buffer.from(ogOverlaySvg), top: 0, left: 0 },
            { input: beforeImage, top: 162, left: 680 },
            { input: afterImage, top: 162, left: 914 }
        ])
        .png()
        .toFile(resolve(publicDir, 'og-cover.png'));
}

generate().catch((error) => {
    console.error(error);
    process.exit(1);
});
