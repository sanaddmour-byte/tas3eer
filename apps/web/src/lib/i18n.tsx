import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { ar } from './ar';
import type { Lang } from './format';

/** English string is the key; Arabic dictionary maps it. Missing entries fall back to English (checked by scripts/i18n-check). */
let current: Lang = (localStorage.getItem('rm:lang') as Lang) || 'en';
export function tr(en: string, vars?: Record<string, string | number>): string {
  let s = current === 'ar' ? ar[en] ?? en : en;
  if (vars) for (const [k, v] of Object.entries(vars)) s = s.replaceAll(`{${k}}`, String(v));
  return s;
}
const Ctx = createContext<{ lang: Lang; setLang: (l: Lang) => void }>({ lang: 'en', setLang: () => {} });
export function I18nProvider({ children }: { children: ReactNode }) {
  const [lang, setL] = useState<Lang>(current);
  const setLang = (l: Lang) => { current = l; localStorage.setItem('rm:lang', l); setL(l); };
  useEffect(() => { current = lang; document.documentElement.lang = lang; document.documentElement.dir = lang === 'ar' ? 'rtl' : 'ltr'; }, [lang]);
  const v = useMemo(() => ({ lang, setLang }), [lang]);
  return <Ctx.Provider value={v}>{children}</Ctx.Provider>;
}
export const useLang = () => useContext(Ctx);
/** Hook returning the translator so components re-render when the language changes. */
export function useT() { useContext(Ctx); return tr; }
export const mixName = (m: { nameEn: string; nameAr?: string }, lang: Lang) => (lang === 'ar' && m.nameAr ? m.nameAr : m.nameEn);
