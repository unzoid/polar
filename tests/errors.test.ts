import { describe, expect, test } from "bun:test";
import type { PostgrestError } from "@supabase/supabase-js";
import { errorCode, errorMessage } from "../src/lib/errors";
import { AccountError } from "../src/lib/account/backend";
import { dbError } from "../src/lib/account/supabase";

describe("errors (critique L1)", () => {
  test("a command's error, an account's, a thrown Error and a bare string all read as their message", () => {
    expect(errorMessage({ code: "not_found", message: "No such download." })).toBe("No such download.");
    expect(errorMessage(new AccountError("network", "Can't reach the server."))).toBe("Can't reach the server.");
    expect(errorMessage(new Error("boom"))).toBe("boom");
    expect(errorMessage("mpv isn't running")).toBe("mpv isn't running");
    expect(errorMessage(undefined)).toBe("undefined");
  });

  test("codes come from commands and the account backend only", () => {
    expect(errorCode({ code: "source", message: "The source answered 404." })).toBe("source");
    expect(errorCode(new AccountError("profile_limit", "x"))).toBe("profile_limit");
    expect(errorCode("The source answered 404.")).toBeUndefined();
    expect(errorCode(new Error("x"))).toBeUndefined();
  });

  const pg = (code: string, message: string): PostgrestError => ({ code, message, details: "", hint: "", name: "PostgrestError" }) as PostgrestError;

  test("server errors map by their code, not their wording", () => {
    expect(dbError(pg("P0001", "profile_limit")).code).toBe("profile_limit");
    expect(dbError(pg("P0001", "playlist_limit")).code).toBe("playlist_limit");
    expect(dbError(pg("PGRST205", "Could not find the table"))).toMatchObject({ code: "not_set_up" });
    expect(dbError(pg("", "TypeError: Failed to fetch")).code).toBe("network");
    // A message that merely mentions a limit is not that limit.
    expect(dbError(pg("23505", "duplicate key near profile_limit")).code).toBe("unknown");
  });
});
