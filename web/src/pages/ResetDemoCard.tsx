import { useEffect, useRef, useState } from 'react';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Card from '@mui/material/Card';
import CardContent from '@mui/material/CardContent';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';

import { api } from '../api/client';
import type { DemoResetStatus } from '../api/types';
import { invalidateVersionCache } from '../api/useVersion';
import { colour } from '../theme/tokens';

/**
 * What the datasets are, in the person's words (P3 amendments 20-21). The api
 * currently sends the ids alone; when it sends a name, that name wins. A
 * dataset this build does not know shows its id, nothing invented.
 */
const DATASET_WORDS: Record<string, string> = {
  '100': '100: the seeded demo data',
  '120': '120: 100 full-time crews + 20 casual relief officers',
  '150': '150: 120 full-time crews + 30 part-time officers',
};

const STEP_WORDS: Record<string, string> = {
  clean: 'Clearing the demo data',
  audit: 'Erasing the audit history',
  // The dataset line says which dataset, below; this step is generic.
  generating: 'Generating the roster',
  rules: 'Checking every shift against the rules',
  proposals: 'Adding the demo shift proposals',
  checksum: 'Checking the dataset checksum',
  done: 'Done',
};

/**
 * The demo reset (docs/07, PLANNER only, demo profile only): erase and rebuild
 * the synthetic dataset. Plain words say what it erases and how long it takes,
 * the button needs the word RESET typed, and the progress line names each step.
 */
export function ResetDemoCard({
  datasets = [],
}: {
  datasets?: { id: string; name: string }[];
}) {
  const [confirm, setConfirm] = useState('');
  // Default to the seeded 100 dataset when the api offers it (its checksum and
  // golden are the untouched baseline); any other list defaults to its first.
  const [dataset, setDataset] = useState(
    datasets.some((entry) => entry.id === '100') ? '100' : (datasets[0]?.id ?? '100'),
  );
  const [status, setStatus] = useState<DemoResetStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const timer = useRef<number | null>(null);

  const stopPolling = () => {
    if (timer.current !== null) {
      window.clearInterval(timer.current);
      timer.current = null;
    }
  };

  useEffect(() => stopPolling, []);

  const poll = async () => {
    try {
      const next = await api.getDemoResetStatus();
      setStatus(next);
      if (next.state === 'DONE' || next.state === 'FAILED') {
        stopPolling();
        setBusy(false);
        if (next.state === 'DONE') {
          // The dataset under the app changed: drop the cached build facts so
          // the next screens read the new one.
          invalidateVersionCache();
        }
      }
    } catch (failure) {
      stopPolling();
      setBusy(false);
      setError(failure instanceof Error ? failure.message : 'The reset status could not be read.');
    }
  };

  const start = async () => {
    setBusy(true);
    setError(null);
    setStatus(null);
    try {
      const started = await api.resetDemo(confirm, dataset);
      setStatus(started);
      stopPolling();
      timer.current = window.setInterval(() => {
        void poll();
      }, 1000);
    } catch (failure) {
      setBusy(false);
      setError(failure instanceof Error ? failure.message : 'The reset could not be started.');
    }
  };

  const running = busy || status?.state === 'RUNNING';
  const elapsed = status ? Math.round(status.elapsedMs / 1000) : 0;

  return (
    <Card sx={{ borderLeft: `4px solid ${colour.status.warn.text}` }}>
      <CardContent sx={{ p: 4, display: 'flex', flexDirection: 'column', gap: 2 }}>
        <Typography component="h2" sx={{ m: 0, fontSize: 17, fontWeight: 700 }}>
          Reset the demo data
        </Typography>
        <Typography sx={{ fontSize: 14 }}>
          Erases the synthetic roster, time entries and audit history, then generates the demo
          dataset again. It takes a few seconds. The audit history before the reset is erased and
          one <strong>demo_reset</strong> line is recorded in the new one. The planning board, the
          quarter plan and the reports all start from the new data.
        </Typography>

        <Box sx={{ display: 'flex', flexWrap: 'wrap', alignItems: 'flex-end', gap: 2 }}>
          {datasets.length > 1 ? (
            <Box
              component="label"
              sx={{ display: 'flex', flexDirection: 'column', gap: 1, fontSize: 12, fontWeight: 600, color: colour.text.secondary }}
            >
              Dataset
              <Box
                component="select"
                aria-label="Dataset"
                value={dataset}
                disabled={running}
                onChange={(event: { target: { value: string } }) => setDataset(event.target.value)}
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
                  width: 260,
                }}
              >
                {datasets.map((entry) => (
                  <option key={entry.id} value={entry.id}>
                    {entry.name && entry.name !== entry.id
                      ? entry.name
                      : (DATASET_WORDS[entry.id] ?? entry.id)}
                  </option>
                ))}
              </Box>
            </Box>
          ) : null}
          <TextField
            label="Type RESET to confirm"
            size="small"
            value={confirm}
            onChange={(event) => setConfirm(event.target.value)}
            disabled={running}
            sx={{ width: 240 }}
          />
          <Button
            variant="outlined"
            color="primary"
            disabled={confirm !== 'RESET' || running}
            onClick={() => void start()}
          >
            {running ? 'Resetting…' : 'Reset demo data'}
          </Button>
        </Box>

        {running && status?.state === 'RUNNING' ? (
          <Typography role="status" sx={{ fontSize: 14, color: colour.text.secondary }}>
            {status.step === 'generating'
              ? `Generating ${(DATASET_WORDS[dataset] ?? `dataset ${dataset}`).replace(/^\d+: /, '')}`
              : (STEP_WORDS[status.step ?? 'clean'] ?? status.step)}
            … {elapsed} s elapsed.
          </Typography>
        ) : null}
        {running && !status ? (
          <Typography role="status" sx={{ fontSize: 14, color: colour.text.secondary }}>
            Starting the reset…
          </Typography>
        ) : null}

        {status?.state === 'DONE' ? (
          <Box role="status" sx={{ p: '10px 12px', borderRadius: '8px', backgroundColor: colour.status.pass.bg, color: colour.status.pass.text, fontSize: 13, fontWeight: 600 }}>
            Done. The demo data was rebuilt in {elapsed} s. Dataset checksum{' '}
            <span className="num">{status.checksum}</span>.
          </Box>
        ) : null}
        {status?.state === 'FAILED' ? (
          <Box role="alert" sx={{ p: '10px 12px', borderRadius: '8px', backgroundColor: colour.status.block.bg, color: colour.status.block.text, fontSize: 13, fontWeight: 600 }}>
            The reset failed: {status.error ?? 'no reason given.'}
          </Box>
        ) : null}
        {error ? (
          <Box role="alert" sx={{ p: '10px 12px', borderRadius: '8px', backgroundColor: colour.status.block.bg, color: colour.status.block.text, fontSize: 13, fontWeight: 600 }}>
            {error}
          </Box>
        ) : null}
      </CardContent>
    </Card>
  );
}
