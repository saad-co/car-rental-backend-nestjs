import {
  BadRequestException,
  ConflictException,
  Injectable,
  InternalServerErrorException,
  NotFoundException,
} from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { Repository } from "typeorm";
import { isUniqueViolation } from "../database/postgres-errors.js";
import { MessageTemplateDto } from "./dto/message-template.dto.js";
import { MessageTemplate, TemplateKind } from "./message-template.entity.js";

/** The placeholders each kind of text may use. Payment reminders (M6) will add `{balance}`, `{daysLate}`, `{rate}`. */
const PLACEHOLDERS: Record<TemplateKind, readonly string[]> = {
  [TemplateKind.application_approved]: ["firstName", "lastName"],
  [TemplateKind.application_declined]: ["firstName", "lastName"],
};

/** Every `{word}` in a text. */
const PLACEHOLDER_PATTERN = /\{(\w+)\}/g;

/**
 * Text templates (B73, B81, D58, D62): admins keep a list of them per kind in Settings and pick one when approving or
 * declining; the system fills in the placeholders when it sends. The migrations insert one "Default" per kind; the
 * last template of a kind can never be deleted, so a text can always be sent.
 */
@Injectable()
export class MessageTemplatesService {
  constructor(
    @InjectRepository(MessageTemplate)
    private readonly templates: Repository<MessageTemplate>,
  ) {}

  /** Every template: grouped by kind in a fixed order, oldest first within a kind, with who last edited it. */
  async list(): Promise<MessageTemplateDto[]> {
    const rows = await this.templates.find({ relations: { updatedBy: true } });
    const order = Object.values(TemplateKind);
    return rows
      .filter((row) => order.includes(row.kind))
      .sort(
        (a, b) =>
          order.indexOf(a.kind) - order.indexOf(b.kind) ||
          a.createdAt.getTime() - b.createdAt.getTime() ||
          a.id.localeCompare(b.id),
      )
      .map((row) => this.toDto(row));
  }

  /**
   * Adds a template.
   * @throws BadRequestException for an unknown placeholder.
   * @throws ConflictException if the kind already has a template with this name.
   */
  async create(
    kind: TemplateKind,
    name: string,
    body: string,
    adminId: string,
  ): Promise<MessageTemplateDto> {
    this.checkPlaceholders(kind, body);
    try {
      const saved = await this.templates.save(
        this.templates.create({ kind, name, body, updatedById: adminId }),
      );
      return await this.loadDto(saved.id);
    } catch (error) {
      throw this.nameClash(error, name);
    }
  }

  /**
   * Saves a new name and text for a template. Refuses placeholders the kind does not know (`{firstname}`,
   * `{name}`...): a typo would otherwise be texted to the applicant word for word.
   * @throws NotFoundException if there is no template with this id.
   * @throws BadRequestException naming the unknown placeholders.
   * @throws ConflictException if the kind already has another template with this name.
   */
  async update(
    id: string,
    name: string,
    body: string,
    adminId: string,
  ): Promise<MessageTemplateDto> {
    const row = await this.templates.findOneBy({ id });
    if (!row) throw new NotFoundException("Template not found.");
    this.checkPlaceholders(row.kind, body);
    row.name = name;
    row.body = body;
    row.updatedById = adminId;
    try {
      await this.templates.save(row);
    } catch (error) {
      throw this.nameClash(error, name);
    }
    return this.loadDto(id);
  }

  /**
   * Deletes a template.
   * @throws NotFoundException if there is no template with this id.
   * @throws ConflictException if it is the last template of its kind.
   */
  async remove(id: string): Promise<void> {
    const row = await this.templates.findOneBy({ id });
    if (!row) throw new NotFoundException("Template not found.");
    const sameKind = await this.templates.countBy({ kind: row.kind });
    if (sameKind <= 1) {
      throw new ConflictException(
        "This is the last template of its kind. Edit it instead, so there is always a text to send.",
      );
    }
    await this.templates.delete({ id });
  }

  /**
   * The text to send: the admin's own `message` (picked from a template and maybe edited in the dialog), or, when
   * none is given, the kind's first (oldest) template. Placeholders are checked, then filled in.
   * @throws BadRequestException for an unknown placeholder in `message`.
   * @throws InternalServerErrorException if there is no message and the kind has no template (the migration inserts
   *   one, so this means the database was changed by hand; loud on purpose).
   */
  async render(
    kind: TemplateKind,
    values: Record<string, string>,
    message?: string,
  ): Promise<string> {
    let text = message;
    if (text === undefined) {
      const first = await this.templates.findOne({
        where: { kind },
        order: { createdAt: "ASC", id: "ASC" },
      });
      if (!first) {
        throw new InternalServerErrorException(
          `There is no "${kind}" text template in the database.`,
        );
      }
      text = first.body;
    }
    this.checkPlaceholders(kind, text);
    return text.replace(PLACEHOLDER_PATTERN, (whole, name: string) =>
      Object.hasOwn(values, name) ? values[name] : whole,
    );
  }

  private checkPlaceholders(kind: TemplateKind, body: string): void {
    const allowed = PLACEHOLDERS[kind];
    const unknown = [...body.matchAll(PLACEHOLDER_PATTERN)]
      .map((match) => match[1])
      .filter((name) => !allowed.includes(name));
    if (unknown.length > 0) {
      throw new BadRequestException(
        `Unknown placeholder${unknown.length > 1 ? "s" : ""} ${[...new Set(unknown)].map((n) => `{${n}}`).join(", ")}. ` +
          `This text can use ${allowed.map((n) => `{${n}}`).join(", ")}.`,
      );
    }
  }

  /** A unique violation on (kind, name) becomes a 409 in plain words; any other error is passed on. */
  private nameClash(error: unknown, name: string): unknown {
    return isUniqueViolation(error, "message_templates_kind_name")
      ? new ConflictException(`There is already a template named "${name}".`)
      : error;
  }

  private async loadDto(id: string): Promise<MessageTemplateDto> {
    return this.toDto(
      await this.templates.findOneOrFail({
        where: { id },
        relations: { updatedBy: true },
      }),
    );
  }

  private toDto(row: MessageTemplate): MessageTemplateDto {
    return {
      id: row.id,
      kind: row.kind,
      name: row.name,
      body: row.body,
      placeholders: [...PLACEHOLDERS[row.kind]],
      updatedAt: row.updatedAt,
      updatedByEmail: row.updatedBy?.email ?? null,
    };
  }
}
