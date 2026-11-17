import { DriverLanguage } from "../drivers/driver.entity.js";
import { InspectionStatus, InspectionType } from "./inspection.entity.js";
import { inspectionLinkText } from "./inspection-sms.js";
import {
  effectiveStatus,
  linkWorks,
  needsAttention,
} from "./inspection-status.js";
import { hashToken, looksLikeToken, newToken } from "./inspection-token.js";

describe("inspection link tokens (D102)", () => {
  it("is 43 URL-safe characters of randomness (the spec asks for 32 or more)", () => {
    const token = newToken();
    expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(looksLikeToken(token)).toBe(true);
  });

  it("never repeats", () => {
    const tokens = new Set(Array.from({ length: 1000 }, () => newToken()));
    expect(tokens.size).toBe(1000);
  });

  it("is stored only as a 64-character SHA-256 hex hash, the same every time", () => {
    const token = "a".repeat(43);
    expect(hashToken(token)).toMatch(/^[0-9a-f]{64}$/);
    expect(hashToken(token)).toBe(hashToken(token));
    expect(hashToken(token)).not.toBe(hashToken("b".repeat(43)));
    // A known SHA-256, so the algorithm cannot change by accident.
    expect(hashToken("abc")).toBe(
      "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
    );
  });

  it("does not contain the token", () => {
    const token = newToken();
    expect(hashToken(token)).not.toContain(token);
  });

  it("turns away junk that cannot be a token", () => {
    expect(looksLikeToken("")).toBe(false);
    expect(looksLikeToken("short")).toBe(false);
    expect(looksLikeToken("a".repeat(44))).toBe(false);
    expect(looksLikeToken(`${"a".repeat(42)}!`)).toBe(false);
    expect(looksLikeToken(`${"a".repeat(42)} `)).toBe(false);
  });
});

describe("inspection status as shown (expiry is worked out, never stored)", () => {
  const now = new Date("2026-11-16T12:00:00Z");
  const before = new Date("2026-11-16T11:59:59Z");
  const after = new Date("2026-11-16T12:00:01Z");

  it("shows an open inspection as expired once its link time has passed", () => {
    for (const status of [
      InspectionStatus.linkSent,
      InspectionStatus.opened,
      InspectionStatus.inProgress,
    ]) {
      expect(effectiveStatus({ status, tokenExpiresAt: before }, now)).toBe(
        "expired",
      );
      expect(effectiveStatus({ status, tokenExpiresAt: now }, now)).toBe(
        "expired",
      );
      expect(effectiveStatus({ status, tokenExpiresAt: after }, now)).toBe(
        status,
      );
    }
  });

  it("never calls 'created' expired: no link was handed out, so there is nothing to expire", () => {
    expect(
      effectiveStatus(
        { status: InspectionStatus.created, tokenExpiresAt: before },
        now,
      ),
    ).toBe(InspectionStatus.created);
  });

  it("keeps a finished or revoked inspection as it is, whatever the clock says", () => {
    for (const status of [
      InspectionStatus.submitted,
      InspectionStatus.reviewed,
      InspectionStatus.flagged,
      InspectionStatus.revoked,
    ]) {
      expect(effectiveStatus({ status, tokenExpiresAt: before }, now)).toBe(
        status,
      );
    }
  });

  it("opens the capture page only for a handed-out link that is open and in time", () => {
    const live = { status: InspectionStatus.linkSent, tokenExpiresAt: after };
    expect(linkWorks(live, now)).toBe(true);
    expect(linkWorks({ ...live, tokenExpiresAt: before }, now)).toBe(false);
    expect(linkWorks({ ...live, status: InspectionStatus.created }, now)).toBe(
      false,
    );
    expect(linkWorks({ ...live, status: InspectionStatus.revoked }, now)).toBe(
      false,
    );
    expect(
      linkWorks({ ...live, status: InspectionStatus.submitted }, now),
    ).toBe(false);
  });
});

describe("the text that carries the link", () => {
  const base = {
    firstName: "Maria",
    vehicle: "2021 Toyota Camry",
    plate: "AB 12345",
    link: "https://app.test/i/TOKEN",
  };

  it("is the client's English check-in text with the blanks filled in", () => {
    expect(
      inspectionLinkText({
        ...base,
        type: InspectionType.checkIn,
        language: DriverLanguage.en,
      }),
    ).toBe(
      "GonzoCar: Hi Maria, before you drive the 2021 Toyota Camry (AB 12345), please complete your vehicle check-in photos here: https://app.test/i/TOKEN It takes about 5 minutes. Link expires in 24 hours.",
    );
  });

  it("is the client's English check-out text", () => {
    expect(
      inspectionLinkText({
        ...base,
        type: InspectionType.checkOut,
        language: DriverLanguage.en,
      }),
    ).toBe(
      "GonzoCar: Hi Maria, today is your return day for the 2021 Toyota Camry (AB 12345). Before you leave the car and keys, please complete your check-out photos here: https://app.test/i/TOKEN It takes about 5 minutes.",
    );
  });

  it("goes out in Spanish for a driver who reads Spanish", () => {
    const checkIn = inspectionLinkText({
      ...base,
      type: InspectionType.checkIn,
      language: DriverLanguage.es,
    });
    expect(checkIn).toContain(
      "Hola Maria, antes de manejar el 2021 Toyota Camry (AB 12345)",
    );
    expect(checkIn).toContain("https://app.test/i/TOKEN");
    const checkOut = inspectionLinkText({
      ...base,
      type: InspectionType.checkOut,
      language: DriverLanguage.es,
    });
    expect(checkOut).toContain(
      "hoy es su día de devolución del 2021 Toyota Camry (AB 12345)",
    );
  });

  it("drops the empty brackets when the vehicle has no plate", () => {
    const text = inspectionLinkText({
      ...base,
      plate: null,
      type: InspectionType.checkIn,
      language: DriverLanguage.en,
    });
    expect(text).toContain("before you drive the 2021 Toyota Camry, please");
    expect(text).not.toContain("()");
    expect(text).not.toContain("{");
  });

  it("copes with names and models that contain $ patterns", () => {
    const text = inspectionLinkText({
      ...base,
      firstName: "Pat$&",
      type: InspectionType.checkIn,
      language: DriverLanguage.en,
    });
    expect(text).toContain("Hi Pat$&,");
  });
});

describe("needs attention (flagged, or submitted and unreviewed for more than 24 hours)", () => {
  const submittedAt = new Date("2026-11-16T12:00:00Z");
  const hours = (n: number) => new Date(submittedAt.getTime() + n * 3_600_000);

  it("is false up to exactly 24 hours and true after", () => {
    const row = { status: InspectionStatus.submitted, submittedAt };
    expect(needsAttention(row, hours(23))).toBe(false);
    expect(needsAttention(row, hours(24))).toBe(false);
    expect(needsAttention(row, new Date(hours(24).getTime() + 1))).toBe(true);
  });

  it("is true for a flagged one at any time", () => {
    expect(
      needsAttention(
        { status: InspectionStatus.flagged, submittedAt },
        hours(0),
      ),
    ).toBe(true);
  });

  it("is false once reviewed, and for anything not submitted", () => {
    for (const status of [
      InspectionStatus.reviewed,
      InspectionStatus.created,
      InspectionStatus.linkSent,
      InspectionStatus.opened,
      InspectionStatus.inProgress,
      InspectionStatus.revoked,
    ]) {
      expect(needsAttention({ status, submittedAt: null }, hours(200))).toBe(
        false,
      );
    }
  });
});
