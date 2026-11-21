const DAY_WORDS: Record<string, string> = {
  MON: 'Mon',
  TUE: 'Tue',
  WED: 'Wed',
  THU: 'Thu',
  FRI: 'Fri',
  SAT: 'Sat',
  SUN: 'Sun',
};

/** "since 2009" from an ISO seniority date. */
export function sinceYear(date: string): string {
  return `since ${date.slice(0, 4)}`;
}

/** "Sat, Sun" or "—". */
export function daysOffWords(days: string[]): string {
  return days.length === 0 ? '—' : days.map((day) => DAY_WORDS[day] ?? day).join(', ');
}
