import { mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import type { Page, TestInfo } from '@playwright/test';

/**
 * Full-page screenshots for the visual review (UI test plan, phase D).
 *
 * Files go to SHOTS_DIR, which is outside the repository: by default
 * /private/tmp/sc-ui-shots/<RUN_ID>, where RUN_ID defaults to the date and
 * time of the run. When the browser runs in Docker, mount that folder at the
 * same path so the files land on the host:
 *   -v /private/tmp/sc-ui-shots:/private/tmp/sc-ui-shots
 *
 * Each capture writes <viewport>__<role>__<screen>__<state>.png and one small
 * JSON entry; index.json is rebuilt from all entries after every capture, so
 * parallel workers never lose a line.
 */

const RUN_ID = process.env.RUN_ID ?? new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
export const SHOTS_DIR = process.env.SHOTS_DIR ?? `/private/tmp/sc-ui-shots/${RUN_ID}`;

export interface ShotEntry {
  file: string;
  path: string;
  screen: string;
  role: string;
  viewport: string;
  state: string;
  url: string;
  captured: boolean;
  error?: string;
  at: string;
}

function slug(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}

/** Take a full-page screenshot and record it in index.json. */
export async function shot(
  page: Page,
  testInfo: TestInfo,
  role: string,
  screen: string,
  state: string,
): Promise<void> {
  const viewport = testInfo.project.name;
  const file = `${viewport}__${slug(role)}__${slug(screen)}__${slug(state)}.png`;
  const path = join(SHOTS_DIR, file);
  const entriesDir = join(SHOTS_DIR, 'entries');
  mkdirSync(entriesDir, { recursive: true });

  const entry: ShotEntry = {
    file,
    path,
    screen,
    role,
    viewport,
    state,
    url: page.url(),
    captured: false,
    at: new Date().toISOString(),
  };
  try {
    await page.screenshot({ path, fullPage: true, animations: 'disabled' });
    entry.captured = true;
  } catch (error) {
    entry.error = error instanceof Error ? error.message : String(error);
  }
  writeFileSync(join(entriesDir, `${file}.json`), JSON.stringify(entry, null, 2));
  rebuildIndex(entriesDir);
  if (!entry.captured) {
    throw new Error(`Screenshot ${file} failed: ${entry.error}`);
  }
}

function rebuildIndex(entriesDir: string): void {
  const entries = readdirSync(entriesDir)
    .filter((name) => name.endsWith('.json'))
    .map((name) => JSON.parse(readFileSync(join(entriesDir, name), 'utf8')) as ShotEntry)
    .sort((a, b) => a.file.localeCompare(b.file));
  writeFileSync(join(SHOTS_DIR, 'index.json'), JSON.stringify(entries, null, 2));
}
