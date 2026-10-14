import { BadGatewayException, ConflictException } from "@nestjs/common";
import type { DataSource } from "typeorm";
import {
  QuoApiError,
  type ListConversationOptions,
  type QuoClient,
  type QuoMessage,
  type QuoMessagePage,
} from "../src/sms/quo/quo-client.js";
import { parseQuoMessageEvent } from "../src/sms/quo/quo-webhook-event.js";
import { SmsAttachment } from "../src/sms/sms-attachment.entity.js";
import { SmsContactKind } from "../src/sms/sms-contact.js";
import { SmsMessage, SmsStatus } from "../src/sms/sms-message.entity.js";
import { SmsService, type SmsDeps } from "../src/sms/sms.service.js";
import { openTestDatabase } from "./test-database.js";

const PN = "PNtest";
const APPLICANT = "+13125550111"; // stored on the application as "(312) 555-0111"
const DRIVER = "+13125550122";
const STRANGER = "+13125550999";

/** A Quo in memory: records what it was asked to send and serves a fixed history. */
class FakeQuo implements QuoClient {
  sent: { to: string; text: string }[] = [];
  history: QuoMessage[] = [];
  historyCalls: { phone: string; options?: ListConversationOptions }[] = [];
  failSend: Error | null = null;
  private counter = 0;

  sendText(to: string, text: string): Promise<QuoMessage> {
    if (this.failSend) return Promise.reject(this.failSend);
    this.sent.push({ to, text });
    return Promise.resolve(
      quoMessage({
        id: `ACsent${++this.counter}`,
        direction: "outgoing",
        to: [to],
        text,
        status: "queued",
      }),
    );
  }

  listConversation(
    phone: string,
    options?: ListConversationOptions,
  ): Promise<QuoMessagePage> {
    this.historyCalls.push({ phone, options });
    return Promise.resolve({ messages: this.history, nextPageToken: null });
  }
}

function quoMessage(overrides: Partial<QuoMessage> = {}): QuoMessage {
  return {
    id: "AC1",
    direction: "incoming",
    from: APPLICANT,
    to: ["+13125845595"],
    text: "Hello",
    status: "received",
    createdAt: new Date("2026-10-14T15:00:00Z"),
    media: [],
    errorCode: null,
    ...overrides,
  };
}

/** A webhook delivery in the shape Quo documents. */
function webhook(
  type: string,
  resource: Record<string, unknown>,
  context: Record<string, unknown> = {},
) {
  return parseQuoMessageEvent({
    id: "EV1",
    type,
    apiVersion: "2026-03-30",
    createdAt: "2026-10-14T15:00:00Z",
    data: {
      resource: {
        id: "AC1",
        direction: "incoming",
        text: "Hello",
        media: [],
        status: "received",
        errorCode: null,
        createdAt: "2026-10-14T15:00:00Z",
        ...resource,
      },
      context: {
        phoneNumberId: PN,
        senderIdentifier: APPLICANT,
        recipientIdentifiers: ["+13125845595"],
        ...context,
      },
    },
  })!;
}

describe("SmsService (test database)", () => {
  let db: DataSource;
  let quo: FakeQuo;
  let applicationId: string;
  let driverId: string;
  let adminId: string;

  const service = (overrides: Partial<SmsDeps> = {}) =>
    new SmsService(db, {
      mode: "dry_run",
      quo,
      phoneNumberId: PN,
      storage: null,
      ...overrides,
    });
  const rows = () =>
    db
      .getRepository(SmsMessage)
      .find({ order: { occurredAt: "ASC" }, relations: { attachments: true } });

  beforeAll(async () => {
    db = await openTestDatabase();
  });

  beforeEach(async () => {
    await db.query(
      "TRUNCATE sms_attachments, sms_messages, applications, drivers, users CASCADE",
    );
    quo = new FakeQuo();
    const [{ id: user }] = (await db.query(
      `INSERT INTO users (email, password_hash, role) VALUES ('admin@test.dev', 'x', 'admin') RETURNING id`,
    )) as [{ id: string }];
    adminId = user;
    const [{ id: app }] = (await db.query(
      `INSERT INTO applications (request_id, first_name, last_name, email, phone, payload)
       VALUES ('r1', 'Pat', 'Applicant', 'pat@test.dev', '(312) 555-0111', '{}') RETURNING id`,
    )) as [{ id: string }];
    applicationId = app;
    const [{ id: drv }] = (await db.query(
      `INSERT INTO drivers (first_name, last_name, email, phone)
       VALUES ('Dana', 'Driver', 'dana@test.dev', '${DRIVER}') RETURNING id`,
    )) as [{ id: string }];
    driverId = drv;
  });

  afterAll(async () => {
    await db.destroy();
  });

  describe("sending", () => {
    it("dry_run saves the text as composed and never calls Quo", async () => {
      const sent = await service().send(
        SmsContactKind.applications,
        applicationId,
        "Hi Pat",
        adminId,
      );

      expect(quo.sent).toEqual([]);
      expect(sent).toMatchObject({
        status: "composed",
        mode: "dry_run",
        body: "Hi Pat",
        sentByEmail: "admin@test.dev",
      });
      const [stored] = await rows();
      expect(stored).toMatchObject({
        contactPhone: APPLICANT, // converted from "(312) 555-0111"
        quoMessageId: null,
      });
    });

    it("off refuses and stores nothing", async () => {
      await expect(
        service({ mode: "off" }).send(
          SmsContactKind.drivers,
          driverId,
          "Hi",
          adminId,
        ),
      ).rejects.toBeInstanceOf(ConflictException);
      expect(await rows()).toEqual([]);
    });

    it("live sends through Quo and stores Quo's id and status", async () => {
      const sent = await service({ mode: "live" }).send(
        SmsContactKind.drivers,
        driverId,
        "Rent is due",
        adminId,
      );

      expect(quo.sent).toEqual([{ to: DRIVER, text: "Rent is due" }]);
      expect(sent).toMatchObject({ status: "queued", mode: "live" });
      expect((await rows())[0].quoMessageId).toBe("ACsent1");
    });

    it("live: a refusal is saved as failed with Quo's reason and the request fails", async () => {
      quo.failSend = new QuoApiError(402, "Subscription expired");

      await expect(
        service({ mode: "live" }).send(
          SmsContactKind.drivers,
          driverId,
          "Hi",
          adminId,
        ),
      ).rejects.toBeInstanceOf(BadGatewayException);

      const [failed] = await rows();
      expect(failed).toMatchObject({ status: "failed", quoMessageId: null });
      expect(failed.error).toContain("Subscription expired");
    });
  });

  describe("webhook", () => {
    it("stores a text from a known contact once, however often Quo delivers it", async () => {
      const event = webhook("message.received", {
        media: [{ url: "https://media.example/a.jpg", type: "image/jpeg" }],
      });

      expect(await service().applyWebhookEvent(event)).toContain("stored");
      expect(await service().applyWebhookEvent(event)).toContain("updated");

      const stored = await rows();
      expect(stored).toHaveLength(1);
      expect(stored[0]).toMatchObject({
        direction: "inbound",
        status: "received",
        contactPhone: APPLICANT,
        body: "Hello",
      });
      expect(stored[0].attachments).toHaveLength(1);
      expect(stored[0].attachments![0]).toMatchObject({
        status: "pending",
        contentType: "image/jpeg",
      });
    });

    it("status only moves forward, whatever order the events arrive in", async () => {
      const outgoing = { direction: "outgoing" };
      const context = {
        senderIdentifier: "+13125845595",
        recipientIdentifiers: [DRIVER],
      };
      const delivered = webhook(
        "message.delivered",
        { ...outgoing, status: "delivered" },
        context,
      );
      const late = webhook(
        "message.delivered",
        { ...outgoing, status: "sent" },
        context,
      );

      await service().applyWebhookEvent(delivered);
      await service().applyWebhookEvent(late);

      expect((await rows())[0].status).toBe(SmsStatus.delivered);
    });

    it("a failure event records Quo's reason", async () => {
      await service().applyWebhookEvent(
        webhook(
          "message.failed",
          { direction: "outgoing", status: "failed", errorCode: "30007" },
          { senderIdentifier: "+13125845595", recipientIdentifiers: [DRIVER] },
        ),
      );

      const [failed] = await rows();
      expect(failed.status).toBe("failed");
      expect(failed.error).toContain("30007");
    });

    it("skips unknown contacts, other numbers and group texts", async () => {
      const unknown = webhook(
        "message.received",
        {},
        { senderIdentifier: STRANGER },
      );
      const otherNumber = webhook(
        "message.received",
        {},
        { phoneNumberId: "PNother" },
      );
      const group = webhook(
        "message.received",
        {},
        { recipientIdentifiers: ["+13125845595", "+13125845596"] },
      );

      expect(await service().applyWebhookEvent(unknown)).toContain(
        "not an application or a driver",
      );
      expect(await service().applyWebhookEvent(otherNumber)).toContain(
        "other Quo number",
      );
      expect(await service().applyWebhookEvent(group)).toContain("group");
      expect(
        await service({ phoneNumberId: null }).applyWebhookEvent(
          webhook("message.received", {}),
        ),
      ).toContain("QUO_PHONE_NUMBER_ID is not set");
      expect(await rows()).toEqual([]);
    });
  });

  describe("sync", () => {
    it("brings in texts sent from the Quo app and adds nothing twice", async () => {
      quo.history = [
        quoMessage({ id: "AC2", text: "Thanks!" }),
        quoMessage({
          id: "AC1",
          direction: "outgoing",
          from: "+13125845595",
          to: [APPLICANT],
          status: "delivered",
          text: "Sent from the Quo app",
          createdAt: new Date("2026-10-14T14:00:00Z"),
        }),
      ];

      const first = await service().syncConversation(
        SmsContactKind.applications,
        applicationId,
      );
      const second = await service().syncConversation(
        SmsContactKind.applications,
        applicationId,
      );

      expect(first).toEqual({ fetched: 2, added: 2 });
      expect(second).toEqual({ fetched: 2, added: 0 });
      expect((await rows()).map((m) => m.body)).toEqual([
        "Sent from the Quo app",
        "Thanks!",
      ]);
      // The first sync reads everything; the second only what is newer (minus a safety overlap).
      expect(quo.historyCalls[0].options?.createdAfter).toBeUndefined();
      expect(quo.historyCalls[1].options?.createdAfter).toEqual(
        new Date("2026-10-14T14:55:00Z"),
      );
    });

    it("explains itself when Quo is not connected", async () => {
      await expect(
        service({ quo: null }).syncConversation(
          SmsContactKind.drivers,
          driverId,
        ),
      ).rejects.toThrow("Quo is not connected");
    });
  });

  describe("reading", () => {
    it("lists newest first in pages that follow each other without gaps", async () => {
      for (let i = 1; i <= 5; i++) {
        await service().storeQuoMessage(
          quoMessage({
            id: `AC${i}`,
            text: `m${i}`,
            createdAt: new Date(`2026-10-14T15:0${i}:00Z`),
          }),
          APPLICANT,
          null,
        );
      }

      const first = await service().listMessages(
        SmsContactKind.applications,
        applicationId,
        2,
        undefined,
      );
      const second = await service().listMessages(
        SmsContactKind.applications,
        applicationId,
        2,
        first.nextCursor!,
      );
      const third = await service().listMessages(
        SmsContactKind.applications,
        applicationId,
        2,
        second.nextCursor!,
      );

      expect(first.items.map((m) => m.body)).toEqual(["m5", "m4"]);
      expect(second.items.map((m) => m.body)).toEqual(["m3", "m2"]);
      expect(third.items.map((m) => m.body)).toEqual(["m1"]);
      expect(third.nextCursor).toBeNull();
    });

    it("lists only this contact's files", async () => {
      await service().storeQuoMessage(
        quoMessage({
          media: [
            { url: "https://media.example/doc.pdf", type: "application/pdf" },
          ],
        }),
        APPLICANT,
        null,
      );
      await service().storeQuoMessage(
        quoMessage({
          id: "AC9",
          from: DRIVER,
          media: [
            { url: "https://media.example/other.jpg", type: "image/jpeg" },
          ],
        }),
        DRIVER,
        null,
      );

      const files = await service().listFiles(
        SmsContactKind.applications,
        applicationId,
        1,
        20,
      );

      expect(files.total).toBe(1);
      expect(files.items[0]).toMatchObject({
        contentType: "application/pdf",
        direction: "inbound",
        url: null, // not copied into the bucket yet
      });
      expect(await db.getRepository(SmsAttachment).count()).toBe(2);
    });
  });
});
