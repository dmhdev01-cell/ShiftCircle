import { useEffect, useRef } from 'react';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Typography from '@mui/material/Typography';
import { Link } from 'react-router-dom';

import { ruleNameFor } from '../api/shiftTemplates';
import type { RuleOutcome, RuleResult } from '../api/types';
import { StatusPill } from '../components/StatusPill';
import { dateTimeWords } from '../planner/plannerTime';
import { colour } from '../theme/tokens';
import type { RuleCheckedState } from './useRuleCheckedMutation';

const OUTCOME_TONE = {
  BLOCK: 'block',
  WARN: 'warn',
  PASS: 'pass',
  INFO: 'info',
} as const;

const OUTCOME_TEXT = {
  BLOCK: 'Block',
  WARN: 'Warn',
  PASS: 'Pass',
  INFO: 'Info',
} as const;

const OUTCOME_ORDER: Record<string, number> = { BLOCK: 0, WARN: 1, INFO: 2, PASS: 3 };

/**
 * The results as rows: Blocks first, then Warns, keeping the api's order
 * inside each, and identical results (same rule, outcome, message, source and
 * evidence) as one row with a count. One check of Nia's Sat 21 Nov listed the
 * same U-16 Warn 14 times and pushed the fourth Block out of the dock (demo
 * verification D4).
 */
function groupRuleResults(results: RuleResult[]): { result: RuleResult; count: number; key: string }[] {
  const rows: { result: RuleResult; count: number; key: string }[] = [];
  const byKey = new Map<string, { result: RuleResult; count: number; key: string }>();
  for (const result of results) {
    const key = JSON.stringify([
      result.ruleCode,
      result.outcome,
      result.message,
      result.source ?? '',
      (result.evidence ?? []).map((item) => item.label ?? ''),
    ]);
    const existing = byKey.get(key);
    if (existing) {
      existing.count += 1;
    } else {
      const row = { result, count: 1, key };
      byKey.set(key, row);
      rows.push(row);
    }
  }
  return rows
    .map((row, index) => ({ row, index }))
    .sort(
      (a, b) =>
        (OUTCOME_ORDER[a.row.result.outcome] ?? 9) - (OUTCOME_ORDER[b.row.result.outcome] ?? 9) ||
        a.index - b.index,
    )
    .map(({ row }) => row);
}

/** The rule codes of these results, each once, in order. */
function distinctCodes(results: RuleResult[]): string[] {
  return [...new Set(results.map((result) => result.ruleCode))];
}

const VISUALLY_HIDDEN = {
  position: 'absolute',
  width: 1,
  height: 1,
  overflow: 'hidden',
  clip: 'rect(0 0 0 0)',
  whiteSpace: 'nowrap',
} as const;

interface Banner {
  text: string;
  bg: string;
  color: string;
}

function bannerFor(state: RuleCheckedState): Banner | null {
  if (state.kind === 'checking') {
    return { text: 'Checking the rules…', bg: colour.status.info.bg, color: colour.status.info.text };
  }
  if (state.kind === 'error') {
    return {
      text: state.message ?? 'The request failed.',
      bg: colour.status.block.bg,
      color: colour.status.block.text,
    };
  }
  if (state.kind === 'saved') {
    return { text: 'Saved', bg: colour.status.pass.bg, color: colour.status.pass.text };
  }
  if (state.kind !== 'ready' || !state.outcome) return null;

  const blocking = state.outcome.ruleResults.filter((result) => result.outcome === 'BLOCK');
  const warnings = state.outcome.ruleResults.filter((result) => result.outcome === 'WARN');
  // The banner counts rules, as the rows below do: 14 identical U-16 results
  // are one row with ×14, so the banner says "1 rule … (14 warnings)", not
  // "14 warnings" beside a single row.
  const blockRules = distinctCodes(blocking).length;
  const warnRules = distinctCodes(warnings).length;

  if (blockRules > 0) {
    return {
      text:
        `Blocked: ${blockRules} ${blockRules === 1 ? 'rule fails' : 'rules fail'}` +
        (blocking.length > blockRules ? ` (${blocking.length} results)` : ''),
      bg: colour.status.block.bg,
      color: colour.status.block.text,
    };
  }
  if (warnRules > 0) {
    return {
      text:
        `${warnRules} ${warnRules === 1 ? 'rule needs' : 'rules need'} acknowledging` +
        (warnings.length > warnRules ? ` (${warnings.length} warnings)` : ''),
      bg: colour.status.warn.bg,
      color: colour.status.warn.text,
    };
  }
  return { text: 'All rules passed', bg: colour.status.pass.bg, color: colour.status.pass.text };
}

interface RuleCheckPanelProps {
  state: RuleCheckedState;
  /** The proposed change, in the supervisor's words. */
  title: string;
  detail: string;
  /** What the save button says. */
  saveLabel?: string;
  /** Where "Find eligible officer" goes, with the shift if there is one. */
  findEligibleHref?: string;
  onSave: () => void;
  onAcknowledge: (codes: string[]) => void;
  onOverride: () => void;
  onCancel: () => void;
}

/**
 * The rule-check panel (docs/ui/README.md §5.1): the proposed change, the
 * overall result, every rule result with its plain message and evidence, and
 * the actions. The messages come from the api's rule results, not from the
 * screen.
 */
export function RuleCheckPanel({
  state,
  title,
  detail,
  saveLabel = 'Assign shift',
  findEligibleHref = '/overtime',
  onSave,
  onAcknowledge,
  onOverride,
  onCancel,
}: RuleCheckPanelProps) {
  const heading = useRef<HTMLHeadingElement>(null);

  const outcome = state.outcome;
  const blocking = outcome?.ruleResults.filter((result) => result.outcome === 'BLOCK') ?? [];
  const warnings = outcome?.ruleResults.filter((result) => result.outcome === 'WARN') ?? [];
  const unacknowledged = warnings.filter(
    (result) => !state.acknowledged.includes(result.ruleCode),
  );

  // Only rules whose override policy is EMERGENCY can be overridden; if any
  // blocking result is a plain acknowledgement, the api would refuse an
  // override, so the screen does not offer one (docs/07 §3).
  const canOverride =
    blocking.length > 0 && blocking.every((result) => result.overridePolicy === 'EMERGENCY');

  // Only one yellow button on the screen.
  const showAcknowledge = unacknowledged.length > 0 && blocking.length === 0;
  const showSave =
    state.kind === 'ready' && blocking.length === 0 && unacknowledged.length === 0;
  const hasPrimary = showAcknowledge || showSave;

  // The focus moves to the panel when the result arrives, so the keyboard
  // user is not left where they were (E1).
  useEffect(() => {
    if (state.kind === 'ready') {
      heading.current?.focus({ preventScroll: true });
    }
  }, [state.kind, state.outcome]);

  return (
    <Box
      sx={{
        backgroundColor: colour.bg.surface,
        border: `1px solid ${colour.border.default}`,
        borderRadius: '10px',
        p: 4,
        display: 'flex',
        flexDirection: 'column',
        gap: 3,
      }}
    >
      <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
        <Box
          component="span"
          sx={{
            fontSize: 12,
            fontWeight: 600,
            color: colour.text.secondary,
            textTransform: 'uppercase',
            letterSpacing: '0.04em',
          }}
        >
          Proposed change
        </Box>
        <Typography
          component="h2"
          ref={heading}
          tabIndex={-1}
          sx={{ m: 0, fontSize: 17, fontWeight: 700, outline: 'none' }}
        >
          {title}
        </Typography>
        <Box component="span" sx={{ fontSize: 13, color: colour.text.secondary }}>
          {detail}
        </Box>
      </Box>

      {bannerFor(state) ? (
        <Box
          role="status"
          sx={{
            display: 'flex',
            alignItems: 'center',
            gap: 2,
            p: '10px 12px',
            borderRadius: '8px',
            backgroundColor: bannerFor(state)?.bg,
            color: bannerFor(state)?.color,
            fontWeight: 700,
            fontSize: 14,
          }}
        >
          {bannerFor(state)?.text}
        </Box>
      ) : null}

      <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 2 }}>
        {blocking.length > 0 ? (
          <Button
            variant={hasPrimary ? 'outlined' : 'contained'}
            color="primary"
            component={Link}
            to={findEligibleHref}
          >
            Find eligible officer
          </Button>
        ) : null}

        {state.kind === 'saved' ? (
          <Button variant="outlined" color="primary" onClick={onCancel}>
            Done
          </Button>
        ) : (
          <Button variant="outlined" color="primary" onClick={onCancel}>
            Close
          </Button>
        )}

        {canOverride ? (
          <Button variant="outlined" color="error" onClick={onOverride}>
            Emergency override…
          </Button>
        ) : null}

        {showAcknowledge ? (
          <Button
            variant="contained"
            color="primary"
            onClick={() => onAcknowledge(distinctCodes(unacknowledged))}
          >
            Acknowledge and assign
          </Button>
        ) : null}

        {showSave ? (
          <Button variant="contained" color="primary" onClick={onSave}>
            {saveLabel}
          </Button>
        ) : null}
      </Box>

      {outcome && outcome.ruleResults.length > 0 ? (
        <Box
          component="ul"
          sx={{ listStyle: 'none', m: 0, p: 0, display: 'flex', flexDirection: 'column', gap: 2.5 }}
        >
          {groupRuleResults(outcome.ruleResults).map(({ result, count, key }) => (
            <Box
              component="li"
              key={key}
              // One compact row per result: the four Blocks of the demo's
              // check fit in the dock at 1440×900 without scrolling (D4).
              sx={{
                display: 'flex',
                flexWrap: 'wrap',
                alignItems: 'baseline',
                columnGap: 2,
                rowGap: 0.5,
                p: '6px 12px',
                border: `1px solid ${colour.border.default}`,
                borderRadius: '8px',
              }}
            >
              <StatusPill tone={OUTCOME_TONE[result.outcome as RuleOutcome]}>
                {OUTCOME_TEXT[result.outcome as RuleOutcome]}
              </StatusPill>
              <Box
                component="span"
                sx={{ fontSize: 12, fontWeight: 600, color: colour.text.secondary, whiteSpace: 'nowrap' }}
              >
                <span>
                  {result.ruleCode}
                  {ruleNameFor(result.ruleCode) ? ` · ${ruleNameFor(result.ruleCode)}` : ''}
                </span>
                {count > 1 ? (
                  <Box component="span" sx={{ ml: 1, color: colour.text.primary }}>
                    <span aria-hidden="true">×{count}</span>
                    <Box component="span" sx={VISUALLY_HIDDEN}>
                      {count} times
                    </Box>
                  </Box>
                ) : null}
              </Box>
              <Box component="span" sx={{ flex: '1 1 320px', minWidth: 0, fontSize: 13, lineHeight: 1.45 }}>
                <span>{result.message}</span>
                {result.source || (result.evidence && result.evidence.length > 0) ? (
                  <Box component="span" sx={{ ml: 2, fontSize: 12, color: colour.text.secondary }}>
                    {[
                      result.source ? `Source: ${result.source}` : null,
                      result.evidence && result.evidence.length > 0
                        ? `Evidence: ${result.evidence.map((item) => item.label ?? '').filter(Boolean).join(', ')}`
                        : null,
                    ]
                      .filter(Boolean)
                      .join(' · ')}
                  </Box>
                ) : null}
              </Box>
            </Box>
          ))}
        </Box>
      ) : null}

      {outcome ? (
        <Box component="span" sx={{ fontSize: 12, color: colour.text.secondary }}>
          {[
            outcome.passedRules ? `${outcome.passedRules} other rules passed` : null,
            outcome.ruleSetVersion ? `Rule tables v${outcome.ruleSetVersion}` : null,
            outcome.publishedAt ? `(published ${dateTimeWords(outcome.publishedAt)})` : null,
          ]
            .filter(Boolean)
            .join(' · ')}
        </Box>
      ) : null}

      {canOverride ? (
        <p style={{ margin: 0, fontSize: 12, color: colour.text.secondary, lineHeight: 1.5 }}>
          An override needs a written reason. It is saved to the audit log and flagged in reports.
        </p>
      ) : null}
    </Box>
  );
}
