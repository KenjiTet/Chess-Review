/**
 * Post-build prerender of the "/" route.
 *
 * The app is a client-rendered SPA, so the built dist/index.html ships an empty
 * <div id="root"></div> — search engines and social scrapers see no content.
 * This script boots the built app in headless Chromium, waits for the marketing
 * Landing page to render, and writes the fully-rendered HTML back over
 * dist/index.html. Real browsers still download the JS bundle and re-render on
 * load (createRoot replaces the prerendered DOM), so the app stays fully
 * interactive — crawlers just get real content up front.
 *
 * Runs as the npm "postbuild" hook, so `npm run build` produces prerendered
 * output with no extra command. If Chromium cannot launch (e.g. a CI box with
 * no browser), the script logs a warning and leaves the SPA index.html intact
 * rather than failing the build.
 */

import { createServer } from 'node:http';
import { readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join, extname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

// Resolve dist/ relative to this script (frontend/scripts/ -> frontend/dist/).
const scriptDir = fileURLToPath(new URL('.', import.meta.url));
const distDir = resolve(scriptDir, '..', 'dist');
const indexPath = join(distDir, 'index.html');

// Minimal content-type map for the static files the built app requests.
const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.webmanifest': 'application/manifest+json',
};

// Serve dist/ statically, falling back to index.html for SPA-style routes.
function startStaticServer() {
  const server = createServer(async (req, res) => {
    const urlPath = decodeURIComponent((req.url ?? '/').split('?')[0]);
    let filePath = join(distDir, urlPath);

    if (!existsSync(filePath) || urlPath.endsWith('/')) {
      filePath = indexPath;
    }

    try {
      const data = await readFile(filePath);
      const mime = MIME_TYPES[extname(filePath)] ?? 'application/octet-stream';
      res.writeHead(200, { 'Content-Type': mime });
      res.end(data);
    } catch {
      res.writeHead(404);
      res.end('Not found');
    }
  });

  return new Promise((resolvePromise) => {
    // Port 0 lets the OS pick a free port, avoiding local-dev collisions.
    server.listen(0, '127.0.0.1', () => {
      resolvePromise(server);
    });
  });
}

async function prerender() {
  if (!existsSync(indexPath)) {
    console.warn('[prerender] dist/index.html not found — skipping prerender.');
    return;
  }

  // Import puppeteer lazily so a missing/broken install degrades to a warning
  // rather than crashing the whole build.
  let puppeteer;

  try {
    const mod = await import('puppeteer');
    puppeteer = mod.default;
  } catch (err) {
    console.warn(`[prerender] puppeteer unavailable — skipping prerender. ${err}`);
    return;
  }

  const server = await startStaticServer();
  const { port } = server.address();
  const url = `http://127.0.0.1:${port}/`;

  let browser;

  try {
    browser = await puppeteer.launch({
      headless: true,
      // Flags required to run Chromium as root inside the Docker build stage.
      args: ['--no-sandbox', '--disable-setuid-sandbox'],
    });

    const page = await browser.newPage();
    await page.goto(url, { waitUntil: 'networkidle0', timeout: 30000 });

    // Wait for the landing heading so we never snapshot an empty shell.
    await page.waitForSelector('h1.landing__title', { timeout: 15000 });

    const html = await page.content();
    await writeFile(indexPath, html, 'utf-8');
    console.log('[prerender] Wrote prerendered landing HTML to dist/index.html');
  } catch (err) {
    console.warn(`[prerender] Prerender failed — keeping SPA index.html. ${err}`);
  } finally {
    if (browser) {
      await browser.close();
    }

    server.close();
  }
}

await prerender();
