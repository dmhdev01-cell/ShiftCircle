import { describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ThemeProvider } from '@mui/material/styles';

import { api, ApiError } from '../api/client';
import { theme } from '../theme/theme';
import { PublishPeriodButton } from './PublishPeriodButton';

const draft = { id: 'period-1', label: '16 – 22 Nov 2026', status: 'DRAFT' as const };

function renderButton(
  period: { id: string; label: string; status: 'DRAFT' | 'PUBLISHED' } = draft,
) {
  const onPublished = vi.fn();
  render(
    <ThemeProvider theme={theme}>
      <PublishPeriodButton period={period} onPublished={onPublished} />
    </ThemeProvider>,
  );
  return { onPublished };
}

describe('the publish period action', () => {
  it('says what publishing means before it publishes', async () => {
    const user = userEvent.setup();
    const publish = vi.spyOn(api, 'publishSchedulePeriod');
    renderButton();

    await user.click(screen.getByRole('button', { name: 'Publish period' }));

    const dialog = screen.getByRole('dialog');
    expect(dialog).toHaveTextContent('Publish the roster for 16 – 22 Nov 2026');
    expect(dialog).toHaveTextContent('the roster is final');
    expect(dialog).toHaveTextContent('one-way');
    expect(dialog).toHaveTextContent('audit log');
    expect(publish).not.toHaveBeenCalled();
  });

  it('publishes the period and reloads the board', async () => {
    const user = userEvent.setup();
    const publish = vi.spyOn(api, 'publishSchedulePeriod').mockResolvedValue({
      id: draft.id,
      status: 'PUBLISHED',
      publishedAt: '2026-11-19T09:00:00Z',
    });
    const { onPublished } = renderButton();

    await user.click(screen.getByRole('button', { name: 'Publish period' }));
    await user.click(screen.getByRole('button', { name: 'Publish period' }));

    await waitFor(() => expect(publish).toHaveBeenCalledWith('period-1'));
    expect(onPublished).toHaveBeenCalled();
    expect(await screen.findByText('Published. The officers see this roster as final.')).toBeInTheDocument();
  });

  it('says the period is already published when the api answers 409', async () => {
    const user = userEvent.setup();
    vi.spyOn(api, 'publishSchedulePeriod').mockRejectedValue(
      new ApiError('This period is already published.', 409),
    );
    const { onPublished } = renderButton();

    await user.click(screen.getByRole('button', { name: 'Publish period' }));
    await user.click(screen.getByRole('button', { name: 'Publish period' }));

    expect(await screen.findByText('This period is already published.')).toBeInTheDocument();
    expect(onPublished).toHaveBeenCalled();
  });

  it('says the period is not in your unit when the api answers 404', async () => {
    const user = userEvent.setup();
    vi.spyOn(api, 'publishSchedulePeriod').mockRejectedValue(
      new ApiError('Schedule period not found', 404),
    );
    renderButton();

    await user.click(screen.getByRole('button', { name: 'Publish period' }));
    await user.click(screen.getByRole('button', { name: 'Publish period' }));

    expect(await screen.findByText('That period is not in your unit.')).toBeInTheDocument();
  });

  it('is disabled once the period is published', () => {
    renderButton({ ...draft, status: 'PUBLISHED' });

    expect(screen.getByRole('button', { name: 'Publish period' })).toBeDisabled();
    expect(screen.getByText('Published. A correction is a further assignment.')).toBeInTheDocument();
  });
});
