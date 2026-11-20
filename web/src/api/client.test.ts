import { describe, expect, it } from 'vitest';

import { createFixtureApi } from './fixtures/api';
import { demoSchedule } from './fixtures/schedule';
import { ApiError } from './http';
import { BLOCKED_BY_RULES, WARNINGS_NEED_ACKNOWLEDGEMENT } from './types';

const api = createFixtureApi();

const pc01 = {
  employeeId: 'emp-nia',
  unitId: 'unit-b',
  shiftTemplate: 'D8',
  startAt: '2026-11-21T07:00:00-06:00',
};

describe('the fixture api', () => {
  it('answers GET /schedule with the typed planning board payload', async () => {
    const schedule = await api.getSchedule({ unitId: 'unit-b' });

    expect(schedule.unit.name).toBe('Unit B · Living unit');
    expect(schedule.publishedState).toEqual({ published: true, unpublishedChanges: 3 });
    expect(schedule.overridesThisPeriod).toBe(1);
    expect(schedule.days).toHaveLength(7);
    expect(schedule.coverage).toHaveLength(21);
    expect(schedule.officers).toHaveLength(10);
    expect(schedule.asOf).toBe('2026-11-19');
  });

  it('carries hourly coverage with the lowest count and the short hours (ADR-017)', async () => {
    const schedule = await api.getSchedule({ unitId: 'unit-b' });
    const saturdayDay = schedule.coverage.find(
      (block) => block.block === 'DAY' && block.date === '2026-11-21',
    );

    expect(saturdayDay?.required).toBe(5);
    expect(saturdayDay?.scheduled.lowestHourly).toBe(4);
    expect(saturdayDay?.scheduled.shortHours).toEqual([
      { from: '15:00', to: '17:00', count: 4 },
    ]);
    expect(saturdayDay?.covered).toBe(false);
  });

  it('uses the ADR-015 shift codes, not the mockups', async () => {
    const schedule = await api.getSchedule({ unitId: 'unit-b' });
    const nia = schedule.officers.find((officer) => officer.name === 'Nia Thompson');

    const codes = nia?.cells.flatMap((day) =>
      day.items.map((item) => (item.type === 'SHIFT' ? item.shiftTemplate : item.absenceType)),
    );

    expect(codes).toContain('A12');
    expect(codes).toContain('P12');
    expect(codes).not.toContain('D12');
    expect(codes).not.toContain('N12');
  });

  it('marks an extra shift as EXTRA rather than as an overtime chip', async () => {
    const schedule = await api.getSchedule({ unitId: 'unit-b' });
    const kari = schedule.officers.find((officer) => officer.name === 'Kari Lindqvist');
    const wednesday = kari?.cells.find((day) => day.date === '2026-11-18');

    expect(wednesday?.items).toHaveLength(2);
    expect(wednesday?.items[1]).toMatchObject({ kind: 'EXTRA', shiftTemplate: 'E8' });
  });

  it('blocks the PC-01 proposal with the documented rule results', async () => {
    const outcome = await api.previewRuleCheck({ change: { type: 'ASSIGN', ...pc01 } });

    expect(outcome.outcome).toBe('BLOCK');
    expect(outcome.ruleSetVersion).toBe(7);
    expect(outcome.overridable).toBe(true);
    expect(outcome.ruleResults.map((result) => result.ruleCode)).toEqual(['U-01', 'U-05', 'U-14']);
    expect(outcome.ruleResults[0].evidence?.[0].label).toBe('Fri 20 P12 12:00–24:00');
  });

  it('answers a blocked save with 422 and the Problem Details body', async () => {
    const save = { change: { type: 'ASSIGN' as const, ...pc01 } };

    await expect(api.saveChange(save)).rejects.toBeInstanceOf(ApiError);

    try {
      await api.saveChange(save);
    } catch (error) {
      const apiError = error as ApiError;
      expect(apiError.status).toBe(422);
      expect(apiError.blockedByRules).toBe(true);
      expect(apiError.problem?.type).toBe(BLOCKED_BY_RULES);
      expect(apiError.problem?.ruleResults).toHaveLength(3);
    }
  });

  it('accepts the same save with an emergency override', async () => {
    const outcome = await api.saveChange({
      change: { type: 'ASSIGN', ...pc01 },
      override: { reason: 'Lockdown, no relief available' },
    });

    expect(outcome.ruleOutcome.outcome).toBe('PASS');
    expect(outcome.assignmentId).toBeTruthy();
    expect(outcome.ruleOutcome.ruleResults[0].outcome).toBe('INFO');
  });

  it('asks for acknowledgement when a change only warns', async () => {
    const warnOnly = {
      employeeId: 'emp-aiden',
      unitId: 'unit-b',
      shiftTemplate: 'D8',
      startAt: '2026-11-22T07:00:00-06:00',
    };

    try {
      await api.saveChange({ change: { type: 'ASSIGN', ...warnOnly } });
      throw new Error('the save should have been refused');
    } catch (error) {
      const apiError = error as ApiError;
      expect(apiError.needsAcknowledgement).toBe(true);
      expect(apiError.problem?.type).toBe(WARNINGS_NEED_ACKNOWLEDGEMENT);
    }

    const acknowledged = await api.saveChange({
      change: { type: 'ASSIGN', ...warnOnly },
      acknowledgeWarnings: ['U-14'],
    });
    expect(acknowledged.ruleOutcome.outcome).toBe('WARN');
  });

  it('keeps the demo data and the fixtures in step', () => {
    expect(demoSchedule.officers.filter((o) => o.overtimeStatus === 'IN_OVERTIME')).toHaveLength(5);
    expect(demoSchedule.officers.filter((o) => o.overtimeStatus === 'APPROACHING')).toHaveLength(3);
    expect(demoSchedule.coverage.filter((block) => !block.covered)).toHaveLength(2);
  });
});
