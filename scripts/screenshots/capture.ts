#!/usr/bin/env -S npx tsx
/**
 * Playwright capture script for the README hero shots (THI-123).
 *
 * Drives the dummy-data dashboard mock (`mock.html` in this directory)
 * through five `?view=…` states and writes each PNG into
 * `docs/screenshots/`. The mock is intentionally separate from the live
 * app — the README hero shots shouldn't carry the maintainer's actual
 * session names, branches, or PR numbers.
 *
 * Requirements (one-time):
 *   - `cd frontend && npx playwright install chromium`
 *
 * Run from anywhere:
 *   cd frontend && npx tsx ../scripts/screenshots/capture.ts
 *
 * The script boots a tiny static HTTP server for `mock.html`, captures
 * each view at 1440×900 @ 2× DPR, and tears the server down. Re-run any
 * time the mock or the README hero set changes.
 */

import { chromium, type Page } from "playwright";
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { mkdir } from "node:fs/promises";
import { dirname, resolve, extname } from "node:path";
import { fileURLToPath } from "node:url";
import type { AddressInfo } from "node:net";

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT_DIR = resolve(HERE, "../../docs/screenshots");
const VIEWPORT = { width: 1440, height: 900 };

const VIEWS: Array<{ view: string; file: string }> = [
  { view: "kanban",   file: "01-kanban.png" },
  { view: "terminal", file: "02-terminal-modal.png" },
  { view: "palette",  file: "03-command-palette.png" },
  { view: "rename",   file: "04-auto-rename.png" },
  { view: "settings", file: "05-settings.png" },
];

/** Start a one-file static server bound to a free port and resolve its URL. */
async function serveMock(): Promise<{ url: string; close: () => Promise<void> }> {
  const html = await readFile(resolve(HERE, "mock.html"));
  const server = createServer((_req, res) => {
    res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
    res.end(html);
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const { port } = server.address() as AddressInfo;
  return {
    url: `http://127.0.0.1:${port}/`,
    close: () => new Promise<void>((r) => server.close(() => r())),
  };
}

async function shot(page: Page, file: string) {
  const path = resolve(OUT_DIR, file);
  await page.screenshot({ path, fullPage: false, type: "png" });
  console.log(`✓ ${file}`);
}

async function main() {
  await mkdir(OUT_DIR, { recursive: true });
  const mock = await serveMock();

  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: VIEWPORT, deviceScaleFactor: 2 });
  const page = await ctx.newPage();

  for (const { view, file } of VIEWS) {
    await page.goto(`${mock.url}?view=${view}`, { waitUntil: "networkidle" });
    // Let the inline JS finish rendering before we shoot.
    await page.waitForTimeout(200);
    await shot(page, file);
  }

  await ctx.close();
  await browser.close();
  await mock.close();
  console.log(`\nWrote to ${OUT_DIR}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
