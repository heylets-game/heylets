-- Logins move to Better Auth (src/server/auth.ts). Its four tables are below,
-- as its own migration tool writes them. A player now belongs to an account
-- (auth_user) through players.user_id; one account will hold several
-- characters later.
--
-- Every existing player gets an account with the player's own id: the ones
-- with an email as a real account (they set a password with an emailed code),
-- the rest as guests. The old `sessions` table stays for now: /api/auth/resume
-- swaps an old session cookie for a new one, so nobody loses their character.

create table "auth_user" ("id" text not null primary key, "name" text not null, "email" text not null unique, "emailVerified" integer not null, "image" text, "createdAt" date not null, "updatedAt" date not null, "isAnonymous" integer);
create table "auth_session" ("id" text not null primary key, "expiresAt" date not null, "token" text not null unique, "createdAt" date not null, "updatedAt" date not null, "ipAddress" text, "userAgent" text, "userId" text not null references "auth_user" ("id") on delete cascade);
create table "auth_account" ("id" text not null primary key, "accountId" text not null, "providerId" text not null, "userId" text not null references "auth_user" ("id") on delete cascade, "accessToken" text, "refreshToken" text, "idToken" text, "accessTokenExpiresAt" date, "refreshTokenExpiresAt" date, "scope" text, "password" text, "createdAt" date not null, "updatedAt" date not null);
create table "auth_verification" ("id" text not null primary key, "identifier" text not null, "value" text not null, "expiresAt" date not null, "createdAt" date not null, "updatedAt" date not null);
create index "auth_session_userId_idx" on "auth_session" ("userId");
create index "auth_account_userId_idx" on "auth_account" ("userId");
create index "auth_verification_identifier_idx" on "auth_verification" ("identifier");

-- No foreign key: a guest's account is deleted when they sign in to another account, and their player stays behind.
ALTER TABLE players ADD COLUMN user_id TEXT;
CREATE INDEX idx_players_user ON players(user_id, created_at);

INSERT INTO auth_user (id, name, email, emailVerified, createdAt, updatedAt, isAnonymous)
SELECT
  id,
  name,
  COALESCE(email, 'guest-' || id || '@anonymous.placeholder.invalid'),
  CASE WHEN email IS NULL THEN 0 ELSE 1 END,
  strftime('%Y-%m-%dT%H:%M:%fZ', created_at / 1000.0, 'unixepoch'),
  strftime('%Y-%m-%dT%H:%M:%fZ', 'now'),
  CASE WHEN email IS NULL THEN 1 ELSE 0 END
FROM players;

UPDATE players SET user_id = id;

-- Sign-in codes are Better Auth's now (auth_verification).
DROP TABLE email_login_codes;
