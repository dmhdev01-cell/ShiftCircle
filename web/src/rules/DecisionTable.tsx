import { useState } from 'react';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Checkbox from '@mui/material/Checkbox';
import Typography from '@mui/material/Typography';

import type { RuleTable, RuleTableRow } from '../api/types';
import { StatusPill } from '../components/StatusPill';
import { ScrollShadows } from '../components/ScrollShadows';
import { colour } from '../theme/tokens';
import { sentenceFor, shiftKindLabel } from './sentences';

function sourceTone(source: string): 'pass' | 'warn' {
  return source === 'Employment Act' ? 'pass' : 'warn';
}

/** The shift kinds a rule can apply after, from the active shift templates. */
const SHIFT_KINDS = ['Any shift', '12 h 00–12', '12 h 12–24', '16 h shift', 'Regular shift'];

interface DecisionTableProps {
  table: RuleTable;
  /** True when the person editing is not a rules admin, or the draft is not editable. */
  readOnly: boolean;
  /** The rows, with any unsaved edits applied. */
  rows: RuleTableRow[];
  /** The rules with unsaved edits. */
  edited: Record<string, boolean>;
  saving: boolean;
  onUpdate: (ruleCode: string, patch: Partial<RuleTableRow>) => void;
  onSave: () => void;
}

/**
 * The decision-table grid (docs/ui/README.md §5.4). One row is one rule, and
 * the wording under the table updates as the values change.
 *
 * The rows and the edit marks live in the screen, because Build and Submit
 * have to save the same unsaved edits the person sees.
 */
export function DecisionTable({
  table,
  readOnly,
  rows,
  edited,
  saving,
  onUpdate,
  onSave,
}: DecisionTableProps) {
  const [selectedCode, setSelectedCode] = useState(rows[0]?.ruleCode ?? '');
  const selected = rows.find((row) => row.ruleCode === selectedCode) ?? rows[0];
  const update = onUpdate;
  // Unsaved edits are changes in the draft too; the api's number only catches
  // what has been saved.
  const changeCount = Math.max(table.changed, Object.keys(edited).length);

  return (
    <Box
      sx={{
        backgroundColor: colour.bg.surface,
        border: `1px solid ${colour.border.default}`,
        borderRadius: '10px',
        p: 4,
        display: 'flex',
        flexDirection: 'column',
        gap: 3,
      }}
    >
      <Box
        sx={{
          display: 'flex',
          flexWrap: 'wrap',
          alignItems: 'flex-start',
          justifyContent: 'space-between',
          gap: 2,
        }}
      >
        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
          <Typography component="h2" sx={{ m: 0, fontSize: 18, fontWeight: 700 }}>
            {table.name}
          </Typography>
          <Typography component="span" sx={{ fontSize: 13, color: colour.text.secondary }}>
            One row is one rule. Change the values; the wording below updates as you type.
          </Typography>
        </Box>
        {changeCount > 0 ? (
          <StatusPill tone="warn">
            {changeCount} change{changeCount === 1 ? '' : 's'} in draft
          </StatusPill>
        ) : null}
      </Box>

      <ScrollShadows
        label="Decision table, scrolls sideways"
        hint="Scroll sideways to see every column."
      >
        <table style={{ width: '100%', minWidth: 900, borderCollapse: 'collapse', fontSize: 13 }}>
          <thead>
            <tr>
              {['On', 'Rule', table.columns.after, table.columns.hours, table.columns.result, table.columns.override, 'Source'].map(
                (heading) => (
                  <th
                    key={heading}
                    style={{
                      textAlign: 'left',
                      padding: '8px 10px',
                      fontSize: 12,
                      fontWeight: 600,
                      color: colour.text.secondary,
                      backgroundColor: colour.bg.subtle,
                      borderBottom: `1px solid ${colour.border.default}`,
                      whiteSpace: 'nowrap',
                    }}
                  >
                    {heading}
                  </th>
                ),
              )}
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr
                key={row.ruleCode}
                onClick={() => setSelectedCode(row.ruleCode)}
                style={{
                  backgroundColor:
                    row.ruleCode === selectedCode ? '#EAF3F9' : undefined,
                  cursor: 'pointer',
                }}
              >
                <td style={{ padding: '8px 10px', borderBottom: `1px solid ${colour.border.default}` }}>
                  <Checkbox
                    checked={row.enabled}
                    disabled={readOnly}
                    onChange={(event) => update(row.ruleCode, { enabled: event.target.checked })}
                    slotProps={{ input: { 'aria-label': `Rule ${row.ruleCode} on` } }}
                  />
                </td>
                <td
                  style={{
                    padding: '8px 10px',
                    fontWeight: 700,
                    borderBottom: `1px solid ${colour.border.default}`,
                  }}
                >
                  {row.ruleCode}
                </td>
                <td style={{ padding: '8px 10px', borderBottom: `1px solid ${colour.border.default}` }}>
                  <Box
                    component="select"
                    aria-label={`Shift kind for ${row.ruleCode}`}
                    disabled={readOnly}
                    value={row.after}
                    onChange={(event) => update(row.ruleCode, { after: event.target.value })}
                    sx={{
                      minHeight: 40,
                      px: 2,
                      border: `1px solid ${colour.border.input}`,
                      borderRadius: '6px',
                      fontFamily: 'inherit',
                      fontSize: 13,
                      color: colour.text.primary,
                      backgroundColor: colour.bg.surface,
                    }}
                  >
                    {SHIFT_KINDS.includes(row.after) ? null : (
                      <option value={row.after}>{shiftKindLabel(row.after)}</option>
                    )}
                    {SHIFT_KINDS.map((kind) => (
                      <option key={kind} value={kind}>
                        {kind}
                      </option>
                    ))}
                  </Box>
                </td>
                <td style={{ padding: '8px 10px', borderBottom: `1px solid ${colour.border.default}` }}>
                  <Box sx={{ display: 'inline-flex', alignItems: 'center', gap: 1 }}>
                    <Box
                      component="input"
                      type="number"
                      aria-label={`Minimum hours off for ${row.ruleCode}`}
                      disabled={readOnly}
                      value={row.minHours}
                      min={row.min}
                      onChange={(event) =>
                        update(row.ruleCode, { minHours: Number(event.target.value) })
                      }
                      sx={{
                        width: 72,
                        minHeight: 40,
                        px: 2,
                        border: `1px solid ${colour.border.input}`,
                        borderRadius: '6px',
                        fontFamily: 'inherit',
                        fontSize: 13,
                        color: colour.text.primary,
                      }}
                    />
                    h off
                  </Box>
                </td>
                <td style={{ padding: '8px 10px', borderBottom: `1px solid ${colour.border.default}` }}>
                  <Box
                    component="select"
                    aria-label={`Result for ${row.ruleCode}`}
                    disabled={readOnly}
                    value={row.result}
                    onChange={(event) =>
                      update(row.ruleCode, { result: event.target.value as RuleTableRow['result'] })
                    }
                    sx={{
                      minHeight: 40,
                      px: 2,
                      border: `1px solid ${colour.border.input}`,
                      borderRadius: '6px',
                      fontFamily: 'inherit',
                      fontSize: 13,
                      color: colour.text.primary,
                      backgroundColor: colour.bg.surface,
                    }}
                  >
                    {['BLOCK', 'WARN', 'INFO'].map((option) => (
                      <option key={option} value={option}>
                        {option === 'BLOCK' ? 'Block' : option === 'WARN' ? 'Warn' : 'Info'}
                      </option>
                    ))}
                  </Box>
                </td>
                <td style={{ padding: '8px 10px', borderBottom: `1px solid ${colour.border.default}` }}>
                  <Box
                    component="select"
                    aria-label={`Override for ${row.ruleCode}`}
                    disabled={readOnly}
                    value={row.override}
                    onChange={(event) =>
                      update(row.ruleCode, {
                        override: event.target.value as RuleTableRow['override'],
                      })
                    }
                    sx={{
                      minHeight: 40,
                      px: 2,
                      border: `1px solid ${colour.border.input}`,
                      borderRadius: '6px',
                      fontFamily: 'inherit',
                      fontSize: 13,
                      color: colour.text.primary,
                      backgroundColor: colour.bg.surface,
                    }}
                  >
                    <option value="EMERGENCY">Emergency only</option>
                    <option value="NOT_ALLOWED">Not allowed</option>
                    <option value="ACKNOWLEDGE">Acknowledge</option>
                  </Box>
                </td>
                <td style={{ padding: '8px 10px', borderBottom: `1px solid ${colour.border.default}` }}>
                  <StatusPill tone={sourceTone(row.source)}>{row.source}</StatusPill>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </ScrollShadows>

      {selected ? (
        <Box
          sx={{
            display: 'flex',
            flexDirection: 'column',
            gap: 1,
            p: '14px 16px',
            backgroundColor: '#EAF3F9',
            borderRadius: '8px',
          }}
        >
          <Box
            component="span"
            sx={{
              fontSize: 12,
              fontWeight: 700,
              color: colour.brand.primary,
              textTransform: 'uppercase',
              letterSpacing: '0.04em',
            }}
          >
            In plain language · {selected.ruleCode}
          </Box>
          <Box component="span" sx={{ fontSize: 15, lineHeight: 1.5 }}>
            {sentenceFor(table.code, selected, edited[selected.ruleCode] ?? false)}
          </Box>
        </Box>
      ) : null}

      <Typography component="p" sx={{ m: 0, fontSize: 12, color: colour.text.secondary, lineHeight: 1.5 }}>
        U-01 cannot be set below 8 hours (the legal floor). The technical rule templates behind this
        table are maintained by the development team and cannot be edited here.
      </Typography>

      {readOnly ? null : (
        <Box>
          <Button variant="outlined" color="primary" onClick={onSave} disabled={saving}>
            Save the draft
          </Button>
        </Box>
      )}
    </Box>
  );
}
