import { useCallback, useEffect, useId, useState } from 'react';
import { Link } from 'react-router-dom';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Checkbox from '@mui/material/Checkbox';
import FormControlLabel from '@mui/material/FormControlLabel';
import Radio from '@mui/material/Radio';
import RadioGroup from '@mui/material/RadioGroup';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';

import { api, ApiError } from '../api/client';
import { ruleNameFor } from '../api/shiftTemplates';
import type {
  OvertimeStatus,
  ProposalDecisionInput,
  ProposalDetail,
  ProposalDetailItem,
  ProposalRefusalItem,
  RuleResult,
} from '../api/types';
import { StatusPill } from '../components/StatusPill';
import { DECISION, DISPLAY_STATE, dayLabel, decisionLine, sentWhen, shiftLine } from '../myschedule/proposalWords';
import { colour } from '../theme/tokens';
import {
  MAX_COMMENT,
  OUTCOME_TONE,
  currentMatch,
  currentRule,
  flaggedCodes,
  itemNeeds,
  openShiftLine,
  ordinal,
  overtimeLine,
  resultChanged,
  ruleLabel,
  sendLabel,
  wasNowLine,
} from './inboxWords';
import type { ItemDraft } from './inboxWords';
import { notifyProposalsChanged } from './useProposalCount';

type DetailState =
  | { kind: 'loading' }
  | { kind: 'ready'; detail: ProposalDetail }
  | { kind: 'error'; message: string; status: number };

const OT_PILL: Record<OvertimeStatus, { text: string; tone: 'under' | 'warn' | 'ot' }> = {
  UNDER: { text: 'Under', tone: 'under' },
  APPROACHING: { text: 'Approaching', tone: 'warn' },
  IN_OVERTIME: { text: 'In overtime', tone: 'ot' },
};

const EMPTY_DRAFT: ItemDraft = {
  choice: undefined,
  comment: '',
  acknowledgedWarnings: [],
  acknowledgedOrder: false,
};

function firstNameOf(name: string): string {
  return name.split(' ')[0] || name;
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : 'The request failed.';
}

/** "9 – 22 Nov" for a pay period. */
function periodWords(start: string, end: string): string {
  return `${dayLabel(start).split(' ').slice(1).join(' ')} – ${dayLabel(end).split(' ').slice(1).join(' ')}`;
}

/** The Warn and Block rows of a result, one per rule, with the api's message as text. */
function FlaggedRules({ results }: { results: RuleResult[] }) {
  const seen = new Set<string>();
  const rows = results
    .filter((result) => result.outcome === 'BLOCK' || result.outcome === 'WARN')
    .sort((a, b) => (a.outcome === b.outcome ? 0 : a.outcome === 'BLOCK' ? -1 : 1))
    .filter((result) => {
      const key = `${result.outcome}:${result.ruleCode}:${result.message}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  if (rows.length === 0) return null;
  return (
    <Box component="ul" sx={{ listStyle: 'none', m: 0, p: 0, display: 'flex', flexDirection: 'column', gap: 1 }}>
      {rows.map((result) => (
        <Box
          component="li"
          key={`${result.outcome}:${result.ruleCode}:${result.message}`}
          sx={{ display: 'flex', flexWrap: 'wrap', alignItems: 'baseline', gap: '4px 10px', fontSize: 13 }}
        >
          <StatusPill tone={OUTCOME_TONE[result.outcome]}>
            {result.outcome === 'BLOCK' ? 'Block' : 'Warn'}
          </StatusPill>
          <Box component="span" sx={{ fontSize: 12, fontWeight: 600, color: colour.text.secondary }}>
            {result.ruleCode}
            {ruleNameFor(result.ruleCode) ? ` · ${ruleNameFor(result.ruleCode)}` : ''}
          </Box>
          <Box component="span" sx={{ flex: '1 1 260px', minWidth: 0, lineHeight: 1.45 }}>
            {result.message}
          </Box>
        </Box>
      ))}
    </Box>
  );
}

interface ItemRowProps {
  item: ProposalDetailItem;
  firstName: string;
  fresh: ProposalRefusalItem | undefined;
  draft: ItemDraft;
  onChange: (next: ItemDraft) => void;
  /** Other shifts of this proposal still wait: "rules now" assumes they are approved too. */
  withOthers: boolean;
}

function ItemRow({ item, firstName, fresh, draft, onChange, withOthers }: ItemRowProps) {
  const commentId = useId();
  const what = `${shiftLine(item.workDate, item.shiftTemplate, item.unitName)} · extra`;

  if (!item.inScope) {
    const decision = DECISION[item.decision];
    return (
      <Box component="li" aria-label={what} sx={rowSx}>
        <Box sx={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 2 }}>
          <Box component="span" sx={{ fontWeight: 700, fontSize: 14 }}>
            {what}
          </Box>
          <StatusPill tone={decision.tone}>{decision.text}</StatusPill>
        </Box>
        <Typography sx={{ fontSize: 13, color: colour.text.secondary }}>
          Not on your units: Unit {item.unit}&apos;s supervisor or the planner decides it.
        </Typography>
      </Box>
    );
  }

  if (item.decision !== 'PENDING') {
    const decision = DECISION[item.decision];
    const line = decisionLine(item);
    return (
      <Box component="li" aria-label={what} sx={rowSx}>
        <Box sx={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 2 }}>
          <Box component="span" sx={{ fontWeight: 700, fontSize: 14 }}>
            {what}
          </Box>
          <StatusPill tone={decision.tone}>{decision.text}</StatusPill>
        </Box>
        {line ? (
          <Typography sx={{ fontSize: 13, color: colour.text.secondary, overflowWrap: 'anywhere' }}>
            {line.replace('The shift is on your schedule.', 'The shift is on the planning board.')}
          </Typography>
        ) : null}
        {item.decision === 'ACCEPTED' && item.outOfOvertimeOrder ? (
          <Typography sx={{ fontSize: 13, color: colour.text.secondary }}>
            Approved outside the overtime order (recorded in the audit log).
          </Typography>
        ) : null}
        {item.decision === 'ACCEPTED' ? (
          // Always there for an approved shift, not only right after sending.
          <Box
            component={Link}
            to={`/planning?unit=${encodeURIComponent(item.unitId)}&week=${item.workDate}`}
            sx={{ fontSize: 13, color: colour.brand.link, fontWeight: 600 }}
          >
            Open the board for the week of {dayLabel(item.workDate)}
          </Box>
        ) : null}
      </Box>
    );
  }

  const now = currentRule(item, fresh);
  const changed = fresh ? resultChanged(item, now) : item.ruleChanged;
  const blocked = now?.outcome === 'BLOCK';
  const warnCodes = flaggedCodes(now?.ruleResults, 'WARN');
  const match = currentMatch(item, fresh);
  const outOfOrder = match?.outOfOrder ?? false;
  const position = match?.otOrderPosition ?? null;
  const size = match?.otOrderSize ?? 0;
  const overtime = overtimeLine(item, firstName);
  const warnAcknowledged = warnCodes.every((code) => draft.acknowledgedWarnings.includes(code));

  return (
    <Box component="li" aria-label={what} sx={rowSx}>
      <Box component="span" sx={{ fontWeight: 700, fontSize: 14 }}>
        {what}
      </Box>

      <Box
        role="group"
        aria-label="Rule result"
        sx={{
          display: 'flex',
          flexWrap: 'wrap',
          alignItems: 'center',
          gap: '6px 12px',
          p: '8px 10px',
          borderRadius: '8px',
          backgroundColor: changed ? colour.status.warn.bg : colour.bg.subtle,
          border: changed ? `1px solid ${colour.status.warn.text}` : `1px solid ${colour.border.default}`,
          fontSize: 13,
        }}
      >
        <Box component="span" sx={{ color: colour.text.secondary }}>
          Rules when sent
        </Box>
        <StatusPill tone={item.outcomeAtSubmit ? OUTCOME_TONE[item.outcomeAtSubmit] : 'info'}>
          {ruleLabel(item.outcomeAtSubmit, item.ruleAtSubmit?.ruleResults)}
        </StatusPill>
        <Box component="span" sx={{ color: colour.text.secondary }}>
          Rules now
        </Box>
        <StatusPill tone={now ? OUTCOME_TONE[now.outcome] : 'info'}>
          {ruleLabel(now?.outcome, now?.ruleResults)}
        </StatusPill>
        {changed ? (
          <Box component="strong" sx={{ flexBasis: '100%', color: colour.status.warn.text }}>
            Changed since it was sent: {wasNowLine(item, now, true)}
          </Box>
        ) : null}
      </Box>

      {withOthers && !fresh ? (
        <Box component="span" sx={{ fontSize: 12, color: colour.text.secondary }}>
          Rules now count the earlier shifts of this proposal as approved while they wait
          (docs/07 §4.4); sending re-checks with only the shifts you approve.
        </Box>
      ) : null}

      {now ? <FlaggedRules results={now.ruleResults} /> : null}

      {overtime ? (
        <Box sx={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 1.5, fontSize: 13 }}>
          <span>{overtime}</span>
          {item.payPeriod ? (
            <Box component="span" sx={{ color: colour.text.secondary }}>
              (pay period {periodWords(item.payPeriod.start, item.payPeriod.end)})
            </Box>
          ) : null}
        </Box>
      ) : null}

      <Typography sx={{ fontSize: 13, color: colour.text.secondary }}>
        {openShiftLine(match, firstName)}
      </Typography>

      {item.canDecide ? (
        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1.5 }}>
          <Box component="fieldset" sx={{ border: 0, m: 0, p: 0, minWidth: 0 }}>
            <Box component="legend" sx={{ fontSize: 13, fontWeight: 600, p: 0, mb: 0.5 }}>
              Your decision
            </Box>
            <RadioGroup
              row
              name={`decision-${item.id}`}
              value={draft.choice ?? ''}
              onChange={(event) =>
                onChange({ ...draft, choice: event.target.value as 'accept' | 'decline' })
              }
            >
              <FormControlLabel
                value="accept"
                control={<Radio />}
                label="Approve"
                disabled={blocked}
              />
              <FormControlLabel value="decline" control={<Radio />} label="Decline" />
            </RadioGroup>
          </Box>

          {blocked ? (
            <Box
              role="note"
              sx={{
                p: '8px 10px',
                borderRadius: '8px',
                backgroundColor: colour.status.block.bg,
                color: colour.status.block.text,
                fontSize: 13,
                lineHeight: 1.45,
              }}
            >
              Blocked now: a shift that breaks a Block rule can&apos;t be approved from a proposal.
              Decline it. If the shift is truly needed, decline it and use the planning board,
              which has its own emergency override.
            </Box>
          ) : null}

          {draft.choice === 'accept' && !blocked && warnCodes.length > 0 ? (
            <FormControlLabel
              control={
                <Checkbox
                  checked={warnAcknowledged}
                  onChange={(event) =>
                    onChange({
                      ...draft,
                      acknowledgedWarnings: event.target.checked ? warnCodes : [],
                    })
                  }
                />
              }
              label={`I acknowledge the ${warnCodes.length === 1 ? 'warning' : 'warnings'} (${warnCodes.join(', ')}) and approve anyway`}
            />
          ) : null}

          {draft.choice === 'accept' && !blocked && outOfOrder ? (
            <FormControlLabel
              control={
                <Checkbox
                  checked={draft.acknowledgedOrder}
                  onChange={(event) =>
                    onChange({ ...draft, acknowledgedOrder: event.target.checked })
                  }
                />
              }
              label={
                position
                  ? `I'm approving outside the overtime order (${firstName} is ${ordinal(position)} of ${size})`
                  : `I'm approving outside the overtime order (${firstName} is not eligible in it)`
              }
            />
          ) : null}

          {draft.choice ? (
            <>
              <TextField
                label={
                  draft.choice === 'decline'
                    ? `Comment for ${firstName} (required)`
                    : `Comment for ${firstName} (optional)`
                }
                multiline
                minRows={2}
                fullWidth
                value={draft.comment}
                onChange={(event) => onChange({ ...draft, comment: event.target.value })}
                error={draft.comment.trim().length > MAX_COMMENT}
                slotProps={{ htmlInput: { 'aria-describedby': commentId } }}
              />
              <Box id={commentId} component="span" sx={{ fontSize: 12, color: colour.text.secondary }}>
                {draft.comment.length}/{MAX_COMMENT} · {firstName} sees this comment. Don&apos;t
                include medical details.
              </Box>
            </>
          ) : null}
        </Box>
      ) : null}
    </Box>
  );
}

const rowSx = {
  display: 'flex',
  flexDirection: 'column',
  gap: 1.5,
  p: '12px 14px',
  border: `1px solid ${colour.border.default}`,
  borderRadius: '10px',
  minWidth: 0,
} as const;

/**
 * The selected proposal (plan v1.3 §3.2): who, their pay-period hours, the
 * note, and each shift with its rules when sent and now, the overtime it would
 * add and its open-shift match, with Approve or Decline and a comment.
 *
 * The decision re-runs the rules on the api. A refusal (422) carries each
 * approved shift's fresh result, which replaces "rules now" in place: a Block
 * can only be declined (there is no override here, by the owner's decision),
 * a new Warn needs acknowledging, and approving someone who is not first in
 * the overtime order needs its own confirmation. Nothing is auto-approved.
 */
export function ProposalDetailPane({
  proposalId,
  onDecided,
}: {
  proposalId: string;
  onDecided: () => void;
}) {
  const [state, setState] = useState<DetailState>({ kind: 'loading' });
  const [drafts, setDrafts] = useState<Record<string, ItemDraft>>({});
  const [fresh, setFresh] = useState<Record<string, ProposalRefusalItem>>({});
  const [refusal, setRefusal] = useState<string | null>(null);
  const [sent, setSent] = useState<{ accepted: ProposalDetailItem[] } | null>(null);
  const [sending, setSending] = useState(false);

  const load = useCallback(() => {
    let active = true;
    api
      .getProposal(proposalId)
      .then((detail) => {
        if (active) setState({ kind: 'ready', detail });
      })
      .catch((error: unknown) => {
        if (!active) return;
        setState({
          kind: 'error',
          message: messageOf(error),
          status: error instanceof ApiError ? error.status : 0,
        });
      });
    return () => {
      active = false;
    };
  }, [proposalId]);

  useEffect(() => load(), [load]);

  if (state.kind === 'loading') {
    return (
      <Typography role="status" sx={{ fontSize: 14, color: colour.text.secondary }}>
        Loading the proposal…
      </Typography>
    );
  }
  if (state.kind === 'error') {
    return (
      <Typography role="alert" sx={{ fontSize: 14, color: colour.status.block.text }}>
        {state.status === 404
          ? 'This proposal is not in your inbox: it is on units outside your scope, or it no longer exists.'
          : `Could not load the proposal: ${state.message}`}
      </Typography>
    );
  }

  const detail = state.detail;
  const firstName = firstNameOf(detail.officerName);
  const decidable = detail.items.filter((item) => item.canDecide);
  const pill = DISPLAY_STATE[detail.displayState] ?? DISPLAY_STATE.WAITING;
  const pay = detail.items.find((item) => item.payPeriod)?.payPeriod ?? null;

  const draftOf = (id: string) => drafts[id] ?? EMPTY_DRAFT;
  // The items are in start order: "rules now" counts the waiting items before this one.
  const pendingIds = detail.items
    .filter((item) => item.inScope && item.decision === 'PENDING')
    .map((item) => item.id);
  const needs = decidable
    .map((item) => {
      const now = currentRule(item, fresh[item.id]);
      return itemNeeds({
        draft: drafts[item.id],
        outcome: now?.outcome,
        warnCodes: flaggedCodes(now?.ruleResults, 'WARN'),
        outOfOrder: currentMatch(item, fresh[item.id])?.outOfOrder ?? false,
      });
    })
    .find((reason) => reason !== null);
  const accepted = decidable.filter((item) => draftOf(item.id).choice === 'accept').length;
  const declined = decidable.filter((item) => draftOf(item.id).choice === 'decline').length;

  const send = async () => {
    // Send is off until every decidable shift has a choice; never read a
    // missing choice as an approval.
    if (decidable.some((item) => !draftOf(item.id).choice)) return;
    const items: ProposalDecisionInput[] = decidable.map((item) => {
      const draft = draftOf(item.id);
      const comment = draft.comment.trim();
      if (draft.choice !== 'accept') return { id: item.id, accept: false, comment };
      const outOfOrder = currentMatch(item, fresh[item.id])?.outOfOrder ?? false;
      return {
        id: item.id,
        accept: true,
        ...(comment ? { comment } : {}),
        // What the decider ticked, not computed for them (the api re-checks them).
        acknowledgeWarnings: draft.acknowledgedWarnings,
        ...(outOfOrder ? { acknowledgeOutOfOrder: draft.acknowledgedOrder } : {}),
      };
    });
    setSending(true);
    setRefusal(null);
    try {
      const result = await api.decideProposal(detail.id, detail.version, items);
      const acceptedIds = new Set(items.filter((entry) => entry.accept).map((entry) => entry.id));
      setSent({ accepted: result.items.filter((item) => acceptedIds.has(item.id)) });
      setDrafts({});
      setFresh({});
      setState({ kind: 'ready', detail: result });
      notifyProposalsChanged();
      onDecided();
    } catch (error) {
      if (error instanceof ApiError && error.status === 422 && error.problem?.items) {
        const next: Record<string, ProposalRefusalItem> = { ...fresh };
        for (const entry of error.problem.items) next[entry.id] = entry;
        setFresh(next);
        // A shift that is Blocked now can only be declined: clear its Approve,
        // so the next step (Decline, with a comment) is plain.
        const blockedNow = error.problem.items.filter((entry) => entry.outcome === 'BLOCK');
        if (blockedNow.length > 0) {
          setDrafts((current) => {
            const reset = { ...current };
            for (const entry of blockedNow) {
              reset[entry.id] = { ...(current[entry.id] ?? EMPTY_DRAFT), choice: undefined, acknowledgedWarnings: [], acknowledgedOrder: false };
            }
            return reset;
          });
        }
        setRefusal(
          `Not sent: ${error.problem.title}. The rules were checked again just now; each shift below shows the result. Nothing was saved.`,
        );
      } else {
        setRefusal(`Not sent: ${messageOf(error)}`);
        if (error instanceof ApiError && (error.status === 409 || error.status === 412)) {
          // Someone else answered, the officer withdrew, or a shift started: show what is true now.
          load();
        }
      }
    } finally {
      setSending(false);
    }
  };

  const firstAccepted = sent?.accepted[0];

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
      <Box sx={{ display: 'flex', flexWrap: 'wrap', justifyContent: 'space-between', gap: 2 }}>
        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
          <Typography component="h2" sx={{ m: 0, fontSize: 18, fontWeight: 700 }}>
            {detail.officerName}
          </Typography>
          <Box component="span" sx={{ fontSize: 13, color: colour.text.secondary }}>
            {[detail.homeUnit ? `Home unit ${detail.homeUnit}` : null, `Sent ${sentWhen(detail.submittedAt)}`]
              .filter(Boolean)
              .join(' · ')}
          </Box>
        </Box>
        <Box sx={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 1.5 }}>
          <StatusPill tone={pill.tone}>{pill.text}</StatusPill>
          {pay ? (
            <>
              <Box component="span" className="num" sx={{ fontSize: 13 }}>
                {pay.hoursBefore} h of {pay.thresholdHours} h this pay period
              </Box>
              <StatusPill tone={OT_PILL[pay.overtimeStatus]?.tone ?? 'under'}>
                {OT_PILL[pay.overtimeStatus]?.text ?? pay.overtimeStatus}
              </StatusPill>
            </>
          ) : null}
        </Box>
      </Box>

      {detail.note ? (
        <Box
          component="blockquote"
          sx={{
            m: 0,
            p: '8px 12px',
            borderLeft: `4px solid ${colour.border.input}`,
            backgroundColor: colour.bg.subtle,
            fontSize: 14,
            lineHeight: 1.5,
            whiteSpace: 'pre-wrap',
            overflowWrap: 'anywhere',
          }}
        >
          <Box component="span" sx={{ display: 'block', fontSize: 12, color: colour.text.secondary }}>
            Note from {firstName}
          </Box>
          {detail.note}
        </Box>
      ) : null}

      {detail.own ? (
        <Box
          role="note"
          sx={{
            p: '10px 12px',
            borderRadius: '8px',
            backgroundColor: colour.status.info.bg,
            color: colour.status.info.text,
            fontSize: 13,
            fontWeight: 600,
          }}
        >
          Yours: waiting for another supervisor or the planner. You can&apos;t approve your own
          proposal.
        </Box>
      ) : null}

      {sent ? (
        <Box
          role="status"
          sx={{
            display: 'flex',
            flexWrap: 'wrap',
            alignItems: 'center',
            gap: 2,
            p: '10px 12px',
            borderRadius: '8px',
            backgroundColor: colour.status.pass.bg,
            color: colour.status.pass.text,
            fontSize: 13,
            fontWeight: 600,
          }}
        >
          <span>
            {firstAccepted
              ? `Sent. Accepted shifts are on the planning board (each has a link below). ${firstName} sees the outcome on My schedule.`
              : `Sent. ${firstName} sees the outcome and your comment on My schedule.`}
          </span>
        </Box>
      ) : null}

      {refusal ? (
        <Box
          role="alert"
          sx={{
            p: '10px 12px',
            borderRadius: '8px',
            backgroundColor: colour.status.block.bg,
            color: colour.status.block.text,
            fontSize: 13,
            fontWeight: 600,
            lineHeight: 1.45,
          }}
        >
          {refusal}
        </Box>
      ) : null}

      <Box
        component="ul"
        aria-label="Shifts in this proposal"
        sx={{ listStyle: 'none', m: 0, p: 0, display: 'flex', flexDirection: 'column', gap: 2 }}
      >
        {detail.items.map((item) => (
          <ItemRow
            key={item.id}
            item={item}
            firstName={firstName}
            fresh={fresh[item.id]}
            draft={draftOf(item.id)}
            withOthers={pendingIds.indexOf(item.id) > 0}
            onChange={(next) => setDrafts((current) => ({ ...current, [item.id]: next }))}
          />
        ))}
      </Box>

      {decidable.length > 0 ? (
        <Box
          sx={{
            display: 'flex',
            flexWrap: 'wrap',
            alignItems: 'center',
            justifyContent: 'flex-end',
            gap: 2,
            pt: 2,
            borderTop: `1px solid ${colour.border.default}`,
          }}
        >
          {needs ? (
            <Box component="span" sx={{ fontSize: 13, color: colour.text.secondary, flex: '1 1 240px' }}>
              {needs}
            </Box>
          ) : null}
          <Button
            variant="contained"
            color="primary"
            disabled={Boolean(needs) || sending}
            onClick={() => void send()}
          >
            {sending ? 'Sending…' : sendLabel(accepted, declined)}
          </Button>
        </Box>
      ) : null}
    </Box>
  );
}
