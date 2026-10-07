import { BadRequestException, Injectable } from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { isEmail } from "class-validator";
import { Repository } from "typeorm";
import { isUniqueViolation } from "../database/postgres-errors.js";
import { Application } from "./application.entity.js";

/** Result of receiving a submission. `created` is false when it was a repeat of one already stored. */
export interface ReceiveResult {
  application: Application;
  created: boolean;
}

/** A submission from the website: a flat JSON object whose values are mostly strings. */
type Submission = Record<string, unknown>;

/**
 * Driver applications: intake from the website now; admin review in later steps.
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
