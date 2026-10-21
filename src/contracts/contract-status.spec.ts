import type { FirmaRequestState } from "../firma/firma-client.js";
import { nextContractStatus } from "./contract-status.js";
import { ContractStatus } from "./contract.entity.js";

const { draft, sent, viewed, signed, declined, expired, cancelled } =
  ContractStatus;

const firma = (
  status: FirmaRequestState["status"],
  viewedAt: Date | null = null,
): FirmaRequestState => ({
  id: "r",
  status,
  viewedAt,
  endedAt: status === "sent" ? null : new Date("2026-10-21T12:00:00Z"),
  signedPdfUrl: null,
  certificateUrl: null,
});
const SEEN = new Date("2026-10-21T11:00:00Z");

describe("nextContractStatus", () => {
  it.each([
    [sent, firma("sent"), sent],
    [sent, firma("sent", SEEN), viewed],
    [sent, firma("finished"), signed],
    [sent, firma("declined"), declined],
    [sent, firma("cancelled"), cancelled],
    [sent, firma("expired"), expired],
    [viewed, firma("sent", SEEN), viewed],
    [viewed, firma("finished"), signed],
    [viewed, firma("declined"), declined],
    [viewed, firma("cancelled"), cancelled],
    [viewed, firma("expired"), expired],
  ])(
    "moves %s forward as firma says to the right status",
    (current, state, expected) => {
      expect(nextContractStatus(current, state)).toBe(expected);
    },
  );

  it("never moves backwards: viewed stays viewed when firma shows no viewing", () => {
    expect(nextContractStatus(viewed, firma("sent"))).toBe(viewed);
  });

  it.each([signed, declined, expired, cancelled])(
    "never changes an end state (%s), whatever firma says",
    (end) => {
      for (const state of [
        firma("sent"),
        firma("sent", SEEN),
        firma("finished"),
        firma("declined"),
        firma("cancelled"),
        firma("expired"),
      ]) {
        expect(nextContractStatus(end, state)).toBe(end);
      }
    },
  );

  it("never lets a signed contract turn expired or cancelled (a late event)", () => {
    expect(nextContractStatus(signed, firma("expired"))).toBe(signed);
    expect(nextContractStatus(signed, firma("cancelled"))).toBe(signed);
  });

  it("never moves a draft (it has no firma request)", () => {
    expect(nextContractStatus(draft, firma("finished"))).toBe(draft);
  });
});
