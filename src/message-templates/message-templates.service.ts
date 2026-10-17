import {
  BadRequestException,
  Injectable,
  InternalServerErrorException,
} from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { Repository } from "typeorm";
import { MessageTemplateDto } from "./dto/message-template.dto.js";
import { MessageTemplate, TemplateKey } from "./message-template.entity.js";

/** The placeholders each template may use. Payment reminders (M6) will add `{balance}`, `{daysLate}`, `{rate}`. */
const PLACEHOLDERS: Record<TemplateKey, readonly string[]> = {
  [TemplateKey.application_approved]: ["firstName", "lastName"],
  [TemplateKey.application_declined]: ["firstName", "lastName"],
};

/** Every `{word}` in a text. */
const PLACEHOLDER_PATTERN = /\{(\w+)\}/g;

/**
 * Text templates (B73, D58): admins edit them in Settings; the system fills in the placeholders when it sends one.
 * The rows exist from the migration on, one per key; they are only ever updated, never created or deleted here.
 */
@Injectable()
export class MessageTemplatesService {
  constructor(
    @InjectRepository(MessageTemplate)
    private readonly templates: Repository<MessageTemplate>,
  ) {}

  /** Every template, in a fixed order, with who last edited it. */
  async list(): Promise<MessageTemplateDto[]> {
    const rows = await this.templates.find({ relations: { updatedBy: true } });
    const order = Object.values(TemplateKey);
    return rows
      .filter((row) => order.includes(row.key))
      .sort((a, b) => order.indexOf(a.key) - order.indexOf(b.key))
      .map((row) => this.toDto(row));
  }

  /**
   * Saves a new text for a template. Refuses placeholders the template does not know (`{firstname}`, `{name}`...):
   * a typo would otherwise be texted to the applicant word for word.
   * @throws BadRequestException naming the unknown placeholders.
   */
  async update(
    key: TemplateKey,
    body: string,
    adminId: string,
  ): Promise<MessageTemplateDto> {
    const allowed = PLACEHOLDERS[key];
    const unknown = [...body.matchAll(PLACEHOLDER_PATTERN)]
      .map((match) => match[1])
      .filter((name) => !allowed.includes(name));
    if (unknown.length > 0) {
      throw new BadRequestException(
        `Unknown placeholder${unknown.length > 1 ? "s" : ""} ${[...new Set(unknown)].map((n) => `{${n}}`).join(", ")}. ` +
          `This text can use ${allowed.map((n) => `{${n}}`).join(", ")}.`,
      );
    }
    const row = await this.load(key);
    row.body = body;
    row.updatedById = adminId;
    await this.templates.save(row);
    return this.toDto(
      await this.templates.findOneOrFail({
        where: { key },
        relations: { updatedBy: true },
      }),
    );
  }

  /**
   * The template's text with its placeholders filled in, ready to send. A placeholder without a value is left as
   * written (cannot happen for the keys above: their values are always given).
   */
  async render(
    key: TemplateKey,
    values: Record<string, string>,
  ): Promise<string> {
    const { body } = await this.load(key);
    return body.replace(PLACEHOLDER_PATTERN, (whole, name: string) =>
      Object.hasOwn(values, name) ? values[name] : whole,
    );
  }

  /**
   * @throws InternalServerErrorException if the row is missing: the migration inserts every template, so this means
   *   the database was changed by hand. Loud on purpose (no silent failure).
   */
  private async load(key: TemplateKey): Promise<MessageTemplate> {
    const row = await this.templates.findOneBy({ key });
    if (!row) {
      throw new InternalServerErrorException(
        `The "${key}" text template is missing from the database.`,
      );
    }
    return row;
  }

  private toDto(row: MessageTemplate): MessageTemplateDto {
    return {
      key: row.key,
      body: row.body,
      placeholders: [...PLACEHOLDERS[row.key]],
      updatedAt: row.updatedAt,
      updatedByEmail: row.updatedBy?.email ?? null,
    };
  }
}
