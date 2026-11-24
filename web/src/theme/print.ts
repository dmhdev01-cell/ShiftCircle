/**
 * A3: the planning board's print stylesheet (Print or save as PDF). The board
 * renders it with MUI `GlobalStyles`, so only the board prints landscape.
 *
 * What prints: the title, the unit and range, a "showing" line, the roster
 * with its coverage rows, day totals and key. What does not: the top bar, the
 * side navigation, the footer, the figures, the view and filter controls and
 * every button outside the roster (marked `data-print="hide"`).
 */
export const boardPrintStyles = {
  '@page': { size: 'landscape', margin: '8mm' },
  '@media print': {
    body: { backgroundColor: '#FFFFFF !important' },
    '*': { printColorAdjust: 'exact', WebkitPrintColorAdjust: 'exact' },
    'header, nav, footer, [data-print="hide"]': { display: 'none !important' },
    '[data-print="only"]': { display: 'block !important' },
    main: { padding: '0 !important', gap: '6px !important' },
    // The roster prints whole: no sideways scroll, no sticky column, no edge shadow.
    '#roster [role="region"]': { overflow: 'visible !important' },
    '#roster [role="region"] ~ [aria-hidden="true"], #roster p': { display: 'none !important' },
    '#roster table': { width: '100% !important', minWidth: '0 !important', fontSize: '9px !important' },
    '#roster th, #roster td': {
      position: 'static !important',
      boxShadow: 'none !important',
      padding: '1px 2px !important',
    },
    '#roster thead': { display: 'table-header-group' },
    '#roster tr': { breakInside: 'avoid' },
  },
} as const;
