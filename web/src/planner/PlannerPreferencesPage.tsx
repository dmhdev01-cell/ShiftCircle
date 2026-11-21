import { useEffect, useMemo, useState } from 'react';
import Box from '@mui/material/Box';
import Card from '@mui/material/Card';
import CardContent from '@mui/material/CardContent';
import Checkbox from '@mui/material/Checkbox';
import FormControlLabel from '@mui/material/FormControlLabel';
import Typography from '@mui/material/Typography';

import { api } from '../api/client';
import type { PlannerPreferenceRow } from '../api/types';
import { StatusPill } from '../components/StatusPill';
import { colour } from '../theme/tokens';
import { daysOffWords, sinceYear } from './preferenceWords';

const LENGTH_WORDS: Record<number, string> = { 8: '8 h', 12: '12 h', 16: '16 h' };
const TIME_WORDS: Record<string, string> = { DAY: 'Days', EVENING: 'Evenings', NIGHT: 'Nights' };

/** "Days, Evenings": a set reads in words, never as its enum values. */
function timeSetWords(parts: string[]): string {
  return parts.length === 0 ? 'No preference' : parts.map((part) => TIME_WORDS[part] ?? part).join(', ');
}

const IN_DRAFT = {
  MET: { words: 'Met', tone: 'pass' as const },
  PARTLY: { words: 'Partly met', tone: 'warn' as const },
  NOT_MET: { words: 'Not met', tone: 'warn' as const },
  NO_DRAFT: { words: 'No draft', tone: 'info' as const },
  NONE: { words: '—', tone: 'info' as const },
} as const;

/**
 * The planner reads everyone's wishes (docs/ui/planner.md §7): read-only, with
 * how the current draft met each one.
 */
export function PlannerPreferencesPage() {
  const [rows, setRows] = useState<PlannerPreferenceRow[] | null>(null);
  const [unitName, setUnitName] = useState('');
  const [find, setFind] = useState('');
  const [notMetOnly, setNotMetOnly] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    void api
      .getPlannerPreferences()
      .then((loaded) => {
        if (active) setRows(loaded);
      })
      .catch(() => {
        if (active) setError('The preferences could not be loaded.');
      });
    return () => {
      active = false;
    };
  }, []);

  const units = useMemo(
    () => Array.from(new Set((rows ?? []).map((row) => row.unitName))),
    [rows],
  );

  const shown = (rows ?? []).filter((row) => {
    if (unitName && row.unitName !== unitName) return false;
    if (find && !row.name.toLowerCase().includes(find.toLowerCase())) return false;
    if (notMetOnly && !(row.inDraft === 'PARTLY' || row.inDraft === 'NOT_MET')) return false;
    return true;
  });

  const gave = (rows ?? []).filter(
    (row) => row.shiftLength !== null || row.timesOfDay.length > 0 || row.daysOff.length > 0,
  ).length;

  return (
    <>
      <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
        <Typography variant="h1">Officer preferences</Typography>
        <Typography sx={{ fontSize: 14, color: colour.text.secondary }}>
          What officers asked for, and whether the current draft meets it. Read-only: officers
          change their own on My schedule.
        </Typography>
      </Box>

      <Card>
        <CardContent sx={{ p: 4, display: 'flex', flexDirection: 'column', gap: 3 }}>
          <Box sx={{ display: 'flex', flexWrap: 'wrap', alignItems: 'flex-end', gap: 3 }}>
            <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1, fontSize: 12, fontWeight: 600, color: colour.text.secondary }}>
              Unit
              <Box
                component="select"
                aria-label="Unit"
                value={unitName}
                onChange={(event: { target: { value: string } }) => setUnitName(event.target.value)}
                sx={{
                  minHeight: 44,
                  px: 3,
                  border: `1px solid ${colour.border.input}`,
                  borderRadius: '2px',
                  fontFamily: 'inherit',
                  fontSize: 14,
                  fontWeight: 500,
                  color: colour.text.primary,
                  backgroundColor: colour.bg.surface,
                }}
              >
                <option value="">All units</option>
                {units.map((unit) => (
                  <option key={unit} value={unit}>
                    {unit}
                  </option>
                ))}
              </Box>
            </Box>
            <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1, fontSize: 12, fontWeight: 600, color: colour.text.secondary }}>
              Find an officer
              <Box
                component="input"
                aria-label="Find an officer"
                value={find}
                onChange={(event: { target: { value: string } }) => setFind(event.target.value)}
                sx={{
                  minHeight: 44,
                  px: 3,
                  border: `1px solid ${colour.border.input}`,
                  borderRadius: '2px',
                  fontFamily: 'inherit',
                  fontSize: 14,
                  width: 220,
                }}
              />
            </Box>
            <FormControlLabel
              control={
                <Checkbox checked={notMetOnly} onChange={(event) => setNotMetOnly(event.target.checked)} />
              }
              label={<span style={{ fontSize: 14 }}>Not met only</span>}
              sx={{ minHeight: 44 }}
            />
          </Box>

          <Typography sx={{ fontSize: 13, color: colour.text.secondary }}>
            {rows?.length ?? 0} officers · {gave} gave preferences · {(rows?.length ?? 0) - gave} gave
            none
          </Typography>

          {error ? (
            <Typography role="alert" sx={{ fontSize: 14, color: colour.status.block.text }}>
              {error}
            </Typography>
          ) : null}

          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
            <thead>
              <tr>
                {['Officer', 'Unit', 'Seniority', 'Shift length', 'Time of day', 'Days off', 'In the draft'].map(
                  (heading) => (
                    <th
                      key={heading}
                      style={{
                        textAlign: 'left',
                        padding: '6px 8px',
                        fontSize: 12,
                        fontWeight: 600,
                        color: colour.text.secondary,
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
              {shown.map((row) => {
                const entry = IN_DRAFT[row.inDraft] ?? { words: '—', tone: 'info' as const };
                return (
                  <tr key={row.employeeId}>
                    <td style={{ padding: '6px 8px', fontWeight: 600 }}>{row.name}</td>
                    <td style={{ padding: '6px 8px' }}>{row.unitName}</td>
                    <td style={{ padding: '6px 8px' }}>{sinceYear(row.seniorityDate)}</td>
                    <td style={{ padding: '6px 8px' }}>
                      {row.shiftLength ? LENGTH_WORDS[row.shiftLength] ?? `${row.shiftLength} h` : 'No preference'}
                    </td>
                    <td style={{ padding: '6px 8px' }}>
                      {timeSetWords(row.timesOfDay)}
                    </td>
                    <td style={{ padding: '6px 8px' }}>{daysOffWords(row.daysOff)}</td>
                    <td style={{ padding: '6px 8px' }}>
                      <StatusPill tone={entry.tone}>{entry.words}</StatusPill>
                      {row.unmet.length > 0 ? (
                        <span style={{ marginLeft: 8, color: colour.text.secondary }}>{row.unmet.join(' · ')}</span>
                      ) : null}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          {shown.length === 0 ? (
            <Typography sx={{ fontSize: 14, color: colour.text.secondary }}>
              No officers match.
            </Typography>
          ) : null}
        </CardContent>
      </Card>
    </>
  );
}
