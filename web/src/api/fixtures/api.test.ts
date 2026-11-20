import { beforeEach, describe, expect, it } from 'vitest';

import { ApiError } from '../http';
import type { ShiftItem } from '../types';
import { createFixtureApi } from './api';
import { resetSchedulePeriod } from './schedule';

const api = createFixtureApi();

/** A rostered shift of the fixture and an empty day to move it to. */
async function aShiftAndAnEmptyDay() {
  const schedule = await api.getSchedule({ unitId: 'unit-b' });
  for (const officer of schedule.officers) {
    const free = officer.cells.find((cell) => cell.items.length === 0);
    const taken = officer.cells.find((cell) =>
      cell.items.some((item) => item.type === 'SHIFT' && !item.proposed && !item.offer),
    );
    if (free && taken) {
      const shift = taken.items.find(
        (item): item is ShiftItem => item.type === 'SHIFT' && !item.proposed && !item.offer,
      )!;
      return { officer, shift, target: free };
    }
  }
  throw new Error('the fixture has no shift to move');
}

describe('the fixture move', () => {
  it('moves the shift to the other day and counts up its version', async () => {
    const { officer, shift, target } = await aShiftAndAnEmptyDay();
    const from = shift.startAt.slice(0, 10);

    const moved = await api.moveAssignment(shift.assignmentId, shift.version, {
      change: {
        type: 'ASSIGN',
        employeeId: officer.employeeId,
        unitId: 'unit-b',
        shiftTemplate: shift.shiftTemplate,
        startAt: target.date + 'T07:00:00-06:00',
      },
    });

    expect(moved.status).toBe('PLANNED');
    expect(moved.version).toBe(shift.version + 1);

    const after = await api.getSchedule({ unitId: 'unit-b' });
    const same = after.officers.find((entry) => entry.employeeId === officer.employeeId)!;
    const fromCell = same.cells.find((cell) => cell.date === from)!;
    expect(
      fromCell.items.some(
        (item) => item.type === 'SHIFT' && item.assignmentId === shift.assignmentId,
      ),
    ).toBe(false);
    const targetCell = same.cells.find((cell) => cell.date === target.date)!;
    expect(targetCell.items).toHaveLength(1);
    expect(targetCell.items[0]).toMatchObject({
      assignmentId: shift.assignmentId,
      version: shift.version + 1,
    });
  });

  it('refuses a stale version with the 412 shape', async () => {
    const { officer, shift, target } = await aShiftAndAnEmptyDay();

    try {
      await api.moveAssignment(shift.assignmentId, shift.version + 5, {
        change: {
          type: 'ASSIGN',
          employeeId: officer.employeeId,
          unitId: 'unit-b',
          shiftTemplate: shift.shiftTemplate,
          startAt: target.date + 'T07:00:00-06:00',
        },
      });
      throw new Error('the move should have been refused');
    } catch (error) {
      const apiError = error as ApiError;
      expect(apiError.status).toBe(412);
      expect(apiError.problem?.type).toBe('https://shiftcircle.local/problems/stale-version');
    }
  });

  it('refuses a move without a version with the 428 shape', async () => {
    const { officer, shift, target } = await aShiftAndAnEmptyDay();

    try {
      await api.moveAssignment(shift.assignmentId, undefined as unknown as number, {
        change: {
          type: 'ASSIGN',
          employeeId: officer.employeeId,
          unitId: 'unit-b',
          shiftTemplate: shift.shiftTemplate,
          startAt: target.date + 'T07:00:00-06:00',
        },
      });
      throw new Error('the move should have been refused');
    } catch (error) {
      const apiError = error as ApiError;
      expect(apiError.status).toBe(428);
      expect(apiError.problem?.type).toBe('https://shiftcircle.local/problems/if-match-required');
    }
  });

  it('refuses a move to another officer', async () => {
    const { shift, target } = await aShiftAndAnEmptyDay();

    await expect(
      api.moveAssignment(shift.assignmentId, shift.version, {
        change: {
          type: 'ASSIGN',
          employeeId: 'emp-somebody-else',
          unitId: 'unit-b',
          shiftTemplate: shift.shiftTemplate,
          startAt: target.date + 'T07:00:00-06:00',
        },
      }),
    ).rejects.toBeInstanceOf(ApiError);
  });
});

describe('the fixture cancel', () => {
  it('cancels the shift with a written reason and takes it off the board', async () => {
    const { officer, shift } = await aShiftAndAnEmptyDay();
    const from = shift.startAt.slice(0, 10);

    const cancelled = await api.cancelAssignment(
      shift.assignmentId,
      shift.version,
      'No relief available today',
    );

    expect(cancelled.status).toBe('CANCELLED');
    expect(cancelled.version).toBe(shift.version + 1);

    const after = await api.getSchedule({ unitId: 'unit-b' });
    const same = after.officers.find((entry) => entry.employeeId === officer.employeeId)!;
    const cell = same.cells.find((entry) => entry.date === from)!;
    expect(
      cell.items.some((item) => item.type === 'SHIFT' && item.assignmentId === shift.assignmentId),
    ).toBe(false);
  });

  it('needs a reason of ten characters', async () => {
    const { shift } = await aShiftAndAnEmptyDay();

    try {
      await api.cancelAssignment(shift.assignmentId, shift.version, 'short');
      throw new Error('the cancel should have been refused');
    } catch (error) {
      const apiError = error as ApiError;
      expect(apiError.status).toBe(400);
      expect(apiError.message).toContain('at least 10 characters');
    }
  });

  it('refuses a cancel with a stale version', async () => {
    const { shift } = await aShiftAndAnEmptyDay();

    await expect(
      api.cancelAssignment(shift.assignmentId, shift.version + 5, 'No relief available today'),
    ).rejects.toBeInstanceOf(ApiError);
  });
});

describe('the fixture publish', () => {
  beforeEach(() => {
    resetSchedulePeriod();
  });

  it('publishes the period once and refuses a second publish', async () => {
    const published = await api.publishSchedulePeriod('period-2026-11-16');

    expect(published.status).toBe('PUBLISHED');
    expect(published.publishedAt).toBeTruthy();

    const board = await api.getSchedule({ unitId: 'unit-b' });
    expect(board.publishedState).toEqual({ published: true, unpublishedChanges: 0 });

    try {
      await api.publishSchedulePeriod('period-2026-11-16');
      throw new Error('the publish should have been refused');
    } catch (error) {
      expect((error as ApiError).status).toBe(409);
    }
  });

  it('counts the shifts that changed after the publication', async () => {
    await api.publishSchedulePeriod('period-2026-11-16');
    const { officer, shift, target } = await aShiftAndAnEmptyDay();

    await api.moveAssignment(shift.assignmentId, shift.version, {
      change: {
        type: 'ASSIGN',
        employeeId: officer.employeeId,
        unitId: 'unit-b',
        shiftTemplate: shift.shiftTemplate,
        startAt: target.date + 'T07:00:00-06:00',
      },
    });

    const board = await api.getSchedule({ unitId: 'unit-b' });
    expect(board.publishedState.published).toBe(true);
    expect(board.publishedState.unpublishedChanges).toBe(1);
  });

  it('refuses a period that is not on the board', async () => {
    await expect(api.publishSchedulePeriod('period-that-does-not-exist')).rejects.toBeInstanceOf(
      ApiError,
    );
  });
});
