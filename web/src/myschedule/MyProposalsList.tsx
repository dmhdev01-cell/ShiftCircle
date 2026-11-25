import { useCallback, useEffect, useState } from 'react';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Dialog from '@mui/material/Dialog';
import DialogActions from '@mui/material/DialogActions';
import DialogContent from '@mui/material/DialogContent';
import DialogTitle from '@mui/material/DialogTitle';
import Typography from '@mui/material/Typography';

import { api } from '../api/client';
import type { MyProposal } from '../api/types';
import { StatusPill } from '../components/StatusPill';
import { colour } from '../theme/tokens';
import {
  DECISION,
  DISPLAY_STATE,
  decisionLine,
  noteExcerpt,
  sentWhen,
  shiftLine,
  withinNinetyDays,
} from './proposalWords';

type ListState =
  | { kind: 'loading' }
  | { kind: 'ready'; proposals: MyProposal[] }
  | { kind: 'error'; message: string };

/**
 * My proposals (plan v1.3 §3.1): what the officer sent in the last 90 days,
 * newest first, with each shift's outcome and the decider's comment, and
 * Withdraw while every shift is still waiting. The note and the comment are
 * the people's plain text and are only ever rendered as text.
 */
export function MyProposalsList({ reloadKey, asOf }: { reloadKey: number; asOf: string | undefined }) {
  const [state, setState] = useState<ListState>({ kind: 'loading' });
  const [confirming, setConfirming] = useState<MyProposal | null>(null);
  const [working, setWorking] = useState(false);
  const [message, setMessage] = useState<{ tone: 'ok' | 'error'; text: string } | null>(null);

  const load = useCallback(() => {
    let active = true;
    api
      .getMyProposals()
      .then((proposals) => {
        if (active) setState({ kind: 'ready', proposals });
      })
      .catch((error: unknown) => {
        if (!active) return;
        setState({
          kind: 'error',
          message: error instanceof Error ? error.message : 'Could not load your proposals.',
        });
      });
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => load(), [load, reloadKey]);

  const withdraw = async (proposal: MyProposal) => {
    setWorking(true);
    try {
      await api.withdrawProposal(proposal.id, proposal.version);
      setMessage({ tone: 'ok', text: 'Withdrawn. Your supervisor no longer sees it as waiting.' });
    } catch (error) {
      setMessage({
        tone: 'error',
        text: `Not withdrawn: ${error instanceof Error ? error.message : 'please try again.'}`,
      });
    } finally {
      setWorking(false);
      setConfirming(null);
      load();
    }
  };

  const proposals =
    state.kind === 'ready'
      ? state.proposals.filter((proposal) => withinNinetyDays(proposal.submittedAt, asOf))
      : [];

  return (
    <Box
      component="section"
      id="my-proposals"
      aria-label="My proposals"
      sx={{
        backgroundColor: colour.bg.surface,
        border: `1px solid ${colour.border.default}`,
        borderRadius: '10px',
        p: 4,
        display: 'flex',
        flexDirection: 'column',
        gap: 3,
        scrollMarginTop: '80px',
      }}
    >
      <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
        <Typography component="h2" sx={{ m: 0, fontSize: 17, fontWeight: 700 }}>
          My proposals
        </Typography>
        <Box component="span" sx={{ fontSize: 13, color: colour.text.secondary, lineHeight: 1.45 }}>
          What you sent in the last 90 days, newest first. A shift that starts before anyone
          answers expires.
        </Box>
      </Box>

      {message ? (
        <Box
          role={message.tone === 'error' ? 'alert' : 'status'}
          sx={{
            p: '10px 12px',
            borderRadius: '8px',
            fontSize: 13,
            backgroundColor: message.tone === 'error' ? colour.status.block.bg : colour.status.under.bg,
            color: message.tone === 'error' ? colour.status.block.text : colour.status.under.text,
          }}
        >
          {message.text}
        </Box>
      ) : null}

      {state.kind === 'loading' ? (
        <Box component="span" role="status" sx={{ fontSize: 13, color: colour.text.secondary }}>
          Loading your proposals…
        </Box>
      ) : null}
      {state.kind === 'error' ? (
        <Box component="span" role="alert" sx={{ fontSize: 13, color: colour.status.block.text }}>
          Could not load your proposals: {state.message}
        </Box>
      ) : null}
      {state.kind === 'ready' && proposals.length === 0 ? (
        <Box component="span" sx={{ fontSize: 13, color: colour.text.secondary }}>
          You haven&apos;t sent any proposals yet.
        </Box>
      ) : null}

      {proposals.length > 0 ? (
        <Box component="ul" sx={{ m: 0, p: 0, listStyle: 'none', display: 'flex', flexDirection: 'column', gap: 2 }}>
          {proposals.map((proposal) => {
            const state = DISPLAY_STATE[proposal.displayState] ?? DISPLAY_STATE.WAITING;
            const sent = sentWhen(proposal.submittedAt);
            const count = proposal.items.length;
            const answered =
              proposal.displayState === 'WAITING' &&
              !proposal.canWithdraw &&
              proposal.items.some((item) => item.decision !== 'PENDING');
            return (
              <Box
                component="li"
                key={proposal.id}
                aria-label={`Proposal sent ${sent}: ${state.text}`}
                sx={{
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 1.5,
                  p: '10px 12px',
                  border: `1px solid ${colour.border.default}`,
                  borderRadius: '8px',
                }}
              >
                <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 2, flexWrap: 'wrap' }}>
                  <Box component="span" sx={{ fontSize: 13, color: colour.text.secondary }}>
                    Sent {sent} · {count} {count === 1 ? 'shift' : 'shifts'}
                  </Box>
                  <StatusPill tone={state.tone}>{state.text}</StatusPill>
                </Box>
                {proposal.note ? (
                  <Box
                    component="p"
                    title={proposal.note}
                    sx={{ m: 0, fontSize: 13, fontStyle: 'italic', overflowWrap: 'anywhere' }}
                  >
                    Your note: {noteExcerpt(proposal.note)}
                  </Box>
                ) : null}
                <Box component="ul" sx={{ m: 0, p: 0, listStyle: 'none', display: 'flex', flexDirection: 'column', gap: 1.5 }}>
                  {proposal.items.map((item) => {
                    const decision = DECISION[item.decision] ?? DECISION.PENDING;
                    const line = decisionLine(item);
                    return (
                      <Box component="li" key={item.id} sx={{ display: 'flex', flexDirection: 'column', gap: 0.5 }}>
                        <Box sx={{ display: 'flex', alignItems: 'center', gap: 2, flexWrap: 'wrap' }}>
                          <Box component="span" sx={{ fontSize: 14, fontWeight: 600, overflowWrap: 'anywhere' }}>
                            {shiftLine(item.workDate, item.shiftTemplate, item.unitName)}
                          </Box>
                          <StatusPill tone={decision.tone}>{decision.text}</StatusPill>
                        </Box>
                        {line ? (
                          <Box component="span" sx={{ fontSize: 12, color: colour.text.secondary, overflowWrap: 'anywhere' }}>
                            {line}
                          </Box>
                        ) : null}
                      </Box>
                    );
                  })}
                </Box>
                {answered ? (
                  <Box component="span" sx={{ fontSize: 12, color: colour.text.secondary }}>
                    Part of this proposal has been answered. To change the rest, ask your supervisor.
                  </Box>
                ) : null}
                {proposal.canWithdraw ? (
                  <Box>
                    <Button
                      size="small"
                      variant="outlined"
                      color="primary"
                      onClick={() => {
                        setMessage(null);
                        setConfirming(proposal);
                      }}
                      aria-label={`Withdraw the proposal sent ${sent}`}
                    >
                      Withdraw
                    </Button>
                  </Box>
                ) : null}
              </Box>
            );
          })}
        </Box>
      ) : null}

      <Dialog open={confirming !== null} onClose={() => (working ? undefined : setConfirming(null))} fullWidth maxWidth="xs">
        <DialogTitle sx={{ fontSize: 18, fontWeight: 700 }}>Withdraw this proposal?</DialogTitle>
        <DialogContent>
          <Typography sx={{ fontSize: 14 }}>
            {confirming
              ? `${confirming.items.length === 1 ? 'The shift' : `All ${confirming.items.length} shifts`} sent ${sentWhen(confirming.submittedAt)} will be withdrawn. You can propose again later.`
              : ''}
          </Typography>
        </DialogContent>
        <DialogActions sx={{ px: 3, pb: 3 }}>
          <Button variant="outlined" color="primary" onClick={() => setConfirming(null)} disabled={working}>
            Keep it
          </Button>
          <Button
            variant="contained"
            color="primary"
            onClick={() => (confirming ? void withdraw(confirming) : undefined)}
            disabled={working}
          >
            Withdraw proposal
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
}
