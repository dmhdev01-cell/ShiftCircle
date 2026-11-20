import { useEffect, useState, useSyncExternalStore } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import Box from '@mui/material/Box';
import Card from '@mui/material/Card';
import CardContent from '@mui/material/CardContent';
import Typography from '@mui/material/Typography';

import { api, ApiError } from '../api/client';
import { getSession, setSession, subscribeSession } from '../api/session';
import type { DemoUser } from '../api/types';
import { destinationFor } from '../shell/destinations';
import { ROLE_WORDS } from '../shell/roles';
import { colour } from '../theme/tokens';

const MOCK_SIGN_IN_OFF = 'Mock sign-in is turned off in this environment.';

/** The scope line the picker shows, in plain words from the unit codes. */
function scopeLine(user: DemoUser): string {
  return user.units.length === 0 ? 'No unit scope' : `Units ${user.units.join(', ')}`;
}

/**
 * The mock sign-in picker (docs/09-access-control.md §4,
 * docs/ui/build-notes.md §2.1). It lists the fictional demo users; picking
 * one asks the api for a signed token. A pilot would use government single
 * sign-on instead.
 */
export function LoginPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const session = useSyncExternalStore(subscribeSession, getSession);
  const [users, setUsers] = useState<DemoUser[] | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // A protected route sent the visitor here; go back to it after signing in.
  const from = (location.state as { from?: string } | null)?.from;

  useEffect(() => {
    let active = true;
    void api
      .getDemoUsers()
      .then((loaded) => {
        if (active) setUsers(loaded);
      })
      .catch((error: unknown) => {
        if (!active) return;
        // The prod-like profile removes the mock endpoints: say so plainly
        // instead of showing "404 Not Found".
        if (error instanceof ApiError && error.status === 404) {
          setMessage(MOCK_SIGN_IN_OFF);
          return;
        }
        setMessage(
          error instanceof Error
            ? error.message
            : 'The demo users could not be loaded.',
        );
      });
    return () => {
      active = false;
    };
  }, []);

  // Three reasons to say something above the picker: an expired session, a
  // route that needs a sign-in first, and anything the api said.
  const notice = session.ended
    ? 'Your session ended. Sign in again.'
    : from
      ? 'Please sign in to continue.'
      : message;

  const signIn = async (user: DemoUser) => {
    setBusy(true);
    setMessage(null);
    try {
      const result = await api.mockLogin(user.id);
      setSession(result.token, result.user ?? user);
      // Back to the route that asked for a sign-in, or to the role's landing.
      navigate(from ?? destinationFor(user), { replace: true });
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'The sign-in failed.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Box
      sx={{
        display: 'flex',
        justifyContent: 'center',
        alignItems: 'flex-start',
        py: 6,
      }}
    >
      <Box sx={{ width: '100%', maxWidth: 560 }}>
        <Typography variant="h1" sx={{ mb: 3 }}>
          Sign in
        </Typography>

        <Box
          role="note"
          sx={{
            p: '10px 12px',
            mb: 3,
            borderRadius: '8px',
            backgroundColor: colour.status.warn.bg,
            color: colour.status.warn.text,
            fontSize: 13,
            fontWeight: 600,
          }}
        >
          Mock sign-in · demo only. Pick a fictional user. A pilot would use government single sign-on.
        </Box>

        {notice ? (
          <Box
            role="status"
            sx={{
              p: '10px 12px',
              mb: 3,
              borderRadius: '8px',
              backgroundColor: colour.status.block.bg,
              color: colour.status.block.text,
              fontSize: 13,
              fontWeight: 600,
            }}
          >
            {notice}
          </Box>
        ) : null}

        <Card>
          <CardContent sx={{ p: 2, display: 'flex', flexDirection: 'column', gap: 1 }}>
            {users === null ? (
              <Typography sx={{ p: 3, fontSize: 14, color: colour.text.secondary }} role="status">
                Loading the demo users…
              </Typography>
            ) : (
              users.map((user) => (
                <Box
                  key={user.id}
                  component="button"
                  type="button"
                  disabled={busy}
                  onClick={() => void signIn(user)}
                  sx={{
                    display: 'flex',
                    flexDirection: 'column',
                    gap: 0.5,
                    width: '100%',
                    minHeight: 56,
                    px: 3,
                    py: 2,
                    border: `1px solid ${colour.border.default}`,
                    borderRadius: '8px',
                    textAlign: 'left',
                    backgroundColor: colour.bg.surface,
                    fontFamily: 'inherit',
                    color: colour.text.primary,
                    cursor: 'pointer',
                    '&:hover': { borderColor: colour.brand.link, backgroundColor: colour.bg.linkHover },
                  }}
                >
                  <Box component="span" sx={{ fontSize: 15, fontWeight: 700 }}>
                    {user.displayName}
                  </Box>
                  <Box component="span" sx={{ fontSize: 13, color: colour.text.secondary }}>
                    {user.roles.map((role) => ROLE_WORDS[role] ?? role).join(' · ')}
                  </Box>
                  <Box component="span" sx={{ fontSize: 12, color: colour.text.muted }}>
                    {scopeLine(user)}
                  </Box>
                </Box>
              ))
            )}
          </CardContent>
        </Card>

        <Typography
          component="p"
          sx={{ mt: 3, fontSize: 12, color: colour.text.secondary, lineHeight: 1.5 }}
        >
          The api validates the token on every request exactly as it would a real identity
          provider's token. Only the token issuer is fake.
        </Typography>
      </Box>
    </Box>
  );
}
