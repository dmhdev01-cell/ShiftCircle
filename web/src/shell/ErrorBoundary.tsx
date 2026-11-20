import { Component } from 'react';
import type { ErrorInfo, ReactNode } from 'react';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Card from '@mui/material/Card';
import CardContent from '@mui/material/CardContent';
import Typography from '@mui/material/Typography';

import { colour } from '../theme/tokens';

interface ErrorBoundaryProps {
  children: ReactNode;
  /**
   * Changes when the screen changes, so the panel clears itself and the next
   * screen gets a fresh start.
   */
  resetKey?: string;
  /** What the panel says. */
  title?: string;
}

interface ErrorBoundaryState {
  error: Error | null;
  /** The reset key the current error belongs to. */
  resetKey?: string;
}

/**
 * A screen that throws must not take the whole app down.
 *
 * Without this, one bad field from the api leaves a blank page: React unmounts
 * the tree and the person sees nothing at all. With it, the screen says plain
 * words what happened, the navigation and the footer keep working, and Try
 * again gives the screen another chance.
 */
export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  state: ErrorBoundaryState = { error: null };

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { error };
  }

  /** A new screen clears the error, so the person can move on after a crash. */
  static getDerivedStateFromProps(
    props: ErrorBoundaryProps,
    state: ErrorBoundaryState,
  ): ErrorBoundaryState | null {
    if (props.resetKey !== state.resetKey) {
      return { error: null, resetKey: props.resetKey };
    }
    return null;
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    // A pilot would send this to a logger. The prototype says it in the panel
    // instead, so a broken screen is visible rather than silent.
    console.error('A screen could not be shown.', error, info.componentStack);
  }

  private tryAgain = () => {
    this.setState({ error: null });
  };

  render() {
    const { error } = this.state;
    if (!error) {
      return this.props.children;
    }

    return (
      <Card role="alert">
        <CardContent sx={{ p: 4, display: 'flex', flexDirection: 'column', gap: 2 }}>
          <Typography sx={{ fontWeight: 600, fontSize: 15 }}>
            {this.props.title ?? 'This screen could not be shown'}
          </Typography>
          <Typography sx={{ fontSize: 14, color: colour.text.secondary }}>
            Something on this screen did not load as expected. The rest of the app still works, and
            nothing was changed.
          </Typography>
          <Typography sx={{ fontSize: 12, color: colour.text.secondary }}>
            The error was: {error.message}
          </Typography>
          <Box>
            <Button variant="outlined" color="primary" onClick={this.tryAgain}>
              Try again
            </Button>
          </Box>
        </CardContent>
      </Card>
    );
  }
}
