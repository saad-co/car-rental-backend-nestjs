import {
  Controller,
  Get,
  Inject,
  NotFoundException,
  Param,
  ParseUUIDPipe,
} from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { Repository } from "typeorm";
import { FILE_LINK_SECONDS } from "../../sms/storage/file-storage.js";
import { Application } from "../application.entity.js";
import {
  DOCUMENT_COPIER_DEPS,
  type DocumentCopierDeps,
} from "./application-document-copier.js";
import {
  ApplicationDocument,
  ApplicationDocumentKind,
  ApplicationDocumentStatus,
} from "./application-document.entity.js";
import {
  ApplicationDocumentDto,
  ApplicationDocumentListDto,
} from "./dto/application-document.dto.js";

/** The order the documents are shown in. */
const KIND_ORDER = [
  ApplicationDocumentKind.license,
  ApplicationDocumentKind.rating,
  ApplicationDocumentKind.earnings,
];

/**
 * `GET /applications/:id/documents`: the files the applicant uploaded on the website form, as our own copies
 * (D54). Admin only (the global guard). Files open through short-lived signed links; the bucket itself is private.
 */
@Controller("applications")
export class ApplicationDocumentsController {
  constructor(
    @InjectRepository(Application)
    private readonly applications: Repository<Application>,
    @InjectRepository(ApplicationDocument)
    private readonly documents: Repository<ApplicationDocument>,
    @Inject(DOCUMENT_COPIER_DEPS) private readonly deps: DocumentCopierDeps,
  ) {}

  @Get(":id/documents")
  async list(
    @Param("id", ParseUUIDPipe) id: string,
  ): Promise<ApplicationDocumentListDto> {
    if (!(await this.applications.existsBy({ id })))
      throw new NotFoundException("Application not found.");

    const rows = await this.documents.find({ where: { applicationId: id } });
    rows.sort(
      (a, b) => KIND_ORDER.indexOf(a.kind) - KIND_ORDER.indexOf(b.kind),
    );

    const { storage } = this.deps;
    const items = await Promise.all(
      rows.map(async (row): Promise<ApplicationDocumentDto> => {
        const canOpen =
          row.status === ApplicationDocumentStatus.stored &&
          row.storageKey !== null &&
          storage !== null;
        return {
          id: row.id,
          kind: row.kind,
          status: row.status,
          contentType: row.contentType,
          sizeBytes: row.sizeBytes,
          url: canOpen
            ? await storage.presignGet(row.storageKey!, FILE_LINK_SECONDS)
            : null,
          error: row.lastError,
        };
      }),
    );
    return {
      items,
      sourceConnected: this.deps.source !== null,
      storageConnected: storage !== null,
    };
  }
}
