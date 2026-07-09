import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './ui/App';
import { installGlobalErrorReporting } from './telemetry/errorReporting';
import './styles.css';

// Report uncaught errors and unhandled rejections into the activity log
// (best-effort; never blocks or alters the browser's own handling).
installGlobalErrorReporting();

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
