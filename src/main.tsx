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
