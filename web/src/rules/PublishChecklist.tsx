import { useState } from 'react';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Typography from '@mui/material/Typography';

import { api } from '../api/client';
import type { BuildReport, RuleSetVersion } from '../api/types';
import { colour } from '../theme/tokens';

interface PublishChecklistProps {
  report: BuildReport | null;
  version: number;
  /** True when the viewer created the draft, so they cannot approve it. */
  isAuthor: boolean;
  /** True when the draft has been built and can be submitted. */
  canSubmit: boolean;
  onBuilt: (report: BuildReport) => void;
  onSubmitted: (version: RuleSetVersion) => void;
  onApproved: (version: RuleSetVersion) => void;
  onPublished: (version: RuleSetVersion) => void;
}

/**
 * The publish checklist (docs/ui/README.md §5.4). The person who edits a
 * change cannot publish it: a second approver reviews the before-and-after and
 * the impact.
 */
export function PublishChecklist({
  report,
  version,
  isAuthor,
  canSubmit,
  onBuilt,
  onSubmitted,
  onApproved,
  onPublished,
}: PublishChecklistProps) {
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

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
          Build the draft to see the checklist: the values are checked, the rules compile, the test
          scenarios run, and the dry run shows what would change on the published roster.
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
                  <li key={`${row.ruleCode}-${row.unit}-${row.from}`}>
                    {row.count} published shifts in {row.unit}, {row.from} – {row.to}, would now break{' '}
                    {row.ruleCode}
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

      {message ? (
        <Box role="status" sx={{ fontSize: 13, color: colour.status.block.text }}>
          {message}
        </Box>
      ) : null}

      <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 2 }}>
        <Button
          variant="outlined"
          color="primary"
          disabled={busy}
          onClick={() =>
            void run(async () => {
              onBuilt(await api.buildRuleSet(version));
            })
          }
        >
          Build and check
        </Button>

        {canSubmit ? (
          <Button
            variant="contained"
            color="primary"
            disabled={busy}
            onClick={() =>
              void run(async () => {
                onSubmitted(await api.submitRuleSet(version));
              })
            }
          >
            Submit for approval
          </Button>
        ) : null}

        {isAuthor ? (
          <Box component="span" sx={{ fontSize: 12, color: colour.text.secondary }}>
            You created this version. Another approver must review it.
          </Box>
        ) : (
          <>
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
            <Button
              variant="outlined"
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
          </>
        )}
      </Box>

      <Typography component="span" sx={{ fontSize: 12, color: colour.text.secondary, lineHeight: 1.45 }}>
        The person who edits a change cannot publish it. A second approver reviews the
        before-and-after and the impact.
      </Typography>
    </Box>
  );
}
