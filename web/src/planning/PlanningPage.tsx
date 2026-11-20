import { useState } from 'react';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Card from '@mui/material/Card';
import CardContent from '@mui/material/CardContent';
import Dialog from '@mui/material/Dialog';
import DialogActions from '@mui/material/DialogActions';
import DialogContent from '@mui/material/DialogContent';
import DialogTitle from '@mui/material/DialogTitle';
import Typography from '@mui/material/Typography';

import { shiftTemplates } from '../api/shiftTemplates';
import type { OfficerRow } from '../api/types';
import { colour } from '../theme/tokens';
import { KpiTile } from './KpiTile';
import { OverrideDialog } from './OverrideDialog';
import { RosterGrid } from './RosterGrid';
import { RuleCheckPanel } from './RuleCheckPanel';
import { useRuleCheckedMutation } from './useRuleCheckedMutation';
import { useSchedule } from './useSchedule';

/** Saskatchewan does not observe daylight saving, so the offset is always -06:00. */
const REGINA_OFFSET = '-06:00';

const BLOCK_LABEL = { DAY: 'days', EVENING: 'evenings', NIGHT: 'nights' } as const;

function weekday(date: string): string {
  return new Intl.DateTimeFormat('en-CA', { weekday: 'short', timeZone: 'UTC' }).format(
    new Date(`${date}T00:00:00Z`),
  );
}

function longDay(date: string): string {
  const parsed = new Date(`${date}T00:00:00Z`);
  const dow = new Intl.DateTimeFormat('en-CA', { weekday: 'short', timeZone: 'UTC' }).format(parsed);
  const day = new Intl.DateTimeFormat('en-CA', { day: 'numeric', timeZone: 'UTC' }).format(parsed);
  const month = new Intl.DateTimeFormat('en-CA', { month: 'short', timeZone: 'UTC' }).format(parsed);
  return `${dow} ${day} ${month}`;
}

interface Pending {
  officer: OfficerRow;
  date: string;
  template: string;
}

/**
 * The planning board (docs/ui/README.md §5.1). It reads the schedule through
 * the api client, so the same screen works against the real api once
 * `GET /schedule` exists.
 */
export function PlanningPage() {
  const { state, reload } = useSchedule();
  const mutation = useRuleCheckedMutation();
  const [pending, setPending] = useState<Pending | null>(null);
  const [overrideOpen, setOverrideOpen] = useState(false);

  if (state.kind === 'loading') {
    return (
      <>
        <Typography variant="h1">Planning board</Typography>
        <Card>
          <CardContent sx={{ p: 4, display: 'flex', flexDirection: 'column', gap: 2 }}>
            <Typography sx={{ fontSize: 14, color: colour.text.secondary }} role="status">
              Loading the schedule…
            </Typography>
            <Box sx={{ height: 240, backgroundColor: colour.bg.subtle, borderRadius: '4px' }} />
          </CardContent>
        </Card>
      </>
    );
  }

  if (state.kind === 'error') {
    return (
      <>
        <Typography variant="h1">Planning board</Typography>
        <Card>
          <CardContent sx={{ p: 4, display: 'flex', flexDirection: 'column', gap: 2 }}>
            <Typography sx={{ fontWeight: 600, fontSize: 15, color: colour.status.block.text }}>
              Could not load the schedule
            </Typography>
            <Typography sx={{ fontSize: 14, color: colour.text.secondary }}>{state.message}</Typography>
            <Box>
              <Button variant="outlined" color="primary" onClick={reload}>
                Try again
              </Button>
            </Box>
          </CardContent>
        </Card>
      </>
    );
  }

  const payload = state.payload;
  const today = payload.asOf;

  const gapBlocks = payload.coverage.filter((block) => !block.covered);
  const gapNote = gapBlocks
    .map((block) => `${weekday(block.date)} ${BLOCK_LABEL[block.block]}`)
    .join(', ');
  const inOvertime = payload.officers.filter((officer) => officer.overtimeStatus === 'IN_OVERTIME');
  const approaching = payload.officers.filter((officer) => officer.overtimeStatus === 'APPROACHING');
  const threshold = payload.officers[0]?.payPeriodThreshold ?? 80;

  const startChoose = (officer: OfficerRow, date: string) => {
    setPending({ officer, date, template: 'D8' });
  };

  const chooseTemplate = (template: string) => {
    if (!pending) return;
    const chosen = { ...pending, template };
    setPending(chosen);
    mutation.preview({
      type: 'ASSIGN',
      employeeId: chosen.officer.employeeId,
      unitId: payload.unit.id,
      shiftTemplate: chosen.template,
      startAt: `${chosen.date}T${shiftTemplates[chosen.template].start}:00${REGINA_OFFSET}`,
    });
  };

  const cancelChange = () => {
    setPending(null);
    mutation.reset();
  };

  const template = pending ? shiftTemplates[pending.template] : undefined;
  const panelTitle = pending
    ? `Assign ${pending.officer.name} → ${template?.label ?? pending.template}`
    : '';
  const panelDetail =
    pending && template
      ? `${payload.unit.name} · ${longDay(pending.date)} · ${template.start} – ${template.end}${template.endsNextDay ? ' +1' : ''}`
      : '';

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
          <Typography variant="h1">Planning board</Typography>
          <Typography sx={{ fontSize: 14, color: colour.text.secondary }}>
            {payload.unit.name} · Week of {longDay(payload.from)} – {longDay(payload.to)} ·{' '}
            <strong style={{ color: colour.text.primary }}>
              {payload.publishedState.published ? 'Published' : 'Draft'}
            </strong>
            {payload.publishedState.unpublishedChanges
              ? `, ${payload.publishedState.unpublishedChanges} unpublished changes`
              : ''}
          </Typography>
        </Box>

        <Box sx={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 2.5 }}>
          <Box
            sx={{
              display: 'flex',
              flexDirection: 'column',
              gap: 1,
              fontSize: 12,
              fontWeight: 600,
              color: colour.text.secondary,
            }}
          >
            Unit
            <Box
              component="select"
              aria-label="Unit"
              value={payload.unit.id}
              sx={{
                minHeight: 44,
                px: 3,
                border: `1px solid ${colour.border.input}`,
                borderRadius: '2px',
                fontFamily: 'inherit',
                fontSize: 14,
                fontWeight: 500,
                color: colour.text.primary,
                backgroundColor: colour.bg.surface,
              }}
            >
              <option value={payload.unit.id}>{payload.unit.name}</option>
            </Box>
          </Box>
        </Box>
      </Box>

      <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 3 }}>
        <KpiTile label="Coverage gaps" value={gapBlocks.length} note={gapNote} />
        <KpiTile label="In overtime" value={inOvertime.length} note="this pay period" />
        <KpiTile
          label="Approaching overtime"
          value={approaching.length}
          note={`within 8 h of ${threshold} h`}
        />
        <KpiTile label="Rule warnings" value={payload.warnings} note="on the published week" />
        <KpiTile
          label="Overrides this period"
          value={payload.overridesThisPeriod}
          note="emergency, with reason"
        />
      </Box>

      <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 5, alignItems: 'flex-start' }}>
        <Box sx={{ flex: '999 1 640px', minWidth: 0 }}>
          <RosterGrid payload={payload} today={today} onEmptyCell={startChoose} />
        </Box>

        <Box sx={{ flex: '1 1 320px', minWidth: 0, display: 'flex', flexDirection: 'column', gap: 4 }}>
          {mutation.state.kind === 'idle' ? (
            <Card>
              <CardContent sx={{ p: 4, display: 'flex', flexDirection: 'column', gap: 2 }}>
                <Typography sx={{ fontWeight: 600, fontSize: 15 }}>Rule check</Typography>
                <Typography sx={{ fontSize: 14, color: colour.text.secondary }}>
                  Pick an empty cell to propose a shift. The rules are checked before anything is
                  saved, and a rule that blocks the change has to be overridden with a written
                  reason.
                </Typography>
              </CardContent>
            </Card>
          ) : (
            <RuleCheckPanel
              state={mutation.state}
              title={panelTitle}
              detail={panelDetail}
              onSave={() => {
                if (mutation.state.change) void mutation.save(mutation.state.change);
              }}
              onAcknowledge={(codes) => {
                if (mutation.state.change) {
                  void mutation.save(mutation.state.change, { acknowledgeWarnings: codes });
                }
              }}
              onOverride={() => setOverrideOpen(true)}
              onCancel={cancelChange}
            />
          )}
        </Box>
      </Box>

      <Dialog
        open={pending !== null && mutation.state.kind === 'idle'}
        onClose={cancelChange}
        fullWidth
        maxWidth="xs"
      >
        <DialogTitle sx={{ fontSize: 18, fontWeight: 700 }}>
          {pending ? `Assign a shift to ${pending.officer.name}` : 'Assign a shift'}
        </DialogTitle>
        <DialogContent>
          <Typography sx={{ fontSize: 13, color: colour.text.secondary, mb: 2 }}>
            {pending
              ? `${payload.unit.name} · ${longDay(pending.date)}. The rules are checked before the shift is saved.`
              : ''}
          </Typography>
          <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
            {Object.values(shiftTemplates).map((option) => (
              <Button
                key={option.code}
                variant="outlined"
                color="primary"
                onClick={() => chooseTemplate(option.code)}
                sx={{ justifyContent: 'space-between' }}
              >
                <span>
                  {option.code} · {option.label}
                </span>
                <span className="num">
                  {option.start} – {option.end}
                  {option.endsNextDay ? ' +1' : ''}
                </span>
              </Button>
            ))}
          </Box>
        </DialogContent>
        <DialogActions sx={{ px: 3, pb: 3 }}>
          <Button variant="outlined" color="primary" onClick={cancelChange}>
            Cancel
          </Button>
        </DialogActions>
      </Dialog>

      <OverrideDialog
        open={overrideOpen}
        ruleCodes={
          mutation.state.outcome?.ruleResults
            .filter((result) => result.outcome === 'BLOCK')
            .map((result) => result.ruleCode) ?? []
        }
        onClose={() => setOverrideOpen(false)}
        onConfirm={(reason) => {
          setOverrideOpen(false);
          if (mutation.state.change) {
            void mutation.save(mutation.state.change, { override: { reason } });
          }
        }}
      />
    </>
  );
}
