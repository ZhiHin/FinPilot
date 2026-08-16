import { getDb } from "../db/client";
import { createDevMailer } from "./mailer";
import { createAuthService, type AuthService } from "./service";

let singleton: AuthService | undefined;

export function getAuthService(): AuthService {
  if (!singleton) {
    const secret = process.env.AUTH_SECRET;
    if (!secret || secret === "replace-me-with-a-random-32-byte-secret") {
      throw new Error("AUTH_SECRET is not set — copy .env.example to .env and generate one.");
    }
    singleton = createAuthService({
      db: getDb(),
      secret,
      // Dev/file mailer until an email provider lands (post-V1). Password reset
      // links are written to DEV_MAIL_DIR (.dev-mail/) as JSON.
      mailer: createDevMailer(),
    });
  }
  return singleton;
}
