import type { PlanOptions } from '../api/types';

/** Today's generator: every officer, part-time fills gaps only, wishes honoured. */
export const DEFAULT_PLAN_OPTIONS: PlanOptions = {
  staffTypes: ['FULL_TIME', 'PART_TIME'],
  partTimeFill: 'AFTER_FULL_TIME',
  preferences: 'ON',
};

/** The options a draft was made with; an older draft (no options) used the defaults. */
export function draftOptions(draft: { options?: PlanOptions } | null | undefined): PlanOptions {
  const options = draft?.options;
  if (!options) return { ...DEFAULT_PLAN_OPTIONS, staffTypes: [...DEFAULT_PLAN_OPTIONS.staffTypes] };
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
    preferences: options.preferences,
  };
}

export function isDefault(options: PlanOptions): boolean {
  const request = optionsForRequest(options);
  return (
    request.staffTypes.length === 2 &&
    request.partTimeFill === DEFAULT_PLAN_OPTIONS.partTimeFill &&
    request.preferences === DEFAULT_PLAN_OPTIONS.preferences
  );
}

/** "Made with: …" in words, one short phrase per option. */
export function planOptionsWords(options: PlanOptions): string {
  const staff = includesPartTime(options)
    ? 'full-time and part-time officers'
    : 'full-time officers only';
  const fill = !includesPartTime(options)
    ? null
    : options.partTimeFill === 'UP_TO_FTE'
      ? 'part-time filled up to FTE'
      : 'part-time fills gaps only';
  const preferences =
    options.preferences === 'ON' ? 'time-of-day wishes honoured' : 'time-of-day wishes ignored';
  return [staff, fill, preferences].filter(Boolean).join(' · ');
}
