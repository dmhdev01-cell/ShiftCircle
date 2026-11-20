import { useEffect, useState } from 'react';
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

function Table({ headings, children }: { headings: string[]; children: React.ReactNode }) {
  return (
    <Box sx={{ overflowX: 'auto' }}>
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
    </Box>
  );
}

/**
 * Reports (docs/ui/README.md §5.5): coverage, hours by officer, overtime by
 * officer and the emergency overrides, each exportable as CSV.
 */
export function ReportsPage() {
  const [tab, setTab] = useState<Tab>('coverage');
  const [coverage, setCoverage] = useState<CoverageReport | null>(null);
  const [hours, setHours] = useState<HoursReport | null>(null);
  const [overtime, setOvertime] = useState<OvertimeReport | null>(null);
  const [overrides, setOverrides] = useState<OverrideRow[] | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  // The reports are read once; the tabs show what is already loaded.
  useEffect(() => {
    let active = true;
    void api.getCoverageReport({}).then((report) => {
      if (active) setCoverage(report);
    });
    void api.getHoursReport({}).then((report) => {
      if (active) setHours(report);
    });
    void api.getOvertimeReport({}).then((report) => {
      if (active) setOvertime(report);
    });
    void api.getOverrides({}).then((rows) => {
      if (active) setOverrides(rows);
    });
    return () => {
      active = false;
    };
  }, []);

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
                onClick={() => {
                  setTab(option.id);
                  setMessage(null);
                }}
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

      {tab === 'coverage' ? (
        <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 5, alignItems: 'stretch' }}>
          <Box sx={{ flex: '3 1 520px', minWidth: 0 }}>
            {coverage ? <CoverageChart report={coverage} /> : null}
          </Box>
          <Box sx={{ flex: '2 1 340px', minWidth: 0 }}>
            {overtime ? <OvertimeBars report={overtime} /> : null}
          </Box>
        </Box>
      ) : null}

      {tab === 'hours' ? (
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
            <Table headings={hoursHeadings}>
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

      {tab === 'overtime' ? (
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
              <Table headings={['Officer', 'Overtime h', 'Share of the top officer']}>
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

      {tab === 'overrides' ? (
        <Card>
          <CardContent sx={{ p: 4, display: 'flex', flexDirection: 'column', gap: 3 }}>
            <Typography component="h2" sx={{ m: 0, fontSize: 16, fontWeight: 700 }}>
              Emergency overrides
            </Typography>
            <Table headings={['When', 'Officer', 'Unit', 'Rule', 'Reason']}>
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
