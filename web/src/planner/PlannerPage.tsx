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
  PlannerAssignmentResult,
  PlannerCommitPreview,
  PlannerCommitResult,
  PlannerDraft,
  PlannerGap,
  PlannerPlan,
  PlannerScorecard,
  PlannerWarningGroup,
  PlannerCompare,
  PlanOptions,
  StaffingReport,
  FlaggedShift,
} from '../api/types';
import { KpiTile } from '../planning/KpiTile';
import { PlannerRosterTab } from './PlannerRosterTab';
import { QualifiedStaffCard } from './QualifiedStaffCard';
import { StaffingPanel } from './StaffingPanel';
import { staffingFloorLine, staffingHelp, staffingTile } from './staffingWords';
import { FlaggedShiftsCard } from './FlaggedShiftsCard';
import { GapStrip } from './GapStrip';
import { gapRuns, partTimeCapacity, quarterWeeks, reasonWords, shortWords, staffedWords } from './quarterPlan';
import { DatasetBanner } from './DatasetBanner';
import { PlanOptionsFields } from './PlanOptionsFields';
import {
  DEFAULT_PLAN_OPTIONS,
  draftDeltaWords,
  draftFigures,
  draftOptions,
  optionsForRequest,
  planOptionsWords,
} from './planOptions';
import { useRole } from '../shell/nav';
import { StatusPill } from '../components/StatusPill';
import { colour } from '../theme/tokens';
import { plainDate, whenWords } from './plannerTime';

const BLOCK_WORDS: Record<string, string> = {
  DAY: 'Day 07–15',
  EVENING: 'Evening 15–23',
  NIGHT: 'Night 23–07',
};

const RUN_BLOCK_WORDS: Record<string, string> = {
  DAY: 'Days 07–15',
  EVENING: 'Evenings 15–23',
  NIGHT: 'Nights 23–07',
};

/** "Wed 13 Jan", or "Wed 13 – Sun 17 Jan" for a run of days. */
function runDays(from: string, to: string): string {
  if (from === to) return shortDay(from);
  const format = (date: string, options: Intl.DateTimeFormatOptions) =>
    new Intl.DateTimeFormat('en-CA', { ...options, timeZone: 'UTC' }).format(new Date(`${date}T00:00:00Z`));
  const start = `${format(from, { weekday: 'short' })} ${format(from, { day: 'numeric' })}`;
  const sameMonth = from.slice(0, 7) === to.slice(0, 7);
  return `${start}${sameMonth ? '' : ` ${format(from, { month: 'short' })}`} – ${shortDay(to)}`;
}

const TILE_HELP: Record<string, string> = {
  Staffing:
    'Needed is the number of officers each unit must employ to fill its posts every day and still cover leave. It is worked out from each unit\'s minimum staffing, its shift pattern and the leave allowance, shown in the table below. On staff counts active officers homed in the unit. A unit\'s shortfall is needed minus on staff, never below zero. A closed unit needs no one while it\'s closed.',
  'Coverage gaps':
    'A block (Day 07–15, Evening 15–23, Night 23–07) is short when any hour in it has fewer officers than the unit needs. The planner never breaks a blocking rule to fill a gap, so the gap stays visible for overtime or a supervisor to fill. See the Gaps tab.',
  'Rule warnings':
    "Every shift in the draft passed the same rule check as the planning board. Shifts a rule blocks are never placed; they become gaps. Warnings don't stop a plan, but you'll be asked to accept the list when you commit.",
  'Preferences met':
    'Officers can ask for a shift length, a time of day and days off. These are wishes, not guarantees: the planner meets them where staffing and the rules allow.',
  'Night fairness':
    'Only the 12-hour night crews work nights (D12 is days, N12 is 19:00–07:00). Officers who asked for nights get them first, most senior first; the rest of the night crew is seeded from the newest officers, so a senior officer works nights they did not ask for only when no newer officer can take the shift.',
  'Overtime built in':
    'Hours over 80 in a two-week pay period are paid as overtime. 8-hour officers work 5 on, 2 off: exactly 80 hours. 12-hour patterns give 72 to 96 hours a pay period and 16-hour patterns 64 to 80, so some overtime is built in before anyone picks up an extra shift.',
  'Qualified staff':
    'Some posts need officers with a qualification: first aid on the living units, Control in Control, Escort in Escort. This counts the shift blocks in the draft that have fewer qualified officers on duty than the unit\'s minimum. The planner does not enforce qualifications, so it does not try to fix these.',
  'Generated in':
    "The planner follows fixed steps; it isn't AI. The same seed and the same data always give the same plan, so a plan can be checked and repeated.",
};

const FTE_WORDS: Record<string, string> = {
  FULL_TIME: 'Full time',
  '0.7_TO_0.9': '0.7 to 0.9 FTE',
  'UNDER_0.7': 'Under 0.7 FTE',
  // Older labels kept so a stored scorecard still reads in words.
  PART_TIME: '0.7 to 0.9 FTE',
  CASUAL: 'Under 0.7 FTE',
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

/** The scorecard's part-time line ends with how this draft filled part-time officers. */
function fillWords(options: PlanOptions, committed: boolean): string {
  const subject = committed ? 'This plan' : 'This draft';
  if (!options.staffTypes.includes('PART_TIME')) {
    return `${subject} was made with full-time officers only, so no part-time hours were planned.`;
  }
  if (options.partTimeFill === 'UP_TO_FTE') {
    return `${subject} filled part-time officers up to their FTE target in their home unit where the rules allowed, after the gaps.`;
  }
  return 'Part-time hours are not guaranteed: each part-time officer is planned only into shifts still open in their home unit, up to their FTE target.';
}

/** "1.4 s" for a millisecond figure. */
function seconds(ms: number): string {
  return `${(ms / 1000).toFixed(1)} s`;
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

/** A sentence from the api with unit codes ("ADM coverage gaps") in names. */
function unitWordsIn(label: string): string {
  return Object.keys(UNIT_NAMES).reduce(
    (text, code) => text.replace(new RegExp(`\\b${code}\\b`, 'g'), unitWords(code)),
    label,
  );
}

type Tab = 'scorecard' | 'gaps' | 'roster' | 'compare';

export function PlannerPage() {
  const { role } = useRole();
  const navigate = useNavigate();
  const [plan, setPlan] = useState<PlannerPlan | null>(null);
  const [staffing, setStaffing] = useState<StaffingReport | null>(null);
  const [flagged, setFlagged] = useState<FlaggedShift[]>([]);
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
  const [options, setOptions] = useState<PlanOptions>(DEFAULT_PLAN_OPTIONS);
  // After Generate again: the figures against the draft it replaced.
  const [delta, setDelta] = useState<string | null>(null);
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

  const refreshStaffing = useCallback(async () => {
    try {
      setStaffing(await api.getStaffing());
    } catch {
      setStaffing(null);
    }
  }, []);

  useEffect(() => {
    let active = true;
    void api
      .getStaffing()
      .then((next) => {
        if (active) setStaffing(next);
      })
      .catch(() => {
        if (active) setStaffing(null);
      });
    void api
      .getFlaggedShifts()
      .then((next) => {
        if (active) setFlagged(next);
      })
      .catch(() => {
        if (active) setFlagged([]);
      });
    return () => {
      active = false;
    };
  }, []);

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
    setDelta(null);
    const previous =
      draft && compare ? draftFigures(draft.scorecard, compare.draftShifts) : null;
    try {
      const created = await api.createPlannerDraft({
        seed: seedValue,
        ...optionsForRequest(options),
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
      if (previous) {
        setDelta(draftDeltaWords(previous, draftFigures(created.scorecard, comparison.draftShifts)));
      }
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

  const handleDraftChanged = (result: PlannerAssignmentResult) => {
    setPlan((current) =>
      current?.draft
        ? {
            ...current,
            draft: {
              ...current.draft,
              version: result.version,
              handEdits: result.handEdits,
              editedAssignmentIds: result.editedAssignmentIds,
              scorecard: result.scorecard,
            },
          }
        : current,
    );
    setGaps(result.gaps);
    setWarnings(result.warnings);
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
      // The landing card starts again from the defaults it describes.
      setOptions(DEFAULT_PLAN_OPTIONS);
      setDelta(null);
      await load();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'The draft could not be discarded.');
    } finally {
      setBusy(null);
    }
  };

  const status = planCommitted && plan?.lastCommitted
    ? {
        // The plan state carries the exact instant; the commit response only a
        // Regina date. One format, Regina time, whichever loaded first.
        pill: 'pass' as const,
        text: 'Committed',
        line: `Committed ${whenWords(plan.lastCommitted.at)} by ${plan.lastCommitted.by} · ${plan.lastCommitted.shiftsWritten.toLocaleString('en-CA')} shifts written`,
      }
    : committed
      ? {
          pill: 'pass' as const,
          text: 'Committed',
          line: `Committed ${whenWords(committed.committedAt)} by P. Planner · ${committed.shiftsWritten.toLocaleString('en-CA')} shifts written`,
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
            ? `Nothing generated for this quarter yet. Last committed ${whenWords(plan.lastCommitted.at)} by ${plan.lastCommitted.by}.`
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
          {planDraft ? (
            <Typography data-testid="plan-options-used" sx={{ fontSize: 13, color: colour.text.secondary }}>
              Made with: {planOptionsWords(draftOptions(planDraft))}
            </Typography>
          ) : null}
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
                onClick={() => {
                  // Start from what the last draft was made with.
                  setOptions(draftOptions(draft));
                  setReplaceOpen(true);
                }}
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
          ) : planCommitted ? (
            // The api refuses a new draft in a committed quarter
            // (ALREADY_COMMITTED_WINDOW), so the landing must not offer one;
            // the demo's way back is the reset card.
            <Typography sx={{ fontSize: 13, color: colour.text.secondary, maxWidth: 460 }}>
              This quarter is committed. To plan it again, reset the demo data on About &amp;
              version.
            </Typography>
          ) : (
            <Button
              variant="contained"
              color="primary"
              disabled={!seedOk || busy !== null}
              onClick={() => void generate()}
            >
              {busy === 'generate' ? 'Generating…' : 'Generate draft'}
            </Button>
          )}
        </Box>
      </Box>

      <DatasetBanner />

      {busy === 'generate' ? (
        <Typography role="status" sx={{ fontSize: 14, color: colour.text.secondary }}>
          Building a plan for{' '}
          {staffing?.periods[0]
            ? `${staffing.periods[0].totals.filled.toLocaleString('en-CA')} officers`
            : 'every officer'}{' '}
          and checking every shift against the rules. This usually takes a few seconds.
        </Typography>
      ) : null}

      {delta ? (
        <Box
          role="note"
          aria-label="Compared with the previous draft"
          sx={{
            p: '10px 12px',
            borderRadius: '8px',
            backgroundColor: colour.bg.subtle,
            fontSize: 13,
          }}
        >
          {delta}
        </Box>
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
              {committed.shiftsWritten.toLocaleString('en-CA')} shifts from{' '}
              {plainDate(committed.firstWeek)}.
            </Typography>
            <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 2 }}>
              {[...committed.units].sort().map((unit) => (
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

      <FlaggedShiftsCard shifts={flagged} />

      {!draft && !committed && !planCommitted ? (
        <Card sx={{ maxWidth: 640 }}>
          <CardContent sx={{ p: 4, display: 'flex', flexDirection: 'column', gap: 2 }}>
            <Typography sx={{ fontWeight: 700, fontSize: 16 }}>No plan for this quarter yet.</Typography>
            <Typography sx={{ fontSize: 14, color: colour.text.secondary }}>
              Generate a draft to see coverage, rule warnings, preferences and fairness before
              anything changes. A draft never reaches the planning board until you commit it.
            </Typography>
            <Typography component="h2" sx={{ m: 0, mt: 1, fontSize: 15, fontWeight: 700 }}>
              Plan options
            </Typography>
            <Typography sx={{ fontSize: 13, color: colour.text.secondary, mt: -1 }}>
              The defaults make the same plan as before. The scorecard shows the effect of each
              choice.
            </Typography>
            <PlanOptionsFields value={options} onChange={setOptions} disabled={busy !== null} />
          </CardContent>
        </Card>
      ) : null}

      {!planDraft && staffing ? (
        <StaffingPanel report={staffing} draftGaps={null} onChanged={refreshStaffing} />
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
                  ...(scorecard.qualification
                    ? [
                        {
                          label: 'Qualified staff',
                          value: scorecard.qualification.failingBlockDays,
                          note: `block-days below the qualified minimum, of ${scorecard.qualification.checkedBlockDays.toLocaleString('en-CA')}`,
                          pill: scorecard.qualification.passes
                            ? { tone: 'info' as const, text: 'All met' }
                            : { tone: 'warn' as const, text: 'Below minimum' },
                        },
                      ]
                    : []),
                  {
                    label: 'Generated in',
                    value: seconds(scorecard.generatedMs),
                    note: `seed ${planDraft.seed}`,
                  },
                  ...(staffing
                    ? [
                        {
                          ...staffingTile(staffing),
                        },
                      ]
                    : []),
                ].map((tile) => (
                  <Box key={tile.label} sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
                    <KpiTile
                      label={tile.label}
                      value={tile.value}
                      note={tile.note}
                      tone={'tone' in tile ? tile.tone : undefined}
                      pill={'pill' in tile ? tile.pill : undefined}
                    />
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

              {staffing ? (
                <Typography sx={{ fontSize: 13, color: colour.text.secondary }}>
                  {staffingFloorLine(Math.round(staffing.leaveAllowance * 100))}
                </Typography>
              ) : null}

              {(() => {
                const partTime = partTimeCapacity(scorecard);
                if (!partTime) return null;
                const hours = (value: number) => `${value.toLocaleString('en-CA')} h`;
                return (
                  <Box
                    role="note"
                    aria-label="Unused part-time capacity"
                    sx={{
                      p: '10px 12px',
                      borderRadius: '8px',
                      // Amber only when a real share of the part-time target goes unused.
                      backgroundColor:
                        partTime.unused > partTime.target * 0.1 ? colour.status.warn.bg : colour.bg.subtle,
                      color:
                        partTime.unused > partTime.target * 0.1
                          ? colour.status.warn.text
                          : colour.text.secondary,
                      fontSize: 13,
                    }}
                  >
                    <Box component="span" sx={{ fontWeight: 700 }}>
                      Unused part-time capacity: {hours(partTime.unused)}.
                    </Box>{' '}
                    Part-time officers are planned {hours(partTime.planned)} of their {hours(partTime.target)} target
                    this quarter, while {scorecard.coverage.shortBlockDays.toLocaleString('en-CA')} block-day
                    {scorecard.coverage.shortBlockDays === 1 ? ' stays' : 's stay'} short.{' '}
                    {fillWords(draftOptions(planDraft), !draft)}
                  </Box>
                );
              })()}

              {scorecard.crossUnit ? (
                <Box
                  role="note"
                  aria-label="Gaps covered from other units"
                  sx={{
                    p: '10px 12px',
                    borderRadius: '8px',
                    backgroundColor: colour.status.info.bg,
                    color: colour.status.info.text,
                    fontSize: 13,
                  }}
                >
                  <Box component="span" sx={{ fontWeight: 700 }}>
                    {scorecard.crossUnit.gapsCovered.toLocaleString('en-CA')}{' '}
                    {scorecard.crossUnit.gapsCovered === 1 ? 'gap' : 'gaps'} covered from other units.
                  </Box>{' '}
                  {scorecard.crossUnit.shifts.toLocaleString('en-CA')}{' '}
                  {scorecard.crossUnit.shifts === 1 ? 'shift' : 'shifts'} by{' '}
                  {scorecard.crossUnit.officers.toLocaleString('en-CA')}{' '}
                  {scorecard.crossUnit.officers === 1 ? 'officer' : 'officers'} from another unit, each
                  qualified for the post and within their FTE hours; the roster marks them &quot;From&quot;
                  their unit. Measured when the draft was generated.
                </Box>
              ) : null}

              {explain && (TILE_HELP[explain] || (explain === 'Needed (at least)' && staffing)) ? (
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
                  {explain === 'Needed (at least)' && staffing
                    ? staffingHelp(Math.round(staffing.leaveAllowance * 100))
                    : TILE_HELP[explain]}
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

              {scorecard.fteBands && scorecard.fteBands.bands.length > 0 ? (
                <Card>
                  <CardContent sx={{ p: 4, display: 'flex', flexDirection: 'column', gap: 2 }}>
                    <Typography component="h2" sx={{ m: 0, fontSize: 16, fontWeight: 700 }}>
                      Hours against target by FTE band
                    </Typography>
                    <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
                      <thead>
                        <tr>
                          {['Band', 'Officers', 'Target h', 'Planned min', 'Planned avg', 'Planned max'].map(
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
                        {scorecard.fteBands.bands.map((band) => (
                          <tr key={band.band}>
                            <td style={{ padding: '6px 8px', fontWeight: 600 }}>
                              {FTE_WORDS[band.band] ?? band.band}
                            </td>
                            <td className="num" style={{ padding: '6px 8px' }}>{band.officers}</td>
                            <td className="num" style={{ padding: '6px 8px' }}>{band.targetHours}</td>
                            <td className="num" style={{ padding: '6px 8px' }}>{band.plannedMin}</td>
                            <td className="num" style={{ padding: '6px 8px' }}>{band.plannedAvg}</td>
                            <td className="num" style={{ padding: '6px 8px' }}>{band.plannedMax}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                    <Typography sx={{ fontSize: 12, color: colour.text.secondary }}>
                      {scorecard.fteBands.note}
                    </Typography>
                  </CardContent>
                </Card>
              ) : null}

              {scorecard.qualification ? (
                <QualifiedStaffCard
                  qualification={scorecard.qualification}
                  from={scorecard.qualification.from ?? plan.window.from}
                  to={scorecard.qualification.to ?? plan.window.to}
                />
              ) : null}

              {scorecard.warningNote ? (
                <Typography sx={{ fontSize: 13, color: colour.text.secondary }}>
                  {scorecard.warningNote}
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
                            {band.label}
                            {band.hiredFrom && band.hiredTo
                              ? ` · hired ${band.hiredFrom}–${band.hiredTo}`
                              : ' · hire years not shown'}{' '}
                            · {band.officers} officers
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
                    {scorecard.nights.n12NightShifts !== undefined ? (
                      <Typography sx={{ fontSize: 13 }}>
                        N12 night crew: {scorecard.nights.n12Officers ?? 0} officers ·{' '}
                        {scorecard.nights.n12NightShifts} N12 night shifts in the quarter.
                      </Typography>
                    ) : null}
                    {scorecard.nights.crewNote ? (
                      <Typography sx={{ fontSize: 12, color: colour.text.secondary }}>
                        {scorecard.nights.crewNote}
                      </Typography>
                    ) : null}
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
                              <td className="num" style={{ padding: '6px 8px' }}>
                                {entry.asked === 0 ? 'none asked' : `${percent}%`}
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </CardContent>
                </Card>

              {staffing ? (
                <StaffingPanel
                  report={staffing}
                  draftGaps={planDraft.scorecard.coverage.shortBlockDays}
                  onChanged={refreshStaffing}
                />
              ) : null}

                {scorecard.patterns && scorecard.patterns.officers.length > 0 ? (
                  <Card sx={{ flex: '1 1 420px' }}>
                    <CardContent sx={{ p: 4, display: 'flex', flexDirection: 'column', gap: 2 }}>
                      <Typography component="h2" sx={{ m: 0, fontSize: 16, fontWeight: 700 }}>
                        Shift patterns
                      </Typography>
                      <Box
                        // A scrollable region needs keyboard access (axe).
                        role="group"
                        aria-label="Shift patterns by officer"
                        tabIndex={0}
                        sx={{
                          maxHeight: 240,
                          overflowY: 'auto',
                          border: `1px solid ${colour.border.default}`,
                          borderRadius: '8px',
                        }}
                      >
                        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
                          <thead>
                            <tr>
                              {['Officer', 'Unit', 'Pattern'].map((heading) => (
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
                                    position: 'sticky',
                                    top: 0,
                                  }}
                                >
                                  {heading}
                                </th>
                              ))}
                            </tr>
                          </thead>
                          <tbody>
                            {scorecard.patterns.officers.map((officer) => (
                              <tr key={officer.employeeNo}>
                                <td style={{ padding: '6px 8px', fontWeight: 600 }}>{officer.name}</td>
                                <td style={{ padding: '6px 8px' }}>{unitWords(officer.unitCode)}</td>
                                <td style={{ padding: '6px 8px' }}>{officer.words}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </Box>
                      <Typography sx={{ fontSize: 12, color: colour.text.secondary }}>
                        {scorecard.patterns.note}
                      </Typography>
                    </CardContent>
                  </Card>
                ) : null}
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
                  {gaps.length > 0 ? (
                    <GapStrip
                      weeks={quarterWeeks(plan.window.from, plan.window.to)}
                      units={units}
                      // The strip follows the Unit and Block filters, like the runs below.
                      gaps={gaps
                        .filter((gap) => (gapUnit ? gap.unitName === gapUnit : true))
                        .filter((gap) => (gapBlock ? gap.block === gapBlock : true))}
                      onPick={(unitId, week) =>
                        navigate(`/planner?tab=roster&unit=${encodeURIComponent(unitId)}&week=${encodeURIComponent(week)}`)
                      }
                    />
                  ) : null}
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
                  {(() => {
                    const runs = gapRuns(
                      gaps
                        .filter((gap) => (gapUnit ? gap.unitName === gapUnit : true))
                        .filter((gap) => (gapBlock ? gap.block === gapBlock : true)),
                    );
                    if (runs.length === 0) return null;
                    const days = runs.reduce((sum, run) => sum + run.gaps.length, 0);
                    return (
                      <>
                        <Typography sx={{ fontSize: 13, color: colour.text.secondary }}>
                          {days} short block-day{days === 1 ? '' : 's'} in {runs.length} run
                          {runs.length === 1 ? '' : 's'}: the same unit and block on days in a row.
                        </Typography>
                        <Box sx={{ overflowX: 'auto' }}>
                          <table aria-label="Gaps grouped into runs" style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
                            <thead>
                              <tr>
                                {['Unit', 'Days', 'Block', 'Staffed / needed', 'Short by', 'Why', ''].map((heading) => (
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
                              {runs.map((run) => (
                                <tr key={`${run.unitId}-${run.block}-${run.from}`}>
                                  <td style={{ padding: '6px 8px', fontWeight: 600 }}>{run.unitName}</td>
                                  <td style={{ padding: '6px 8px', whiteSpace: 'nowrap' }}>
                                    {runDays(run.from, run.to)}
                                    <Box component="span" sx={{ display: 'block', fontSize: 12, color: colour.text.secondary }}>
                                      {run.gaps.length} day{run.gaps.length === 1 ? '' : 's'}
                                    </Box>
                                  </td>
                                  <td style={{ padding: '6px 8px', whiteSpace: 'nowrap' }}>
                                    {RUN_BLOCK_WORDS[run.block] ?? BLOCK_WORDS[run.block] ?? run.block}
                                  </td>
                                  <td className="num" style={{ padding: '6px 8px' }}>
                                    {staffedWords(run)}
                                  </td>
                                  <td className="num" style={{ padding: '6px 8px' }}>
                                    {shortWords(run)}
                                  </td>
                                  <td style={{ padding: '6px 8px', color: colour.text.secondary }}>{reasonWords(run)}</td>
                                  <td style={{ padding: '6px 8px' }}>
                                    <Button
                                      variant="outlined"
                                      color="primary"
                                      aria-label={`Show week of ${run.from} for ${run.unitName}`}
                                      onClick={() => navigate(`/planner?tab=roster&unit=${encodeURIComponent(run.unitId)}&week=${encodeURIComponent(run.from)}`)}
                                      sx={{ whiteSpace: 'nowrap' }}
                                    >
                                      Show week
                                    </Button>
                                  </td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </Box>
                      </>
                    );
                  })()}
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
                      : planCommitted
                        ? `The committed plan, measured against the board as it was for ${windowWords(plan.window.from, plan.window.to)}.`
                        : `The draft against the plan already on the board for ${windowWords(plan.window.from, plan.window.to)}.`}
                  </Typography>
                  <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
                    <thead>
                      <tr>
                        {['Measure', 'On the board now', planCommitted ? 'Committed plan' : 'Draft', 'Change'].map((heading) => (
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
                            <td style={{ padding: '6px 8px', fontWeight: 600 }}>
                              {unitWordsIn(row.label)}
                            </td>
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
                warnings={warnings}
                version={planDraft.version}
                handEdits={draft?.handEdits ?? 0}
                editable={Boolean(draft)}
                onDraftChanged={handleDraftChanged}
                onReload={() => void load()}
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

      <Dialog open={replaceOpen} onClose={() => setReplaceOpen(false)} maxWidth="sm" fullWidth>
        <DialogTitle sx={{ fontSize: 18, fontWeight: 700 }}>
          {(draft?.handEdits ?? 0) > 0 ? 'Generate a new draft?' : 'Replace this draft?'}
        </DialogTitle>
        <DialogContent>
          {(draft?.handEdits ?? 0) > 0 ? (
            <Typography sx={{ fontSize: 14 }}>
              It replaces this draft and its {draft?.handEdits} hand edit
              {draft?.handEdits === 1 ? '' : 's'}. They can&apos;t be brought back.
            </Typography>
          ) : (
            <Typography sx={{ fontSize: 14 }}>
              The current draft and its scorecard are replaced. Nothing on the planning board
              changes.
            </Typography>
          )}
          <Typography component="h3" sx={{ m: 0, mt: 2.5, mb: 1, fontSize: 15, fontWeight: 700 }}>
            Plan options
          </Typography>
          <Typography sx={{ fontSize: 13, color: colour.text.secondary, mb: 1.5 }}>
            Filled in from this draft. Change any of them, then generate.
          </Typography>
          <PlanOptionsFields
            value={options}
            onChange={setOptions}
            disabled={busy !== null}
            idPrefix="plan-options-again"
          />
        </DialogContent>
        <DialogActions sx={{ px: 3, pb: 3 }}>
          <Button variant="outlined" color="primary" onClick={() => setReplaceOpen(false)}>
            {(draft?.handEdits ?? 0) > 0 ? 'Keep this draft' : 'Cancel'}
          </Button>
          <Button variant="contained" color="primary" disabled={busy !== null} onClick={() => void generate()}>
            {(draft?.handEdits ?? 0) > 0 ? 'Replace draft and edits' : 'Replace draft'}
          </Button>
        </DialogActions>
      </Dialog>

      <Dialog open={discardOpen} onClose={() => setDiscardOpen(false)} maxWidth="xs" fullWidth>
        <DialogTitle sx={{ fontSize: 18, fontWeight: 700 }}>Discard this draft?</DialogTitle>
        <DialogContent>
          <Typography sx={{ fontSize: 14 }}>
            The draft is removed. Nothing on the planning board changes. The discard is recorded in
            the audit log.
            {(draft?.handEdits ?? 0) > 0
              ? ` Its ${draft?.handEdits} hand edit${draft?.handEdits === 1 ? ' is' : 's are'} discarded too.`
              : ''}
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
              {(draft?.handEdits ?? 0) > 0 ? (
                <Typography sx={{ fontSize: 14 }}>
                  Commit checks every shift again, hand edits included. Shifts you kept with warnings
                  go to the planning board with those warnings.
                </Typography>
              ) : null}
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
