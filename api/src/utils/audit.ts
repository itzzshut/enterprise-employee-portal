import { db } from '@config/knex';
import { logger, requestContext } from './logger';
import type { AuditEvent } from '@/types';

/**
 * Best-effort audit write.
 *
 * Auditing must never fail the user's request: if the insert throws (disk full,
 * lock timeout) we log loudly and continue. The structured log line is the
 * fallback record, and it carries the same correlation id as the row would.
 */
export async function recordAudit(event: AuditEvent, ipAddress?: string): Promise<void> {
  const requestId = event.requestId ?? requestContext.getStore()?.requestId ?? null;
  try {
    await db('audit_logs').insert({
      actor_user_id: event.actorUserId,
      action: event.action,
      entity_type: event.entityType,
      entity_id: event.entityId,
      metadata: event.metadata ? JSON.stringify(event.metadata) : null,
      request_id: requestId,
      ip_address: ipAddress ?? null,
    });
  } catch (error) {
    logger.error('Failed to write audit log', {
      action: event.action,
      entityType: event.entityType,
      entityId: event.entityId,
      reason: (error as Error).message,
    });
  }
}
