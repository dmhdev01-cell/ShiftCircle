import { useCallback, useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Card from '@mui/material/Card';
import CardContent from '@mui/material/CardContent';
import Typography from '@mui/material/Typography';

import { api } from '../api/client';
import type { ProposalInboxCard } from '../api/types';
import { useUnits } from '../api/useUnits';
import { StatusPill } from '../components/StatusPill';
import { DISPLAY_STATE, sentWhen, shiftLine } from '../myschedule/proposalWords';
import { colour } from '../theme/tokens';
import { ProposalDetailPane } from './ProposalDetailPane';
import { unitLabel } from './inboxWords';

type ListState =
  | { kind: 'loading' }
  | { kind: 'ready'; cards: ProposalInboxCard[] }
  | { kind: 'error'; message: string };

type Filter = 'WAITING' | 'ALL';

function cardSummary(card: ProposalInboxCard, names: Map<string, string>): string {
  const shifts = `${card.itemCount} shift${card.itemCount === 1 ? '' : 's'}`;
  const inScope =
    card.itemsInScope < card.itemCount ? ` (${card.itemsInScope} on your units)` : '';
  return `${card.units.map((unit) => unitLabel(unit, names)).join(', ')} · ${shifts}${inScope}`;
}

const CARD_SHIFTS = 3;

/**
 * The card's shifts, "Sat 28 Nov · E8 15:00 – 23:00 · Unit B", so several
 * proposals from one officer can be told apart without opening each.
 */
function cardShiftLines(card: ProposalInboxCard, names: Map<string, string>): string[] {
  const shifts = card.shifts ?? [];
  const lines = shifts
    .slice(0, CARD_SHIFTS)
    .map((shift) => shiftLine(shift.workDate, shift.shiftTemplate, unitLabel(shift.unit, names)));
  if (shifts.length > CARD_SHIFTS) lines.push(`and ${shifts.length - CARD_SHIFTS} more`);
  return lines;
}

/**
 * The Proposals inbox (plan v1.3 §3.2, docs/ui/build-notes.md §2.3): officers'
 * proposed extra shifts for the supervisor of the unit, with the planner as
 * the fallback for every unit. The same two-pane pattern as the Overtime
 * board: the proposals on the left, the selected one on the right.
 */
export function ProposalsPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const [filter, setFilter] = useState<Filter>('WAITING');
  const [unitId, setUnitId] = useState('');
  const [state, setState] = useState<ListState>({ kind: 'loading' });
  const [reloadKey, setReloadKey] = useState(0);
  const units = useUnits();
  const pickedId = searchParams.get('proposal');

  useEffect(() => {
    let active = true;
    api
      .getProposalInbox({ status: filter, ...(unitId ? { unitId } : {}) })
      .then((cards) => {
        if (active) setState({ kind: 'ready', cards });
      })
      .catch((error: unknown) => {
        if (!active) return;
        setState({
          kind: 'error',
          message: error instanceof Error ? error.message : 'Could not load the proposals.',
        });
      });
    return () => {
      active = false;
    };
  }, [filter, unitId, reloadKey]);

  const cards = useMemo(() => (state.kind === 'ready' ? state.cards : []), [state]);
  // The proposal in the link stays selected even when the filter hides its
  // card (a decided one under Waiting); otherwise the first card.
  const activeId = pickedId ?? cards[0]?.id ?? null;

  const pick = useCallback(
    (id: string) => {
      const next = new URLSearchParams(searchParams);
      next.set('proposal', id);
      setSearchParams(next, { replace: true });
    },
    [searchParams, setSearchParams],
  );

  // GET /units is already the caller's scope: a supervisor's units, every unit for the planner.
  const unitOptions = units.kind === 'ready' ? units.units : [];
  const unitNames = useMemo(
    () => new Map((units.kind === 'ready' ? units.units : []).map((unit) => [unit.code, unit.name])),
    [units],
  );

  return (
    <>
      <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
        <Typography variant="h1">Proposals</Typography>
        <Typography sx={{ fontSize: 14, color: colour.text.secondary }}>
          Extra shifts officers offered to work · approving re-checks the rules now · a Blocked
          shift can&apos;t be approved from a proposal
        </Typography>
      </Box>

      {/* The filters sit above both panes, so on a tablet (detail first) they
          stay at the top instead of below the open proposal (v1.3 P4 gate). */}
      <Box sx={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 2 }}>
        <Box role="group" aria-label="Show" sx={{ display: 'flex', gap: 1 }}>
          {(['WAITING', 'ALL'] as const).map((value) => (
            <Button
              key={value}
              variant={filter === value ? 'contained' : 'outlined'}
              color="primary"
              aria-pressed={filter === value}
              onClick={() => setFilter(value)}
              sx={{ minHeight: 44 }}
            >
              {value === 'WAITING' ? 'Waiting' : 'All'}
            </Button>
          ))}
        </Box>
        <Box
          component="label"
          sx={{ display: 'flex', alignItems: 'center', gap: 1, fontSize: 13 }}
        >
          Unit
          <Box
            component="select"
            value={unitId}
            onChange={(event: React.ChangeEvent<HTMLSelectElement>) =>
              setUnitId(event.target.value)
            }
            sx={{
              minHeight: 44,
              px: 1.5,
              fontFamily: 'inherit',
              fontSize: 14,
              border: `1px solid ${colour.border.input}`,
              borderRadius: '6px',
              backgroundColor: colour.bg.surface,
              color: colour.text.primary,
            }}
          >
            <option value="">All units</option>
            {unitOptions.map((unit) => (
              <option key={unit.id} value={unit.id}>
                {unit.name}
              </option>
            ))}
          </Box>
        </Box>
      </Box>

      <Box
        sx={{
          display: 'flex',
          // On a tablet the selected proposal comes first, as on the Overtime board.
          flexDirection: { xs: 'column-reverse', md: 'row' },
          gap: 5,
          alignItems: 'flex-start',
        }}
      >
        <Box
          component="section"
          aria-label="Proposals list"
          sx={{
            flex: { xs: '1 1 auto', md: '1 1 300px' },
            width: { xs: '100%', md: 'auto' },
            minWidth: 0,
            display: 'flex',
            flexDirection: 'column',
            gap: 2.5,
          }}
        >
          {state.kind === 'loading' ? (
            <Typography role="status" sx={{ fontSize: 14, color: colour.text.secondary }}>
              Loading the proposals…
            </Typography>
          ) : null}

          {state.kind === 'error' ? (
            <Card>
              <CardContent sx={{ p: 3 }}>
                <Typography sx={{ fontWeight: 600, fontSize: 14, color: colour.status.block.text }}>
                  Could not load the proposals
                </Typography>
                <Typography sx={{ fontSize: 13, color: colour.text.secondary }}>
                  {state.message}
                </Typography>
              </CardContent>
            </Card>
          ) : null}

          {state.kind === 'ready' && cards.length === 0 ? (
            <Typography sx={{ fontSize: 14, color: colour.text.secondary, lineHeight: 1.5 }}>
              {filter === 'WAITING'
                ? 'No proposals waiting. When officers propose shifts, they appear here.'
                : 'No proposals for these units yet.'}
            </Typography>
          ) : null}

          {state.kind === 'ready' && cards.length > 0 ? (
            <Box
              component="ul"
              aria-label="Proposals"
              sx={{ listStyle: 'none', m: 0, p: 0, display: 'flex', flexDirection: 'column', gap: 2 }}
            >
              {cards.map((card) => {
                const pill = DISPLAY_STATE[card.displayState] ?? DISPLAY_STATE.WAITING;
                const isActive = card.id === activeId;
                return (
                  <li key={card.id}>
                    <Box
                      component="button"
                      type="button"
                      aria-pressed={isActive}
                      onClick={() => pick(card.id)}
                      sx={{
                        display: 'flex',
                        flexDirection: 'column',
                        gap: 1.25,
                        width: '100%',
                        minHeight: 44,
                        p: '12px 14px',
                        textAlign: 'left',
                        backgroundColor: isActive ? '#EAF3F9' : colour.bg.surface,
                        border: isActive ? `2px solid ${colour.brand.link}` : '1px solid #D5DDE7',
                        borderRadius: '10px',
                        fontFamily: 'inherit',
                        color: colour.text.primary,
                        cursor: 'pointer',
                        '&:hover': { borderColor: colour.brand.link },
                      }}
                    >
                      <Box component="span" sx={{ fontSize: 15, fontWeight: 700 }}>
                        {card.officerName}
                      </Box>
                      <Box component="span" sx={{ fontSize: 13, color: colour.text.secondary }}>
                        {cardSummary(card, unitNames)}
                      </Box>
                      {cardShiftLines(card, unitNames).map((line) => (
                        <Box key={line} component="span" sx={{ fontSize: 13, fontWeight: 600 }}>
                          {line}
                        </Box>
                      ))}
                      <Box sx={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 2 }}>
                        <StatusPill tone={pill.tone}>{pill.text}</StatusPill>
                        {card.own ? <StatusPill tone="info">Yours</StatusPill> : null}
                        <Box component="span" sx={{ fontSize: 12, color: colour.text.secondary }}>
                          Sent {sentWhen(card.submittedAt)}
                        </Box>
                      </Box>
                    </Box>
                  </li>
                );
              })}
            </Box>
          ) : null}
        </Box>

        <Box
          component="section"
          aria-label="Selected proposal"
          sx={{
            flex: { xs: '1 1 auto', md: '999 1 640px' },
            width: { xs: '100%', md: 'auto' },
            minWidth: 0,
            boxSizing: 'border-box',
            backgroundColor: colour.bg.surface,
            border: `1px solid ${colour.border.default}`,
            borderRadius: '10px',
            p: { xs: 3, sm: 4 },
          }}
        >
          {activeId ? (
            <ProposalDetailPane
              key={activeId}
              proposalId={activeId}
              onDecided={() => {
                // A decided proposal leaves the Waiting list: keep it open, so the
                // decider reads the outcome instead of the next card.
                if (!pickedId) pick(activeId);
                setReloadKey((value) => value + 1);
              }}
            />
          ) : (
            <Typography sx={{ fontSize: 14, color: colour.text.secondary }}>
              No proposal is selected.
            </Typography>
          )}
        </Box>
      </Box>
    </>
  );
}
