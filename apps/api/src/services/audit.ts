import { schema, type Db, type Tx } from '../db/client.js';
import type { Ctx } from '../http.js';

export async function audit(tx: Db | Tx, ctx: Pick<Ctx, 'tenantId' | 'userId' | 'userName'> | { tenantId: string; userId: null; userName: string }, entityType: string, entityId: string, action: string, detail: Record<string, unknown> = {}) {
  await tx.insert(schema.auditEvents).values({ tenantId: ctx.tenantId, actorUserId: ctx.userId, actorLabel: ctx.userName, entityType, entityId, action, detail });
}
