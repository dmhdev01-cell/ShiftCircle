import Alert from '@mui/material/Alert';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Card from '@mui/material/Card';
import CardContent from '@mui/material/CardContent';
import CircularProgress from '@mui/material/CircularProgress';
import Typography from '@mui/material/Typography';

import { isKnownVersionShape } from '../api/version';
import { useVersion } from '../api/useVersion';
import { colour } from '../theme/tokens';

function Row({ label, value }: { label: string; value: string }) {
  return (
    <Box
      sx={{
        display: 'flex',
        flexWrap: 'wrap',
        gap: 2,
        py: 2,
        borderBottom: `1px solid ${colour.border.default}`,
      }}
    >
      <Typography sx={{ width: 200, fontSize: 14, fontWeight: 600, color: colour.text.secondary }}>
        {label}
      </Typography>
      <Typography className="num" sx={{ fontSize: 14 }}>
        {value}
      </Typography>
    </Box>
  );
}

/**
 * Build information from `GET /api/v1/version`. It always shows something: the
 * build facts, or the reason it could not be read (never a silent blank).
 */
export function AboutPage() {
  const { state, refresh } = useVersion();

  return (
    <>
      <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
        <Typography variant="h1">About &amp; version</Typography>
        <Typography sx={{ fontSize: 14, color: colour.text.secondary }}>
          Build information from <code>/api/v1/version</code>
        </Typography>
      </Box>

      <Card>
        <CardContent sx={{ p: 4, display: 'flex', flexDirection: 'column', gap: 2 }}>
          {state.status === 'loading' ? (
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 2 }}>
              <CircularProgress size={18} aria-hidden="true" />
              <Typography sx={{ fontSize: 14 }} role="status">
                Loading build information
              </Typography>
            </Box>
          ) : null}

          {state.status === 'error' ? (
            <Alert
              severity="error"
              sx={{ alignItems: 'center' }}
              action={
                <Button color="inherit" size="small" onClick={() => void refresh()}>
                  Try again
                </Button>
              }
            >
              <Typography sx={{ fontSize: 14, fontWeight: 600 }}>
                Could not read the build information
              </Typography>
              <Typography sx={{ fontSize: 14 }}>{state.message}</Typography>
            </Alert>
          ) : null}

          {state.status === 'ready' ? (
            <>
              <Row label="Application" value={state.info.name ?? 'Not reported'} />
              <Row label="Build version" value={state.info.version ?? 'Not reported'} />
              <Row label="Built" value={state.info.buildTime ?? 'Not reported'} />
              <Row label="Git commit" value={state.info.gitCommit ?? 'Not reported'} />
              <Row label="Live rule set" value={state.info.ruleSetVersion ?? 'Not reported'} />
              <Row label="Profiles" value={state.info.profiles ?? 'Not reported'} />

              {!isKnownVersionShape(state.info) ? (
                <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                  <Alert severity="warning" sx={{ fontSize: 14 }}>
                    The API answered, but not with the fields this screen expects. The raw response is
                    shown below.
                  </Alert>
                  <Box
                    component="pre"
                    sx={{
                      m: 0,
                      p: 3,
                      backgroundColor: colour.bg.subtle,
                      border: `1px solid ${colour.border.default}`,
                      borderRadius: 1,
                      fontSize: 12,
                      overflowX: 'auto',
                    }}
                  >
                    {JSON.stringify(state.info.raw, null, 2)}
                  </Box>
                </Box>
              ) : null}
            </>
          ) : null}
        </CardContent>
      </Card>

      <Card>
        <CardContent sx={{ p: 4, display: 'flex', flexDirection: 'column', gap: 2 }}>
          <Typography sx={{ fontWeight: 600, fontSize: 15 }}>What this is</Typography>
          <Typography sx={{ fontSize: 14, color: colour.text.secondary }}>
            ShiftCircle is a working prototype for the AI Solutions Architect assessment. It
            schedules 8, 12 and 16 hour shifts at a fictional 24/7 correctional centre, checks every
            change against a configurable rules engine, and exports time to a simulated payroll
            file.
          </Typography>
          <Typography sx={{ fontSize: 14, color: colour.text.secondary }}>
            Every person, unit and figure in the prototype is synthetic. Sign-in is mocked, the
            payroll system is simulated, and there is no AI at runtime - the rules engine decides
            and a supervisor approves every change.
          </Typography>
        </CardContent>
      </Card>
    </>
  );
}
