import { useEffect, useState, useSyncExternalStore } from 'react';
import { Link as RouterLink, useLocation, useNavigate } from 'react-router-dom';
import AppBar from '@mui/material/AppBar';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Menu from '@mui/material/Menu';
import MenuItem from '@mui/material/MenuItem';
import Toolbar from '@mui/material/Toolbar';
import Typography from '@mui/material/Typography';

import { usingFixtures } from '../api/client';
import { getSession, signOut, subscribeSession } from '../api/session';
import { useVersion } from '../api/useVersion';
import { colour } from '../theme/tokens';
import { useRole } from './nav';
import { roles } from './roles';
import type { Role } from './roles';

/**
 * The ShiftCircle mark: a Canola ring with a white dot. Our own mark - it is
 * not a government symbol (no logo, wheat sheaf or coat of arms anywhere).
 */
function ShiftCircleMark() {
  return (
    <svg width={32} height={32} viewBox="0 0 32 32" fill="none" aria-hidden="true" focusable="false">
      <circle
        cx="16"
        cy="16"
        r="12"
        stroke={colour.brand.accent}
        strokeWidth="3"
        strokeDasharray="56 20"
        strokeLinecap="round"
      />
      <circle cx="16" cy="16" r="4" fill={colour.text.onDark} />
    </svg>
  );
}

const REGINA = 'America/Regina';

/**
 * The date comes from the api when it has one, so the demo reads 19 Nov and
 * not the day the build happens to run on. The time is the browser's clock in
 * Regina time.
 */
function formatClock(day: string | undefined, now: Date): string {
  const date = day ?? now.toISOString().slice(0, 10);
  const parsed = new Date(`${date}T00:00:00Z`);
  // The api answers a calendar day ("2026-11-19"), not an instant: format it in
  // UTC. Reading it in Regina time (UTC-6) turned the demo day into the 18th on
  // every screen (D1).
  const weekday = new Intl.DateTimeFormat('en-CA', { weekday: 'short', timeZone: 'UTC' }).format(parsed);
  const dayOfMonth = new Intl.DateTimeFormat('en-CA', { day: '2-digit', timeZone: 'UTC' }).format(parsed);
  const month = new Intl.DateTimeFormat('en-CA', { month: 'short', timeZone: 'UTC' }).format(parsed);
  const year = new Intl.DateTimeFormat('en-CA', { year: 'numeric', timeZone: 'UTC' }).format(parsed);
  // The time is the browser's clock, read in the centre's time zone.
  const time = new Intl.DateTimeFormat('en-CA', {
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
    timeZone: REGINA,
  }).format(now);
  return `${weekday} ${dayOfMonth} ${month} ${year} · ${time}`;
}

/**
 * The badge that says the screen is reading the typed fixtures rather than
 * the api, so fixture data is never mistaken for live data.
 */
function FixturesBadge() {
  return (
    <Box
      sx={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 1,
        px: 2,
        py: 1,
        borderRadius: '2px',
        backgroundColor: colour.brand.accent,
        color: colour.text.primary,
        fontSize: 12,
        fontWeight: 700,
      }}
    >
      Demo fixtures
    </Box>
  );
}

export function TopBar() {
  const { role, userName, setRole } = useRole();
  const session = useSyncExternalStore(subscribeSession, getSession);
  const navigate = useNavigate();
  const location = useLocation();
  const [now, setNow] = useState(() => new Date());
  const [accountAnchor, setAccountAnchor] = useState<HTMLElement | null>(null);
  const { state: version } = useVersion();

  // A signed-in person has a token: their identity no longer comes from the
  // demo switch. Without one, only the fixtures demo offers a switch.
  const hasToken = session.token !== null;
  const onSignInScreen = location.pathname === '/login';

  useEffect(() => {
    const timer = window.setInterval(() => setNow(new Date()), 30_000);
    return () => window.clearInterval(timer);
  }, []);

  const day = version.status === 'ready' ? version.info.asOf : undefined;

  return (
    <AppBar component="header" enableColorOnDark>
      <Toolbar
        sx={{
          display: 'flex',
          flexWrap: 'wrap',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: '12px 24px',
          px: 6,
          py: 3,
        }}
      >
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 3 }}>
          <ShiftCircleMark />
          <Box sx={{ display: 'flex', flexDirection: 'column' }}>
            <Typography sx={{ fontWeight: 700, fontSize: 20, letterSpacing: '-0.01em', lineHeight: 1.2 }}>
              ShiftCircle
            </Typography>
            <Typography sx={{ fontSize: 12, color: colour.text.onDarkMuted }}>
              Prairie Provincial Correctional Centre · prototype, fictional data
            </Typography>
          </Box>
        </Box>

        <Box sx={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 3, fontSize: 13 }}>
          {usingFixtures ? <FixturesBadge /> : null}

          <Typography className="num" sx={{ color: colour.text.onDark, fontSize: 13 }}>
            {formatClock(day, now)}
          </Typography>

          {onSignInScreen ? null : hasToken ? (
            <Box
              sx={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: 2,
                pl: 3,
                pr: 1,
                py: 0.5,
                borderRadius: '16px',
                backgroundColor: colour.brand.primaryDark,
                fontSize: 13,
              }}
            >
              <Typography component="span" sx={{ color: colour.text.onDark, fontSize: 13 }}>
                {role.label} · {userName}
              </Typography>
              <Typography component="span" sx={{ color: colour.text.onDarkMuted, fontSize: 13 }}>
                (mock sign-in)
              </Typography>
              <Button
                onClick={(event) => setAccountAnchor(event.currentTarget)}
                aria-haspopup="menu"
                aria-expanded={accountAnchor !== null}
                aria-label={`Account menu for ${userName}`}
                sx={{
                  minHeight: 44,
                  minWidth: 44,
                  color: colour.text.onDark,
                }}
              >
                <span aria-hidden="true">▾</span>
              </Button>
              <Menu
                anchorEl={accountAnchor}
                open={accountAnchor !== null}
                onClose={() => setAccountAnchor(null)}
              >
                <MenuItem
                  onClick={() => {
                    setAccountAnchor(null);
                    signOut();
                    navigate('/login');
                  }}
                >
                  Sign out
                </MenuItem>
              </Menu>
            </Box>
          ) : !usingFixtures ? (
            <Box
              sx={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: 2,
                px: 3,
                py: 1.5,
                borderRadius: '16px',
                backgroundColor: colour.brand.primaryDark,
                fontSize: 13,
              }}
            >
              <Typography component="span" sx={{ color: colour.text.onDark, fontSize: 13 }}>
                Not signed in
              </Typography>
              <Box
                component={RouterLink}
                to="/login"
                sx={{ color: colour.text.onDark, fontSize: 13, display: 'inline-flex', minHeight: 44, alignItems: 'center' }}
              >
                Sign in
              </Box>
            </Box>
          ) : (
            <Box
              sx={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: 2,
                px: 3,
                py: 1.5,
                borderRadius: '16px',
                backgroundColor: colour.brand.primaryDark,
                fontSize: 13,
              }}
            >
              <Typography component="span" sx={{ color: colour.text.onDark, fontSize: 13 }}>
                {role.label} · {userName}
              </Typography>
              <Typography component="span" sx={{ color: colour.text.onDarkMuted, fontSize: 13 }}>
                (mock sign-in)
              </Typography>
              <Box
                component="label"
                sx={{ display: 'inline-flex', alignItems: 'center', gap: 1, color: colour.text.onDarkMuted }}
              >
                <Box component="span" sx={{ fontSize: 12 }}>
                  Switch
                </Box>
                <Box
                  component="select"
                  aria-label="Mock sign-in: choose a role"
                  value={role.id}
                  onChange={(event: { target: { value: string } }) => setRole(event.target.value as Role)}
                  sx={{
                    minHeight: 44,
                    px: 2,
                    borderRadius: '2px',
                    border: `1px solid ${colour.text.onDarkMuted}`,
                    backgroundColor: 'transparent',
                    color: colour.text.onDark,
                    fontFamily: 'inherit',
                    fontSize: 13,
                  }}
                >
                  {roles.map((option) => (
                    <option key={option.id} value={option.id}>
                      {option.label}
                    </option>
                  ))}
                </Box>
              </Box>
            </Box>
          )}
        </Box>
      </Toolbar>
    </AppBar>
  );
}
