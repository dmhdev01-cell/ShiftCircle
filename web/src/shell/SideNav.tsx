import { NavLink } from 'react-router-dom';
import Box from '@mui/material/Box';

import { colour } from '../theme/tokens';
import { useRole } from './nav';

/**
 * Side navigation (docs/ui/README.md §4): white, 220px, role-specific items,
 * active item green with white text. Every item is a real link with a 44px
 * touch target.
 */
export function SideNav() {
  const { nav } = useRole();

  return (
    <Box
      component="nav"
      aria-label="Main"
      sx={{
        flex: '1 1 220px',
        maxWidth: '100%',
        boxSizing: 'border-box',
        p: '12px 12px',
        backgroundColor: colour.bg.surface,
        borderRight: `1px solid ${colour.border.default}`,
        display: 'flex',
        flexDirection: 'column',
        gap: 1,
      }}
    >
      {nav.map((item) => (
        <Box
          key={item.to}
          component={NavLink}
          to={item.to}
          end
          sx={{
            display: 'flex',
            alignItems: 'center',
            gap: '10px',
            minHeight: 44,
            px: 3,
            borderRadius: 2,
            color: item.muted ? colour.text.muted : colour.text.primary,
            textDecoration: 'none',
            fontSize: 14,
            fontWeight: 500,
            '&:hover': {
              backgroundColor: colour.border.default,
              color: colour.text.primary,
            },
            '&.active': {
              backgroundColor: colour.brand.primary,
              color: colour.text.onDark,
              '&:hover': { backgroundColor: colour.brand.primary },
            },
          }}
        >
          {item.label}
        </Box>
      ))}
    </Box>
  );
}
