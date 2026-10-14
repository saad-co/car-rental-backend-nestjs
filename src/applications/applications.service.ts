import {
  BadRequestException,
  ConflictException,
  HttpException,
  Injectable,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
} from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { InjectRepository } from "@nestjs/typeorm";
import { isEmail } from "class-validator";
import { DataSource, EntityManager, Repository } from "typeorm";
import { isUniqueViolation } from "../database/postgres-errors.js";
import { driverWelcomeText } from "../drivers/driver-welcome.text.js";
import { Driver } from "../drivers/driver.entity.js";
import { toUsE164 } from "../drivers/us-phone.js";
import { SmsContactKind } from "../sms/sms-contact.js";
import { SmsService } from "../sms/sms.service.js";
import { PasswordService } from "../users/password.service.js";
import { Role, User } from "../users/user.entity.js";
import { ApplicationAlertService } from "./application-alert.service.js";
import { Application, ApplicationStatus } from "./application.entity.js";
import {
  ApplicationDetailDto,
  ApplicationListDto,
  ApplicationListItemDto,
} from "./dto/application.dto.js";
import { ListApplicationsQueryDto } from "./dto/list-applications-query.dto.js";

/** Result of receiving a submission. `created` is false when it was a repeat of one already stored. */
export interface ReceiveResult {
  application: Application;
  created: boolean;
}

/** A submission from the website: a flat JSON object whose values are mostly strings. */
type Submission = Record<string, unknown>;

/**
 * Driver applications: intake from the website, the admin list and detail views, and review
 * (approve, reject, on hold).
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
   * One page of applications, newest first, optionally only one status.
   *
   * `skip` / `take` become SQL `OFFSET` / `LIMIT` (Mongoose: `.skip()` / `.limit()`).
   * `findAndCount` also returns the total number of matching rows, for page numbers.
   * `id` is a second sort key so rows received in the same millisecond keep a fixed order
   * across pages.
   */
  async list(query: ListApplicationsQueryDto): Promise<ApplicationListDto> {
    const [rows, total] = await this.applications.findAndCount({
      where: query.status ? { status: query.status } : {},
      order: { createdAt: "DESC", id: "DESC" },
      skip: (query.page - 1) * query.limit,
      take: query.limit,
    });
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
   * 4. texts the driver their email and temporary password, through the same chat as every other
   *    text (D52): sent when SMS_MODE is `live`, saved as "Dry run: not sent" when `dry_run`
   *    (the admin can read it in the chat and pass it on), refused when `off`.
   *
   * The text is sent last, inside the transaction: if it fails, everything is rolled back and
   * the admin can simply try again. (The reverse, text sent but the commit failing, is very
   * unlikely; the driver would hold a password for an account that does not exist, and
   * approving again sends a new one.)
   *
   * @param adminId the admin approving it (stored as the reviewer).
   * @throws NotFoundException if there is no application with this id.
   * @throws ConflictException if it is already approved, if a driver or login already has
   *   this email, or a driver has this phone.
   * @throws BadRequestException if the phone is not a valid US number.
   * @throws ServiceUnavailableException if the login text could not be sent (nothing saved).
   */
  async approve(id: string, adminId: string): Promise<ApplicationDetailDto> {
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

        await this.sendLoginText(application, temporaryPassword, adminId);
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
   * Texts the approved driver their login details (D52). Called inside the approval transaction, through
   * `SmsService.send`, so the text follows SMS_MODE, shows in the application's chat, and a failure comes back
   * in plain words.
   * @throws ServiceUnavailableException if the text could not be sent or saved; the cause is logged.
   */
  private async sendLoginText(
    application: Application,
    temporaryPassword: string,
    adminId: string,
  ): Promise<void> {
    try {
      await this.sms.send(
        SmsContactKind.applications,
        application.id,
        driverWelcomeText({
          firstName: application.firstName,
          email: application.email,
          temporaryPassword,
          loginUrl: `${this.webAppUrl}/driver/login`,
        }),
        adminId,
      );
    } catch (error) {
      this.logger.error(
        `Login text for application ${application.id} failed; approval rolled back.`,
        error instanceof Error ? error.stack : String(error),
      );
      const reason =
        error instanceof HttpException ? error.message : "Please try again.";
      throw new ServiceUnavailableException(
        `The login text could not be sent, so nothing was approved. ${reason}`,
      );
    }
  }

  /**
   * Rejects an application or puts it on hold. No driver is created. Can be changed again
   * later, unless the application has been approved.
   *
   * @throws NotFoundException if there is no application with this id.
   * @throws ConflictException if it is already approved.
   */
  async setStatus(
    id: string,
    status: ApplicationStatus.rejected | ApplicationStatus.on_hold,
    adminId: string,
  ): Promise<ApplicationDetailDto> {
    const updated = await this.dataSource.transaction(async (manager) => {
      const application = await this.loadForReview(manager, id);
      application.status = status;
      application.reviewedById = adminId;
      application.reviewedAt = new Date();
      return manager.save(application);
    });
    return this.toDetail(updated);
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
