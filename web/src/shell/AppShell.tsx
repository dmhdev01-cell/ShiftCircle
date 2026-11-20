import type { ReactNode } from 'react';
import Box from '@mui/material/Box';

import { AppFooter } from './AppFooter';
import { SideNav } from './SideNav';
import { TopBar } from './TopBar';

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
