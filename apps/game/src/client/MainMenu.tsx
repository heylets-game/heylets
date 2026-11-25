// The main menu: the first screen, and where the game menu's "Main menu" goes
// (#menu). A side panel over the dusk harbor holds the title and a short
// column of choices; each choice opens a small menu of its own in the same
// panel, with a way back.
//
//   (your hero)        who you are playing; Change hero lists the account's heroes and makes new ones
//   Continue           back to your hero's world, when they have one
//   Create world  ->   name it  ->  make a hero (if none yet)  ->  invite friends
//   Join world    ->   the account's worlds, or an invite code  ->  make a hero (if none yet)
//   Settings           sound and display (the same as in the game menu)
//   Log in / Account
//
// A world is a crew: one Harbor and its atlas, shared with whoever joins. A
// hero can belong to several worlds and is in one at a time: the one they went
// into last. Joining another keeps their place in the others.

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { DEFAULT_APPEARANCE, parseAppearance } from "@gantt-quest/world";
import { EmailSignIn } from "./Account";
import { api, type AccountWorld, type HeroSlot, type Me } from "./api";
import { label } from "./labels";
import { startingOutfit } from "./LookBuilder";
import { spriteDataUrl } from "./render/sprites";
import { SoundButton } from "./audio/SoundButton";
import { useAudioScene } from "./audio/useAudioScene";
import { CharacterCreation } from "./CharacterCreation";
import { MAIN_MENU_HASH, NEW_HERO_HASH } from "./OptionsMenu";
import { SettingsSections } from "./Settings";
import { AnchorMark, HarborBackdrop, HarborTitle } from "./Welcome";
import "./mainmenu.css";

/** The game's name, as the browser tab shows it (index.html). */
const GAME_TITLE = "The Harbor of Heylets";

/** What a new hero is being made for, done the moment they are confirmed. */
type Then = { kind: "create"; name: string } | { kind: "join"; code: string } | { kind: "none" };
type View = "home" | "create" | "join" | "settings" | "account" | "invite" | "heroes" | { hero: Then };

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

  // The account's heroes, read again whenever the hero being played changes.
  const [heroes, setHeroes] = useState<{ heroes: HeroSlot[]; max: number } | null>(null);
  const loadHeroes = useCallback(() => api.heroes().then(setHeroes, () => setHeroes(null)), []);
  useEffect(() => {
    void loadHeroes();
  }, [loadHeroes, me.player.id, me.character?.status]);
  // The account's worlds, for Join world: read again when the hero or the world they are in changes.
  const [worlds, setWorlds] = useState<AccountWorld[] | null>(null);
  const loadWorlds = useCallback(() => api.worlds().then((r) => setWorlds(r.worlds), () => setWorlds(null)), []);
  useEffect(() => {
    void loadWorlds();
  }, [loadWorlds, me.player.id, me.crew?.id]);
  /** Leave a world for good, after asking. */
  const leaveWorld = async (w: AccountWorld) => {
    const hero = me.character?.name ?? "Your hero";
    if (!confirm(`Leave ${w.name}? ${hero} gives up their place there, and their hut too if it stands there. They can join again with its code.`)) return;
    setBusy(true);
    setError(null);
    try {
      location.hash = MAIN_MENU_HASH;
      await api.leaveCrew(w.id);
      await refresh();
      await loadWorlds();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  /** Play another hero. The menu stays up: their world is one Continue away. */
  const choose = async (id: string) => {
    setBusy(true);
    setError(null);
    try {
      if (id !== me.player.id) {
        location.hash = MAIN_MENU_HASH;
        await api.chooseHero(id);
        await refresh();
      }
      go("home");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  /** Start a new hero in an empty slot, then make them. */
  const newHero = async () => {
    setBusy(true);
    setError(null);
    try {
      location.hash = MAIN_MENU_HASH;
      await api.newHero();
      await refresh();
      go({ hero: { kind: "none" } });
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  // Opened as #menu/new-hero (the party picker's "Make a new hero"): straight into making one. Once only, and the
  // hash goes back to #menu before the slot is asked for, so a reload does not make another.
  const askedNew = useRef(false);
  useEffect(() => {
    if (askedNew.current || location.hash !== NEW_HERO_HASH) return;
    askedNew.current = true;
    void newHero();
  }, []);

  /** Make or join the world: straight away with a hero, or after making one. */
  const carryOut = async (then: Then) => {
    if (then.kind === "none") {
      await refresh();
      go("home");
    } else if (then.kind === "create") {
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
          onBack={() => go(then.kind === "none" ? "home" : then.kind)}
          onDone={() => carryOut(then)}
          note={then.kind === "create" ? `Then your world, ${then.name}, is made.` : then.kind === "join" ? `Then you join the world ${then.code}.` : undefined}
        />
      </Backdrop>
    );
  }

  const back = <button className="link mm-back" onClick={() => go("home")}>‹ Back</button>;
  let body: ReactNode;
  const others = heroes?.heroes.filter((h) => h.id !== me.player.id) ?? [];
  const changeHero = <button className="link" onClick={() => go("heroes")}>Change hero</button>;
  if (view === "home") {
    body = (
      <>
      {ready && me.character ? (
        <div className="mm-hero">
          <HeroFace classId={me.character.class_id} appearance={me.character.appearance ?? null} />
          <span className="mm-hero-text">
            <strong>{me.character.name}</strong>
            <span className="muted">Lv {me.character.level} {label("class", me.character.class_id)}</span>
            <span className="muted">{me.crew ? me.crew.name : "No world yet"}</span>
          </span>
          {changeHero}
        </div>
      ) : others.length > 0 ? (
        <div className="mm-hero mm-hero-empty">
          <span className="mm-hero-text">
            <strong>No hero chosen</strong>
            <span className="muted">Pick one of your heroes, or make a new one.</span>
          </span>
          <button className="small" onClick={() => go("heroes")}>Choose hero</button>
        </div>
      ) : null}
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
      </>
    );
  } else if (view === "heroes") {
    const all = heroes?.heroes ?? [];
    const max = heroes?.max ?? 0;
    body = (
      <>
        <header className="mm-sub-head">{back}<h2>Your heroes</h2></header>
        <p className="muted">Each hero has their own gear, gold and hut, and is in one world at a time.</p>
        <div className="mm-heroes" role="list">
          {all.map((h) => {
            const playing = h.id === me.player.id;
            return (
              <button key={h.id} role="listitem" className={`mm-hero-pick ${playing ? "selected" : ""}`} aria-current={playing || undefined} disabled={busy} onClick={() => void choose(h.id)}>
                <HeroFace classId={h.classId} appearance={h.appearance} />
                <span className="mm-hero-text">
                  <strong>{h.name}</strong>
                  <span>Lv {h.level} {label("class", h.classId)}</span>
                  <span>{h.crew ? h.crew.name : "No world yet"}</span>
                </span>
                {playing && <span className="mm-hero-tag">Playing</span>}
              </button>
            );
          })}
        </div>
        <button className="primary big mm-new-hero" disabled={busy || (max > 0 && all.length >= max)} onClick={() => void newHero()}>
          New hero <span aria-hidden>▸</span>
        </button>
        <p className="muted small-print">{all.length} of {max || "?"} heroes. {max > 0 && all.length >= max ? "That is the most an account can have." : ""}</p>
      </>
    );
  } else if (view === "create") {
    body = <CreateWorld me={me} back={back} busy={busy} onHeroes={() => go("heroes")} onCreate={(name) => void start({ kind: "create", name })} />;
  } else if (view === "join") {
    body = <JoinWorld me={me} back={back} busy={busy} invite={invite} ready={ready} worlds={worlds} onHeroes={() => go("heroes")} onLeave={(w) => void leaveWorld(w)} onJoin={(code) => void start({ kind: "join", code })} />;
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
            <p className="muted">Your heroes, their gear and their worlds are saved to this account. Log in with it on any device.</p>
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

/** A hero's small portrait: their class in their starting clothes, with their own look. */
function HeroFace({ classId, appearance }: { classId: string; appearance: string | null }) {
  const src = useMemo(() => spriteDataUrl(classId, startingOutfit(classId, parseAppearance(appearance) ?? DEFAULT_APPEARANCE)), [classId, appearance]);
  return (
    <span className="mm-hero-face">
      <img className="pixel-icon" src={src} alt="" width={36} height={44} />
    </span>
  );
}

/** Who a world will be made or joined with, and the way to pick another. */
function AsHero({ me, onChange }: { me: Me; onChange(): void }) {
  if (me.character?.status !== "active") return null;
  return (
    <p className="mm-as-hero muted">
      As <strong>{me.character.name}</strong>, Lv {me.character.level} {label("class", me.character.class_id)} · <button type="button" className="link" onClick={onChange}>Change hero</button>
    </p>
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

function CreateWorld({ me, back, busy, onHeroes, onCreate }: { me: Me; back: ReactNode; busy: boolean; onHeroes(): void; onCreate(name: string): void }) {
  const [name, setName] = useState("");
  const ok = name.trim().length >= 2;
  const ready = me.character?.status === "active";
  return (
    <form className="mm-form" onSubmit={(e) => { e.preventDefault(); if (ok && !busy) onCreate(name.trim()); }}>
      <header className="mm-sub-head">{back}<h2>Create world</h2></header>
      <p className="muted">A world is one Harbor and its atlas, shared with the friends you invite.</p>
      <AsHero me={me} onChange={onHeroes} />
      <label className="field">
        <span>World name</span>
        <input autoFocus value={name} maxLength={30} placeholder="The Salty Dogs" onChange={(e) => setName(e.target.value)} />
      </label>
      {me.crew && <p className="muted small-print">{me.character?.name ?? "Your hero"} keeps their place in {me.crew.name} too.</p>}
      <button className="primary big" type="submit" disabled={busy || !ok}>
        {ready ? "Create world" : "Next: your hero"} <span aria-hidden>▸</span>
      </button>
    </form>
  );
}

function JoinWorld({ me, back, busy, invite, ready, worlds, onHeroes, onLeave, onJoin }: { me: Me; back: ReactNode; busy: boolean; invite: string | null; ready: boolean; worlds: AccountWorld[] | null; onHeroes(): void; onLeave(world: AccountWorld): void; onJoin(code: string): void }) {
  const known = new Set((worlds ?? []).map((w) => w.id));
  const [code, setCode] = useState(invite && !known.has(invite) && invite !== me.crew?.id ? invite : "");
  const hero = me.character?.status === "active" ? me.character.name : null;
  return (
    <form className="mm-form" onSubmit={(e) => { e.preventDefault(); if (code.length === 6 && !busy) onJoin(code); }}>
      <header className="mm-sub-head">{back}<h2>Join world</h2></header>
      <AsHero me={me} onChange={onHeroes} />
      {worlds && worlds.length > 0 && (
        <div className="mm-worlds" role="list" aria-label="Your worlds">
          {worlds.map((w) => {
            const mine = w.heroes.some((h) => h.id === me.player.id);
            const here = me.crew?.id === w.id;
            return (
              <div key={w.id} role="listitem" className={`mm-world ${here ? "here" : ""}`}>
                <span className="mm-world-name">
                  <strong>{w.name}</strong>
                  <span className="muted">{w.heroes.length > 0 ? w.heroes.map((h) => h.name).join(", ") : "None of your heroes yet"} · {w.members} {w.members === 1 ? "member" : "members"} · code {w.id}</span>
                </span>
                <span className="mm-world-actions">
                  <button type="button" className={mine ? "primary" : undefined} disabled={busy} onClick={() => onJoin(w.id)}>
                    {mine ? "Enter" : hero ? `Join as ${hero}` : "Join"}
                  </button>
                  {mine && <button type="button" className="link" disabled={busy} onClick={() => onLeave(w)}>Leave</button>}
                </span>
              </div>
            );
          })}
        </div>
      )}
      <label className="field">
        <span>{worlds && worlds.length > 0 ? "Or join another with its invite code" : "Invite code"}</span>
        <input autoFocus={!worlds?.length} className="mm-code" value={code} maxLength={6} placeholder="ABCDEF" autoCapitalize="characters" onChange={(e) => setCode(e.target.value.toUpperCase().replace(/[^A-Z]/g, ""))} />
      </label>
      <p className="muted small-print">
        {me.crew ? `${hero ?? "Your hero"} keeps their place in their other worlds.` : "Ask a friend for their world's six-letter code, or open the invite link they sent."}
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
