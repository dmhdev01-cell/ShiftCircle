import { createTheme } from '@mui/material/styles';

import { colour, fontFamily, shape, spacingUnit } from './tokens';

/**
 * The one MUI theme for ShiftCircle, built from docs/ui/README.md §3.
 * Components read from the theme - never from raw hex values.
 */
export const theme = createTheme({
  spacing: spacingUnit,
  shape: { borderRadius: 4 },
  palette: {
    mode: 'light',
    primary: {
      main: colour.brand.primary,
      dark: colour.brand.primaryDark,
      contrastText: colour.text.onDark,
    },
    secondary: {
      main: colour.brand.accent,
      contrastText: colour.brand.link,
    },
    error: { main: colour.status.block.text },
    warning: { main: colour.status.warn.text },
    info: { main: colour.brand.link },
    success: { main: colour.status.pass.text },
    background: {
      default: colour.bg.page,
      paper: colour.bg.surface,
    },
    text: {
      primary: colour.text.primary,
      secondary: colour.text.secondary,
      disabled: colour.text.muted,
    },
    divider: colour.border.default,
  },
  typography: {
    fontFamily,
    fontWeightLight: 300,
    fontWeightRegular: 400,
    fontWeightMedium: 600,
    fontWeightBold: 700,
    h1: { fontSize: '2.25rem', fontWeight: 300, lineHeight: 1.2 },
    h2: { fontSize: '1.5rem', fontWeight: 600, lineHeight: 1.25 },
    h3: { fontSize: '1.125rem', fontWeight: 600, lineHeight: 1.3 },
    subtitle2: { fontSize: '0.8125rem', fontWeight: 600 },
    body1: { fontSize: '0.9375rem' },
    body2: { fontSize: '0.875rem' },
    caption: { fontSize: '0.75rem' },
    button: { textTransform: 'none', fontWeight: 600 },
  },
  components: {
    MuiCssBaseline: {
      styleOverrides: {
        body: {
          margin: 0,
          backgroundColor: colour.bg.page,
          color: colour.text.primary,
        },
        // Figures are tabular so columns line up (docs/ui/README.md §3.3).
        '.num': { fontVariantNumeric: 'tabular-nums' },
        // Keep keyboard focus visible everywhere (WCAG 2.1 AA).
        ':focus-visible': { outline: '3px solid #00558C', outlineOffset: '2px' },
      },
    },
    MuiAppBar: {
      defaultProps: { elevation: 0, position: 'static', color: 'primary' },
      styleOverrides: {
        root: {
          backgroundColor: colour.brand.primary,
          borderBottom: `4px solid ${colour.brand.accent}`,
        },
      },
    },
    MuiButton: {
      defaultProps: { disableElevation: true },
      styleOverrides: {
        root: {
          borderRadius: shape.button,
          minHeight: 44,
          paddingInline: 16,
          fontWeight: 600,
        },
        // Primary (yellow) button - one per screen, for the main action.
        contained: {
          backgroundColor: colour.brand.accent,
          color: colour.brand.link,
          border: `1px solid ${colour.brand.accent}`,
          '&:hover': {
            backgroundColor: colour.brand.link,
            color: colour.text.onDark,
            borderColor: colour.brand.link,
          },
        },
        // White secondary action. The danger outline is used for emergency
        // overrides only.
        outlined: {
          backgroundColor: colour.bg.surface,
          color: colour.brand.link,
          borderColor: colour.brand.link,
          '&:hover': { backgroundColor: colour.bg.linkHover },
          '&.MuiButton-colorError': {
            color: colour.status.block.text,
            borderColor: colour.status.block.border,
            '&:hover': { backgroundColor: colour.bg.surface },
          },
        },
      },
    },
    MuiChip: {
      styleOverrides: {
        root: { borderRadius: shape.chip, fontWeight: 600 },
      },
    },
    MuiCard: {
      defaultProps: { elevation: 0 },
      styleOverrides: {
        root: {
          borderRadius: shape.card,
          border: `1px solid ${colour.border.default}`,
          backgroundColor: colour.bg.surface,
        },
      },
    },
    MuiPaper: {
      styleOverrides: {
        root: { backgroundImage: 'none' },
      },
    },
    MuiLink: {
      defaultProps: { underline: 'hover' },
      styleOverrides: {
        root: {
          color: colour.brand.link,
          '&:hover': { color: colour.brand.linkHover },
        },
      },
    },
  },
});
