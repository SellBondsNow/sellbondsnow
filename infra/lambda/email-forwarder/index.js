// sellbonds.now email forwarder.
//
// Triggered by an SES receipt rule (Lambda action) after the matching S3 action
// has stored the raw message at s3://$BUCKET/$PREFIX<messageId>. This function
// reads that raw MIME, parses it, and re-sends a clean copy to $FORWARD_TO via
// Resend (so we sidestep the SES sending sandbox). Reply-To is set to the
// original sender, so replying in your inbox reaches the real person.
//
// Env:
//   BUCKET          S3 bucket holding raw inbound emails
//   PREFIX          key prefix the SES S3 action writes under (e.g. "inbound/")
//   RESEND_API_KEY  Resend API key
//   FROM_ADDRESS    verified Resend sender, e.g. "sellbonds.now <forward@sellbonds.now>"
//   FORWARD_TO      destination inbox

const { S3Client, GetObjectCommand } = require('@aws-sdk/client-s3');
const { simpleParser } = require('mailparser');

const s3 = new S3Client({});
const BUCKET = process.env.BUCKET;
const PREFIX = process.env.PREFIX || 'inbound/';
const RESEND_API_KEY = process.env.RESEND_API_KEY;
const FROM_ADDRESS = process.env.FROM_ADDRESS;
const FORWARD_TO = process.env.FORWARD_TO;

async function streamToBuffer(stream) {
  const chunks = [];
  for await (const chunk of stream) chunks.push(chunk);
  return Buffer.concat(chunks);
}

exports.handler = async (event) => {
  const records = event.Records || [];
  for (const record of records) {
    const mail = record.ses && record.ses.mail;
    if (!mail) {
      console.warn('record without ses.mail, skipping');
      continue;
    }
    const messageId = mail.messageId;
    const key = `${PREFIX}${messageId}`;

    const obj = await s3.send(new GetObjectCommand({ Bucket: BUCKET, Key: key }));
    const raw = await streamToBuffer(obj.Body);
    const parsed = await simpleParser(raw);

    const origFrom = parsed.from && parsed.from.text ? parsed.from.text : 'unknown sender';
    const origTo = (mail.destination || []).join(', ');
    const replyTo =
      parsed.from && parsed.from.value && parsed.from.value[0] && parsed.from.value[0].address
        ? parsed.from.value[0].address
        : undefined;
    const subject = parsed.subject || '(no subject)';

    const footer =
      `\n\n— — —\nForwarded by sellbonds.now\nOriginal To: ${origTo}\nOriginal From: ${origFrom}`;

    const payload = {
      from: FROM_ADDRESS,
      to: [FORWARD_TO],
      subject,
      text: (parsed.text || '(no plain-text body)') + footer,
    };
    if (replyTo) payload.reply_to = replyTo;
    if (parsed.html) payload.html = parsed.html;
    if (parsed.attachments && parsed.attachments.length) {
      payload.attachments = parsed.attachments
        .filter((a) => a.content)
        .map((a) => ({
          filename: a.filename || 'attachment',
          content: a.content.toString('base64'),
        }));
    }

    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${RESEND_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
    });

    if (!res.ok) {
      const body = await res.text();
      console.error('Resend send failed', res.status, body);
      throw new Error(`Resend send failed: ${res.status}`);
    }
    const out = await res.json();
    console.log('forwarded', messageId, '->', FORWARD_TO, 'resend id', out.id);
  }
  return { ok: true, count: records.length };
};
