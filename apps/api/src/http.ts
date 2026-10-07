import type { NextFunction, Request, RequestHandler, Response } from 'express';
import { ZodError, type ZodTypeAny, type z } from 'zod';
import type { Capability } from '@rm/shared';

export class HttpError extends Error {
  constructor(public status: number, public code: string, message: string, public extra?: Record<string, unknown>) { super(message); }
}
export const bad = (m: string, extra?: Record<string, unknown>) => new HttpError(400, 'bad_request', m, extra);
export const forbidden = (m = 'You do not have permission to do this.') => new HttpError(403, 'forbidden', m);
export const notFound = (m = 'Not found') => new HttpError(404, 'not_found', m);
export const conflict = (m: string, extra?: Record<string, unknown>) => new HttpError(409, 'conflict', m, extra);
export const unprocessable = (m: string, extra?: Record<string, unknown>) => new HttpError(422, 'unprocessable', m, extra);

export interface Ctx {
  userId: string; userName: string; userEmail: string; locale: string;
  tenantId: string; tenantName: string; membershipId: string; role: string; caps: string[]; allPlants: boolean; plantIds: string[]; csrf: string; sessionId: string;
  tenantSettings: TenantSettings;
}
export interface TenantSettings {
  separateProposerApprover: boolean; separateQuoteSubmitterApprover: boolean; staleAfterDays: number; defaultValidityDays: number;
  internalDp: number; company: { name: string; address: string; phone: string; email: string; taxNumber: string; logoText: string };
  demo?: boolean;
}
export const DEFAULT_SETTINGS: TenantSettings = {
  separateProposerApprover: true, separateQuoteSubmitterApprover: true, staleAfterDays: 60, defaultValidityDays: 14, internalDp: 4,
  company: { name: '', address: '', phone: '', email: '', taxNumber: '', logoText: '' },
};
declare module 'express-serve-static-core' { interface Request { ctx?: Ctx } }

export const wrap = (fn: (req: Request, res: Response, next: NextFunction) => Promise<unknown>): RequestHandler => (req, res, next) => { fn(req, res, next).catch(next); };
export const ctxOf = (req: Request): Ctx => { if (!req.ctx) throw new HttpError(401, 'unauthenticated', 'Authentication required'); return req.ctx; };
export const need = (req: Request, ...caps: Capability[]) => {
  const c = ctxOf(req);
  if (!caps.some((x) => c.caps.includes(x))) throw forbidden();
  return c;
};
export const has = (c: Ctx, cap: Capability) => c.caps.includes(cap);
export const plantAllowed = (c: Ctx, plantId: string | null | undefined) => !plantId || c.allPlants || c.plantIds.includes(plantId);
export function parse<S extends ZodTypeAny>(schema: S, data: unknown): z.output<S> {
  const r = schema.safeParse(data);
  if (!r.success) throw new HttpError(400, 'validation', 'Validation failed', { issues: r.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })) });
  return r.data;
}
export function errorHandler(err: unknown, _req: Request, res: Response, _next: NextFunction) {
  if (err instanceof HttpError) return res.status(err.status).json({ error: { code: err.code, message: err.message, ...err.extra } });
  if (err instanceof ZodError) return res.status(400).json({ error: { code: 'validation', message: 'Validation failed', issues: err.issues.map((i) => ({ path: i.path.join('.'), message: i.message })) } });
  const e = err as { code?: string; message?: string; constraint?: string };
  // Postgres integrity violations → client-facing 409/422
  if (e?.code === '23P01') return res.status(409).json({ error: { code: 'overlap', message: 'This overlaps an existing effective period for the same item.' } });
  if (e?.code === '23503') return res.status(422).json({ error: { code: 'reference', message: 'A referenced record does not exist in this company.' } });
  if (e?.code === '23505') return res.status(409).json({ error: { code: 'duplicate', message: 'A record with the same unique value already exists.' } });
  if (e?.code === '23000') return res.status(409).json({ error: { code: 'immutable', message: e.message ?? 'Record is immutable.' } });
  if (e?.code === '23514') return res.status(422).json({ error: { code: 'constraint', message: 'A value is outside the allowed range.' } });
  console.error(err);
  res.status(500).json({ error: { code: 'internal', message: 'Unexpected server error.' } });
}
