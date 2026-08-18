# FinPilot production image (Phase 10 — see docs/ops/deployment.md).
#
# Three stages:
#   build   — full install + `next build` (standalone output)
#   migrate — release-step image: runs `npm run db:migrate` and exits
#   runtime — default target: minimal Next.js standalone server, non-root
#
# No secrets are baked in; every value comes from the runtime environment.
# The standalone output mirrors the build context, so `.dockerignore` is what
# keeps `.env`, tests, and docs out of the image — keep the two in sync.
# `--ignore-scripts` is safe here: the only native dependency
# (@node-rs/argon2) ships prebuilt platform packages as optional deps and its
# .node binary is picked up by file tracing; the embedded PostgreSQL used in
# development is a devDependency that production never installs.

FROM node:22-bookworm-slim AS build
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1
COPY package.json package-lock.json ./
RUN npm ci --ignore-scripts
COPY . .
RUN npm run build

# Release step: apply pending migrations, then exit. Run this to completion
# before rolling the runtime image (forward-only migrations, ADR-017).
FROM build AS migrate
CMD ["npm", "run", "db:migrate"]

FROM node:22-bookworm-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    PORT=3000 \
    HOSTNAME=0.0.0.0
RUN groupadd --system --gid 1001 nodejs \
    && useradd --system --uid 1001 --gid nodejs finpilot

# The standalone server carries its own traced node_modules.
COPY --from=build --chown=finpilot:nodejs /app/.next/standalone ./
COPY --from=build --chown=finpilot:nodejs /app/.next/static ./.next/static
COPY --from=build --chown=finpilot:nodejs /app/public ./public

USER finpilot
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "server.js"]
