import Box from '@mui/material/Box';
import Checkbox from '@mui/material/Checkbox';
import FormControl from '@mui/material/FormControl';
import FormControlLabel from '@mui/material/FormControlLabel';
import FormLabel from '@mui/material/FormLabel';
import Radio from '@mui/material/Radio';
import RadioGroup from '@mui/material/RadioGroup';
import Typography from '@mui/material/Typography';

import type { PlanOptions } from '../api/types';
import { colour } from '../theme/tokens';
import { includesPartTime } from './planOptions';

/** One option's choice: a short label and the one plain sentence that says what it does. */
function Choice({ label, sentence }: { label: string; sentence: string }) {
  return (
    <Box component="span" sx={{ display: 'flex', flexDirection: 'column', py: 0.5 }}>
      <Box component="span" sx={{ fontSize: 14, fontWeight: 600 }}>
        {label}
      </Box>
      <Box component="span" sx={{ fontSize: 13, color: colour.text.secondary }}>
        {sentence}
      </Box>
    </Box>
  );
}

const legend = { fontSize: 14, fontWeight: 700, color: colour.text.primary, mb: 0.5 } as const;

/**
 * The quarter plan's tailoring options (v1.2): which staff to include and how
 * part-time officers are filled. Used on the landing card and in the Generate
 * again dialog, filled in from the last draft.
 */
export function PlanOptionsFields({
  value,
  onChange,
  disabled = false,
  idPrefix = 'plan-options',
}: {
  value: PlanOptions;
  onChange: (next: PlanOptions) => void;
  disabled?: boolean;
  idPrefix?: string;
}) {
  const partTime = includesPartTime(value);
  return (
    <Box
      role="group"
      aria-label="Plan options"
      sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}
    >
      <FormControl component="fieldset" disabled={disabled}>
        <FormLabel component="legend" sx={legend}>
          Staff to include
        </FormLabel>
        <FormControlLabel
          sx={{ alignItems: 'flex-start' }}
          control={<Checkbox checked disabled sx={{ mt: 0.25 }} />}
          label={
            <Choice
              label="Full-time officers"
              sentence="Always included: the full-time crews are the plan."
            />
          }
        />
        <FormControlLabel
          sx={{ alignItems: 'flex-start' }}
          control={
            <Checkbox
              checked={partTime}
              sx={{ mt: 0.25 }}
              onChange={(event) =>
                onChange({
                  ...value,
                  staffTypes: event.target.checked ? ['FULL_TIME', 'PART_TIME'] : ['FULL_TIME'],
                })
              }
            />
          }
          label={
            <Choice
              label="Part-time and casual officers"
              sentence="Officers below 1.0 FTE take shifts the full-time crews leave open; untick to see the plan without them."
            />
          }
        />
      </FormControl>

      <FormControl component="fieldset" disabled={disabled || !partTime}>
        <FormLabel component="legend" id={`${idPrefix}-fill`} sx={legend}>
          Part-time fill
        </FormLabel>
        <RadioGroup
          aria-labelledby={`${idPrefix}-fill`}
          value={partTime ? value.partTimeFill : 'AFTER_FULL_TIME'}
          onChange={(event) =>
            onChange({ ...value, partTimeFill: event.target.value as PlanOptions['partTimeFill'] })
          }
        >
          <FormControlLabel
            value="AFTER_FULL_TIME"
            sx={{ alignItems: 'flex-start' }}
            control={<Radio sx={{ mt: 0.25 }} />}
            label={
              <Choice
                label="Fill gaps only (as before)"
                sentence="Part-time officers get a shift only where a unit is still short after the full-time crews."
              />
            }
          />
          <FormControlLabel
            value="UP_TO_FTE"
            sx={{ alignItems: 'flex-start' }}
            control={<Radio sx={{ mt: 0.25 }} />}
            label={
              <Choice
                label="Fill up to each officer's FTE"
                sentence="After the gaps, part-time officers also get shifts where cover is thinnest, up to their FTE hours, so less capacity goes unused."
              />
            }
          />
        </RadioGroup>
        {!partTime ? (
          <Typography sx={{ fontSize: 12, color: colour.text.secondary }}>
            Include part-time officers to choose how they are filled.
          </Typography>
        ) : null}
      </FormControl>
    </Box>
  );
}
