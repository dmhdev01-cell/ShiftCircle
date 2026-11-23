import { useEffect, useState, useSyncExternalStore } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Card from '@mui/material/Card';
import CardContent from '@mui/material/CardContent';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';

import { api } from '../api/client';
import { getSession, subscribeSession } from '../api/session';
import type {
  CoverageReport,
  HoursReport,
  OvertimeReport,
  OverrideRow,
  PayPeriod,
  ReportQuery,
} from '../api/types';
import { useUnits } from '../api/useUnits';
import { useVersion } from '../api/useVersion';
import { ScrollShadows } from '../components/ScrollShadows';
import { StatusPill } from '../components/StatusPill';
import { colour } from '../theme/tokens';
import { CoverageChart } from './CoverageChart';
import { OvertimeBars } from './OvertimeBars';
import { defaultRange, rangeProblem, rangeWords, unitsInScope } from './reportRange';
import type { DateRange, ReportTab } from './reportRange';

type Tab = ReportTab;

/** What the reports are read for. No range means each report's own default. */
interface ReportFilter {
  range?: DateRange;
  unitId: string;
}

const TABS: { id: Tab; label: string }[] = [
  { id: 'coverage', label: 'Coverage' },
  { id: 'hours', label: 'Hours' },
  { id: 'overtime', label: 'Overtime' },
  { id: 'overrides', label: 'Overrides' },
];

function downloadCsv(fileName: string, content: string) {
  const blob = new Blob([content], { type: 'text/csv' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = fileName;
  link.click();
  URL.revokeObjectURL(url);
}

/**
 * A report table. The wrapper takes focus and carries the table's name: a
 * report wider than the screen scrolls sideways, and a keyboard user has to be
 * able to reach the scroll (D10).
 */
function Table({
  headings,
  label,
  children,
}: {
  headings: string[];
  label: string;
  children: React.ReactNode;
}) {
  return (
    <ScrollShadows label={label} hint="Scroll sideways to see every column.">
      <table style={{ width: '100%', minWidth: 820, borderCollapse: 'collapse', fontSize: 13 }}>
        <thead>
          <tr>
            {headings.map((heading) => (
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
            ))}
          </tr>
        </thead>
        <tbody>{children}</tbody>
      </table>
    </ScrollShadows>
  );
}

const TAB_IDS = TABS.map((option) => option.id);

/** The tab the address names, or Coverage when it names none we know. */
function tabFromPath(tab: string | undefined): Tab {
  return TAB_IDS.includes(tab as Tab) ? (tab as Tab) : 'coverage';
}

/**
 * Reports (docs/ui/README.md §5.5): coverage, hours by officer, overtime by
 * officer and the emergency overrides, each exportable as CSV.
 */
export function ReportsPage() {
  const navigate = useNavigate();
  // The address is the source of truth for which report is open, so a deep
  // link, a reload and the back button all land on the report they name (D3).
  const tab = tabFromPath(useParams<{ tab?: string }>().tab);
  const [coverage, setCoverage] = useState<CoverageReport | null>(null);
  const [hours, setHours] = useState<HoursReport | null>(null);
  const [overtime, setOvertime] = useState<OvertimeReport | null>(null);
  const [overrides, setOverrides] = useState<OverrideRow[] | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);

  // FR-60/61/62: any range and any unit in scope. Until the person applies a
  // range each report keeps its own default, and the inputs show that default.
  const version = useVersion();
  const asOf = version.state.status === 'ready' ? version.state.info.asOf : undefined;
  const unitsState = useUnits();
  const sessionUser = useSyncExternalStore(subscribeSession, getSession).user;
  const scopedUnits = unitsInScope(unitsState.kind === 'ready' ? unitsState.units : [], sessionUser);
  const [payPeriods, setPayPeriods] = useState<PayPeriod[]>([]);
  const [filter, setFilter] = useState<ReportFilter>({ unitId: '' });
  const [draftFrom, setDraftFrom] = useState<string | null>(null);
  const [draftTo, setDraftTo] = useState<string | null>(null);
  const [draftUnit, setDraftUnit] = useState('');
  const [rangeError, setRangeError] = useState<string | null>(null);
  const shownRange = filter.range ?? defaultRange(tab, asOf, payPeriods);
  const fromValue = draftFrom ?? shownRange?.from ?? '';
  const toValue = draftTo ?? shownRange?.to ?? '';
  const query: ReportQuery = {
    from: filter.range?.from,
    to: filter.range?.to,
    unitId: filter.unitId || undefined,
  };
  const unitName = scopedUnits.find((unit) => unit.id === filter.unitId)?.name;

  // The hours default is a pay period; the list is only for the inputs, so a
  // refusal leaves the hours inputs on the fallback range.
  useEffect(() => {
    let active = true;
    api.getPayPeriods().then(
      (periods) => {
        if (active) setPayPeriods(periods);
      },
      () => undefined,
    );
    return () => {
      active = false;
    };
  }, []);

  // A new range or unit drops the old figures, so a report never shows numbers
  // for a range other than the one the inputs name.
  const clearReports = () => {
    setCoverage(null);
    setHours(null);
    setOvertime(null);
    setOverrides(null);
  };

  const applyFilter = () => {
    const touched = draftFrom !== null || draftTo !== null || filter.range !== undefined;
    if (touched) {
      const problem = rangeProblem(fromValue, toValue);
      if (problem) {
        setRangeError(problem);
        return;
      }
    }
    setRangeError(null);
    setMessage(null);
    setFailed(false);
    clearReports();
    setFilter({
      range: touched ? { from: fromValue, to: toValue } : undefined,
      unitId: draftUnit,
    });
  };

  const resetFilter = () => {
    setDraftFrom(null);
    setDraftTo(null);
    setDraftUnit('');
    setRangeError(null);
    setMessage(null);
    setFailed(false);
    clearReports();
    setFilter({ unitId: '' });
  };

  const showTab = (next: Tab) => {
    setMessage(null);
    navigate(`/reports/${next}`, { replace: true });
  };

  const retry = () => {
    setFailed(false);
    setAttempt((value) => value + 1);
  };

  // The reports are read once; the tabs show what is already loaded. A failed
  // read is a state of its own, with a way to try again (D4).
  useEffect(() => {
    let active = true;
    const fail = () => {
      if (active) setFailed(true);
    };
    const request: ReportQuery = {
      from: filter.range?.from,
      to: filter.range?.to,
      unitId: filter.unitId || undefined,
    };
    void api.getCoverageReport(request).then((report) => {
      if (active) setCoverage(report);
    }, fail);
    void api.getHoursReport(request).then((report) => {
      if (active) setHours(report);
    }, fail);
    void api.getOvertimeReport(request).then((report) => {
      if (active) setOvertime(report);
    }, fail);
    void api.getOverrides(request).then((rows) => {
      if (active) setOverrides(rows);
    }, fail);
    return () => {
      active = false;
    };
  }, [attempt, filter]);

  const exportCsv = async () => {
    try {
      const file = await api.exportReportCsv(tab, query);
      downloadCsv(file.fileName, file.content);
      setMessage(`The export ${file.fileName} is downloaded.`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'The export could not be made.');
    }
  };

  const hoursHeadings = [
    'Officer',
    'Scheduled',
    'Worked',
    'Regular',
    'OT 1.5×',
    ...(hours?.rows.some((row) => row.overtime20 > 0) ? ['OT 2×'] : []),
    'Sick',
    'Vacation',
    'Worked − scheduled',
  ];

  return (
    <>
      <Box
        sx={{
          display: 'flex',
          flexWrap: 'wrap',
          alignItems: 'flex-end',
          justifyContent: 'space-between',
          gap: 4,
        }}
      >
        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
          <Typography variant="h1">Reports</Typography>
          <Typography sx={{ fontSize: 14, color: colour.text.secondary }}>
            Coverage, hours, overtime and the emergency overrides
          </Typography>
        </Box>

        <Box sx={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 3 }}>
          <Box
            role="group"
            aria-label="Report"
            sx={{
              display: 'flex',
              gap: 0.5,
              p: 0.75,
              backgroundColor: colour.border.default,
              borderRadius: '8px',
            }}
          >
            {TABS.map((option) => (
              <Box
                key={option.id}
                component="button"
                type="button"
                aria-pressed={tab === option.id}
                onClick={() => showTab(option.id)}
                sx={{
                  minHeight: 40,
                  px: 3.5,
                  border: 0,
                  borderRadius: '6px',
                  backgroundColor: tab === option.id ? colour.bg.surface : 'transparent',
                  color: colour.text.primary,
                  fontFamily: 'inherit',
                  fontSize: 13,
                  fontWeight: 600,
                  cursor: 'pointer',
                }}
              >
                {option.label}
              </Box>
            ))}
          </Box>

          <Button variant="outlined" color="primary" onClick={() => void exportCsv()}>
            Export CSV
          </Button>
        </Box>
      </Box>

      <Card>
        <CardContent
          component="form"
          aria-label="Report range and unit"
          noValidate
          onSubmit={(event: { preventDefault: () => void }) => {
            event.preventDefault();
            applyFilter();
          }}
          sx={{ p: 4, display: 'flex', flexWrap: 'wrap', alignItems: 'flex-start', gap: 3 }}
        >
          <TextField
            label="From"
            type="date"
            size="small"
            value={fromValue}
            error={rangeError !== null}
            onChange={(event) => setDraftFrom(event.target.value)}
            slotProps={{
              inputLabel: { shrink: true },
              htmlInput: { 'aria-describedby': rangeError ? 'report-range-error' : undefined },
            }}
          />
          <TextField
            label="To"
            type="date"
            size="small"
            value={toValue}
            error={rangeError !== null}
            onChange={(event) => setDraftTo(event.target.value)}
            slotProps={{
              inputLabel: { shrink: true },
              htmlInput: { 'aria-describedby': rangeError ? 'report-range-error' : undefined },
            }}
          />
          {scopedUnits.length > 0 ? (
            <TextField
              select
              label="Unit"
              size="small"
              value={draftUnit}
              onChange={(event) => setDraftUnit(event.target.value)}
              slotProps={{ select: { native: true }, inputLabel: { shrink: true } }}
              sx={{ minWidth: 200 }}
            >
              <option value="">All my units</option>
              {scopedUnits.map((unit) => (
                <option key={unit.id} value={unit.id}>
                  {unit.name}
                </option>
              ))}
            </TextField>
          ) : null}
          <Box sx={{ display: 'flex', gap: 2 }}>
            <Button type="submit" variant="contained" color="primary">
              Apply
            </Button>
            <Button variant="outlined" color="primary" onClick={resetFilter}>
              Reset
            </Button>
          </Box>
          <Box sx={{ flexBasis: '100%', display: 'flex', flexDirection: 'column', gap: 1 }}>
            {rangeError ? (
              <Typography
                id="report-range-error"
                role="alert"
                sx={{ fontSize: 13, fontWeight: 600, color: colour.status.block.text }}
              >
                {rangeError}
              </Typography>
            ) : null}
            <Typography sx={{ fontSize: 12, color: colour.text.secondary }}>
              {filter.range
                ? `Every report covers ${rangeWords(filter.range)}`
                : "Each report covers its own default range"}
              {` · ${unitName ?? 'All my units'}`}
            </Typography>
          </Box>
        </CardContent>
      </Card>

      {message ? (
        <Box
          role="status"
          sx={{
            p: '10px 12px',
            borderRadius: '8px',
            backgroundColor: colour.status.info.bg,
            color: colour.status.info.text,
            fontSize: 13,
            fontWeight: 600,
          }}
        >
          {message}
        </Box>
      ) : null}

      {failed ? (
        <Card>
          <CardContent sx={{ p: 4, display: 'flex', flexDirection: 'column', gap: 2 }}>
            <Typography sx={{ fontWeight: 600, fontSize: 15, color: colour.status.block.text }}>
              Could not load the reports
            </Typography>
            <Typography sx={{ fontSize: 14, color: colour.text.secondary }}>
              The reports did not arrive. Check the connection and try again.
            </Typography>
            <Box>
              <Button variant="outlined" color="primary" onClick={retry}>
                Try again
              </Button>
            </Box>
          </CardContent>
        </Card>
      ) : null}

      {tab === 'coverage' && !failed ? (
        <Box sx={{ display: 'flex', flexDirection: 'column' }}>
          {coverage ? <CoverageChart report={coverage} /> : null}
        </Box>
      ) : null}

      {tab === 'hours' && !failed ? (
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
              alignItems: 'center',
              justifyContent: 'space-between',
              gap: 3,
            }}
          >
            <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
              <Typography component="h2" sx={{ m: 0, fontSize: 16, fontWeight: 700 }}>
                {filter.range
                  ? `Hours by officer · ${rangeWords(filter.range)}`
                  : `Hours by officer · pay period ${hours?.period.label ?? ''}`}
              </Typography>
              <Box
                component="span"
                sx={{ display: 'flex', alignItems: 'center', gap: 2, fontSize: 13, color: colour.text.secondary }}
              >
                {hours?.period.status === 'LOCKED' ? (
                  <StatusPill tone="pass">Locked</StatusPill>
                ) : (
                  <StatusPill tone="info">Open</StatusPill>
                )}
                {hours?.period.lockedBy
                  ? `by ${hours.period.lockedBy} on ${hours.period.lockedAt} · totals in hours`
                  : 'totals in hours'}
              </Box>
            </Box>
            <Button variant="contained" color="primary" onClick={() => void exportCsv()}>
              Payroll export (CSV)
            </Button>
          </Box>

          {hours ? (
            <Table headings={hoursHeadings} label="Hours by officer">
              {hours.rows.map((row) => (
                <tr key={row.employeeId}>
                  <td style={{ padding: '8px 10px', fontWeight: 600, borderBottom: `1px solid ${colour.border.default}` }}>
                    {row.name}
                  </td>
                  <td className="num" style={{ padding: '8px 10px', borderBottom: `1px solid ${colour.border.default}` }}>
                    {row.scheduled}
                  </td>
                  <td className="num" style={{ padding: '8px 10px', borderBottom: `1px solid ${colour.border.default}` }}>
                    {row.worked}
                  </td>
                  <td className="num" style={{ padding: '8px 10px', borderBottom: `1px solid ${colour.border.default}` }}>
                    {row.regular}
                  </td>
                  <td className="num" style={{ padding: '8px 10px', borderBottom: `1px solid ${colour.border.default}` }}>
                    {row.overtime15}
                  </td>
                  {hoursHeadings.includes('OT 2×') ? (
                    <td className="num" style={{ padding: '8px 10px', borderBottom: `1px solid ${colour.border.default}` }}>
                      {row.overtime20}
                    </td>
                  ) : null}
                  <td className="num" style={{ padding: '8px 10px', borderBottom: `1px solid ${colour.border.default}` }}>
                    {row.sick}
                  </td>
                  <td className="num" style={{ padding: '8px 10px', borderBottom: `1px solid ${colour.border.default}` }}>
                    {row.vacation}
                  </td>
                  <td className="num" style={{ padding: '8px 10px', fontWeight: 600, borderBottom: `1px solid ${colour.border.default}` }}>
                    {Math.round((row.worked - row.scheduled) * 100) / 100}
                  </td>
                </tr>
              ))}
            </Table>
          ) : null}

          <Typography component="span" sx={{ fontSize: 12, color: colour.text.secondary }}>
            Showing {hours?.rows.length ?? 0} of {hours?.totalOfficers ?? 0} officers · Pay codes follow
            the pay classification rule table (P-01, P-02) · The payroll system itself is simulated
          </Typography>
        </Box>
      ) : null}

      {tab === 'overtime' && !failed ? (
        <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 5, alignItems: 'stretch' }}>
          <Box sx={{ flex: '2 1 340px', minWidth: 0 }}>
            {overtime ? (
              <OvertimeBars
                report={overtime}
                title={filter.range ? `Overtime ${rangeWords(filter.range)}` : 'Overtime this quarter'}
              />
            ) : null}
          </Box>
          <Box sx={{ flex: '3 1 520px', minWidth: 0 }}>
            <Box
              sx={{
                backgroundColor: colour.bg.surface,
                border: `1px solid ${colour.border.default}`,
                borderRadius: '10px',
                p: 4,
                display: 'flex',
                flexDirection: 'column',
                gap: 2.5,
              }}
            >
              <Typography component="h2" sx={{ m: 0, fontSize: 16, fontWeight: 700 }}>
                Overtime by officer
              </Typography>
              <Table headings={['Officer', 'Overtime h', 'Share of the top officer']} label="Overtime by officer">
                {overtime?.rows.map((row) => {
                  const top = overtime.rows[0]?.hours ?? 1;
                  return (
                    <tr key={row.employeeId}>
                      <td style={{ padding: '8px 10px', fontWeight: 600, borderBottom: `1px solid ${colour.border.default}` }}>
                        {row.name}
                      </td>
                      <td className="num" style={{ padding: '8px 10px', borderBottom: `1px solid ${colour.border.default}` }}>
                        {row.hours.toFixed(1)}
                      </td>
                      <td className="num" style={{ padding: '8px 10px', borderBottom: `1px solid ${colour.border.default}` }}>
                        {Math.round((row.hours / top) * 100)}%
                      </td>
                    </tr>
                  );
                })}
              </Table>
            </Box>
          </Box>
        </Box>
      ) : null}

      {tab === 'overrides' && !failed ? (
        <Card>
          <CardContent sx={{ p: 4, display: 'flex', flexDirection: 'column', gap: 3 }}>
            <Typography component="h2" sx={{ m: 0, fontSize: 16, fontWeight: 700 }}>
              Emergency overrides
            </Typography>
            {/* An empty table is not an answer: say that nothing was overridden (D2). */}
            {overrides !== null && overrides.length === 0 ? (
              <Typography sx={{ fontSize: 14, color: colour.text.secondary }}>
                No emergency overrides in this scope. Nothing has needed one.
              </Typography>
            ) : null}
            <Table headings={['When', 'Officer', 'Unit', 'Rule', 'Reason']} label="Emergency overrides">
              {overrides?.map((row) => (
                <tr key={row.id}>
                  <td className="num" style={{ padding: '8px 10px', borderBottom: `1px solid ${colour.border.default}` }}>
                    {row.at}
                  </td>
                  <td style={{ padding: '8px 10px', fontWeight: 600, borderBottom: `1px solid ${colour.border.default}` }}>
                    {row.employeeName}
                  </td>
                  <td style={{ padding: '8px 10px', borderBottom: `1px solid ${colour.border.default}` }}>
                    {row.unitName}
                  </td>
                  <td style={{ padding: '8px 10px', borderBottom: `1px solid ${colour.border.default}` }}>
                    {row.ruleCode ?? '—'}
                  </td>
                  <td style={{ padding: '8px 10px', borderBottom: `1px solid ${colour.border.default}` }}>
                    {row.reason}
                  </td>
                </tr>
              ))}
            </Table>
            <Typography component="span" sx={{ fontSize: 12, color: colour.text.secondary }}>
              Every override is recorded with a reason and flagged in the reports.
            </Typography>
          </CardContent>
        </Card>
      ) : null}
    </>
  );
}
