/** One email as the intake pipeline needs it from the mailbox. */
export interface MailboxMessage {
  /** The message's number in the mailbox. Only stable while UIDVALIDITY stays the same. */
  uid: number;
  /** Gmail's permanent id (`X-GM-MSGID`), as text. Never changes, even if UIDVALIDITY does (D40). */
  gmailMessageId: string;
  /** When our mail server received it (IMAP internal date). Not the sender's `Date` header. */
  receivedAt: Date;
  /** The whole email, bytes as stored. Input for `EmailProcessor`. */
  raw: Buffer;
}

/** What can be done while the inbox is open. Read-only: nothing is marked read, moved or deleted. */
export interface MailboxSession {
  /** UIDVALIDITY of the open inbox. If it changes, every UID in it has a new meaning. */
  readonly uidValidity: number;
  /** UIDs above `afterUid` whose sender contains one of `senders`, oldest first. */
  newUids(afterUid: number, senders: readonly string[]): Promise<number[]>;
  /** One message by UID. Throws if it is gone or the server gives no Gmail id. */
  fetch(uid: number): Promise<MailboxMessage>;
}

/**
 * The payment mailbox, behind an interface like `LlmJsonClient`: the intake service depends on this,
 * the real implementation is `ImapMailboxReader` (imapflow, Gmail), and tests use a fake.
 */
export interface MailboxReader {
  /** The mailbox address, lower-case, e.g. `gonzobilling@gmail.com`. Stored as `inbound_emails.mailbox`. */
  readonly mailbox: string;
  /**
   * Connects, opens the inbox read-only, runs `work`, and always closes the connection, even if
   * `work` throws. One connection per run (D40): nothing stays open between runs.
   */
  withInbox<T>(work: (session: MailboxSession) => Promise<T>): Promise<T>;
}
