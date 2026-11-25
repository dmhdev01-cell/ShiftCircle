import Box from '@mui/material/Box';
import Card from '@mui/material/Card';
import CardContent from '@mui/material/CardContent';
import Typography from '@mui/material/Typography';

import type { PlannerSupervisorsCard, PlannerTotals } from '../api/types';
import { KpiTile } from '../planning/KpiTile';
import { colour } from '../theme/tokens';
import { peopleWords } from './planInputsWords';

function count(value: number): string {
  return value.toLocaleString('en-CA');
}

/**
 * The scorecard's supervisor card (release v1.3 S7, from the api's
 * `scorecard.supervisors` and `scorecard.totals`). Every other card on the
 * scorecard counts the officers and the officer units only; this one counts the
 * supervisors and the supervisor posts, and its shifts are the shifts on the
 * posts. The last line gives everyone in the draft, split by rank.
 */
export function SupervisorPostsCard({
  card,
  totals,
}: {
  card: PlannerSupervisorsCard;
  totals?: PlannerTotals;
}) {
  const { coverage } = card;
  const asked = card.preferences.asked;
  const tiles: { label: string; value: string | number; note: string; tone?: 'warn' }[] = [
    {
      label: 'Posts covered',
      value: `${count(coverage.coveredBlockDays)} of ${count(coverage.totalBlockDays)}`,
      note: `block-days; ${count(coverage.shortBlockDays)} short`,
      tone: coverage.shortBlockDays > 0 ? 'warn' : undefined,
    },
    {
      label: 'Supervisors',
      value: card.supervisors,
      note: `on ${card.posts} ${card.posts === 1 ? 'post' : 'posts'} · ${count(card.shifts)} shifts on the posts`,
    },
    {
      label: 'Warnings on the posts',
      value: card.warnings.total,
      note: 'rule warnings on the supervisor posts',
    },
    {
      label: 'Supervisor wishes met',
      value: asked > 0 ? `${Math.round((card.preferences.met / asked) * 100)}%` : '—',
      note: asked > 0 ? `${card.preferences.met} of ${asked} wishes` : 'no wishes on file',
    },
    {
      label: 'Supervisor overtime',
      value: `${card.overtime.hoursOver} h`,
      note: `${card.overtime.officersOver} ${card.overtime.officersOver === 1 ? 'supervisor' : 'supervisors'} over ${card.overtime.thresholdHours} h in a pay period`,
    },
    ...(card.absences && card.absences.days > 0
      ? [
          {
            label: 'Supervisor leave',
            value: card.absences.days,
            note: `leave days kept free · ${card.absences.officers} ${card.absences.officers === 1 ? 'supervisor' : 'supervisors'}`,
          },
        ]
      : []),
  ];

  return (
    <Card component="section" aria-labelledby="supervisor-posts-title" sx={{ borderLeft: `4px solid ${colour.brand.primary}` }}>
      <CardContent sx={{ p: 4, display: 'flex', flexDirection: 'column', gap: 2 }}>
        <Typography id="supervisor-posts-title" component="h2" sx={{ m: 0, fontSize: 16, fontWeight: 700 }}>
          Supervisor posts
        </Typography>
        <Typography sx={{ fontSize: 14 }}>{card.line}</Typography>
        <Box sx={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 3 }}>
          {tiles.map((tile) => (
            <KpiTile key={tile.label} label={tile.label} value={tile.value} note={tile.note} tone={tile.tone} />
          ))}
        </Box>
        <Typography sx={{ fontSize: 13, color: colour.text.secondary }}>
          The cards above count the officers and the officer units only.
          {totals
            ? ` Everyone in this draft: ${totals.line}, ${peopleWords(totals.officers, totals.supervisors)}.`
            : ''}
        </Typography>
      </CardContent>
    </Card>
  );
}
