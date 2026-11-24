// Logins, through Better Auth (better-auth.com). An account is a Better Auth
// user: an email and password, or a guest (the anonymous plugin) that lives
// only in this browser's cookie until it is given an email and password. The
// game's own `players` row hangs off the account by `user_id`, and everything
// a player owns hangs off that row as before.
//
// Better Auth is built per request, because D1 is only reachable inside one.
// Its tables are auth_user, auth_session, auth_account and auth_verification
// (migrations/0060_better_auth.sql).
//
// The ?p=2 profile (or the x-gq-profile header) gives a tab its own cookie, so
// two players can be tested on one machine: it picks the cookie prefix.

import { betterAuth } from "better-auth";
import { APIError, createAuthEndpoint } from "better-auth/api";
import { setSessionCookie } from "better-auth/cookies";
import { anonymous, emailOTP } from "better-auth/plugins";
import type { Env, Player } from "./db";
import { now } from "./db/rows";
import { sendAuthCode } from "./email";

/** Long, because a guest who loses their session loses their character. Renewed once a day of play. */
const SESSION_DAYS = 365;
/** Only on localhost, never on a deployed Worker: there BETTER_AUTH_SECRET must be set. */
const LOCAL_SECRET = "local-development-only-secret-not-for-deploying";

/** The tab's test profile, or null: `?p=2` or the x-gq-profile header. */
export function profileOf(req: Request): string | null {
  const url = new URL(req.url);
  const profile = (req.headers.get("x-gq-profile") ?? url.searchParams.get("p") ?? "").toLowerCase();
  return /^[a-z0-9]{1,8}$/.test(profile) ? profile : null;
}

/** The session cookie from before Better Auth, by profile. Read once by /resume, then cleared. */
function legacyCookieName(profile: string | null): string {
  return profile ? `gq_session_${profile}` : "gq_session";
}

function readCookie(req: Request, name: string): string | null {
  for (const part of (req.headers.get("cookie") ?? "").split(";")) {
    const eq = part.indexOf("=");
    if (eq > 0 && part.slice(0, eq).trim() === name) return decodeURIComponent(part.slice(eq + 1).trim());
  }
  return null;
}

/**
 * Carries a player over from the old session cookie, once: the migration gave every old player an account with
 * the player's own id, so the old cookie's session names the account to sign in to. Answers 404 when there is
 * nothing to carry over, and the client signs in as a new guest instead.
 */
function resumePlugin(db: D1Database, profile: string | null) {
  return {
    id: "gq-resume",
    endpoints: {
      resume: createAuthEndpoint("/resume", { method: "POST" }, async (ctx) => {
        const name = legacyCookieName(profile);
        const token = ctx.request ? readCookie(ctx.request, name) : null;
        const row = token
          ? await db.prepare("SELECT p.user_id FROM sessions s JOIN players p ON p.id = s.player_id WHERE s.token = ?").bind(token).first<{ user_id: string | null }>()
          : null;
        const user = row?.user_id ? await ctx.context.internalAdapter.findUserById(row.user_id) : null;
        if (!token || !user) throw new APIError("NOT_FOUND", { message: "No earlier session to carry over." });
        const session = await ctx.context.internalAdapter.createSession(user.id);
        await setSessionCookie(ctx, { session, user });
        await db.prepare("DELETE FROM sessions WHERE token = ?").bind(token).run();
        ctx.setCookie(name, "", { path: "/", maxAge: 0 });
        return ctx.json({ resumed: true });
      }),
    },
  };
}

export function createAuth(env: Env, req: Request) {
  const url = new URL(req.url);
  const local = url.hostname === "localhost" || url.hostname === "127.0.0.1";
  const profile = profileOf(req);
  const db = env.DB;
  return betterAuth({
    appName: "The Harbor of Heylets",
    baseURL: url.origin,
    basePath: "/api/auth",
    secret: env.BETTER_AUTH_SECRET ?? (local ? LOCAL_SECRET : undefined),
    database: db,
    user: { modelName: "auth_user" },
    session: {
      modelName: "auth_session",
      expiresIn: 60 * 60 * 24 * SESSION_DAYS,
      updateAge: 60 * 60 * 24,
      // Most requests read the session from a signed cookie instead of the database.
      cookieCache: { enabled: true, maxAge: 5 * 60 },
    },
    account: { modelName: "auth_account" },
    verification: { modelName: "auth_verification" },
    advanced: { cookiePrefix: profile ? `gq${profile}` : "gq" },
    emailAndPassword: { enabled: true, minPasswordLength: 8, autoSignIn: true },
    plugins: [
      anonymous({
        generateName: () => "Guest",
        // A guest's heroes come with them: into a new account, or into one they log in to beside its own heroes. (An
        // empty slot, a guest who never made a hero, is only brought into an account that has nothing yet.)
        async onLinkAccount({ anonymousUser, newUser }) {
          const has = await db.prepare("SELECT 1 FROM players WHERE user_id = ?").bind(newUser.user.id).first();
          await db
            .prepare(
              has
                ? "UPDATE players SET user_id = ?1 WHERE user_id = ?2 AND EXISTS (SELECT 1 FROM characters c WHERE c.player_id = players.id AND c.status = 'active')"
                : "UPDATE players SET user_id = ?1 WHERE user_id = ?2",
            )
            .bind(newUser.user.id, anonymousUser.user.id)
            .run();
        },
      }),
      emailOTP({
        otpLength: 6,
        expiresIn: 15 * 60,
        allowedAttempts: 5,
        // Codes are only for setting a new password; accounts are made with a password.
        disableSignUp: true,
        async sendVerificationOTP({ email, otp, type }) {
          if (type !== "forget-password") return;
          if (!(await sendAuthCode(env, email, otp))) throw new Error("The email could not be sent. Try again shortly.");
        },
      }),
      resumePlugin(db, profile),
    ],
  });
}

/** Heroes an account may have. */
export const MAX_HEROES = 6;

/** The cookie that says which of the account's heroes this device is playing (beside Better Auth's, by profile). */
export function heroCookieName(req: Request): string {
  const profile = profileOf(req);
  return `${profile ? `gq${profile}` : "gq"}.hero`;
}

/**
 * The hero behind a request's session: the one this device chose (its hero cookie), if it is the account's; else the
 * account's most recently played. A new account's first hero slot is made on first use. Null if not signed in.
 */
export async function playerForRequest(env: Env, req: Request): Promise<Player | null> {
  const found = await createAuth(env, req).api.getSession({ headers: req.headers });
  if (!found) return null;
  const { user } = found;
  const email = (user as { isAnonymous?: boolean | null }).isAnonymous ? null : user.email;
  const chosen = readCookie(req, heroCookieName(req)) ?? "";
  const find = () =>
    env.DB.prepare("SELECT id, name FROM players WHERE user_id = ?1 ORDER BY id = ?2 DESC, last_played_at DESC, created_at, id LIMIT 1")
      .bind(user.id, chosen)
      .first<{ id: string; name: string }>();
  let row = await find();
  if (!row) {
    // Two first requests at once must not make two players: only insert while there is none.
    await env.DB.prepare("INSERT INTO players (id, name, created_at, last_played_at, user_id) SELECT ?1, ?2, ?3, ?3, ?4 WHERE NOT EXISTS (SELECT 1 FROM players WHERE user_id = ?4)")
      .bind(crypto.randomUUID(), email ? "Sailor" : "Guest", now(), user.id)
      .run();
    row = await find();
  }
  return row ? { ...row, email, userId: user.id } : null;
}
