// The main menu: the first screen, and where the game menu's "Main menu" goes
// (#menu). A side panel over the dusk harbor holds the title and a short
// column of choices; each choice opens a small menu of its own in the same
// panel, with a way back.
//
//   Continue           back to your world's town, when you have one
//   Create world  ->   name it  ->  make a hero (if none yet)  ->  invite friends
//   Join world    ->   your world, or an invite code  ->  make a hero (if none yet)
//   Settings           sound and display (the same as in the game menu)
//   Log in / Account
//
// A world is a crew: one Harbor and its atlas, shared with whoever joins.

import { useState, type ReactNode } from "react";
import { EmailSignIn } from "./Account";
import { api, type Me } from "./api";
import { SoundButton } from "./audio/SoundButton";
import { useAudioScene } from "./audio/useAudioScene";
import { CharacterCreation } from "./CharacterCreation";
import { MAIN_MENU_HASH } from "./OptionsMenu";
import { SettingsSections } from "./Settings";
import { AnchorMark, HarborBackdrop, HarborTitle } from "./Welcome";
import "./mainmenu.css";

/** The game's name, as the browser tab shows it (index.html). */
const GAME_TITLE = "The Harbor of Heylets";

/** What a new hero is being made for, done the moment they are confirmed. */
type Then = { kind: "create"; name: string } | { kind: "join"; code: string };
type View = "home" | "create" | "join" | "settings" | "account" | "invite" | { hero: Then };

interface Props {
  me: Me;
  refresh(): Promise<unknown>;
  /** A crew invite code from the URL (#crew/CODE): opens Join world with it filled in. */
  invite: string | null;
  /** Back to the world's town: given when there is one to go back to. */
  onContinue?(): void;
}

const inviteLink = (code: string) => `${location.origin}${location.pathname}#crew/${code}`;

export function MainMenu({ me, refresh, invite, onContinue }: Props) {
  useAudioScene("title");
  const ready = me.character?.status === "active";
  const [view, setView] = useState<View>(invite && invite !== me.crew?.id ? "join" : "home");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const go = (next: View) => {
    setError(null);
    setView(next);
  };

  /** Make or join the world: straight away with a hero, or after making one. */
  const carryOut = async (then: Then) => {
    if (then.kind === "create") {
      // Stay on the menu once there is a world, to hand out its invite before going in.
      location.hash = MAIN_MENU_HASH;
      await api.createCrew(then.name);
      await refresh();
      setView("invite");
    } else {
      await api.joinCrew(then.code);
      await refresh();
      location.hash = "";
    }
  };
  const start = async (then: Then) => {
    if (!ready) return go({ hero: then });
    setBusy(true);
    setError(null);
    try {
      await carryOut(then);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  if (typeof view === "object") {
    const then = view.hero;
    return (
      <Backdrop>
        <CharacterCreation
          draft={me.character}
          refresh={refresh}
          onBack={() => go(then.kind)}
          onDone={() => carryOut(then)}
          note={then.kind === "create" ? `Then your world, ${then.name}, is made.` : `Then you join the world ${then.code}.`}
        />
      </Backdrop>
    );
  }

  const back = <button className="link mm-back" onClick={() => go("home")}>‹ Back</button>;
  let body: ReactNode;
  if (view === "home") {
    body = (
      <nav className="mm-choices" aria-label="Main menu">
        {onContinue && me.crew && (
          <button className="mm-choice primary" autoFocus onClick={onContinue}>
            Continue<span className="mm-choice-sub">{me.crew.name}</span>
          </button>
        )}
        <button className={`mm-choice ${onContinue ? "" : "primary"}`} autoFocus={!onContinue} onClick={() => go("create")}>Create world</button>
        <button className="mm-choice" onClick={() => go("join")}>Join world</button>
        <button className="mm-choice" onClick={() => go("settings")}>Settings</button>
        <button className="mm-choice" onClick={() => go("account")}>{me.player.email ? "Account" : "Log in"}</button>
      </nav>
    );
  } else if (view === "create") {
    body = <CreateWorld me={me} back={back} busy={busy} onCreate={(name) => void start({ kind: "create", name })} />;
  } else if (view === "join") {
    body = <JoinWorld me={me} back={back} busy={busy} invite={invite} ready={ready} onContinue={onContinue} onJoin={(code) => void start({ kind: "join", code })} />;
  } else if (view === "invite") {
    body = <InviteFriends me={me} />;
  } else if (view === "settings") {
    body = (
      <>
        <header className="mm-sub-head">{back}<h2>Settings</h2></header>
        <div className="mm-settings"><SettingsSections /></div>
      </>
    );
  } else {
    body = (
      <>
        <header className="mm-sub-head">{back}<h2>{me.player.email ? "Account" : "Log in"}</h2></header>
        {me.player.email ? (
          <div className="mm-account">
            <p>Logged in as <strong>{me.player.email}</strong>.</p>
            <p className="muted">Your hero, gear and world are saved to this account. Log in with it on any device.</p>
            <button className="danger" onClick={() => void logOut()}>Log out</button>
          </div>
        ) : (
          <>
            <p className="muted">You are playing as a guest: your hero lives only in this browser. Make an account to keep them, or log in to one you have.</p>
            <EmailSignIn onDone={async () => { await refresh(); go("home"); }} hasCharacter={ready} />
          </>
        )}
      </>
    );
  }

  return (
    <Backdrop>
      <div className="mm-layout">
        <section className="panel window mm-panel">
          <header className="mm-title">
            <AnchorMark />
            <HarborTitle name={GAME_TITLE} compact />
          </header>
          {error && <p className="banner error" role="alert">{error}</p>}
          <div className="mm-body">{body}</div>
          <footer className="mm-foot muted">
            {me.player.email ? <>Logged in as {me.player.email}</> : <>Playing as a guest · <button className="link" onClick={() => go("account")}>Log in</button></>}
          </footer>
        </section>
      </div>
    </Backdrop>
  );
}

/** The dusk harbor behind every menu, and the sound button in the corner. */
function Backdrop({ children }: { children: ReactNode }) {
  return (
    <div className="main-menu">
      <HarborBackdrop />
      <span className="sound-corner"><SoundButton /></span>
      {children}
    </div>
  );
}

async function logOut() {
  if (!confirm("Log out? You can log back in with your email and password at any time.")) return;
  await api.signOut().catch(() => undefined);
  // A fresh guest takes over this browser; the account waits for its owner.
  location.hash = "";
  location.reload();
}

function CreateWorld({ me, back, busy, onCreate }: { me: Me; back: ReactNode; busy: boolean; onCreate(name: string): void }) {
  const [name, setName] = useState("");
  const ok = name.trim().length >= 2;
  const ready = me.character?.status === "active";
  return (
    <form className="mm-form" onSubmit={(e) => { e.preventDefault(); if (ok && !busy) onCreate(name.trim()); }}>
      <header className="mm-sub-head">{back}<h2>Create world</h2></header>
      <p className="muted">A world is one Harbor and its atlas, shared with the friends you invite.</p>
      <label className="field">
        <span>World name</span>
        <input autoFocus value={name} maxLength={30} placeholder="The Salty Dogs" onChange={(e) => setName(e.target.value)} />
      </label>
      {me.crew && <p className="muted small-print">You will leave {me.crew.name}. Your hero and what they carry come with you.</p>}
      <button className="primary big" type="submit" disabled={busy || !ok}>
        {ready ? "Create world" : "Next: your hero"} <span aria-hidden>▸</span>
      </button>
    </form>
  );
}

function JoinWorld({ me, back, busy, invite, ready, onContinue, onJoin }: { me: Me; back: ReactNode; busy: boolean; invite: string | null; ready: boolean; onContinue?(): void; onJoin(code: string): void }) {
  const [code, setCode] = useState(invite && invite !== me.crew?.id ? invite : "");
  return (
    <form className="mm-form" onSubmit={(e) => { e.preventDefault(); if (code.length === 6 && !busy) onJoin(code); }}>
      <header className="mm-sub-head">{back}<h2>Join world</h2></header>
      {me.crew && (
        <div className="mm-world">
          <span className="mm-world-name">
            <strong>{me.crew.name}</strong>
            <span className="muted">Your world · code {me.crew.id}</span>
          </span>
          {onContinue && <button type="button" className="primary" onClick={onContinue}>Enter</button>}
        </div>
      )}
      <label className="field">
        <span>{me.crew ? "Join another with its invite code" : "Invite code"}</span>
        <input autoFocus={!me.crew} className="mm-code" value={code} maxLength={6} placeholder="ABCDEF" autoCapitalize="characters" onChange={(e) => setCode(e.target.value.toUpperCase().replace(/[^A-Z]/g, ""))} />
      </label>
      <p className="muted small-print">
        {me.crew ? `Joining another world leaves ${me.crew.name}. Your hero and what they carry come with you.` : "Ask a friend for their world's six-letter code, or open the invite link they sent."}
      </p>
      <button className="primary big" type="submit" disabled={busy || code.length !== 6}>
        {ready ? "Join world" : "Next: your hero"} <span aria-hidden>▸</span>
      </button>
    </form>
  );
}

function InviteFriends({ me }: { me: Me }) {
  const [copied, setCopied] = useState(false);
  if (!me.crew) return null;
  const link = inviteLink(me.crew.id);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(link);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      prompt("Copy this invite link:", link);
    }
  };
  return (
    <div className="mm-form">
      <header className="mm-sub-head"><h2>Invite friends</h2></header>
      <p><strong>{me.crew.name}</strong> is ready. Send your friends the link, or the code to type in under Join world.</p>
      <div className="mm-invite">
        <span className="mm-invite-code" aria-label="Invite code">{me.crew.id}</span>
        <input readOnly value={link} aria-label="Invite link" onFocus={(e) => e.currentTarget.select()} />
        <button type="button" onClick={() => void copy()}>{copied ? "Copied" : "Copy link"}</button>
      </div>
      <p className="muted small-print">You can copy it again any time from the game menu in town.</p>
      <button className="primary big" autoFocus onClick={() => (location.hash = "")}>
        Enter {me.crew.name} <span aria-hidden>▸</span>
      </button>
    </div>
  );
}
