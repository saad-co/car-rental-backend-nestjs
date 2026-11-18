import {
  BadGatewayException,
  ConflictException,
  NotFoundException,
  ServiceUnavailableException,
} from "@nestjs/common";
import type { DataSource } from "typeorm";
import { describe, expect, it, vi } from "vitest";
import type { LlmJsonClient, LlmJsonRequest } from "../llm/llm-client.js";
import type { FileStorage } from "../sms/storage/file-storage.js";
import { LICENCE_FULL_SCHEMA, LICENCE_SCHEMA } from "./licence-extraction.js";
import { LicenceReaderService } from "./licence-reader.service.js";

const DRIVER = "00000000-0000-4000-8000-000000000001";
/** A licence stored as a PDF, so the picture step (sharp) is not needed here. */
const PDF = Buffer.from("%PDF-1.4 made-up licence");

/**
 * The service with fakes: a driver that exists (or not), a stored licence file, and an AI that answers `answer` (or
 * throws). Returns the requests the AI received.
 */
function setUp(options: {
  answer?: unknown;
  aiFails?: boolean;
  driverExists?: boolean;
  noAi?: boolean;
}) {
  const requests: LlmJsonRequest[] = [];
  const dataSource = {
    getRepository: () => ({
      existsBy: () => Promise.resolve(options.driverExists ?? true),
    }),
    manager: {
      findOne: () => Promise.resolve({ id: "doc-1", storageKey: "lic.pdf" }),
    },
  } as unknown as DataSource;
  const storage = {
    get: vi.fn(() => Promise.resolve(PDF)),
  } as unknown as FileStorage;
  const llm: LlmJsonClient = {
    generateJson: (request) => {
      requests.push(request);
      return options.aiFails
        ? Promise.reject(new Error("quota"))
        : Promise.resolve(options.answer);
    },
  };
  const service = new LicenceReaderService(
    dataSource,
    storage,
    options.noAi ? null : llm,
  );
  return { service, requests };
}

const answer = {
  is_licence: true,
  full_name: "JANE Q DOE",
  address: "12 Main St, Springfield, IL 62701",
  license_number: "D123",
  license_state: "IL",
  license_class: "D",
  date_of_birth: "1990-04-30",
  issue_date: "2022-01-15",
  expiry_date: "2030-04-30",
  sex: "F",
  height: "5'-08\"",
  eye_color: "BRO",
  restrictions: "NONE",
  endorsements: "NONE",
  document_number: "X1",
};

describe("LicenceReaderService", () => {
  it("readFull sends the licence PDF with the full schema and returns every field", async () => {
    const { service, requests } = setUp({ answer });
    const details = await service.readFull(DRIVER);
    expect(details.fullName).toBe("JANE Q DOE");
    expect(details.expiryDate).toBe("2030-04-30");
    expect(Object.keys(details)).toHaveLength(14);
    expect(requests).toHaveLength(1);
    expect(requests[0].schema).toBe(LICENCE_FULL_SCHEMA);
    expect(requests[0].file).toEqual({
      mimeType: "application/pdf",
      data: PDF,
    });
  });

  it("read (the contract's) still sends its own schema and returns only its four fields", async () => {
    const { service, requests } = setUp({ answer });
    expect(await service.read(DRIVER)).toEqual({
      address: "12 Main St, Springfield, IL 62701",
      licenseNumber: "D123",
      licenseState: "IL",
      dateOfBirth: "1990-04-30",
    });
    expect(requests[0].schema).toBe(LICENCE_SCHEMA);
  });

  it("answers 409 when the AI finds no licence, 502 when the AI fails, 404 and 503 before calling it", async () => {
    await expect(
      setUp({ answer: { is_licence: false } }).service.readFull(DRIVER),
    ).rejects.toBeInstanceOf(ConflictException);
    await expect(
      setUp({ aiFails: true }).service.readFull(DRIVER),
    ).rejects.toBeInstanceOf(BadGatewayException);

    const missing = setUp({ answer, driverExists: false });
    await expect(missing.service.readFull(DRIVER)).rejects.toBeInstanceOf(
      NotFoundException,
    );
    expect(missing.requests).toHaveLength(0);
    await expect(
      setUp({ noAi: true }).service.readFull(DRIVER),
    ).rejects.toBeInstanceOf(ServiceUnavailableException);
  });
});
