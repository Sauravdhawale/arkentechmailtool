# Arken Tech Mail Tool

NoBounce is a bulk and single email verification dashboard for Arken Tech Solutions. The frontend never calls Reacher directly. All verification requests go through the backend, which handles validation, rate limiting, logging, queueing, and the connection to the self-hosted Reacher API.

## Stack

- Frontend: React, Vite, Tailwind CSS
- Backend: Node.js, TypeScript, Fastify, Prisma, PostgreSQL, Zod
- Queue: Redis, BullMQ
- Worker: Node.js worker process
- Reverse proxy: Caddy on Hostinger VPS
- Reacher single verification: `https://verify.arkentechsolutions.com/v1/check_email`
- Reacher bulk verification: `https://verify.arkentechsolutions.com/v1/bulk`

## Upload Rules

Bulk uploads support `.csv` and `.xlsx` files only.

CSV uploads may use an `emails` header, one email per line, or a comma-separated email list:

```csv
emails
john@example.com
jane@example.com
```

```csv
john@example.com,jane@example.com
```

XLSX uploads should contain one populated email column. The column may include an optional `emails` header. Blank rows and unused worksheet cells are ignored.

Rules enforced by both frontend preview and backend validation:

- no extra populated XLSX columns
- no column mapping
- only values from the email list/column are verified
- duplicates are recorded and exported, but only the first unique email is sent to Reacher
- uploaded lists are submitted to Reacher's `/v1/bulk` job API, then the worker polls Reacher for progress and results
- uploaded lists require Reacher bulk worker mode; list jobs do not fall back to `/v1/check_email`

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
REACHER_BULK_API_URL=https://verify.arkentechsolutions.com/v1/bulk
REACHER_API_TOKEN=
CORS_ORIGIN=https://nobounce.arkentechsolutions.com
```

## Reacher Bulk Requirement

NoBounce bulk lists use Reacher's `/v1/bulk` API only. Your self-hosted Reacher
deployment must have worker mode, RabbitMQ, and Postgres storage configured.

Minimum Reacher-side variables:

```env
RCH__WORKER__ENABLE=true
RCH__WORKER__RABBITMQ__URL=amqp://user:password@rabbitmq:5672
RCH__WORKER__RABBITMQ__CONCURRENCY=10
RCH__STORAGE__0__POSTGRES__DB_URL=postgresql://user:password@postgres:5432/reacher
```

Scale Reacher throughput by increasing `RCH__WORKER__RABBITMQ__CONCURRENCY`
and/or the number of Reacher worker containers. Scale NoBounce throughput by
increasing `WORKER_CONCURRENCY` or by running more NoBounce worker replicas.

## Operational Defaults

- Worker concurrency: `3` bulk jobs at a time
- Worker rate limit: `30` bulk job starts per minute
- Bulk result page size: `1000`
- Queue retry attempts: `2`
- Upload limit: `10 MB`
- Upload row limit: `100,000`
- XLSX XML entry limit: `256 MB`
- Backend rate limit: `120` requests per minute
