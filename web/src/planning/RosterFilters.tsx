import { useId, useState } from 'react';
import type { ReactNode } from 'react';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Menu from '@mui/material/Menu';
import MenuItem from '@mui/material/MenuItem';

import { qualificationLabel } from '../api/qualifications';
import { colour } from '../theme/tokens';
import {
  OVERTIME_OPTIONS,
  SORT_OPTIONS,
  WORKS_OPTIONS,
  filterWords,
  isFiltered,
} from './filterRoster';
import type { RosterFilterState, RotationFilter } from './filterRoster';

const controlSx = {
  minHeight: 44,
  boxSizing: 'border-box' as const,
  px: 2,
  border: `1px solid ${colour.border.input}`,
  borderRadius: '2px',
  fontFamily: 'inherit',
  fontSize: 14,
  fontWeight: 500,
  color: colour.text.primary,
  backgroundColor: colour.bg.surface,
  maxWidth: '100%',
};

/** A label above its control, like the board's Unit picker. */
function Field({ label, children, grow = false }: { label: string; children: ReactNode; grow?: boolean }) {
  return (
    <Box
      component="label"
      sx={{
        display: 'flex',
        flexDirection: 'column',
        gap: 1,
        fontSize: 12,
        fontWeight: 600,
        color: colour.text.secondary,
        flex: grow ? '1 1 180px' : '0 1 auto',
        minWidth: 0,
      }}
    >
      {label}
      {children}
    </Box>
  );
}

function Select<T extends string>({
  value,
  options,
  onChange,
}: {
  value: T;
  options: { id: T; label: string }[];
  onChange: (value: T) => void;
}) {
  return (
    <Box
      component="select"
      value={value}
      onChange={(event) => onChange((event.target as HTMLSelectElement).value as T)}
      sx={controlSx}
    >
      {options.map((option) => (
        <option key={option.id} value={option.id}>
          {option.label}
        </option>
      ))}
    </Box>
  );
}

export interface RosterFiltersProps {
  filters: RosterFilterState;
  onChange: (next: RosterFilterState) => void;
  /** The qualification codes held by anyone on the board. */
  qualificationCodes: string[];
  /** All plus the rotations the rows have (Casual only when a row names it). */
  rotationOptions: { id: RotationFilter; label: string }[];
  /** False for a month: too wide for one landscape page. */
  printable: boolean;
  shown: number;
  total: number;
  onExportView: () => void;
  onExportUnit: () => void;
  onPrint: () => void;
  onCopy: () => void;
  /** What the last export or copy did, read out politely. */
  exportStatus: string;
  /** v1.3 S6: a supervisor post's board names its rows supervisors. */
  onPost?: boolean;
}

/**
 * The filter bar above the roster (A3, mockup 3): name search, overtime
 * status, rotation, the blocks an officer works, qualification, sort, and the
 * export menu. Everything works on the rows already loaded.
 */
export function RosterFilters({
  filters,
  onChange,
  qualificationCodes,
  rotationOptions,
  printable,
  shown,
  total,
  onExportView,
  onExportUnit,
  onPrint,
  onCopy,
  exportStatus,
  onPost = false,
}: RosterFiltersProps) {
  const one = onPost ? 'supervisor' : 'officer';
  const many = onPost ? 'supervisors' : 'officers';
  const [menuAnchor, setMenuAnchor] = useState<HTMLElement | null>(null);
  const menuId = useId();
  const filtered = isFiltered(filters);
  const set = <K extends keyof RosterFilterState>(key: K, value: RosterFilterState[K]) =>
    onChange({ ...filters, [key]: value });

  const run = (action: () => void) => () => {
    setMenuAnchor(null);
    action();
  };

  return (
    <Box
      component="section"
      aria-label="Find, filter and export"
      data-print="hide"
      sx={{ display: 'flex', flexDirection: 'column', gap: 1.5 }}
    >
      <Box
        role="search"
        sx={{
          display: 'flex',
          flexWrap: 'wrap',
          alignItems: 'flex-end',
          gap: 2,
          p: '12px 16px',
          backgroundColor: colour.bg.surface,
          border: `1px solid ${colour.border.default}`,
          borderRadius: '10px',
        }}
      >
        <Field label={onPost ? 'Find supervisor' : 'Find officer'} grow>
          <Box
            component="input"
            type="search"
            value={filters.query}
            placeholder="Name"
            autoComplete="off"
            onChange={(event) => set('query', (event.target as HTMLInputElement).value)}
            sx={{ ...controlSx, width: '100%' }}
          />
        </Field>
        <Field label="Overtime">
          <Select value={filters.overtime} options={OVERTIME_OPTIONS} onChange={(value) => set('overtime', value)} />
        </Field>
        <Field label="Rotation">
          <Select value={filters.rotation} options={rotationOptions} onChange={(value) => set('rotation', value)} />
        </Field>
        <Field label="Works">
          <Select value={filters.works} options={WORKS_OPTIONS} onChange={(value) => set('works', value)} />
        </Field>
        <Field label="Qualification">
          <Select
            value={filters.qualification}
            options={[
              { id: 'all', label: 'All' },
              ...qualificationCodes.map((code) => ({ id: code, label: qualificationLabel(code) })),
            ]}
            onChange={(value) => set('qualification', value)}
          />
        </Field>
        <Field label="Sort">
          <Select value={filters.sort} options={SORT_OPTIONS} onChange={(value) => set('sort', value)} />
        </Field>
        <Box sx={{ ml: { md: 'auto' } }}>
          <Button
            variant="outlined"
            color="primary"
            aria-haspopup="menu"
            aria-expanded={menuAnchor ? 'true' : undefined}
            aria-controls={menuAnchor ? menuId : undefined}
            onClick={(event) => setMenuAnchor(event.currentTarget)}
          >
            Export ▾
          </Button>
          <Menu
            id={menuId}
            anchorEl={menuAnchor}
            open={menuAnchor !== null}
            onClose={() => setMenuAnchor(null)}
            anchorOrigin={{ vertical: 'bottom', horizontal: 'right' }}
            transformOrigin={{ vertical: 'top', horizontal: 'right' }}
          >
            <MenuItem onClick={run(onExportView)}>
              CSV for Excel · this view ({shown} {shown === 1 ? one : many})
            </MenuItem>
            <MenuItem onClick={run(onExportUnit)}>
              CSV for Excel · whole {onPost ? 'post' : 'unit'}, all {total} {many}
            </MenuItem>
            {printable ? (
              <MenuItem onClick={run(onPrint)}>Print or save as PDF (landscape)</MenuItem>
            ) : (
              <MenuItem disabled sx={{ whiteSpace: 'normal', maxWidth: 360, '&.Mui-disabled': { opacity: 1, color: colour.text.secondary } }}>
                Print: a month is too wide for one page. Print a week or a pay period.
              </MenuItem>
            )}
            <MenuItem onClick={run(onCopy)}>Copy this view (tab-separated, for a spreadsheet)</MenuItem>
          </Menu>
        </Box>
      </Box>

      <Box
        sx={{
          display: 'flex',
          flexWrap: 'wrap',
          alignItems: 'center',
          columnGap: 2,
          rowGap: 0.5,
          minHeight: 24,
          fontSize: 13,
          color: colour.text.secondary,
        }}
      >
        <Box component="span" role="status" aria-live="polite">
          {filtered
            ? `Showing ${shown} of ${total} ${many} · ${filterWords(filters, qualificationLabel)}`
            : `Showing all ${total} ${many}`}
          {exportStatus ? ` · ${exportStatus}` : ''}
        </Box>
        {filtered ? (
          <Box
            component="button"
            type="button"
            onClick={() => onChange({ ...filters, query: '', overtime: 'all', rotation: 'all', works: 'all', qualification: 'all' })}
            sx={{
              minHeight: 44,
              p: 0,
              border: 0,
              background: 'none',
              fontFamily: 'inherit',
              fontSize: 13,
              fontWeight: 600,
              color: colour.brand.link,
              textDecoration: 'underline',
              cursor: 'pointer',
            }}
          >
            Clear filters
          </Box>
        ) : null}
      </Box>
    </Box>
  );
}
