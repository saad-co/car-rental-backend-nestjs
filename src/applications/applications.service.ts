import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { isEmail } from "class-validator";
import { DataSource, EntityManager, Repository } from "typeorm";
import { isUniqueViolation } from "../database/postgres-errors.js";
import { Driver } from "../drivers/driver.entity.js";
import { toUsE164 } from "../drivers/us-phone.js";
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
  constructor(
    @InjectRepository(Application)
    private readonly applications: Repository<Application>,
    /** The database connection, used to run several writes as one transaction. */
    private readonly dataSource: DataSource,
  ) {}

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
      return {
        application: await this.applications.save(application),
        created: true,
      };
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
   * Approves an application: creates the Driver and marks the application approved, in one
   * transaction. Either both writes are saved or neither is, so there can never be a driver
   * without an approved application, or the other way round.
   *
   * @param adminId the admin approving it (stored as the reviewer).
   * @throws NotFoundException if there is no application with this id.
   * @throws ConflictException if it is already approved, or a driver already has this email or phone.
   * @throws BadRequestException if the phone is not a valid US number.
   */
  async approve(id: string, adminId: string): Promise<ApplicationDetailDto> {
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

        const driver = await manager.save(
          manager.create(Driver, {
            firstName: application.firstName,
            lastName: application.lastName,
            email: application.email,
            phone,
          }),
        );

        application.status = ApplicationStatus.approved;
        application.driverId = driver.id;
        application.reviewedById = adminId;
        application.reviewedAt = new Date();
        return manager.save(application);
      });
      return this.toDetail(approved);
    } catch (error) {
      if (isUniqueViolation(error)) {
        throw new ConflictException(
          "A driver with this email or phone number already exists.",
        );
      }
      throw error;
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
