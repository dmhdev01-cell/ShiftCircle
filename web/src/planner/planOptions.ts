import type { PlanOptions, PlannerScorecard } from '../api/types';
import { partTimeCapacity } from './quarterPlan';

/** Today's generator: every officer, part-time officers fill gaps only, home unit only. */
export const DEFAULT_PLAN_OPTIONS: PlanOptions = {
  staffTypes: ['FULL_TIME', 'PART_TIME'],
  partTimeFill: 'AFTER_FULL_TIME',
  crossUnitFill: 'OFF',
};

/** The options a draft was made with; an older draft (no options, or fewer) used the defaults. */
export function draftOptions(draft: { options?: Partial<PlanOptions> } | null | undefined): PlanOptions {
  const options = { ...DEFAULT_PLAN_OPTIONS, ...(draft?.options ?? {}) };
  return { ...options, staffTypes: [...options.staffTypes] };
}

export function includesPartTime(options: PlanOptions): boolean {
  return options.staffTypes.includes('PART_TIME');
}

/**
 * The body the api expects. Part-time fill only means something when
 * part-time officers are included, so it falls back to the default without them.
 */
export function optionsForRequest(options: PlanOptions): PlanOptions {
  const partTime = includesPartTime(options);
  return {
    staffTypes: partTime ? ['FULL_TIME', 'PART_TIME'] : ['FULL_TIME'],
    partTimeFill: partTime ? options.partTimeFill : 'AFTER_FULL_TIME',
    crossUnitFill: options.crossUnitFill,
  };
}

/** "Made with: …" in words, one short phrase per option. */
export function planOptionsWords(options: PlanOptions): string {
  const staff = !includesPartTime(options)
    ? 'full-time officers only'
    : options.partTimeFill === 'UP_TO_FTE'
      ? 'full-time and part-time officers · part-time filled up to FTE'
      : 'full-time and part-time officers · part-time fills gaps only';
  return options.crossUnitFill === 'ON' ? `${staff} · gaps covered from other units` : staff;
}

/** The figures a planner compares between two drafts. */
export interface DraftFigures {
  gaps: number;
  warnings: number;
  unusedPartTime: number;
  shifts: number;
  coveredFromOtherUnits: number;
}

export function draftFigures(scorecard: PlannerScorecard, shifts: number): DraftFigures {
  return {
    gaps: scorecard.coverage.shortBlockDays,
    warnings: scorecard.warnings.total,
    unusedPartTime: partTimeCapacity(scorecard)?.unused ?? 0,
    shifts,
    coveredFromOtherUnits: scorecard.crossUnit?.gapsCovered ?? 0,
  };
}

/** "Compared with the previous draft: gaps 100 → 72 · …", every figure, unchanged ones said so. */
export function draftDeltaWords(before: DraftFigures, after: DraftFigures): string {
  const number = (value: number) => value.toLocaleString('en-CA');
  const parts: [string, keyof DraftFigures, string][] = [
    ['gaps', 'gaps', ''],
    ['rule warnings', 'warnings', ''],
    ['unused part-time hours', 'unusedPartTime', ' h'],
    ['shifts', 'shifts', ''],
    ['gaps covered from other units', 'coveredFromOtherUnits', ''],
  ];
  const words = parts.map(([label, key, unit]) =>
    before[key] === after[key]
      ? `${label} unchanged at ${number(after[key])}${unit}`
      : `${label} ${number(before[key])}${unit} → ${number(after[key])}${unit}`,
  );
  return `Compared with the previous draft: ${words.join(' · ')}.`;
}
