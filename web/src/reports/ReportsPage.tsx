import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Card from '@mui/material/Card';
import CardContent from '@mui/material/CardContent';
import Typography from '@mui/material/Typography';

import { api } from '../api/client';
import type {
  CoverageReport,
  HoursReport,
  OvertimeReport,
  OverrideRow,
} from '../api/types';
import { ScrollShadows } from '../components/ScrollShadows';
import { StatusPill } from '../components/StatusPill';
import { colour } from '../theme/tokens';
import { CoverageChart } from './CoverageChart';
import { OvertimeBars } from './OvertimeBars';

type Tab = 'coverage' | 'hours' | 'overtime' | 'overrides';

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
    void api.getCoverageReport({}).then((report) => {
      if (active) setCoverage(report);
    }, fail);
    void api.getHoursReport({}).then((report) => {
      if (active) setHours(report);
    }, fail);
    void api.getOvertimeReport({}).then((report) => {
      if (active) setOvertime(report);
    }, fail);
    void api.getOverrides({}).then((rows) => {
      if (active) setOverrides(rows);
    }, fail);
    return () => {
      active = false;
    };
  }, [attempt]);

  const exportCsv = async () => {
    try {
      const file = await api.exportReportCsv(tab, {});
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
                Hours by officer · pay period {hours?.period.label ?? ''}
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
            {overtime ? <OvertimeBars report={overtime} title="Overtime this quarter" /> : null}
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
