import fs from "node:fs";
import path from "node:path";

import type { Mailer, OutgoingMail } from "./service";

/**
 * Development mailer: writes each outgoing mail as JSON into DEV_MAIL_DIR
 * (default .dev-mail/) and logs a notice. Real SMTP delivery is post-V1;
 * this keeps the reset flow fully real minus transport, and e2e tests read
 * the files to follow reset links.
 */
export function createDevMailer(dir?: string): Mailer {
  const mailDir = path.resolve(dir ?? process.env.DEV_MAIL_DIR ?? ".dev-mail");
  return {
    async send(mail: OutgoingMail): Promise<void> {
      fs.mkdirSync(mailDir, { recursive: true });
      const safeRecipient = mail.to.replace(/[^a-zA-Z0-9]+/g, "_");
      const payload = JSON.stringify({ ...mail, sentAt: new Date().toISOString() }, null, 2);
      fs.writeFileSync(path.join(mailDir, `${Date.now()}-${safeRecipient}.json`), payload);
      fs.writeFileSync(path.join(mailDir, "latest.json"), payload);
      console.log(`[dev-mailer] wrote mail for ${mail.to} to ${mailDir}`);
    },
  };
}
