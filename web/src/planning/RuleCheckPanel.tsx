import { useEffect, useRef } from 'react';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Typography from '@mui/material/Typography';
import { Link } from 'react-router-dom';

import { ruleNameFor } from '../api/shiftTemplates';
import type { RuleOutcome } from '../api/types';
import { StatusPill } from '../components/StatusPill';
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

  if (blocking.length > 0) {
    const rules = blocking.length === 1 ? 'rule' : 'rules';
    return {
      text: `Blocked: ${blocking.length} ${rules} fail${blocking.length === 1 ? 's' : ''}`,
      bg: colour.status.block.bg,
      color: colour.status.block.text,
    };
  }
  if (warnings.length > 0) {
    return {
      text: `${warnings.length} warning${warnings.length === 1 ? '' : 's'} need acknowledging`,
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
      heading.current?.focus();
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

      {outcome && outcome.ruleResults.length > 0 ? (
        <Box
          component="ul"
          sx={{ listStyle: 'none', m: 0, p: 0, display: 'flex', flexDirection: 'column', gap: 2.5 }}
        >
          {outcome.ruleResults.map((result) => (
            <Box
              component="li"
              key={result.ruleCode}
              sx={{
                display: 'flex',
                flexDirection: 'column',
                gap: 1,
                p: '10px 12px',
                border: `1px solid ${colour.border.default}`,
                borderRadius: '8px',
              }}
            >
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 2 }}>
                <StatusPill tone={OUTCOME_TONE[result.outcome as RuleOutcome]}>
                  {OUTCOME_TEXT[result.outcome as RuleOutcome]}
                </StatusPill>
                <Box component="span" sx={{ fontSize: 12, fontWeight: 600, color: colour.text.secondary }}>
                  {result.ruleCode}
                  {ruleNameFor(result.ruleCode) ? ` · ${ruleNameFor(result.ruleCode)}` : ''}
                </Box>
              </Box>
              <Box component="span" sx={{ fontSize: 13, lineHeight: 1.45 }}>
                {result.message}
              </Box>
              {result.source || (result.evidence && result.evidence.length > 0) ? (
                <Box component="span" sx={{ fontSize: 12, color: colour.text.secondary }}>
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
          ))}
        </Box>
      ) : null}

      {outcome ? (
        <Box component="span" sx={{ fontSize: 12, color: colour.text.secondary }}>
          {[
            outcome.passedRules ? `${outcome.passedRules} other rules passed` : null,
            outcome.ruleSetVersion ? `Rule tables v${outcome.ruleSetVersion}` : null,
            outcome.publishedAt ? `(published ${outcome.publishedAt})` : null,
          ]
            .filter(Boolean)
            .join(' · ')}
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
            Cancel
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
            onClick={() => onAcknowledge(unacknowledged.map((result) => result.ruleCode))}
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

      <p style={{ margin: 0, fontSize: 12, color: colour.text.secondary, lineHeight: 1.5 }}>
        An override needs a written reason. It is saved to the audit log and flagged in reports.
      </p>
    </Box>
  );
}
