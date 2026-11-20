/**
 * ShiftCircle design tokens.
 *
 * Source of truth: docs/ui/README.md §3 (Government of Saskatchewan digital
 * standard). Components must not hard-code hex values - they read from here.
 *
 * Note: no government logo, wheat sheaf or coat of arms is used anywhere.
 */

export const colour = {
  brand: {
    /** Football Green - top bar, active nav item, pass/approved states. */
    primary: '#046A38',
    primaryDark: '#03552D',
    /** Canola - primary (yellow) button, 4px rule under the top bar, mark ring. */
    accent: '#FBDD40',
    /** Midnight Sky - links, secondary button text/border, night shifts. */
    link: '#00558C',
    linkHover: '#003D66',
  },
  support: {
    lentils: '#64A70B',
    buffaloGrass: '#A4D65E',
    flax: '#B9D9EB',
  },
  text: {
    primary: '#333333',
    secondary: '#555B61',
    muted: '#666666',
    onDark: '#FFFFFF',
    onDarkMuted: '#D6E9DE',
  },
  border: {
    default: '#E1E3E6',
    input: '#8E959C',
  },
  bg: {
    page: '#F5F5F5',
    surface: '#FFFFFF',
    subtle: '#F7F7F8',
    linkHover: '#E8F1F8',
  },
  footer: {
    bg: '#2C3136',
    text: '#CCCCCC',
  },
  status: {
    block: { bg: '#FDE8E8', text: '#A30000', border: '#C40000' },
    warn: { bg: '#FDF1B0', text: '#5A4500', border: undefined },
    pass: { bg: '#E3F0E8', text: '#046A38', border: undefined },
    info: { bg: '#EEF0F2', text: '#444A50', border: undefined },
    under: { bg: '#E8F1F8', text: '#00558C', border: undefined },
    ot: { bg: '#E4F2CF', text: '#2F5206', border: undefined },
  },
} as const;

/**
 * Shift chips (docs/ui/README.md §3.2). Times follow ADR-015, so the 12 h
 * codes are A12 (00-12) and P12 (12-24) - not the mockups' D12/N12.
 */
export type ShiftCode = 'D' | 'E' | 'N' | 'A12' | 'P12' | 'L16' | 'Sick' | 'Vac' | 'Off';

export const shiftChips: Record<ShiftCode, { label: string; title: string; bg: string; text: string; border?: string; borderStyle?: string }> = {
  D: { label: 'D', title: 'Day 07-15', bg: '#FDF1B0', text: '#333333' },
  E: { label: 'E', title: 'Evening 15-23', bg: '#D5E8F3', text: '#00558C' },
  N: { label: 'N', title: 'Night 23-07', bg: '#00558C', text: '#FFFFFF' },
  A12: { label: 'A12', title: '12 h overnight-morning 00-12', bg: '#00558C', text: '#FFFFFF' },
  P12: { label: 'P12', title: '12 h afternoon-evening 12-24', bg: '#D5E8F3', text: '#00558C' },
  L16: { label: 'L16', title: '16 h 20:00-12:00 (regular)', bg: '#E1E3E6', text: '#333333', border: '#8E959C', borderStyle: 'solid' },
  Sick: { label: 'Sick', title: 'Sick', bg: '#FFFFFF', text: '#9A3412', border: '#C2410C', borderStyle: 'dashed' },
  Vac: { label: 'Vac', title: 'Vacation', bg: '#E3F0E8', text: '#046A38' },
  Off: { label: 'Off', title: 'Off', bg: 'transparent', text: '#666666' },
};

/** Extra (overtime) shift styling - same code, picked up beyond the roster. */
export const shiftChipExtra = { bg: colour.support.buffaloGrass, text: '#1F2A0A' } as const;

/** Typography, spacing and shape (docs/ui/README.md §3.3). */
export const fontFamily = "'Source Sans 3', 'Source Sans Pro', system-ui, -apple-system, 'Segoe UI', sans-serif";

export const shape = {
  button: 2,
  card: 10,
  chip: 6,
  pill: 12,
} as const;

/** 4px base grid (docs/ui/README.md §3.3). */
export const spacingUnit = 4;
