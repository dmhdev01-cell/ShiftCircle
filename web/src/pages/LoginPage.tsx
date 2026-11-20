import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import Box from '@mui/material/Box';
import Card from '@mui/material/Card';
import CardContent from '@mui/material/CardContent';
import Typography from '@mui/material/Typography';

import { api } from '../api/client';
import { setToken } from '../api/session';
import type { DemoUser } from '../api/types';
import { destinationFor } from '../shell/destinations';
import { useRole } from '../shell/nav';
import { colour } from '../theme/tokens';

const ROLE_WORDS: Record<string, string> = {
  SUPERVISOR: 'Supervisor',
  EMPLOYEE: 'Employee',
  RULES_ADMIN: 'Rules admin',
  RULES_APPROVER: 'Rules approver',
  AUDITOR: 'Auditor',
  DISPLAY: 'Display',
};

/**
 * The mock sign-in picker (docs/09-access-control.md §4,
 * docs/ui/build-notes.md §2.1). It lists the fictional demo users; picking
 * one asks the api for a signed token. A pilot would use government single
 * sign-on instead.
 */
export function LoginPage() {
  const navigate = useNavigate();
  const { setRole } = useRole();
  const [users, setUsers] = useState<DemoUser[] | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let active = true;
    void api
      .getDemoUsers()
      .then((loaded) => {
        if (active) setUsers(loaded);
      })
      .catch((error: unknown) => {
        if (!active) return;
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

  const signIn = async (user: DemoUser) => {
    setBusy(true);
    setMessage(null);
    try {
      const result = await api.mockLogin(user.id);
      setToken(result.token);
      // The role chip follows the signed-in user.
      const primary = user.roles[0] as Parameters<typeof setRole>[0];
      setRole(primary);
      navigate(destinationFor(user));
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

        {message ? (
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
            {message}
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
                    {user.name}
                  </Box>
                  <Box component="span" sx={{ fontSize: 13, color: colour.text.secondary }}>
                    {user.roles.map((role) => ROLE_WORDS[role] ?? role).join(' · ')}
                  </Box>
                  <Box component="span" sx={{ fontSize: 12, color: colour.text.muted }}>
                    {user.scope}
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
