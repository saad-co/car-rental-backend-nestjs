import { FirmaError } from "./firma-client.js";
import {
  firstViewedAt,
  resolveFirmaStatus,
  toFirmaRequestState,
} from "./firma-request-state.js";

const flags = (over: Record<string, boolean> = {}) => ({
  sent: true,
  finished: false,
  cancelled: false,
  declined: false,
  expired: false,
  ...over,
});

describe("resolveFirmaStatus", () => {
  it("reads `sent` when nothing else is set (sent stays true in every case)", () => {
    expect(resolveFirmaStatus(flags())).toBe("sent");
  });

  it.each([
    ["finished", "finished"],
    ["declined", "declined"],
    ["cancelled", "cancelled"],
    ["expired", "expired"],
  ])("reads %s", (flag, status) => {
    expect(resolveFirmaStatus(flags({ [flag]: true }))).toBe(status);
  });

  it("gives a signed contract priority over every other flag", () => {
    expect(
      resolveFirmaStatus(
        flags({ finished: true, cancelled: true, expired: true }),
      ),
    ).toBe("finished");
  });

  it("orders the rest declined, cancelled, expired", () => {
    expect(resolveFirmaStatus(flags({ declined: true, cancelled: true }))).toBe(
      "declined",
    );
    expect(resolveFirmaStatus(flags({ cancelled: true, expired: true }))).toBe(
      "cancelled",
    );
  });

  it("reads a missing or empty status as sent", () => {
    expect(resolveFirmaStatus(undefined)).toBe("sent");
    expect(resolveFirmaStatus(null)).toBe("sent");
    expect(resolveFirmaStatus({})).toBe("sent");
  });
});

describe("toFirmaRequestState", () => {
  const finished = {
    id: "r1",
    status: flags({ finished: true }),
    timestamps: {
      finished_on: "2026-10-21T13:29:00.076Z",
      last_changed_on: "2026-10-21T13:30:00Z",
    },
    certificate: { generated: true },
    final_document_download_url: "https://f.test/final?token=1",
    certificate_only_download_url: "https://f.test/cert?token=2",
  };

  it("maps a finished request with its time and both links", () => {
    expect(toFirmaRequestState(finished, null)).toEqual({
      id: "r1",
      status: "finished",
      viewedAt: null,
      endedAt: new Date("2026-10-21T13:29:00.076Z"),
      signedPdfUrl: "https://f.test/final?token=1",
      certificateUrl: "https://f.test/cert?token=2",
    });
  });

  it("gives no links until firma has made the certificate, even if a link is already there", () => {
    const state = toFirmaRequestState(
      { ...finished, certificate: { generated: false } },
      null,
    );
    expect(state.status).toBe("finished");
    expect(state.signedPdfUrl).toBeNull();
    expect(state.certificateUrl).toBeNull();
  });

  it("gives no links when firma's links are empty", () => {
    const state = toFirmaRequestState(
      {
        ...finished,
        final_document_download_url: null,
        certificate_only_download_url: "",
      },
      null,
    );
    expect(state.signedPdfUrl).toBeNull();
    expect(state.certificateUrl).toBeNull();
  });

  it("uses the time of each end state", () => {
    const at = (key: string, flag: string) =>
      toFirmaRequestState(
        {
          id: "r",
          status: flags({ [flag]: true }),
          timestamps: { [key]: "2026-10-22T08:00:00Z" },
        },
        null,
      ).endedAt;
    expect(at("declined_on", "declined")).toEqual(
      new Date("2026-10-22T08:00:00Z"),
    );
    expect(at("cancelled_on", "cancelled")).toEqual(
      new Date("2026-10-22T08:00:00Z"),
    );
  });

  it("uses expires_at for an expired request", () => {
    const state = toFirmaRequestState(
      {
        id: "r",
        status: flags({ expired: true }),
        expires_at: "2026-10-28T09:00:00Z",
        timestamps: {},
      },
      null,
    );
    expect(state.status).toBe("expired");
    expect(state.endedAt).toEqual(new Date("2026-10-28T09:00:00Z"));
    expect(state.signedPdfUrl).toBeNull();
  });

  it("falls back to the last change when an end state has no time of its own", () => {
    const state = toFirmaRequestState(
      {
        id: "r",
        status: flags({ expired: true }),
        timestamps: { last_changed_on: "2026-10-28T10:00:00Z" },
      },
      null,
    );
    expect(state.endedAt).toEqual(new Date("2026-10-28T10:00:00Z"));
  });

  it("refuses an end state with no time at all, and an answer without an id", () => {
    expect(() =>
      toFirmaRequestState({ id: "r", status: flags({ declined: true }) }, null),
    ).toThrow(FirmaError);
    expect(() => toFirmaRequestState({ status: flags() }, null)).toThrow(
      /no signing request id/,
    );
    expect(() => toFirmaRequestState(undefined, null)).toThrow(FirmaError);
  });

  it("carries the viewing time through for a sent request", () => {
    const viewed = new Date("2026-10-21T12:00:00Z");
    expect(
      toFirmaRequestState({ id: "r", status: flags() }, viewed),
    ).toMatchObject({ status: "sent", viewedAt: viewed, endedAt: null });
  });
});

describe("firstViewedAt", () => {
  const entry = (source: string, event: string, timestamp: string) => ({
    source,
    event,
    timestamp,
  });

  it("takes the earliest document_viewed by the signer", () => {
    expect(
      firstViewedAt({
        results: [
          entry("admin", "activity", "2026-10-21T12:00:00Z"),
          entry("signer", "document_viewed", "2026-10-21T12:10:00Z"),
          entry("signer", "document_viewed", "2026-10-21T12:05:00Z"),
          entry("signer", "document_opened", "2026-10-21T11:00:00Z"),
        ],
      }),
    ).toEqual(new Date("2026-10-21T12:05:00Z"));
  });

  it("ignores a viewing logged by anyone but the signer", () => {
    expect(
      firstViewedAt({
        results: [entry("admin", "document_viewed", "2026-10-21T12:00:00Z")],
      }),
    ).toBeNull();
  });

  it.each([
    [undefined],
    [null],
    [{}],
    [{ results: "x" }],
    [{ results: [] }],
    [{ results: [null, 3] }],
  ])("is null for an audit trail without a viewing (%j)", (json) => {
    expect(firstViewedAt(json)).toBeNull();
  });
});
