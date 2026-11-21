import { useEffect, useState, useSyncExternalStore } from 'react';
import { Link as RouterLink, useNavigate } from 'react-router-dom';
import Box from '@mui/material/Box';

import { api, usingFixtures } from '../api/client';
import { getSession, subscribeSession } from '../api/session';
import type { Block, DisplayBlock, DisplayToday, DisplayUnit } from '../api/types';
import { destinationFor } from '../shell/destinations';
import { useRole } from '../shell/nav';
import { BLOCK_WORDS, clockTime, currentBlock, dayWords, REFRESH_MS, STALE_AFTER_MS } from './displayTime';

/**
 * The wall display (docs/ui/README.md §5.6, screens/WallDisplay.dc.html, with
 * the build-notes corrections: blocks, not shifts; counts are hourly).
 *
 * It is a shared screen in a unit office, read from across the room:
 * - counts only, never a name (the data passes a whitelist, displayPayload.ts);
 * - it refreshes every 60 s and says when it last did; if the api can't be
 *   reached, or nothing has arrived for 2.5 refreshes, it says so in large type
 *   and stops presenting the old counts as live;
 * - a shortfall is said in words and an icon, never by colour alone;
 * - every size scales with the screen, so 1920×1080 and 1366×768 fit without scrolling.
 */

const C = {
  bg: '#1E2327',
  card: '#2C3136',
  rule: '#41474D',
  text: '#FFFFFF',
  muted: '#D6E9DE',
  footer: '#C8CCD0',
  green: '#046A38',
  canola: '#FBDD40',
  grass: '#A4D65E',
  dark: '#333333',
  grassText: '#1F2A0A',
  neutral: '#5A6066',
  /** Dimmed old counts: still 4.2:1 on the card, so large text stays readable. */
  stale: '#8E959B',
};

/** A length that scales with the screen: n design pixels at 1920×1080. */
function s(n: number, min = 12): string {
  return `max(${min}px, calc(${n} * var(--u)))`;
}

type Status = { kind: 'covered' } | { kind: 'short'; by: number; when: string } | { kind: 'extra'; by: number };

function statusOf(entry: DisplayBlock): Status {
  const lowest = entry.scheduled.lowestHourly;
  if (!entry.covered) {
    const when = entry.scheduled.shortHours.map((range) => `${range.from} – ${range.to}`).join(', ');
    return { kind: 'short', by: Math.max(1, entry.required - lowest), when };
  }
  if (lowest > entry.required) return { kind: 'extra', by: lowest - entry.required };
  return { kind: 'covered' };
}

function statusWords(status: Status): string {
  if (status.kind === 'short') return `Short ${status.by} · ${status.when}`;
  if (status.kind === 'extra') return `+${status.by} extra`;
  return 'Covered';
}

// ---- Data -------------------------------------------------------------------------------------

interface DisplayState {
  data: DisplayToday | null;
  updatedAt: number | null;
  error: string | null;
}

function useDisplayToday(): DisplayState {
  const [state, setState] = useState<DisplayState>({ data: null, updatedAt: null, error: null });

  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    async function load() {
      try {
        const data = await api.getDisplayToday();
        if (!cancelled) setState({ data, updatedAt: Date.now(), error: null });
      } catch (cause) {
        if (!cancelled) {
          const message = cause instanceof Error ? cause.message : 'Unknown error';
          setState((previous) => ({ ...previous, error: message }));
        }
      } finally {
        // The next refresh waits for this one, so requests never pile up.
        if (!cancelled) timer = setTimeout(load, REFRESH_MS);
      }
    }
    void load();
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, []);

  return state;
}

function useNow(): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1_000);
    return () => clearInterval(timer);
  }, []);
  return now;
}

// ---- Pieces -----------------------------------------------------------------------------------

function Icon({ kind, size }: { kind: Status['kind'] | 'stale'; size: number }) {
  const common = {
    viewBox: '0 0 24 24',
    'aria-hidden': true,
    focusable: false,
    style: { width: s(size), height: s(size), flexShrink: 0 },
  } as const;
  if (kind === 'short' || kind === 'stale') {
    return (
      <svg {...common}>
        <path d="M12 2 1 21h22L12 2Z" fill="currentColor" />
        <path d="M11 9h2v6h-2zM11 17h2v2h-2z" fill={kind === 'stale' ? C.text : C.canola} />
      </svg>
    );
  }
  if (kind === 'extra') {
    return (
      <svg {...common}>
        <path d="M11 5h2v6h6v2h-6v6h-2v-6H5v-2h6z" fill="currentColor" />
      </svg>
    );
  }
  return (
    <svg {...common}>
      <path d="m9 16.2-4.2-4.2-1.4 1.4L9 19 21 7l-1.4-1.4z" fill="currentColor" />
    </svg>
  );
}

function Pill({ status, live }: { status: Status; live: boolean }) {
  const palette = !live
    ? { bg: C.neutral, fg: C.text }
    : status.kind === 'short'
      ? { bg: C.canola, fg: C.dark }
      : status.kind === 'extra'
        ? { bg: C.grass, fg: C.grassText }
        : { bg: C.green, fg: C.text };
  return (
    <Box
      component="span"
      sx={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: s(8),
        height: s(42),
        px: s(16),
        borderRadius: s(21),
        fontSize: s(22, 14),
        fontWeight: 700,
        whiteSpace: 'nowrap',
        backgroundColor: palette.bg,
        color: palette.fg,
      }}
    >
      <Icon kind={status.kind} size={22} />
      {live ? statusWords(status) : `Last known: ${statusWords(status)}`}
    </Box>
  );
}

function UnitCard({ entry, now, live }: { entry: DisplayUnit; now: Block; live: boolean }) {
  const current = entry.coverage.find((item) => item.block === now);
  const others = entry.coverage.filter((item) => item.block !== now);
  const currentStatus = current ? statusOf(current) : null;
  const short = currentStatus?.kind === 'short';

  return (
    <Box
      component="section"
      aria-label={entry.unit.name}
      sx={{
        display: 'flex',
        flexDirection: 'column',
        // Stale cards have no detail list, so keep the name and the number together.
        justifyContent: live ? 'space-between' : 'flex-start',
        gap: s(10),
        p: `${s(20)} ${s(24)}`,
        minWidth: 0,
        minHeight: 0,
        backgroundColor: C.card,
        borderRadius: s(20),
        border: `${s(3, 2)} solid ${live && short ? C.canola : C.rule}`,
      }}
    >
      <Box component="h2" sx={{ m: 0, fontSize: s(28), fontWeight: 700, lineHeight: 1.15 }}>
        {entry.unit.name}
      </Box>

      {current ? (
        <Box>
          <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: s(12), flexWrap: 'wrap' }}>
            <Box sx={{ display: 'flex', alignItems: 'baseline', gap: s(12) }}>
              {/* Old counts are dimmed, so from across the room they don't read as live. */}
              <Box component="span" sx={{ fontSize: s(84, 28), fontWeight: 700, lineHeight: 1, fontVariantNumeric: 'tabular-nums', color: live ? C.text : C.stale }}>
                {current.scheduled.lowestHourly} / {current.required}
              </Box>
              <Box component="span" sx={{ fontSize: s(22), color: C.muted }}>on duty</Box>
            </Box>
            {currentStatus ? <Pill status={currentStatus} live={live} /> : null}
          </Box>
        </Box>
      ) : (
        <Box sx={{ fontSize: s(24), color: C.muted }}>No requirement for this block</Box>
      )}

      {/* When stale, the per-block detail is hidden: old detail shouldn't look current, and the banner needs the room. */}
      {live ? (
      <Box component="ul" sx={{ listStyle: 'none', m: 0, p: 0, pt: s(10), borderTop: `1px solid ${C.rule}`, display: 'flex', flexDirection: 'column', gap: s(4) }}>
        {others.map((item) => {
          const status = statusOf(item);
          return (
            <Box component="li" key={item.block} sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: s(12), fontSize: s(20) }}>
              <Box component="span" sx={{ color: C.muted, whiteSpace: 'nowrap' }}>
                {BLOCK_WORDS[item.block].name} {BLOCK_WORDS[item.block].hours.slice(0, 5)}
              </Box>
              <Box component="span" sx={{ display: 'inline-flex', alignItems: 'center', gap: s(8), whiteSpace: 'nowrap', fontWeight: 700, fontVariantNumeric: 'tabular-nums', color: status.kind === 'short' ? C.canola : C.text }}>
                {item.scheduled.lowestHourly} / {item.required}
                {status.kind === 'short' ? (
                  <>
                    {/* The hours are on the card when the block is current; here the count is enough. */}
                    <Icon kind="short" size={20} />
                    {`short ${status.by}`}
                  </>
                ) : null}
              </Box>
            </Box>
          );
        })}
        <Box component="li" sx={{ display: 'flex', justifyContent: 'space-between', gap: s(12), fontSize: s(20) }}>
          <span>
            <Box component="span" sx={{ color: C.muted }}>Open shifts today </Box>
            <Box component="span" sx={{ fontWeight: 700, fontVariantNumeric: 'tabular-nums' }}>{entry.openShifts}</Box>
          </span>
          <span>
            <Box component="span" sx={{ color: C.muted }}>On overtime </Box>
            <Box component="span" sx={{ fontWeight: 700, fontVariantNumeric: 'tabular-nums' }}>{entry.officersInOvertime}</Box>
          </span>
        </Box>
      </Box>
      ) : null}
    </Box>
  );
}

function FacilityPanel({ data, now, live }: { data: DisplayToday; now: Block; live: boolean }) {
  const blocks = data.units.flatMap((entry) => entry.coverage);
  const shortNow = blocks.filter((item) => item.block === now && !item.covered).length;
  const shortTonight = blocks.filter((item) => item.block === 'NIGHT' && !item.covered).length;
  const rows: [string, number][] = [
    ['Units short right now', shortNow],
    ['Open shifts today', data.totalOpenShifts],
    ['On overtime this pay period', data.totalOfficersInOvertime],
    ['Gaps tonight', shortTonight],
  ];
  return (
    <Box component="section" aria-label="Facility today" sx={{ display: 'flex', flexDirection: 'column', gap: s(14), p: `${s(28)} ${s(32)}`, backgroundColor: C.card, borderRadius: s(20) }}>
      <Box component="h2" sx={{ m: 0, fontSize: s(28), fontWeight: 700 }}>
        {live ? 'Facility today' : 'Facility today · last known'}
      </Box>
      <Box component="dl" sx={{ m: 0, display: 'flex', flexDirection: 'column', gap: s(10) }}>
        {rows.map(([label, value]) => (
          <Box key={label} sx={{ display: 'flex', justifyContent: 'space-between', gap: s(12), fontSize: s(24) }}>
            <Box component="dt" sx={{ color: C.muted }}>{label}</Box>
            <Box component="dd" sx={{ m: 0, fontWeight: 700, fontVariantNumeric: 'tabular-nums', color: live ? C.text : C.stale }}>{value}</Box>
          </Box>
        ))}
      </Box>
      <Box sx={{ fontSize: s(20), color: C.muted, pt: s(12), borderTop: `1px solid ${C.rule}` }}>
        Counts are the lowest scheduled headcount in any hour of the block. To pick up an open shift, check ShiftCircle or see your supervisor.
      </Box>
    </Box>
  );
}

function StaleBanner({ updatedAt }: { updatedAt: number | null }) {
  return (
    <Box
      role="alert"
      sx={{
        display: 'flex',
        alignItems: 'center',
        gap: s(16),
        p: `${s(16)} ${s(24)}`,
        borderRadius: s(12),
        backgroundColor: C.canola,
        color: C.dark,
        fontSize: s(30, 16),
        fontWeight: 700,
      }}
    >
      <Icon kind="stale" size={36} />
      <span>
        {updatedAt === null
          ? `Not updating: can't reach ShiftCircle. Trying again every ${REFRESH_MS / 1000} seconds.`
          : `Not live: no update since ${clockTime(updatedAt)}. These counts may be out of date.`}
      </span>
    </Box>
  );
}

// ---- Page -------------------------------------------------------------------------------------

export function WallDisplayPage() {
  const { data, updatedAt, error } = useDisplayToday();
  const now = useNow();
  const { role } = useRole();
  const session = useSyncExternalStore(subscribeSession, getSession);
  const navigate = useNavigate();
  // The unit office TV is the one account with no way out by design: it is a
  // screen, not a workstation. Every other role needs a visible exit and Esc,
  // and the browser's own Back keeps working because leaving is a navigation
  // (observation #7).
  const canLeave = role.id !== 'DISPLAY';
  const landing =
    session.user !== null
      ? destinationFor(session.user)
      : role.id === 'AUDITOR'
        ? '/reports/coverage'
        : role.id === 'EMPLOYEE'
          ? '/me/schedule'
          : role.id === 'RULES_ADMIN' || role.id === 'RULES_APPROVER'
            ? '/rules'
            : '/planning';
  const leave = () => navigate(landing, { replace: true });

  useEffect(() => {
    if (!canLeave) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        leave();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });
  const block = currentBlock(now);
  const stale = error !== null || (updatedAt !== null && now - updatedAt > STALE_AFTER_MS);
  const live = !stale;
  const columns = data && data.units.length <= 4 ? 2 : 3;

  return (
    <Box
      sx={{
        '--u': 'min(calc(100vw / 1920), calc(100vh / 1080))',
        boxSizing: 'border-box',
        minHeight: '100vh',
        '@media (orientation: landscape)': { height: '100vh' },
        p: `${s(40)} ${s(56)}`,
        display: 'flex',
        flexDirection: 'column',
        gap: s(28),
        backgroundColor: C.bg,
        color: C.text,
        fontFamily: "'Source Sans 3', system-ui, sans-serif",
      }}
    >
      {canLeave ? (
        <Box
          component="button"
          type="button"
          onClick={leave}
          aria-label="Exit wall display"
          sx={{
            position: 'fixed',
            top: s(16, 12),
            right: s(16, 12),
            zIndex: 10,
            minHeight: 44,
            minWidth: 44,
            px: s(20, 14),
            py: s(10, 8),
            border: `2px solid ${C.canola}`,
            borderRadius: '6px',
            backgroundColor: C.canola,
            color: C.dark,
            fontFamily: 'inherit',
            fontSize: s(20, 14),
            fontWeight: 700,
            cursor: 'pointer',
            boxShadow: '0 2px 10px rgba(0, 0, 0, 0.35)',
          }}
        >
          Exit wall display
        </Box>
      ) : null}

      <Box component="header" sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: s(32), flexWrap: 'wrap' }}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: s(20) }}>
          <svg width="56" height="56" viewBox="0 0 32 32" fill="none" aria-hidden="true">
            <circle cx="16" cy="16" r="12" stroke={C.canola} strokeWidth="3" strokeDasharray="56 20" strokeLinecap="round" />
            <circle cx="16" cy="16" r="4" fill={C.text} />
          </svg>
          <Box sx={{ display: 'flex', flexDirection: 'column', gap: s(4) }}>
            <Box component="h1" sx={{ m: 0, fontSize: s(44, 20), fontWeight: 700, lineHeight: 1.1 }}>
              Today's coverage
            </Box>
            <Box component="span" sx={{ fontSize: s(24), color: C.muted }}>
              Prairie Provincial Correctional Centre · {BLOCK_WORDS[block].name} block {BLOCK_WORDS[block].hours}
            </Box>
          </Box>
          {usingFixtures ? (
            <Box component="span" sx={{ px: s(14), py: s(6), borderRadius: '2px', backgroundColor: C.canola, color: C.dark, fontSize: s(20), fontWeight: 700 }}>
              Demo fixtures
            </Box>
          ) : null}
        </Box>
        <Box sx={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: s(4) }}>
          <Box component="span" sx={{ fontSize: s(88, 28), fontWeight: 700, lineHeight: 1, fontVariantNumeric: 'tabular-nums' }}>
            {clockTime(now)}
          </Box>
          <Box component="span" sx={{ fontSize: s(24), color: C.muted }}>
            {data ? dayWords(data.asOf) : ''} · next block at {BLOCK_WORDS[block].next}
          </Box>
        </Box>
      </Box>

      {stale ? <StaleBanner updatedAt={updatedAt} /> : null}

      <Box component="main" sx={{ flex: 1, minHeight: 0, display: 'flex', gap: s(28), flexWrap: { xs: 'wrap', md: 'nowrap' } }}>
        {data ? (
          <>
            <Box
              sx={{
                flex: '1 1 0',
                minWidth: 0,
                display: 'grid',
                gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))`,
                gridAutoRows: 'minmax(0, 1fr)',
                gap: s(20),
              }}
            >
              {data.units.map((entry) => (
                <UnitCard key={entry.unit.id} entry={entry} now={block} live={live} />
              ))}
            </Box>
            <Box sx={{ width: { xs: '100%', md: s(440) }, flexShrink: 0 }}>
              <FacilityPanel data={data} now={block} live={live} />
            </Box>
          </>
        ) : error === null ? (
          <Box role="status" sx={{ fontSize: s(36, 18) }}>Loading today's coverage…</Box>
        ) : null}
      </Box>

      <Box component="footer" sx={{ display: 'flex', justifyContent: 'space-between', flexWrap: 'wrap', gap: `${s(4)} ${s(24)}`, fontSize: s(20), color: C.footer }}>
        <span>
          ShiftCircle · refreshes every {REFRESH_MS / 1000} seconds ·{' '}
          <span role="status">{updatedAt === null ? 'not updated yet' : `updated ${clockTime(updatedAt)}`}{stale ? ' · not live' : ''}</span>
          {role.id !== 'DISPLAY' ? (
            <>
              {' · '}
              <Box component={RouterLink} to="/" sx={{ color: '#B9D9EB' }}>Leave the wall display</Box>
            </>
          ) : null}
        </span>
        <span>Shared screen: counts only, no names</span>
        <span>Not an official Government of Saskatchewan service · fictional, synthetic data only</span>
      </Box>
    </Box>
  );
}
