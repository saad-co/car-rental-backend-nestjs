import { ApplicationDocumentOrigin } from "../applications/documents/application-document.entity.js";
import { decideFiling, type SlotState } from "./contract-filing.js";

const OLD = new Date("2026-10-01T12:00:00Z");
const NEW = new Date("2026-11-01T12:00:00Z");

const firmaCopy = (
  contractId: string | null,
  signedAt: Date | null,
): SlotState => ({
  origin: ApplicationDocumentOrigin.firma,
  contractId,
  contractSignedAt: signedAt,
});

describe("decideFiling (D90 step 2)", () => {
  it("files into an empty slot", () => {
    expect(decideFiling(null, { id: "c1", signedAt: NEW })).toBe("file");
  });

  it("leaves the slot alone when it already holds this contract's copy", () => {
    expect(
      decideFiling(firmaCopy("c1", NEW), { id: "c1", signedAt: NEW }),
    ).toBe("already");
  });

  it("never overwrites a file an admin uploaded, however new the contract is", () => {
    const admin: SlotState = {
      origin: ApplicationDocumentOrigin.admin,
      contractId: null,
      contractSignedAt: null,
    };
    expect(decideFiling(admin, { id: "c1", signedAt: NEW })).toBe(
      "kept-upload",
    );
  });

  it("replaces an older firma copy with a newer signing", () => {
    expect(
      decideFiling(firmaCopy("c0", OLD), { id: "c1", signedAt: NEW }),
    ).toBe("file");
  });

  it("keeps a newer firma copy against an older signing, and against one signed at the same moment", () => {
    expect(
      decideFiling(firmaCopy("c1", NEW), { id: "c0", signedAt: OLD }),
    ).toBe("kept-newer");
    expect(
      decideFiling(firmaCopy("c1", NEW), { id: "c2", signedAt: NEW }),
    ).toBe("kept-newer");
  });

  it("replaces a firma copy whose contract is no longer known", () => {
    expect(
      decideFiling(firmaCopy(null, null), { id: "c1", signedAt: OLD }),
    ).toBe("file");
  });
});
