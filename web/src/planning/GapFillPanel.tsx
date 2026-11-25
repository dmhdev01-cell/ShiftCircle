import { useEffect, useRef } from 'react';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import { Link } from 'react-router-dom';

import { shiftTemplates } from '../api/shiftTemplates';
import type { BlockCoverage, OfficerRow, SchedulePayload } from '../api/types';
import { StatusPill } from '../components/StatusPill';
import { colour, coverageTones, focusRing } from '../theme/tokens';
import { BLOCK_TEMPLATES, BLOCK_WORDS, dayWords, gapCandidates } from './gapFill';
import type { PeriodHours } from './gapFill';
import { isSupervisorPost } from './supervisorPosts';

export const GAP_PANEL_HEADING_ID = 'gap-fill-heading';

interface GapFillPanelProps {
  payload: SchedulePayload;
  /** The gap as the board has it now (re-read after a save). */
  gap: BlockCoverage;
  /** The template the checks use; defaults to the block's 8 h shift. */
  template: string;
  onTemplate: (template: string) => void;
  /** Run the existing rule check for this officer on the gap's day. */
  onCheck: (officer: OfficerRow, template: string) => void;
  onClose: () => void;
  /** The Overtime board, pre-filled with the unit and the start. */
  findEligibleHref: string;
  /** Hidden (kept mounted) while the rule-check dock is open. */
  hidden?: boolean;
  /**
   * Set when the gap sits in another pay period than the board's first day (a
   * month): the hours, the OT pills and the ranking then come from that
   * period's own schedule, read separately.
   */
  period?: { label: string; state: 'loading' | 'ready' | 'error'; hours?: Map<string, PeriodHours> };
  /** v1.3 S6: the signed-in person's employee id; their own row is listed but not offered. */
  selfEmployeeId?: string;
}

/** The panel's id, for the gap buttons' aria-controls. */
export const GAP_PANEL_ID = 'gap-fill-panel';

const STATUS_PILL = {
  under: { tone: 'under', text: 'under' },
  near: { tone: 'warn', text: 'near' },
  ot: { tone: 'ot', text: 'OT' },
} as const;

/**
 * A2 (mockup 2): fill a coverage gap from the board. A side panel lists the
 * officers in the unit who are free that day, lowest pay-period hours first,
 * with the hints the board already shows. "Check & assign" runs the same rule
 * check as an empty cell; nothing here decides or saves on its own.
 */
export function GapFillPanel({
  payload,
  gap,
  template,
  onTemplate,
  onCheck,
  onClose,
  findEligibleHref,
  hidden = false,
  period,
  selfEmployeeId,
}: GapFillPanelProps) {
  const headingRef = useRef<HTMLHeadingElement>(null);
  const words = BLOCK_WORDS[gap.block];
  const lowest = gap.scheduled.lowestHourly;
  const missing = Math.max(0, gap.required - lowest);
  const met = gap.covered && gap.scheduled.shortHours.length === 0;
  const tone = met ? coverageTones.ok : missing >= 2 ? coverageTones.gap2 : coverageTones.gap;
  const periodPending = period !== undefined && period.state !== 'ready';
  const candidates =
    met || periodPending ? [] : gapCandidates(payload, gap, template, period?.hours, selfEmployeeId);
  const hoursLabel = period ? `h in pay period ${period.label}` : 'h this pay period';
  // v1.3 S6: a supervisor post's panel speaks of supervisors.
  const onPost = isSupervisorPost(payload.unit);
  const people = onPost ? 'supervisors' : 'officers';
  const shortWords = gap.scheduled.shortHours
    .map((range) => `${range.from.slice(0, 5)}–${range.to.slice(0, 5)}`)
    .join(', ');

  // Focus the heading when a gap opens, so the panel is announced and Tab
  // continues inside it.
  const gapKey = `${gap.date}-${gap.block}`;
  useEffect(() => {
    headingRef.current?.focus({ preventScroll: true });
  }, [gapKey]);

  return (
    <Box
      role="region"
      id={GAP_PANEL_ID}
      aria-labelledby={GAP_PANEL_HEADING_ID}
      hidden={hidden}
      sx={{
        position: 'fixed',
        top: 0,
        right: 0,
        bottom: 0,
        zIndex: (theme) => theme.zIndex.drawer - 1,
        width: { xs: '100%', sm: 420 },
        maxWidth: '100vw',
        boxSizing: 'border-box',
        display: hidden ? 'none' : 'flex',
        flexDirection: 'column',
        gap: 2,
        p: 3,
        overflowY: 'auto',
        backgroundColor: colour.bg.surface,
        borderLeft: `3px solid ${colour.brand.primary}`,
        boxShadow: '-10px 0 30px rgba(0, 0, 0, 0.18)',
      }}
    >
      <Box sx={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 2 }}>
        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.5 }}>
          <Box component="span" sx={{ fontSize: 12, fontWeight: 600, color: colour.text.secondary }}>
            Coverage gap
          </Box>
          <Box
            component="h2"
            id={GAP_PANEL_HEADING_ID}
            ref={headingRef}
            tabIndex={-1}
            sx={{ m: 0, fontSize: 18, fontWeight: 700, color: colour.text.primary, outline: 'none' }}
          >
            {dayWords(gap.date)} · {words.name} {words.start} – {words.end}
          </Box>
        </Box>
        <Button variant="outlined" color="primary" onClick={onClose}>
          Close
        </Button>
      </Box>

      <Box sx={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 1, fontSize: 13 }}>
        <Box
          component="span"
          className="num"
          sx={{
            px: 1,
            borderRadius: '4px',
            fontWeight: 700,
            backgroundColor: tone.bg,
            color: tone.text,
          }}
        >
          {lowest}/{gap.required}
        </Box>
        <Box component="span" sx={{ color: colour.text.secondary }}>
          {met ? (
            <strong style={{ color: colour.status.pass.text }}>Gap met</strong>
          ) : (
            <strong style={{ color: colour.text.primary }}>{missing} short</strong>
          )}{' '}
          · {payload.unit.name}
          {shortWords ? ` · short ${shortWords}` : ''}
        </Box>
      </Box>

      {met ? (
        <Box role="status" sx={{ fontSize: 14, color: colour.text.primary }}>
          This block now has the {people} it needs. Close the panel, or pick another gap on the board.
        </Box>
      ) : (
        <>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 2, flexWrap: 'wrap' }}>
            <Box component="span" sx={{ fontSize: 13, fontWeight: 600 }}>
              Shift
            </Box>
            <Box
              role="group"
              aria-label="Shift to check"
              sx={{
                display: 'inline-flex',
                border: `1px solid ${colour.brand.link}`,
                borderRadius: '2px',
                overflow: 'hidden',
              }}
            >
              {BLOCK_TEMPLATES[gap.block].map((code, index) => {
                const option = shiftTemplates[code];
                const selected = code === template;
                return (
                  <Box
                    key={code}
                    component="button"
                    type="button"
                    aria-pressed={selected}
                    onClick={() => onTemplate(code)}
                    sx={{
                      minHeight: 44,
                      px: 2,
                      border: 0,
                      borderLeft: index > 0 ? `1px solid ${colour.brand.link}` : 0,
                      fontFamily: 'inherit',
                      fontSize: 13,
                      fontWeight: 600,
                      cursor: 'pointer',
                      color: selected ? colour.text.onDark : colour.brand.link,
                      backgroundColor: selected ? colour.brand.link : colour.bg.surface,
                      '&:hover': selected ? {} : { backgroundColor: colour.bg.linkHover },
                      '&:focus-visible': {
                        outline: `3px solid ${selected ? focusRing.onDark : focusRing.onLight}`,
                        outlineOffset: '-3px',
                      },
                    }}
                  >
                    {code} {option.start.slice(0, 2)}–{option.end.slice(0, 2)}
                  </Box>
                );
              })}
            </Box>
          </Box>

          <Box sx={{ fontSize: 13, color: colour.text.secondary }}>
            <Box component="h3" sx={{ display: 'inline', m: 0, fontSize: 14, fontWeight: 700, color: colour.text.primary }}>
              Free on this board{periodPending ? '' : ` (${candidates.length})`}
            </Box>{' '}
            {onPost
              ? '· the supervisors with a shift on this post on the days shown who have nothing that day, lowest pay-period hours first, then any officer here who holds Acting supervisor. The hints are read from the board; the rule check decides.'
              : '· the officers with a shift in this unit on the days shown who have nothing that day, lowest pay-period hours first. The hints are read from the board; the rule check decides.'}
          </Box>

          {period?.state === 'loading' ? (
            <Box role="status" sx={{ fontSize: 14 }}>
              Reading the hours for pay period {period.label}…
            </Box>
          ) : period?.state === 'error' ? (
            <Box role="status" sx={{ fontSize: 14 }}>
              Could not read the hours for pay period {period.label}. Close the panel and try again,
              or use the Overtime board.
            </Box>
          ) : candidates.length === 0 ? (
            <Box sx={{ fontSize: 14 }}>
              {onPost
                ? 'No supervisor on this post is free that day. The Overtime board offers the post to the other supervisors.'
                : 'No officer on this board is free that day. The Overtime board also covers other units.'}
            </Box>
          ) : (
            <Box
              component="ul"
              aria-label={onPost ? 'Free supervisors' : 'Free officers'}
              sx={{ listStyle: 'none', m: 0, p: 0, display: 'flex', flexDirection: 'column', gap: 1.5 }}
            >
              {candidates.map(({ officer, status, hints, acting, self }) => (
                <Box
                  component="li"
                  key={officer.employeeId}
                  sx={{
                    display: 'flex',
                    flexDirection: 'column',
                    gap: 0.75,
                    p: '10px 12px',
                    border: `1px solid ${colour.border.default}`,
                    borderRadius: '6px',
                  }}
                >
                  <Box sx={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 2 }}>
                    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.5, minWidth: 0 }}>
                      <Box sx={{ fontSize: 14 }}>
                        <strong>{officer.name}</strong>{' '}
                        <Box component="span" sx={{ fontSize: 12, color: colour.text.secondary }}>
                          {officer.rotation}
                        </Box>
                      </Box>
                      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, fontSize: 13 }}>
                        <span className="num">
                          {officer.payPeriodHours} {hoursLabel}
                        </span>
                        <StatusPill tone={STATUS_PILL[status].tone} small>
                          {STATUS_PILL[status].text}
                        </StatusPill>
                        {acting ? (
                          <StatusPill tone="warn" small>
                            Acting · Warn
                          </StatusPill>
                        ) : null}
                      </Box>
                    </Box>
                    <Button
                      variant="outlined"
                      color="primary"
                      disabled={self}
                      onClick={() => onCheck(officer, template)}
                      aria-label={`Check & assign ${template}: ${officer.name}, ${dayWords(gap.date)}`}
                      sx={{ flexShrink: 0, whiteSpace: 'nowrap' }}
                    >
                      Check & assign {template}
                    </Button>
                  </Box>
                  <Box component="span" sx={{ fontSize: 12, color: colour.text.secondary }}>
                    {self ? "This is you: you can't assign your own shift; ask another supervisor or the planner · " : ''}
                    {acting ? 'Officer who holds Acting supervisor: R-01 needs acknowledgement · ' : ''}
                    {hints.length === 0
                      ? '✓ no conflict visible on the board'
                      : hints.map((hint) => `${hint.tone === 'warn' ? '⚠ ' : ''}${hint.text}`).join(' · ')}
                  </Box>
                </Box>
              ))}
            </Box>
          )}
        </>
      )}

      <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1, mt: 'auto', pt: 1 }}>
        <Box>
          <Button variant="outlined" color="primary" component={Link} to={findEligibleHref}>
            {onPost
              ? 'Find eligible supervisor → Overtime board'
              : 'Find eligible officer in other units → Overtime board'}
          </Button>
        </Box>
        <Box component="span" sx={{ fontSize: 12, color: colour.text.secondary }}>
          Each assignment is checked against the rules before it is saved. The panel stays open
          until the gap is met or you close it.
        </Box>
      </Box>
    </Box>
  );
}
