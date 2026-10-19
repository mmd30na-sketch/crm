import {StrictMode, lazy, Suspense} from 'react';
import {createRoot} from 'react-dom/client';
import App from './App.tsx';
import './index.css';

// ?print=all (without ?enrollment=) shows the three registration documents with synthetic sample data; no login needed.
const params = new URLSearchParams(window.location.search);
const SamplePreview = lazy(() => import('./components/print/PrintPreview'));
const sampleOnly = params.get('print') === 'all' && !params.get('enrollment');

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    {sampleOnly ? <Suspense fallback={null}><SamplePreview /></Suspense> : <App />}
  </StrictMode>,
);

// Phones/tablets: keep the focused field visible above the on-screen keyboard (popups and long forms).
if (typeof window !== 'undefined') {
  document.addEventListener('focusin', (e) => {
    const el = e.target as HTMLElement | null;
    if (!el || window.innerWidth >= 1024 || !el.matches('input:not([type=checkbox]):not([type=radio]):not([type=file]), textarea, select')) return;
    window.setTimeout(() => { try { el.scrollIntoView({ block: 'center', behavior: 'smooth' }); } catch { /* old browsers */ } }, 350);
  });
}
