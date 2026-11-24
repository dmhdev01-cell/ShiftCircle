/**
 * A3: take the roster on screen to a spreadsheet, in the browser. Built from
 * the `SchedulePayload` already loaded; nothing is sent anywhere.
 *
 * - CSV for Excel: UTF-8 with a byte-order mark and CRLF line ends, so Excel
 *   reads the accents and the en dashes; every field is quoted when it needs to be.
 * - TSV for the clipboard: pastes cell by cell into an open spreadsheet.
 *
 * Both are formula-injection safe: a cell that starts with = + - @ (or a tab
 * or carriage return) gets a leading apostrophe, so a spreadsheet shows it as
 * text and never runs it (OWASP "CSV injection").
 */

import { qualificationLabel } from '../api/qualifications';
import type { Block, CellItem, OfficerRow, SchedulePayload } from '../api/types';
import { rotationKind, rotationLabel } from './filterRoster';
import { dayTotals, officerTotals } from './rosterView';

const BLOCK_WORDS: Record<Block, string> = { DAY: 'Days', EVENING: 'Evenings', NIGHT: 'Nights' };
const STATUS_WORDS: Record<OfficerRow['overtimeStatus'], string> = {
  IN_OVERTIME: 'In overtime',
  APPROACHING: 'Approaching',
  UNDER: 'Under',
};
const ABSENCE_WORDS = { SICK: 'Sick', VACATION: 'Vacation', OTHER: 'Absent' } as const;

/** "Mon 16 Nov": a day column's heading. */
export function dayHeading(date: string): string {
  const parsed = new Date(`${date}T00:00:00Z`);
  const fmt = (options: Intl.DateTimeFormatOptions) =>
    new Intl.DateTimeFormat('en-CA', { ...options, timeZone: 'UTC' }).format(parsed);
  return `${fmt({ weekday: 'short' })} ${fmt({ day: 'numeric' })} ${fmt({ month: 'short' })}`;
}

/** One day's items as words: "D8", "D8 extra", "Sick", "P12 offer", "" when off. */
export function cellWords(items: CellItem[]): string {
  return items
    .map((item) => {
      if (item.type === 'ABSENCE') return ABSENCE_WORDS[item.absenceType] ?? 'Absent';
      const marks = [
        item.kind === 'EXTRA' ? 'extra' : '',
        item.offer ? 'offer' : '',
        item.proposed ? 'proposed' : '',
      ].filter(Boolean);
      return [item.shiftTemplate, ...marks].join(' ');
    })
    .join(' / ');
}

function hours(value: number): string {
  return String(Math.round(value * 100) / 100);
}

/**
 * The roster as rows of cells: a header, the three coverage rows ("4 of 5",
 * never "4/5", which Excel would read as a date), one row per officer shown,
 * then the day totals. `officers` is the filtered and sorted list on screen,
 * or every officer for the whole-unit export.
 */
export function rosterRows(payload: SchedulePayload, officers: OfficerRow[]): string[][] {
  const days = payload.days;
  const rows: string[][] = [
    [
      'Officer',
      'Rotation',
      'Qualifications',
      'Shifts in view',
      'Hours in view',
      'Pay-period hours',
      'Overtime status',
      ...days.map(dayHeading),
    ],
  ];

  (['DAY', 'EVENING', 'NIGHT'] as Block[]).forEach((block) => {
    const required = payload.coverage.find((entry) => entry.block === block)?.required;
    rows.push([
      `${BLOCK_WORDS[block]} coverage${required === undefined ? '' : ` (needs ${required})`}`,
      '',
      '',
      '',
      '',
      '',
      '',
      ...days.map((date) => {
        const entry = payload.coverage.find((item) => item.block === block && item.date === date);
        return entry ? `${entry.scheduled.lowestHourly} of ${entry.required}` : '';
      }),
    ]);
  });

  for (const officer of officers) {
    const totals = officerTotals(officer);
    rows.push([
      officer.name,
      officer.rotation || rotationLabel(rotationKind(officer)),
      (officer.qualifications ?? []).map(qualificationLabel).join(', '),
      String(totals.shifts),
      hours(totals.hours),
      hours(officer.payPeriodHours),
      STATUS_WORDS[officer.overtimeStatus] ?? officer.overtimeStatus,
      ...days.map((date) => cellWords(officer.cells.find((cell) => cell.date === date)?.items ?? [])),
    ]);
  }

  rows.push([
    'On duty',
    '',
    '',
    '',
    '',
    '',
    '',
    ...days.map((date) => String(dayTotals(officers, date).onDuty)),
  ]);
  rows.push([
    'Hours on duty',
    '',
    '',
    '',
    '',
    '',
    '',
    ...days.map((date) => hours(dayTotals(officers, date).hours)),
  ]);
  return rows;
}

/** A spreadsheet shows a cell starting with = + - @ (or tab / CR) as text, not a formula. */
export function guardFormula(value: string): string {
  return /^[=+\-@\t\r]/.test(value) ? `'${value}` : value;
}

function csvField(value: string): string {
  const safe = guardFormula(value);
  return /[",\r\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
}

/** CSV with a byte-order mark and CRLF line ends, the form Excel opens cleanly. */
export function toCsv(rows: string[][]): string {
  return '﻿' + rows.map((row) => row.map(csvField).join(',')).join('\r\n') + '\r\n';
}

/** Tab-separated text for the clipboard; a tab or line break inside a cell becomes a space. */
export function toTsv(rows: string[][]): string {
  return rows
    .map((row) => row.map((value) => guardFormula(value.replace(/[\t\r\n]+/g, ' '))).join('\t'))
    .join('\n');
}

/** "roster-unit-b-living-unit-2026-11-16-to-2026-11-22.csv", with "-filtered" for a filtered view. */
export function exportFileName(payload: SchedulePayload, filtered: boolean): string {
  const slug = payload.unit.name
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  const from = payload.days[0] ?? '';
  const to = payload.days[payload.days.length - 1] ?? '';
  return `roster-${slug || 'unit'}-${from}-to-${to}${filtered ? '-filtered' : ''}.csv`;
}

/** Hand the browser a file to save. */
export function downloadCsv(fileName: string, csv: string): void {
  const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
  const link = document.createElement('a');
  link.href = url;
  link.download = fileName;
  link.style.display = 'none';
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/**
 * Put text on the clipboard: the Clipboard API where the page is a secure
 * context, else a hidden text area and the older copy command (a board opened
 * over plain http on another host name). Resolves false when neither works.
 */
export async function copyText(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    // Fall through to the older way.
  }
  const area = document.createElement('textarea');
  area.value = text;
  area.setAttribute('readonly', '');
  area.style.position = 'fixed';
  area.style.opacity = '0';
  document.body.appendChild(area);
  area.select();
  try {
    return document.execCommand('copy');
  } catch {
    return false;
  } finally {
    area.remove();
  }
}
