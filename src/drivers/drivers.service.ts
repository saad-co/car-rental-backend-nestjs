import { randomUUID } from "node:crypto";
import { chicagoDate } from "../common/chicago-date.js";
import { addDateRange } from "../common/date-range.js";
import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
} from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { isEmail } from "class-validator";
import { Brackets, EntityManager, In, Repository } from "typeorm";
import { AliasType, normalizeAliasValue } from "../aliases/normalize-alias.js";
import { AliasSource, PaymentAlias } from "../aliases/payment-alias.entity.js";
import { isUniqueViolation } from "../database/postgres-errors.js";
import { likePattern, phoneDigits } from "../common/search.js";
import { Application } from "../applications/application.entity.js";
import {
  ApplicationDocument,
  ApplicationDocumentKind,
  ApplicationDocumentOrigin,
  ApplicationDocumentStatus,
} from "../applications/documents/application-document.entity.js";
import {
  DOCUMENT_LABEL,
  checkUpload,
  driverDocumentStorageKey,
} from "../applications/documents/upload-file.js";
import { Payment } from "../payments/payment.entity.js";
import type { FileStorage } from "../sms/storage/file-storage.js";
import { FILE_STORAGE } from "../sms/storage/file-storage.module.js";
import { User } from "../users/user.entity.js";
import { Driver, DriverLeftReason, DriverStatus } from "./driver.entity.js";
import { driverAge } from "./driver-profile.js";
import { AddAliasDto } from "./dto/add-alias.dto.js";
import { CreateDriverDto } from "./dto/create-driver.dto.js";
import type { UpdateDriverProfileDto } from "./dto/driver-profile.dto.js";
import { DriverDetailDto, DriverDto, DriverListDto } from "./dto/driver.dto.js";
import { ListDriversQueryDto } from "./dto/list-drivers-query.dto.js";
import { OnboardingStep } from "./dto/set-onboarding-step.dto.js";
import { toUsE164 } from "./us-phone.js";

/** The files an admin attaches while adding a driver directly (D85), by slot; both are optional. */
export type NewDriverFiles = Partial<
  Record<
    ApplicationDocumentKind.license | ApplicationDocumentKind.earnings,
    Express.Multer.File
  >
>;

/** A driver as the list shows it: a plain object type (not the class), so the detail can spread it and add the profile. */
type DriverWithExtras = Omit<DriverDetailDto, "profile">;

/** An alias that passed the checks, in the two forms it is stored in (what is shown, what matching compares). */
interface PreparedAlias {
  type: AliasType;
  value: string;
  valueNormalized: string;
}

/**
 * Drivers for the admin screens: reading them, their onboarding steps and status (D56), and deactivating /
 * reactivating them (B67). Drivers are created by starting onboarding on an approved application
 * (ApplicationsService.startOnboarding), or directly by an admin (`create`, D85).
 */
@Injectable()
export class DriversService {
  private readonly logger = new Logger(DriversService.name);

  constructor(
    @InjectRepository(Driver) private readonly drivers: Repository<Driver>,
    @InjectRepository(PaymentAlias)
    private readonly aliases: Repository<PaymentAlias>,
    @InjectRepository(Payment) private readonly payments: Repository<Payment>,
    /** Our file bucket, for the licence and earnings files of a driver added directly. Null when none is set up. */
    @Inject(FILE_STORAGE) private readonly storage: FileStorage | null,
  ) {}

  /**
   * One page of drivers, newest first, optionally only one status and only those matching a search (B75): first
   * name, last name, "first last", email (ILIKE, ignoring case), and the phone by its digits. Built like
   * `ApplicationsService.list`; see there for the details.
   */
  async list(query: ListDriversQueryDto): Promise<DriverListDto> {
    const builder = this.drivers
      .createQueryBuilder("d")
      .orderBy("d.createdAt", "DESC")
      .addOrderBy("d.id", "DESC")
      .skip((query.page - 1) * query.limit)
      .take(query.limit);
    if (query.status) {
      builder.andWhere("d.status = :status", { status: query.status });
    }
    // Archived drivers are shown only when asked for (D80); drivers still onboarding are on the Approved page.
    builder.andWhere(
      query.archived ? "d.archivedAt IS NOT NULL" : "d.archivedAt IS NULL",
    );
    if (query.onboarding === false) {
      builder.andWhere("d.status <> :onboarding", {
        onboarding: DriverStatus.onboarding,
      });
    }
    // Drivers an admin added directly have no application (D85).
    if (query.withoutApplication) {
      builder.andWhere(
        "NOT EXISTS (SELECT 1 FROM applications a WHERE a.driver_id = d.id)",
      );
    }
    // The Collections page (D81): only drivers sent to collections, the latest first, dated by the day they were sent.
    if (query.collections) {
      builder
        .andWhere("d.sentToCollectionsAt IS NOT NULL")
        .orderBy("d.sentToCollectionsAt", "DESC")
        .addOrderBy("d.id", "DESC");
    } else if (query.collections === false) {
      // The Drivers page leaves them out: they are on the Collections page (D81).
      builder.andWhere("d.sentToCollectionsAt IS NULL");
    }
    // The "Since" day: when the driver was created (B82); on the Collections page, when they were sent.
    addDateRange(
      builder,
      query.collections ? "d.sentToCollectionsAt" : "d.createdAt",
      query,
    );
    if (query.search) {
      const digits = phoneDigits(query.search);
      builder.andWhere(
        new Brackets((match) => {
          match
            .where("d.first_name ILIKE :pattern")
            .orWhere("d.last_name ILIKE :pattern")
            .orWhere("(d.first_name || ' ' || d.last_name) ILIKE :pattern")
            .orWhere("d.email ILIKE :pattern");
          if (digits) {
            match.orWhere(
              "regexp_replace(d.phone, '\\D', '', 'g') LIKE :digits",
              { digits: likePattern(digits) },
            );
          }
        }),
        { pattern: likePattern(query.search) },
      );
    }
    const [rows, total] = await builder.getManyAndCount();
    return {
      items: await this.withExtras(rows),
      total,
      page: query.page,
      limit: query.limit,
    };
  }

  /**
   * One driver.
   * @throws NotFoundException if there is no driver with this id.
   */
  async findOne(id: string): Promise<DriverDetailDto> {
    const driver = await this.drivers.findOneBy({ id });
    if (!driver) {
      throw new NotFoundException("Driver not found.");
    }
    const [dto] = await this.withExtras([driver]);
    return {
      ...dto,
      profile: {
        middleName: driver.middleName,
        street: driver.street,
        apt: driver.apt,
        city: driver.city,
        state: driver.state,
        zip: driver.zip,
        dateOfBirth: driver.dateOfBirth,
        age: driverAge(driver.dateOfBirth),
        hasInsurance: driver.hasInsurance,
      },
    };
  }

  /**
   * Adds a driver directly, without an application (D85). The driver starts in `onboarding` like any new driver and has no
   * login: nothing is texted or emailed, and no staff alert goes out. Aliases are saved with the same rules as adding one
   * on the driver page (D69), and a licence and an earnings file may come with it.
   *
   * Files are not covered by a database transaction, so the order is: check everything (phone, files, aliases, the email and
   * phone being free) → put the files in the bucket → one transaction for the driver, the file rows and the aliases → if that
   * fails, remove the files again (a failed removal is logged as an error). Sending the form twice makes one driver: the
   * second try meets the unique email and phone and is answered `409`.
   *
   * @throws BadRequestException a phone that is not a US number, a file that is not a JPG, PNG or PDF of at most 10 MB, a date
   *   of birth in the future, or an alias that does not pass the checks of D69.
   * @throws ConflictException a driver already has this email or phone, or an alias already belongs to a driver.
   * @throws ServiceUnavailableException files came but no file bucket is set up.
   */
  async create(
    dto: CreateDriverDto,
    files: NewDriverFiles,
    adminId: string,
  ): Promise<DriverDetailDto> {
    const phone = toUsE164(dto.phone);
    if (!phone) {
      throw new BadRequestException(
        `Phone "${dto.phone}" is not a valid US number.`,
      );
    }
    this.assertNotFuture(dto.dateOfBirth);
    const uploads = (
      [
        ApplicationDocumentKind.license,
        ApplicationDocumentKind.earnings,
      ] as const
    ).flatMap((kind) => {
      const file = files[kind];
      return file
        ? [{ kind, file, type: checkUpload(DOCUMENT_LABEL[kind], file) }]
        : [];
    });
    const storage = this.storage;
    if (uploads.length > 0 && !storage) {
      throw new ServiceUnavailableException(
        "File storage is not set up, so documents cannot be saved.",
      );
    }
    // The same method and handle typed twice is one alias.
    const prepared = [
      ...new Map(
        (dto.aliases ?? [])
          .map((alias) => this.prepareAlias(alias))
          .map((alias) => [`${alias.type}:${alias.valueNormalized}`, alias]),
      ).values(),
    ];
    const taken = await this.drivers.findOne({
      where: [{ email: dto.email }, { phone }],
    });
    if (taken) {
      throw new ConflictException(
        taken.email === dto.email
          ? "A driver with this email already exists."
          : "A driver with this phone number already exists.",
      );
    }

    const id = randomUUID();
    const putKeys: string[] = [];
    try {
      const stored: {
        kind: ApplicationDocumentKind;
        key: string;
        size: number;
        contentType: string;
      }[] = [];
      for (const { kind, file, type } of uploads) {
        const key = driverDocumentStorageKey(
          id,
          kind,
          randomUUID(),
          type.extension,
        );
        await storage!.put(key, file.buffer, type.contentType);
        putKeys.push(key);
        stored.push({
          kind,
          key,
          size: file.size,
          contentType: type.contentType,
        });
      }

      await this.drivers.manager.transaction(async (manager) => {
        await manager.save(
          manager.create(Driver, {
            id,
            firstName: dto.firstName,
            lastName: dto.lastName,
            email: dto.email,
            phone,
            middleName: dto.middleName ?? null,
            street: dto.street ?? null,
            apt: dto.apt ?? null,
            city: dto.city ?? null,
            state: dto.state ?? null,
            zip: dto.zip ?? null,
            dateOfBirth: dto.dateOfBirth ?? null,
            hasInsurance: dto.hasInsurance ?? null,
          }),
        );
        for (const item of stored) {
          await manager.insert(ApplicationDocument, {
            applicationId: null,
            driverId: id,
            kind: item.kind,
            origin: ApplicationDocumentOrigin.admin,
            sourcePath: null,
            status: ApplicationDocumentStatus.stored,
            storageKey: item.key,
            sizeBytes: item.size,
            contentType: item.contentType,
            uploadedById: adminId,
          });
        }
        for (const alias of prepared) {
          await this.insertAlias(manager, id, alias);
        }
      });
    } catch (error) {
      await this.removeFiles(putKeys);
      if (isUniqueViolation(error)) {
        // Someone added a driver with this email or phone between our check and the insert.
        throw new ConflictException(
          "A driver with this email or phone number already exists.",
        );
      }
      throw error;
    }
    this.logger.log(`Admin ${adminId} added driver ${id} directly.`);
    return this.findOne(id);
  }

  /**
   * Changes the profile fields of a driver (D85). A field left out stays as it is; one sent empty is cleared. Names, email
   * and phone are not changed here (they tie the driver to payments, the chat and the contract).
   * @throws NotFoundException unknown driver.
   * @throws BadRequestException a date of birth in the future.
   */
  async updateProfile(
    id: string,
    dto: UpdateDriverProfileDto,
    adminId: string,
  ): Promise<DriverDetailDto> {
    this.assertNotFuture(dto.dateOfBirth);
    await this.drivers.manager.transaction(async (manager) => {
      const driver = await this.lockDriver(manager, id);
      if (dto.middleName !== undefined) driver.middleName = dto.middleName;
      if (dto.street !== undefined) driver.street = dto.street;
      if (dto.apt !== undefined) driver.apt = dto.apt;
      if (dto.city !== undefined) driver.city = dto.city;
      if (dto.state !== undefined) driver.state = dto.state;
      if (dto.zip !== undefined) driver.zip = dto.zip;
      if (dto.dateOfBirth !== undefined) driver.dateOfBirth = dto.dateOfBirth;
      if (dto.hasInsurance !== undefined)
        driver.hasInsurance = dto.hasInsurance;
      await manager.save(driver);
    });
    // Ids only: the profile holds a date of birth and an address.
    this.logger.log(`Admin ${adminId} edited the profile of driver ${id}.`);
    return this.findOne(id);
  }

  /** A date of birth cannot be after today (Chicago day): the age worked out from it would be negative. */
  private assertNotFuture(dateOfBirth: string | null | undefined): void {
    if (dateOfBirth && dateOfBirth > chicagoDate(new Date())) {
      throw new BadRequestException("dateOfBirth cannot be in the future.");
    }
  }

  /** Removes stored objects after a failed save; a failure is logged with its reason and not thrown. */
  private async removeFiles(keys: string[]): Promise<void> {
    for (const key of keys) {
      try {
        await this.storage?.delete(key);
      } catch (error) {
        this.logger.error(
          `Could not remove ${key} after a failed save; it is left in the bucket.`,
          error instanceof Error ? error.stack : String(error),
        );
      }
    }
  }

  /**
   * Ticks (`done`) or un-ticks one onboarding step (D56), then sets the status from the steps: all three done →
   * `active` (automatic), otherwise `onboarding`. So un-ticking a step of an active driver puts them back in
   * onboarding. Ticking a step already done keeps its original date and admin.
   *
   * One transaction with the driver's row locked (`FOR UPDATE`): two admins ticking the last two steps at the same
   * moment both see the other's change, so the driver always ends up with the right status.
   *
   * The deposit step also takes the amount paid (`depositPaidCents`, D82): required the first time it is ticked, kept
   * with the step, cleared when the step is un-ticked. Sending an amount with an already-ticked deposit records or
   * corrects it (the way to fill in drivers ticked before amounts existed).
   *
   * @throws NotFoundException unknown driver.
   * @throws BadRequestException the deposit is ticked without an amount, or an amount comes with another step or an un-tick.
   * @throws ConflictException the driver is inactive (reactivate first).
   */
  async setOnboardingStep(
    id: string,
    step: OnboardingStep,
    done: boolean,
    adminId: string,
    depositPaidCents?: number,
  ): Promise<DriverDetailDto> {
    if (
      depositPaidCents !== undefined &&
      (step !== OnboardingStep.deposit || !done)
    ) {
      throw new BadRequestException(
        "An amount goes only with ticking the deposit step.",
      );
    }
    await this.drivers.manager.transaction(async (manager) => {
      const driver = await this.lockDriver(manager, id);
      if (driver.status === DriverStatus.inactive) {
        throw new ConflictException(
          "This driver is inactive. Reactivate them before changing onboarding steps.",
        );
      }
      const [at, by] = STEP_FIELDS[step];
      if (done && driver[at] === null) {
        if (step === OnboardingStep.deposit && depositPaidCents === undefined) {
          throw new BadRequestException("Enter the deposit amount paid.");
        }
        driver[at] = new Date();
        driver[by] = adminId;
        if (step === OnboardingStep.deposit) {
          driver.depositPaidCents = depositPaidCents ?? null;
        }
      } else if (done && depositPaidCents !== undefined) {
        driver.depositPaidCents = depositPaidCents;
      } else if (!done) {
        driver[at] = null;
        driver[by] = null;
        if (step === OnboardingStep.deposit) driver.depositPaidCents = null;
      }
      const wasActive = driver.status === DriverStatus.active;
      driver.status = statusFromSteps(driver);
      if (driver.status === DriverStatus.active && !wasActive) {
        startBilling(driver);
      }
      await manager.save(driver);
      this.logger.log(
        `Admin ${adminId} set onboarding step ${step}=${done} for driver ${id}; status ${driver.status}.`,
      );
    });
    return this.findOne(id);
  }

  /**
   * Ticks "Contract signed" because the driver signed their contract (Module 2 step 4, D75). Runs inside the caller's
   * transaction, so the contract becomes `signed` and the tick happens together or not at all, and locks the driver's row
   * like `setOnboardingStep` does.
   *
   * - It is the system's tick: no admin (`contractSignedById` stays null). If an admin already ticked the step by hand,
   *   it keeps its date and admin.
   * - The status follows D56 (all three steps → `active`), except for an inactive driver: they only get the date and stay
   *   inactive (reactivating works the status out from the steps).
   * - An admin may un-tick the step later; that does not touch the contract.
   *
   * @returns true when this call set the date, false when the step was already done.
   * @throws NotFoundException unknown driver.
   */
  async recordContractSigned(
    manager: EntityManager,
    driverId: string,
    signedAt: Date,
  ): Promise<boolean> {
    const driver = await this.lockDriver(manager, driverId);
    if (driver.contractSignedAt !== null) return false;
    driver.contractSignedAt = signedAt;
    driver.contractSignedById = null;
    if (driver.status !== DriverStatus.inactive) {
      const wasActive = driver.status === DriverStatus.active;
      driver.status = statusFromSteps(driver);
      if (driver.status === DriverStatus.active && !wasActive) {
        startBilling(driver);
      }
    }
    await manager.save(driver);
    this.logger.log(
      `Contract signed ticked for driver ${driverId} by the system; status ${driver.status}.`,
    );
    return true;
  }

  /**
   * Marks a driver inactive (they left, B67) and turns off their login in the same transaction: `users.active` is
   * read on every request (JwtAuthGuard), so an open session ends at the next click, and logging in is refused.
   * Steps are kept. How they left is always noted (D81): `reason` is required and is stored with the date and the admin.
   * Deactivating a driver who already left with a reason changes nothing (the first reason stands); an inactive driver
   * from before reasons existed gets the reason noted now.
   *
   * @throws NotFoundException unknown driver.
   */
  async deactivate(
    id: string,
    reason: DriverLeftReason,
    adminId: string,
  ): Promise<DriverDetailDto> {
    await this.drivers.manager.transaction(async (manager) => {
      const driver = await this.lockDriver(manager, id);
      if (
        driver.status === DriverStatus.inactive &&
        driver.leftReason !== null
      ) {
        return;
      }
      await this.leave(manager, driver, reason, adminId);
      await manager.save(driver);
      this.logger.log(
        `Admin ${adminId} deactivated driver ${id}; reason ${reason}.`,
      );
    });
    return this.findOne(id);
  }

  /**
   * Brings an inactive driver back: `active` if all three steps are still done, otherwise `onboarding`. Their login
   * works again. How they left and any collections flag are cleared (D81): they are back in the fleet. Reactivating a
   * driver who is not inactive changes nothing.
   *
   * @throws NotFoundException unknown driver.
   */
  async reactivate(id: string, adminId: string): Promise<DriverDetailDto> {
    await this.drivers.manager.transaction(async (manager) => {
      const driver = await this.lockDriver(manager, id);
      if (driver.status !== DriverStatus.inactive) return;
      const previous = `reason ${driver.leftReason ?? "not recorded"}, ${driver.sentToCollectionsAt ? "was in collections" : "not in collections"}`;
      driver.status = statusFromSteps(driver);
      if (driver.status === DriverStatus.active) startBilling(driver);
      driver.leftReason = null;
      driver.leftAt = null;
      driver.leftById = null;
      driver.sentToCollectionsAt = null;
      driver.sentToCollectionsById = null;
      await manager.save(driver);
      if (driver.userId) {
        await manager.update(User, driver.userId, { active: true });
      }
      this.logger.log(
        `Admin ${adminId} reactivated driver ${id}; status ${driver.status} (before: ${previous}).`,
      );
    });
    return this.findOne(id);
  }

  /**
   * Sends a driver to collections (D81): a flag on an inactive driver, shown on the Collections page. A driver who has
   * not been deactivated yet (or was deactivated before reasons existed) is deactivated here in the same transaction,
   * which needs `reason`: "we always have to note how they left". A driver who already has a reason keeps it. Nothing
   * checks the balance; the admin decides. Sending a driver already in collections changes nothing.
   *
   * @throws NotFoundException unknown driver.
   * @throws ConflictException the driver is still in onboarding.
   * @throws BadRequestException no reason is noted yet and none was sent.
   */
  async sendToCollections(
    id: string,
    reason: DriverLeftReason | undefined,
    adminId: string,
  ): Promise<DriverDetailDto> {
    await this.drivers.manager.transaction(async (manager) => {
      const driver = await this.lockDriver(manager, id);
      if (driver.status === DriverStatus.onboarding) {
        throw new ConflictException(
          "This driver is still in onboarding: collections are for drivers who left.",
        );
      }
      if (driver.sentToCollectionsAt !== null) return;
      if (driver.leftReason === null) {
        if (reason === undefined) {
          throw new BadRequestException("Say how the driver left.");
        }
        await this.leave(manager, driver, reason, adminId);
      }
      driver.sentToCollectionsAt = new Date();
      driver.sentToCollectionsById = adminId;
      await manager.save(driver);
      this.logger.log(`Admin ${adminId} sent driver ${id} to collections.`);
    });
    return this.findOne(id);
  }

  /**
   * Takes a driver out of collections (D81), for example once they have paid. They stay inactive with the reason they
   * left. Removing a driver who is not in collections changes nothing.
   *
   * @throws NotFoundException unknown driver.
   */
  async removeFromCollections(
    id: string,
    adminId: string,
  ): Promise<DriverDetailDto> {
    await this.drivers.manager.transaction(async (manager) => {
      const driver = await this.lockDriver(manager, id);
      if (driver.sentToCollectionsAt === null) return;
      driver.sentToCollectionsAt = null;
      driver.sentToCollectionsById = null;
      await manager.save(driver);
      this.logger.log(
        `Admin ${adminId} removed driver ${id} from collections.`,
      );
    });
    return this.findOne(id);
  }

  /**
   * Marks the (locked) driver as left, inside the caller's transaction: inactive, login off, and the reason, date and
   * admin noted unless a reason is already there. Does not save the driver; the caller does.
   */
  private async leave(
    manager: EntityManager,
    driver: Driver,
    reason: DriverLeftReason,
    adminId: string,
  ): Promise<void> {
    driver.status = DriverStatus.inactive;
    if (driver.leftReason === null) {
      driver.leftReason = reason;
      driver.leftAt = new Date();
      driver.leftById = adminId;
    }
    if (driver.userId) {
      await manager.update(User, driver.userId, { active: false });
    }
  }

  /**
   * Archives a driver (D80, D84): hidden from the normal Drivers list, no more billing and reminders (spec sections 7
   * and 8). Works on a driver in any status, with no need to deactivate first. Status, steps and login are not
   * touched, so unarchiving restores the driver exactly. Their ledger, payments and chat stay, and payments from them
   * are still matched. Archiving an archived driver changes nothing.
   *
   * The application they came from (`applications.driver_id`, D84) is archived in the same transaction. A driver with
   * no application (imported, D44) is archived alone.
   *
   * @throws NotFoundException unknown driver.
   */
  async archive(id: string, adminId: string): Promise<DriverDetailDto> {
    await this.setArchived(id, true, adminId);
    return this.findOne(id);
  }

  /** Brings an archived driver back to the lists, with the status they had. Same rules as `archive`. */
  async unarchive(id: string, adminId: string): Promise<DriverDetailDto> {
    await this.setArchived(id, false, adminId);
    return this.findOne(id);
  }

  /**
   * The shared body of `archive` and `unarchive` (D84): one transaction, the application's row (if any) and then the
   * driver's row locked. `ApplicationsService.setArchived` locks in the same order, application first, so an admin
   * pressing Archive on the Applications page and another on the Drivers page cannot wait on each other forever.
   */
  private async setArchived(
    id: string,
    archived: boolean,
    adminId: string,
  ): Promise<void> {
    await this.drivers.manager.transaction(async (manager) => {
      const application = await manager.findOne(Application, {
        where: { driverId: id },
        lock: { mode: "pessimistic_write" },
      });
      const driver = await this.lockDriver(manager, id);
      if ((driver.archivedAt !== null) === archived) return;
      const at = archived ? new Date() : null;
      driver.archivedAt = at;
      // An archived driver is not billed (D80), so billing starts again from the day they are brought back.
      if (!archived && driver.status === DriverStatus.active) {
        startBilling(driver);
      }
      await manager.save(driver);
      if (application) {
        application.archivedAt = at;
        await manager.save(application);
      }
      this.logger.log(
        `Admin ${adminId} ${archived ? "archived" : "unarchived"} driver ${id}${application ? ` and its application ${application.id}` : ""}.`,
      );
    });
  }

  /**
   * Adds a payment alias to a driver (D69): a name or handle they pay from, under one payment method, saved as
   * `manual`. It is stored as typed (for display) and in its normalised form (what matching compares: lower-case,
   * `$` / `@` dropped for Cash App and Venmo, phones as `+1XXXXXXXXXX`).
   *
   * An alias belongs to one driver (`UNIQUE (type, value_normalized)`): if another driver already has it, this is
   * refused and names that driver. Moving an alias between drivers is not done here (B54). The database decides
   * when two admins add the same alias at the same instant.
   *
   * @throws NotFoundException unknown driver.
   * @throws BadRequestException a phone that is not a US number, an email that is not an address, or nothing left
   *   after normalising (e.g. just `$`).
   * @throws ConflictException the alias exists already (on this driver, or on another one).
   */
  async addAlias(
    driverId: string,
    dto: AddAliasDto,
    adminId: string,
  ): Promise<DriverDetailDto> {
    if (!(await this.drivers.existsBy({ id: driverId }))) {
      throw new NotFoundException("Driver not found.");
    }
    const prepared = this.prepareAlias(dto);
    await this.insertAlias(this.drivers.manager, driverId, prepared);
    this.logger.log(
      `Admin ${adminId} added ${dto.type} alias "${dto.value}" to driver ${driverId}.`,
    );
    return this.findOne(driverId);
  }

  /**
   * The checks every new alias passes (D69), and its stored forms.
   * @throws BadRequestException a phone that is not a US number, an email that is not an address, or nothing left after
   *   normalising (e.g. just `$`).
   */
  private prepareAlias(dto: AddAliasDto): PreparedAlias {
    if (dto.type === AliasType.phone && !toUsE164(dto.value)) {
      throw new BadRequestException(
        "That is not a US phone number (10 digits).",
      );
    }
    if (dto.type === AliasType.email && !isEmail(dto.value)) {
      throw new BadRequestException("That is not an email address.");
    }
    const valueNormalized = normalizeAliasValue(dto.type, dto.value);
    if (valueNormalized === "") {
      throw new BadRequestException("Enter a name or handle.");
    }
    return { type: dto.type, value: dto.value, valueNormalized };
  }

  /**
   * Saves a checked alias for a driver through `manager` (so it can be part of a bigger transaction), as `manual`. An alias
   * belongs to one driver (`UNIQUE (type, value_normalized)`): if one exists already this is refused and names its owner.
   * The database decides when two requests add the same alias at the same instant.
   * @throws ConflictException the alias exists already (on this driver, or on another one).
   */
  private async insertAlias(
    manager: EntityManager,
    driverId: string,
    alias: PreparedAlias,
  ): Promise<void> {
    /** The error to answer with if this alias exists already, or null. */
    const existingAlias = async (reader: Repository<PaymentAlias>) => {
      const existing = await reader.findOne({
        where: { type: alias.type, valueNormalized: alias.valueNormalized },
        relations: { driver: true },
      });
      if (!existing) return null;
      if (existing.driverId === driverId) {
        return new ConflictException("This driver already has this alias.");
      }
      const owner =
        `${existing.driver?.firstName ?? ""} ${existing.driver?.lastName ?? ""}`.trim();
      return new ConflictException(
        `This alias already belongs to ${owner}. An alias can belong to one driver only.`,
      );
    };
    const conflict = await existingAlias(manager.getRepository(PaymentAlias));
    if (conflict) throw conflict;

    try {
      await manager.insert(PaymentAlias, {
        driverId,
        type: alias.type,
        value: alias.value,
        valueNormalized: alias.valueNormalized,
        source: AliasSource.manual,
      });
    } catch (error) {
      if (isUniqueViolation(error)) {
        // Another request added it a moment ago: report the owner like above. Read through the main connection, because
        // a failed statement leaves `manager`'s transaction (if it is one) unusable.
        throw (
          (await existingAlias(this.aliases)) ??
          new ConflictException("This alias already exists.")
        );
      }
      throw error;
    }
  }

  /**
   * Removes one alias of a driver, whatever its source (manual, imported or learned by the AI): that is how a wrong
   * alias is fixed (D69). Payments already matched through it stay as they are; later ones from that payer are
   * matched without it.
   *
   * @throws NotFoundException unknown driver, or the alias is not this driver's.
   */
  async removeAlias(
    driverId: string,
    aliasId: string,
    adminId: string,
  ): Promise<DriverDetailDto> {
    const alias = await this.aliases.findOneBy({ id: aliasId, driverId });
    if (!alias) throw new NotFoundException("Alias not found.");
    await this.aliases.delete({ id: aliasId, driverId });
    this.logger.log(
      `Admin ${adminId} removed ${alias.type} alias "${alias.value}" (${alias.source}) from driver ${driverId}.`,
    );
    return this.findOne(driverId);
  }

  /** Loads a driver inside a transaction and locks its row until the transaction ends. */
  private async lockDriver(
    manager: EntityManager,
    id: string,
  ): Promise<Driver> {
    const driver = await manager.findOne(Driver, {
      where: { id },
      lock: { mode: "pessimistic_write" },
    });
    if (!driver) throw new NotFoundException("Driver not found.");
    return driver;
  }

  /**
   * Adds each driver's aliases and payment summary using two queries for the WHOLE page (one for aliases,
   * one grouped count), never one per driver.
   */
  private async withExtras(rows: Driver[]): Promise<DriverWithExtras[]> {
    if (rows.length === 0) return [];
    const ids = rows.map((row) => row.id);
    const aliases = await this.aliases.find({
      where: { driverId: In(ids) },
      order: { type: "ASC", valueNormalized: "ASC" },
    });
    const summaries = await this.payments
      .createQueryBuilder("payment")
      .select("payment.driverId", "driverId")
      .addSelect("COUNT(*)", "count")
      .addSelect("MAX(payment.occurredAt)", "last")
      .where("payment.driverId IN (:...ids)", { ids })
      .groupBy("payment.driverId")
      .getRawMany<{ driverId: string; count: string; last: Date }>();
    const summaryByDriver = new Map(summaries.map((s) => [s.driverId, s]));
    // Ledger balances for the whole page in one grouped query (credits minus debits, D60), not one per driver.
    const balances = (await this.payments.manager.query(
      `SELECT driver_id AS "driverId",
              SUM(CASE WHEN direction = 'credit' THEN amount_cents ELSE -amount_cents END)::bigint AS "balance"
       FROM ledger_entries WHERE driver_id = ANY($1::uuid[]) GROUP BY driver_id`,
      [ids],
    )) as { driverId: string; balance: string }[];
    const balanceByDriver = new Map(
      balances.map((b) => [b.driverId, Number(b.balance)]),
    );
    // The application each driver came from (D84), for the "View application" link: one query for the page.
    const applications = await this.drivers.manager.find(Application, {
      select: { id: true, driverId: true },
      where: { driverId: In(ids) },
    });
    const applicationByDriver = new Map(
      applications.map((a) => [a.driverId, a.id]),
    );

    return rows.map((row) => {
      const summary = summaryByDriver.get(row.id);
      return {
        ...this.toDto(row),
        aliases: aliases
          .filter((alias) => alias.driverId === row.id)
          .map((alias) => ({
            id: alias.id,
            type: alias.type,
            value: alias.value,
            source: alias.source,
          })),
        paymentCount: summary ? Number(summary.count) : 0,
        lastPaymentAt: summary ? new Date(summary.last) : null,
        balanceCents: balanceByDriver.get(row.id) ?? 0,
        applicationId: applicationByDriver.get(row.id) ?? null,
      };
    });
  }

  /** Copies the driver's own fields from the entity, field by field. */
  private toDto(
    driver: Driver,
  ): Omit<
    DriverDto,
    | "aliases"
    | "paymentCount"
    | "lastPaymentAt"
    | "balanceCents"
    | "applicationId"
  > {
    return {
      id: driver.id,
      firstName: driver.firstName,
      lastName: driver.lastName,
      email: driver.email,
      phone: driver.phone,
      status: driver.status,
      onboarding: {
        contractSignedAt: driver.contractSignedAt,
        depositPaidAt: driver.depositPaidAt,
        depositPaidCents: driver.depositPaidCents,
        vehicleAssignedAt: driver.vehicleAssignedAt,
      },
      createdAt: driver.createdAt,
      archivedAt: driver.archivedAt,
      leftReason: driver.leftReason,
      leftAt: driver.leftAt,
      sentToCollectionsAt: driver.sentToCollectionsAt,
    };
  }
}

/** The driver's date and admin columns for each onboarding step. */
const STEP_FIELDS = {
  [OnboardingStep.contract]: ["contractSignedAt", "contractSignedById"],
  [OnboardingStep.deposit]: ["depositPaidAt", "depositPaidById"],
  [OnboardingStep.vehicle]: ["vehicleAssignedAt", "vehicleAssignedById"],
} as const satisfies Record<
  OnboardingStep,
  readonly [keyof Driver, keyof Driver]
>;

/**
 * Rent from the signed contract is billed from today on (Module 2 step 5, D83): called whenever a driver becomes `active`
 * (last step done, reactivated, unarchived), so the days they were not active are never billed. Chicago day, spec rule 4.
 */
export function startBilling(driver: Driver): void {
  driver.rentFrom = chicagoDate(new Date());
}

/**
 * `active` when all three steps are done, otherwise `onboarding` (D56). The database CHECK
 * `drivers_active_is_onboarded` enforces the same rule, so a mistake here fails loudly instead of saving.
 */
function statusFromSteps(driver: Driver): DriverStatus {
  return driver.contractSignedAt &&
    driver.depositPaidAt &&
    driver.vehicleAssignedAt
    ? DriverStatus.active
    : DriverStatus.onboarding;
}
