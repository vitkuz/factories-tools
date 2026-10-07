import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { ErrorBoundary, type FallbackProps } from 'react-error-boundary';
import '@fontsource/ibm-plex-sans/400.css';
import '@fontsource/ibm-plex-sans/500.css';
import '@fontsource/ibm-plex-sans/600.css';
import '@fontsource/ibm-plex-mono/400.css';
import '@xyflow/react/dist/style.css';
import './shared/styles/global.css';
import './shared/styles/editor.css';
import './shared/styles/tables.css';
import App from './App';
import { ErrorScreen } from './features/runs';

const renderFallback = ({ error, resetErrorBoundary }: FallbackProps) => (
  <ErrorScreen
    title="Factory Studio hit an error"
    detail={error instanceof Error ? error.message : String(error)}
    onRetry={resetErrorBoundary}
  />
);

const container: HTMLElement | null = document.getElementById('root');
if (!container) throw new Error('#root is missing from index.html');

createRoot(container).render(
  <StrictMode>
    <ErrorBoundary fallbackRender={renderFallback}>
      <App />
    </ErrorBoundary>
  </StrictMode>,
);
