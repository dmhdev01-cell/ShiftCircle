/**
 * Design tokens.
 *
 * Source of truth: docs/ui/README.md §3 (Government of Saskatchewan digital
 * standard) and docs/ui/build-notes.md §1. Components must not hard-code hex
 * values - they read from here.
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
    /** "In overtime": the overtime (orange) tone, so it never reads as a good green (A4). */
    ot: { bg: '#FDE2D4', text: '#8A2C00', border: undefined },
  },
} as const;

/**
 * Keyboard focus rings (WCAG 1.4.11, 3:1 against what they sit on). The
 * theme's global ring is `onLight`; a ring drawn inside a dark (selected)
 * control uses `onDark`.
 */
export const focusRing = {
  /** Midnight Sky on white: 7.5:1. */
  onLight: '#00558C',
  /** Canola on Midnight Sky: 5.8:1. */
  onDark: '#FBDD40',
} as const;

/**
 * The roster grid's own surfaces (A1): today's column, weekend shading and the
 * heavier line between weeks.
 */
export const grid = {
  today: '#EAF3F9',
  weekend: '#F1F2F4',
  weekSeparator: '#9AA3AB',
  /** A2: the officers free on the selected gap's day (the panel lists them in words). */
  free: '#E3F0E8',
} as const;

/**
 * Coverage heat (A1): met, one short, two or more short, over. Text always
 * carries the count as well, so status is never colour alone.
 */
export const coverageTones = {
  ok: { bg: colour.status.under.bg, text: colour.status.under.text },
  gap: { bg: colour.status.warn.bg, text: colour.status.warn.text },
  gap2: { bg: '#F6B26B', text: '#3D2200' },
  over: { bg: colour.status.info.bg, text: '#333333' },
} as const;

export interface ChipStyle {
  bg: string;
  text: string;
  border?: string;
  borderStyle?: string;
}

/**
 * Shift chip styles, keyed by shift template code (docs/ui/build-notes.md
 * §1.1). The three 8 hour defaults show a single letter; every other
 * template shows its code.
 */
export const shiftChipStyles: Record<string, ChipStyle> = {
  /** Day 8 h 07:00-15:00. */
  D8: { bg: '#FDF1B0', text: '#333333' },
  /** Evening 8 h 15:00-23:00. */
  E8: { bg: '#D5E8F3', text: '#00558C' },
  /** Night 8 h 23:00-07:00. */
  N8: { bg: '#00558C', text: '#FFFFFF' },
  /** 12 h 00:00-12:00. */
  A12: { bg: '#00558C', text: '#FFFFFF' },
  /** 12 h 12:00-24:00. */
  P12: { bg: '#D5E8F3', text: '#00558C' },
  /** 16 h 20:00-12:00, rostered. */
  L16: { bg: '#E1E3E6', text: '#333333', border: '#8E959C', borderStyle: 'solid' },
  /** Day 12 h 07:00-19:00: a deeper yellow than the 8 h day (A4). */
  D12: { bg: '#FBE08A', text: '#333333' },
  /** Night 12 h 19:00-07:00: dark like the other nights, so day and night crews differ (A4). */
  N12: { bg: '#2B3A67', text: '#FFFFFF' },
};

/** An extra shift picked up beyond the roster. */
export const extraChipStyle: ChipStyle = { bg: '#A4D65E', text: '#1F2A0A' };

/** An overtime offer that has not been answered yet. */
export const offerChipStyle: ChipStyle = {
  bg: '#FFFFFF',
  text: '#2F5206',
  border: '#64A70B',
  borderStyle: 'dashed',
};

/** A proposal the rules blocked. */
export const proposedChipStyle: ChipStyle = {
  bg: '#FFFFFF',
  text: '#A30000',
  border: '#C40000',
  borderStyle: 'dashed',
};

/** An absence: sick, vacation or other (FR-51). */
export const absenceChipStyles: Record<string, ChipStyle> = {
  SICK: { bg: '#FFFFFF', text: '#9A3412', border: '#C2410C', borderStyle: 'dashed' },
  VACATION: { bg: '#E3F0E8', text: '#046A38' },
  OTHER: { bg: '#EEF0F2', text: '#444A50' },
};

/** A day off. */
export const offChipStyle: ChipStyle = { bg: 'transparent', text: '#666666' };

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
