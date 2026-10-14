import {
  Check,
  Column,
  CreateDateColumn,
  Entity,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  Unique,
  UpdateDateColumn,
} from "typeorm";
import { Application } from "../application.entity.js";

/** Which of the three uploads on the application form a document is. */
export enum ApplicationDocumentKind {
  license = "license",
  rating = "rating",
  earnings = "earnings",
}

/** Where a document is in being copied from the website's storage into ours. */
export enum ApplicationDocumentStatus {
  /** Known, not copied yet (or a copy failed and will be retried). */
  pending = "pending",
  /** Copied into our bucket under `storageKey`. */
  stored = "stored",
  /** Gave up (or it cannot work); `lastError` says why in plain words. */
  failed = "failed",
}

/**
 * One file an applicant uploaded on the website form: licence, rating screenshot or earnings screenshot (D54).
 * Maps to the `application_documents` table.
 *
 * The website keeps the files in its own private Supabase bucket and may clear old ones to free space, so we
 * copy each into our own private bucket as soon as we see its path. The path comes from the application
 * (`license_storage_path` and friends); a row is created for each one that is set, once per application and kind.
 */
@Entity("application_documents")
@Unique("application_documents_application_kind_key", ["applicationId", "kind"])
@Check(
  "application_documents_stored_has_file",
  `"status" <> 'stored' OR ("storage_key" IS NOT NULL AND "size_bytes" IS NOT NULL)`,
)
@Check(
  "application_documents_failed_has_error",
  `"status" <> 'failed' OR "last_error" IS NOT NULL`,
)
export class ApplicationDocument {
  @PrimaryGeneratedColumn("uuid")
  id: string;

  @Column({ name: "application_id", type: "uuid" })
  applicationId: string;

  @ManyToOne(() => Application, { onDelete: "CASCADE" })
  @JoinColumn({ name: "application_id" })
  application?: Application;

  @Column({
    type: "enum",
    enum: ApplicationDocumentKind,
    enumName: "application_document_kind",
  })
  kind: ApplicationDocumentKind;

  /** Path in the website's bucket, like `2026-10-07/<uuid>.png`. */
  @Column({ name: "source_path", type: "text" })
  sourcePath: string;

  @Column({
    name: "content_type",
    type: "varchar",
    length: 150,
    nullable: true,
  })
  contentType: string | null;

  @Column({ name: "size_bytes", type: "integer", nullable: true })
  sizeBytes: number | null;

  @Column({
    type: "enum",
    enum: ApplicationDocumentStatus,
    enumName: "application_document_status",
    default: ApplicationDocumentStatus.pending,
  })
  status: ApplicationDocumentStatus;

  /** Where our copy lives in the bucket. */
  @Column({
    name: "storage_key",
    type: "varchar",
    length: 300,
    nullable: true,
  })
  storageKey: string | null;

  /** Copy attempts so far. */
  @Column({ type: "integer", default: 0 })
  attempts: number;

  /** Why the last attempt failed, in plain words. */
  @Column({ name: "last_error", type: "text", nullable: true })
  lastError: string | null;

  @CreateDateColumn({ name: "created_at", type: "timestamptz" })
  createdAt: Date;

  @UpdateDateColumn({ name: "updated_at", type: "timestamptz" })
  updatedAt: Date;
}
