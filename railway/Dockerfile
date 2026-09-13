# ============================================================
# Railway — Bandar80 (api/master + dashboard + Playwright opsional)
# Bangun dari repo root ANJAYSLEBEW. Di Railway:
#   Service source = GitHub ANJAYSLEBEW
#   Root Directory  = (KOSONG)
#   Build Command   = (otomatis dari Dockerfile ini)
#   Start Command   = (dari CMD)
# Volumes: mount volume ke /data bila RAILWAY_PLAYWRIGHT=true
#          (tempat simpan sesi login bonus bot).
# ============================================================
FROM node:22-slim

WORKDIR /app

# dep server (playwright OPSIONAL: diinstal bila ARG PLAYWRIGHT=true)
COPY railway/package.json railway/package-lock.json* ./
RUN npm install --omit=dev

# router serverless + dashboard
COPY api/master ./api/master
COPY railway/server.js ./server.js
COPY railway/bonus-bot.js ./bonus-bot.js
COPY web ./web

# browser chromium (big image) — gates on build ARG
ARG PLAYWRIGHT=false
RUN if [ "$PLAYWRIGHT" = "true" ]; then \
      npx playwright install --with-deps chromium; \
    fi

ENV NODE_ENV=production
ENV PORT=3000
EXPOSE 3000
CMD ["node", "server.js"]