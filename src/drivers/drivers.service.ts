import { Injectable, NotFoundException } from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { In, Repository } from "typeorm";
import { PaymentAlias } from "../aliases/payment-alias.entity.js";
import { Payment } from "../payments/payment.entity.js";
import { Driver } from "./driver.entity.js";
import { DriverDto, DriverListDto } from "./dto/driver.dto.js";
import { ListDriversQueryDto } from "./dto/list-drivers-query.dto.js";

/**
 * Reads drivers for the admin screens. Drivers are created by approving an application
 * (ApplicationsService.approve), not here.
 */
@Injectable()
export class DriversService {
  constructor(
    @InjectRepository(Driver) private readonly drivers: Repository<Driver>,
    @InjectRepository(PaymentAlias)
    private readonly aliases: Repository<PaymentAlias>,
    @InjectRepository(Payment) private readonly payments: Repository<Payment>,
  ) {}

  /** One page of drivers, newest first, optionally only one status. */
  async list(query: ListDriversQueryDto): Promise<DriverListDto> {
    const [rows, total] = await this.drivers.findAndCount({
      where: query.status ? { status: query.status } : {},
      order: { createdAt: "DESC", id: "DESC" },
      skip: (query.page - 1) * query.limit,
      take: query.limit,
    });
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
      };
    });
  }

  /** Copies the driver's own fields from the entity, field by field. */
  private toDto(
    driver: Driver,
  ): Omit<DriverDto, "aliases" | "paymentCount" | "lastPaymentAt"> {
    return {
      id: driver.id,
      firstName: driver.firstName,
      lastName: driver.lastName,
      email: driver.email,
      phone: driver.phone,
      status: driver.status,
      createdAt: driver.createdAt,
    };
  }
}
