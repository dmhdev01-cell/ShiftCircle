import { Suspense, lazy } from 'react';
import { Navigate, Route, Routes } from 'react-router-dom';
import { BrowserRouter } from 'react-router-dom';
import CssBaseline from '@mui/material/CssBaseline';
import Box from '@mui/material/Box';
import { ThemeProvider } from '@mui/material/styles';

import { AboutPage } from './pages/AboutPage';
import { PlaceholderPage } from './pages/PlaceholderPage';
import { AppShell } from './shell/AppShell';
import { RoleProvider } from './shell/nav';
import { theme } from './theme/theme';

/** The planning board is the heaviest screen, so it loads on its own. */
const PlanningPage = lazy(() =>
  import('./planning/PlanningPage').then((module) => ({ default: module.PlanningPage })),
);

const OvertimePage = lazy(() =>
  import('./overtime/OvertimePage').then((module) => ({ default: module.OvertimePage })),
);

function RouteFallback() {
  return (
    <Box sx={{ p: 4, fontSize: 14 }} role="status">
      Loading…
    </Box>
  );
}

/**
 * Every route listed in docs/ui/README.md §5 and §6. Screens that the scaffold
 * does not build yet render a placeholder that says what is planned.
 */
export function AppRoutes() {
  return (
    <Suspense fallback={<RouteFallback />}>
      <Routes>
        <Route path="/" element={<Navigate to="/planning" replace />} />
        <Route path="/planning" element={<PlanningPage />} />
        <Route path="/overtime" element={<OvertimePage />} />
        <Route
          path="/reports/:tab"
          element={
            <PlaceholderPage
              title="Reports"
              subtitle="Supervisor · Coverage, hours and overtime"
              planned="Tabs for coverage, hours and overtime, with date, unit and officer filters and a CSV export."
            />
          }
        />
        <Route
          path="/rules/:version/shift-types"
          element={
            <PlaceholderPage
              title="Shift types"
              subtitle="Rules admin · Shift templates"
              planned="A grid of shift templates (code, label, start, length, regular or overtime-only, chip style, active, effective date), edited in a rule-set draft and published through the build, approve and publish flow (ADR-015)."
            />
          }
        />
        <Route
          path="/rules/:version/review"
          element={
            <PlaceholderPage
              title="Rule version review"
              subtitle="Approver · Before and after"
              planned="The approver's before/after diff, the build and dry-run report, and Approve or Reject with a comment."
            />
          }
        />
        <Route
          path="/rules/:version/:table"
          element={
            <PlaceholderPage
              title="Rules"
              subtitle="Rules admin · Decision table"
              planned="The decision-table grid, the plain-language preview panel, the publish checklist and the version history."
            />
          }
        />
        <Route
          path="/display"
          element={
            <PlaceholderPage
              title="Wall display"
              subtitle="Today's coverage · 1920 × 1080"
              planned="Six unit cards with counts only (no names), the clock, open shifts in the next 48 hours and facility totals."
            />
          }
        />
        <Route
          path="/me/schedule"
          element={
            <PlaceholderPage
              title="My schedule"
              subtitle="Employee · My schedule"
              planned="The next shift card, pay-period hours, the month calendar, the overtime offer card and the shift proposals."
            />
          }
        />
        <Route
          path="/me/propose"
          element={
            <PlaceholderPage
              title="Propose shifts"
              subtitle="Employee · Shift proposals"
              planned="Draft proposals with a live rule result, a note to the supervisor, and Send to supervisor."
            />
          }
        />
        <Route path="/me/hours" element={<PlaceholderPage title="My hours" subtitle="Employee · Hours and overtime" />} />
        <Route
          path="/time"
          element={
            <PlaceholderPage
              title="Time & attendance"
              subtitle="Supervisor · Actuals by pay period"
              planned="A pay-period picker, scheduled against actual per officer per day, and Lock pay period."
            />
          }
        />
        <Route
          path="/proposals"
          element={
            <PlaceholderPage
              title="Proposals inbox"
              subtitle="Supervisor · Employee proposals"
              planned="A list of employee proposals with per-item accept or decline and the rule results."
            />
          }
        />
        <Route
          path="/login"
          element={
            <PlaceholderPage
              title="Sign in"
              subtitle="Mock sign-in, demo only"
              planned="A list of demo users with roles. Until it is built, the role switcher in the top bar does the same job."
            />
          }
        />
        <Route path="/about" element={<AboutPage />} />
        <Route
          path="*"
          element={
            <PlaceholderPage
              title="Page not found"
              subtitle="That route is not part of the prototype."
            />
          }
        />
      </Routes>
    </Suspense>
  );
}

/** The shell and the routes, without the router - handy for tests. */
export function AppShellRoutes() {
  return (
    <AppShell>
      <AppRoutes />
    </AppShell>
  );
}

export function App() {
  return (
    <ThemeProvider theme={theme}>
      <CssBaseline />
      <RoleProvider>
        <BrowserRouter>
          <AppShellRoutes />
        </BrowserRouter>
      </RoleProvider>
    </ThemeProvider>
  );
}
