// A Postgres (PGlite, in memory) with just enough of Supabase for the migrations: the roles,
// auth.users and auth.uid() read from the request's JWT claim, and the realtime table the
// watch-party policies name. Row-level security is enforced as on Supabase once `as(user)` has
// switched to the `authenticated` role.
import { PGlite } from "@electric-sql/pglite";
import { readFileSync, readdirSync } from "fs";
import { join } from "path";

export const SUPABASE = join(import.meta.dir, "../../supabase");

export const sqlFile = (path: string) => readFileSync(join(SUPABASE, path), "utf8");

/** Migration file names in the order Supabase applies them. */
export const migrations = () =>
  readdirSync(join(SUPABASE, "migrations"))
    .filter((f) => f.endsWith(".sql"))
    .sort();

export async function supabaseDb() {
  const db = new PGlite();
  await db.exec(`create role anon; create role authenticated; create schema auth;
create table auth.users (id uuid primary key, email text, created_at timestamptz not null default now());
create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
grant usage on schema auth to authenticated; grant execute on function auth.uid() to authenticated;
create schema realtime; create table realtime.messages (extension text); create function realtime.topic() returns text language sql as $$ select '' $$;`);
  return db;
}

export type Db = PGlite;

/** Acts as `user` from now on (null: back to the owner, which bypasses row-level security). */
export const as = (db: Db, user: string | null) =>
  db.exec(user ? `reset role; select set_config('request.jwt.claim.sub', '${user}', false); set role authenticated;` : `reset role`);

/** True when the statement is refused. */
export const fails = async (db: Db, sql: string) => {
  try {
    await db.exec(sql);
    return false;
  } catch {
    return true;
  }
};
