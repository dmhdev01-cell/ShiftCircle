import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

import { App } from './App.tsx';
import { usingFixtures } from './api/client';
import { enableSessionPersistence } from './api/session';
import { fetchVersion } from './api/version';

const container = document.getElementById('root');
if (!container) {
  throw new Error('The #root element is missing from index.html.');
}

// ADR-025 amendment: only the demo profile may keep the token across a refresh.
// Any failure to learn the profile leaves the session memory-only.
async function start(root: HTMLElement): Promise<void> {
  if (!usingFixtures) {
    try {
      if ((await fetchVersion()).demoMode === true) enableSessionPersistence();
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
