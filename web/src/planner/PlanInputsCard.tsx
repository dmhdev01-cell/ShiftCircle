import { useId, useState, type ReactNode } from 'react';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Card from '@mui/material/Card';
import CardContent from '@mui/material/CardContent';
import Typography from '@mui/material/Typography';

import type { PlanInputs } from '../api/types';
import { colour } from '../theme/tokens';
import { plainDate } from './plannerTime';
import {
  changedSince,
  inputsHeadline,
  LEAVE_WORDS,
  neededWords,
  optionsLine,
  optionWords,
  TIME_WORDS,
} from './planInputsWords';

const cell = { padding: '6px 8px', verticalAlign: 'top' as const };
const head = {
  ...cell,
  textAlign: 'left' as const,
  fontSize: 12,
  fontWeight: 600,
  color: colour.text.secondary,
  borderBottom: `1px solid ${colour.border.default}`,
};

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <Box component="section" sx={{ display: 'flex', flexDirection: 'column', gap: 1, minWidth: 0 }}>
      <Typography component="h3" sx={{ m: 0, fontSize: 14, fontWeight: 700 }}>
        {title}
      </Typography>
      {children}
    </Box>
  );
}

function Figure({ label, value }: { label: string; value: string }) {
  return (
    <Box sx={{ display: 'flex', justifyContent: 'space-between', gap: 2, fontSize: 13 }}>
      <span>{label}</span>
      <span className="num" style={{ fontWeight: 600 }}>
        {value}
      </span>
    </Box>
  );
}

/**
 * Plan inputs (PR-M): what the quarter generator works from, so the plan is
 * not a black box. The headline is always visible; the detail opens on
 * request. Counts only: no officer is named. With a draft, `inputs` is the
 * draft's own snapshot and `live` (when sent) is what Generate would use now.
 */
export function PlanInputsCard({
  inputs,
  live,
  fromDraft,
  draftWithoutRecord = false,
}: {
  inputs: PlanInputs;
  live?: PlanInputs | null;
  fromDraft: boolean;
  /** A draft from before v1.2 is open and kept no inputs record: the card shows today's. */
  draftWithoutRecord?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const regionId = useId();
  const changed = fromDraft && live ? changedSince(inputs, live) : null;
  const leaveTypes = Object.entries(inputs.leave.byType).filter(([, days]) => days > 0);
  const lengths = Object.entries(inputs.preferences.shiftLength).sort(
    ([a], [b]) => Number(a) - Number(b),
  );
  const anyClosed = inputs.units.some((unit) => unit.closedDays > 0);
  const needed = neededWords(inputs);

  return (
    <Card aria-labelledby={`${regionId}-title`} sx={{ borderLeft: `4px solid ${colour.brand.primary}` }}>
      <CardContent sx={{ p: 4, display: 'flex', flexDirection: 'column', gap: 1.5 }}>
        <Typography
          id={`${regionId}-title`}
          component="h2"
          sx={{ m: 0, fontSize: 12, fontWeight: 700, letterSpacing: '0.06em', textTransform: 'uppercase', color: colour.text.secondary }}
        >
          {fromDraft
            ? 'Plan inputs · what this draft was generated with'
            : draftWithoutRecord
              ? 'Plan inputs · what Generate would use now (this draft kept no record of its own)'
              : 'Plan inputs · what Generate will use'}
        </Typography>
        <Typography data-testid="plan-inputs-headline" sx={{ fontSize: 17, fontWeight: 700, lineHeight: 1.35 }}>
          {inputsHeadline(inputs)}
        </Typography>
        <Typography sx={{ fontSize: 13, color: colour.text.secondary }}>
          {optionsLine(inputs, fromDraft)} · {inputs.leave.days.toLocaleString('en-CA')} planned leave{' '}
          {inputs.leave.days === 1 ? 'day' : 'days'} · {inputs.preferences.officers.toLocaleString('en-CA')}{' '}
          {inputs.preferences.officers === 1 ? 'officer has' : 'officers have'} preferences on file
        </Typography>

        {changed ? (
          <Box
            role="note"
            sx={{
              p: '8px 12px',
              borderRadius: '8px',
              backgroundColor: colour.status.warn.bg,
              color: colour.status.warn.text,
              fontSize: 13,
              fontWeight: 600,
            }}
          >
            The plan&apos;s inputs have changed since this draft was generated: now {changed}.
            Generate again to plan with them.
          </Box>
        ) : null}

        <Box>
          <Button
            variant="text"
            color="primary"
            aria-expanded={open}
            aria-controls={`${regionId}-detail`}
            onClick={() => setOpen((value) => !value)}
            sx={{ px: 0, minHeight: 44, fontWeight: 700 }}
          >
            {open ? 'Hide plan inputs' : 'Show plan inputs'}
          </Button>
        </Box>

        {open ? (
          <Box
            id={`${regionId}-detail`}
            role="region"
            aria-label="Plan inputs detail"
            sx={{ display: 'flex', flexDirection: 'column', gap: 3 }}
          >
            <Section title="Officers by unit">
              <Box sx={{ overflowX: 'auto' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
                  <thead>
                    <tr>
                      <th scope="col" style={head}>Unit</th>
                      <th scope="col" style={{ ...head, textAlign: 'right' }}>Full-time</th>
                      <th scope="col" style={{ ...head, textAlign: 'right' }}>Part-time or casual</th>
                      <th scope="col" style={{ ...head, textAlign: 'right' }}>FTE</th>
                      <th scope="col" style={head}>Shift patterns</th>
                      <th scope="col" style={head}>Minimum night · day · evening</th>
                      {anyClosed ? <th scope="col" style={{ ...head, textAlign: 'right' }}>Closed days</th> : null}
                    </tr>
                  </thead>
                  <tbody>
                    {inputs.units.map((unit) => (
                      <tr key={unit.code} style={{ borderBottom: `1px solid ${colour.border.default}` }}>
                        <th scope="row" style={{ ...cell, textAlign: 'left', fontWeight: 600 }}>
                          {unit.name}
                        </th>
                        <td className="num" style={{ ...cell, textAlign: 'right' }}>{unit.fullTime}</td>
                        <td className="num" style={{ ...cell, textAlign: 'right' }}>{unit.partTime}</td>
                        <td className="num" style={{ ...cell, textAlign: 'right' }}>{unit.fte}</td>
                        <td style={cell}>
                          {unit.groups.length === 0 ? (
                            <span style={{ color: colour.text.secondary }}>No officers</span>
                          ) : (
                            <ul style={{ margin: 0, paddingLeft: 16 }}>
                              {unit.groups.map((group) => (
                                <li key={`${group.employment}-${group.pattern}`}>
                                  {group.officers} {group.employment === 'FULL_TIME' ? 'full-time' : 'part-time or casual'},{' '}
                                  {group.patternWords}
                                </li>
                              ))}
                            </ul>
                          )}
                        </td>
                        <td className="num" style={cell}>
                          {unit.minimums.NIGHT} · {unit.minimums.DAY} · {unit.minimums.EVENING}
                        </td>
                        {anyClosed ? (
                          <td className="num" style={{ ...cell, textAlign: 'right' }}>{unit.closedDays}</td>
                        ) : null}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </Box>
              <Typography sx={{ fontSize: 12, color: colour.text.secondary }}>
                Full-time is 1.0 FTE. The generator treats every officer under 1.0 FTE the same way,
                part-time or casual. Minimums are officers on duty through each block, every day.
              </Typography>
            </Section>

            <Box sx={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 3 }}>
              <Section title="Planned leave in the quarter">
                <Figure label="Leave days" value={inputs.leave.days.toLocaleString('en-CA')} />
                {leaveTypes.map(([type, days]) => (
                  <Figure key={type} label={`· ${LEAVE_WORDS[type] ?? type}`} value={days.toLocaleString('en-CA')} />
                ))}
                <Figure label="Officers with leave" value={inputs.leave.officers.toLocaleString('en-CA')} />
                <Typography sx={{ fontSize: 12, color: colour.text.secondary }}>
                  An officer is never rostered on a leave day.
                </Typography>
              </Section>

              <Section title="Preferences on file">
                <Figure label="Officers with any preference" value={String(inputs.preferences.officers)} />
                {lengths.map(([length, officers]) => (
                  <Figure
                    key={length}
                    label={`· ${length} h shifts${length === '16' ? ' (not rostered)' : ''}`}
                    value={String(officers)}
                  />
                ))}
                {Object.entries(inputs.preferences.timesOfDay).map(([time, officers]) => (
                  <Figure key={time} label={`· ${TIME_WORDS[time] ?? time}`} value={String(officers)} />
                ))}
                <Figure label="· Days off" value={String(inputs.preferences.daysOffOfficers)} />
                <Typography sx={{ fontSize: 12, color: colour.text.secondary }}>
                  Wishes, not guarantees. A 16 h day is a 12 h shift plus an extension, so a 16 h
                  wish is shown unmet.
                </Typography>
              </Section>

              <Section title="Seniority and rules">
                <Figure
                  label="Seniority from"
                  value={inputs.seniority.earliest ? plainDate(inputs.seniority.earliest) : '—'}
                />
                <Figure
                  label="Newest hired"
                  value={inputs.seniority.latest ? plainDate(inputs.seniority.latest) : '—'}
                />
                <Figure label="Rule set" value={`v${inputs.rules.ruleSetVersion}`} />
                <Figure label="Pay periods" value={String(inputs.window.periods)} />
                {needed ? <Figure label="Staffing floor" value={needed.replace(/^about /, '')} /> : null}
              </Section>

              <Section title={fromDraft ? 'Generate options used' : 'Generate options'}>
                {optionWords(inputs.options, fromDraft).map((option) => (
                  <Figure key={option.key} label={option.label} value={option.value} />
                ))}
              </Section>
            </Box>

            <Section title="How the plan is filled">
              <Box component="ol" sx={{ m: 0, pl: 3, display: 'flex', flexDirection: 'column', gap: 1, fontSize: 14 }}>
                {inputs.rules.fillOrder.map((step) => (
                  <li key={step}>{step}</li>
                ))}
              </Box>
            </Section>
          </Box>
        ) : null}
      </CardContent>
    </Card>
  );
}
