import { Link as RouterLink } from 'react-router-dom';
import Box from '@mui/material/Box';
import Link from '@mui/material/Link';

import { useVersion } from '../api/useVersion';
import { colour } from '../theme/tokens';

/**
 * S6: the default Dataset 100 has too few night officers for the quarter
 * planner, so its plan shows about 41% gaps. The default stays 100 (the main
 * demo relies on it); the Quarter plan says so and points to the reset card.
 * Shown only when the api names Dataset 100 as the live one, never guessed.
 */
export function DatasetBanner() {
  const { state } = useVersion();
  if (state.status !== 'ready' || state.info.activeDataset !== '100') return null;
  return (
    <Box
      role="note"
      aria-label="Dataset notice"
      sx={{
        p: '10px 12px',
        borderRadius: '8px',
        backgroundColor: colour.status.warn.bg,
        color: colour.status.warn.text,
        fontSize: 14,
        fontWeight: 600,
      }}
    >
      Dataset 100 is under-staffed for nights; reset to Dataset 120 for the planner demo.{' '}
      <Link component={RouterLink} to="/about" sx={{ color: 'inherit', fontWeight: 700 }}>
        About &amp; version
      </Link>
    </Box>
  );
}
