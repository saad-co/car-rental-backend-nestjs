import { ApiProperty } from "@nestjs/swagger";
import { IsIn } from "class-validator";
import { COLLECTION_VIEWS, type CollectionView } from "../collections.js";
import { DayRangeQueryDto } from "./day-range-query.dto.js";

/**
 * Query string of `GET /dashboard/collections` (Dashboard page 2, D93), e.g. `?view=weekly&page=1&limit=8`. Optional `from`
 * and `to` keep only the payments of those days; a month or week at the edge of the range then holds only its days inside it.
 */
export class CollectionsQueryDto extends DayRangeQueryDto {
  /** How to group: one row per month, per Monday-to-Sunday week, or per day. */
  @ApiProperty({ enum: COLLECTION_VIEWS, enumName: "CollectionView" })
  @IsIn(COLLECTION_VIEWS)
  view: CollectionView;
}

/** One row of the collections list: the confirmed payments received in one period. */
export class CollectionPeriodDto {
  /** First Chicago day of the period (the 1st, a Monday, or the day itself), `YYYY-MM-DD`. */
  periodStart: string;
  /** Last Chicago day of the period (the end of the month, a Sunday, or the day itself). */
  periodEnd: string;
  /** Confirmed payments received in the period, in cents. 0 for a quiet period. */
  totalCents: number;
  /** How many confirmed payments that is. */
  paymentCount: number;
}

/** A page of periods, newest first, with the total of the whole filter (not just this page). */
export class CollectionPeriodsDto {
  @ApiProperty({ enum: COLLECTION_VIEWS, enumName: "CollectionView" })
  view: CollectionView;
  items: CollectionPeriodDto[];
  /** How many periods there are in all, so the page count can be worked out. */
  total: number;
  page: number;
  limit: number;
  /** Confirmed payments in the whole filter (every period, every page), in cents. */
  totalCents: number;
  /** How many confirmed payments that is. */
  paymentCount: number;
}
