import { Controller, Get, Param, ParseUUIDPipe, Query } from "@nestjs/common";
import { DriversService } from "./drivers.service.js";
import { DriverDto, DriverListDto } from "./dto/driver.dto.js";
import { ListDriversQueryDto } from "./dto/list-drivers-query.dto.js";

/** Admin driver routes under `/drivers`. All need a logged-in admin (global JwtAuthGuard). */
@Controller("drivers")
export class DriversController {
  constructor(private readonly drivers: DriversService) {}

  /** `GET /drivers`: one page of drivers, newest first. */
  @Get()
  list(@Query() query: ListDriversQueryDto): Promise<DriverListDto> {
    return this.drivers.list(query);
  }

  /** `GET /drivers/:id`: one driver. `400` for a malformed id, `404` if unknown. */
  @Get(":id")
  findOne(@Param("id", ParseUUIDPipe) id: string): Promise<DriverDto> {
    return this.drivers.findOne(id);
  }
}
