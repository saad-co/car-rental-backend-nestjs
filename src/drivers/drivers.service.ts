import { Injectable, NotFoundException } from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { Repository } from "typeorm";
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
      items: rows.map((row) => this.toDto(row)),
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
    return this.toDto(driver);
  }

  /** Copies the response fields from the entity, field by field. */
  private toDto(driver: Driver): DriverDto {
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
