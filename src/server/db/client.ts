import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import { Pool } from "pg";

import * as schema from "./schema";

export type Db = NodePgDatabase<typeof schema>;

/** Builds a Db over an existing pool (tests inject their own). */
export function createDb(pool: Pool): Db {
  return drizzle(pool, { schema });
}

let singleton: Db | undefined;

/** The application database, connected via DATABASE_URL. */
export function getDb(): Db {
  if (!singleton) {
    const connectionString = process.env.DATABASE_URL;
    if (!connectionString) {
      throw new Error("DATABASE_URL is not set — copy .env.example to .env and adjust.");
    }
    singleton = createDb(new Pool({ connectionString, max: 10 }));
  }
  return singleton;
}
