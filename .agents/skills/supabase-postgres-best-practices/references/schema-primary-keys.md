---
title: Select Optimal Primary Key Strategy
impact: HIGH
impactDescription: Better index locality, reduced fragmentation
tags: primary-key, identity, uuid, serial, schema
---

## Select Optimal Primary Key Strategy

Primary key choice affects insert performance, index size, and replication
efficiency.

**Incorrect (problematic PK choices):**

```sql
-- identity is the SQL-standard approach
create table users (
  id serial primary key  -- Works, but IDENTITY is recommended
);

-- Random UUIDs (v4) cause index fragmentation
create table orders (
  id uuid default gen_random_uuid() primary key  -- UUIDv4 = random = scattered inserts
);
```

**Correct (optimal PK strategies):**

```sql
-- Use IDENTITY for sequential IDs (SQL-standard, best for most cases)
create table users (
  id bigint generated always as identity primary key
);

-- For distributed systems needing UUIDs, use UUIDv7 (time-ordered)
-- Requires pg_uuidv7 extension: create extension pg_uuidv7;
create table orders (
  id uuid default uuid_generate_v7() primary key  -- Time-ordered, no fragmentation
);

-- Alternative: compact time-prefixed IDs (no extension, 32-char hex, sortable)
create table events (
  id text default (
    to_char(now() at time zone 'utc', 'YYYYMMDDHH24MISSMS') ||
    replace(gen_random_uuid()::text, '-', '')
  ) primary key
  -- Results in a ~50-char sortable string; use UUID/bigint if storage is a concern
);
```

Guidelines:

- Single database: `bigint identity` (sequential, 8 bytes, SQL-standard)
- Distributed/exposed IDs: UUIDv7 (requires pg_uuidv7) or ULID (time-ordered, no
  fragmentation)
- `serial` works but `identity` is SQL-standard and preferred for new
  applications
- Avoid random UUIDs (v4) as primary keys on large tables (causes index
  fragmentation)

Reference:
[Identity Columns](https://www.postgresql.org/docs/current/sql-createtable.html#SQL-CREATETABLE-PARMS-GENERATED-IDENTITY)
