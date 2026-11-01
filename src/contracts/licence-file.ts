import {
  BadGatewayException,
  ConflictException,
  type Logger,
  ServiceUnavailableException,
} from "@nestjs/common";
import type { EntityManager } from "typeorm";
import {
  ApplicationDocument,
  ApplicationDocumentKind,
  ApplicationDocumentStatus,
} from "../applications/documents/application-document.entity.js";
import type { FileStorage } from "../sms/storage/file-storage.js";

/**
 * The driver's licence file (D76): the driver's own (a driver added directly, D85) or the one on the application they
 * came from. Used to draw it on the contract and to read the driver details from it (B121). Only the driver's id is
 * ever logged.
 * @throws ServiceUnavailableException no file storage is set up.
 * @throws ConflictException no stored licence file.
 * @throws BadGatewayException the bucket could not give the file.
 */
export async function fetchLicenceFile(
  manager: EntityManager,
  storage: FileStorage | null,
  driverId: string,
  logger: Logger,
): Promise<{ body: Buffer; documentId: string }> {
  if (!storage) {
    throw new ServiceUnavailableException(
      "File storage is not set up (S3_*): the driver's licence is read from it.",
    );
  }
  const stored = {
    kind: ApplicationDocumentKind.license,
    status: ApplicationDocumentStatus.stored,
  };
  const document = await manager.findOne(ApplicationDocument, {
    where: [
      { ...stored, driverId },
      { ...stored, application: { driverId } },
    ],
  });
  if (!document?.storageKey) {
    throw new ConflictException(
      "The driver's licence is not on file: add it to the driver's documents first.",
    );
  }
  try {
    return {
      body: await storage.get(document.storageKey),
      documentId: document.id,
    };
  } catch (error) {
    logger.error(
      `could not read the licence file of driver ${driverId}: ${error instanceof Error ? error.message : String(error)}`,
    );
    throw new BadGatewayException(
      "The driver's licence file could not be read from storage.",
    );
  }
}
