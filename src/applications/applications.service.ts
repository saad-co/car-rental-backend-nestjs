import {
  BadRequestException,
  ConflictException,
  HttpException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
} from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { InjectRepository } from "@nestjs/typeorm";
import { isEmail } from "class-validator";
import {
  Brackets,
  DataSource,
  EntityManager,
  In,
  IsNull,
  Not,
  Repository,
} from "typeorm";
import { likePattern, phoneDigits } from "../common/search.js";
import { isUniqueViolation } from "../database/postgres-errors.js";
import { driverWelcomeText } from "../drivers/driver-welcome.text.js";
import { Driver } from "../drivers/driver.entity.js";
import { toUsE164 } from "../drivers/us-phone.js";
import { TemplateKind } from "../message-templates/message-template.entity.js";
import { MessageTemplatesService } from "../message-templates/message-templates.service.js";
import { SmsContactKind } from "../sms/sms-contact.js";
import { SmsService } from "../sms/sms.service.js";
import type { FileStorage } from "../sms/storage/file-storage.js";
import { FILE_STORAGE } from "../sms/storage/file-storage.module.js";
import { PasswordService } from "../users/password.service.js";
import { Role, User } from "../users/user.entity.js";
import { ApplicationAlertService } from "./application-alert.service.js";
import { Application, ApplicationStatus } from "./application.entity.js";
import { ApplicationDocument } from "./documents/application-document.entity.js";
import {
  ApplicationDetailDto,
  ApplicationListDto,
  ApplicationListItemDto,
} from "./dto/application.dto.js";
import { DeleteApplicationsResultDto } from "./dto/delete-applications.dto.js";
import { ListApplicationsQueryDto } from "./dto/list-applications-query.dto.js";

/** Result of receiving a submission. `created` is false when it was a repeat of one already stored. */
export interface ReceiveResult {
  application: Application;
  created: boolean;
}

/** A submission from the website: a flat JSON object whose values are mostly strings. */
type Submission = Record<string, unknown>;

/**
 * Driver applications: intake from the website, the admin list and detail views, review
 * (approve, reject, on hold) and delete.
 *
 * Intake is lenient on purpose. The website is not ours and sends every value as text, so
 * instead of a strict DTO (which would reject a real application the day the form adds or
 * renames a field) we check only the fields we cannot do without, and keep the rest as-is
 * in `payload`.
 */
@Injectable()
export class ApplicationsService {
  private readonly logger = new Logger(ApplicationsService.name);
  /** Base address of the web app, for the login link in the text. */
  private readonly webAppUrl: string;

  constructor(
    @InjectRepository(Application)
    private readonly applications: Repository<Application>,
    /** The database connection, used to run several writes as one transaction. */
    private readonly dataSource: DataSource,
    private readonly passwords: PasswordService,
    private readonly sms: SmsService,
    private readonly alerts: ApplicationAlertService,
    config: ConfigService,
    /** Our file bucket, to remove copied files when an application is deleted. Null when no bucket is set up. */
    @Inject(FILE_STORAGE) private readonly storage: FileStorage | null,
    /** The approved / declined texts the admin edits in Settings (B73). */
    private readonly templates: MessageTemplatesService,
  ) {
    this.webAppUrl = config.getOrThrow<string>("WEB_APP_URL");
  }

  /**
   * Stores a submission from the gonzocar.com form.
   *
   * Idempotent: the website's `request_id` is unique in the database. If the same submission
   * arrives again (a retry, a double click), the insert fails on that constraint and the
   * application already stored is returned instead. Letting the database decide is safe even
   * when both copies arrive at the same instant; a "check first, then insert" in code is not.
   *
   * @throws BadRequestException listing every problem, if a required field is missing or invalid.
   */
  async receive(body: unknown): Promise<ReceiveResult> {
    if (typeof body !== "object" || body === null || Array.isArray(body)) {
      throw new BadRequestException("Body must be a JSON object.");
    }
    const submission = body as Submission;
    const problems: string[] = [];

    /**
     * Reads one text field: trims it, turns "" into null, records a problem if it is required
     * but missing or longer than its database column.
     */
    const text = (key: string, maxLength: number, required: boolean) => {
      const raw = submission[key];
      const value =
        typeof raw === "string" || typeof raw === "number"
          ? String(raw).trim()
          : "";
      if (value === "") {
        if (required) problems.push(`${key} is required`);
        return null;
      }
      if (value.length > maxLength) {
        problems.push(`${key} must be at most ${maxLength} characters`);
        return null;
      }
      return value;
    };

    const requestId = text("request_id", 100, true);
    const firstName = text("first_name", 100, true);
    const lastName = text("last_name", 100, true);
    const email = text("email", 254, true)?.toLowerCase() ?? null;
    const phone = text("phone", 30, true);
    const city = text("city", 100, false);
    const zip = text("zip", 10, false);
    const licenseStoragePath = text("license_storage_path", 500, false);
    const ratingStoragePath = text("rating_storage_path", 500, false);
    const earningsStoragePath = text("earnings_storage_path", 500, false);

    if (email !== null && !isEmail(email)) {
      problems.push("email must be a valid email address");
    }

    if (problems.length > 0) {
      throw new BadRequestException(problems);
    }
    // From here the required fields are known to be set; the `!` below only tells TypeScript so.

    // Keep everything the website sent except the one-time bot-check token.
    const payload: Submission = { ...submission };
    delete payload.turnstile_token;

    const application = this.applications.create({
      requestId: requestId!,
      firstName: firstName!,
      lastName: lastName!,
      email: email!,
      phone: phone!,
      city,
      zip,
      submittedAt: this.parseDate(submission.submitted_at),
      licenseStoragePath,
      ratingStoragePath,
      earningsStoragePath,
      payload,
    });

    try {
      const saved = await this.applications.save(application);
      // Staff are told by text (D53). Not waited for and never throws: the website's submission must succeed
      // even if Quo is down. Only for a new application, never for a repeat of the same request_id.
      this.alerts.notifyInBackground(saved);
      return { application: saved, created: true };
    } catch (error) {
      if (!isUniqueViolation(error)) throw error;
      // `request_id` is the only unique column set on insert, so this is a repeat.
      const existing = await this.applications.findOneByOrFail({
        requestId: requestId!,
      });
      return { application: existing, created: false };
    }
  }

  /**
   * One page of applications, newest first, optionally only one status and only those matching a search.
   *
   * Built with a QueryBuilder because the search is "status = X AND (name OR email OR ...)", which `find()` cannot
   * say simply. `:status`, `:pattern` are parameters: Postgres receives the values separately from the SQL, so a
   * search can never change the query (no SQL injection).
   *
   * The search (B75) matches, ignoring case: first name, last name, "first last", email, city; and the phone by its
   * digits, so "312 555" finds "(312) 555-0101". Mongo equivalent: `$or` of case-insensitive `$regex`es.
   * With hundreds of rows Postgres simply reads them all; if this ever grows to many thousands, a trigram index
   * (`pg_trgm`) would make `ILIKE '%...%'` fast.
   *
   * `skip` / `take` become SQL `OFFSET` / `LIMIT` (Mongoose: `.skip()` / `.limit()`).
   * `getManyAndCount` also returns the total number of matching rows, for page numbers.
   * `id` is a second sort key so rows received in the same millisecond keep a fixed order
   * across pages.
   */
  async list(query: ListApplicationsQueryDto): Promise<ApplicationListDto> {
    const builder = this.applications
      .createQueryBuilder("a")
      .orderBy("a.createdAt", "DESC")
      .addOrderBy("a.id", "DESC")
      .skip((query.page - 1) * query.limit)
      .take(query.limit);
    if (query.status) {
      builder.andWhere("a.status = :status", { status: query.status });
    }
    if (query.search) {
      const digits = phoneDigits(query.search);
      builder.andWhere(
        new Brackets((match) => {
          match
            .where("a.first_name ILIKE :pattern")
            .orWhere("a.last_name ILIKE :pattern")
            .orWhere("(a.first_name || ' ' || a.last_name) ILIKE :pattern")
            .orWhere("a.email ILIKE :pattern")
            .orWhere("a.city ILIKE :pattern");
          if (digits) {
            match.orWhere(
              "regexp_replace(a.phone, '\\D', '', 'g') LIKE :digits",
              { digits: likePattern(digits) },
            );
          }
        }),
        { pattern: likePattern(query.search) },
      );
    }
    const [rows, total] = await builder.getManyAndCount();
    return {
      items: rows.map((row) => this.toListItem(row)),
      total,
      page: query.page,
      limit: query.limit,
    };
  }

  /**
   * One application with all its details.
   * @throws NotFoundException if there is no application with this id.
   */
  async findOne(id: string): Promise<ApplicationDetailDto> {
    const application = await this.applications.findOneBy({ id });
    if (!application) {
      throw new NotFoundException("Application not found.");
    }
    return this.toDetail(application);
  }

  /**
   * Approves an application, in one transaction:
   * 1. creates the driver's login (`users`, role `driver`) with a generated password, required to
   *    change it at first login (D26). The email counts as confirmed from the start: the driver
   *    gets the login by text, which proves the phone, so there is no confirmation link (D52);
   * 2. creates the Driver, linked to that login;
   * 3. marks the application approved;
   * 4. texts the applicant the approval text (B71, B81: the one the admin picked and edited, or the first "approved"
   *    template from Settings), then their email and
   *    temporary password (D52), as two texts through the same chat as every other text: sent when
   *    SMS_MODE is `live`, saved as "Dry run: not sent" when `dry_run` (the admin can read them in
   *    the chat and pass them on), refused when `off`. The login text is fixed in code, never a
   *    template: an edit must never be able to break the credentials.
   *
   * The texts are sent last, inside the transaction: if one fails, everything is rolled back and
   * the admin can simply try again. (A text that went out before the failure stays in the chat:
   * it really was sent. The reverse, texts sent but the commit failing, is very unlikely; the
   * driver would hold a password for an account that does not exist, and approving again sends
   * a new one.)
   *
   * @param adminId the admin approving it (stored as the reviewer).
   * @param options.message the approval text to send; the first approved template when missing.
   * @throws NotFoundException if there is no application with this id.
   * @throws ConflictException if it is already approved, if a driver or login already has
   *   this email, or a driver has this phone.
   * @throws BadRequestException if the phone is not a valid US number.
   * @throws ServiceUnavailableException if a text could not be sent (nothing approved).
   */
  async approve(
    id: string,
    adminId: string,
    options: { message?: string } = {},
  ): Promise<ApplicationDetailDto> {
    // Prepared before the transaction: hashing is deliberately slow, and the row lock taken
    // inside should be held as briefly as possible.
    const temporaryPassword = this.passwords.generate();
    const passwordHash = await this.passwords.hash(temporaryPassword);

    try {
      const approved = await this.dataSource.transaction(async (manager) => {
        const application = await this.loadForReview(manager, id);

        const phone = toUsE164(application.phone);
        if (!phone) {
          throw new BadRequestException(
            `Phone "${application.phone}" is not a valid US number, so no driver can be created.`,
          );
        }

        // Checked first only to give a precise message. The unique constraints on `drivers`
        // still decide if two approvals race; that case is caught below.
        const existing = await manager.findOne(Driver, {
          where: [{ email: application.email }, { phone }],
        });
        if (existing) {
          throw new ConflictException(
            existing.email === application.email
              ? "A driver with this email already exists."
              : "A driver with this phone number already exists.",
          );
        }

        // The admin account, or a login left over from an earlier driver, may use this email.
        const existingLogin = await manager.findOne(User, {
          where: { email: application.email },
        });
        if (existingLogin) {
          throw new ConflictException(
            "A login with this email already exists.",
          );
        }

        const user = await manager.save(
          manager.create(User, {
            email: application.email,
            passwordHash,
            role: Role.driver,
            mustChangePassword: true,
            emailVerifiedAt: new Date(),
          }),
        );

        const driver = await manager.save(
          manager.create(Driver, {
            firstName: application.firstName,
            lastName: application.lastName,
            email: application.email,
            phone,
            userId: user.id,
          }),
        );

        application.status = ApplicationStatus.approved;
        application.driverId = driver.id;
        application.reviewedById = adminId;
        application.reviewedAt = new Date();
        const saved = await manager.save(application);

        await this.sendOrFail(
          application,
          await this.templates.render(
            TemplateKind.application_approved,
            this.templateValues(application),
            options.message,
          ),
          adminId,
          "The approval text",
          "nothing was approved",
        );
        await this.sendOrFail(
          application,
          driverWelcomeText({
            firstName: application.firstName,
            email: application.email,
            temporaryPassword,
            loginUrl: `${this.webAppUrl}/driver/login`,
          }),
          adminId,
          "The login text",
          "nothing was approved",
        );
        return saved;
      });
      return this.toDetail(approved);
    } catch (error) {
      if (isUniqueViolation(error)) {
        throw new ConflictException(
          "A driver or login with this email or phone number already exists.",
        );
      }
      throw error;
    }
  }

  /**
   * Texts an applicant inside a review transaction, through `SmsService.send`, so the text follows SMS_MODE, shows
   * in the application's chat, and a failure comes back in plain words. Throwing rolls the review back.
   * @param what names the text in the message, e.g. "The login text".
   * @param outcome what did not happen, e.g. "nothing was approved".
   * @throws ServiceUnavailableException if the text could not be sent or saved; the cause is logged.
   */
  private async sendOrFail(
    application: Application,
    text: string,
    adminId: string,
    what: string,
    outcome: string,
  ): Promise<void> {
    try {
      await this.sms.send(
        SmsContactKind.applications,
        application.id,
        text,
        adminId,
      );
    } catch (error) {
      this.logger.error(
        `${what} for application ${application.id} failed; ${outcome}.`,
        error instanceof Error ? error.stack : String(error),
      );
      const reason =
        error instanceof HttpException ? error.message : "Please try again.";
      throw new ServiceUnavailableException(
        `${what} could not be sent, so ${outcome}. ${reason}`,
      );
    }
  }

  /** The values the application texts' placeholders are filled with (B73). */
  private templateValues(application: Application): Record<string, string> {
    return {
      firstName: application.firstName,
      lastName: application.lastName,
    };
  }

  /**
   * Declines an application (stored as `rejected`, B69) or puts it on hold. No driver is created. Can be changed
   * again later, unless the application has been approved.
   *
   * Declining with a `message` also texts the applicant that text (B72, B81): the admin picks a "declined" template
   * from Settings and may edit it in the dialog. It is sent inside the same transaction: if the text fails, nothing
   * is declined, and the admin can retry or decline without a text. `message` is ignored for "on hold".
   *
   * @throws NotFoundException if there is no application with this id.
   * @throws ConflictException if it is already approved.
   * @throws ServiceUnavailableException if the decline text could not be sent (nothing declined).
   */
  async setStatus(
    id: string,
    status: ApplicationStatus.rejected | ApplicationStatus.on_hold,
    adminId: string,
    options: { message?: string } = {},
  ): Promise<ApplicationDetailDto> {
    const updated = await this.dataSource.transaction(async (manager) => {
      const application = await this.loadForReview(manager, id);
      application.status = status;
      application.reviewedById = adminId;
      application.reviewedAt = new Date();
      const saved = await manager.save(application);
      if (
        status === ApplicationStatus.rejected &&
        options.message !== undefined
      ) {
        await this.sendOrFail(
          application,
          await this.templates.render(
            TemplateKind.application_declined,
            this.templateValues(application),
            options.message,
          ),
          adminId,
          "The decline text",
          "nothing was declined",
        );
      }
      return saved;
    });
    return this.toDetail(updated);
  }

  /**
   * Deletes applications for good (B66: hard delete, no undo). All or nothing, in one transaction:
   * 1. loads and locks the rows (`FOR UPDATE`), so nobody can approve one of them meanwhile. Sorted by id, so two
   *    deletes of overlapping sets lock in the same order and cannot deadlock;
   * 2. refuses the whole request if any is approved: an approved application is where its driver came from;
   * 3. deletes the text history of each phone that no other application and no driver uses. A shared phone keeps
   *    its chat, because that chat also belongs to the other record;
   * 4. deletes the applications; their `application_documents` rows go with them (`ON DELETE CASCADE`).
   * After the commit, the copied files are removed from the bucket. Files go last on purpose: if the database
   * step fails nothing is touched, and a file that cannot be removed does not undo the delete; it is logged with
   * its reason and counted in `filesNotRemoved`.
   *
   * Ids that do not exist (already deleted) are ignored, so deleting twice is not an error.
   * @throws ConflictException naming the approved applications; nothing is deleted.
   */
  async deleteMany(
    ids: string[],
    adminId: string,
  ): Promise<DeleteApplicationsResultDto> {
    const { deletedIds, fileKeys } = await this.dataSource.transaction(
      async (manager) => {
        const rows = await manager.find(Application, {
          where: { id: In([...new Set(ids)]) },
          order: { id: "ASC" },
          lock: { mode: "pessimistic_write" },
        });

        const approved = rows.filter(
          (a) => a.status === ApplicationStatus.approved,
        );
        if (approved.length > 0) {
          const names = approved
            .map((a) => `${a.firstName} ${a.lastName}`)
            .join(", ");
          throw new ConflictException(
            `Approved applications cannot be deleted: ${names}. Nothing was deleted.`,
          );
        }
        if (rows.length === 0) return { deletedIds: [], fileKeys: [] };
        const rowIds = rows.map((a) => a.id);

        const documents = await manager.find(ApplicationDocument, {
          where: { applicationId: In(rowIds), storageKey: Not(IsNull()) },
          select: { id: true, storageKey: true },
        });
        const chatPhones = await this.unsharedPhones(manager, rows);
        const attachmentKeys = await this.deleteChats(manager, chatPhones);
        await manager.delete(Application, rowIds);

        return {
          deletedIds: rowIds,
          fileKeys: [...documents.map((d) => d.storageKey!), ...attachmentKeys],
        };
      },
    );

    if (deletedIds.length > 0) {
      this.logger.log(
        `Admin ${adminId} deleted ${deletedIds.length} application(s): ${deletedIds.join(", ")}`,
      );
    }
    const filesNotRemoved = await this.removeFiles(fileKeys);
    return { deleted: deletedIds.length, filesNotRemoved };
  }

  /**
   * The phones (E.164) of these applications that no other application and no driver uses: their text history
   * belongs only to the applications being deleted. A phone that is not a US number never had a chat (the chat
   * refuses it), so it is left out. Applications are compared on the last 10 digits, as the webhook does (D51).
   */
  private async unsharedPhones(
    manager: EntityManager,
    deleting: Application[],
  ): Promise<string[]> {
    const ids = deleting.map((a) => a.id);
    const phones = new Set(
      deleting
        .map((a) => toUsE164(a.phone))
        .filter((p): p is string => p !== null),
    );
    const unshared: string[] = [];
    for (const phone of phones) {
      if (await manager.exists(Driver, { where: { phone } })) continue;
      const others: unknown[] = await manager.query(
        `SELECT 1 FROM applications
         WHERE right(regexp_replace(phone, '\\D', '', 'g'), 10) = $1 AND id <> ALL($2::uuid[])
         LIMIT 1`,
        [phone.slice(2), ids],
      );
      if (others.length === 0) unshared.push(phone);
    }
    return unshared;
  }

  /**
   * Deletes every text with these phones; their attachment rows go with them (`ON DELETE CASCADE`).
   * @returns the bucket keys of the attachments that had been copied, to remove after the commit.
   */
  private async deleteChats(
    manager: EntityManager,
    phones: string[],
  ): Promise<string[]> {
    if (phones.length === 0) return [];
    const attachments: { storage_key: string }[] = await manager.query(
      `SELECT a.storage_key FROM sms_attachments a
       JOIN sms_messages m ON m.id = a.message_id
       WHERE m.contact_phone = ANY($1) AND a.storage_key IS NOT NULL`,
      [phones],
    );
    await manager.query(
      `DELETE FROM sms_messages WHERE contact_phone = ANY($1)`,
      [phones],
    );
    return attachments.map((a) => a.storage_key);
  }

  /**
   * Removes files from the bucket, one by one, so one failure does not stop the others. Each failure is logged
   * with its reason (no silent failure).
   * @returns how many could not be removed.
   */
  private async removeFiles(keys: string[]): Promise<number> {
    if (keys.length === 0) return 0;
    if (!this.storage) {
      this.logger.error(
        `No file bucket is set up (S3_BUCKET), so ${keys.length} copied file(s) of deleted applications were left in place: ${keys.join(", ")}`,
      );
      return keys.length;
    }
    let failed = 0;
    for (const key of keys) {
      try {
        await this.storage.delete(key);
      } catch (error) {
        failed++;
        this.logger.error(
          `Could not remove file ${key} of a deleted application.`,
          error instanceof Error ? error.stack : String(error),
        );
      }
    }
    return failed;
  }

  /**
   * Loads an application inside a transaction and locks its row until the transaction ends
   * (`SELECT ... FOR UPDATE`). A second review of the same application (another admin, a
   * double click) waits here, then sees the first one's result, so two approvals can never
   * both create a driver.
   *
   * Only `approved` is final, because a driver was created from it.
   */
  private async loadForReview(
    manager: EntityManager,
    id: string,
  ): Promise<Application> {
    const application = await manager.findOne(Application, {
      where: { id },
      lock: { mode: "pessimistic_write" },
    });
    if (!application) {
      throw new NotFoundException("Application not found.");
    }
    if (application.status === ApplicationStatus.approved) {
      throw new ConflictException(
        "This application is already approved and cannot be changed.",
      );
    }
    return application;
  }

  /**
   * Copies every detail field from the entity, field by field. The list fields are repeated
   * here rather than spread from `toListItem()`: its return type is a class, and spreading a
   * class instance would silently drop anything defined on its prototype (lint rule
   * `no-misused-spread`).
   */
  private toDetail(application: Application): ApplicationDetailDto {
    return {
      id: application.id,
      status: application.status,
      firstName: application.firstName,
      lastName: application.lastName,
      email: application.email,
      phone: application.phone,
      city: application.city,
      submittedAt: application.submittedAt,
      receivedAt: application.createdAt,
      requestId: application.requestId,
      zip: application.zip,
      licenseStoragePath: application.licenseStoragePath,
      ratingStoragePath: application.ratingStoragePath,
      earningsStoragePath: application.earningsStoragePath,
      payload: application.payload,
      reviewedById: application.reviewedById,
      reviewedAt: application.reviewedAt,
      driverId: application.driverId,
      alertedAt: application.alertedAt,
      alertError: application.alertError,
    };
  }

  /** Copies the list fields from the entity, field by field, so nothing else leaks out. */
  private toListItem(application: Application): ApplicationListItemDto {
    return {
      id: application.id,
      status: application.status,
      firstName: application.firstName,
      lastName: application.lastName,
      email: application.email,
      phone: application.phone,
      city: application.city,
      submittedAt: application.submittedAt,
      receivedAt: application.createdAt,
      alertError: application.alertError,
    };
  }

  /**
   * The browser's submit time. Optional and only informational (it comes from the applicant's
   * clock), so a missing or unreadable value is stored as null rather than rejecting the
   * application.
   */
  private parseDate(value: unknown): Date | null {
    if (typeof value !== "string") return null;
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? null : date;
  }
}
