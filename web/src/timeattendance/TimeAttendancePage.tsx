import { useState } from 'react';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Card from '@mui/material/Card';
import CardContent from '@mui/material/CardContent';
import Drawer from '@mui/material/Drawer';
import Typography from '@mui/material/Typography';

import { api, ApiError } from '../api/client';
import type { RecordActualInput, TimeEntry } from '../api/types';
import { useVersion } from '../api/useVersion';
import { StatusPill } from '../components/StatusPill';
import { KpiTile } from '../planning/KpiTile';
import { colour } from '../theme/tokens';
import { LockPeriodDialog, UnlockDialog } from './PeriodDialogs';
import { RecordActualPanel } from './RecordActualPanel';
import { TimeGrid } from './TimeGrid';
import type { OfficerTimeRow } from './TimeGrid';
import { usePayPeriods, useTimeEntries } from './useTimeAttendance';
import { workedOf } from './workedHours';

function daysBetween(from: string, to: string): string[] {
  const days: string[] = [];
  const start = new Date(`${from}T00:00:00Z`);
  const end = new Date(`${to}T00:00:00Z`);
  for (let day = new Date(start); day <= end; day.setUTCDate(day.getUTCDate() + 1)) {
    days.push(day.toISOString().slice(0, 10));
  }
  return days;
}

/**
 * Time and attendance (docs/ui/build-notes.md §2.2). The supervisor records
 * what actually happened, and locks the pay period once every shift that has
 * ended has an actual (ADR-017). A locked period is read-only.
 */
export function TimeAttendancePage() {
  const { state: periodsState, reload: reloadPeriods } = usePayPeriods();
  const periods = periodsState.kind === 'ready' ? periodsState.periods : [];
  const [periodId, setPeriodId] = useState<string | null>(null);
  const { state: version } = useVersion();
  const asOf = version.status === 'ready' ? version.info.asOf : undefined;
  // The period that contains the demo day, not whichever one the api lists
  // first: the list runs newest first, so the first is a future period (V3).
  const defaultPeriod =
    (asOf ? periods.find((entry) => asOf >= entry.from && asOf <= entry.to) : undefined) ??
    periods.find((entry) => entry.status === 'OPEN') ??
    periods[0];
  const activePeriodId = periodId ?? defaultPeriod?.id ?? null;
  const { state: entriesState, reload: reloadEntries } = useTimeEntries(activePeriodId);
  const [unitId, setUnitId] = useState<string>('');
  const [picked, setPicked] = useState<TimeEntry | null>(null);
  const [saved, setSaved] = useState<{
    periodHours: number;
    payCodes: TimeEntry['payCodes'];
  } | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [missing, setMissing] = useState<{ assignmentId: string; employeeId: string; start: string }[]>([]);
  const [lockOpen, setLockOpen] = useState(false);
  const [unlockOpen, setUnlockOpen] = useState(false);

  const period = periods.find((entry) => entry.id === activePeriodId);

  if (periodsState.kind === 'loading') {
    return (
      <>
        <Typography variant="h1">Time &amp; attendance</Typography>
        <Typography sx={{ fontSize: 14, color: colour.text.secondary }} role="status">
          Loading the pay periods…
        </Typography>
      </>
    );
  }

  if (periodsState.kind === 'error') {
    return (
      <>
        <Typography variant="h1">Time &amp; attendance</Typography>
        <Card>
          <CardContent sx={{ p: 4, display: 'flex', flexDirection: 'column', gap: 2 }}>
            <Typography sx={{ fontWeight: 600, fontSize: 15, color: colour.status.block.text }}>
              Could not load the pay periods
            </Typography>
            <Typography sx={{ fontSize: 14, color: colour.text.secondary }}>
              {periodsState.message}
            </Typography>
          </CardContent>
        </Card>
      </>
    );
  }

  const entries = entriesState.kind === 'ready' ? entriesState.entries : [];
  const locked = period?.status === 'LOCKED';

  const units = Array.from(
    new Map(entries.map((entry) => [entry.unitId, entry.unitName])).entries(),
  );
  const visible = unitId ? entries.filter((entry) => entry.unitId === unitId) : entries;

  const days = period ? daysBetween(period.from, period.to) : [];

  const rows: OfficerTimeRow[] = Array.from(
    new Map(visible.map((entry) => [entry.employeeId, entry])).values(),
  ).map((first) => {
    const own = visible.filter((entry) => entry.employeeId === first.employeeId);
    const hours = own.reduce((total, entry) => total + workedOf(entry), 0);
    const threshold = period?.overtimeThresholdHours ?? 80;
    const status =
      hours > threshold ? 'IN_OVERTIME' : hours > threshold - 8 ? 'APPROACHING' : 'UNDER';
    return {
      employeeId: first.employeeId,
      name: first.employeeName,
      hours: Math.round(hours * 4) / 4,
      threshold,
      status,
      cells: days.map((date) => ({
        date,
        entry: own.find((entry) => entry.date === date),
      })),
    };
  });

  const scheduledHours = visible.reduce(
    (total, entry) =>
      total +
      Math.round(
        ((new Date(entry.endAt).getTime() - new Date(entry.startAt).getTime()) / 3_600_000) * 4,
      ) / 4,
    0,
  );
  const workedHours = visible.reduce((total, entry) => total + workedOf(entry), 0);
  const needingActuals = visible.filter((entry) => entry.needsActual);
  // The shifts with no actual: the ones the screen knows about, plus any the
  // api names when it refuses to lock the period (ADR-017).
  const missingShifts = [
    ...needingActuals.map((entry) => ({
      assignmentId: entry.assignmentId,
      employeeName: entry.employeeName,
      start: entry.startAt,
    })),
    ...missing
      .filter((entry) => !needingActuals.some((known) => known.assignmentId === entry.assignmentId))
      .map((entry) => ({
        assignmentId: entry.assignmentId,
        employeeName: entry.employeeId,
        start: entry.start,
      })),
  ];
  const shortExtensions = visible.filter(
    (entry) => (entry.unpaidExtensionMinutes ?? 0) > 0 && (entry.unpaidExtensionMinutes ?? 0) < 30,
  );

  /** Take the supervisor from a missing-actual line to that cell. */
  const locateMissing = (assignmentId: string) => {
    const entry = visible.find((item) => item.assignmentId === assignmentId);
    if (entry) {
      setPicked(entry);
      setSaved(null);
    }
    const cell = document.querySelector<HTMLElement>(
      `[data-assignment-id="${assignmentId}"]`,
    );
    if (!cell) return;
    if (typeof cell.scrollIntoView === 'function') {
      cell.scrollIntoView({ block: 'center', inline: 'center' });
    }
    const target = cell.querySelector<HTMLElement>('button') ?? cell;
    target.focus?.();
  };

  const recordActual = async (input: RecordActualInput) => {
    if (!picked) return;
    try {
      const result = await api.recordActual(picked.assignmentId, input);
      // The panel stays open with the recalculated pay codes, so the
      // supervisor sees what the change did.
      setSaved({ periodHours: result.periodHours, payCodes: result.payCodes });
      setMessage('The actual is recorded and the pay codes are recalculated.');
      reloadEntries();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'The actual could not be recorded.');
    }
  };

  const lockPeriod = async () => {
    if (!period) return;
    try {
      await api.lockPayPeriod(period.id);
      setLockOpen(false);
      setMissing([]);
      setMessage('The pay period is locked. The actuals are read-only now.');
      reloadPeriods();
    } catch (error) {
      setLockOpen(false);
      if (error instanceof ApiError && error.problem?.missing) {
        // ADR-017: the api says which shifts are missing, so the supervisor
        // sees them rather than a generic error.
        setMissing(error.problem.missing);
        setMessage(
          `${error.problem.missing.length} shift${error.problem.missing.length === 1 ? '' : 's'} in this period have no actual recorded. Record them before locking the period.`,
        );
        return;
      }
      setMessage(error instanceof Error ? error.message : 'The period could not be locked.');
    }
  };

  const unlockPeriod = async (reason: string) => {
    if (!period) return;
    try {
      await api.unlockPayPeriod(period.id, reason);
      setUnlockOpen(false);
      setMessage('The pay period is unlocked. The reason is in the audit log.');
      reloadPeriods();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'The period could not be unlocked.');
    }
  };

  const exportPayroll = async () => {
    if (!period) return;
    try {
      const file = await api.exportPayroll(period.id);
      const blob = new Blob([file.content], { type: 'text/csv' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = file.fileName;
      link.click();
      URL.revokeObjectURL(url);
      setMessage(`The payroll export ${file.fileName} is downloaded.`);
      reloadPeriods();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'The export could not be made.');
    }
  };

  return (
    <>
      <Box sx={{ display: 'flex', flexWrap: 'wrap', alignItems: 'flex-end', justifyContent: 'space-between', gap: 4 }}>
        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
          <Typography variant="h1">Time &amp; attendance</Typography>
          <Typography sx={{ fontSize: 14, color: colour.text.secondary }}>
            Scheduled against actual, by officer and day
          </Typography>
        </Box>

        <Box sx={{ display: 'flex', flexWrap: 'wrap', alignItems: 'flex-end', gap: 3 }}>
          <Box
            sx={{ display: 'flex', flexDirection: 'column', gap: 1, fontSize: 12, fontWeight: 600, color: colour.text.secondary }}
          >
            Pay period
            <Box
              component="select"
              aria-label="Pay period"
              value={activePeriodId ?? ''}
              onChange={(event) => {
                setPeriodId(event.target.value);
                setPicked(null);
                setMessage(null);
                setMissing([]);
              }}
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
              {periods.map((entry) => (
                <option key={entry.id} value={entry.id}>
                  {entry.label}
                </option>
              ))}
            </Box>
          </Box>

          <Box
            sx={{ display: 'flex', flexDirection: 'column', gap: 1, fontSize: 12, fontWeight: 600, color: colour.text.secondary }}
          >
            Unit
            <Box
              component="select"
              aria-label="Unit"
              value={unitId}
              onChange={(event) => setUnitId(event.target.value)}
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
              {units.map(([id, name]) => (
                <option key={id} value={id}>
                  {name}
                </option>
              ))}
            </Box>
          </Box>

          {period ? (
            <StatusPill tone={locked ? 'pass' : 'info'}>
              {locked
                ? `Locked${period.lockedBy ? ` · ${period.lockedBy}` : ''}${period.lockedAt ? ` · ${period.lockedAt}` : ''}`
                : 'Open'}
            </StatusPill>
          ) : null}
        </Box>
      </Box>

      <Box
        sx={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))',
          gap: 3,
        }}
      >
        <KpiTile label="Scheduled h" value={Math.round(scheduledHours)} note="in this pay period" />
        <KpiTile label="Worked h" value={Math.round(workedHours)} note="recorded" />
        <KpiTile
          label="Overtime h"
          value={Math.round(
            rows.reduce(
              (total, row) =>
                total + Math.max(0, row.hours - (period?.overtimeThresholdHours ?? 80)),
              0,
            ),
          )}
          note="P-01"
        />
        <KpiTile
          label="Shifts needing actuals"
          value={needingActuals.length}
          note={needingActuals.length > 0 ? 'record these before locking' : 'all recorded'}
        />
        <KpiTile
          label="Short extensions"
          value={shortExtensions.length}
          note="under 30 min, unpaid (P-04)"
        />
      </Box>

      {message ? (
        <Box
          role="status"
          sx={{
            p: '10px 12px',
            borderRadius: '8px',
            backgroundColor: colour.status.info.bg,
            color: colour.status.info.text,
            fontSize: 13,
            fontWeight: 600,
          }}
        >
          {message}
        </Box>
      ) : null}

      {missingShifts.length > 0 ? (
        <Box
          sx={{
            backgroundColor: colour.status.block.bg,
            color: colour.status.block.text,
            borderRadius: '8px',
            p: '12px 16px',
            display: 'flex',
            flexDirection: 'column',
            gap: 1,
          }}
        >
          <Typography sx={{ fontSize: 14, fontWeight: 700 }}>
            {`${missingShifts.length} shift${missingShifts.length === 1 ? '' : 's'} with no actual recorded`}
          </Typography>
          <Box component="ul" sx={{ m: 0, pl: 4, fontSize: 13 }}>
            {missingShifts.map((entry) => {
              const known = visible.some((item) => item.assignmentId === entry.assignmentId);
              return (
                <li key={entry.assignmentId}>
                  {known ? (
                    <Box
                      component="button"
                      type="button"
                      onClick={() => locateMissing(entry.assignmentId)}
                      sx={{
                        p: 0,
                        border: 0,
                        background: 'transparent',
                        font: 'inherit',
                        color: 'inherit',
                        textDecoration: 'underline',
                        cursor: 'pointer',
                        minHeight: 24,
                      }}
                    >
                      {entry.employeeName} · {entry.start.slice(0, 10)} {entry.start.slice(11, 16)}
                    </Box>
                  ) : (
                    <>
                      {entry.employeeName} · {entry.start.slice(0, 10)} {entry.start.slice(11, 16)}
                    </>
                  )}
                </li>
              );
            })}
          </Box>
        </Box>
      ) : null}

      <Box
        sx={{
          display: 'flex',
          flexWrap: 'wrap',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 3,
        }}
      >
        <Box sx={{ flex: '1 1 320px', fontSize: 13, color: colour.text.secondary }}>
          {locked
            ? 'This pay period is locked, so the actuals are read-only. Unlock it with a reason to make changes.'
            : 'Pick a past shift in the grid to record what actually happened.'}
        </Box>
        <Box
          sx={{
            display: 'flex',
            flexWrap: 'wrap',
            alignItems: 'center',
            gap: 3,
            backgroundColor: colour.bg.surface,
            border: `1px solid ${colour.border.default}`,
            borderRadius: '10px',
            p: 2.5,
          }}
        >
          {locked ? (
            <>
              <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
                <Button variant="contained" color="primary" onClick={() => void exportPayroll()}>
                  Payroll export (CSV)
                </Button>
                {period?.lastExport ? (
                  <Box component="span" sx={{ fontSize: 12, color: colour.text.secondary }}>
                    Last export {period.lastExport.at} · hash {period.lastExport.fileHash}
                  </Box>
                ) : null}
              </Box>
              <Button variant="outlined" color="primary" onClick={() => setUnlockOpen(true)}>
                Unlock…
              </Button>
            </>
          ) : (
            <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
              <Button
                variant="contained"
                color="primary"
                disabled={needingActuals.length > 0}
                onClick={() => setLockOpen(true)}
              >
                Lock pay period
              </Button>
              {needingActuals.length > 0 ? (
                <Box component="span" sx={{ fontSize: 12, color: colour.text.secondary }}>
                  Record {needingActuals.length} missing actual
                  {needingActuals.length === 1 ? '' : 's'} first
                </Box>
              ) : null}
            </Box>
          )}
        </Box>
      </Box>

      {entriesState.kind === 'loading' ? (
        <Typography sx={{ fontSize: 14, color: colour.text.secondary }} role="status">
          Loading the time entries…
        </Typography>
      ) : (
        <TimeGrid
          rows={rows}
          days={days}
          locked={locked ?? false}
          onPick={(entry) => {
            setPicked(entry);
            setSaved(null);
          }}
        />
      )}

      <Drawer
        anchor="right"
        open={picked !== null}
        onClose={() => {
          setPicked(null);
          setSaved(null);
        }}
      >
        <Box sx={{ width: { xs: '100vw', sm: 420 }, p: 3 }}>
          {picked ? (
            <RecordActualPanel
              entry={picked}
              result={saved ?? undefined}
              onSave={(input) => void recordActual(input)}
              onCancel={() => {
                setPicked(null);
                setSaved(null);
              }}
            />
          ) : null}
        </Box>
      </Drawer>

      {period ? (
        <LockPeriodDialog
          open={lockOpen}
          period={period}
          onClose={() => setLockOpen(false)}
          onConfirm={() => void lockPeriod()}
        />
      ) : null}

      <UnlockDialog
        open={unlockOpen}
        onClose={() => setUnlockOpen(false)}
        onConfirm={(reason) => void unlockPeriod(reason)}
      />
    </>
  );
}
