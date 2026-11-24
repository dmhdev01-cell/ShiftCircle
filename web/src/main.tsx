import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

import { App } from './App.tsx';
import { usingFixtures } from './api/client';
import { enableSessionPersistence } from './api/session';
import { loadVersion } from './api/useVersion';

const container = document.getElementById('root');
if (!container) {
  throw new Error('The #root element is missing from index.html.');
}

const VERSION_TIMEOUT_MS = 3000;

// ADR-025 amendment: only the demo profile may keep the token across a refresh.
// Any failure to learn the profile leaves the session memory-only.
async function start(root: HTMLElement): Promise<void> {
  if (!usingFixtures) {
    try {
      // Shares the useVersion cache (the footer reuses it) and never holds the
      // first paint for more than 3 s: a slow api means memory-only.
      const info = await Promise.race([
        loadVersion(),
        new Promise<null>((resolve) => setTimeout(() => resolve(null), VERSION_TIMEOUT_MS)),
      ]);
      if (info?.demoMode === true) enableSessionPersistence();
    } catch {
      /* memory-only */
    }
  }
  createRoot(root).render(
    <StrictMode>
      <App />
    </StrictMode>,
  );
}

void start(container);
