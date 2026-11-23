import Box from '@mui/material/Box';

import type { RuleCheckOutcome } from '../api/types';
import { colour } from '../theme/tokens';

/** The rule list and the Block/Warn close, in the supervisor dialog's words. */
export function DraftRuleBox({
  outcome,
  children,
}: {
  outcome: RuleCheckOutcome;
  children?: React.ReactNode;
}) {
  const results = outcome.ruleResults.filter(
    (result) => result.outcome === 'BLOCK' || result.outcome === 'WARN',
  );
  if (results.length === 0) return null;
  return (
    <Box
      role="status"
      sx={{
        p: '10px 12px',
        borderRadius: '8px',
        backgroundColor: colour.status.warn.bg,
        color: colour.status.warn.text,
        fontSize: 13,
        display: 'flex',
        flexDirection: 'column',
        gap: 1,
      }}
    >
      {results.map((result) => (
        <Box component="span" key={result.ruleCode}>
          <strong>{result.ruleCode}</strong> · {result.message}
        </Box>
      ))}
      {children}
    </Box>
  );
}
