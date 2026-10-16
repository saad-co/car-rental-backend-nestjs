import {
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { Brackets, EntityManager, In, Repository } from "typeorm";
import { PaymentAlias } from "../aliases/payment-alias.entity.js";
import { likePattern, phoneDigits } from "../common/search.js";
import { Payment } from "../payments/payment.entity.js";
import { User } from "../users/user.entity.js";
import { Driver, DriverStatus } from "./driver.entity.js";
import { DriverDto, DriverListDto } from "./dto/driver.dto.js";
import { ListDriversQueryDto } from "./dto/list-drivers-query.dto.js";
import { OnboardingStep } from "./dto/set-onboarding-step.dto.js";

/**
 * Drivers for the admin screens: reading them, their onboarding steps and status (D56), and deactivating /
 * reactivating them (B67). Drivers are created by approving an application (ApplicationsService.approve), not here.
 */
@Injectable()
export class DriversService {
  private readonly logger = new Logger(DriversService.name);

  constructor(
    @InjectRepository(Driver) private readonly drivers: Repository<Driver>,
    @InjectRepository(PaymentAlias)
    private readonly aliases: Repository<PaymentAlias>,
    @InjectRepository(Payment) private readonly payments: Repository<Payment>,
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
  async findOne(id: string): Promise<DriverDto> {
    const driver = await this.drivers.findOneBy({ id });
    if (!driver) {
      throw new NotFoundException("Driver not found.");
    }
    const [dto] = await this.withExtras([driver]);
    return dto;
  }

  /**
   * Ticks (`done`) or un-ticks one onboarding step (D56), then sets the status from the steps: all three done →
   * `active` (automatic), otherwise `onboarding`. So un-ticking a step of an active driver puts them back in
   * onboarding. Ticking a step already done keeps its original date and admin.
   *
   * One transaction with the driver's row locked (`FOR UPDATE`): two admins ticking the last two steps at the same
   * moment both see the other's change, so the driver always ends up with the right status.
   *
   * @throws NotFoundException unknown driver.
   * @throws ConflictException the driver is inactive (reactivate first).
   */
  async setOnboardingStep(
    id: string,
    step: OnboardingStep,
    done: boolean,
    adminId: string,
  ): Promise<DriverDto> {
    await this.drivers.manager.transaction(async (manager) => {
      const driver = await this.lockDriver(manager, id);
      if (driver.status === DriverStatus.inactive) {
        throw new ConflictException(
          "This driver is inactive. Reactivate them before changing onboarding steps.",
        );
      }
      const [at, by] = STEP_FIELDS[step];
      if (done && driver[at] === null) {
        driver[at] = new Date();
        driver[by] = adminId;
      } else if (!done) {
        driver[at] = null;
        driver[by] = null;
      }
      driver.status = statusFromSteps(driver);
      await manager.save(driver);
      this.logger.log(
        `Admin ${adminId} set onboarding step ${step}=${done} for driver ${id}; status ${driver.status}.`,
      );
    });
    return this.findOne(id);
  }

  /**
   * Marks a driver inactive (they left, B67) and turns off their login in the same transaction: `users.active` is
   * read on every request (JwtAuthGuard), so an open session ends at the next click, and logging in is refused.
   * Steps are kept. Deactivating an inactive driver changes nothing.
   *
   * @throws NotFoundException unknown driver.
   */
  async deactivate(id: string, adminId: string): Promise<DriverDto> {
    await this.drivers.manager.transaction(async (manager) => {
      const driver = await this.lockDriver(manager, id);
      if (driver.status === DriverStatus.inactive) return;
      driver.status = DriverStatus.inactive;
      await manager.save(driver);
      if (driver.userId) {
        await manager.update(User, driver.userId, { active: false });
      }
      this.logger.log(`Admin ${adminId} deactivated driver ${id}.`);
    });
    return this.findOne(id);
  }

  /**
   * Brings an inactive driver back: `active` if all three steps are still done, otherwise `onboarding`. Their login
   * works again. Reactivating a driver who is not inactive changes nothing.
   *
   * @throws NotFoundException unknown driver.
   */
  async reactivate(id: string, adminId: string): Promise<DriverDto> {
    await this.drivers.manager.transaction(async (manager) => {
      const driver = await this.lockDriver(manager, id);
      if (driver.status !== DriverStatus.inactive) return;
      driver.status = statusFromSteps(driver);
      await manager.save(driver);
      if (driver.userId) {
        await manager.update(User, driver.userId, { active: true });
      }
      this.logger.log(
        `Admin ${adminId} reactivated driver ${id}; status ${driver.status}.`,
      );
    });
    return this.findOne(id);
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
  private async withExtras(rows: Driver[]): Promise<DriverDto[]> {
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
    // Ledger balances for the whole page in one grouped query (credits minus debits, D58), not one per driver.
    const balances = (await this.payments.manager.query(
      `SELECT driver_id AS "driverId",
              SUM(CASE WHEN direction = 'credit' THEN amount_cents ELSE -amount_cents END)::bigint AS "balance"
       FROM ledger_entries WHERE driver_id = ANY($1::uuid[]) GROUP BY driver_id`,
      [ids],
    )) as { driverId: string; balance: string }[];
    const balanceByDriver = new Map(
      balances.map((b) => [b.driverId, Number(b.balance)]),
    );

    return rows.map((row) => {
      const summary = summaryByDriver.get(row.id);
      return {
        ...this.toDto(row),
        aliases: aliases
          .filter((alias) => alias.driverId === row.id)
          .map((alias) => ({
            type: alias.type,
            value: alias.value,
            source: alias.source,
          })),
        paymentCount: summary ? Number(summary.count) : 0,
        lastPaymentAt: summary ? new Date(summary.last) : null,
        balanceCents: balanceByDriver.get(row.id) ?? 0,
      };
    });
  }

  /** Copies the driver's own fields from the entity, field by field. */
  private toDto(
    driver: Driver,
  ): Omit<
    DriverDto,
    "aliases" | "paymentCount" | "lastPaymentAt" | "balanceCents"
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
        vehicleAssignedAt: driver.vehicleAssignedAt,
      },
      createdAt: driver.createdAt,
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
