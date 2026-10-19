import {
  BadRequestException,
  ConflictException,
  InternalServerErrorException,
  NotFoundException,
} from "@nestjs/common";
import { plainToInstance } from "class-transformer";
import { validateSync } from "class-validator";
import type { DataSource } from "typeorm";
import { IS_PUBLIC_KEY } from "../src/auth/public.decorator.js";
import { ROLES_KEY } from "../src/auth/roles.decorator.js";
import {
  CreateMessageTemplateDto,
  UpdateMessageTemplateDto,
} from "../src/message-templates/dto/message-template.dto.js";
import {
  MessageTemplate,
  TemplateKind,
} from "../src/message-templates/message-template.entity.js";
import { MessageTemplatesController } from "../src/message-templates/message-templates.controller.js";
import { MessageTemplatesService } from "../src/message-templates/message-templates.service.js";
import { openTestDatabase, seedTestTemplates } from "./test-database.js";

describe("Message templates (B73, B81, test database)", () => {
  let db: DataSource;
  let templates: MessageTemplatesService;
  let adminId: string;
  const { application_approved: approved, application_declined: declined } =
    TemplateKind;

  /** The id of the seeded "Default" of a kind. */
  const defaultId = async (kind: TemplateKind) =>
    (
      (await db.query(
        `SELECT id FROM message_templates WHERE kind = $1 AND name = 'Default'`,
        [kind],
      )) as [{ id: string }]
    )[0].id;

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

  it("lists templates grouped by kind in a fixed order, oldest first, with placeholders and no editor yet", async () => {
    await templates.create(approved, "Second", "Welcome {firstName}", adminId);
    await templates.create(
      declined,
      "Licence",
      "No licence {firstName}",
      adminId,
    );
    const list = await templates.list();
    expect(list.map((t) => `${t.kind}/${t.name}`)).toEqual([
      "application_approved/Default",
      "application_approved/Second",
      "application_declined/Default",
      "application_declined/Licence",
    ]);
    expect(list[0]).toMatchObject({
      placeholders: ["firstName", "lastName"],
      updatedByEmail: null,
    });
    expect(list[1].updatedByEmail).toBe("editor@admin.test");
  });

  it("creates a template of a kind, with who made it", async () => {
    const created = await templates.create(
      declined,
      "No vehicle history",
      "Sorry {firstName}.",
      adminId,
    );
    expect(created).toMatchObject({
      kind: declined,
      name: "No vehicle history",
      body: "Sorry {firstName}.",
      updatedByEmail: "editor@admin.test",
    });
  });

  it("refuses a second template with the same name in a kind (409), but allows it in the other kind", async () => {
    await expect(
      templates.create(declined, "Default", "Another", adminId),
    ).rejects.toBeInstanceOf(ConflictException);
    await expect(
      templates.create(approved, "Default", "Another", adminId),
    ).rejects.toBeInstanceOf(ConflictException);
    await templates.create(approved, "Licence", "A", adminId);
    await expect(
      templates.create(declined, "Licence", "B", adminId),
    ).resolves.toMatchObject({ kind: declined });
    // Renaming into a taken name is refused too.
    const other = await templates.create(declined, "Other", "C", adminId);
    await expect(
      templates.update(other.id, "Default", "C", adminId),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it("saves an edit of name and text with who made it; line breaks kept", async () => {
    const id = await defaultId(declined);
    const saved = await templates.update(
      id,
      "General",
      "Sorry {firstName}.\nTry ABC Rentals 312-555-0000.",
      adminId,
    );
    expect(saved).toMatchObject({
      name: "General",
      body: "Sorry {firstName}.\nTry ABC Rentals 312-555-0000.",
      updatedByEmail: "editor@admin.test",
    });
    expect(
      await templates.render(declined, { firstName: "Pat", lastName: "Lee" }),
    ).toBe("Sorry Pat.\nTry ABC Rentals 312-555-0000.");
  });

  it("an unknown id is a 404", async () => {
    const missing = "00000000-0000-4000-8000-000000000000";
    await expect(
      templates.update(missing, "x", "y", adminId),
    ).rejects.toBeInstanceOf(NotFoundException);
    await expect(templates.remove(missing)).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it("refuses unknown placeholders, naming them and the allowed ones, and saves nothing", async () => {
    const id = await defaultId(approved);
    const error = await templates
      .update(id, "Default", "Hi {firstname} {name}, {firstName}", adminId)
      .catch((e: unknown) => e);
    expect(error).toBeInstanceOf(BadRequestException);
    expect((error as Error).message).toContain("{firstname}, {name}");
    expect((error as Error).message).toContain("{firstName}, {lastName}");
    expect((await templates.list())[0].body).toBe(
      "Approved: {firstName} {lastName}",
    );
    await expect(
      templates.create(approved, "Typo", "Hi {nmae}", adminId),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it("deletes a template, but never the last one of a kind", async () => {
    const extra = await templates.create(declined, "Extra", "Bye", adminId);
    await templates.remove(extra.id);
    expect((await templates.list()).map((t) => t.name)).not.toContain("Extra");

    await expect(
      templates.remove(await defaultId(declined)),
    ).rejects.toBeInstanceOf(ConflictException);
    // The other kind is unaffected by how many declined templates there are.
    await expect(
      templates.remove(await defaultId(approved)),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it("fills every placeholder, as often as it appears", async () => {
    await templates.update(
      await defaultId(approved),
      "Default",
      "{firstName}! {firstName} {lastName}",
      adminId,
    );
    expect(
      await templates.render(approved, { firstName: "Pat", lastName: "Lee" }),
    ).toBe("Pat! Pat Lee");
  });

  it("render sends the admin's own message when given, checked for placeholders; else the oldest template", async () => {
    await templates.create(declined, "Newer", "Newer {firstName}", adminId);
    expect(await templates.render(declined, { firstName: "Pat" })).toBe(
      "Declined: Pat",
    );
    expect(
      await templates.render(
        declined,
        { firstName: "Pat" },
        "Edited {firstName}",
      ),
    ).toBe("Edited Pat");
    await expect(
      templates.render(declined, { firstName: "Pat" }, "Hi {lastname}"),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it("a missing template fails loudly instead of sending an empty text", async () => {
    await db.query(`DELETE FROM message_templates WHERE kind = $1`, [declined]);
    await expect(
      templates.render(declined, { firstName: "Pat" }),
    ).rejects.toBeInstanceOf(InternalServerErrorException);
  });

  it("name and body are trimmed; empty or too long is refused (the ValidationPipe answers 400)", () => {
    const parse = (name: unknown, body: unknown) => {
      const dto = plainToInstance(CreateMessageTemplateDto, {
        kind: declined,
        name,
        body,
      });
      return { dto, errors: validateSync(dto) };
    };
    expect(parse("  A  ", "  Hi  ").dto).toMatchObject({
      name: "A",
      body: "Hi",
    });
    expect(parse("  A  ", "  Hi  ").errors).toHaveLength(0);
    expect(parse("A", "   ").errors).not.toHaveLength(0);
    expect(parse("   ", "Hi").errors).not.toHaveLength(0);
    expect(parse("x".repeat(61), "Hi").errors).not.toHaveLength(0);
    expect(parse("A", "x".repeat(1001)).errors).not.toHaveLength(0);
    // A kind that does not exist is refused on create.
    const bad = plainToInstance(CreateMessageTemplateDto, {
      kind: "nope",
      name: "A",
      body: "Hi",
    });
    expect(validateSync(bad)).not.toHaveLength(0);
    // Update has no kind.
    expect(
      validateSync(
        plainToInstance(UpdateMessageTemplateDto, { name: "A", body: "Hi" }),
      ),
    ).toHaveLength(0);
  });

  it("the routes are admin-only: not public, not opened to drivers", () => {
    for (const handler of [
      /* eslint-disable @typescript-eslint/unbound-method -- read as metadata, never called */
      MessageTemplatesController.prototype.list,
      MessageTemplatesController.prototype.create,
      MessageTemplatesController.prototype.update,
      MessageTemplatesController.prototype.remove,
      /* eslint-enable @typescript-eslint/unbound-method */
    ]) {
      expect(Reflect.getMetadata(IS_PUBLIC_KEY, handler)).toBeUndefined();
      expect(Reflect.getMetadata(ROLES_KEY, handler)).toBeUndefined();
    }
  });
});
