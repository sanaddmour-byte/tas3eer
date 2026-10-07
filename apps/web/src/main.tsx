import '@fontsource/inter/400.css'; import '@fontsource/inter/500.css'; import '@fontsource/inter/600.css'; import '@fontsource/inter/700.css';
import '@fontsource/noto-sans-arabic/400.css'; import '@fontsource/noto-sans-arabic/600.css'; import '@fontsource/noto-sans-arabic/700.css';
import './styles.css';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { App } from './App';
import { AuthProvider } from './auth';
import { I18nProvider } from './lib/i18n';

const qc = new QueryClient({ defaultOptions: { queries: { retry: (n, e: any) => n < 1 && e?.status !== 403 && e?.status !== 404 && e?.status !== 401, staleTime: 15_000, refetchOnWindowFocus: false } } });
createRoot(document.getElementById('root')!).render(
  <StrictMode><QueryClientProvider client={qc}><I18nProvider><AuthProvider><BrowserRouter><App /></BrowserRouter></AuthProvider></I18nProvider></QueryClientProvider></StrictMode>,
);
if ('serviceWorker' in navigator && import.meta.env.PROD) addEventListener('load', () => { navigator.serviceWorker.register('/sw.js').catch(() => {}); });
