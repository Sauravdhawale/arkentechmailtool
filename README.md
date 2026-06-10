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
- fast filters mark invalid syntax, known malformed addresses, disposable domains, and domains without MX records before Reacher bulk submission
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
REACHER_REQUEST_TIMEOUT_MS=35000
CORS_ORIGIN=https://nobounce.arkentechsolutions.com
```

Set worker prefilter variables:

```env
PREFILTER_DNS_CONCURRENCY=25
PREFILTER_MX_TIMEOUT_MS=2500
DISPOSABLE_EMAIL_DOMAINS=custom-temp-domain.com,another-temp-domain.net
```

## Bulk Verification Flow

Bulk verification uses two stages to reduce Reacher SMTP work:

1. Fast filtering in the NoBounce worker:
   - invalid syntax
   - known malformed addresses
   - disposable email domains
   - domains that definitely have no MX records

2. Reacher bulk SMTP verification:
   - only unique rows that pass Stage 1 are submitted to `REACHER_BULK_API_URL`

Fast-filtered rows are saved as processed `invalid` results with a reason such
as `Invalid email syntax`, `Disposable email domain`, or `Domain has no MX
records`. They appear in job details and result downloads, but they do not call
Reacher. MX lookups are cached per domain for each job, so a list with many
emails on the same domain only performs one DNS MX lookup for that domain.

DNS timeouts or temporary resolver errors are not treated as invalid because
that could create false negatives. Those emails are allowed through to Reacher.

## Reacher Bulk Requirement

NoBounce bulk lists use Reacher's `/v1/bulk` API only. Your self-hosted Reacher
deployment must have worker mode, RabbitMQ, and Postgres storage configured.

NoBounce still uses Redis/BullMQ for app-level upload orchestration. RabbitMQ is
not a replacement for Redis in this project; it is required separately by
Reacher's own `/v1/bulk` architecture.

Minimum Reacher-side variables:

```env
RCH__WORKER__ENABLE=true
RCH__WORKER__RABBITMQ__URL=amqp://user:password@rabbitmq:5672
RCH__WORKER__RABBITMQ__CONCURRENCY=10
RCH__STORAGE__0__POSTGRES__DB_URL=postgresql://user:password@postgres:5432/reacher
RCH__STORAGE__POSTGRES__DB_URL=postgresql://user:password@postgres:5432/reacher
RCH__HELLO_NAME=verify.arkentechsolutions.com
RCH__FROM_EMAIL=verify@arkentechsolutions.com
RCH__SMTP_TIMEOUT=30
RCH__THROTTLE__MAX_REQUESTS_PER_MINUTE=120
RCH__THROTTLE__MAX_REQUESTS_PER_DAY=50000
```

Scale Reacher throughput by increasing `RCH__WORKER__RABBITMQ__CONCURRENCY`
and/or the number of Reacher worker containers. Scale NoBounce throughput by
increasing `WORKER_CONCURRENCY` or by running more NoBounce worker replicas.

An example Reacher Docker Compose stack is available at:

```text
deploy/reacher-bulk-compose.example.yml
```

Bring up the Reacher bulk stack:

```bash
cd /opt/reacher
docker compose up -d
docker compose up -d --scale reacher-worker=3
```

The example stack intentionally runs two Reacher API containers:

- `single-api` on `127.0.0.1:8081` for `/v1/check_email`
- `bulk-api` on `127.0.0.1:8080` for `/v1/bulk`

Both containers listen on port `8080` inside Docker. The host mapping is the
important part: `127.0.0.1:8081:8080` exposes the single API on VPS port `8081`,
and `127.0.0.1:8080:8080` exposes the bulk API on VPS port `8080`.

Route them separately in Caddy so manual checks do not wait behind bulk queue
pressure:

```caddy
verify.arkentechsolutions.com {
  header {
    Access-Control-Allow-Origin "https://nobounce.arkentechsolutions.com"
    Access-Control-Allow-Methods "GET, POST, OPTIONS"
    Access-Control-Allow-Headers "*"
    Vary "Origin"
  }

  @options {
    method OPTIONS
  }
  respond @options 204

  @single path /v1/check_email
  reverse_proxy @single 127.0.0.1:8081

  @bulk path /v1/bulk*
  reverse_proxy @bulk 127.0.0.1:8080

  reverse_proxy 127.0.0.1:8081
}
```

NoBounce calls Reacher from the backend and worker, so browser CORS headers are
not required for normal app usage. Keeping the restrictive CORS headers above is
safe if you also test Reacher directly from a browser; update the allowed origin
if your frontend domain changes.

For the bulk API container, `RCH__WORKER__ENABLE=true` is required so Reacher
enables its queue-backed bulk architecture. For the single API container,
`RCH__WORKER__ENABLE=false` keeps `/v1/check_email` on a separate, immediate
verification path. Dedicated `reacher-worker` containers consume RabbitMQ bulk
tasks; this is where most verification concurrency should live.

Use separate timeout and throttle values for the two lanes:

```env
REACHER_SINGLE_SMTP_TIMEOUT=20
REACHER_SINGLE_THROTTLE_MAX_REQUESTS_PER_MINUTE=60
REACHER_BULK_SMTP_TIMEOUT=30
REACHER_BULK_THROTTLE_MAX_REQUESTS_PER_MINUTE=120
REACHER_WORKER_THROTTLE_MAX_REQUESTS_PER_MINUTE=120
REACHER_WORKER_RABBITMQ_CONCURRENCY=5
```

For manual checks, keep `REACHER_REQUEST_TIMEOUT_MS` in NoBounce slightly above
`REACHER_SINGLE_SMTP_TIMEOUT`. The default is `35000` ms, so a slow SMTP check
returns as `unknown` instead of leaving the frontend stuck on "Verifying...".

## Operational Defaults

- Worker concurrency: `1` active bulk job at a time
- Worker rate limit: `30` bulk job starts per minute
- Bulk result page size: `1000`
- Single verification Reacher request timeout: `35` seconds
- Prefilter DNS concurrency: `25`
- Prefilter MX timeout: `2.5` seconds per domain
- Queue retry attempts: `2`
- Upload limit: `10 MB`
- Upload row limit: `100,000`
- XLSX XML entry limit: `256 MB`
- Backend rate limit: `120` requests per minute

## Reacher SMTP Network Checks

If Reacher returns many `unknown` results with SMTP errors such as
`Network unreachable (os error 101)` or SMTP timeout, the problem is usually
outside NoBounce. Reacher found MX records but could not open an SMTP
connection to the recipient mail server.

NoBounce stores the raw Reacher response and displays concrete SMTP errors when
Reacher provides them. If the table still shows `-`, Reacher did not return an
SMTP detail for that result; inspect the row's raw response in the database to
confirm what Reacher sent.

Check outbound SMTP from the VPS:

```bash
curl -sSf --verbose -k smtp://alt1.gmail-smtp-in.l.google.com:25 \
  --connect-timeout 10 \
  --ssl-reqd \
  --mail-from verify@arkentechsolutions.com \
  --mail-rcpt luckyv1432@gmail.com
```

If this fails or hangs, ask Hostinger to unblock outbound port `25`, enable a
working IPv6 route, disable broken IPv6 for the Reacher host, or configure a
SOCKS5 SMTP proxy for Reacher.
