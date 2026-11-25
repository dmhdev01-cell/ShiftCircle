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

/** The api's still-short reasons, in the order its filters apply. */
const REASON_WORDS: [string, string, string][] = [
  ['NOT_QUALIFIED', 'not qualified', 'no free officer in another unit holds the post’s qualification'],
  ['NO_SHIFT_FITS', 'no shift that fits', 'no free officer in another unit works a shift that covers that block'],
  ['NO_HOURS_LEFT', 'no hours left', 'every qualified free officer in another unit has used their FTE hours for the pay period'],
  ['RULE_BLOCK', 'would break a rule', 'every qualified officer with hours left would break a rule (mostly rest)'],
  ['NO_OFFICER_FREE', 'no officer free', 'every officer in another unit is already working that day'],
];

export interface CrossUnitCard {
  gapsCovered: number;
  shifts: number;
  officers: number;
  stillShortReasons?: Record<string, number>;
  stillShortByUnitBlock?: Record<string, number>;
}

/**
 * Why the gaps left after the cross-unit fill are still short, for the
 * scorecard: "Still short: 46 not qualified · 14 no hours left · 12 would
 * break a rule", the units and blocks with the most, and, when nothing could
 * be covered, the main reason in a sentence instead of "0 shifts by 0 officers".
 */
export function stillShortWords(
  card: CrossUnitCard,
  unitName: (code: string) => string,
): { zero: string | null; reasons: string | null; where: string | null } {
  const reasons = card.stillShortReasons ?? {};
  const known = REASON_WORDS.filter(([key]) => (reasons[key] ?? 0) > 0);
  const other = Object.entries(reasons).filter(
    ([key, count]) => count > 0 && !REASON_WORDS.some(([known]) => known === key),
  );
  const parts = [
    ...known.map(([key, label]) => `${reasons[key].toLocaleString('en-CA')} ${label}`),
    ...other.map(([key, count]) => `${count.toLocaleString('en-CA')} ${key.toLowerCase().replace(/_/g, ' ')}`),
  ];
  const blockWords: Record<string, string> = { DAY: 'days', EVENING: 'evenings', NIGHT: 'nights' };
  const top = Object.entries(card.stillShortByUnitBlock ?? {})
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, 3)
    .map(([key, count]) => {
      const [unit, block] = key.split(' ');
      return `${unitName(unit)} ${blockWords[block] ?? block.toLowerCase()} (${count.toLocaleString('en-CA')})`;
    });
  const main = [...known].sort((a, b) => reasons[b[0]] - reasons[a[0]])[0];
  return {
    zero:
      card.gapsCovered === 0
        ? `No gap could be covered from another unit${main ? `: ${main[2]}` : ''}.`
        : null,
    reasons: parts.length > 0 ? `Still short: ${parts.join(' · ')}.` : null,
    where: top.length > 0 ? `Most are ${top.join(', ')}.` : null,
  };
}
