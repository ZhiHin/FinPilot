import { defineConfig } from "drizzle-kit";

// Migration SQL is generated from the schema (`npm run db:generate`) and applied by
// `npm run db:migrate` (scripts/migrate.ts). No live database credentials are needed here.
export default defineConfig({
  dialect: "postgresql",
  schema: "./src/server/db/schema/index.ts",
  out: "./src/server/db/migrations",
  strict: true,
  verbose: true,
});
