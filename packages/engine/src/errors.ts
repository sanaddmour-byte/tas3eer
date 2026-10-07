import type { Issue } from './types';

export class PricingError extends Error {
  issues: Issue[];
  constructor(issues: Issue[]) {
    super(issues.map((i) => i.message).join('; '));
    this.name = 'PricingError';
    this.issues = issues;
  }
}
export const err = (code: string, message: string, path?: string, detail?: Record<string, string>): Issue => ({
  code, severity: 'error', message, path, detail,
});
export const warn = (code: string, message: string, path?: string, detail?: Record<string, string>): Issue => ({
  code, severity: 'warning', message, path, detail,
});
