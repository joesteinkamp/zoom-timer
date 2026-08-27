/**
 * Renders brand/icon.svg to the PNG sizes the Marketplace listing needs.
 *
 * Chromium is already a dependency of the end-to-end run, so it does the
 * rasterising rather than adding an image library for four files a year.
 *
 *   node tools/mkicon.mjs
 */
import { chromium } from 'playwright';
import { readFile, writeFile } from 'node:fs/promises';
import { globSync } from 'node:fs';

const SIZES = [180, 512];
const svg = await readFile(new URL('../brand/icon.svg', import.meta.url), 'utf8');

const local = globSync('/opt/pw-browsers/chromium-*/chrome-linux/chrome');
const browser = await chromium.launch({ executablePath: process.env.PLAYWRIGHT_CHROMIUM_PATH ?? local[0] });

for (const size of SIZES) {
  const page = await browser.newPage({ viewport: { width: size, height: size }, deviceScaleFactor: 1 });
  // The SVG fills the viewport exactly, so the screenshot is the icon.
  await page.setContent(
    `<style>html,body{margin:0;padding:0}svg{display:block;width:${size}px;height:${size}px}</style>${svg}`,
  );
  const png = await page.screenshot({ omitBackground: false });
  const out = new URL(`../brand/icon-${size}.png`, import.meta.url);
  await writeFile(out, png);
  console.log(`brand/icon-${size}.png  ${png.length} bytes`);
  await page.close();
}

await browser.close();
