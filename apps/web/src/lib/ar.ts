import { ar1 } from './ar1';
import { ar2 } from './ar2';
import { ar3 } from './ar3';
/** Arabic dictionary. Keys are the English UI strings. `node scripts/i18n-extract.mjs` verifies coverage. */
export const ar: Record<string, string> = { ...ar1, ...ar2, ...ar3 };
