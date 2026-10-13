/**
 * Developer tool: lists the phone numbers of the Quo workspace, to find the id (`PN...`) to put in
 * `QUO_PHONE_NUMBER_ID`. READ-ONLY: it sends no text and changes nothing in Quo. NOT part of the API.
 *
 *   npm run quo:numbers
 *
 * Needs `QUO_API_KEY` in your own `.env`.
 */
import { listQuoPhoneNumbers } from "../src/sms/quo/quo-http-client.js";

const apiKey = process.env.QUO_API_KEY;
if (!apiKey)
  throw new Error("QUO_API_KEY is missing. Add it to .env (see .env.example).");

const numbers = await listQuoPhoneNumbers({ apiKey });
console.log(`${numbers.length} number(s) in the Quo workspace:\n`);
for (const n of numbers) {
  console.log(
    `${n.id}   ${n.number}   "${n.name}"${
      n.usMessagingRestricted ? "   (US texting RESTRICTED)" : ""
    }`,
  );
}
console.log(
  "\nPut the id of the number drivers text into QUO_PHONE_NUMBER_ID.",
);
