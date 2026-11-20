import { Suspense, lazy } from 'react';
import { Navigate, Route, Routes } from 'react-router-dom';
import { BrowserRouter } from 'react-router-dom';
import CssBaseline from '@mui/material/CssBaseline';
import Box from '@mui/material/Box';
import { ThemeProvider } from '@mui/material/styles';

import { AboutPage } from './pages/AboutPage';
import { LoginPage } from './pages/LoginPage';
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

const MySchedulePage = lazy(() =>
  import('./myschedule/MySchedulePage').then((module) => ({ default: module.MySchedulePage })),
);

const RulesPage = lazy(() =>
  import('./rules/RulesPage').then((module) => ({ default: module.RulesPage })),
);

const ReportsPage = lazy(() =>
  import('./reports/ReportsPage').then((module) => ({ default: module.ReportsPage })),
);

const TimeAttendancePage = lazy(() =>
  import('./timeattendance/TimeAttendancePage').then((module) => ({
    default: module.TimeAttendancePage,
  })),
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
        <Route path="/reports/:tab" element={<ReportsPage />} />
        <Route path="/rules/:version/shift-types" element={<RulesPage />} />
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
        <Route path="/rules/:version/:table" element={<RulesPage />} />
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
        <Route path="/me/schedule" element={<MySchedulePage />} />
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
        <Route path="/time" element={<TimeAttendancePage />} />
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
        <Route path="/login" element={<LoginPage />} />
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
