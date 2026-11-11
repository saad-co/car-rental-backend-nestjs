import { plainToInstance } from "class-transformer";
import { validate } from "class-validator";
import { describe, expect, it } from "vitest";
import { CollectionsQueryDto } from "./collections.dto.js";
import { DayRangeQueryDto } from "./day-range-query.dto.js";

/** Runs the checks the global ValidationPipe runs on a query string; returns the names of the properties that failed. */
async function failures<T extends object>(
  type: new () => T,
  query: Record<string, string>,
): Promise<string[]> {
  const errors = await validate(plainToInstance(type, query));
  return errors.map((error) => error.property);
}

describe("collections query", () => {
  it("accepts each view, with paging and a range", async () => {
    for (const view of ["monthly", "weekly", "daily"]) {
      expect(
        await failures(CollectionsQueryDto, {
          view,
          page: "2",
          limit: "8",
          from: "2026-11-01",
          to: "2026-11-09",
        }),
      ).toEqual([]);
    }
  });

  it("refuses a missing or unknown view", async () => {
    expect(await failures(CollectionsQueryDto, {})).toEqual(["view"]);
    expect(await failures(CollectionsQueryDto, { view: "yearly" })).toEqual([
      "view",
    ]);
  });

  it("refuses days that are not real calendar days or not in YYYY-MM-DD form", async () => {
    expect(
      await failures(CollectionsQueryDto, {
        view: "daily",
        from: "2026-02-30",
      }),
    ).toEqual(["from"]);
    expect(
      await failures(CollectionsQueryDto, {
        view: "daily",
        to: "2026-11-01T00:00:00Z",
      }),
    ).toEqual(["to"]);
  });

  it("an empty from or to means no limit", async () => {
    expect(
      await failures(CollectionsQueryDto, { view: "daily", from: "", to: " " }),
    ).toEqual([]);
  });

  it("limits the page size to 1-100 like every list", async () => {
    expect(await failures(DayRangeQueryDto, { limit: "101" })).toEqual([
      "limit",
    ]);
    expect(await failures(DayRangeQueryDto, { page: "0" })).toEqual(["page"]);
    expect(await failures(DayRangeQueryDto, {})).toEqual([]);
  });
});
