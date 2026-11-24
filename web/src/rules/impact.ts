import type { BuildStep, Unit } from '../api/types';

type ImpactRow = NonNullable<BuildStep['impact']>[number];

const VERDICTS: Record<string, string> = {
  PASS: 'Pass',
  INFO: 'Info',
  WARN: 'Warn',
  BLOCK: 'Block',
};

/**
 * The unit as people say it: "Unit A" for code A, from the units list
 * ("Unit A · Living unit") when it is loaded, else from the code.
 */
export function unitLabel(code: string, units: Unit[] = []): string {
  const unit = units.find((candidate) => candidate.code === code || candidate.name === code);
  if (unit) return unit.name.split(' · ')[0];
  if (code.includes(' · ')) return code.split(' · ')[0];
  return /^[A-Z]$/.test(code) ? `Unit ${code}` : code;
}

/**
 * One dry-run row in plain words. The api counts officers whose result for a
 * rule changes, with the result before and after (PASS, WARN, BLOCK):
 * "1 officer in Unit A goes from Pass to Warn under U-02".
 */
export function impactSentence(row: ImpactRow, units: Unit[] = []): string {
  const who = row.count === 1 ? '1 officer' : `${row.count} officers`;
  const verb = row.count === 1 ? 'goes' : 'go';
  const from = VERDICTS[row.from] ?? row.from;
  const to = VERDICTS[row.to] ?? row.to;
  return `${who} in ${unitLabel(row.unit, units)} ${verb} from ${from} to ${to} under ${row.ruleCode}`;
}
