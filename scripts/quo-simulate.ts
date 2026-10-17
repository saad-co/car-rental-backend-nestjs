/**
 * Developer tool: pretends to be Quo and delivers a signed "text received" webhook to your LOCAL API, so you
 * can test incoming texts and files without a public URL. Sends nothing to Quo and changes nothing there.
 * NOT part of the API.
 *
 *   npm run quo:simulate -- <phone> "<text>" [mediaUrl]
 *   npm run quo:simulate -- +13125550123 "Here is my insurance" https://example.com/photo.jpg
 *
 * `<phone>` must belong to an application or a driver (otherwise the API skips it on purpose, D51).
 * Needs `QUO_WEBHOOK_SECRET` (starting `whsec_`, any base64 text works locally) and `QUO_PHONE_NUMBER_ID`
 * in your `.env`, and the API running (`npm run start:dev`). Set `API_URL` to aim at another address.
 */
import { createHmac, randomUUID } from "node:crypto";

const [phone, text, mediaUrl] = process.argv.slice(2);
if (!phone || !text)
  throw new Error('Usage: npm run quo:simulate -- <phone> "<text>" [mediaUrl]');

const secret = process.env.QUO_WEBHOOK_SECRET;
if (!secret?.startsWith("whsec_"))
  throw new Error(
    "QUO_WEBHOOK_SECRET must be set in .env and start with whsec_ (any base64 text after it works locally).",
  );
const phoneNumberId = process.env.QUO_PHONE_NUMBER_ID ?? "PNsimulated";
const apiUrl =
  process.env.API_URL ?? `http://localhost:${process.env.PORT ?? 5000}`;

const now = new Date();
const body = JSON.stringify({
  id: `EV${randomUUID()}`,
  type: "message.received",
  apiVersion: "2026-03-30",
  createdAt: now.toISOString(),
  data: {
    resource: {
      id: `ACsim${randomUUID().replaceAll("-", "").slice(0, 20)}`,
      direction: "incoming",
      text,
      media: mediaUrl
        ? [
            {
              url: mediaUrl,
              type: mediaUrl.endsWith(".pdf")
                ? "application/pdf"
                : mediaUrl.endsWith(".png")
                  ? "image/png"
                  : "image/jpeg",
            },
          ]
        : [],
      status: "received",
      errorCode: null,
      createdAt: now.toISOString(),
    },
    context: {
      phoneNumberId,
      senderIdentifier: phone,
      recipientIdentifiers: ["+13125845595"],
    },
  },
});

// Signed exactly as Quo does: HMAC-SHA256 over "<webhook-id>.<webhook-timestamp>.<raw body>", base64.
const webhookId = `msg_${randomUUID()}`;
const timestamp = String(Math.floor(now.getTime() / 1000));
const signature = createHmac(
  "sha256",
  Buffer.from(secret.replace(/^whsec_/, ""), "base64"),
)
  .update(`${webhookId}.${timestamp}.${body}`)
  .digest("base64");

const response = await fetch(`${apiUrl}/webhooks/quo`, {
  method: "POST",
  headers: {
    "Content-Type": "application/json",
    "webhook-id": webhookId,
    "webhook-timestamp": timestamp,
    "webhook-signature": `v1,${signature}`,
  },
  body,
});
console.log(`${response.status} ${await response.text()}`);
