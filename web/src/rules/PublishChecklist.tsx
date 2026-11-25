import { useState } from 'react';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Typography from '@mui/material/Typography';

import { api } from '../api/client';
import { useUnits } from '../api/useUnits';
import type { BuildReport, RuleSetVersion, RuleSetStatus } from '../api/types';
import { colour } from '../theme/tokens';
import { impactSentence } from './impact';

interface PublishChecklistProps {
  report: BuildReport | null;
  version: number;
  /** True when the viewer created the draft, so they cannot approve it. */
  isAuthor: boolean;
  /** The role the viewer has, e.g. RULES_APPROVER. */
  role: string;
  /** The status of the draft, e.g. DRAFT or SUBMITTED. */
  status: RuleSetStatus;
  /** True when the draft has been built and can be submitted. */
  canSubmit: boolean;
  /** True when the table has edits that the api does not have yet. */
  hasUnsavedEdits: boolean;
  /** Save those edits; returns true when it saved something. */
  onSaveEdits: () => Promise<boolean>;
  onBuilt: (report: BuildReport, savedEdits: boolean) => void;
  onSubmitted: (version: RuleSetVersion, savedEdits: boolean) => void;
  onApproved: (version: RuleSetVersion) => void;
  onPublished: (version: RuleSetVersion) => void;
}

/**
 * The publish checklist (docs/ui/README.md §5.4). Only a rules admin edits,
 * builds and submits; only a rules approver approves and publishes
 * (docs/09-access-control.md §2). The person who edited a change cannot
 * publish it: a second approver reviews the before-and-after and the impact.
 *
 * Build and Submit save unsaved table edits first, so a screen can never send
 * values the person did not just look at.
 */
export function PublishChecklist({
  report,
  version,
  isAuthor,
  role,
  status,
  canSubmit,
  hasUnsavedEdits,
  onSaveEdits,
  onBuilt,
  onSubmitted,
  onApproved,
  onPublished,
}: PublishChecklistProps) {
  const [busy, setBusy] = useState(false);
  // The dry run names units by code; show their names when the list loads.
  const unitsState = useUnits();
  const units = unitsState.kind === 'ready' ? unitsState.units : [];
  const [message, setMessage] = useState<string | null>(null);

  const canEdit = role === 'RULES_ADMIN';
  // A rules approver can decide, but never on their own draft.
  const canApprove = role === 'RULES_APPROVER' && status === 'SUBMITTED' && !isAuthor;
  const canPublish = role === 'RULES_APPROVER' && status === 'APPROVED' && !isAuthor;

  const run = async (action: () => Promise<void>) => {
    setBusy(true);
    setMessage(null);
    try {
      await action();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'The action failed.');
    } finally {
      setBusy(false);
    }
  };

  const build = async () => {
    const saved = hasUnsavedEdits ? await onSaveEdits() : false;
    onBuilt(await api.buildRuleSet(version), saved);
  };

  const submit = async () => {
    const saved = hasUnsavedEdits ? await onSaveEdits() : false;
    if (saved) {
      // The report on screen described the old values, so build again before
      // the draft goes to the approver.
      onBuilt(await api.buildRuleSet(version), saved);
    }
    onSubmitted(await api.submitRuleSet(version), saved);
  };

  return (
    <Box
      sx={{
        backgroundColor: colour.bg.surface,
        border: `1px solid ${colour.border.default}`,
        borderRadius: '10px',
        p: 4,
        display: 'flex',
        flexDirection: 'column',
        gap: 2.5,
      }}
    >
      <Typography component="h2" sx={{ m: 0, fontSize: 16, fontWeight: 700 }}>
        Before draft v{version} goes live
      </Typography>

      {report ? null : (
        <Box component="span" sx={{ fontSize: 13, color: colour.text.secondary }}>
          {canEdit
            ? 'Build the draft to see the checklist: the values are checked, the rules compile, the test scenarios run, and the dry run shows what would change on the published roster.'
            : 'The build report appears here once a rules admin builds the draft.'}
        </Box>
      )}

      {report?.steps.map((step) => (
        <Box key={step.key} sx={{ display: 'flex', gap: 2, alignItems: 'flex-start' }}>
          <Box
            aria-hidden="true"
            sx={{
              width: 20,
              height: 20,
              borderRadius: '50%',
              flexShrink: 0,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontSize: 12,
              fontWeight: 700,
              color: colour.text.onDark,
              backgroundColor: step.done
                ? colour.brand.primary
                : step.key === 'impact'
                  ? colour.status.warn.bg
                  : colour.status.info.bg,
            }}
          >
            {step.done ? '✓' : step.key === 'impact' ? '!' : '·'}
          </Box>
          <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.5 }}>
            <Box component="span" sx={{ fontSize: 14, fontWeight: 600 }}>
              {step.title}
            </Box>
            <Box component="span" sx={{ fontSize: 12, color: colour.text.secondary, lineHeight: 1.45 }}>
              {step.detail}
            </Box>
            {step.impact ? (
              <Box
                component="ul"
                sx={{ m: 0, pl: 3, fontSize: 12, color: colour.text.secondary }}
              >
                {step.impact.map((row) => (
                  <li key={`${row.ruleCode}-${row.unit}-${row.from}-${row.to}`}>
                    {impactSentence(row, units)}
                  </li>
                ))}
              </Box>
            ) : null}
          </Box>
        </Box>
      ))}

      {report ? (
        <Box component="span" sx={{ fontSize: 12, color: colour.text.secondary }}>
          {report.scenarios.passed} / {report.scenarios.total} test scenarios passed.
        </Box>
      ) : null}

      {report?.errors && report.errors.length > 0 ? (
        <Box
          role="alert"
          aria-label="Why the build did not pass"
          sx={{
            p: '10px 12px',
            borderRadius: '8px',
            border: `1px solid ${colour.status.block.border}`,
            backgroundColor: colour.status.block.bg,
            color: colour.status.block.text,
            fontSize: 13,
            lineHeight: 1.45,
          }}
        >
          <Box component="span" sx={{ fontWeight: 700 }}>
            The build did not pass. Fix these and build again:
          </Box>
          <Box component="ul" sx={{ m: 0, mt: 0.5, pl: 3 }}>
            {report.errors.map((error) => (
              <li key={error}>{error}</li>
            ))}
          </Box>
        </Box>
      ) : null}

      {hasUnsavedEdits ? (
        <Box
          role="status"
          sx={{
            p: '10px 12px',
            borderRadius: '8px',
            backgroundColor: colour.status.warn.bg,
            color: colour.status.warn.text,
            fontSize: 13,
            fontWeight: 600,
          }}
        >
          You have unsaved edits. Build and Submit save them first.
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

      <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 2 }}>
        {canEdit ? (
          <Button
            variant="outlined"
            color="primary"
            disabled={busy}
            onClick={() => void run(build)}
          >
            Build and check
          </Button>
        ) : null}

        {canEdit && canSubmit ? (
          <Button
            variant="contained"
            color="primary"
            disabled={busy}
            onClick={() => void run(submit)}
          >
            Submit for approval
          </Button>
        ) : null}

        {isAuthor ? (
          <Box component="span" sx={{ fontSize: 12, color: colour.text.secondary }}>
            You created this version. Another approver must review it.
          </Box>
        ) : null}

        {canApprove ? (
          <Button
            variant="contained"
            color="primary"
            disabled={busy}
            onClick={() =>
              void run(async () => {
                onApproved(await api.approveRuleSet(version));
              })
            }
          >
            Approve
          </Button>
        ) : null}

        {canPublish ? (
          <Button
            variant="contained"
            color="primary"
            disabled={busy}
            onClick={() =>
              void run(async () => {
                const today = new Date().toISOString().slice(0, 10);
                onPublished(await api.publishRuleSet(version, today));
              })
            }
          >
            Publish
          </Button>
        ) : null}
      </Box>

      <Typography component="span" sx={{ fontSize: 12, color: colour.text.secondary, lineHeight: 1.45 }}>
        A rules admin edits, builds and submits a draft. A rules approver reviews the
        before-and-after and the impact; the person who edited a change cannot approve it.
      </Typography>
    </Box>
  );
}
