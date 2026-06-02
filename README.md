# Arken Tech Mail Tool

NoBounce is a bulk and single email verification dashboard for Arken Tech Solutions. The frontend never calls Reacher directly. All verification requests go through the backend, which handles validation, rate limiting, logging, queueing, and the connection to the self-hosted Reacher API.

## Stack

- Frontend: React, Vite, Tailwind CSS
- Backend: Node.js, TypeScript, Fastify, Prisma, PostgreSQL, Zod
- Queue: Redis, BullMQ
- Worker: Node.js worker process
- Reverse proxy: Caddy on Hostinger VPS
- Reacher: `https://verify.arkentechsolutions.com/v1/check_email`

## Upload Rules

Bulk uploads support `.csv` and `.xlsx` files only.

The file must contain exactly one column named:

```csv
emails
```

Rules enforced by both frontend preview and backend validation:

- no extra columns
- no column mapping
- no auto-detection
- no empty email cells
- only emails from the `emails` column are verified
- duplicates are recorded and exported, but only the first unique email is sent to Reacher

## Monorepo Layout

```text
apps/frontend   React dashboard
apps/backend    Fastify API
apps/worker     BullMQ verification worker
packages/shared Shared validation, status types, Reacher response normalization
deploy          Docker and Caddy examples
```

## Local Development

Start PostgreSQL and Redis first, then:

```bash
npm install
cp apps/backend/.env.example apps/backend/.env
cp apps/worker/.env.example apps/worker/.env
cp apps/frontend/.env.example apps/frontend/.env
npm run prisma:generate
npm run prisma:migrate
npm run dev:backend
npm run dev:worker
npm run dev:frontend
```

Frontend local URL:

```text
http://localhost:5173
```

Backend local URL:

```text
http://localhost:4000
```

## API Endpoints

```text
GET  /api/stats
POST /api/verify/single
POST /api/bulk/jobs
GET  /api/bulk/jobs
GET  /api/bulk/jobs/:jobId
GET  /api/bulk/jobs/:jobId/results
GET  /api/bulk/jobs/:jobId/download
POST /api/bulk/jobs/:jobId/cancel
```

Download filters:

```text
all
valid
invalid
unknown_risky
```

Result filters:

```text
all
valid
invalid
risky
unknown
disposable
duplicates
```

## Hostinger VPS Deployment

Build and start services:

```bash
docker compose up -d --build
```

Run Prisma migration against the production database:

```bash
docker compose exec backend npx prisma migrate deploy --schema apps/backend/prisma/schema.prisma
```

Caddy example:

```caddy
nobounce.arkentechsolutions.com {
  reverse_proxy 127.0.0.1:9100
}

nobounce-api.arkentechsolutions.com {
  reverse_proxy 127.0.0.1:4000
}
```

Set frontend build variable:

```env
VITE_API_BASE_URL=https://nobounce-api.arkentechsolutions.com
```

Set backend/worker variables:

```env
DATABASE_URL=postgresql://...
REDIS_URL=redis://redis:6379
REACHER_API_URL=https://verify.arkentechsolutions.com/v1/check_email
REACHER_API_TOKEN=
CORS_ORIGIN=https://nobounce.arkentechsolutions.com
```

## Operational Defaults

- Worker concurrency: `3`
- Worker rate limit: `90` checks per minute
- Queue retry attempts: `2`
- Upload limit: `10 MB`
- Upload row limit: `100,000`
- XLSX XML entry limit: `20 MB`
- Backend rate limit: `120` requests per minute
