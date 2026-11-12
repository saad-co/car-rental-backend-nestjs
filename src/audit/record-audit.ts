import type { EntityManager } from "typeorm";
import type { QueryDeepPartialEntity } from "typeorm/query-builder/QueryPartialEntity.js";
import { AuditLog } from "./audit-log.entity.js";

/** What to write down about one action. */
export interface AuditEntry {
  /** The admin who acted; null for the system. */
  actorId: string | null;
  /** `<entity>.<verb>`, for example `application.delete`. */
  action: string;
  entityType: string;
  entityId: string;
  before?: Record<string, unknown> | null;
  after?: Record<string, unknown> | null;
}

/**
 * Writes lines of the audit trail (Fleet revisions section 4) with the `manager` of the transaction the action runs in,
 * so a line exists if and only if the action does: a delete that rolls back leaves no line, a committed one always has
 * it. A plain function, not an injected service, so any service can call it from inside its own transaction.
 */
export async function recordAudit(
  manager: EntityManager,
  entries: AuditEntry[],
): Promise<void> {
  if (entries.length === 0) return;
  const actorIds = [
    ...new Set(
      entries.map((e) => e.actorId).filter((id): id is string => id !== null),
    ),
  ];
  const emails = new Map<string, string>();
  if (actorIds.length > 0) {
    const rows: { id: string; email: string }[] = await manager.query(
      `SELECT id, email FROM users WHERE id = ANY($1::uuid[])`,
      [actorIds],
    );
    for (const row of rows) emails.set(row.id, row.email);
  }
  await manager.insert(
    AuditLog,
    entries.map((entry) => ({
      actorId: entry.actorId,
      actorEmail: entry.actorId ? (emails.get(entry.actorId) ?? null) : null,
      action: entry.action,
      entityType: entry.entityType,
      entityId: entry.entityId,
      before: entry.before ?? null,
      after: entry.after ?? null,
    })) as QueryDeepPartialEntity<AuditLog>[],
  );
}
