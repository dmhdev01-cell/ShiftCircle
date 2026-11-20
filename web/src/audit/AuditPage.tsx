import { useEffect, useState } from 'react';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Card from '@mui/material/Card';
import CardContent from '@mui/material/CardContent';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';

import { api, ApiError } from '../api/client';
import type { AuditEvent, AuditQuery } from '../api/types';
import { colour } from '../theme/tokens';
import { ENTITY_FILTER_CHOICES } from './auditCodes';
import { actionLabel, entityLabel, formatAt, summaryOf } from './auditText';

const PAGE_SIZE = 20;

const ENTITY_CHOICES = ENTITY_FILTER_CHOICES;

interface Draft {
  actor: string;
  action: string;
  entityType: string;
  from: string;
  to: string;
}

const EMPTY: Draft = { actor: '', action: '', entityType: '', from: '', to: '' };

/**
 * The read-only audit log (docs/07 §4.8, docs/09 §2). An auditor sees the
 * whole facility; a supervisor sees the events of their units. There is no
 * edit or delete anywhere: the audit table refuses both.
 */
export function AuditPage() {
  const [draft, setDraft] = useState<Draft>(EMPTY);
  const [filters, setFilters] = useState<AuditQuery>({});
  const [items, setItems] = useState<AuditEvent[]>([]);
  const [next, setNext] = useState<number | null>(null);
  const [state, setState] = useState<'loading' | 'ready' | 'error' | 'denied'>('loading');
  const [message, setMessage] = useState<string | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);

  useEffect(() => {
    let active = true;
    setState('loading');
    setMessage(null);
    setItems([]);
    setNext(null);
    api
      .getAuditEvents({ ...filters, limit: PAGE_SIZE })
      .then((page) => {
        if (!active) return;
        setItems(page.items);
        setNext(page.nextBeforeId);
        setState('ready');
      })
      .catch((error: unknown) => {
        if (!active) return;
        if (error instanceof ApiError && error.status === 403) {
          setState('denied');
          return;
        }
        setState('error');
        setMessage(error instanceof Error ? error.message : 'The audit log could not be loaded.');
      });
    return () => {
      active = false;
    };
  }, [filters]);

  const apply = () => {
    setFilters({
      ...(draft.actor.trim() ? { actor: draft.actor.trim() } : {}),
      ...(draft.action.trim() ? { action: draft.action.trim() } : {}),
      ...(draft.entityType ? { entityType: draft.entityType } : {}),
      ...(draft.from ? { from: draft.from } : {}),
      ...(draft.to ? { to: draft.to } : {}),
    });
  };

  const clear = () => {
    setDraft(EMPTY);
    setFilters({});
  };

  const loadMore = async () => {
    if (next === null) return;
    setLoadingMore(true);
    setMessage(null);
    try {
      const page = await api.getAuditEvents({ ...filters, beforeId: next, limit: PAGE_SIZE });
      setItems((current) => [...current, ...page.items]);
      setNext(page.nextBeforeId);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'The next page could not be loaded.');
    } finally {
      setLoadingMore(false);
    }
  };

  if (state === 'denied') {
    return (
      <>
        <Typography variant="h1">Not allowed</Typography>
        <Card>
          <CardContent sx={{ p: 4, display: 'flex', flexDirection: 'column', gap: 2 }}>
            <Typography sx={{ fontSize: 15, fontWeight: 600 }}>
              Your role cannot read the audit log.
            </Typography>
            <Typography sx={{ fontSize: 14, color: colour.text.secondary }}>
              Auditors see the whole facility and supervisors see their own units. Ask a supervisor
              if you need an event reviewed.
            </Typography>
          </CardContent>
        </Card>
      </>
    );
  }

  if (state === 'loading') {
    return (
      <>
        <Typography variant="h1">Audit log</Typography>
        <Typography sx={{ fontSize: 14, color: colour.text.secondary }} role="status">
          Loading the audit events…
        </Typography>
      </>
    );
  }

  if (state === 'error') {
    return (
      <>
        <Typography variant="h1">Audit log</Typography>
        <Card>
          <CardContent sx={{ p: 4, display: 'flex', flexDirection: 'column', gap: 2 }}>
            <Typography sx={{ fontWeight: 600, fontSize: 15, color: colour.status.block.text }}>
              Could not load the audit log
            </Typography>
            <Typography sx={{ fontSize: 14, color: colour.text.secondary }}>{message}</Typography>
            <Box>
              <Button variant="outlined" color="primary" onClick={() => setFilters({ ...filters })}>
                Try again
              </Button>
            </Box>
          </CardContent>
        </Card>
      </>
    );
  }

  return (
    <>
      <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
        <Typography variant="h1">Audit log</Typography>
        <Typography sx={{ fontSize: 14, color: colour.text.secondary }}>
          Who did what, newest first. Read-only: the audit table refuses edits and deletes.
        </Typography>
      </Box>

      <Card>
        <CardContent
          component="form"
          onSubmit={(event: { preventDefault: () => void }) => {
            event.preventDefault();
            apply();
          }}
          sx={{ p: 4, display: 'flex', flexWrap: 'wrap', alignItems: 'flex-end', gap: 3 }}
        >
          <TextField
            label="Actor"
            size="small"
            value={draft.actor}
            onChange={(event) => setDraft((current) => ({ ...current, actor: event.target.value }))}
            helperText="Username, e.g. m.ellis"
            sx={{ minWidth: 180 }}
          />
          <TextField
            label="Action"
            size="small"
            value={draft.action}
            onChange={(event) => setDraft((current) => ({ ...current, action: event.target.value }))}
            helperText="Code, e.g. override_rule"
            sx={{ minWidth: 180 }}
          />
          <TextField
            select
            label="Entity"
            size="small"
            value={draft.entityType}
            onChange={(event) =>
              setDraft((current) => ({ ...current, entityType: event.target.value }))
            }
            slotProps={{ select: { native: true }, inputLabel: { shrink: true } }}
            sx={{ minWidth: 170 }}
          >
            <option value="">All entities</option>
            {ENTITY_CHOICES.map((choice) => (
              <option key={choice.value} value={choice.value}>
                {choice.label}
              </option>
            ))}
          </TextField>
          <TextField
            label="From"
            type="date"
            size="small"
            value={draft.from}
            onChange={(event) => setDraft((current) => ({ ...current, from: event.target.value }))}
            slotProps={{ inputLabel: { shrink: true } }}
          />
          <TextField
            label="To"
            type="date"
            size="small"
            value={draft.to}
            onChange={(event) => setDraft((current) => ({ ...current, to: event.target.value }))}
            slotProps={{ inputLabel: { shrink: true } }}
          />
          <Box sx={{ display: 'flex', gap: 2 }}>
            <Button type="submit" variant="contained" color="primary">
              Apply
            </Button>
            <Button variant="outlined" color="primary" onClick={clear}>
              Clear
            </Button>
          </Box>
        </CardContent>
      </Card>

      {message ? (
        <Box
          role="status"
          sx={{
            p: '10px 12px',
            borderRadius: '8px',
            backgroundColor: colour.status.block.bg,
            color: colour.status.block.text,
            fontSize: 13,
            fontWeight: 600,
          }}
        >
          {message}
        </Box>
      ) : null}

      <Box
        role="region"
        aria-label="Audit events, scrolls sideways"
        tabIndex={0}
        sx={{
          backgroundColor: colour.bg.surface,
          border: `1px solid ${colour.border.default}`,
          borderRadius: '10px',
          overflowX: 'auto',
        }}
      >
        <table
          style={{ width: '100%', minWidth: 980, borderCollapse: 'collapse', fontSize: 13 }}
          aria-label="Audit events"
        >
          <thead>
            <tr>
              {['Time', 'Actor', 'Action', 'Entity', 'Summary'].map((heading) => (
                <th
                  key={heading}
                  style={{
                    textAlign: 'left',
                    padding: '8px 10px',
                    fontSize: 12,
                    fontWeight: 600,
                    color: colour.text.secondary,
                    backgroundColor: colour.bg.subtle,
                    borderBottom: `1px solid ${colour.border.default}`,
                    whiteSpace: 'nowrap',
                  }}
                >
                  {heading}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {items.map((event) => (
              <tr key={event.id}>
                <td
                  className="num"
                  style={{
                    padding: '8px 10px',
                    whiteSpace: 'nowrap',
                    borderBottom: `1px solid ${colour.border.default}`,
                  }}
                >
                  {formatAt(event.occurredAt)}
                </td>
                <td style={{ padding: '8px 10px', borderBottom: `1px solid ${colour.border.default}` }}>
                  {event.actor ? (
                    <>
                      <strong>{event.actor.displayName}</strong>
                      <br />
                      <span style={{ fontSize: 12, color: colour.text.secondary }}>
                        {event.actor.username}
                      </span>
                    </>
                  ) : (
                    'System'
                  )}
                </td>
                <td style={{ padding: '8px 10px', borderBottom: `1px solid ${colour.border.default}` }}>
                  {actionLabel(event.action)}
                </td>
                <td style={{ padding: '8px 10px', borderBottom: `1px solid ${colour.border.default}` }}>
                  {entityLabel(event.entityType)}
                  {event.entityId ? (
                    <span style={{ fontSize: 12, color: colour.text.secondary }}>
                      {' '}
                      · {event.entityId.slice(0, 8)}
                    </span>
                  ) : null}
                </td>
                <td style={{ padding: '8px 10px', borderBottom: `1px solid ${colour.border.default}` }}>
                  {summaryOf(event)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </Box>

      {items.length === 0 ? (
        <Typography sx={{ fontSize: 14, color: colour.text.secondary }}>
          No audit events match these filters.
        </Typography>
      ) : null}

      {next !== null ? (
        <Box>
          <Button variant="outlined" color="primary" disabled={loadingMore} onClick={() => void loadMore()}>
            Load more
          </Button>
        </Box>
      ) : null}
    </>
  );
}
