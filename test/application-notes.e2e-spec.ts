import { ForbiddenException, NotFoundException } from "@nestjs/common";
import { plainToInstance } from "class-transformer";
import { validateSync } from "class-validator";
import type { DataSource } from "typeorm";
import { Application } from "../src/applications/application.entity.js";
import { ApplicationNote } from "../src/applications/notes/application-note.entity.js";
import { ApplicationNotesController } from "../src/applications/notes/application-notes.controller.js";
import { ApplicationNotesService } from "../src/applications/notes/application-notes.service.js";
import { CreateApplicationNoteDto } from "../src/applications/notes/dto/application-note.dto.js";
import { IS_PUBLIC_KEY } from "../src/auth/public.decorator.js";
import { ROLES_KEY } from "../src/auth/roles.decorator.js";
import { openTestDatabase } from "./test-database.js";

const UNKNOWN_ID = "00000000-0000-0000-0000-000000000000";

describe("Internal notes on applications (B74, test database)", () => {
  let db: DataSource;
  let notes: ApplicationNotesService;
  let applicationId: string;
  let alice: string;
  let bob: string;

  const page = { page: 1, limit: 20 };

  beforeAll(async () => {
    db = await openTestDatabase();
    notes = new ApplicationNotesService(
      db.getRepository(Application),
      db.getRepository(ApplicationNote),
    );
  });

  beforeEach(async () => {
    await db.query("TRUNCATE application_notes, applications, users CASCADE");
    const admins = (await db.query(
      `INSERT INTO users (email, password_hash, role) VALUES
         ('alice@admin.test', 'x', 'admin'), ('bob@admin.test', 'x', 'admin')
       RETURNING id`,
    )) as { id: string }[];
    [alice, bob] = admins.map((a) => a.id);
    [{ id: applicationId }] = (await db.query(
      `INSERT INTO applications (request_id, first_name, last_name, email, phone, payload)
       VALUES ('r1', 'Pat', 'Applicant', 'pat@test.dev', '3125550101', '{}') RETURNING id`,
    )) as [{ id: string }];
  });

  afterAll(async () => {
    await db.destroy();
  });

  it("adds notes and lists them newest first, with the author's email and line breaks kept", async () => {
    await notes.add(applicationId, "Insufficient earnings", alice);
    await new Promise((resolve) => setTimeout(resolve, 5));
    const second = await notes.add(
      applicationId,
      "Too far from the service area.\nLives in Gary, IN.",
      bob,
    );

    expect(second).toMatchObject({
      authorId: bob,
      authorEmail: "bob@admin.test",
      body: "Too far from the service area.\nLives in Gary, IN.",
    });
    const list = await notes.list(applicationId, page);
    expect(list.total).toBe(2);
    expect(list.items.map((n) => n.authorEmail)).toEqual([
      "bob@admin.test",
      "alice@admin.test",
    ]);
  });

  it("pages the notes", async () => {
    for (let i = 0; i < 3; i++) await notes.add(applicationId, `n${i}`, alice);
    const second = await notes.list(applicationId, { page: 2, limit: 2 });
    expect(second).toMatchObject({ total: 3, page: 2, limit: 2 });
    expect(second.items).toHaveLength(1);
  });

  it("the author deletes their own note; another admin is refused (403)", async () => {
    const note = await notes.add(applicationId, "Poor driving history", alice);

    await expect(
      notes.remove(applicationId, note.id, bob),
    ).rejects.toBeInstanceOf(ForbiddenException);
    await notes.remove(applicationId, note.id, alice);
    expect((await notes.list(applicationId, page)).total).toBe(0);
  });

  it("404 for an unknown application, and for a note id under the wrong application", async () => {
    const note = await notes.add(applicationId, "x", alice);
    await expect(notes.list(UNKNOWN_ID, page)).rejects.toBeInstanceOf(
      NotFoundException,
    );
    await expect(notes.add(UNKNOWN_ID, "x", alice)).rejects.toBeInstanceOf(
      NotFoundException,
    );
    await expect(
      notes.remove(UNKNOWN_ID, note.id, alice),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it("a note whose author account was removed stays, with no author", async () => {
    await notes.add(applicationId, "kept", alice);
    await db.query(`DELETE FROM users WHERE id = $1`, [alice]);
    const [item] = (await notes.list(applicationId, page)).items;
    expect(item).toMatchObject({
      body: "kept",
      authorId: null,
      authorEmail: null,
    });
  });

  it("deleting the application deletes its notes (cascade, B66)", async () => {
    await notes.add(applicationId, "x", alice);
    await db.query(`DELETE FROM applications WHERE id = $1`, [applicationId]);
    expect(
      Number(
        (
          (await db.query("SELECT count(*) AS n FROM application_notes")) as [
            { n: string },
          ]
        )[0].n,
      ),
    ).toBe(0);
  });

  it("the body is trimmed, and empty or over 2000 characters is refused (the ValidationPipe answers 400)", () => {
    const parse = (body: unknown) => {
      const dto = plainToInstance(CreateApplicationNoteDto, { body });
      return { dto, errors: validateSync(dto) };
    };
    expect(parse("  note  ").dto.body).toBe("note");
    expect(parse("  note  ").errors).toHaveLength(0);
    expect(parse("   ").errors).not.toHaveLength(0);
    expect(parse("x".repeat(2001)).errors).not.toHaveLength(0);
    expect(parse(42).errors).not.toHaveLength(0);
  });

  it("the routes are admin-only: not public, not opened to drivers", () => {
    for (const handler of [
      /* eslint-disable @typescript-eslint/unbound-method -- read as metadata, never called */
      ApplicationNotesController.prototype.list,
      ApplicationNotesController.prototype.add,
      ApplicationNotesController.prototype.remove,
      /* eslint-enable @typescript-eslint/unbound-method */
    ]) {
      expect(Reflect.getMetadata(IS_PUBLIC_KEY, handler)).toBeUndefined();
      expect(Reflect.getMetadata(ROLES_KEY, handler)).toBeUndefined();
    }
    expect(
      Reflect.getMetadata(IS_PUBLIC_KEY, ApplicationNotesController),
    ).toBeUndefined();
  });
});
