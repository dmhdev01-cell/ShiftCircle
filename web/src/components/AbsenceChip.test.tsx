import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';

import { AbsenceChip } from './ShiftChip';

describe('the absence chip', () => {
  it('names each absence code the api sends (FR-51)', () => {
    render(
      <>
        <AbsenceChip absenceType="SICK" />
        <AbsenceChip absenceType="VACATION" />
        <AbsenceChip absenceType="OTHER" />
      </>,
    );
    expect(screen.getByText('Sick')).toBeInTheDocument();
    expect(screen.getByText('Vac')).toBeInTheDocument();
    // A planned OTHER absence is not shown to the officer as a sickness.
    expect(screen.getByText('Other')).toBeInTheDocument();
  });
});
