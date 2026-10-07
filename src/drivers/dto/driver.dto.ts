import { DriverStatus } from "../driver.entity.js";

/** A driver as the admin screens see it. Used by both the list and the detail endpoint. */
export class DriverDto {
  id: string;
  firstName: string;
  lastName: string;
  email: string;
  /** E.164, e.g. `+13125550123`. */
  phone: string;
  status: DriverStatus;
  /** When the driver was created (the application's approval). */
  createdAt: Date;
}

/** One page of drivers, newest first. */
export class DriverListDto {
  items: DriverDto[];
  /** Number of drivers matching the filter, across all pages. */
  total: number;
  page: number;
  limit: number;
}
