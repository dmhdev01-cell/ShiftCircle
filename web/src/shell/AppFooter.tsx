import Box from '@mui/material/Box';
import Tooltip from '@mui/material/Tooltip';
import Typography from '@mui/material/Typography';

import { useVersion } from '../api/useVersion';
import { colour } from '../theme/tokens';

function versionSummary(state: ReturnType<typeof useVersion>['state']): string {
  if (state.status === 'loading') return 'Loading build information';
  if (state.status === 'error') return `Build information unavailable: ${state.message}`;
  const { buildVersion, gitCommit, ruleSetVersion } = state.info;
  const parts = [
    buildVersion ? `Build ${buildVersion}` : null,
    gitCommit ? `commit ${gitCommit}` : null,
    ruleSetVersion ? `rule set v${ruleSetVersion}` : null,
  ].filter((part): part is string => part !== null);
  return parts.length > 0 ? parts.join(' · ') : 'Build information unavailable';
}

/**
 * The footer shown on every screen (docs/ui/README.md §4). The disclaimer line
 * is required verbatim on every screen - see HANDOFF.md §5.8.
 */
export function AppFooter() {
  const { state } = useVersion();

  return (
    <Box
      component="footer"
      sx={{
        p: '20px 24px',
        backgroundColor: colour.footer.bg,
        color: colour.footer.text,
        fontSize: 14,
        display: 'flex',
        flexWrap: 'wrap',
        justifyContent: 'space-between',
        gap: '8px 24px',
      }}
    >
      <Tooltip title={versionSummary(state)}>
        <Typography component="span" sx={{ color: colour.footer.text, fontSize: 14 }}>
          ShiftCircle prototype · AI Solutions Architect assessment
        </Typography>
      </Tooltip>
      <Typography component="span" sx={{ color: colour.footer.text, fontSize: 14 }}>
        Not an official Government of Saskatchewan service · fictional, synthetic data only
      </Typography>
    </Box>
  );
}
