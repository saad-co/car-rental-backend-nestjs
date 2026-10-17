import { ServiceUnavailableException } from "@nestjs/common";
import type { ConfigService } from "@nestjs/config";
import type { DataSource } from "typeorm";
import {
  Application,
  ApplicationStatus,
} from "../src/applications/application.entity.js";
import type { ApplicationAlertService } from "../src/applications/application-alert.service.js";
import { ApplicationsService } from "../src/applications/applications.service.js";
import { MessageTemplate } from "../src/message-templates/message-template.entity.js";
import { MessageTemplatesService } from "../src/message-templates/message-templates.service.js";
import {
  QuoApiError,
  type QuoClient,
  type QuoMessage,
  type QuoMessagePage,
} from "../src/sms/quo/quo-client.js";
import { SmsService, type SmsDeps } from "../src/sms/sms.service.js";
import { PasswordService } from "../src/users/password.service.js";
import { openTestDatabase, seedTestTemplates } from "./test-database.js";

/** A Quo in memory: records what it was asked to send; can be told to fail from the Nth send on. */
class FakeQuo implements QuoClient {
  sent: { to: string; text: string }[] = [];
  failSend: Error | null = null;
  /** Fail only once this many texts have been sent (0 = from the first). */
  failAfter = 0;

  sendText(to: string, text: string): Promise<QuoMessage> {
    if (this.failSend && this.sent.length >= this.failAfter)
      return Promise.reject(this.failSend);
    this.sent.push({ to, text });
    return Promise.resolve({
      id: `ACtest${this.sent.length}`,
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

describe("Approve and decline send texts (test database)", () => {
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
      new MessageTemplatesService(db.getRepository(MessageTemplate)),
    );

  const count = async (table: string) =>
    Number(
      (
        (await db.query(`SELECT count(*) AS n FROM ${table}`)) as [
          { n: string },
        ]
      )[0].n,
    );

  /** The texts saved in the chat, oldest first. */
  const texts = () =>
    db.query(
      `SELECT body, status, mode, contact_phone FROM sms_messages ORDER BY created_at, occurred_at`,
    ) as Promise<
      { body: string; status: string; mode: string; contact_phone: string }[]
    >;

  const statusOf = async () =>
    (
      (await db.query(`SELECT status FROM applications WHERE id = $1`, [
        applicationId,
      ])) as [{ status: string }]
    )[0].status;

  beforeAll(async () => {
    db = await openTestDatabase();
  });

  beforeEach(async () => {
    await db.query(
      "TRUNCATE sms_attachments, sms_messages, applications, drivers, users CASCADE",
    );
    await seedTestTemplates(db);
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

  describe("approve (B71, D52)", () => {
    it("dry_run: sends the approved template filled in, then the login; the password in it works", async () => {
      const approved = await service("dry_run").approve(applicationId, adminId);

      expect(approved.status).toBe("approved");
      expect(quo.sent).toEqual([]); // dry run: nothing leaves

      const [approvedText, loginText] = await texts();
      expect(approvedText).toMatchObject({
        body: "Approved: Pat Applicant",
        status: "composed",
        mode: "dry_run",
        contact_phone: "+13057210909",
      });
      expect(loginText.body).toContain("Email: pat@test.dev");
      expect(loginText.body).toContain("https://app.test/driver/login");

      // The password in the text is the one that opens the account, and the email needs no confirmation.
      const password = /Temporary password: (\S+)/.exec(loginText.body)![1];
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
      expect(user).toMatchObject({
        must_change_password: true,
        role: "driver",
      });
      expect(user.email_verified_at).not.toBeNull();
      expect(await count("drivers")).toBe(1);
      // An approved applicant is a driver in onboarding until contract, deposit and vehicle are done (D56).
      expect(await count("drivers WHERE status = 'onboarding'")).toBe(1);
    });

    it("uses the template as edited in Settings", async () => {
      await db.query(
        `UPDATE message_templates SET body = 'Welcome aboard {firstName}!' WHERE key = 'application_approved'`,
      );
      await service("dry_run").approve(applicationId, adminId);
      expect((await texts())[0].body).toBe("Welcome aboard Pat!");
    });

    it("live: sends both texts through Quo to the application's phone", async () => {
      await service("live").approve(applicationId, adminId);

      expect(quo.sent.map((s) => s.to)).toEqual([
        "+13057210909",
        "+13057210909",
      ]);
      expect(quo.sent[0].text).toBe("Approved: Pat Applicant");
      expect(quo.sent[1].text).toContain("Temporary password:");
    });

    it("off: refuses and creates nothing", async () => {
      await expect(
        service("off").approve(applicationId, adminId),
      ).rejects.toBeInstanceOf(ServiceUnavailableException);

      expect(await count("users WHERE role = 'driver'")).toBe(0);
      expect(await count("drivers")).toBe(0);
      expect(await count("sms_messages")).toBe(0);
      expect(await statusOf()).toBe("pending");
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
      expect(await statusOf()).toBe("pending");
    });

    it("live: when the login text fails after the approved text, nothing is approved", async () => {
      quo.failSend = new QuoApiError(402, "Subscription expired");
      quo.failAfter = 1; // the approved text goes out, the login text fails

      const error = await service("live")
        .approve(applicationId, adminId)
        .catch((e: unknown) => e);

      expect((error as Error).message).toContain("The login text");
      expect(await count("drivers")).toBe(0);
      expect(await statusOf()).toBe("pending");
    });
  });

  describe("decline (B72)", () => {
    it("with sendText: declines and sends the declined template filled in", async () => {
      const declined = await service("dry_run").setStatus(
        applicationId,
        ApplicationStatus.rejected,
        adminId,
        { sendText: true },
      );

      expect(declined.status).toBe("rejected");
      const [text] = await texts();
      expect(text).toMatchObject({
        body: "Declined: Pat",
        status: "composed",
      });
    });

    it("without sendText: declines and sends nothing", async () => {
      await service("live").setStatus(
        applicationId,
        ApplicationStatus.rejected,
        adminId,
      );
      expect(await statusOf()).toBe("rejected");
      expect(quo.sent).toEqual([]);
      expect(await count("sms_messages")).toBe(0);
    });

    it("when the decline text fails, nothing is declined and the reason is in plain words", async () => {
      quo.failSend = new QuoApiError(402, "Subscription expired");

      const error = await service("live")
        .setStatus(applicationId, ApplicationStatus.rejected, adminId, {
          sendText: true,
        })
        .catch((e: unknown) => e);

      expect(error).toBeInstanceOf(ServiceUnavailableException);
      expect((error as Error).message).toContain("nothing was declined");
      expect(await statusOf()).toBe("pending");
    });

    it("sendText is ignored for on hold", async () => {
      await service("live").setStatus(
        applicationId,
        ApplicationStatus.on_hold,
        adminId,
        {
          sendText: true,
        },
      );
      expect(await statusOf()).toBe("on_hold");
      expect(quo.sent).toEqual([]);
    });
  });
});
