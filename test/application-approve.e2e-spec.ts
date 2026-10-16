import { ServiceUnavailableException } from "@nestjs/common";
import type { ConfigService } from "@nestjs/config";
import type { DataSource } from "typeorm";
import { Application } from "../src/applications/application.entity.js";
import type { ApplicationAlertService } from "../src/applications/application-alert.service.js";
import { ApplicationsService } from "../src/applications/applications.service.js";
import {
  QuoApiError,
  type QuoClient,
  type QuoMessage,
  type QuoMessagePage,
} from "../src/sms/quo/quo-client.js";
import { SmsService, type SmsDeps } from "../src/sms/sms.service.js";
import { PasswordService } from "../src/users/password.service.js";
import { openTestDatabase } from "./test-database.js";

/** A Quo in memory: records what it was asked to send. */
class FakeQuo implements QuoClient {
  sent: { to: string; text: string }[] = [];
  failSend: Error | null = null;

  sendText(to: string, text: string): Promise<QuoMessage> {
    if (this.failSend) return Promise.reject(this.failSend);
    this.sent.push({ to, text });
    return Promise.resolve({
      id: "ACinvite1",
      direction: "outgoing",
      from: "+13127362939",
      to: [to],
      text,
      status: "queued",
      createdAt: new Date(),
      media: [],
      errorCode: null,
    });
  }

  listConversation(): Promise<QuoMessagePage> {
    return Promise.resolve({ messages: [], nextPageToken: null });
  }
}

describe("ApplicationsService.approve sends the login by text (test database)", () => {
  let db: DataSource;
  let quo: FakeQuo;
  let applicationId: string;
  let adminId: string;
  const passwords = new PasswordService();

  const service = (mode: SmsDeps["mode"]) =>
    new ApplicationsService(
      db.getRepository(Application),
      db,
      passwords,
      new SmsService(db, {
        mode,
        quo,
        phoneNumberId: "PNtest",
        storage: null,
      }),
      {
        notifyInBackground: () => undefined,
      } as unknown as ApplicationAlertService,
      { getOrThrow: () => "https://app.test" } as unknown as ConfigService,
      null,
    );

  const count = async (table: string) =>
    Number(
      (
        (await db.query(`SELECT count(*) AS n FROM ${table}`)) as [
          { n: string },
        ]
      )[0].n,
    );

  beforeAll(async () => {
    db = await openTestDatabase();
  });

  beforeEach(async () => {
    await db.query(
      "TRUNCATE sms_attachments, sms_messages, applications, drivers, users CASCADE",
    );
    quo = new FakeQuo();
    [{ id: adminId }] = (await db.query(
      `INSERT INTO users (email, password_hash, role) VALUES ('admin@test.dev', 'x', 'admin') RETURNING id`,
    )) as [{ id: string }];
    [{ id: applicationId }] = (await db.query(
      `INSERT INTO applications (request_id, first_name, last_name, email, phone, payload)
       VALUES ('r1', 'Pat', 'Applicant', 'pat@test.dev', '(305) 721-0909', '{}') RETURNING id`,
    )) as [{ id: string }];
  });

  afterAll(async () => {
    await db.destroy();
  });

  it("dry_run: approves, saves the text in the chat as not sent, and the password in it works", async () => {
    const approved = await service("dry_run").approve(applicationId, adminId);

    expect(approved.status).toBe("approved");
    expect(quo.sent).toEqual([]); // dry run: nothing leaves

    const [text] = (await db.query(
      `SELECT body, status, mode, contact_phone FROM sms_messages`,
    )) as [
      { body: string; status: string; mode: string; contact_phone: string },
    ];
    expect(text).toMatchObject({
      status: "composed",
      mode: "dry_run",
      contact_phone: "+13057210909",
    });
    expect(text.body).toContain("Email: pat@test.dev");
    expect(text.body).toContain("https://app.test/driver/login");

    // The password in the text is the one that opens the account, and the email needs no confirmation.
    const password = /Temporary password: (\S+)/.exec(text.body)![1];
    const [user] = (await db.query(
      `SELECT password_hash, must_change_password, email_verified_at, role FROM users WHERE email = 'pat@test.dev'`,
    )) as [
      {
        password_hash: string;
        must_change_password: boolean;
        email_verified_at: Date | null;
        role: string;
      },
    ];
    expect(await passwords.verify(password, user.password_hash)).toBe(true);
    expect(user).toMatchObject({ must_change_password: true, role: "driver" });
    expect(user.email_verified_at).not.toBeNull();
    expect(await count("drivers")).toBe(1);
    // An approved applicant is a driver in onboarding until contract, deposit and vehicle are done (D56).
    expect(await count("drivers WHERE status = 'onboarding'")).toBe(1);
  });

  it("live: sends the text through Quo to the application's phone", async () => {
    await service("live").approve(applicationId, adminId);

    expect(quo.sent).toHaveLength(1);
    expect(quo.sent[0].to).toBe("+13057210909");
    expect(quo.sent[0].text).toContain("Temporary password:");
  });

  it("off: refuses and creates nothing", async () => {
    await expect(
      service("off").approve(applicationId, adminId),
    ).rejects.toBeInstanceOf(ServiceUnavailableException);

    expect(await count("users WHERE role = 'driver'")).toBe(0);
    expect(await count("drivers")).toBe(0);
    expect(await count("sms_messages")).toBe(0);
    const [{ status }] = (await db.query(
      `SELECT status FROM applications WHERE id = '${applicationId}'`,
    )) as [{ status: string }];
    expect(status).toBe("pending");
  });

  it("live: when Quo refuses, nothing is approved and the reason is in plain words", async () => {
    quo.failSend = new QuoApiError(402, "Subscription expired");

    const error = await service("live")
      .approve(applicationId, adminId)
      .catch((e: unknown) => e);

    expect(error).toBeInstanceOf(ServiceUnavailableException);
    expect((error as Error).message).toContain("nothing was approved");
    expect((error as Error).message).toContain("no credits");
    expect(await count("users WHERE role = 'driver'")).toBe(0);
    expect(await count("drivers")).toBe(0);
    const [{ status }] = (await db.query(
      `SELECT status FROM applications WHERE id = '${applicationId}'`,
    )) as [{ status: string }];
    expect(status).toBe("pending");
  });
});
