import Box from '@mui/material/Box';
import Checkbox from '@mui/material/Checkbox';
import Typography from '@mui/material/Typography';

import { qualificationLabels } from '../api/qualifications';
import type { Candidate, Eligibility } from '../api/types';
import { StatusPill } from '../components/StatusPill';
import { colour } from '../theme/tokens';

const TONE = {
  ELIGIBLE: 'pass',
  WARN: 'warn',
  SKIPPED: 'block',
  UNAVAILABLE: 'info',
} as const;

const LABEL = {
  ELIGIBLE: 'Eligible',
  WARN: 'Eligible · warning',
  SKIPPED: 'Skipped',
  UNAVAILABLE: 'Not available',
} as const;

/** Only an eligible or warned officer can be offered the shift. */
function canBeOffered(candidate: Candidate): boolean {
  return candidate.eligibility === 'ELIGIBLE' || candidate.eligibility === 'WARN';
}

interface CandidateTableProps {
  candidates: Candidate[];
  /** The officers the supervisor ticked. */
  selected: string[];
  onToggle: (employeeId: string) => void;
}

/**
 * The ranked candidate table (docs/ui/README.md §5.3). The order comes from
 * the api - the overtime-ranking rule table - and officers who would break a
 * Block rule are skipped without losing their place.
 */
export function CandidateTable({ candidates, selected, onToggle }: CandidateTableProps) {
  return (
    <Box sx={{ overflowX: 'auto' }}>
      <table
        style={{
          width: '100%',
          minWidth: 760,
          borderCollapse: 'collapse',
          fontSize: 13,
        }}
      >
        <thead>
          <tr>
            {['#', 'Officer', 'OT this quarter', 'Seniority', 'Rule check for this shift', 'Offer'].map(
              (heading) => (
                <th
                  key={heading}
                  style={{
                    textAlign: 'left',
                    padding: 10,
                    fontSize: 12,
                    fontWeight: 600,
                    color: colour.text.secondary,
                    backgroundColor: colour.bg.subtle,
                    borderBottom: `1px solid ${colour.border.default}`,
                  }}
                >
                  {heading}
                </th>
              ),
            )}
          </tr>
        </thead>
        <tbody>
          {candidates.map((candidate, index) => {
            // Only a rule that failed or warned is worth naming; a passing
            // rule code would say nothing.
            const ruleCode = candidate.ruleResults?.find(
              (result) => result.outcome === 'BLOCK' || result.outcome === 'WARN',
            )?.ruleCode;
            const offerable = canBeOffered(candidate);
            return (
              <tr key={candidate.employeeId}>
                <td
                  className="num"
                  style={{
                    fontWeight: 600,
                    padding: 10,
                    borderBottom: `1px solid ${colour.border.default}`,
                  }}
                >
                  {index + 1}
                </td>
                <td style={{ padding: 10, borderBottom: `1px solid ${colour.border.default}` }}>
                  <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.5 }}>
                    <Box component="span" sx={{ fontWeight: 600 }}>
                      {candidate.name}
                    </Box>
                    <Box component="span" sx={{ fontSize: 12, color: colour.text.secondary }}>
                      {qualificationLabels(candidate.qualifications) || 'General duty'}
                    </Box>
                  </Box>
                </td>
                <td
                  className="num"
                  style={{ padding: 10, borderBottom: `1px solid ${colour.border.default}` }}
                >
                  {candidate.overtimeHoursThisQuarter.toFixed(1)} h
                </td>
                <td
                  className="num"
                  style={{ padding: 10, borderBottom: `1px solid ${colour.border.default}` }}
                >
                  {candidate.seniorityDate}
                </td>
                <td style={{ padding: 10, borderBottom: `1px solid ${colour.border.default}` }}>
                  <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1, alignItems: 'flex-start' }}>
                    <StatusPill tone={TONE[candidate.eligibility as Eligibility]}>
                      {LABEL[candidate.eligibility as Eligibility]}
                      {ruleCode ? ` · ${ruleCode}` : ''}
                    </StatusPill>
                    {candidate.reason ? (
                      <Typography
                        component="span"
                        sx={{ fontSize: 12, color: colour.text.secondary }}
                      >
                        {candidate.reason}
                      </Typography>
                    ) : null}
                  </Box>
                </td>
                <td style={{ padding: 10, borderBottom: `1px solid ${colour.border.default}` }}>
                  {offerable ? (
                    <Box
                      component="label"
                      sx={{
                        display: 'inline-flex',
                        alignItems: 'center',
                        gap: 2,
                        minHeight: 44,
                        fontSize: 13,
                        cursor: 'pointer',
                      }}
                    >
                      <Checkbox
                        checked={selected.includes(candidate.employeeId)}
                        onChange={() => onToggle(candidate.employeeId)}
                        slotProps={{
                          input: { 'aria-label': `Select ${candidate.name} for this shift` },
                        }}
                      />
                      Select
                    </Box>
                  ) : (
                    <Typography component="span" sx={{ fontSize: 12, color: colour.text.secondary }}>
                      {candidate.eligibility === 'UNAVAILABLE' ? 'Not available' : 'Skipped'}
                    </Typography>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </Box>
  );
}
