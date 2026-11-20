import type { ReactNode } from 'react';
import Box from '@mui/material/Box';
import Card from '@mui/material/Card';
import CardContent from '@mui/material/CardContent';
import Typography from '@mui/material/Typography';

import { colour } from '../theme/tokens';

interface PlaceholderPageProps {
  title: string;
  subtitle?: string;
  /** What this screen will show once it is built. */
  planned?: ReactNode;
}

/**
 * Placeholder for a screen that the UI spec designs but this scaffold does
 * not build yet. It states what is planned instead of showing an empty page.
 */
export function PlaceholderPage({ title, subtitle, planned }: PlaceholderPageProps) {
  return (
    <>
      <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
        <Typography variant="h1">{title}</Typography>
        {subtitle ? (
          <Typography sx={{ fontSize: 14, color: colour.text.secondary }}>{subtitle}</Typography>
        ) : null}
      </Box>

      <Card>
        <CardContent sx={{ p: 4, display: 'flex', flexDirection: 'column', gap: 2 }}>
          <Typography sx={{ fontWeight: 600, fontSize: 15 }}>Not built yet</Typography>
          <Typography sx={{ fontSize: 14, color: colour.text.secondary }}>
            This screen is part of the ShiftCircle scope but is not implemented in the scaffold. The
            app shell, navigation, theme and footer are in place.
          </Typography>
          {planned ? (
            <Typography sx={{ fontSize: 14, color: colour.text.secondary }}>{planned}</Typography>
          ) : null}
        </CardContent>
      </Card>
    </>
  );
}
