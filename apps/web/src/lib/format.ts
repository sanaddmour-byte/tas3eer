export type Lang = 'en' | 'ar';
/** Western digits in both languages (consistent numerals for prices); grouping and decimals are fixed. */
export const money = (v: string | number | null | undefined, dp = 3) => v === null || v === undefined || v === '' ? '—' : Number(v).toLocaleString('en-US', { minimumFractionDigits: dp, maximumFractionDigits: dp });
export const qty = (v: string | number | null | undefined) => v === null || v === undefined || v === '' ? '—' : Number(v).toLocaleString('en-US', { maximumFractionDigits: 3 });
export const pct = (v: string | number | null | undefined, dp = 2) => v === null || v === undefined || v === '' ? '—' : `${Number(v).toLocaleString('en-US', { minimumFractionDigits: dp, maximumFractionDigits: dp })}%`;
export const dateFmt = (v: string | Date | null | undefined) => (v ? new Date(v).toISOString().slice(0, 10) : '—');
export const dateTime = (v: string | Date | null | undefined) => (v ? new Date(v).toISOString().slice(0, 16).replace('T', ' ') : '—');
export const uid = () => crypto.randomUUID();
export const shortId = () => crypto.randomUUID().slice(0, 8);
export function ageDays(iso: string) { return Math.floor((Date.now() - Date.parse(iso)) / 86400000); }
