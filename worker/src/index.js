import { EmailMessage } from "cloudflare:email";
import { createMimeMessage } from "mimetext";

function arrayBufferToBase64(buffer) {
  const bytes = new Uint8Array(buffer);
  const chunks = [];
  const chunkSize = 8192;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    const chunk = bytes.subarray(i, i + chunkSize);
    chunks.push(String.fromCharCode.apply(null, chunk));
  }
  return btoa(chunks.join(""));
}

export default {
  async queue(batch, env) {
    for (const message of batch.messages) {
      try {
        const event = message.body;

        // Only notify on meta.json uploads (one notification per submission)
        if (!event.object?.key?.endsWith("/meta.json")) {
          message.ack();
          continue;
        }

        const key = event.object.key;
        // key looks like: submissions/20260520-044132-artist-name/meta.json
        const parts = key.split("/");
        const folder = parts.length >= 2 ? parts[parts.length - 2] : key;
        const prefix = key.replace(/\/meta\.json$/, "");

        // Fetch meta.json from R2 to get submission details
        let meta = null;
        try {
          const obj = await env.SUBMISSIONS_BUCKET.get(key);
          if (obj) {
            meta = await obj.json();
          }
        } catch (err) {
          console.error("Failed to read meta.json from R2:", err);
        }

        const title = meta?.title ?? "Unknown";
        const artist = meta?.artist ?? "Unknown";

        const subject = `New submission: "${title}" by ${artist}`;

        const bodyLines = [
          `New artwork submission received.`,
          ``,
        ];

        if (meta) {
          bodyLines.push(`Title: ${meta.title}`);
          bodyLines.push(`Artist: ${meta.artist}`);
          if (meta.statement) bodyLines.push(`Statement: ${meta.statement}`);
          if (meta.url) bodyLines.push(`Work URL: ${meta.url}`);
          if (meta.artistUrl) bodyLines.push(`Artist URL: ${meta.artistUrl}`);
          if (meta.email) bodyLines.push(`Email: ${meta.email}`);
          bodyLines.push(``);
        }

        bodyLines.push(`Folder: ${prefix}`);
        bodyLines.push(`Time: ${event.eventTime}`);
        bodyLines.push(``);
        bodyLines.push(`Files in R2 bucket "${event.bucket}":`);
        bodyLines.push(`  ${prefix}/meta.json`);
        bodyLines.push(`  ${prefix}/artwork.* (image)`);
        bodyLines.push(`  ${prefix}/submission.zip`);

        // Fetch submission.zip from R2
        let zipBase64 = null;
        let zipFilename = `${folder}.zip`;
        try {
          const zipObj = await env.SUBMISSIONS_BUCKET.get(`${prefix}/submission.zip`);
          if (zipObj) {
            const buf = await zipObj.arrayBuffer();
            zipBase64 = arrayBufferToBase64(buf);
          }
        } catch (err) {
          console.error("Failed to read submission.zip from R2:", err);
        }

        // Update sender and recipient to match your domain
        const senderAddr = env.SENDER_ADDRESS || "submissions@your-domain.com";
        const recipientAddr = env.RECIPIENT_ADDRESS || "you@example.com";

        const msg = createMimeMessage();
        msg.setSender({ name: "mussheum", addr: senderAddr });
        msg.setRecipient(recipientAddr);
        msg.setSubject(subject);
        msg.addMessage({
          contentType: "text/plain",
          data: bodyLines.join("\n"),
        });

        if (zipBase64) {
          msg.addAttachment({
            filename: zipFilename,
            contentType: "application/zip",
            data: zipBase64,
            encoding: "base64",
          });
        }

        const email = new EmailMessage(
          senderAddr,
          recipientAddr,
          msg.asRaw()
        );

        await env.SEND_EMAIL.send(email);
        message.ack();
      } catch (err) {
        console.error("Failed to process submission notification:", err);
        message.retry();
      }
    }
  },
};
