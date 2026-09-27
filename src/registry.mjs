// The known-SDK registry. docs/SPEC.md §3B.
//
// This table is the reason `derive` can answer questions 2, 4 and 5 at all. A component map knows
// that `src/pay.mjs` imports `stripe`. It does not know that the import is a meter, and the
// architect's question 4 is "which pieces charge per use". That judgement cannot be derived from
// the text, so it is written down once, here, with a note saying WHY, and cited at the import.
//
// Four categories:
//
//   metered         charges per use, so it belongs in question 4 and in a bad-month story
//   state           holds data that outlives the process, so it belongs in question 2
//   observability   records or pushes, so it belongs in question 5
//   queue           work handed to something else, which is an edge the import graph hides
//
// The list is deliberately short and deliberately incomplete. A registry miss is a NOTED absence,
// not a wrong answer: the import still appears in the edge list with its citation, it simply is
// not classified. Adding an entry is a one-line change plus the note that justifies it.

export const CATEGORIES = ['metered', 'observability', 'queue', 'state'];

export const REGISTRY = [
  // --- metered: the bill ------------------------------------------------------------------
  { module: 'stripe', categories: ['metered'], note: 'charges per API call and settles real money' },
  { module: 'openai', categories: ['metered'], note: 'billed per token, and a retry loop has no natural ceiling' },
  { module: '@anthropic-ai/sdk', categories: ['metered'], note: 'billed per token, same runaway shape' },
  { module: 'anthropic', categories: ['metered'], note: 'billed per token, same runaway shape' },
  { module: 'cohere-ai', categories: ['metered'], note: 'billed per token' },
  { module: 'replicate', categories: ['metered'], note: 'billed per prediction second' },
  { module: 'twilio', categories: ['metered'], note: 'billed per message and per minute' },
  { module: '@sendgrid/mail', categories: ['metered'], note: 'billed per send above the free tier' },
  { module: 'resend', categories: ['metered'], note: 'billed per send above the free tier' },
  { module: 'postmark', categories: ['metered'], note: 'billed per send' },
  { module: 'mailgun.js', categories: ['metered'], note: 'billed per send' },
  { module: 'elevenlabs', categories: ['metered'], note: 'billed per character of synthesis' },
  { module: 'deepgram', categories: ['metered'], note: 'billed per minute of audio' },
  { module: 'assemblyai', categories: ['metered'], note: 'billed per minute of audio' },
  { module: 'cloudinary', categories: ['metered'], note: 'billed per transformation and per byte served' },
  { module: 'algoliasearch', categories: ['metered'], note: 'billed per search and per record' },
  { module: '@pinecone-database/pinecone', categories: ['metered', 'state'], note: 'billed per hour of index, and holds the vectors' },
  { module: 'serpapi', categories: ['metered'], note: 'billed per search' },
  { module: 'firecrawl-js', categories: ['metered'], note: 'billed per page crawled' },
  { module: 'apify-client', categories: ['metered'], note: 'billed per actor compute unit' },
  { module: 'googleapis', categories: ['metered'], note: 'quota-limited per project, and several APIs bill per call' },
  { module: 'openai_client', categories: ['metered'], note: 'billed per token' },
  { module: 'boto3', categories: ['metered', 'state'], note: 'bills per request and per byte, and holds objects that outlive the process' },
  { module: '@aws-sdk', categories: ['metered', 'state'], note: 'bills per request and per byte, and holds objects that outlive the process' },
  { module: 'aws-sdk', categories: ['metered', 'state'], note: 'bills per request and per byte, and holds objects that outlive the process' },

  // --- state: where data lives -------------------------------------------------------------
  { module: '@supabase/supabase-js', categories: ['state'], note: 'the database, and the row-level rules live in it' },
  { module: 'supabase', categories: ['state'], note: 'the database, and the row-level rules live in it' },
  { module: '@prisma/client', categories: ['state'], note: 'the database, through a generated client' },
  { module: 'pg', categories: ['state'], note: 'Postgres, directly' },
  { module: 'postgres', categories: ['state'], note: 'Postgres, directly' },
  { module: 'psycopg2', categories: ['state'], note: 'Postgres, directly' },
  { module: 'asyncpg', categories: ['state'], note: 'Postgres, directly' },
  { module: 'sqlalchemy', categories: ['state'], note: 'a relational database, through an ORM' },
  { module: 'mysql2', categories: ['state'], note: 'MySQL, directly' },
  { module: 'mongodb', categories: ['state'], note: 'MongoDB, directly' },
  { module: 'mongoose', categories: ['state'], note: 'MongoDB, through an ODM' },
  { module: 'redis', categories: ['state'], note: 'Redis, which is state that is easy to assume is disposable' },
  { module: 'ioredis', categories: ['state'], note: 'Redis, which is state that is easy to assume is disposable' },
  { module: 'better-sqlite3', categories: ['state'], note: 'SQLite on local disk, which no backup usually covers' },
  { module: 'sqlite3', categories: ['state'], note: 'SQLite on local disk, which no backup usually covers' },
  { module: 'knex', categories: ['state'], note: 'a relational database, through a query builder' },
  { module: 'drizzle-orm', categories: ['state'], note: 'a relational database, through an ORM' },
  { module: '@vercel/kv', categories: ['state'], note: 'a hosted key-value store' },
  { module: '@vercel/postgres', categories: ['state'], note: 'a hosted Postgres' },
  { module: '@neondatabase/serverless', categories: ['state'], note: 'a hosted Postgres' },
  { module: 'chromadb', categories: ['state'], note: 'a vector store, which is state even when it is called a cache' },

  // --- observability: how you find out --------------------------------------------------------
  { module: 'pino', categories: ['observability'], note: 'structured logs, the recording half of the 2am question' },
  { module: 'winston', categories: ['observability'], note: 'structured logs, the recording half of the 2am question' },
  { module: 'bunyan', categories: ['observability'], note: 'structured logs' },
  { module: 'morgan', categories: ['observability'], note: 'request logs' },
  { module: 'loguru', categories: ['observability'], note: 'structured logs' },
  { module: 'structlog', categories: ['observability'], note: 'structured logs' },
  { module: '@sentry/node', categories: ['observability'], note: 'error capture that can push, which is the other half of the 2am question' },
  { module: '@sentry/nextjs', categories: ['observability'], note: 'error capture that can push' },
  { module: 'sentry_sdk', categories: ['observability'], note: 'error capture that can push' },
  { module: 'dd-trace', categories: ['observability'], note: 'traces and metrics, and alerting configured outside the repo' },
  { module: 'datadog', categories: ['observability'], note: 'traces and metrics, and alerting configured outside the repo' },
  { module: '@opentelemetry/api', categories: ['observability'], note: 'traces, whose destination is configured outside the repo' },
  { module: 'prom-client', categories: ['observability'], note: 'metrics for scraping, which alert only if something scrapes them' },

  // --- queues: edges the import graph hides -----------------------------------------------------
  { module: 'bullmq', categories: ['queue', 'state'], note: 'work handed to a worker through Redis, so the edge is invisible in the import graph' },
  { module: 'bull', categories: ['queue', 'state'], note: 'work handed to a worker through Redis' },
  { module: 'pg-boss', categories: ['queue', 'state'], note: 'work handed to a worker through Postgres' },
  { module: 'agenda', categories: ['queue', 'state'], note: 'work handed to a worker through MongoDB' },
  { module: 'kafkajs', categories: ['queue'], note: 'work handed to a consumer that may not be in this repo' },
  { module: 'amqplib', categories: ['queue'], note: 'work handed to a consumer that may not be in this repo' },
  { module: '@upstash/qstash', categories: ['queue'], note: 'work handed to an HTTP endpoint on a delay' },
  { module: 'celery', categories: ['queue'], note: 'work handed to a worker through a broker' },
  { module: 'rq', categories: ['queue', 'state'], note: 'work handed to a worker through Redis' },
];

const BY_MODULE = new Map(REGISTRY.map((entry) => [entry.module, entry]));

// A specifier is one of: the module itself, a subpath of it (`openai/resources`, common for JS
// SDKs), or a dotted submodule of it (`sqlalchemy.orm`, common for Python). A name that merely
// starts with the same letters (`stripe-webhook-helper`) is a different package, and matching it
// would put a client in the report that nobody depends on.
export function lookupModule(specifier) {
  if (typeof specifier !== 'string' || specifier === '') return null;
  if (specifier.startsWith('.') || specifier.startsWith('/')) return null;
  if (specifier.startsWith('node:')) return null;

  const exact = BY_MODULE.get(specifier);
  if (exact !== undefined) return exact;

  for (const entry of REGISTRY) {
    if (specifier.startsWith(`${entry.module}/`) || specifier.startsWith(`${entry.module}.`)) return entry;
  }

  return null;
}
