import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';

import { api } from '../api/client';
import type { BuildReport, RuleSetVersion, RuleTable } from '../api/types';
import { StatusPill } from '../components/StatusPill';
import { useRole } from '../shell/nav';
import { colour } from '../theme/tokens';
import { DecisionTable } from './DecisionTable';
import { PublishChecklist } from './PublishChecklist';

const TABLE_CODES = [
  'rest-between-shifts',
  'maximum-hours',
  'consecutive-work',
  'sixteen-hour-shifts',
  'days-off',
  'pay-classification',
  'overtime-ranking',
  'shift-types',
];

const TABLE_NAMES: Record<string, string> = {
  'rest-between-shifts': 'Rest between shifts',
  'maximum-hours': 'Maximum hours',
  'consecutive-work': 'Consecutive work',
  'sixteen-hour-shifts': '16-hour shifts',
  'days-off': 'Days off',
  'pay-classification': 'Pay classification',
  'overtime-ranking': 'Overtime ranking',
  'shift-types': 'Shift types',
};

/**
 * Rules admin (docs/ui/README.md §5.4). One row of the grid is one rule, and
 * the wording under it updates as the values change.
 *
 * The person who edits a change cannot approve it: a second approver reviews
 * the before-and-after and the impact (HANDOFF.md §5.3).
 */
export function RulesPage() {
  const { role } = useRole();
  const navigate = useNavigate();
  const params = useParams();
  const [versions, setVersions] = useState<RuleSetVersion[] | null>(null);
  const [draft, setDraft] = useState<RuleSetVersion | null>(null);
  // The version the screen is showing. It stays the same when the draft is
  // submitted or approved, so the screen does not jump to the live version.
  const [selectedVersion, setSelectedVersion] = useState<number | null>(null);
  // The table comes from the route, so the screen can be linked to.
  const code =
    params.table && TABLE_CODES.includes(params.table) ? params.table : TABLE_CODES[0];
  const [table, setTable] = useState<RuleTable | null>(null);
  const [report, setReport] = useState<BuildReport | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    void api.getRuleSets().then((sets) => {
      if (!active) return;
      setVersions(sets);
      const first =
        sets.find((entry) => entry.status === 'DRAFT') ?? sets.find((entry) => entry.live) ?? null;
      setDraft(first);
      setSelectedVersion(first?.version ?? null);
    });
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    if (!draft) return;
    let active = true;
    void api.getRuleTable(draft.version, code).then((loaded) => {
      if (active) setTable(loaded);
    });
    return () => {
      active = false;
    };
  }, [draft, code]);

  if (!versions || !draft) {
    return (
      <>
        <Typography variant="h1">Rules</Typography>
        <Typography sx={{ fontSize: 14, color: colour.text.secondary }} role="status">
          Loading the rule sets…
        </Typography>
      </>
    );
  }

  const live = versions.find((entry) => entry.live);
  // Keep showing the version that was picked, whatever its status is now.
  const shown = versions.find((entry) => entry.version === selectedVersion) ?? draft;
  // The person who created the draft cannot approve it.
  const isAuthor = draft.createdBy === role.user;

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
          <Typography variant="h1">Rules</Typography>
          <Box sx={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 2 }}>
            <Typography sx={{ fontSize: 14, color: colour.text.secondary }}>
              Live v{live?.version ?? '—'} · draft v{shown?.version ?? '—'}
            </Typography>
            <StatusPill tone={draft.status === 'DRAFT' ? 'warn' : 'info'}>
              {draft.status === 'DRAFT' ? 'Draft' : draft.status === 'SUBMITTED' ? 'Submitted' : 'Live'}
            </StatusPill>
          </Box>
        </Box>
      </Box>

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

      <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 5, alignItems: 'flex-start' }}>
        <Box
          component="section"
          aria-label="Rule tables"
          sx={{
            flex: '1 1 220px',
            minWidth: 0,
            display: 'flex',
            flexDirection: 'column',
            gap: 0.5,
            p: 2,
            backgroundColor: colour.status.info.bg,
            borderRadius: '10px',
          }}
        >
          <Typography
            component="h2"
            sx={{
              m: '4px 8px 8px',
              fontSize: 12,
              fontWeight: 700,
              color: colour.text.secondary,
              textTransform: 'uppercase',
              letterSpacing: '0.04em',
            }}
          >
            Rule tables
          </Typography>
          {TABLE_CODES.map((entry) => (
            <Box
              key={entry}
              component="button"
              type="button"
              aria-pressed={entry === code}
              onClick={() => navigate(`/rules/${draft.version}/${entry}`)}
              sx={{
                display: 'flex',
                flexDirection: 'column',
                gap: 0.5,
                minHeight: 44,
                px: 2,
                py: 1.5,
                border: 0,
                borderRadius: '8px',
                textAlign: 'left',
                fontFamily: 'inherit',
                fontSize: 13,
                color: colour.text.primary,
                backgroundColor: entry === code ? colour.bg.surface : 'transparent',
                cursor: 'pointer',
                '&:hover': { backgroundColor: colour.bg.surface },
              }}
            >
              <Box component="span" sx={{ fontWeight: 600 }}>
                {TABLE_NAMES[entry]}
              </Box>
            </Box>
          ))}
        </Box>

        <Box sx={{ flex: '999 1 640px', minWidth: 0 }}>
          {table ? (
            <DecisionTable
              table={table}
              version={draft.version}
              readOnly={draft.status !== 'DRAFT'}
              onSaved={(saved) => {
                setTable(saved);
                setMessage('The draft is saved.');
              }}
            />
          ) : null}
        </Box>

        <Box
          sx={{ flex: '1 1 300px', minWidth: 0, display: 'flex', flexDirection: 'column', gap: 4 }}
        >
          <PublishChecklist
            report={report}
            version={draft.version}
            isAuthor={isAuthor}
            role={role.id}
            status={draft.status}
            canSubmit={report !== null && draft.status === 'DRAFT'}
            onBuilt={(built) => {
              setReport(built);
              setMessage('The draft was built and the test scenarios ran.');
            }}
            onSubmitted={(submitted) => {
              setDraft(submitted);
              setMessage('The draft is submitted for approval. A second approver has to review it.');
            }}
            onApproved={(approved) => {
              setDraft(approved);
              setMessage('The version is approved. It can be published.');
            }}
            onPublished={(published) => {
              setDraft(published);
              setVersions((current) =>
                (current ?? []).map((entry) => ({ ...entry, live: entry.version === published.version })),
              );
              setMessage(`Version ${published.version} is live from ${published.publishedAt}.`);
            }}
          />

          <Box
            sx={{
              backgroundColor: colour.bg.surface,
              border: `1px solid ${colour.border.default}`,
              borderRadius: '10px',
              p: 4,
              display: 'flex',
              flexDirection: 'column',
              gap: 2,
            }}
          >
            <Typography component="h2" sx={{ m: 0, fontSize: 16, fontWeight: 700 }}>
              Version history
            </Typography>
            {versions.map((entry) => (
              <Box
                key={entry.version}
                sx={{
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 0.5,
                  pb: 2,
                  borderBottom: `1px solid ${colour.border.default}`,
                }}
              >
                <Box component="span" sx={{ fontSize: 14, fontWeight: 600 }}>
                  v{entry.version}{' '}
                  <Box component="span" sx={{ fontWeight: 500, color: colour.text.secondary }}>
                    · {entry.publishedAt ?? entry.createdAt ?? ''}
                  </Box>
                </Box>
                <Box component="span" sx={{ fontSize: 12, color: colour.text.secondary }}>
                  {entry.live
                    ? 'Live'
                    : entry.status === 'DRAFT'
                      ? `Draft by ${entry.createdBy ?? 'a rules admin'}`
                      : entry.reason ?? 'Published'}
                </Box>
              </Box>
            ))}
          </Box>
        </Box>
      </Box>
    </>
  );
}
