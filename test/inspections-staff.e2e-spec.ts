import {
  BadGatewayException,
  BadRequestException,
  ConflictException,
  NotFoundException,
} from "@nestjs/common";
import type { ConfigService } from "@nestjs/config";
import { plainToInstance } from "class-transformer";
import { validateSync } from "class-validator";
import type { DataSource } from "typeorm";
import { AppSetting } from "../src/settings/app-setting.entity.js";
import { SettingsService } from "../src/settings/settings.service.js";
import { CreateInspectionDto } from "../src/inspections/dto/inspection.dto.js";
import { hashToken } from "../src/inspections/inspection-token.js";
import { InspectionType } from "../src/inspections/inspection.entity.js";
import { InspectionsService } from "../src/inspections/inspections.service.js";
import {
  QuoApiError,
  type QuoClient,
  type QuoMessage,
  type QuoMessagePage,
} from "../src/sms/quo/quo-client.js";
import { SmsService, type SmsDeps } from "../src/sms/sms.service.js";
import { openTestDatabase } from "./test-database.js";

/** A Quo in memory: records what it was asked to send. */
class FakeQuo implements QuoClient {
  sent: { to: string; text: string }[] = [];
  failSend: Error | null = null;

  sendText(to: string, text: string): Promise<QuoMessage> {
    if (this.failSend) return Promise.reject(this.failSend);
    this.sent.push({ to, text });
    return Promise.resolve({
      id: `ACsent${this.sent.length}`,
      direction: "outgoing",
      from: "+13125845595",
      to: [to],
      text,
      status: "queued",
      createdAt: new Date("2026-11-16T15:00:00Z"),
      media: [],
      errorCode: null,
    });
  }
  listConversation(): Promise<QuoMessagePage> {
    return Promise.resolve({ messages: [], nextPageToken: null });
  }
}

const SITE = "https://app.test";
const TOKEN_IN_LINK = /^https:\/\/app\.test\/i\/([A-Za-z0-9_-]{43})$/;
const T0 = new Date("2026-11-16T15:00:00Z");

describe("vehicle inspections, staff side (Module 3 step 2, test database)", () => {
  let db: DataSource;
  let quo: FakeQuo;
  let adminId: string;
  let driverId: string;
  let clock: Date;

  const build = (smsOverrides: Partial<SmsDeps> = {}) => {
    const sms = new SmsService(db, {
      mode: "dry_run",
      quo,
      phoneNumberId: "PNtest",
      quoApiKey: null,
      storage: null,
      ...smsOverrides,
    });
    const service = new InspectionsService(
      db,
      sms,
      new SettingsService(db.getRepository(AppSetting)),
      { getOrThrow: () => `${SITE}/` } as unknown as ConfigService,
    );
    service.now = () => clock;
    return service;
  };
  let service: InspectionsService;

  const typed = (overrides: Record<string, unknown> = {}) => ({
    model: "2021 Toyota Camry",
    plate: "AB 12345",
    vin: "4T1B11HK5KU123456",
    ...overrides,
  });
  const createIn = (type = InspectionType.checkIn, id = driverId) =>
    service.create(id, { type, vehicle: typed() }, adminId);

  const signContract = (
    options: {
      id?: string;
      model?: string | null;
      plate?: string | null;
      vin?: string | null;
      signedAt?: string;
      status?: string;
    } = {},
  ) =>
    db.query(
      `INSERT INTO contracts (driver_id, schedule, total_rate_cents, start_date, status, sent_at, firma_signing_request_id,
                              sent_values, signed_at, security_deposit_cents, vehicle_model, vehicle_plate, vehicle_vin)
       VALUES ($1, 'weekly', 40000, '2026-11-10', $2, now(), 'firma-' || gen_random_uuid(), '{}'::jsonb, $3, 20000, $4, $5, $6)
       RETURNING id`,
      [
        options.id ?? driverId,
        options.status ?? "signed",
        options.signedAt ?? "2026-11-10T12:00:00Z",
        options.model === undefined ? "2022 Honda Accord" : options.model,
        options.plate === undefined ? "CD 98765" : options.plate,
        options.vin === undefined ? "1HGCV1F30MA000111" : options.vin,
      ],
    ) as Promise<{ id: string }[]>;

  const row = async (id: string) =>
    (
      (await db.query(`SELECT * FROM inspections WHERE id = $1`, [
        id,
      ])) as Record<string, unknown>[]
    )[0];
  const events = async (id: string) =>
    (
      (await db.query(
        `SELECT type, meta FROM inspection_events WHERE inspection_id = $1 ORDER BY created_at, id`,
        [id],
      )) as { type: string; meta: Record<string, unknown> | null }[]
    ).map((e) => e.type);
  const audits = async () =>
    (
      (await db.query(
        `SELECT action FROM audit_logs WHERE entity_type = 'inspection' ORDER BY created_at, id`,
      )) as { action: string }[]
    ).map((a) => a.action);
  const texts = () =>
    db.query(
      `SELECT body, mode, status FROM sms_messages ORDER BY occurred_at, id`,
    ) as Promise<{ body: string; mode: string; status: string }[]>;
  const count = async (table: string) =>
    (
      (await db.query(`SELECT COUNT(*)::int AS n FROM ${table}`)) as [
        { n: number },
      ]
    )[0].n;
  const submit = (id: string, at = "2026-11-12T10:00:00Z") =>
    db.query(
      `UPDATE inspections SET status = 'submitted', submitted_at = $2, attested_at = $2, odometer_miles = 1000, fuel_level = 'full' WHERE id = $1`,
      [id, at],
    );
  const tokenOf = (link: string) => TOKEN_IN_LINK.exec(link)![1];

  beforeAll(async () => {
    db = await openTestDatabase();
  });

  beforeEach(async () => {
    await db.query(
      "TRUNCATE inspection_events, inspection_photos, inspections, sms_messages, drivers, users CASCADE",
    );
    [{ id: adminId }] = (await db.query(
      `INSERT INTO users (email, password_hash, role) VALUES ('admin@inspect.test', 'x', 'admin') RETURNING id`,
    )) as [{ id: string }];
    [{ id: driverId }] = (await db.query(
      `INSERT INTO drivers (first_name, last_name, email, phone)
       VALUES ('Maria', 'Driver', 'maria@inspect.test', '+13125550101') RETURNING id`,
    )) as [{ id: string }];
    quo = new FakeQuo();
    clock = T0;
    service = build();
  });

  afterAll(async () => {
    await db.destroy();
  });

  describe("making an inspection", () => {
    it("takes a type and, for a driver with no contract, a typed vehicle", async () => {
      const made = await createIn();
      expect(made).toMatchObject({
        type: "check_in",
        status: "created",
        driverId,
        contractId: null,
        vehicle: {
          model: "2021 Toyota Camry",
          plate: "AB 12345",
          vin: "4T1B11HK5KU123456",
        },
        pairedInspectionId: null,
        photoCount: 0,
        damagePhotoCount: 0,
      });
      expect(made.reference).toMatch(/^INS-2026-\d{6}$/);
      expect(await events(made.id)).toEqual(["created"]);
      expect(await audits()).toEqual(["inspection.create"]);
    });

    it("does not hand out a link yet: the stored link time is already up", async () => {
      const made = await createIn();
      expect(made.linkSentAt).toBeNull();
      expect(made.tokenExpiresAt).toEqual(T0);
      // Nothing to expire: 'created' stays 'created' however late it is.
      clock = new Date(T0.getTime() + 72 * 3_600_000);
      expect((await service.findOne(made.id)).status).toBe("created");
    });

    it("refuses a driver with no contract vehicle when none is typed", async () => {
      await expect(
        service.create(driverId, { type: InspectionType.checkIn }, adminId),
      ).rejects.toThrow(/Type the vehicle/);
      expect(await count("inspections")).toBe(0);
    });

    it("copies the vehicle from the driver's signed contract", async () => {
      const [{ id: contractId }] = await signContract();
      const made = await service.create(
        driverId,
        { type: InspectionType.checkIn },
        adminId,
      );
      expect(made.contractId).toBe(contractId);
      expect(made.vehicle).toEqual({
        model: "2022 Honda Accord",
        plate: "CD 98765",
        vin: "1HGCV1F30MA000111",
      });
    });

    it("keeps the copy when the contract's vehicle changes later", async () => {
      await signContract();
      const made = await service.create(
        driverId,
        { type: InspectionType.checkIn },
        adminId,
      );
      await db.query(`UPDATE contracts SET vehicle_model = 'Something else'`);
      expect((await service.findOne(made.id)).vehicle.model).toBe(
        "2022 Honda Accord",
      );
    });

    it("refuses a typed vehicle when the contract already holds one", async () => {
      await signContract();
      await expect(createIn()).rejects.toThrow(
        /comes from the driver's signed contract/,
      );
    });

    it("uses the latest signed contract and ignores drafts and unsigned ones", async () => {
      await signContract({
        model: "Older car",
        signedAt: "2026-10-01T12:00:00Z",
      });
      await signContract({
        model: "Newest car",
        signedAt: "2026-11-05T12:00:00Z",
      });
      await signContract({
        model: "Draft car",
        signedAt: "2026-11-15T12:00:00Z",
        status: "sent",
      });
      const made = await service.create(
        driverId,
        { type: InspectionType.checkIn },
        adminId,
      );
      expect(made.vehicle.model).toBe("Newest car");
    });

    it("asks for the vehicle when the signed contract holds none", async () => {
      await signContract({ model: null, plate: null, vin: null });
      await expect(
        service.create(driverId, { type: InspectionType.checkIn }, adminId),
      ).rejects.toThrow(BadRequestException);
      const made = await createIn();
      expect(made.contractId).toBeNull();
    });

    it("returns the open inspection of the same type instead of making a second", async () => {
      const first = await createIn();
      const again = await createIn();
      expect(again.id).toBe(first.id);
      expect(again.reference).toBe(first.reference);
      expect(await count("inspections")).toBe(1);
    });

    it("makes one check-in and one check-out for the same driver", async () => {
      const checkIn = await createIn(InspectionType.checkIn);
      const checkOut = await createIn(InspectionType.checkOut);
      expect(checkOut.id).not.toBe(checkIn.id);
      expect(await count("inspections")).toBe(2);
    });

    it("gives two admins pressing at the same moment the same inspection", async () => {
      const [a, b] = await Promise.all([createIn(), createIn()]);
      expect(a.id).toBe(b.id);
      expect(await count("inspections")).toBe(1);
    });

    it("gives every inspection its own reference", async () => {
      const a = await createIn(InspectionType.checkIn);
      const b = await createIn(InspectionType.checkOut);
      expect(a.reference).not.toBe(b.reference);
    });

    it("pairs a check-out with the driver's latest submitted check-in on the same contract", async () => {
      await signContract();
      const older = await service.create(
        driverId,
        { type: InspectionType.checkIn },
        adminId,
      );
      await submit(older.id, "2026-10-01T10:00:00Z");
      const newer = await service.create(
        driverId,
        { type: InspectionType.checkIn },
        adminId,
      );
      await submit(newer.id, "2026-11-12T10:00:00Z");
      const checkOut = await service.create(
        driverId,
        { type: InspectionType.checkOut },
        adminId,
      );
      expect(checkOut.pairedInspectionId).toBe(newer.id);
    });

    it("does not pair a check-out with a check-in that was never submitted, or is on another contract", async () => {
      await signContract();
      const unsubmitted = await service.create(
        driverId,
        { type: InspectionType.checkIn },
        adminId,
      );
      expect(unsubmitted.status).toBe("created");
      const checkOut = await service.create(
        driverId,
        { type: InspectionType.checkOut },
        adminId,
      );
      expect(checkOut.pairedInspectionId).toBeNull();
      await service.revoke(checkOut.id, adminId);

      await submit(unsubmitted.id);
      await db.query(
        `UPDATE inspections SET contract_id = NULL WHERE id = $1`,
        [unsubmitted.id],
      );
      const other = await service.create(
        driverId,
        { type: InspectionType.checkOut },
        adminId,
      );
      expect(other.pairedInspectionId).toBeNull();
    });

    it("refuses an unknown driver", async () => {
      await expect(
        service.create(
          "00000000-0000-4000-8000-000000000000",
          { type: InspectionType.checkIn, vehicle: typed() },
          adminId,
        ),
      ).rejects.toThrow(NotFoundException);
    });
  });

  describe("the request body", () => {
    const validate = (raw: Record<string, unknown>) => {
      const dto = plainToInstance(CreateInspectionDto, raw);
      const errors = validateSync(dto, {
        whitelist: true,
        forbidNonWhitelisted: true,
      });
      return { dto, errors };
    };

    it("needs a type of check_in or check_out", () => {
      expect(validate({}).errors.map((e) => e.property)).toEqual(["type"]);
      expect(validate({ type: "spot_check" }).errors).toHaveLength(1);
      expect(validate({ type: "check_in" }).errors).toEqual([]);
      expect(validate({ type: "check_out" }).errors).toEqual([]);
    });

    it("needs a model on a typed vehicle, trims it and turns empty plate and VIN into nothing", () => {
      expect(
        validate({ type: "check_in", vehicle: { model: "  " } }).errors,
      ).toHaveLength(1);
      const { dto, errors } = validate({
        type: "check_in",
        vehicle: { model: " Camry ", plate: " ", vin: "" },
      });
      expect(errors).toEqual([]);
      expect(dto.vehicle).toMatchObject({
        model: "Camry",
        plate: null,
        vin: null,
      });
    });
  });

  describe("sending the link", () => {
    it("texts the driver the client's text with a fresh link, saved as a dry run", async () => {
      const made = await createIn();
      const sent = await service.send(made.id, adminId);
      expect(sent.link).toMatch(TOKEN_IN_LINK);
      expect(sent.textMode).toBe("dry_run");
      expect(sent.textStatus).toBe("composed");
      expect(sent.inspection.status).toBe("link_sent");
      expect(sent.inspection.linkSentAt).toEqual(T0);

      const [text] = await texts();
      expect(text.mode).toBe("dry_run");
      expect(text.body).toBe(
        `GonzoCar: Hi Maria, before you drive the 2021 Toyota Camry (AB 12345), please complete your vehicle check-in photos here: ${sent.link} It takes about 5 minutes. Link expires in 24 hours.`,
      );
      expect(quo.sent).toEqual([]); // dry run: Quo is never called
      expect(await events(made.id)).toEqual([
        "created",
        "link_issued",
        "link_sent",
      ]);
      expect(await audits()).toEqual(["inspection.create", "inspection.send"]);
    });

    it("sends the check-out text for a check-out", async () => {
      const made = await createIn(InspectionType.checkOut);
      await service.send(made.id, adminId);
      const [text] = await texts();
      expect(text.body).toContain(
        "today is your return day for the 2021 Toyota Camry (AB 12345)",
      );
    });

    it("writes to a Spanish-reading driver in Spanish", async () => {
      await db.query(
        `UPDATE drivers SET preferred_language = 'es' WHERE id = $1`,
        [driverId],
      );
      const made = await createIn();
      await service.send(made.id, adminId);
      const [text] = await texts();
      expect(text.body).toContain(
        "Hola Maria, antes de manejar el 2021 Toyota Camry (AB 12345)",
      );
    });

    it("really sends through Quo when texting is live", async () => {
      service = build({ mode: "live" });
      const made = await createIn();
      const sent = await service.send(made.id, adminId);
      expect(sent.textMode).toBe("live");
      expect(quo.sent).toHaveLength(1);
      expect(quo.sent[0].to).toBe("+13125550101");
      expect(quo.sent[0].text).toContain(sent.link);
    });

    it("stores only the hash of the token, never the token or the link", async () => {
      const made = await createIn();
      const { link } = await service.send(made.id, adminId);
      const token = tokenOf(link);
      const stored = await row(made.id);
      expect(stored.token_hash).toBe(hashToken(token));
      expect(JSON.stringify(stored)).not.toContain(token);
      const auditText = JSON.stringify(
        await db.query(`SELECT action, before, after FROM audit_logs`),
      );
      const eventText = JSON.stringify(
        await db.query(`SELECT type, meta FROM inspection_events`),
      );
      expect(auditText).not.toContain(token);
      expect(eventText).not.toContain(token);
    });

    it("makes the link work for 24 hours, or for as many hours as the setting says", async () => {
      const made = await createIn();
      const sent = await service.send(made.id, adminId);
      expect(sent.inspection.tokenExpiresAt).toEqual(
        new Date(T0.getTime() + 24 * 3_600_000),
      );
      await db.query(
        `INSERT INTO app_settings (key, value) VALUES ('inspection_link_hours', '2')`,
      );
      const again = await service.send(made.id, adminId);
      expect(again.inspection.tokenExpiresAt).toEqual(
        new Date(T0.getTime() + 2 * 3_600_000),
      );
    });

    it("ignores a nonsense hours setting", async () => {
      await db.query(
        `INSERT INTO app_settings (key, value) VALUES ('inspection_link_hours', 'soon')`,
      );
      const made = await createIn();
      const sent = await service.send(made.id, adminId);
      expect(sent.inspection.tokenExpiresAt).toEqual(
        new Date(T0.getTime() + 24 * 3_600_000),
      );
    });

    it("makes a fresh token every time: the earlier link stops working", async () => {
      const made = await createIn();
      const first = await service.send(made.id, adminId);
      const second = await service.send(made.id, adminId);
      expect(second.link).not.toBe(first.link);
      const hashes = (
        (await db.query(`SELECT token_hash FROM inspections`)) as {
          token_hash: string;
        }[]
      ).map((r) => r.token_hash);
      expect(hashes).toEqual([hashToken(tokenOf(second.link))]);
      expect(await count("sms_messages")).toBe(2);
    });

    it("keeps a driver who already started where they are", async () => {
      const made = await createIn();
      await service.send(made.id, adminId);
      await db.query(
        `UPDATE inspections SET status = 'in_progress' WHERE id = $1`,
        [made.id],
      );
      const sent = await service.send(made.id, adminId);
      expect(sent.inspection.status).toBe("in_progress");
    });

    it("can send again after the link has run out of time", async () => {
      const made = await createIn();
      await service.send(made.id, adminId);
      clock = new Date(T0.getTime() + 25 * 3_600_000);
      expect((await service.findOne(made.id)).status).toBe("expired");
      const sent = await service.send(made.id, adminId);
      expect(sent.inspection.status).toBe("link_sent");
      expect(sent.inspection.tokenExpiresAt).toEqual(
        new Date(clock.getTime() + 24 * 3_600_000),
      );
    });

    it("does not text a driver who texted STOP, and leaves the link as it was", async () => {
      await db.query(`UPDATE drivers SET sms_opted_out = true WHERE id = $1`, [
        driverId,
      ]);
      const made = await createIn();
      const before = await row(made.id);
      await expect(service.send(made.id, adminId)).rejects.toThrow(
        /texted STOP/,
      );
      expect((await row(made.id)).token_hash).toBe(before.token_hash);
      expect(await count("sms_messages")).toBe(0);
    });

    it("says so when texting is switched off, and records no text", async () => {
      service = build({ mode: "off" });
      const made = await createIn();
      await expect(service.send(made.id, adminId)).rejects.toThrow(
        ConflictException,
      );
      const stored = await row(made.id);
      expect(stored.link_sent_at).toBeNull();
      expect(await events(made.id)).not.toContain("link_sent");
      expect(await count("sms_messages")).toBe(0);
    });

    it("tells the admin why Quo refused, keeps the failed text in the chat and does not mark the link as sent", async () => {
      service = build({ mode: "live" });
      quo.failSend = new QuoApiError(402, "Quo refused");
      const made = await createIn();
      await expect(service.send(made.id, adminId)).rejects.toThrow(
        BadGatewayException,
      );
      const [failed] = await texts();
      expect(failed.status).toBe("failed");
      const stored = await row(made.id);
      expect(stored.link_sent_at).toBeNull();
      expect(await events(made.id)).not.toContain("link_sent");
    });

    it("refuses an inspection that was submitted or revoked", async () => {
      const submitted = await createIn(InspectionType.checkIn);
      await submit(submitted.id);
      await expect(service.send(submitted.id, adminId)).rejects.toThrow(
        /already submitted/,
      );
      const revoked = await createIn(InspectionType.checkOut);
      await service.revoke(revoked.id, adminId);
      await expect(service.send(revoked.id, adminId)).rejects.toThrow(
        /revoked/,
      );
      expect(await count("sms_messages")).toBe(0);
    });

    it("refuses an unknown inspection", async () => {
      await expect(
        service.send("00000000-0000-4000-8000-000000000000", adminId),
      ).rejects.toThrow(NotFoundException);
    });
  });

  describe("copying the link", () => {
    it("makes a fresh link without texting it", async () => {
      const made = await createIn();
      const { inspection, link } = await service.reissue(made.id, adminId);
      expect(link).toMatch(TOKEN_IN_LINK);
      expect(inspection.status).toBe("link_sent");
      expect(inspection.linkSentAt).toBeNull(); // handed out by copy, never texted
      expect(inspection.tokenExpiresAt).toEqual(
        new Date(T0.getTime() + 24 * 3_600_000),
      );
      expect(await count("sms_messages")).toBe(0);
      expect((await row(made.id)).token_hash).toBe(hashToken(tokenOf(link)));
      expect(await events(made.id)).toEqual(["created", "link_issued"]);
      expect(await audits()).toEqual([
        "inspection.create",
        "inspection.reissue",
      ]);
    });

    it("kills the earlier link, the one that was texted included", async () => {
      const made = await createIn();
      const sent = await service.send(made.id, adminId);
      const copied = await service.reissue(made.id, adminId);
      expect((await row(made.id)).token_hash).toBe(
        hashToken(tokenOf(copied.link)),
      );
      expect((await row(made.id)).token_hash).not.toBe(
        hashToken(tokenOf(sent.link)),
      );
    });

    it("works for a driver who texted STOP, which is what it is for", async () => {
      await db.query(`UPDATE drivers SET sms_opted_out = true WHERE id = $1`, [
        driverId,
      ]);
      const made = await createIn();
      await expect(service.reissue(made.id, adminId)).resolves.toBeDefined();
    });

    it("refuses an inspection that was submitted or revoked", async () => {
      const a = await createIn(InspectionType.checkIn);
      await submit(a.id);
      await expect(service.reissue(a.id, adminId)).rejects.toThrow(
        ConflictException,
      );
      const b = await createIn(InspectionType.checkOut);
      await service.revoke(b.id, adminId);
      await expect(service.reissue(b.id, adminId)).rejects.toThrow(
        ConflictException,
      );
    });
  });

  describe("revoking", () => {
    it("cancels the inspection, logs it and lets a new one be made", async () => {
      const made = await createIn();
      await service.send(made.id, adminId);
      const revoked = await service.revoke(made.id, adminId);
      expect(revoked.status).toBe("revoked");
      expect(await events(made.id)).toContain("revoked");
      expect(await audits()).toContain("inspection.revoke");

      const fresh = await createIn();
      expect(fresh.id).not.toBe(made.id);
      expect(fresh.status).toBe("created");
      expect(await count("inspections")).toBe(2);
    });

    it("keeps the photos already taken", async () => {
      const made = await createIn();
      await db.query(
        `INSERT INTO inspection_photos (inspection_id, shot_id, storage_key, thumb_key, sha256)
         VALUES ($1, 'EXT_FRONT', 'k', 't', $2)`,
        [made.id, "a".repeat(64)],
      );
      await service.revoke(made.id, adminId);
      expect(await count("inspection_photos")).toBe(1);
    });

    it("cannot revoke twice or revoke a submitted inspection", async () => {
      const made = await createIn();
      await service.revoke(made.id, adminId);
      await expect(service.revoke(made.id, adminId)).rejects.toThrow(/revoked/);
      const done = await createIn();
      await submit(done.id);
      await expect(service.revoke(done.id, adminId)).rejects.toThrow(
        /already submitted/,
      );
    });

    it("revokes an inspection whose link already ran out of time", async () => {
      const made = await createIn();
      await service.send(made.id, adminId);
      clock = new Date(T0.getTime() + 30 * 3_600_000);
      expect((await service.revoke(made.id, adminId)).status).toBe("revoked");
    });
  });

  describe("reading", () => {
    it("lists a driver's inspections newest first, with the photo counts and the contract's vehicle", async () => {
      await signContract();
      const checkIn = await service.create(
        driverId,
        { type: InspectionType.checkIn },
        adminId,
      );
      await submit(checkIn.id);
      const checkOut = await service.create(
        driverId,
        { type: InspectionType.checkOut },
        adminId,
      );
      await db.query(
        `INSERT INTO inspection_photos (inspection_id, shot_id, position, storage_key, thumb_key, sha256) VALUES
         ($1, 'EXT_FRONT', 1, 'k1', 't1', $2), ($1, 'EXT_REAR', 1, 'k2', 't2', $2),
         ($1, 'DAMAGE', 1, 'k3', 't3', $2)`,
        [checkOut.id, "b".repeat(64)],
      );
      const list = await service.list(driverId, { page: 1, limit: 20 });
      expect(list.total).toBe(2);
      expect(list.items.map((i) => i.id)).toEqual([checkOut.id, checkIn.id]);
      expect(list.items[0]).toMatchObject({
        photoCount: 2,
        damagePhotoCount: 1,
      });
      expect(list.items[1]).toMatchObject({
        photoCount: 0,
        status: "submitted",
      });
      expect(list.contractVehicle).toEqual({
        model: "2022 Honda Accord",
        plate: "CD 98765",
        vin: "1HGCV1F30MA000111",
      });
    });

    it("pages the list", async () => {
      await createIn(InspectionType.checkIn);
      await createIn(InspectionType.checkOut);
      const first = await service.list(driverId, { page: 1, limit: 1 });
      const second = await service.list(driverId, { page: 2, limit: 1 });
      expect(first.total).toBe(2);
      expect(first.items).toHaveLength(1);
      expect(second.items).toHaveLength(1);
      expect(second.items[0].id).not.toBe(first.items[0].id);
    });

    it("says there is no contract vehicle when there is none", async () => {
      expect(
        (await service.list(driverId, { page: 1, limit: 20 })).contractVehicle,
      ).toBeNull();
    });

    it("lists only the driver's own inspections", async () => {
      const [{ id: other }] = (await db.query(
        `INSERT INTO drivers (first_name, last_name, email, phone)
         VALUES ('Sam', 'Other', 'sam@inspect.test', '+13125550102') RETURNING id`,
      )) as [{ id: string }];
      await createIn(InspectionType.checkIn, other);
      expect((await service.list(driverId, { page: 1, limit: 20 })).total).toBe(
        0,
      );
    });

    it("shows the activity log with who did what", async () => {
      const made = await createIn();
      await service.send(made.id, adminId);
      const detail = await service.findOne(made.id);
      expect(detail.events.map((e) => e.type)).toEqual([
        "created",
        "link_issued",
        "link_sent",
      ]);
      expect(
        detail.events.every((e) => e.actorEmail === "admin@inspect.test"),
      ).toBe(true);
      expect(detail.events[2].meta).toMatchObject({ textMode: "dry_run" });
    });

    it("answers not found for an unknown driver or inspection", async () => {
      const unknown = "00000000-0000-4000-8000-000000000000";
      await expect(
        service.list(unknown, { page: 1, limit: 20 }),
      ).rejects.toThrow(NotFoundException);
      await expect(service.findOne(unknown)).rejects.toThrow(NotFoundException);
    });
  });
});
