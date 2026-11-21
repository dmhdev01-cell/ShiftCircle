import { useEffect, useState } from 'react';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Card from '@mui/material/Card';
import CardContent from '@mui/material/CardContent';
import Typography from '@mui/material/Typography';

import { api } from '../api/client';
import type { PlannerGap, PlannerUnitCoverage, SchedulePayload } from '../api/types';
import { CoverageCell } from '../planning/CoverageCell';
import { RosterGrid } from '../planning/RosterGrid';
import { colour } from '../theme/tokens';

const BLOCKS: { block: 'DAY' | 'EVENING' | 'NIGHT'; label: string }[] = [
  { block: 'DAY', label: 'Days 07–15' },
  { block: 'EVENING', label: 'Evenings 15–23' },
  { block: 'NIGHT', label: 'Nights 23–07' },
];

function iso(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function mondayOf(date: string): string {
  const parsed = new Date(`${date}T00:00:00Z`);
  const monday = new Date(parsed);
  monday.setUTCDate(parsed.getUTCDate() - ((parsed.getUTCDay() + 6) % 7));
  return iso(monday);
}

function addDays(date: string, days: number): string {
  return iso(new Date(new Date(`${date}T00:00:00Z`).getTime() + days * 24 * 3600 * 1000));
}

function rangeWords(from: string, to: string): string {
  const start = new Date(`${from}T00:00:00Z`);
  const end = new Date(`${to}T00:00:00Z`);
  const day = (value: Date) =>
    new Intl.DateTimeFormat('en-CA', { day: 'numeric', timeZone: 'UTC' }).format(value);
  const month = (value: Date) =>
    new Intl.DateTimeFormat('en-CA', { month: 'short', timeZone: 'UTC' }).format(value);
  const year = (value: Date) =>
    new Intl.DateTimeFormat('en-CA', { year: 'numeric', timeZone: 'UTC' }).format(value);
  return `${day(start)} – ${day(end)} ${month(end)} ${year(end)}`;
}

interface PlannerRosterTabProps {
  draftId: string;
  window: { from: string; to: string };
  gaps: PlannerGap[];
  units: { id: string; name: string }[];
  unitParam: string | null;
  weekParam: string | null;
  onChange: (next: { unit?: string; week?: string }) => void;
}

/**
 * The Roster tab (docs/ui/planner.md §4.2): the draft week by week, all units,
 * read-only, in the board's own grid. A draft is not a roster, and the note
 * above the grid says so.
 */
export function PlannerRosterTab({
  draftId,
  window,
  gaps,
  units,
  unitParam,
  weekParam,
  onChange,
}: PlannerRosterTabProps) {
  const firstWeek = mondayOf(window.from);
  const lastWeek = mondayOf(window.to);
  const week = weekParam ? mondayOf(weekParam) : firstWeek;
  const unit =
    units.find((entry) => entry.id === unitParam) ??
    units.find((entry) => gaps.some((gap) => gap.unitId === entry.id && gap.date >= week && gap.date < addDays(week, 7))) ??
    units[0];

  const [payload, setPayload] = useState<SchedulePayload | null>(null);
  const [strip, setStrip] = useState<PlannerUnitCoverage[]>([]);
  const [state, setState] = useState<'loading' | 'ready' | 'error'>('loading');

  useEffect(() => {
    let active = true;
    setState('loading');
    const to = addDays(week, 6);
    void Promise.all([
      unit ? api.getPlannerSchedule(draftId, { unitId: unit.id, from: week, to }) : Promise.resolve(null),
      api.getPlannerCoverage(draftId, { from: week, to }),
    ])
      .then(([schedule, coverage]) => {
        if (!active) return;
        setPayload(schedule);
        setStrip(coverage);
        setState('ready');
      })
      .catch(() => {
        if (active) setState('error');
      });
    return () => {
      active = false;
    };
  }, [draftId, unit, week]);

  const days = Array.from({ length: 7 }, (_, index) => addDays(week, index));
  const boardWeek = { from: week, to: addDays(week, 6) };

  return (
    <Card>
      <CardContent sx={{ p: 4, display: 'flex', flexDirection: 'column', gap: 3 }}>
        <Box sx={{ display: 'flex', flexWrap: 'wrap', alignItems: 'flex-end', gap: 3 }}>
          <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1, fontSize: 12, fontWeight: 600, color: colour.text.secondary }}>
            Unit
            <Box
              component="select"
              aria-label="Unit"
              value={unit?.id ?? ''}
              onChange={(event: { target: { value: string } }) => onChange({ unit: event.target.value })}
              sx={{
                minHeight: 44,
                px: 3,
                border: `1px solid ${colour.border.input}`,
                borderRadius: '2px',
                fontFamily: 'inherit',
                fontSize: 14,
                color: colour.text.primary,
                backgroundColor: colour.bg.surface,
              }}
            >
              {units.map((entry) => (
                <option key={entry.id} value={entry.id}>
                  {entry.name}
                </option>
              ))}
            </Box>
          </Box>

          <Box role="group" aria-label="Week" sx={{ display: 'flex', alignItems: 'center', gap: 1.5, flexWrap: 'wrap' }}>
            <Button
              variant="outlined"
              color="primary"
              disabled={week <= firstWeek}
              onClick={() => onChange({ week: addDays(week, -7) })}
            >
              Previous week
            </Button>
            <Box component="span" className="num" sx={{ fontSize: 13, fontWeight: 700, minWidth: 150, textAlign: 'center' }}>
              {rangeWords(boardWeek.from, boardWeek.to)}
            </Box>
            <Button
              variant="outlined"
              color="primary"
              disabled={week >= lastWeek}
              onClick={() => onChange({ week: addDays(week, 7) })}
            >
              Next week
            </Button>
            <Button variant="outlined" color="primary" disabled={week <= firstWeek} onClick={() => onChange({ week: firstWeek })}>
              First week
            </Button>
          </Box>
        </Box>

        <Box component="section" aria-label={`All units · ${rangeWords(boardWeek.from, boardWeek.to)}`} sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
          <Typography component="h2" sx={{ m: 0, fontSize: 16, fontWeight: 700 }}>
            All units · {rangeWords(boardWeek.from, boardWeek.to)}
          </Typography>
          <Box sx={{ overflowX: 'auto' }}>
            <table style={{ borderCollapse: 'collapse', fontSize: 11, width: '100%' }}>
              <thead>
                <tr>
                  <th style={{ textAlign: 'left', padding: 4, color: colour.text.secondary, fontWeight: 600 }}>Unit</th>
                  <th style={{ textAlign: 'left', padding: 4, color: colour.text.secondary, fontWeight: 600 }}>Block</th>
                  {days.map((day) => (
                    <th key={day} style={{ textAlign: 'left', padding: 4, color: colour.text.secondary, fontWeight: 600 }}>
                      {new Intl.DateTimeFormat('en-CA', { weekday: 'short', timeZone: 'UTC' }).format(new Date(`${day}T00:00:00Z`))}{' '}
                      {Number(day.slice(8, 10))}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {strip.map((entry) =>
                  BLOCKS.map(({ block, label }, index) => (
                    <tr key={`${entry.unitId}-${block}`}>
                      <td style={{ padding: 4, fontWeight: 600, whiteSpace: 'nowrap' }}>
                        {index === 0 ? (
                          <button
                            type="button"
                            onClick={() => onChange({ unit: entry.unitId })}
                            style={{ background: 'none', border: 0, padding: 0, font: 'inherit', fontWeight: 600, cursor: 'pointer', color: colour.brand.link }}
                          >
                            {entry.unitName}
                          </button>
                        ) : null}
                      </td>
                      <td style={{ padding: 4, whiteSpace: 'nowrap', color: colour.text.secondary }}>{label}</td>
                      {days.map((day) => {
                        const cell = entry.coverage.find((item) => item.date === day && item.block === block);
                        return (
                          <td key={`${entry.unitId}-${block}-${day}`} style={{ padding: 2 }}>
                            {cell ? <CoverageCell block={cell} today={window.from} /> : null}
                          </td>
                        );
                      })}
                    </tr>
                  )),
                )}
              </tbody>
            </table>
          </Box>
        </Box>

        <Box
          role="note"
          sx={{
            p: '10px 12px',
            borderRadius: '8px',
            backgroundColor: colour.status.info.bg,
            color: colour.status.info.text,
            fontSize: 13,
            fontWeight: 600,
          }}
        >
          Draft · not on the planning board yet. Officers and supervisors can't see it until it's
          committed.
        </Box>

        {state === 'loading' ? (
          <Typography role="status" sx={{ fontSize: 14, color: colour.text.secondary }}>
            Loading the draft roster…
          </Typography>
        ) : null}
        {state === 'error' ? (
          <Typography role="alert" sx={{ fontSize: 14, color: colour.status.block.text }}>
            The draft roster could not be loaded.
          </Typography>
        ) : null}
        {state === 'ready' && payload ? (
          <RosterGrid payload={payload} today={payload.asOf} />
        ) : null}

        <Typography sx={{ fontSize: 12, color: colour.text.secondary }}>
          Rest and consecutive days at the start of the plan count the shifts already committed for
          late December.
        </Typography>
      </CardContent>
    </Card>
  );
}
