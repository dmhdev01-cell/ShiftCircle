import { useEffect, useState } from 'react';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Card from '@mui/material/Card';
import CardContent from '@mui/material/CardContent';
import Dialog from '@mui/material/Dialog';
import DialogActions from '@mui/material/DialogActions';
import DialogContent from '@mui/material/DialogContent';
import DialogTitle from '@mui/material/DialogTitle';
import Checkbox from '@mui/material/Checkbox';
import FormControlLabel from '@mui/material/FormControlLabel';
import Radio from '@mui/material/Radio';
import Typography from '@mui/material/Typography';

import { api } from '../api/client';
import type {
  MyPreferences,
  PreferenceShiftLength,
  PreferenceTimeOfDay,
  PreferenceTimesOfDay,
} from '../api/types';
import { colour } from '../theme/tokens';

const DAYS: { id: string; label: string }[] = [
  { id: 'MON', label: 'Mon' },
  { id: 'TUE', label: 'Tue' },
  { id: 'WED', label: 'Wed' },
  { id: 'THU', label: 'Thu' },
  { id: 'FRI', label: 'Fri' },
  { id: 'SAT', label: 'Sat' },
  { id: 'SUN', label: 'Sun' },
];

function savedWords(updatedAt: string | null): string {
  if (!updatedAt) return 'Not set yet';
  const parsed = new Date(updatedAt);
  if (Number.isNaN(parsed.getTime())) return `Saved ${updatedAt}`;
  const zone = 'America/Regina';
  const day = new Intl.DateTimeFormat('en-CA', { day: 'numeric', timeZone: zone }).format(parsed);
  const month = new Intl.DateTimeFormat('en-CA', { month: 'short', timeZone: zone }).format(parsed);
  const time = new Intl.DateTimeFormat('en-CA', {
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
    timeZone: zone,
  }).format(parsed);
  return `Saved ${day} ${month}, ${time}`;
}

/**
 * The officer's own wishes (docs/ui/planner.md §8): a shift length, a time of
 * day and up to two days off. Wishes, not guarantees, and only their own.
 */
export function MyPreferencesCard() {
  const [prefs, setPrefs] = useState<MyPreferences | null>(null);
  const [shiftLength, setShiftLength] = useState<PreferenceShiftLength | null>(null);
  const [timesOfDay, setTimesOfDay] = useState<PreferenceTimesOfDay>([]);
  const [daysOff, setDaysOff] = useState<string[]>([]);
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [clearOpen, setClearOpen] = useState(false);
  const [busy, setBusy] = useState(false);

  const adopt = (next: MyPreferences) => {
    setPrefs(next);
    setShiftLength(next.shiftLength);
    setTimesOfDay(next.timesOfDay);
    setDaysOff(next.daysOff);
  };

  useEffect(() => {
    let active = true;
    void api
      .getMyPreferences()
      .then((next) => {
        if (active) adopt(next);
      })
      .catch(() => {
        if (active) setError('Your preferences could not be loaded.');
      });
    return () => {
      active = false;
    };
  }, []);

  if (!prefs && !error) {
    return null;
  }

  /** Order is not part of a set: {EVENING, DAY} and {DAY, EVENING} are the same wish. */
  const sameParts = (a: string[], b: string[]) =>
    a.length === b.length && [...a].sort().join(',') === [...b].sort().join(',');
  const dirty =
    prefs !== null &&
    (shiftLength !== prefs.shiftLength ||
      !sameParts(timesOfDay, prefs.timesOfDay) ||
      daysOff.join(',') !== prefs.daysOff.join(','));
  const singleLength = prefs !== null && prefs.allowedLengths.length === 1;

  const toggleTime = (part: PreferenceTimeOfDay) => {
    setTimesOfDay((current) =>
      current.includes(part) ? current.filter((entry) => entry !== part) : [...current, part],
    );
  };

  const toggleDay = (day: string) => {
    setDaysOff((current) => {
      if (current.includes(day)) return current.filter((entry) => entry !== day);
      if (prefs && current.length >= prefs.maxDaysOff) return current;
      return [...current, day];
    });
  };

  const save = async () => {
    setBusy(true);
    setStatus(null);
    setError(null);
    try {
      adopt(await api.putMyPreferences({ shiftLength, timesOfDay, daysOff }));
      setStatus('Saved. The next plan will use these.');
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : 'Your preferences could not be saved.');
    } finally {
      setBusy(false);
    }
  };

  const clear = async () => {
    setBusy(true);
    try {
      await api.deleteMyPreferences();
      const fresh = await api.getMyPreferences();
      adopt(fresh);
      setClearOpen(false);
      setStatus('Cleared.');
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : 'Your preferences could not be cleared.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <Card>
        <CardContent sx={{ p: 4, display: 'flex', flexDirection: 'column', gap: 3 }}>
          <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
            <Typography component="h2" sx={{ m: 0, fontSize: 17, fontWeight: 700 }}>
              My preferences
            </Typography>
            <Typography sx={{ fontSize: 14, color: colour.text.secondary }}>
              Tell the planner what you&apos;d like. These are wishes, not guarantees: the planner
              meets them where staffing and the rules allow. Officers who ask for nights get them
              first; other night shifts go to newer officers first.
            </Typography>
          </Box>

          <Box component="fieldset" sx={{ border: 0, m: 0, p: 0, display: 'flex', flexDirection: 'column', gap: 1 }}>
            <Typography component="legend" sx={{ fontSize: 13, fontWeight: 700, p: 0 }}>
              Shift length
            </Typography>
            <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1 }}>
              {([8, 12, 16] as PreferenceShiftLength[]).map((length) => {
                const allowed = prefs?.allowedLengths.includes(length) ?? true;
                return (
                  <FormControlLabel
                    key={length}
                    disabled={!allowed}
                    control={
                      <Radio
                        checked={shiftLength === length}
                        onChange={() => setShiftLength(length)}
                        slotProps={{ input: { 'aria-label': `${length} h` } }}
                      />
                    }
                    label={<span style={{ fontSize: 14 }}>{length} h</span>}
                  />
                );
              })}
              <FormControlLabel
                control={
                  <Radio checked={shiftLength === null} onChange={() => setShiftLength(null)} />
                }
                label={<span style={{ fontSize: 14 }}>No preference</span>}
              />
            </Box>
            {singleLength ? (
              <Typography sx={{ fontSize: 12, color: colour.text.secondary }}>
                Your unit uses 8-hour shifts only.
              </Typography>
            ) : null}
          </Box>

          <Box component="fieldset" sx={{ border: 0, m: 0, p: 0, display: 'flex', flexDirection: 'column', gap: 1 }}>
            <Typography component="legend" sx={{ fontSize: 13, fontWeight: 700, p: 0 }}>
              Time of day (pick any)
            </Typography>
            <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1 }}>
              {(
                [
                  ['DAY', 'Days'],
                  ['EVENING', 'Evenings'],
                  ['NIGHT', 'Nights'],
                ] as [PreferenceTimeOfDay, string][]
              ).map(([id, label]) => (
                <FormControlLabel
                  key={id}
                  control={
                    <Checkbox
                      checked={timesOfDay.includes(id)}
                      onChange={() => toggleTime(id)}
                      slotProps={{ input: { 'aria-label': label } }}
                    />
                  }
                  label={<span style={{ fontSize: 14 }}>{label}</span>}
                />
              ))}
              {/* No preference is the empty set: it cannot be combined with a part. */}
              <FormControlLabel
                control={
                  <Checkbox
                    checked={timesOfDay.length === 0}
                    onChange={() => setTimesOfDay([])}
                    slotProps={{ input: { 'aria-label': 'No preference' } }}
                  />
                }
                label={<span style={{ fontSize: 14 }}>No preference</span>}
              />
            </Box>
            {timesOfDay.includes('NIGHT') ? (
              <Typography sx={{ fontSize: 12, color: colour.text.secondary }}>
                Only 12-hour night crews work nights (19:00–07:00). An 8-hour officer who asks for
                nights keeps the unmet reason.
              </Typography>
            ) : null}
          </Box>

          <Box component="fieldset" sx={{ border: 0, m: 0, p: 0, display: 'flex', flexDirection: 'column', gap: 1 }}>
            <Typography component="legend" sx={{ fontSize: 13, fontWeight: 700, p: 0 }}>
              Days off I&apos;d like (up to {prefs?.maxDaysOff ?? 2})
            </Typography>
            <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1 }}>
              {DAYS.map((day) => (
                <FormControlLabel
                  key={day.id}
                  control={
                    <input
                      type="checkbox"
                      checked={daysOff.includes(day.id)}
                      onChange={() => toggleDay(day.id)}
                      aria-label={day.label}
                      style={{ width: 20, height: 20 }}
                    />
                  }
                  label={<span style={{ fontSize: 14 }}>{day.label}</span>}
                  sx={{ minHeight: 44 }}
                />
              ))}
            </Box>
            {prefs && daysOff.length >= prefs.maxDaysOff ? (
              <Typography sx={{ fontSize: 12, color: colour.text.secondary }}>
                Pick up to {prefs.maxDaysOff} days.
              </Typography>
            ) : null}
          </Box>

          <Typography sx={{ fontSize: 12, color: colour.text.secondary }}>
            {savedWords(prefs?.updatedAt ?? null)}
          </Typography>

          {status ? (
            <Box role="status" sx={{ p: '10px 12px', borderRadius: '8px', backgroundColor: colour.status.pass.bg, color: colour.status.pass.text, fontSize: 13, fontWeight: 600 }}>
              {status}
            </Box>
          ) : null}
          {error ? (
            <Box role="alert" sx={{ p: '10px 12px', borderRadius: '8px', backgroundColor: colour.status.block.bg, color: colour.status.block.text, fontSize: 13, fontWeight: 600 }}>
              {error}
            </Box>
          ) : null}

          <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 2 }}>
            <Button variant="outlined" color="primary" disabled={!dirty || busy} onClick={() => void save()}>
              Save preferences
            </Button>
            {prefs?.updatedAt ? (
              <Button variant="text" color="primary" disabled={busy} onClick={() => setClearOpen(true)}>
                Clear preferences
              </Button>
            ) : null}
          </Box>
        </CardContent>
      </Card>

      <Dialog open={clearOpen} onClose={() => setClearOpen(false)} maxWidth="xs" fullWidth>
        <DialogTitle sx={{ fontSize: 18, fontWeight: 700 }}>Clear your preferences?</DialogTitle>
        <DialogContent>
          <Typography sx={{ fontSize: 14 }}>
            The planner will treat you as having no preference.
          </Typography>
        </DialogContent>
        <DialogActions sx={{ px: 3, pb: 3 }}>
          <Button variant="outlined" color="primary" onClick={() => setClearOpen(false)}>
            Cancel
          </Button>
          <Button variant="contained" color="primary" disabled={busy} onClick={() => void clear()}>
            Clear
          </Button>
        </DialogActions>
      </Dialog>
    </>
  );
}
