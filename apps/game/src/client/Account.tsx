// Logging in with an email and password. A guest account lives only in this
// browser's cookie; making an account keeps the guest's character and makes
// it reachable from any device. Forgot the password, or played before
// passwords: an emailed six-digit code sets a new one.

import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import { api, type Me } from "./api";

type Mode = "login" | "signup" | "reset";

const MIN_PASSWORD = 8;

const DONE: Record<Mode, string> = {
  login: "Welcome back. You are logged in.",
  signup: "Account made. This character is saved to it.",
  reset: "Password set. You are logged in.",
};

/** Better Auth's error codes, said for a player. Anything else shows the server's own message. */
const ERRORS: Record<string, string> = {
  INVALID_EMAIL_OR_PASSWORD: "That email and password do not match.",
  USER_ALREADY_EXISTS: "That email already has an account.",
  USER_ALREADY_EXISTS_USE_ANOTHER_EMAIL: "That email already has an account.",
  PASSWORD_TOO_SHORT: `The password needs at least ${MIN_PASSWORD} characters.`,
  INVALID_OTP: "That code is wrong. Check the email, or ask for a new one.",
  OTP_EXPIRED: "That code has expired. Ask for a new one.",
  TOO_MANY_ATTEMPTS: "Too many wrong codes. Ask for a new one.",
  INVALID_EMAIL: "That does not look like an email address.",
};
/**
 * Errors that may mean an account with no password yet: one from before there were passwords, or one whose owner has
 * forgotten it. The answer is the same either way (so nobody can learn which emails have accounts), and the error
 * offers to email a code to set a password.
 */
const OFFERS_CODE = new Set(["INVALID_EMAIL_OR_PASSWORD", "USER_ALREADY_EXISTS", "USER_ALREADY_EXISTS_USE_ANOTHER_EMAIL"]);

interface FormProps {
  /** Called after a successful login, once the caller should reload the player. */
  onDone(): Promise<unknown>;
  /** The guest has a character that logging in to another account would leave behind. */
  hasCharacter: boolean;
}

export function EmailSignIn({ onDone, hasCharacter }: FormProps) {
  const [mode, setMode] = useState<Mode>(hasCharacter ? "signup" : "login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [code, setCode] = useState("");
  const [sent, setSent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<{ text: string; offerCode: boolean } | null>(null);
  const [done, setDone] = useState<Mode | null>(null);
  const codeBox = useRef<HTMLInputElement>(null);
  // Once the code is on its way, the cursor waits in the box for it.
  useEffect(() => {
    if (sent) codeBox.current?.focus();
  }, [sent]);

  const switchTo = (next: Mode) => {
    setMode(next);
    setError(null);
    setSent(false);
    setCode("");
  };
  const run = async (fn: () => Promise<void>) => {
    setBusy(true);
    setError(null);
    try {
      await fn();
    } catch (e) {
      const err = e as Error & { code?: string };
      setError({ text: (err.code && ERRORS[err.code]) || err.message, offerCode: !!err.code && OFFERS_CODE.has(err.code) });
    } finally {
      setBusy(false);
    }
  };
  const finish = async (how: Mode) => {
    setDone(how);
    await onDone();
  };

  const emailOk = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim());
  const passwordOk = password.length >= MIN_PASSWORD;
  const submit = () => {
    if (busy) return;
    if (mode === "login" && emailOk && password) void run(async () => { await api.logIn(email.trim(), password); await finish("login"); });
    else if (mode === "signup" && emailOk && passwordOk) void run(async () => { await api.signUp(email.trim(), password); await finish("signup"); });
    else if (mode === "reset" && !sent && emailOk) sendCode();
    else if (mode === "reset" && sent && code.length === 6 && passwordOk)
      void run(async () => {
        await api.resetPassword(email.trim(), code, password);
        await api.logIn(email.trim(), password);
        await finish("reset");
      });
  };
  const onEnter = (e: KeyboardEvent) => e.key === "Enter" && submit();
  /** Email a code for setting a password to the address in the box, from wherever the form is. */
  function sendCode() {
    setMode("reset");
    setCode("");
    // A password typed into the log-in box (most likely a wrong guess) is not carried over as the new one.
    setPassword("");
    void run(async () => {
      await api.sendPasswordCode(email.trim());
      setSent(true);
    });
  }

  if (done) return <p className="good">{DONE[done]}</p>;
  const ready = mode === "login" ? emailOk && !!password : mode === "signup" ? emailOk && passwordOk : sent ? code.length === 6 && passwordOk : emailOk;
  const label = mode === "login" ? "Log in" : mode === "signup" ? "Make an account" : sent ? "Set password and log in" : "Email me a code";
  return (
    <div className="signin">
      <div className="row signin-modes" role="tablist" aria-label="Account">
        <button role="tab" aria-selected={mode === "login"} className={mode === "login" ? "selected" : undefined} onClick={() => switchTo("login")}>Log in</button>
        <button role="tab" aria-selected={mode === "signup"} className={mode === "signup" ? "selected" : undefined} onClick={() => switchTo("signup")}>New account</button>
      </div>
      {mode === "login" && !error && (
        <div className="signin-returning">
          <p><strong>Played before there were passwords?</strong> Your hero is waiting. Set a password with a code we email you, and you're in.</p>
          <button className="small" disabled={busy} onClick={() => switchTo("reset")}>Set a password</button>
        </div>
      )}
      {error && (
        <div className="banner error" role="alert">
          {error.text}
          {error.offerCode && (
            <>
              {" "}If you played before there were passwords, or have forgotten yours, set one with a code.
              <span className="signin-error-action">
                <button className="small" disabled={busy || !emailOk} onClick={sendCode}>{emailOk ? `Email a code to ${email.trim()}` : "Email me a code"}</button>
              </span>
            </>
          )}
        </div>
      )}
      {mode === "reset" && (
        <div className="signin-reset-note">
          {sent ? (
            <p>A six-digit code is on its way to <strong>{email.trim()}</strong>. Type it below with the password you want, and you're logged in with your hero just as you left them. The code works for 15 minutes; check your spam folder if it doesn't arrive.</p>
          ) : (
            <p><strong>Set a password.</strong> Forgot yours, or played before there were passwords? Enter your email and we'll send a six-digit code. With it you choose a password and you're back in, hero and all.</p>
          )}
        </div>
      )}
      {!(mode === "reset" && sent) && (
        <label className="field">
          <span>Email</span>
          <input type="email" autoComplete="email" inputMode="email" value={email} maxLength={254} placeholder="you@example.com" onChange={(e) => setEmail(e.target.value)} onKeyDown={onEnter} />
        </label>
      )}
      {mode === "reset" && sent && (
        <label className="field">
          <span>Code</span>
          <input ref={codeBox} className="code-input" autoComplete="one-time-code" inputMode="numeric" value={code} maxLength={6} placeholder="000000" onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))} onKeyDown={onEnter} />
        </label>
      )}
      {(mode !== "reset" || sent) && (
        <label className="field">
          <span>{mode === "login" ? "Password" : "New password"}</span>
          <input type="password" autoComplete={mode === "login" ? "current-password" : "new-password"} value={password} maxLength={128} onChange={(e) => setPassword(e.target.value)} onKeyDown={onEnter} />
          {mode !== "login" && <small className="muted">At least {MIN_PASSWORD} characters.</small>}
        </label>
      )}
      <div className="row">
        <button className="primary" disabled={busy || !ready} onClick={submit}>{label}</button>
        {mode === "login" && <button className="link" disabled={busy} onClick={() => switchTo("reset")}>Forgot password?</button>}
        {mode === "reset" && sent && <button disabled={busy} onClick={() => { setSent(false); setError(null); }}>Use a different address</button>}
        {mode === "reset" && <button className="link" disabled={busy} onClick={() => switchTo("login")}>Back to log in</button>}
      </div>
      {hasCharacter && mode !== "signup" && (
        <p className="muted small-print">
          Logging in to an account that already has a character leaves this guest character behind. To keep it, make a new account instead.
        </p>
      )}
    </div>
  );
}

/** The account window in the Harbor: save a guest's progress, or see who is signed in and sign out. */
export function AccountPanel({ me, refresh, onClose }: { me: Me; refresh(): Promise<unknown>; onClose(): void }) {
  const [busy, setBusy] = useState(false);
  const signOut = async () => {
    if (!confirm("Log out? You can log back in with your email and password at any time.")) return;
    setBusy(true);
    await api.signOut().catch(() => undefined);
    // A fresh guest takes over this browser; the account waits for its owner.
    location.hash = "";
    location.reload();
  };
  return (
    <div className="overlay inv-overlay" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="panel account" role="dialog" aria-label="Account">
        <header className="inv-head">
          <h2>Account</h2>
          <span className="spacer" />
          <button onClick={onClose}>Close</button>
        </header>
        {me.player.email ? (
          <>
            <p>Logged in as <strong>{me.player.email}</strong>.</p>
            <p className="muted">Your character, gear and crew are saved to this address. Log in with it on any device to pick up where you left off.</p>
            <button className="danger" disabled={busy} onClick={signOut}>Log out</button>
          </>
        ) : (
          <>
            <p><strong>You are playing as a guest.</strong></p>
            <p className="muted">Right now this character exists only in this browser. Clear its cookies, or switch device, and it is gone. Make an account to keep it.</p>
            <EmailSignIn onDone={refresh} hasCharacter={me.character?.status === "active"} />
          </>
        )}
      </div>
    </div>
  );
}
