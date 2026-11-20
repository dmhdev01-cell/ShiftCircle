import { useCallback, useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import Box from '@mui/material/Box';

import { colour } from '../theme/tokens';

interface ScrollShadowsProps {
  children: ReactNode;
  /** The accessible name of the scroll region. */
  label: string;
  /** Shown only when the content is actually wider than the box. */
  hint: string;
}

/**
 * A sideways scroll region with an edge shadow and a plain-words hint.
 *
 * A wide table (a week, a pay period) can still need horizontal scroll on a
 * tablet. When it does, the right edge fades and the hint says so; when the
 * whole table fits, neither is shown and nothing moves.
 */
export function ScrollShadows({ children, label, hint }: ScrollShadowsProps) {
  const ref = useRef<HTMLDivElement | null>(null);
  const [edges, setEdges] = useState({ left: false, right: false });

  const measure = useCallback(() => {
    const element = ref.current;
    if (!element) return;
    const max = element.scrollWidth - element.clientWidth;
    setEdges({
      left: element.scrollLeft > 1,
      right: max > 1 && element.scrollLeft < max - 1,
    });
  }, []);

  useEffect(() => {
    const element = ref.current;
    if (!element) return;
    measure();
    element.addEventListener('scroll', measure, { passive: true });
    window.addEventListener('resize', measure);
    const observer =
      typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(measure);
    observer?.observe(element);
    return () => {
      element.removeEventListener('scroll', measure);
      window.removeEventListener('resize', measure);
      observer?.disconnect();
    };
  }, [measure]);

  const shadow = (side: 'left' | 'right') => ({
    position: 'absolute' as const,
    top: 0,
    bottom: 0,
    [side]: 0,
    width: 28,
    pointerEvents: 'none' as const,
    background: `linear-gradient(to ${side === 'left' ? 'right' : 'left'}, ${
      colour.bg.surface
    } 10%, transparent)`,
  });

  return (
    <Box sx={{ position: 'relative' }}>
      <Box
        ref={ref}
        role="region"
        aria-label={label}
        tabIndex={0}
        sx={{
          overflowX: 'auto',
          '&:focus-visible': {
            outline: `2px solid ${colour.brand.link}`,
            outlineOffset: 2,
          },
        }}
      >
        {children}
      </Box>
      {edges.left ? <Box aria-hidden="true" sx={shadow('left')} /> : null}
      {edges.right ? <Box aria-hidden="true" sx={shadow('right')} /> : null}
      {edges.left || edges.right ? (
        <Box
          component="p"
          sx={{ m: '6px 12px 0', fontSize: 12, color: colour.text.secondary }}
        >
          {hint}
        </Box>
      ) : null}
    </Box>
  );
}
