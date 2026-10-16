import type { ConfigService } from "@nestjs/config";
import type { MessageTemplatesService } from "../src/message-templates/message-templates.service.js";
import type { DataSource } from "typeorm";
import { ApplicationAlertService } from "../src/applications/application-alert.service.js";
import { Application } from "../src/applications/application.entity.js";
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

const STAFF = "+12243282246";

/** A Quo in memory: records what it was asked to send. */
class FakeQuo implements QuoClient {
  sent: { to: string; text: string }[] = [];
  failSend: Error | null = null;

  sendText(to: string, text: string): Promise<QuoMessage> {
    if (this.failSend) return Promise.reject(this.failSend);
    this.sent.push({ to, text });
    return Promise.resolve({
      id: `ACalert${this.sent.length}`,
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

/** The website's submission, in the shape our intake reads. */
const submission = (requestId: string) => ({
  request_id: requestId,
  first_name: "Pat",
  last_name: "Applicant",
  email: "pat@test.dev",
  phone: "3057210909",
});

describe("new-application alert to staff (test database)", () => {
  let db: DataSource;
  let quo: FakeQuo;

  const build = (mode: SmsDeps["mode"], alertPhone: string | undefined) => {
    const config = {
      get: (key: string) =>
        key === "APPLICATION_ALERT_PHONE" ? alertPhone : undefined,
      getOrThrow: () => "https://app.test",
    } as unknown as ConfigService;
    const sms = new SmsService(db, {
      mode,
      quo,
      phoneNumberId: "PNtest",
      storage: null,
    });
    const alerts = new ApplicationAlertService(
      db.getRepository(Application),
      sms,
      config,
    );
    return new ApplicationsService(
      db.getRepository(Application),
      db,
      new PasswordService(),
      sms,
      alerts,
      config,
      null,
      {} as MessageTemplatesService,
    );
  };

  const alertRows = () =>
    db.query(
      `SELECT body, status, mode, contact_phone, error FROM sms_messages ORDER BY created_at`,
    ) as Promise<
      {
        body: string;
        status: string;
        mode: string;
        contact_phone: string;
        error: string | null;
      }[]
    >;
  const application = async () =>
    (
      (await db.query(
        `SELECT alerted_at, alert_error FROM applications LIMIT 1`,
      )) as [{ alerted_at: Date | null; alert_error: string | null }]
    )[0];

  /** The alert runs in the background, so wait until it has written its row. */
  const waitForAlert = async (rows = 1) => {
    for (let i = 0; i < 60; i++) {
      if ((await alertRows()).length >= rows) {
        await new Promise((resolve) => setTimeout(resolve, 100)); // let it finish updating the application
        return;
      }
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    throw new Error("the alert was not recorded in time");
  };

  beforeAll(async () => {
    db = await openTestDatabase();
  });

  beforeEach(async () => {
    await db.query(
      "TRUNCATE sms_attachments, sms_messages, applications CASCADE",
    );
    quo = new FakeQuo();
  });

  afterAll(async () => {
    await db.destroy();
  });

  it("dry_run: saves the alert with the name and a link, and sends nothing", async () => {
    const { application: saved } = await build("dry_run", STAFF).receive(
      submission("r1"),
    );
    await waitForAlert();

    const [alert] = await alertRows();
    expect(alert).toMatchObject({
      status: "composed",
      mode: "dry_run",
      contact_phone: STAFF,
    });
    expect(alert.body).toContain("Pat Applicant");
    expect(alert.body).toContain(
      `https://app.test/admin/applications/${saved.id}`,
    );
    // Only the name and the link: nothing else about the applicant.
    expect(alert.body).not.toContain("3057210909");
    expect(alert.body).not.toContain("pat@test.dev");
    expect(quo.sent).toEqual([]);
  });

  it("live: sends one text to the staff phone and records when", async () => {
    await build("live", STAFF).receive(submission("r1"));
    await waitForAlert();

    expect(quo.sent).toHaveLength(1);
    expect(quo.sent[0].to).toBe(STAFF);
    const stored = await application();
    expect(stored.alerted_at).not.toBeNull();
    expect(stored.alert_error).toBeNull();
  });

  it("a repeat of the same submission does not alert again", async () => {
    const service = build("live", STAFF);
    await service.receive(submission("r1"));
    await waitForAlert();
    const again = await service.receive(submission("r1"));
    await new Promise((resolve) => setTimeout(resolve, 300));

    expect(again.created).toBe(false);
    expect(quo.sent).toHaveLength(1);
  });

  it("without a staff phone, nothing is sent or saved", async () => {
    await build("live", undefined).receive(submission("r1"));
    await new Promise((resolve) => setTimeout(resolve, 300));

    expect(await alertRows()).toEqual([]);
    expect(quo.sent).toEqual([]);
  });

  it("when Quo refuses (daily limit), the application is still stored and the reason is on it", async () => {
    quo.failSend = new QuoApiError(403, "daily cap reached");

    const { created } = await build("live", STAFF).receive(submission("r1"));
    await waitForAlert();

    expect(created).toBe(true); // the website's submission succeeded
    const stored = await application();
    expect(stored.alerted_at).toBeNull();
    expect(stored.alert_error).toContain("daily message limit");
    expect((await alertRows())[0]).toMatchObject({ status: "failed" });
  });

  it("off: no text, and the application says texting is switched off", async () => {
    await build("off", STAFF).receive(submission("r1"));
    await new Promise((resolve) => setTimeout(resolve, 400));

    expect(await alertRows()).toEqual([]);
    expect((await application()).alert_error).toContain("switched off");
  });
});
