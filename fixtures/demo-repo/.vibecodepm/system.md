---
name: Kiteline system map
phase: architect
status: accepted
read_by: anyone changing this service, and `system-map reconcile` on every weekly pass
---

# Kiteline

This is the declared design, and it is deliberately out of date. It was written when the service
had four pieces and one metered call. The code has moved since, which is what the demo shows.

## 1. The map

- **API** (`src/api.mjs`) — takes the request, checks the caller, answers it.
- **Store** (`store/db.mjs`) — the rows, in a hosted Postgres.
- **Notifier** (`notify/slack.mjs`) — tells a human when a lead lands.
- **Worker** (`worker/run.py`) — the slow half, on a nightly clock.
- **Ledger** (`ledger/`) — the double-entry record. Planned, not built.
- API → Store, on every write.

## 2. Where state lives

Leads live in the hosted Postgres behind `@supabase/supabase-js`. Nothing else is durable. The
backup is whatever the vendor does by default, and nobody here has restored one.

## 3. Doors and keys

The only secret is `SK_EXAMPLE`, read from the environment and never committed. `PORT` is
configuration. Every write goes through the API, where the caller is checked before anything
reaches the store, and the browser cannot reach around it.

## 4. The bill

`stripe` is the only thing that charges per use, and the ceiling is the plan limit rather than
anything this code sets.

## 5. The 2am question

Failures are recorded by `pino` and pushed to us by `Sentry.captureException`, so a broken charge
reaches a person without anyone going to look.
