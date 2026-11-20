import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Card from '@mui/material/Card';
import CardContent from '@mui/material/CardContent';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';

import { api } from '../api/client';
import type {
  BuildReport,
  RuleSetStatus,
  RuleSetVersion,
  RuleTable,
  RuleTableRow,
} from '../api/types';
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

const STATUS_LABELS: Record<RuleSetStatus, string> = {
  LIVE: 'Live',
  DRAFT: 'Draft',
  SUBMITTED: 'Submitted',
  APPROVED: 'Approved',
  PUBLISHED: 'Published',
  REJECTED: 'Rejected',
};

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
 * Only a rules admin edits and builds a draft; only a rules approver approves
 * and publishes (docs/09-access-control.md §2). The person who edited a
 * change cannot approve it: a second approver reviews the before-and-after and
 * the impact (HANDOFF.md §5.3).
 */
export function RulesPage() {
  const { role, userName } = useRole();
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
  // The edits belong to the table and version they were made in, so a new
  // table starts from the api's rows again.
  const [edits, setEdits] = useState<{
    key: string;
    rows: RuleTableRow[];
    edited: Record<string, boolean>;
  } | null>(null);
  const [saving, setSaving] = useState(false);
  const [report, setReport] = useState<BuildReport | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [draftReason, setDraftReason] = useState('');
  const [creatingDraft, setCreatingDraft] = useState(false);

  useEffect(() => {
    let active = true;
    void api.getRuleSets().then((sets) => {
      if (!active) return;
      setVersions(sets);
      const wanted = params.version ? Number(params.version) : Number.NaN;
      // The reviewer lands on /rules without a version: show the version that
      // is waiting for a decision, then an unsubmitted draft, then the live
      // version (docs/ui/build-notes.md §2.1).
      const first =
        sets.find((entry) => entry.version === wanted) ??
        sets.find((entry) => entry.status === 'SUBMITTED') ??
        sets.find((entry) => entry.status === 'DRAFT') ??
        sets.find((entry) => entry.live) ??
        null;
      setDraft(first);
      setSelectedVersion(first?.version ?? null);
    });
    return () => {
      active = false;
    };
    // The version in the route is read once, when the screen opens.
    // eslint-disable-next-line react-hooks/exhaustive-deps
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
  const hasDraft = versions.some((entry) => entry.status === 'DRAFT');
  // Keep showing the version that was picked, whatever its status is now.
  const shown = versions.find((entry) => entry.version === selectedVersion) ?? draft;
  // The version on screen is not necessarily the draft: /rules/7 (the
  // supervisor link) shows the live version. The header and the checklist name
  // the real live and draft versions, not whatever the route happens to show.
  const pending = versions.find(
    (entry) =>
      !entry.live &&
      (entry.status === 'DRAFT' || entry.status === 'SUBMITTED' || entry.status === 'APPROVED'),
  );
  const tableKey = table ? `${draft.version}:${table.code}:${table.rows.length}:${table.changed}` : '';
  const rows = table && edits?.key === tableKey ? edits.rows : (table?.rows ?? []);
  const edited = table && edits?.key === tableKey ? edits.edited : {};
  const dirty = Object.keys(edited).length > 0;
  const canEdit = role.id === 'RULES_ADMIN' && draft.status === 'DRAFT';
  // The person who created the draft cannot approve it, even with the
  // approver role as well.
  const isAuthor = pending?.createdBy === userName;

  const update = (ruleCode: string, patch: Partial<RuleTableRow>) => {
    if (!table) return;
    setEdits({
      key: tableKey,
      rows: rows.map((row) => {
        if (row.ruleCode !== ruleCode) return row;
        const params = { ...(row.params ?? {}) };
        // The api stores the real value in params; the grid edits a friendly field.
        if (patch.minHours !== undefined && table.hoursParam) {
          params[table.hoursParam] = patch.minHours;
        }
        if (patch.after !== undefined && table.afterParam) {
          params[table.afterParam] = patch.after;
        }
        return { ...row, ...patch, params };
      }),
      edited: { ...edited, [ruleCode]: true },
    });
  };

  /** Save any unsaved table edits. Returns true when it actually saved. */
  const saveEdits = async (): Promise<boolean> => {
    if (!table || !dirty) return false;
    setSaving(true);
    try {
      const saved = await api.saveRuleRows(draft.version, table.code, rows);
      setTable(saved);
      setEdits(null);
      setMessage('The unsaved edits were saved.');
      return true;
    } finally {
      setSaving(false);
    }
  };

  const saveDraft = async () => {
    try {
      await saveEdits();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'The draft could not be saved.');
    }
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
          <Typography variant="h1">Rules</Typography>
          <Box sx={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 2 }}>
            <Typography sx={{ fontSize: 14, color: colour.text.secondary }}>
              Live v{live?.version ?? '—'} ·{' '}
              {pending ? `draft v${pending.version}` : 'no draft'}
            </Typography>
            <StatusPill tone={shown.status === 'DRAFT' ? 'warn' : 'info'}>
              {STATUS_LABELS[shown.status]}
            </StatusPill>
          </Box>
        </Box>
      </Box>

      {role.id === 'RULES_ADMIN' && !hasDraft ? (
        <Card>
          <CardContent sx={{ p: 4, display: 'flex', flexDirection: 'column', gap: 2 }}>
            <Typography component="h2" sx={{ m: 0, fontSize: 16, fontWeight: 700 }}>
              Start a draft
            </Typography>
            <Typography sx={{ fontSize: 13, color: colour.text.secondary }}>
              A draft starts from the live version (v{live?.version ?? '—'}). Change the rule
              tables, build and submit it, and a second approver can review and publish it.
            </Typography>
            <TextField
              label="Why is this change needed?"
              value={draftReason}
              onChange={(event) => setDraftReason(event.target.value)}
              size="small"
            />
            <Box>
              <Button
                variant="contained"
                color="primary"
                disabled={draftReason.trim().length === 0 || creatingDraft || !live}
                onClick={() =>
                  void (async () => {
                    if (!live) return;
                    setCreatingDraft(true);
                    setMessage(null);
                    try {
                      const created = await api.createRuleSetDraft(live.version, draftReason.trim());
                      setVersions((current) => [created, ...(current ?? [])]);
                      setDraft(created);
                      setSelectedVersion(created.version);
                      setDraftReason('');
                      setMessage(`Draft v${created.version} is ready to edit.`);
                    } catch (error) {
                      setMessage(
                        error instanceof Error ? error.message : 'The draft could not be created.',
                      );
                    } finally {
                      setCreatingDraft(false);
                    }
                  })()
                }
              >
                Start a draft
              </Button>
            </Box>
          </CardContent>
        </Card>
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
              readOnly={!canEdit}
              rows={rows}
              edited={edited}
              saving={saving}
              onUpdate={update}
              onSave={() => void saveDraft()}
            />
          ) : null}
        </Box>

        <Box
          sx={{ flex: '1 1 300px', minWidth: 0, display: 'flex', flexDirection: 'column', gap: 4 }}
        >
          {pending ? (
            <PublishChecklist
              report={report}
              version={pending.version}
              isAuthor={isAuthor}
              role={role.id}
              status={pending.status}
              canSubmit={report !== null && pending.status === 'DRAFT'}
              hasUnsavedEdits={dirty}
              onSaveEdits={saveEdits}
              onBuilt={(built, savedEdits) => {
                setReport(built);
                setMessage(
                  savedEdits
                    ? 'The unsaved edits were saved, then the draft was built and the test scenarios ran.'
                    : 'The draft was built and the test scenarios ran.',
                );
              }}
              onSubmitted={(submitted, savedEdits) => {
                setDraft(submitted);
                setVersions((current) =>
                  (current ?? []).map((entry) =>
                    entry.version === submitted.version ? submitted : entry,
                  ),
                );
                setMessage(
                  savedEdits
                    ? 'The unsaved edits were saved, the draft was rebuilt, and it is submitted for approval. A second approver has to review it.'
                    : 'The draft is submitted for approval. A second approver has to review it.',
                );
              }}
              onApproved={(approved) => {
                setDraft(approved);
                setVersions((current) =>
                  (current ?? []).map((entry) =>
                    entry.version === approved.version ? approved : entry,
                  ),
                );
                setMessage('The version is approved. It can be published.');
              }}
              onPublished={(published) => {
                setDraft(published);
                setVersions((current) =>
                  (current ?? []).map((entry) => ({
                    ...entry,
                    live: entry.version === published.version,
                  })),
                );
                setMessage(`Version ${published.version} is live from ${published.publishedAt}.`);
              }}
            />
          ) : null}

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
