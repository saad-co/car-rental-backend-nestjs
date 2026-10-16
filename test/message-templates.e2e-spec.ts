import {
  BadRequestException,
  InternalServerErrorException,
} from "@nestjs/common";
import { plainToInstance } from "class-transformer";
import { validateSync } from "class-validator";
import type { DataSource } from "typeorm";
import { IS_PUBLIC_KEY } from "../src/auth/public.decorator.js";
import { ROLES_KEY } from "../src/auth/roles.decorator.js";
import { UpdateMessageTemplateDto } from "../src/message-templates/dto/message-template.dto.js";
import {
  MessageTemplate,
  TemplateKey,
} from "../src/message-templates/message-template.entity.js";
import { MessageTemplatesController } from "../src/message-templates/message-templates.controller.js";
import { MessageTemplatesService } from "../src/message-templates/message-templates.service.js";
import { openTestDatabase, seedTestTemplates } from "./test-database.js";

describe("Message templates (B73, test database)", () => {
  let db: DataSource;
  let templates: MessageTemplatesService;
  let adminId: string;
  const { application_approved: approved, application_declined: declined } =
    TemplateKey;

  beforeAll(async () => {
    db = await openTestDatabase();
    templates = new MessageTemplatesService(db.getRepository(MessageTemplate));
  });

  beforeEach(async () => {
    await db.query("TRUNCATE users CASCADE");
    await seedTestTemplates(db);
    [{ id: adminId }] = (await db.query(
      `INSERT INTO users (email, password_hash, role) VALUES ('editor@admin.test', 'x', 'admin') RETURNING id`,
    )) as [{ id: string }];
  });

  afterAll(async () => {
    await db.destroy();
  });

  it("lists both templates in a fixed order, with their placeholders and no editor yet", async () => {
    const list = await templates.list();
    expect(list.map((t) => t.key)).toEqual([approved, declined]);
    expect(list[0]).toMatchObject({
      placeholders: ["firstName", "lastName"],
      updatedByEmail: null,
    });
  });

  it("saves an edit with who made it; line breaks kept", async () => {
    const saved = await templates.update(
      declined,
      "Sorry {firstName}.\nTry ABC Rentals 312-555-0000.",
      adminId,
    );
    expect(saved).toMatchObject({
      body: "Sorry {firstName}.\nTry ABC Rentals 312-555-0000.",
      updatedByEmail: "editor@admin.test",
    });
    expect(
      await templates.render(declined, { firstName: "Pat", lastName: "Lee" }),
    ).toBe("Sorry Pat.\nTry ABC Rentals 312-555-0000.");
  });

  it("refuses unknown placeholders, naming them and the allowed ones", async () => {
    const error = await templates
      .update(approved, "Hi {firstname} {name}, {firstName}", adminId)
      .catch((e: unknown) => e);
    expect(error).toBeInstanceOf(BadRequestException);
    expect((error as Error).message).toContain("{firstname}, {name}");
    expect((error as Error).message).toContain("{firstName}, {lastName}");
    // Nothing was saved.
    expect((await templates.list())[0].body).toBe(
      "Approved: {firstName} {lastName}",
    );
  });

  it("fills every placeholder, as often as it appears", async () => {
    await templates.update(
      approved,
      "{firstName}! {firstName} {lastName}",
      adminId,
    );
    expect(
      await templates.render(approved, { firstName: "Pat", lastName: "Lee" }),
    ).toBe("Pat! Pat Lee");
  });

  it("a missing template fails loudly instead of sending an empty text", async () => {
    await db.query(`DELETE FROM message_templates WHERE key = $1`, [declined]);
    await expect(
      templates.render(declined, { firstName: "Pat" }),
    ).rejects.toBeInstanceOf(InternalServerErrorException);
  });

  it("the body is trimmed; empty or over 1000 characters is refused (the ValidationPipe answers 400)", () => {
    const parse = (body: unknown) => {
      const dto = plainToInstance(UpdateMessageTemplateDto, { body });
      return { dto, errors: validateSync(dto) };
    };
    expect(parse("  Hi  ").dto.body).toBe("Hi");
    expect(parse("  Hi  ").errors).toHaveLength(0);
    expect(parse("   ").errors).not.toHaveLength(0);
    expect(parse("x".repeat(1001)).errors).not.toHaveLength(0);
  });

  it("the routes are admin-only: not public, not opened to drivers", () => {
    for (const handler of [
      /* eslint-disable @typescript-eslint/unbound-method -- read as metadata, never called */
      MessageTemplatesController.prototype.list,
      MessageTemplatesController.prototype.update,
      /* eslint-enable @typescript-eslint/unbound-method */
    ]) {
      expect(Reflect.getMetadata(IS_PUBLIC_KEY, handler)).toBeUndefined();
      expect(Reflect.getMetadata(ROLES_KEY, handler)).toBeUndefined();
    }
  });
});
