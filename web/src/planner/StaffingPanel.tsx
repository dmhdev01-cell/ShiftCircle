import { useState } from 'react';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Card from '@mui/material/Card';
import CardContent from '@mui/material/CardContent';
import Dialog from '@mui/material/Dialog';
import DialogActions from '@mui/material/DialogActions';
import DialogContent from '@mui/material/DialogContent';
import DialogTitle from '@mui/material/DialogTitle';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';

import { api } from '../api/client';
import type { StaffingPeriod, StaffingReport, StaffingUnitRow } from '../api/types';
import { StatusPill } from '../components/StatusPill';
import { KpiTile } from '../planning/KpiTile';
import { colour } from '../theme/tokens';
import { dateWords } from './unitDates';
import { staffingTile } from './staffingWords';

/**
 * Staffing (release 3): the tile and the "Staffing by unit" panel. Every number
 * and the leave allowance come from the api; the web only formats them and
 * writes the sentences dev-design specified.
 */

function shortName(row: StaffingUnitRow): string {
  return row.unitName.split(' · ')[0];
}

function periodSentence(period: StaffingPeriod, index: number, leavePercent: number): string {
  const prefix = index === 0 ? '' : `From ${dateWords(period.from)}: `;
  const closed = period.units.filter((unit) => unit.closed);
  if (period.totals.short === 0) {
    if (index > 0 && closed.length > 0) {
      const names = closed.map(shortName).join(' and ');
      return `${prefix}No. ${names} ${closed.length === 1 ? 'is' : 'are'} closed and ${
        closed.length === 1 ? 'its' : 'their'
      } officers work as relief in other units.`;
    }
    return `${prefix}Do we need more staff? No. Every unit has at least the officers it needs, with a ${leavePercent}% leave allowance.`;
  }
  const units = period.units
    .filter((unit) => unit.short > 0)
    .map((unit) => `${shortName(unit)} (${unit.short})`)
    .join(' and ');
  return `${prefix}Do we need more staff? Yes: ${period.totals.short} more officers in total, in ${units}.`;
}

function howLine(row: StaffingUnitRow): string {
  const b = row.breakdown;
  const worked = (b.rawNeeded / (1 - b.leaveAllowance)).toFixed(1);
  return `${shortName(row)}: ${b.posts12Day} day 12-hour posts × 2 = ${
    b.posts12Day * 2
  }, ${b.posts12Night} night 12-hour posts × 2 = ${b.posts12Night * 2}, ${
    b.posts8
  } evening 8-hour posts × 1.4 = ${(b.posts8 * 1.4).toFixed(1)}. ${b.rawNeeded.toFixed(
    1,
  )} ÷ ${(1 - b.leaveAllowance).toFixed(1)} = ${worked}, rounded up to ${b.needed}.`;
}

export function StaffingTile({ report }: { report: StaffingReport }) {
  const tile = staffingTile(report);
  return <KpiTile label="Staffing" value={tile.value} note={tile.note} tone={tile.tone} />;
}

export function StaffingPanel({
  report,
  onChanged,
}: {
  report: StaffingReport;
  onChanged: () => Promise<void> | void;
}) {
  const [howOpen, setHowOpen] = useState(false);
  const [leaveOpen, setLeaveOpen] = useState(false);
  const leavePercent = Math.round(report.leaveAllowance * 100);
  const periods = report.periods;
  const rows = periods[0]?.units ?? [];

  return (
    <Card>
      <CardContent sx={{ p: 4, display: 'flex', flexDirection: 'column', gap: 3 }}>
        <Typography component="h2" sx={{ m: 0, fontSize: 16, fontWeight: 700 }}>
          Staffing by unit
        </Typography>

        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
          {periods.map((period, index) => (
            <Box key={period.from} sx={{ display: 'flex', alignItems: 'center', gap: 1.5 }}>
              <StatusPill tone={period.totals.short > 0 ? 'warn' : 'pass'}>
                {period.totals.short > 0 ? 'Short' : 'Enough'}
              </StatusPill>
              <Typography sx={{ fontSize: 16, fontWeight: 600 }}>
                {periodSentence(period, index, leavePercent)}
              </Typography>
            </Box>
          ))}
        </Box>

        <Box sx={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
            <caption
              style={{
                position: 'absolute',
                width: 1,
                height: 1,
                overflow: 'hidden',
                clip: 'rect(0 0 0 0)',
                whiteSpace: 'nowrap',
              }}
            >
              Staff allocated, on staff, needed and short, by unit
            </caption>
            <thead>
              <tr>
                {['Unit', 'Allocated', 'On staff'].map((heading) => (
                  <th
                    key={heading}
                    scope="col"
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
                ))}
                {periods.map((period) => (
                  <th
                    key={`needed-${period.from}`}
                    scope="col"
                    style={{
                      textAlign: 'left',
                      padding: '6px 8px',
                      fontSize: 12,
                      fontWeight: 600,
                      color: colour.text.secondary,
                      borderBottom: `1px solid ${colour.border.default}`,
                    }}
                  >
                    Needed
                    <Box component="span" sx={{ display: 'block', fontSize: 11, fontWeight: 500 }}>
                      {dateWords(period.from)} – {dateWords(period.to)}
                    </Box>
                  </th>
                ))}
                {periods.map((period) => (
                  <th
                    key={`short-${period.from}`}
                    scope="col"
                    style={{
                      textAlign: 'left',
                      padding: '6px 8px',
                      fontSize: 12,
                      fontWeight: 600,
                      color: colour.text.secondary,
                      borderBottom: `1px solid ${colour.border.default}`,
                    }}
                  >
                    Short
                    <Box component="span" sx={{ display: 'block', fontSize: 11, fontWeight: 500 }}>
                      {dateWords(period.from)} – {dateWords(period.to)}
                    </Box>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.unitId}>
                  <td style={{ padding: '6px 8px', fontWeight: 600, borderBottom: `1px solid ${colour.border.default}` }}>
                    {row.unitName}
                  </td>
                  <td className="num" style={{ padding: '6px 8px', borderBottom: `1px solid ${colour.border.default}` }}>
                    {row.allocated}
                  </td>
                  <td className="num" style={{ padding: '6px 8px', borderBottom: `1px solid ${colour.border.default}` }}>
                    {row.filled}
                  </td>
                  {periods.map((period) => {
                    const entry = period.units.find((unit) => unit.unitId === row.unitId);
                    return (
                      <td
                        key={`needed-${period.from}-${row.unitId}`}
                        className="num"
                        style={{ padding: '6px 8px', borderBottom: `1px solid ${colour.border.default}` }}
                      >
                        {entry?.needed ?? 0}
                        {entry?.closed ? (
                          <Box component="span" sx={{ display: 'block', fontSize: 12, color: colour.text.secondary }}>
                            closed
                          </Box>
                        ) : null}
                      </td>
                    );
                  })}
                  {periods.map((period) => {
                    const entry = period.units.find((unit) => unit.unitId === row.unitId);
                    return (
                      <td
                        key={`short-${period.from}-${row.unitId}`}
                        className="num"
                        style={{ padding: '6px 8px', borderBottom: `1px solid ${colour.border.default}` }}
                      >
                        {entry && entry.short > 0 ? (
                          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                            <strong>{entry.short}</strong>
                            <StatusPill tone="warn">Short</StatusPill>
                          </Box>
                        ) : (
                          <span style={{ color: colour.text.secondary }}>0</span>
                        )}
                      </td>
                    );
                  })}
                </tr>
              ))}
              <tr>
                <td style={{ padding: '8px', fontWeight: 700 }}>All units</td>
                <td className="num" style={{ padding: '8px', fontWeight: 700 }}>
                  {periods[0]?.totals.allocated ?? 0}
                </td>
                <td className="num" style={{ padding: '8px', fontWeight: 700 }}>
                  {periods[0]?.totals.filled ?? 0}
                </td>
                {periods.map((period) => (
                  <td key={`total-needed-${period.from}`} className="num" style={{ padding: '8px', fontWeight: 700 }}>
                    {period.totals.needed}
                  </td>
                ))}
                {periods.map((period) => (
                  <td key={`total-short-${period.from}`} className="num" style={{ padding: '8px', fontWeight: 700 }}>
                    {period.totals.short}
                  </td>
                ))}
              </tr>
            </tbody>
          </table>
        </Box>
        {report.truncatedNote ? (
          <Typography sx={{ fontSize: 12, color: colour.text.secondary }}>
            {report.truncatedNote}
          </Typography>
        ) : null}

        <Box sx={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 2 }}>
          <Typography sx={{ fontSize: 14 }}>Leave allowance: {leavePercent}%</Typography>
          <Button
            variant="text"
            color="primary"
            aria-label="Change leave allowance"
            onClick={() => setLeaveOpen(true)}
          >
            Change…
          </Button>
          <Button variant="text" color="primary" onClick={() => setHowOpen(!howOpen)}>
            How
          </Button>
        </Box>
        {howOpen ? (
          <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.5 }}>
            {rows.map((row) => (
              <Typography key={row.unitId} sx={{ fontSize: 12, color: colour.text.secondary }}>
                {howLine(row)}
              </Typography>
            ))}
          </Box>
        ) : null}

        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.5 }}>
          <Typography component="h3" sx={{ m: 0, fontSize: 15, fontWeight: 600 }}>
            How &quot;needed&quot; is worked out
          </Typography>
          <Typography sx={{ fontSize: 14 }}>
            Each unit has a minimum number of officers on duty in every block: Day 07–15, Evening
            15–23 and Night 23–07.
          </Typography>
          <Typography sx={{ fontSize: 14 }}>
            12-hour posts (day 07–19 and night 19–07) work 4 on, 4 off, so each post needs 2 officers.
          </Typography>
          <Typography sx={{ fontSize: 14 }}>
            8-hour posts work 5 on, 2 off, so each post needs 7 ÷ 5 = 1.4 officers.
          </Typography>
          <Typography sx={{ fontSize: 14 }}>
            Then allow for leave: divide by (1 − {leavePercent}%), here ÷{' '}
            {(1 - report.leaveAllowance).toFixed(1)}, and round up to whole officers.
          </Typography>
          <Typography sx={{ fontSize: 14 }}>
            A closed unit needs no officers on the days it is closed.
          </Typography>
        </Box>
        <Typography sx={{ fontSize: 13, color: colour.text.secondary }}>{report.note}</Typography>
      </CardContent>

      <LeaveDialog
        open={leaveOpen}
        current={leavePercent}
        onClose={() => setLeaveOpen(false)}
        onSaved={async () => {
          setLeaveOpen(false);
          await onChanged();
        }}
      />
    </Card>
  );
}

function LeaveDialog({
  open,
  current,
  onClose,
  onSaved,
}: {
  open: boolean;
  current: number;
  onClose: () => void;
  onSaved: () => Promise<void>;
}) {
  const [value, setValue] = useState(String(current));
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const save = async () => {
    setError(null);
    const percent = Number(value);
    if (!Number.isInteger(percent) || percent < 0 || percent > 50) {
      setError('Enter a whole number from 0 to 50.');
      return;
    }
    if (reason.trim().length < 5) {
      setError('Write a reason of at least 5 characters.');
      return;
    }
    setBusy(true);
    try {
      await api.setLeaveAllowance(percent, reason);
      await onSaved();
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : 'The leave allowance could not be saved.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onClose={onClose} fullWidth maxWidth="xs">
      <DialogTitle sx={{ fontSize: 18, fontWeight: 700 }}>Leave allowance</DialogTitle>
      <DialogContent sx={{ display: 'flex', flexDirection: 'column', gap: 2.5 }}>
        <TextField
          label="Leave allowance (%)"
          type="number"
          value={value}
          onChange={(event) => setValue(event.target.value)}
          helperText="The share of officers away on vacation, sick or training on an average day. Default 20%."
          slotProps={{ htmlInput: { min: 0, max: 50, step: 1 } }}
        />
        <TextField
          label="Reason"
          value={reason}
          onChange={(event) => setReason(event.target.value)}
          helperText="Shown in the audit log."
        />
        {error ? (
          <Typography role="alert" sx={{ fontSize: 14, color: colour.status.block.text }}>
            {error}
          </Typography>
        ) : null}
      </DialogContent>
      <DialogActions sx={{ px: 3, pb: 3 }}>
        <Button variant="outlined" color="primary" onClick={onClose}>
          Cancel
        </Button>
        <Button variant="contained" color="primary" disabled={busy} onClick={() => void save()}>
          {busy ? 'Saving…' : 'Save'}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
