// One-off generator for the PWA / Apple home-screen icons.
// Rasterises the existing brand logo (public/favicon.svg) onto a solid
// background at the sizes required by Android (manifest) and iOS (apple-touch).
// Run with: node scripts/generate-pwa-icons.mjs
import sharp from 'sharp';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

// Resolve paths relative to this script so it works from any CWD.
const here = dirname(fileURLToPath(import.meta.url));
const publicDir = resolve(here, '..', 'public');

// Brand colours (taken from the logo's purple fill).
const BACKGROUND = '#863bff';
const logoSvg = readFileSync(resolve(publicDir, 'favicon.svg'));

// Render the logo scaled to `logoRatio` of the canvas, centred on a solid
// background. `padding` larger than the safe area keeps maskable icons intact.
async function buildIcon(size, logoRatio, outFile) {
  // Logo dimensions after scaling, preserving the source aspect ratio (48x46).
  const logoWidth = Math.round(size * logoRatio);
  const logoHeight = Math.round(logoWidth * (46 / 48));

  // Rasterise the logo on its own first, then composite onto the background.
  const logo = await sharp(logoSvg)
    .resize(logoWidth, logoHeight, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .png()
    .toBuffer();

  await sharp({ create: { width: size, height: size, channels: 4, background: BACKGROUND } })
    .composite([{ input: logo, gravity: 'centre' }])
    .png()
    .toFile(resolve(publicDir, outFile));

  console.log(`wrote ${outFile} (${size}x${size})`);
}

// Standard maskable/any icons use ~70% logo; maskable needs extra safe-area padding.
await buildIcon(192, 0.62, 'pwa-192x192.png');
await buildIcon(512, 0.62, 'pwa-512x512.png');
await buildIcon(512, 0.5, 'pwa-maskable-512x512.png');
// iOS home-screen icon: 180x180, opaque (iOS ignores transparency / rounds corners itself).
await buildIcon(180, 0.62, 'apple-touch-icon.png');
