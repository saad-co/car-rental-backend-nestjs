import { Logger } from "@nestjs/common";
import { ImapFlow } from "imapflow";
import type {
  MailboxMessage,
  MailboxReader,
  MailboxSession,
} from "./mailbox-reader.js";

export interface ImapMailboxOptions {
  host: string;
  port: number;
  user: string;
  password: string;
}

/**
 * `MailboxReader` over IMAP with imapflow, for `gonzobilling@gmail.com` (D38). Uses an app password,
 * TLS, and opens INBOX read-only, as `scripts/imap-peek.ts` proved.
 */
export class ImapMailboxReader implements MailboxReader {
  private readonly logger = new Logger(ImapMailboxReader.name);
  readonly mailbox: string;

  constructor(private readonly options: ImapMailboxOptions) {
    this.mailbox = options.user.trim().toLowerCase();
  }

  async withInbox<T>(
    work: (session: MailboxSession) => Promise<T>,
  ): Promise<T> {
    const client = new ImapFlow({
      host: this.options.host,
      port: this.options.port,
      secure: true,
      auth: { user: this.options.user, pass: this.options.password },
      logger: false,
    });
    // imapflow reports a dropped connection as an "error" event. Without a listener Node would crash
    // the whole API; with it, the error is logged and the current call fails, so the run stops visibly.
    client.on("error", (error: Error) => {
      this.logger.error(`IMAP connection error: ${error.message}`);
    });

    await client.connect();
    try {
      const lock = await client.getMailboxLock("INBOX", { readOnly: true });
      try {
        const mailbox = client.mailbox;
        if (!mailbox) throw new Error("INBOX did not open.");
        return await work(new ImapSession(client, Number(mailbox.uidValidity)));
      } finally {
        lock.release();
      }
    } finally {
      await client.logout();
    }
  }
}

class ImapSession implements MailboxSession {
  constructor(
    private readonly client: ImapFlow,
    readonly uidValidity: number,
  ) {}

  async newUids(
    afterUid: number,
    senders: readonly string[],
  ): Promise<number[]> {
    const found = await this.client.search(
      { uid: `${afterUid + 1}:*`, or: senders.map((from) => ({ from })) },
      { uid: true },
    );
    // IMAP quirk: "N:*" always includes the newest message, even when its UID is below N. Filtering
    // keeps an already-processed email from coming back on every run.
    return (found || []).filter((uid) => uid > afterUid).sort((a, b) => a - b);
  }

  async fetch(uid: number): Promise<MailboxMessage> {
    const message = await this.client.fetchOne(
      String(uid),
      { source: true, internalDate: true },
      { uid: true },
    );
    if (!message || !message.source) {
      throw new Error(`No message with UID ${uid} in INBOX.`);
    }
    if (!message.emailId) {
      // Dedup depends on it (D40). Gmail always sends it; any other server is not supported.
      throw new Error(`UID ${uid} has no Gmail message id (X-GM-MSGID).`);
    }
    if (!message.internalDate) {
      throw new Error(`UID ${uid} has no internal date.`);
    }
    return {
      uid,
      gmailMessageId: message.emailId,
      receivedAt: new Date(message.internalDate),
      raw: message.source,
    };
  }
}
