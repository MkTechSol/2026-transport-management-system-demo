# ADR 0001 — Stack and database

**Status:** accepted · **Context:** one unified, auditable system; mobile app later; hundreds–thousands of users; finance data must be correct.

**Decision:** TypeScript end to end (Node 22 + Express, React + Vite), **PostgreSQL 16**, SQL migrations applied at start, raw SQL through a thin helper over Sequelize's connection pool, zod validation, pino logging, JWT (15 min) + rotating refresh tokens.

**Why:** relational integrity (foreign keys, partial unique indexes, CHECK and deferred constraint triggers) is the main defence for money and stock; PostgreSQL gives row locks, advisory locks and rich indexing. Raw SQL keeps reports readable and fast; the ORM is used only for pooling. One language across API, web and shared rules (permissions, trip state machine) removes drift.

**Consequences:** a mobile app can reuse the REST API and shared package unchanged; the schema, not the app, guarantees invariants; migrations must be additive.
