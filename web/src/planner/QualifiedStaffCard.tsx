import Box from '@mui/material/Box';
import Card from '@mui/material/Card';
import CardContent from '@mui/material/CardContent';
import Typography from '@mui/material/Typography';

import { qualificationLabel } from '../api/qualifications';
import type { PlannerScorecard } from '../api/types';
import { StatusPill } from '../components/StatusPill';
import { colour } from '../theme/tokens';
import { plainDate } from './plannerTime';

type Qualification = NonNullable<PlannerScorecard['qualification']>;

const BLOCK_WORDS: Record<string, string> = {
  DAY: 'Day',
  EVENING: 'Evening',
  NIGHT: 'Night',
};

const BLOCK_ORDER: Record<string, number> = { DAY: 0, EVENING: 1, NIGHT: 2 };

/** The failing rows, by unit code and then Day, Evening, Night. */
function failingRows(qualification: Qualification) {
  return qualification.byUnitBlock
    .filter((row) => row.failingBlockDays > 0)
    .slice()
    .sort(
      (a, b) =>
        a.unitCode.localeCompare(b.unitCode) ||
        (BLOCK_ORDER[a.block] ?? 0) - (BLOCK_ORDER[b.block] ?? 0),
    );
}

/** The api's lead sentence, with a leading figure in bold. */
function LeadSentence({ sentence }: { sentence: string }) {
  const match = /^([\d,]+)(.*)$/s.exec(sentence);
  return (
    <Typography sx={{ fontSize: 14 }}>
      {match ? (
        <>
          <strong>{match[1]}</strong>
          {match[2]}
        </>
      ) : (
        sentence
      )}
    </Typography>
  );
}

/**
 * Qualified staff by unit (release 6): the api's warn-only figures over the
 * draft. Nothing here changes a placement.
 */
export function QualifiedStaffCard({
  qualification,
  from,
  to,
}: {
  qualification: Qualification;
  from: string;
  to: string;
}) {
  const rows = failingRows(qualification);
  const other = qualification.byUnitBlock.length - rows.length;
  const pill = qualification.passes
    ? { tone: 'info' as const, text: 'All met' }
    : { tone: 'warn' as const, text: 'Below minimum' };

  return (
    <Card>
      <CardContent sx={{ p: 4, display: 'flex', flexDirection: 'column', gap: 2 }}>
        <Typography component="h2" sx={{ m: 0, fontSize: 16, fontWeight: 700 }}>
          Qualified staff by unit
        </Typography>

        <Box sx={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 1.5 }}>
          <StatusPill tone={pill.tone}>{pill.text}</StatusPill>
          <LeadSentence sentence={qualification.sentence} />
        </Box>

        {rows.length > 0 ? (
          <>
            <Box sx={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
                <thead>
                  <tr>
                    {['Unit', 'Block', 'Needs at least', 'Block-days below'].map((heading, index) => (
                      <th
                        key={heading}
                        scope="col"
                        style={{
                          textAlign: index === 3 ? 'right' : 'left',
                          padding: '6px 8px',
                          fontSize: 12,
                          fontWeight: 600,
                          color: colour.text.secondary,
                          borderBottom: `1px solid ${colour.border.default}`,
                        }}
                      >
                        {heading}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {rows.map((row) => (
                    <tr key={`${row.unitCode}-${row.block}`}>
                      <td style={{ padding: '6px 8px', fontWeight: 600 }}>{row.unitName}</td>
                      <td style={{ padding: '6px 8px' }}>{BLOCK_WORDS[row.block] ?? row.block}</td>
                      <td style={{ padding: '6px 8px' }}>
                        {row.minimum} {qualificationLabel(row.qualification)}
                      </td>
                      <td className="num" style={{ padding: '6px 8px', textAlign: 'right' }}>
                        {row.failingBlockDays}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </Box>
            {other > 0 ? (
              <Typography sx={{ fontSize: 13, color: colour.text.secondary }}>
                The other {other} unit {other === 1 ? 'block met its' : 'blocks met their'} minimum
                every day.
              </Typography>
            ) : null}
          </>
        ) : null}

        <Typography sx={{ fontSize: 12, color: colour.text.secondary }}>
          Checked every day from {plainDate(from).replace(/ \d{4}$/, '')} to {plainDate(to)}: an
          officer counts when their shift overlaps the block in that unit.{' '}
          {qualification.validFromNote}
        </Typography>
      </CardContent>
    </Card>
  );
}
