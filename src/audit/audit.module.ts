import { Module } from "@nestjs/common";
import { TypeOrmModule } from "@nestjs/typeorm";
import { AuditLog } from "./audit-log.entity.js";

/**
 * The audit trail (Fleet revisions section 4): registers the `audit_logs` entity. Writing a line is the plain function
 * `recordAudit` (called inside the acting service's own transaction); no routes, nothing reads it through the API yet.
 */
@Module({ imports: [TypeOrmModule.forFeature([AuditLog])] })
export class AuditModule {}
