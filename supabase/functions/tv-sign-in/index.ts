// The tv-sign-in Edge Function (#133): signing in on a TV from a device that's already signed in.
// The steps are in handler.ts; this file gives them the database (the functions of
// supabase/migrations/20261109000000_tv_sign_in.sql) and the admin API, both as the service role.
//
// Deploy: supabase functions deploy tv-sign-in --no-verify-jwt
// (the TV calls it before it has a session; the steps that need one check the user's token here).
import { createClient } from "npm:@supabase/supabase-js@2";
import { handleTvSignIn } from "./handler.ts";

const url = Deno.env.get("SUPABASE_URL") ?? "";
const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const admin = createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });

/** A database function's result, or its error message thrown (`rate_limited` stays recognisable). */
async function rpc<T>(name: string, args: Record<string, unknown>): Promise<T> {
  const { data, error } = await admin.rpc(name, args);
  if (error) throw new Error(error.message);
  return data as T;
}

Deno.serve((req) =>
  handleTvSignIn(req, {
    start: (codeHash, pollHash, device, ipHash) =>
      rpc<string>("tv_sign_in_start", { p_code_hash: codeHash, p_poll_hash: pollHash, p_device: device, p_ip_hash: ipHash }),
    look: (userId, codeHash) => rpc<string | null>("tv_sign_in_look", { p_user: userId, p_code_hash: codeHash }),
    answer: (userId, codeHash, approve) => rpc<boolean>("tv_sign_in_answer", { p_user: userId, p_code_hash: codeHash, p_approve: approve }),
    async claim(pollHash) {
      const rows = await rpc<{ state: string; user_id: string | null }[]>("tv_sign_in_claim", { p_poll_hash: pollHash });
      return { state: rows[0]?.state ?? "expired", userId: rows[0]?.user_id ?? null };
    },
    async userOf(accessToken) {
      const { data, error } = await admin.auth.getUser(accessToken);
      return error ? null : (data.user?.id ?? null);
    },
    // A magic-link token made without sending any email: the TV verifies it into a session of its own.
    async signInToken(userId) {
      const { data: found, error } = await admin.auth.admin.getUserById(userId);
      const email = found?.user?.email;
      if (error || !email) return null;
      const { data, error: linkError } = await admin.auth.admin.generateLink({ type: "magiclink", email });
      if (linkError) throw new Error(linkError.message);
      return data.properties?.hashed_token ?? null;
    },
    secret: serviceKey,
    random: (n) => crypto.getRandomValues(new Uint8Array(n)),
    now: Date.now,
  }),
);
