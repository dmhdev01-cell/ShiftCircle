import type { ReactNode } from 'react';
import { useEffect, useSyncExternalStore } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import Box from '@mui/material/Box';

import { getSession, subscribeSession } from '../api/session';
import { AppFooter } from './AppFooter';
import { SideNav } from './SideNav';
import { TopBar } from './TopBar';

/**
 * A 401 anywhere sends the person back to the sign-in screen with the session
 * notice (docs/ui/build-notes.md §2.1). It is one listener rather than a check
 * in every screen, so a screen that forgets cannot keep showing stale data.
 */
function SessionWatcher() {
  const session = useSyncExternalStore(subscribeSession, getSession);
  const navigate = useNavigate();
  const location = useLocation();

  useEffect(() => {
    if (session.ended && location.pathname !== '/login') {
      navigate('/login');
    }
  }, [session.ended, location.pathname, navigate]);

  return null;
}

/**
 * The shared app shell (docs/ui/README.md §4): green top bar with the Canola
 * rule, side navigation, fluid content area, footer.
 *
 * The nav and content sit in a wrapping flex row so the nav stacks above the
 * content on tablets and phones.
 */
export function AppShell({ children }: { children: ReactNode }) {
  return (
    <Box sx={{ minHeight: '100vh', display: 'flex', flexDirection: 'column' }}>
      <SessionWatcher />
      <TopBar />

      <Box sx={{ display: 'flex', flexWrap: 'wrap', flex: 1 }}>
        <SideNav />

        <Box
          component="main"
          sx={{
            flex: '999 1 560px',
            minWidth: 0,
            boxSizing: 'border-box',
            p: 6,
            display: 'flex',
            flexDirection: 'column',
            gap: 5,
          }}
        >
          {children}
        </Box>
      </Box>

      <AppFooter />
    </Box>
  );
}
