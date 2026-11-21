import { useCallback, useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Card from '@mui/material/Card';
import CardContent from '@mui/material/CardContent';
import Checkbox from '@mui/material/Checkbox';
import Dialog from '@mui/material/Dialog';
import DialogActions from '@mui/material/DialogActions';
import DialogContent from '@mui/material/DialogContent';
import DialogTitle from '@mui/material/DialogTitle';
import FormControlLabel from '@mui/material/FormControlLabel';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';

import { api, ApiError } from '../api/client';
import type {
  PlannerCommitPreview,
  PlannerCommitResult,
  PlannerDraft,
  PlannerGap,
  PlannerPlan,
  PlannerScorecard,
  PlannerWarningGroup,
  PlannerCompare,
} from '../api/types';
import { KpiTile } from '../planning/KpiTile';
import { PlannerRosterTab } from './PlannerRosterTab';
import { useRole } from '../shell/nav';
import { StatusPill } from '../components/StatusPill';
import { colour } from '../theme/tokens';

const BLOCK_WORDS: Record<string, string> = {
  DAY: 'Day 07–15',
  EVENING: 'Evening 15–23',
  NIGHT: 'Night 23–07',
};

const PATTERN_WORDS: Record<string, string> = {
  ROTATING_5_2: 'Rotating 5 on, 2 off (weekends rotate)',
  '5_ON_2_OFF': 'Fixed 5 on, 2 off',
  '7_ON_3_OFF': '7 on, 3 off',
};

const TILE_HELP: Record<string, string> = {
  'Coverage gaps':
    'A block (Day 07–15, Evening 15–23, Night 23–07) is short when any hour in it has fewer officers than the unit needs. The planner never breaks a blocking rule to fill a gap, so the gap stays visible for overtime or a supervisor to fill. See the Gaps tab.',
  'Rule warnings':
    "Every shift in the draft passed the same rule check as the planning board. Shifts a rule blocks are never placed; they become gaps. Warnings don't stop a plan, but you'll be asked to accept the list when you commit.",
  'Preferences met':
    'Officers can ask for a shift length, a time of day and days off. These are wishes, not guarantees: the planner meets them where staffing and the rules allow.',
  'Night fairness':
    'Night shifts are 8 h nights, 12 h 00–12 shifts and 16 h shifts. In each unit, officers who asked for nights get them first, most senior first. The rest go to the newest officers first. A senior officer works nights they did not ask for only when no newer officer in the unit can take the shift.',
  'Overtime built in':
    'Hours over 80 in a two-week pay period are paid as overtime. 8-hour officers work 5 on, 2 off: exactly 80 hours. 12-hour patterns give 72 to 96 hours a pay period and 16-hour patterns 64 to 80, so some overtime is built in before anyone picks up an extra shift.',
  'Generated in':
    "The planner follows fixed steps; it isn't AI. The same seed and the same data always give the same plan, so a plan can be checked and repeated.",
};

const KIND_WORDS: Record<string, string> = {
  SHIFT_LENGTH: 'Shift length',
  TIME_OF_DAY: 'Time of day',
  DAYS_OFF: 'Days off',
};

function shortDay(date: string): string {
  const parsed = new Date(`${date}T00:00:00Z`);
  const dow = new Intl.DateTimeFormat('en-CA', { weekday: 'short', timeZone: 'UTC' }).format(parsed);
  const day = new Intl.DateTimeFormat('en-CA', { day: 'numeric', timeZone: 'UTC' }).format(parsed);
  const month = new Intl.DateTimeFormat('en-CA', { month: 'short', timeZone: 'UTC' }).format(parsed);
  return `${dow} ${day} ${month}`;
}

/** "4 Jan – 11 Apr 2027". */
function windowWords(from: string, to: string): string {
  const start = new Date(`${from}T00:00:00Z`);
  const end = new Date(`${to}T00:00:00Z`);
  const day = (value: Date) =>
    new Intl.DateTimeFormat('en-CA', { day: 'numeric', timeZone: 'UTC' }).format(value);
  const month = (value: Date) =>
    new Intl.DateTimeFormat('en-CA', { month: 'short', timeZone: 'UTC' }).format(value);
  const year = (value: Date) =>
    new Intl.DateTimeFormat('en-CA', { year: 'numeric', timeZone: 'UTC' }).format(value);
  return `${day(start)} ${month(start)} – ${day(end)} ${month(end)} ${year(end)}`;
}

/** "1.4 s" for a millisecond figure. */
/** "21 Nov, 09:14": one format for generated/committed lines (Regina time). */
function whenWords(instant: string): string {
  const parsed = new Date(instant);
  if (Number.isNaN(parsed.getTime())) return instant;
  const zone = 'America/Regina';
  const day = new Intl.DateTimeFormat('en-CA', { day: 'numeric', timeZone: zone }).format(parsed);
  const month = new Intl.DateTimeFormat('en-CA', { month: 'short', timeZone: zone }).format(parsed);
  const time = new Intl.DateTimeFormat('en-CA', {
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
    timeZone: zone,
  }).format(parsed);
  return `${day} ${month}, ${time}`;
}

/** The six demo units by api code, for links and warnings that carry a code. */
const UNIT_NAMES: Record<string, string> = {
  A: 'Unit A',
  B: 'Unit B',
  C: 'Unit C',
  ADM: 'Admissions',
  CTL: 'Control',
  ESC: 'Escort & transport',
};

function unitWords(code: string): string {
  return UNIT_NAMES[code] ?? code;
}

function seconds(ms: number): string {
  return `${(ms / 1000).toFixed(1)} s`;
}

type Tab = 'scorecard' | 'gaps' | 'roster' | 'compare';

export function PlannerPage() {
  const { role } = useRole();
  const navigate = useNavigate();
  const [plan, setPlan] = useState<PlannerPlan | null>(null);
  const [state, setState] = useState<'loading' | 'ready' | 'error'>('loading');
  const [message, setMessage] = useState<string | null>(null);
  const [searchParams, setSearchParams] = useSearchParams();
  // The tab lives in the address (docs/ui/planner.md §1), so a gap's "Show
  // week" link and the browser's Back land on the tab that was open.
  const tabParam = searchParams.get('tab');
  const tab: Tab =
    tabParam === 'gaps' || tabParam === 'roster' || tabParam === 'compare' ? tabParam : 'scorecard';
  const setTab = (next: Tab) => {
    const params = new URLSearchParams(searchParams);
    params.set('tab', next);
    setSearchParams(params, { replace: true });
  };
  const [seed, setSeed] = useState('');
  const [pattern, setPattern] = useState('ROTATING_5_2');
  const [busy, setBusy] = useState<null | 'generate' | 'commit' | 'discard'>(null);
  const [explain, setExplain] = useState<string | null>(null);
  const [explainGroup, setExplainGroup] = useState<string | null>(null);
  const [gaps, setGaps] = useState<PlannerGap[]>([]);
  const [warnings, setWarnings] = useState<PlannerWarningGroup[]>([]);
  const [compare, setCompare] = useState<PlannerCompare | null>(null);
  const [gapUnit, setGapUnit] = useState('');
  const [gapBlock, setGapBlock] = useState('');
  const [units, setUnits] = useState<{ id: string; name: string }[]>([]);
  const [commitOpen, setCommitOpen] = useState(false);
  const [preview, setPreview] = useState<PlannerCommitPreview | null>(null);
  const [accepted, setAccepted] = useState(false);
  const [committed, setCommitted] = useState<PlannerCommitResult | null>(null);
  const [discardOpen, setDiscardOpen] = useState(false);
  const [refusal, setRefusal] = useState<{ title: string; body: string; detail?: string } | null>(null);
  const [replaceOpen, setReplaceOpen] = useState(false);

  const load = useCallback(async () => {
    try {
      const next = await api.getPlannerPlan();
      setPlan(next);
      setSeed(String(next.defaultSeed));
      setPattern(next.patterns8h?.[0] ?? 'ROTATING_5_2');
      setState('ready');
      const readable = next.draft ?? next.committedDraft ?? null;
      if (readable) {
        const [gapRows, warningRows, comparison] = await Promise.all([
          api.getPlannerGaps(readable.id),
          api.getPlannerWarnings(readable.id),
          api.getPlannerCompare(readable.id),
        ]);
        setGaps(gapRows);
        setWarnings(warningRows);
        setCompare(comparison);
      } else {
        setGaps([]);
        setWarnings([]);
      }
    } catch {
      setState('error');
      setMessage('The quarter plan could not be loaded.');
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  // The roster's unit picker: the same units the board offers.
  useEffect(() => {
    let active = true;
    void api
      .getUnits()
      .then((loaded) => {
        if (active) setUnits(loaded.map((unit) => ({ id: unit.id, name: unit.name })));
      })
      .catch(() => {
        if (active) setUnits([]);
      });
    return () => {
      active = false;
    };
  }, []);

  const draft: PlannerDraft | null = plan?.draft ?? null;
  // A committed plan has no open draft; its summary carries the same scorecard
  // and its id answers the read-only tabs (dev-build's committed-plan API).
  const planDraft: PlannerDraft | null = draft ?? plan?.committedDraft ?? null;
  const scorecard: PlannerScorecard | null = planDraft?.scorecard ?? null;
  const planCommitted = plan?.state === 'COMMITTED';

  if (role.id !== 'PLANNER') {
    return (
      <>
        <Typography variant="h1">Quarter plan</Typography>
        <Card>
          <CardContent sx={{ p: 4 }}>
            <Typography sx={{ fontSize: 15, fontWeight: 600 }}>
              This account may not plan the quarter.
            </Typography>
            <Typography sx={{ fontSize: 14, color: colour.text.secondary, mt: 1 }}>
              Sign in as the facility planner to generate, review and commit a plan.
            </Typography>
          </CardContent>
        </Card>
      </>
    );
  }

  if (state === 'loading') {
    return (
      <>
        <Typography variant="h1">Quarter plan</Typography>
        <Typography role="status" sx={{ fontSize: 14, color: colour.text.secondary }}>
          Loading the quarter plan…
        </Typography>
      </>
    );
  }

  if (state === 'error' || !plan) {
    return (
      <>
        <Typography variant="h1">Quarter plan</Typography>
        <Card>
          <CardContent sx={{ p: 4, display: 'flex', flexDirection: 'column', gap: 2 }}>
            <Typography sx={{ fontWeight: 600, fontSize: 15, color: colour.status.block.text }}>
              Could not load the quarter plan
            </Typography>
            <Typography sx={{ fontSize: 14, color: colour.text.secondary }}>{message}</Typography>
            <Box>
              <Button variant="outlined" color="primary" onClick={() => void load()}>
                Try again
              </Button>
            </Box>
          </CardContent>
        </Card>
      </>
    );
  }

  const seedValue = Number(seed);
  const seedOk = Number.isInteger(seedValue) && seed.trim() !== '';

  const generate = async () => {
    if (!seedOk) return;
    setBusy('generate');
    setMessage(null);
    setRefusal(null);
    try {
      const created = await api.createPlannerDraft({
        seed: seedValue,
        ...(plan.patterns8h ? { pattern8h: pattern } : {}),
      });
      setPlan({ ...plan, draft: created, state: 'DRAFT' });
      setTab('scorecard');
      const [gapRows, warningRows, comparison] = await Promise.all([
        api.getPlannerGaps(created.id),
        api.getPlannerWarnings(created.id),
        api.getPlannerCompare(created.id),
      ]);
      setGaps(gapRows);
      setWarnings(warningRows);
      setCompare(comparison);
      setMessage(
        `Draft generated: ${created.scorecard.coverage.shortBlockDays} block-days short, ${created.scorecard.warnings.total} warnings, took ${seconds(created.generatedMs)}.`,
      );
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'The draft could not be generated.');
    } finally {
      setBusy(null);
      setReplaceOpen(false);
    }
  };

  const openCommit = async () => {
    if (!draft) return;
    setBusy('commit');
    setRefusal(null);
    try {
      setPreview(await api.getPlannerCommitPreview(draft.id));
      setAccepted(false);
      setCommitOpen(true);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'The commit preview could not be loaded.');
    } finally {
      setBusy(null);
    }
  };

  const commit = async () => {
    if (!draft || !preview) return;
    setBusy('commit');
    try {
      const result = await api.commitPlannerDraft(
        draft.id,
        preview.version,
        preview.warningCount,
      );
      setCommitted(result);
      setCommitOpen(false);
      await load();
    } catch (error) {
      setCommitOpen(false);
      const failure = error as ApiError;
      const problem = failure.problem;
      if (failure.status === 412) {
        setRefusal({
          title: 'Not committed: things changed since this draft was made.',
          body:
            'Someone committed or changed shifts in this window, or the rules changed, after the draft was generated. Nothing was written.',
          ...(problem?.detail ? { detail: problem.detail } : {}),
        });
      } else if (failure.status === 422) {
        const failures = (problem as { failures?: { unitName?: string }[] } | undefined)?.failures ?? [];
        setRefusal({
          title: `Not committed: ${failures.length || 'some'} shift${failures.length === 1 ? '' : 's'} are now blocked.`,
          body: 'Nothing was written.',
          ...(problem?.detail ? { detail: problem.detail } : {}),
        });
      } else if (failure.status === 409) {
        setRefusal({
          title: (problem?.title ?? 'Not committed: the plan changed.') as string,
          body: 'Nothing was written.',
          ...(problem?.detail ? { detail: problem.detail } : {}),
        });
      } else {
        setRefusal({
          title: 'Not committed: the plan could not be written.',
          body: 'Nothing was written. Try again.',
          ...(failure.message ? { detail: failure.message } : {}),
        });
      }
    } finally {
      setBusy(null);
    }
  };

  const discard = async () => {
    if (!draft) return;
    setBusy('discard');
    try {
      await api.discardPlannerDraft(draft.id);
      setDiscardOpen(false);
      setCommitted(null);
      setMessage('The draft was discarded. Nothing on the planning board changed.');
      await load();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'The draft could not be discarded.');
    } finally {
      setBusy(null);
    }
  };

  const status = committed
    ? {
        pill: 'pass' as const,
        text: 'Committed',
        line: `Committed ${whenWords(committed.committedAt)} by P. Planner · ${committed.shiftsWritten.toLocaleString('en-CA')} shifts written`,
      }
    : planCommitted && plan?.lastCommitted
      ? {
          pill: 'pass' as const,
          text: 'Committed',
          line: `Committed ${whenWords(plan.lastCommitted.at)} by ${plan.lastCommitted.by} · ${plan.lastCommitted.shiftsWritten.toLocaleString('en-CA')} shifts written`,
        }
      : draft
      ? {
          pill: 'warn' as const,
          text: 'Draft',
          line: `Generated ${whenWords(draft.createdAt)} by ${draft.createdBy} · seed ${draft.seed} · took ${seconds(draft.generatedMs)}`,
        }
      : {
          pill: 'info' as const,
          text: 'No draft',
          line: plan.lastCommitted
            ? `Nothing generated for this quarter yet. Last committed ${plan.lastCommitted.at} by ${plan.lastCommitted.by}.`
            : 'Nothing generated for this quarter yet.',
        };

  return (
    <>
      <Box
        sx={{
          display: 'flex',
          flexWrap: 'wrap',
          alignItems: 'flex-end',
          justifyContent: 'space-between',
          gap: 4,
        }}
      >
        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
          <Typography variant="h1">Quarter plan</Typography>
          <Typography sx={{ fontSize: 14, color: colour.text.secondary }}>
            Prairie Provincial Correctional Centre · all 6 units ·{' '}
            {windowWords(plan.window.from, plan.window.to)} · {plan.window.periods} pay periods
          </Typography>
          <Box sx={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 2 }}>
            <StatusPill tone={status.pill}>{status.text}</StatusPill>
            <Typography component="span" sx={{ fontSize: 13, color: colour.text.secondary }}>
              {status.line}
            </Typography>
          </Box>
        </Box>

        <Box sx={{ display: 'flex', flexWrap: 'wrap', alignItems: 'flex-end', gap: 2.5 }}>
          <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1, width: 150 }}>
            <TextField
              label="Seed"
              value={seed}
              onChange={(event) => setSeed(event.target.value.replace(/[^0-9]/g, ''))}
              size="small"
              helperText={seedOk ? 'Same seed, same plan.' : 'Enter a whole number'}
            />
          </Box>
          {plan.patterns8h ? (
            <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
              <Box component="label" sx={{ fontSize: 12, fontWeight: 600, color: colour.text.secondary }}>
                8-hour pattern
                <Box
                  component="select"
                  aria-label="8-hour pattern"
                  value={pattern}
                  onChange={(event: { target: { value: string } }) => setPattern(event.target.value)}
                  sx={{
                    display: 'block',
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
                  {plan.patterns8h.map((option) => (
                    <option key={option} value={option}>
                      {PATTERN_WORDS[option] ?? option}
                    </option>
                  ))}
                </Box>
              </Box>
            </Box>
          ) : null}

          {draft ? (
            <>
              <Button
                variant="outlined"
                color="primary"
                disabled={busy !== null}
                onClick={() => setDiscardOpen(true)}
              >
                Discard draft…
              </Button>
              <Button
                variant="outlined"
                color="primary"
                disabled={busy !== null || !seedOk}
                onClick={() => setReplaceOpen(true)}
              >
                Generate again
              </Button>
              <Button
                variant="contained"
                color="primary"
                disabled={busy !== null}
                onClick={() => void openCommit()}
              >
                Commit plan…
              </Button>
            </>
          ) : (
            <Button
              variant="contained"
              color="primary"
              disabled={!seedOk || busy !== null}
              onClick={() => void generate()}
            >
              {busy === 'generate' ? 'Generating…' : committed ? 'Generate a new draft' : 'Generate draft'}
            </Button>
          )}
        </Box>
      </Box>

      {busy === 'generate' ? (
        <Typography role="status" sx={{ fontSize: 14, color: colour.text.secondary }}>
          Building a plan for 100 officers and checking every shift against the rules. This usually
          takes a few seconds.
        </Typography>
      ) : null}

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

      {refusal ? (
        <Card sx={{ borderLeft: `4px solid ${colour.status.block.text}` }}>
          <CardContent sx={{ p: 4, display: 'flex', flexDirection: 'column', gap: 1.5 }}>
            <Typography role="alert" sx={{ fontWeight: 700, fontSize: 15, color: colour.status.block.text }}>
              {refusal.title}
            </Typography>
            <Typography sx={{ fontSize: 14 }}>{refusal.body}</Typography>
            {refusal.detail ? (
              <Typography sx={{ fontSize: 13, color: colour.text.secondary }}>{refusal.detail}</Typography>
            ) : null}
            <Box>
              <Button variant="outlined" color="primary" onClick={() => setRefusal(null)}>
                Dismiss
              </Button>
            </Box>
          </CardContent>
        </Card>
      ) : null}

      {committed ? (
        <Card sx={{ borderLeft: `4px solid ${colour.status.pass.text}` }}>
          <CardContent sx={{ p: 4, display: 'flex', flexDirection: 'column', gap: 2 }}>
            <Typography component="h2" sx={{ m: 0, fontSize: 17, fontWeight: 700 }}>
              Plan committed
            </Typography>
            <Typography sx={{ fontSize: 14 }}>
              Supervisors can now change shifts on the planning board. Committed{' '}
              {committed.shiftsWritten.toLocaleString('en-CA')} shifts from {committed.firstWeek}.
            </Typography>
            <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 2 }}>
              {committed.units.map((unit) => (
                <Button
                  key={unit}
                  variant="outlined"
                  color="primary"
                  onClick={() =>
                    navigate(`/planning?unit=${encodeURIComponent(unit)}&week=${committed.firstWeek}`)
                  }
                >
                  Open {unitWords(unit)} on the planning board
                </Button>
              ))}
            </Box>
          </CardContent>
        </Card>
      ) : null}

      {/* TODO(committedDraft): when GET /planner/plan sends committedDraft
          (DraftSummary | null) and gaps/warnings/compare answer for a committed
          draft id, this card becomes the read-only tabs of the committed plan.
          Until then the banner and the commit figures are all the api offers. */}
      {!planDraft && !committed && planCommitted && plan?.lastCommitted ? (
        <Card sx={{ borderLeft: `4px solid ${colour.status.pass.text}` }}>
          <CardContent sx={{ p: 4, display: 'flex', flexDirection: 'column', gap: 2 }}>
            <Typography component="h2" sx={{ m: 0, fontSize: 17, fontWeight: 700 }}>
              Plan committed
            </Typography>
            <Typography sx={{ fontSize: 14 }}>
              {plan.lastCommitted.shiftsWritten.toLocaleString('en-CA')} shifts were written by{' '}
              {plan.lastCommitted.by}. Supervisors can change them on the planning board; the
              scorecard, gaps and warnings of the committed plan open here once the api sends its
              summary.
            </Typography>
          </CardContent>
        </Card>
      ) : null}

      {!draft && !committed && !planCommitted ? (
        <Card sx={{ maxWidth: 640 }}>
          <CardContent sx={{ p: 4, display: 'flex', flexDirection: 'column', gap: 2 }}>
            <Typography sx={{ fontWeight: 700, fontSize: 16 }}>No plan for this quarter yet.</Typography>
            <Typography sx={{ fontSize: 14, color: colour.text.secondary }}>
              Generate a draft to see coverage, rule warnings, preferences and fairness before
              anything changes. A draft never reaches the planning board until you commit it.
            </Typography>
          </CardContent>
        </Card>
      ) : null}

      {planDraft ? (
        <>
          <Box role="tablist" aria-label="Quarter plan" sx={{ display: 'flex', gap: 1, borderBottom: `1px solid ${colour.border.default}` }}>
            {(
              [
                ['scorecard', 'Scorecard'],
                ['gaps', `Gaps (${planDraft.scorecard.coverage.shortBlockDays})`],
                ['roster', 'Roster'],
                ['compare', 'Compare'],
              ] as const
            ).map(([id, label]) => (
              <Box
                key={id}
                component="button"
                type="button"
                role="tab"
                id={`planner-tab-${id}`}
                aria-selected={tab === id}
                aria-controls={`planner-panel-${id}`}
                onClick={() => setTab(id)}
                sx={{
                  minHeight: 44,
                  px: 3,
                  border: 0,
                  borderBottom: tab === id ? `3px solid ${colour.brand.primary}` : '3px solid transparent',
                  backgroundColor: 'transparent',
                  color: colour.text.primary,
                  fontFamily: 'inherit',
                  fontSize: 14,
                  fontWeight: 700,
                  cursor: 'pointer',
                }}
              >
                {label}
              </Box>
            ))}
          </Box>

          {tab === 'scorecard' && scorecard ? (
            <Box role="tabpanel" id="planner-panel-scorecard" aria-labelledby="planner-tab-scorecard" sx={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              <Box sx={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 3 }}>
                {[
                  {
                    label: 'Coverage gaps',
                    value: scorecard.coverage.shortBlockDays,
                    note: `block-days short, of ${scorecard.coverage.totalBlockDays.toLocaleString('en-CA')}`,
                  },
                  {
                    label: 'Rule warnings',
                    value: scorecard.warnings.total,
                    note: scorecard.warnings.note ?? 'no blocked shifts',
                  },
                  {
                    label: 'Preferences met',
                    value: `${Math.round((scorecard.preferences.met / Math.max(1, scorecard.preferences.asked)) * 100)}%`,
                    note: `${scorecard.preferences.met} of ${scorecard.preferences.asked} wishes`,
                  },
                  {
                    label: 'Night fairness',
                    value: scorecard.nights.newestFirstHeld ? 'Held' : 'Not held',
                    note: 'night shifts by seniority, below',
                  },
                  {
                    label: 'Overtime built in',
                    value: `${scorecard.overtime.hoursOver} h`,
                    note: `${scorecard.overtime.officersOver} officers over ${scorecard.overtime.thresholdHours} h in a pay period`,
                  },
                  {
                    label: 'Generated in',
                    value: seconds(scorecard.generatedMs),
                    note: `seed ${planDraft.seed}`,
                  },
                ].map((tile) => (
                  <Box key={tile.label} sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
                    <KpiTile label={tile.label} value={tile.value} note={tile.note} />
                    <Button
                      variant="text"
                      color="primary"
                      aria-expanded={explain === tile.label}
                      aria-controls="planner-tile-help"
                      onClick={() => setExplain(explain === tile.label ? null : tile.label)}
                      sx={{ alignSelf: 'flex-start', minHeight: 44, fontSize: 12 }}
                    >
                      What this means
                    </Button>
                  </Box>
                ))}
              </Box>

              {explain && TILE_HELP[explain] ? (
                <Box
                  id="planner-tile-help"
                  role="region"
                  aria-label={`What ${explain} means`}
                  sx={{
                    p: '10px 12px',
                    borderRadius: '8px',
                    backgroundColor: colour.bg.subtle,
                    fontSize: 13,
                    color: colour.text.secondary,
                  }}
                >
                  {TILE_HELP[explain]}
                </Box>
              ) : null}

              {scorecard.quarterHours || scorecard.weekends ? (
                <Typography sx={{ fontSize: 13, color: colour.text.secondary }}>
                  {scorecard.quarterHours
                    ? `Quarter hours per officer: ${scorecard.quarterHours.min} min · ${scorecard.quarterHours.avg} avg · ${scorecard.quarterHours.max} max.`
                    : ''}
                  {scorecard.weekends
                    ? ` Weekends worked: ${scorecard.weekends.min}–${scorecard.weekends.max} (average ${scorecard.weekends.avg}).`
                    : ''}
                </Typography>
              ) : null}

              <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 5, alignItems: 'flex-start' }}>
                <Card sx={{ flex: '1 1 420px' }}>
                  <CardContent sx={{ p: 4, display: 'flex', flexDirection: 'column', gap: 2 }}>
                    <Typography component="h2" sx={{ m: 0, fontSize: 16, fontWeight: 700 }}>
                      Night shifts by seniority
                    </Typography>
                    {scorecard.nights.bands.map((band) => (
                      <Box key={band.label} sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
                        <Box sx={{ display: 'flex', justifyContent: 'space-between', gap: 2, fontSize: 13 }}>
                          <span>
                            {band.label} · hired {band.hiredFrom}–{band.hiredTo} · {band.officers} officers
                          </span>
                          <strong>{band.nightShare}% of night shifts</strong>
                        </Box>
                        <Box
                          sx={{
                            height: 10,
                            borderRadius: '5px',
                            backgroundColor: colour.bg.subtle,
                            overflow: 'hidden',
                          }}
                        >
                          <Box
                            sx={{
                              width: `${band.nightShare}%`,
                              height: '100%',
                              backgroundColor: '#00558C',
                            }}
                          />
                        </Box>
                      </Box>
                    ))}
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 2 }}>
                      <StatusPill tone={scorecard.nights.newestFirstHeld ? 'pass' : 'warn'}>
                        {scorecard.nights.newestFirstHeld ? 'Held' : 'Not held'}
                      </StatusPill>
                      <Typography sx={{ fontSize: 13 }}>{scorecard.nights.check}</Typography>
                    </Box>
                  </CardContent>
                </Card>

                <Card sx={{ flex: '1 1 420px' }}>
                  <CardContent sx={{ p: 4, display: 'flex', flexDirection: 'column', gap: 2 }}>
                    <Typography component="h2" sx={{ m: 0, fontSize: 16, fontWeight: 700 }}>
                      Preferences by kind
                    </Typography>
                    <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
                      <thead>
                        <tr>
                          {['Kind', 'Asked', 'Met', 'Not met', 'Met'].map((heading) => (
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
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {scorecard.preferences.byKind.map((entry) => {
                          const percent = Math.round((entry.met / Math.max(1, entry.asked)) * 100);
                          return (
                            <tr key={entry.kind}>
                              <td style={{ padding: '6px 8px', fontWeight: 600 }}>
                                {KIND_WORDS[entry.kind] ?? entry.kind}
                              </td>
                              <td className="num" style={{ padding: '6px 8px' }}>{entry.asked}</td>
                              <td className="num" style={{ padding: '6px 8px' }}>{entry.met}</td>
                              <td className="num" style={{ padding: '6px 8px' }}>{entry.asked - entry.met}</td>
                              <td className="num" style={{ padding: '6px 8px' }}>{percent}%</td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </CardContent>
                </Card>
              </Box>

              <Card>
                <CardContent sx={{ p: 4, display: 'flex', flexDirection: 'column', gap: 2 }}>
                  <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 2 }}>
                    <Typography component="h2" sx={{ m: 0, fontSize: 16, fontWeight: 700 }}>
                      Rule warnings by kind
                    </Typography>
                    <Button
                      variant="outlined"
                      color="primary"
                      aria-expanded={explain === 'warnings'}
                      onClick={() => setExplain(explain === 'warnings' ? null : 'warnings')}
                    >
                      {explain === 'warnings'
                        ? 'Hide the warnings'
                        : `Show ${scorecard.warnings.total} warnings`}
                    </Button>
                  </Box>
                  {explain === 'warnings'
                    ? warnings.map((group) => {
                        const open = explainGroup === group.ruleName;
                        return (
                          <Box key={group.ruleName} sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
                            <Button
                              variant="text"
                              color="primary"
                              aria-expanded={open}
                              onClick={() => setExplainGroup(open ? null : group.ruleName)}
                              sx={{ alignSelf: 'flex-start', justifyContent: 'flex-start', minHeight: 44, fontWeight: 700 }}
                            >
                              {group.ruleName} · {group.count}
                            </Button>
                            {open
                              ? group.items.map((item, index) => (
                                  <Typography
                                    key={`${item.unitCode}-${item.date}-${index}`}
                                    sx={{ fontSize: 13, color: colour.text.secondary }}
                                  >
                                    {unitWords(item.unitCode)} · {shortDay(item.date)} · {item.employeeName} · {item.message}
                                  </Typography>
                                ))
                              : null}
                          </Box>
                        );
                      })
                    : null}
                </CardContent>
              </Card>
            </Box>
          ) : null}

          {tab === 'gaps' ? (
            <Box role="tabpanel" id="planner-panel-gaps" aria-labelledby="planner-tab-gaps">
              <Card>
                <CardContent sx={{ p: 4, display: 'flex', flexDirection: 'column', gap: 2 }}>
                  <Typography sx={{ fontSize: 14 }}>
                    {gaps.length} block-days are short. The planner left them open rather than break a
                    blocking rule.
                  </Typography>
                  <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 2 }}>
                    <Box component="label" sx={{ display: 'flex', flexDirection: 'column', gap: 1, fontSize: 12, fontWeight: 600, color: colour.text.secondary }}>
                      Unit
                      <Box
                        component="select"
                        aria-label="Filter by unit"
                        value={gapUnit}
                        onChange={(event: { target: { value: string } }) => setGapUnit(event.target.value)}
                        sx={{ minHeight: 44, px: 3, border: `1px solid ${colour.border.input}`, borderRadius: '2px', fontFamily: 'inherit', fontSize: 14, color: colour.text.primary, backgroundColor: colour.bg.surface }}
                      >
                        <option value="">All units</option>
                        {Array.from(new Set(gaps.map((gap) => gap.unitName))).map((name) => (
                          <option key={name} value={name}>{name}</option>
                        ))}
                      </Box>
                    </Box>
                    <Box component="label" sx={{ display: 'flex', flexDirection: 'column', gap: 1, fontSize: 12, fontWeight: 600, color: colour.text.secondary }}>
                      Block
                      <Box
                        component="select"
                        aria-label="Filter by block"
                        value={gapBlock}
                        onChange={(event: { target: { value: string } }) => setGapBlock(event.target.value)}
                        sx={{ minHeight: 44, px: 3, border: `1px solid ${colour.border.input}`, borderRadius: '2px', fontFamily: 'inherit', fontSize: 14, color: colour.text.primary, backgroundColor: colour.bg.surface }}
                      >
                        <option value="">All blocks</option>
                        <option value="DAY">Days</option>
                        <option value="EVENING">Evenings</option>
                        <option value="NIGHT">Nights</option>
                      </Box>
                    </Box>
                  </Box>
                  <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
                    <thead>
                      <tr>
                        {['Unit', 'Date', 'Block', 'Staffed / needed', 'Why', ''].map((heading) => (
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
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {gaps
                        .filter((gap) => (gapUnit ? gap.unitName === gapUnit : true))
                        .filter((gap) => (gapBlock ? gap.block === gapBlock : true))
                        .map((gap) => (
                        <tr key={`${gap.unitId}-${gap.date}-${gap.block}`}>
                          <td style={{ padding: '6px 8px', fontWeight: 600 }}>{gap.unitName}</td>
                          <td style={{ padding: '6px 8px' }}>{shortDay(gap.date)}</td>
                          <td style={{ padding: '6px 8px' }}>{BLOCK_WORDS[gap.block] ?? gap.block}</td>
                          <td className="num" style={{ padding: '6px 8px' }}>
                            {gap.placed} / {gap.required}
                          </td>
                          <td style={{ padding: '6px 8px', color: colour.text.secondary }}>
                            {gap.reason ?? '—'}
                          </td>
                          <td style={{ padding: '6px 8px' }}>
                            <Button
                              variant="outlined"
                              color="primary"
                              aria-label={`Show week of ${gap.date} for ${gap.unitName}`}
                              onClick={() => navigate(`/planner?tab=roster&unit=${gap.unitId}&week=${gap.date}`)}
                            >
                              Show week
                            </Button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  {gaps.length === 0 ? (
                    <Typography sx={{ fontSize: 14, color: colour.status.pass.text }}>
                      No coverage gaps. Every hour of every block meets its staffing.
                    </Typography>
                  ) : null}
                </CardContent>
              </Card>
            </Box>
          ) : null}

          {tab === 'compare' ? (
            <Box role="tabpanel" id="planner-panel-compare" aria-labelledby="planner-tab-compare">
              <Card>
                <CardContent sx={{ p: 4, display: 'flex', flexDirection: 'column', gap: 3 }}>
                  {compare?.basis ? (
                    <Typography sx={{ fontSize: 13, color: colour.text.secondary }}>
                      {compare.basis}
                    </Typography>
                  ) : null}
                  <Typography sx={{ fontSize: 14 }}>
                    {compare && compare.committedShifts === 0
                      ? `Nothing is on the planning board for ${windowWords(plan.window.from, plan.window.to)} yet. Committing writes the whole draft.`
                      : `The draft against the plan already on the board for ${windowWords(plan.window.from, plan.window.to)}.`}
                  </Typography>
                  <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
                    <thead>
                      <tr>
                        {['Measure', 'On the board now', 'Draft', 'Change'].map((heading) => (
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
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {(compare?.rows ?? []).map((row) => {
                        const change = row.draft - row.board;
                        const better =
                          row.direction === 'NEUTRAL' || change === 0
                            ? null
                            : row.direction === 'LOWER_IS_BETTER'
                              ? change < 0
                              : change > 0;
                        const unitWord = row.unit === 'hours' ? ' h' : row.unit === 'percent' ? ' pts' : '';
                        return (
                          <tr key={row.key}>
                            <td style={{ padding: '6px 8px', fontWeight: 600 }}>{row.label}</td>
                            <td className="num" style={{ padding: '6px 8px' }}>
                              {row.board.toLocaleString('en-CA')}
                              {unitWord}
                            </td>
                            <td className="num" style={{ padding: '6px 8px' }}>
                              {row.draft.toLocaleString('en-CA')}
                              {unitWord}
                            </td>
                            <td style={{ padding: '6px 8px' }}>
                              {change === 0 ? (
                                <span style={{ color: colour.text.secondary }}>same</span>
                              ) : better === null ? (
                                <span className="num">
                                  {change > 0 ? '+' : ''}
                                  {change}
                                  {unitWord}
                                </span>
                              ) : (
                                <StatusPill tone={better ? 'pass' : 'warn'}>
                                  {better ? 'better' : 'worse'}
                                </StatusPill>
                              )}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </CardContent>
              </Card>
            </Box>
          ) : null}

          {tab === 'roster' ? (
            <Box role="tabpanel" id="planner-panel-roster" aria-labelledby="planner-tab-roster">
              <PlannerRosterTab
                draftId={planDraft.id}
                window={plan.window}
                gaps={gaps}
                units={units}
                unitParam={searchParams.get('unit')}
                weekParam={searchParams.get('week')}
                onChange={(next) => {
                  const params = new URLSearchParams(searchParams);
                  if (next.unit) params.set('unit', next.unit);
                  if (next.week) params.set('week', next.week);
                  params.set('tab', 'roster');
                  setSearchParams(params, { replace: true });
                }}
              />
            </Box>
          ) : null}
        </>
      ) : null}

      <Dialog open={replaceOpen} onClose={() => setReplaceOpen(false)} maxWidth="xs" fullWidth>
        <DialogTitle sx={{ fontSize: 18, fontWeight: 700 }}>Replace this draft?</DialogTitle>
        <DialogContent>
          <Typography sx={{ fontSize: 14 }}>
            The current draft and its scorecard are replaced. Nothing on the planning board changes.
          </Typography>
        </DialogContent>
        <DialogActions sx={{ px: 3, pb: 3 }}>
          <Button variant="outlined" color="primary" onClick={() => setReplaceOpen(false)}>
            Cancel
          </Button>
          <Button variant="contained" color="primary" disabled={busy !== null} onClick={() => void generate()}>
            Replace draft
          </Button>
        </DialogActions>
      </Dialog>

      <Dialog open={discardOpen} onClose={() => setDiscardOpen(false)} maxWidth="xs" fullWidth>
        <DialogTitle sx={{ fontSize: 18, fontWeight: 700 }}>Discard this draft?</DialogTitle>
        <DialogContent>
          <Typography sx={{ fontSize: 14 }}>
            The draft is removed. Nothing on the planning board changes. The discard is recorded in
            the audit log.
          </Typography>
        </DialogContent>
        <DialogActions sx={{ px: 3, pb: 3 }}>
          <Button variant="outlined" color="primary" onClick={() => setDiscardOpen(false)}>
            Cancel
          </Button>
          <Button variant="outlined" color="primary" disabled={busy !== null} onClick={() => void discard()}>
            Discard draft
          </Button>
        </DialogActions>
      </Dialog>

      <Dialog open={commitOpen} onClose={() => setCommitOpen(false)} maxWidth="md" fullWidth>
        <DialogTitle sx={{ fontSize: 18, fontWeight: 700 }}>Commit the quarter plan?</DialogTitle>
        <DialogContent sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
          {preview ? (
            <>
              <Typography sx={{ fontSize: 14 }}>
                This writes <strong>{preview.shiftsToWrite.toLocaleString('en-CA')} shifts</strong> for{' '}
                <strong>{preview.officers} officers</strong>, {windowWords(preview.from, preview.to)}, to
                the planning board.
              </Typography>
              <Typography sx={{ fontSize: 14 }}>
                Every shift is checked by the rules again as it is written. If any shift is blocked,{' '}
                <strong>nothing is written</strong>.
              </Typography>
              <Typography sx={{ fontSize: 14 }}>
                <strong>{preview.shortBlockDays} block-days stay short.</strong> Fill them from the
                Overtime board after committing.
              </Typography>
              <Typography component="h3" sx={{ m: 0, fontSize: 15, fontWeight: 700 }}>
                Rule warnings in this plan ({preview.warningCount})
              </Typography>
              {preview.warningCount > 0 ? (
              <Box
                tabIndex={0}
                role="group"
                aria-label="Rule warnings in this plan"
                sx={{ maxHeight: 280, overflowY: 'auto', border: `1px solid ${colour.border.default}`, borderRadius: '8px', p: 2 }}
              >
                {warnings.map((group) => (
                  <Box key={group.ruleName} sx={{ mb: 1.5 }}>
                    <Typography sx={{ fontSize: 13, fontWeight: 700 }}>
                      {group.ruleName} · {group.count}
                    </Typography>
                    {group.items.map((item, index) => (
                      <Typography
                        key={`${item.unitCode}-${item.date}-${index}`}
                        sx={{ fontSize: 13, color: colour.text.secondary }}
                      >
                        {unitWords(item.unitCode)} · {shortDay(item.date)} · {item.employeeName} · {item.message}
                      </Typography>
                    ))}
                  </Box>
                ))}
              </Box>
              ) : null}
              {preview.warningCount > 0 ? (
                <>
                  <FormControlLabel
                    control={<Checkbox checked={accepted} onChange={(event) => setAccepted(event.target.checked)} />}
                    label={
                      <span style={{ fontSize: 14 }}>
                        I&apos;ve read these {preview.warningCount} warnings and accept them for this plan.
                      </span>
                    }
                  />
                  <Typography sx={{ fontSize: 12, color: colour.text.secondary }}>
                    This is recorded once in the audit log with the list. It isn&apos;t an override: no
                    blocked shift is in the plan.
                  </Typography>
                </>
              ) : (
                <Typography sx={{ fontSize: 14 }}>No rule warnings in this plan.</Typography>
              )}
            </>
          ) : (
            <Typography role="status" sx={{ fontSize: 14, color: colour.text.secondary }}>
              Loading what the commit will write…
            </Typography>
          )}
        </DialogContent>
        <DialogActions sx={{ px: 3, pb: 3 }}>
          <Button variant="outlined" color="primary" onClick={() => setCommitOpen(false)}>
            Cancel
          </Button>
          <Button
            variant="contained"
            color="primary"
            disabled={busy !== null || !preview || (preview.warningCount > 0 && !accepted)}
            onClick={() => void commit()}
          >
            {busy === 'commit' ? 'Committing…' : 'Commit plan'}
          </Button>
        </DialogActions>
      </Dialog>
    </>
  );
}
