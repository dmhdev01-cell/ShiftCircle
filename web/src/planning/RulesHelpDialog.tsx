import { useEffect, useRef, useState } from 'react';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Dialog from '@mui/material/Dialog';
import DialogActions from '@mui/material/DialogActions';
import DialogContent from '@mui/material/DialogContent';
import DialogTitle from '@mui/material/DialogTitle';
import IconButton from '@mui/material/IconButton';
import Typography from '@mui/material/Typography';
import { Link as RouterLink } from 'react-router-dom';

import { api } from '../api/client';
import type { RuleSetVersion, RuleTable, RuleTableRow } from '../api/types';
import { ruleNameFor } from '../api/shiftTemplates';
import { StatusPill } from '../components/StatusPill';
import { roles } from '../shell/roles';
import { colour } from '../theme/tokens';

/**
 * Rules help (observation 29): the outcomes, how the board uses them, and the
 * main rules read live from the published rule tables, so the legend cannot
 * drift from what the rule check applies. The planner reads only the board, so
 * it sees the outcomes and the usage line, not the tables or the Rules link.
 */

const TABLES = [
  'rest-between-shifts',
  'maximum-hours',
  'consecutive-work',
  'sixteen-hour-shifts',
  'days-off',
  'pay-classification',
] as const;

const RULE_ORDER = [
  'U-01',
  'U-02',
  'U-03',
  'U-04',
  'U-05',
  'U-08',
  'U-09',
  'U-10',
  'U-11',
  'U-12',
  'U-14',
  'P-01',
] as const;

const OUTCOMES = [
  {
    tone: 'block',
    text: 'Block',
    words:
      "The change can't be saved. A few Block rules allow an emergency override: the supervisor writes a reason of at least 10 characters, and it is audited and shown in reports. The others can never be overridden: choose someone else.",
  },
  {
    tone: 'warn',
    text: 'Warn',
    words: 'The change can be saved after you acknowledge the warning (Acknowledge and assign).',
  },
  {
    tone: 'info',
    text: 'Info',
    words: 'For information only, such as overtime status. It never stops a change.',
  },
  { tone: 'pass', text: 'Pass', words: 'The rule is met.' },
] as const;

function num(value: unknown): string {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return '?';
  return Number.isInteger(parsed) ? String(parsed) : String(parsed);
}

/** The one-line limit for a code, filled from the row's own params. */
function limitFor(code: string, params: Record<string, unknown>): string {
  switch (code) {
    case 'U-01':
      return `At least ${num(params.minRestHours)} h off in any ${num(params.windowHours)} h.`;
    case 'U-02':
      return `Aim for ${num(params.minRestHours)} h off between regular shifts.`;
    case 'U-03':
      return `At least ${num(params.minRestHours)} h off after a 16-hour shift.`;
    case 'U-04':
      return `At least ${num(params.minRestHours)} h off after an overtime extension of ${num(
        Number(params.minExtensionMinutes) / 60,
      )} h or more.`;
    case 'U-05':
      return `No more than ${num(params.maxHours)} h worked in any ${num(params.windowHours)} h.`;
    case 'U-08':
      return `No more than ${num(params.max)} work days in a row.`;
    case 'U-09':
      return `No more than ${num(params.max)} shifts of 12 hours in a row.`;
    case 'U-10':
      return `No more than ${num(params.max)} overnight 12-hour shifts in a row.`;
    case 'U-11':
      return `No more than ${num(params.maxIn7Days)} 16-hour shifts in 7 days, or ${num(
        params.maxIn28Days,
      )} in 28 days.`;
    case 'U-12':
      return `At least ${num(params.daysOff)} days off in a row in every ${num(
        params.withinDays,
      )} days.`;
    case 'U-14':
      return `Warns above ${num(params.warnAtHours)} h in 7 days; blocks above ${num(
        params.maxHours,
      )} h.`;
    case 'P-01':
      return `Hours above ${num(params.thresholdHours)} in a two-week pay period are overtime.`;
    default:
      return '';
  }
}

/** The published date in the same words as elsewhere, or the api's own text. */
function publishedWords(value: string | undefined): string {
  if (!value) return '';
  if (!/^\d{4}-\d{2}-\d{2}T/.test(value)) return value;
  return new Intl.DateTimeFormat('en-GB', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    timeZone: 'America/Regina',
  }).format(new Date(value));
}

function ResultCell({ row }: { row: RuleTableRow }) {
  const params = row.params ?? {};
  if (row.ruleCode === 'U-14') {
    return (
      <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.5 }}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
          <StatusPill tone="warn">Warn</StatusPill>
          <span>above {num(params.warnAtHours)} h</span>
        </Box>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
          <StatusPill tone="block">Block</StatusPill>
          <span>above {num(params.maxHours)} h · No override: choose someone else</span>
        </Box>
      </Box>
    );
  }
  const base =
    row.result === 'BLOCK' ? (
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
        <StatusPill tone="block">Block</StatusPill>
        <span>
          {row.override === 'EMERGENCY'
            ? 'Emergency override with a written reason'
            : 'No override: choose someone else'}
        </span>
      </Box>
    ) : row.result === 'WARN' ? (
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
        <StatusPill tone="warn">Warn</StatusPill>
        <span>Save after you acknowledge it</span>
      </Box>
    ) : (
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
        <StatusPill tone="info">Info</StatusPill>
        <span>Never stops a change</span>
      </Box>
    );
  const overtime =
    (row.ruleCode === 'U-08' || row.ruleCode === 'U-09') && params.overtimeSeverity === 'WARN' ? (
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
        <StatusPill tone="warn">Warn</StatusPill>
        <span>if overtime caused it</span>
      </Box>
    ) : null;
  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.5 }}>
      {base}
      {overtime}
    </Box>
  );
}

type LoadState =
  | { kind: 'idle' }
  | { kind: 'loading' }
  | { kind: 'ready'; tables: RuleTable[]; live: RuleSetVersion | null }
  | { kind: 'error' };

export function RulesHelpDialog({
  open,
  onClose,
  roleId,
}: {
  open: boolean;
  onClose: () => void;
  roleId: string;
}) {
  const [state, setState] = useState<LoadState>({ kind: 'idle' });
  const started = useRef(false);
  const canSeeRules = roleId === 'SUPERVISOR' || roleId === 'AUDITOR';
  const rulesLink = roles
    .find((role) => role.id === roleId)
    ?.nav.find((item) => item.label === 'Rules')?.to;

  useEffect(() => {
    // Once per page load, on the first open: the published tables do not change
    // under the planner mid-session, and the dialog stays mounted.
    if (!open || !canSeeRules || started.current) return;
    started.current = true;
    setState({ kind: 'loading' });
    void (async () => {
      try {
        const versions = await api.getRuleSets();
        const live = versions.find((version) => version.live) ?? null;
        if (!live) throw new Error('no live rule set');
        const tables = await Promise.all(
          TABLES.map((code) => api.getRuleTable(live.version, code)),
        );
        setState({ kind: 'ready', tables, live });
      } catch {
        setState({ kind: 'error' });
      }
    })();
  }, [open, canSeeRules]);

  const rows: RuleTableRow[] =
    state.kind === 'ready'
      ? RULE_ORDER.map((code) => {
          for (const table of state.tables) {
            const row = table.rows.find((entry) => entry.ruleCode === code && entry.enabled);
            if (row) return row;
          }
          return null;
        }).filter((row): row is RuleTableRow => row !== null)
      : [];

  const liveWords =
    state.kind === 'ready' && state.live
      ? `Rule tables v${state.live.version}${
          state.live.publishedAt ? ` · published ${publishedWords(state.live.publishedAt)}` : ''
        }`
      : '';

  return (
    <Dialog
      open={open}
      onClose={onClose}
      fullWidth
      maxWidth="md"
      scroll="paper"
    >
      <Box sx={{ position: 'relative' }}>
        <DialogTitle sx={{ fontSize: 18, fontWeight: 700, pr: 6 }}>Rules help</DialogTitle>
        <IconButton
          aria-label="Close rules help"
          onClick={onClose}
          sx={{ position: 'absolute', right: 8, top: 8 }}
        >
          ×
        </IconButton>
      </Box>
      <DialogContent dividers>
        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
          <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1.5 }}>
            <Typography component="h3" sx={{ m: 0, fontSize: 15, fontWeight: 600 }}>
              What the rule check tells you
            </Typography>
            {OUTCOMES.map((outcome) => (
              <Box key={outcome.text} sx={{ display: 'flex', alignItems: 'flex-start', gap: 1.5 }}>
                <Box sx={{ minWidth: 64 }}>
                  <StatusPill tone={outcome.tone}>{outcome.text}</StatusPill>
                </Box>
                <Typography sx={{ fontSize: 14 }}>{outcome.words}</Typography>
              </Box>
            ))}
          </Box>

          <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
            <Typography component="h3" sx={{ m: 0, fontSize: 15, fontWeight: 600 }}>
              How to use it
            </Typography>
            <Typography sx={{ fontSize: 14 }}>
              {roleId === 'PLANNER'
                ? 'The facility planner reads the board only. Supervisors propose shifts, and the rule check runs on every change before it is saved.'
                : 'Pick an empty cell to propose a shift. The rules are checked before anything is saved. Read the rule check: if it passes or only warns, assign the shift; if a rule blocks it, choose someone else with Find eligible officer, or use an emergency override where the rule allows one.'}
            </Typography>
          </Box>

          {canSeeRules ? (
            <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
              <Box sx={{ display: 'flex', flexWrap: 'wrap', alignItems: 'baseline', gap: 1 }}>
                <Typography component="h3" sx={{ m: 0, fontSize: 15, fontWeight: 600 }}>
                  The main rules
                </Typography>
                {liveWords ? (
                  <Typography sx={{ fontSize: 13, color: colour.text.secondary }}>
                    {liveWords}
                  </Typography>
                ) : null}
              </Box>
              {state.kind === 'loading' ? (
                <Typography role="status" sx={{ fontSize: 14, color: colour.text.secondary }}>
                  Loading the published rules…
                </Typography>
              ) : null}
              {state.kind === 'error' ? (
                <Typography role="alert" sx={{ fontSize: 14, color: colour.status.block.text }}>
                  The rule limits could not be loaded. The rule check still applies every rule when
                  you propose a shift.
                </Typography>
              ) : null}
              {state.kind === 'ready' ? (
                <>
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
                        Main rules and what happens when they fail
                      </caption>
                      <thead>
                        <tr>
                          {['Rule', 'Limit', 'Result'].map((heading) => (
                            <th
                              key={heading}
                              scope="col"
                              style={{
                                textAlign: 'left',
                                padding: '6px 8px',
                                fontSize: 12,
                                fontWeight: 600,
                                color: colour.text.secondary,
                                backgroundColor: colour.bg.subtle,
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
                          <tr key={row.ruleCode}>
                            <td style={{ padding: '6px 8px', fontWeight: 600, verticalAlign: 'top' }}>
                              {row.ruleCode} · {ruleNameFor(row.ruleCode) ?? row.ruleCode}
                            </td>
                            <td style={{ padding: '6px 8px', verticalAlign: 'top' }}>
                              {limitFor(row.ruleCode, row.params ?? {})}
                            </td>
                            <td style={{ padding: '6px 8px', verticalAlign: 'top' }}>
                              <ResultCell row={row} />
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </Box>
                  <Typography sx={{ fontSize: 13, color: colour.text.secondary }}>
                    The rule check applies every published rule, including ones not listed here.
                  </Typography>
                </>
              ) : null}
            </Box>
          ) : null}
        </Box>
      </DialogContent>
      <DialogActions sx={{ px: 3, pb: 3, justifyContent: 'space-between' }}>
        {canSeeRules && rulesLink ? (
          <Button component={RouterLink} to={rulesLink} onClick={onClose} variant="text">
            Full rules are on the Rules screen
          </Button>
        ) : (
          <span />
        )}
        <Button variant="outlined" color="primary" onClick={onClose}>
          Close
        </Button>
      </DialogActions>
    </Dialog>
  );
}
