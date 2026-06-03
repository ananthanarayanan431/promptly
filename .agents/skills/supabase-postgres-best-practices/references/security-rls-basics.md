---
title: Enable Row Level Security for Multi-Tenant Data
impact: CRITICAL
impactDescription: Database-enforced tenant isolation, prevent data leaks
tags: rls, row-level-security, multi-tenant, security
---

## Enable Row Level Security for Multi-Tenant Data

Row Level Security (RLS) enforces data access at the database level, ensuring users only see their own data.

**Incorrect (application-level filtering only):**

```sql
-- Relying only on application to filter
select * from orders where user_id = $current_user_id;

-- Bug or bypass means all data is exposed!
select * from orders;  -- Returns ALL orders
```

**Correct (database-enforced RLS):**

```sql
-- Enable RLS on the table
alter table orders enable row level security;

-- Create policy for users to see only their orders
create policy orders_user_policy on orders
  for all
  using (user_id = current_setting('app.current_user_id')::bigint);

-- Force RLS even for table owners
alter table orders force row level security;

-- Set user context and query
set app.current_user_id = '123';
select * from orders;  -- Only returns orders for user 123
```

**Choose the right identity source:**

- **Supabase projects:** use `auth.uid()` — reads the user ID directly from the verified JWT, no session variable needed.
- **Non-Supabase Postgres:** use `current_setting('app.current_user_id')::bigint` — you must `SET app.current_user_id = '<id>'` at the start of each connection/transaction.

```sql
-- Supabase: JWT-based (preferred for Supabase projects)
create policy orders_user_policy on orders
  for all
  to authenticated
  using (user_id = auth.uid());

-- Non-Supabase: session-variable based
create policy orders_user_policy on orders
  for all
  using (user_id = current_setting('app.current_user_id')::bigint);
```

Reference: [Row Level Security](https://supabase.com/docs/guides/database/postgres/row-level-security)
