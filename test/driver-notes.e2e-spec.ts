import { ForbiddenException, NotFoundException } from "@nestjs/common";
import { plainToInstance } from "class-transformer";
import { validateSync } from "class-validator";
import type { DataSource } from "typeorm";
import { IS_PUBLIC_KEY } from "../src/auth/public.decorator.js";
import { ROLES_KEY } from "../src/auth/roles.decorator.js";
import { Driver } from "../src/drivers/driver.entity.js";
import { CreateDriverNoteDto } from "../src/drivers/notes/dto/driver-note.dto.js";
import { DriverNote } from "../src/drivers/notes/driver-note.entity.js";
import { DriverNotesController } from "../src/drivers/notes/driver-notes.controller.js";
import { DriverNotesService } from "../src/drivers/notes/driver-notes.service.js";
import { openTestDatabase } from "./test-database.js";

const UNKNOWN_ID = "00000000-0000-0000-0000-000000000000";

describe("Internal notes on a driver's account (Fleet revisions section 5, test database)", () => {
  let db: DataSource;
  let notes: DriverNotesService;
  let driverId: string;
  let alice: string;
  let bob: string;

  const page = { page: 1, limit: 20 };

  beforeAll(async () => {
    db = await openTestDatabase();
    notes = new DriverNotesService(
      db.getRepository(Driver),
      db.getRepository(DriverNote),
    );
  });

  beforeEach(async () => {
    await db.query("TRUNCATE driver_notes, drivers, users CASCADE");
    const admins = (await db.query(
      `INSERT INTO users (email, password_hash, role) VALUES
         ('alice@admin.test', 'x', 'admin'), ('bob@admin.test', 'x', 'admin')
       RETURNING id`,
    )) as { id: string }[];
    [alice, bob] = admins.map((a) => a.id);
    [{ id: driverId }] = (await db.query(
      `INSERT INTO drivers (first_name, last_name, email, phone)
       VALUES ('Pat', 'Driver', 'pat@test.dev', '+13125550101') RETURNING id`,
    )) as [{ id: string }];
  });

  afterAll(async () => {
    await db.destroy();
  });

  it("adds notes and lists them newest first, with who wrote them and when, line breaks kept", async () => {
    await notes.add(driverId, "Promised to pay Friday", alice);
    await new Promise((resolve) => setTimeout(resolve, 5));
    const second = await notes.add(driverId, "Called twice.\nNo answer.", bob);

    expect(second).toMatchObject({
      authorId: bob,
      authorEmail: "bob@admin.test",
      body: "Called twice.\nNo answer.",
    });
    expect(second.createdAt).toBeInstanceOf(Date);
    const list = await notes.list(driverId, page);
    expect(list.total).toBe(2);
    expect(list.items.map((n) => n.authorEmail)).toEqual([
      "bob@admin.test",
      "alice@admin.test",
    ]);
  });

  it("pages the notes", async () => {
    for (let i = 0; i < 3; i++) await notes.add(driverId, `n${i}`, alice);
    const second = await notes.list(driverId, { page: 2, limit: 2 });
    expect(second).toMatchObject({ total: 3, page: 2, limit: 2 });
    expect(second.items).toHaveLength(1);
  });

  it("the author deletes their own note; another admin is refused (403)", async () => {
    const note = await notes.add(driverId, "Late again", alice);
    await expect(notes.remove(driverId, note.id, bob)).rejects.toBeInstanceOf(
      ForbiddenException,
    );
    await notes.remove(driverId, note.id, alice);
    expect((await notes.list(driverId, page)).total).toBe(0);
  });

  it("404 for an unknown driver, and for a note id under the wrong driver", async () => {
    const note = await notes.add(driverId, "x", alice);
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
    await notes.add(driverId, "kept", alice);
    await db.query(`DELETE FROM users WHERE id = $1`, [alice]);
    const [item] = (await notes.list(driverId, page)).items;
    expect(item).toMatchObject({
      body: "kept",
      authorId: null,
      authorEmail: null,
    });
  });

  it("the body is trimmed, and empty or over 2000 characters is refused (the ValidationPipe answers 400)", () => {
    const parse = (body: unknown) => {
      const dto = plainToInstance(CreateDriverNoteDto, { body });
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
      DriverNotesController.prototype.list,
      DriverNotesController.prototype.add,
      DriverNotesController.prototype.remove,
      /* eslint-enable @typescript-eslint/unbound-method */
    ]) {
      expect(Reflect.getMetadata(IS_PUBLIC_KEY, handler)).toBeUndefined();
      expect(Reflect.getMetadata(ROLES_KEY, handler)).toBeUndefined();
    }
    expect(
      Reflect.getMetadata(IS_PUBLIC_KEY, DriverNotesController),
    ).toBeUndefined();
  });
});
