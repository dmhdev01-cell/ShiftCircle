import type { PlanOptions } from '../api/types';

/** Today's generator: every officer, part-time officers fill gaps only. */
export const DEFAULT_PLAN_OPTIONS: PlanOptions = {
  staffTypes: ['FULL_TIME', 'PART_TIME'],
  partTimeFill: 'AFTER_FULL_TIME',
};

/** The options a draft was made with; an older draft (no options) used the defaults. */
export function draftOptions(draft: { options?: PlanOptions } | null | undefined): PlanOptions {
  const options = draft?.options ?? DEFAULT_PLAN_OPTIONS;
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
  };
}

/** "Made with: …" in words, one short phrase per option. */
export function planOptionsWords(options: PlanOptions): string {
  if (!includesPartTime(options)) return 'full-time officers only';
  return options.partTimeFill === 'UP_TO_FTE'
    ? 'full-time and part-time officers · part-time filled up to FTE'
    : 'full-time and part-time officers · part-time fills gaps only';
}
