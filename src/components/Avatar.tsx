import type { CSSProperties } from "react";
import { avatarDef, type AvatarArt } from "../lib/account/avatars";

/** A profile avatar: colour tile with a drawn face or character. Scales with its box. */
export function Avatar({ id, className, style }: { id: string; className?: string; style?: CSSProperties }) {
  const a = avatarDef(id);
  const character = a.group === "characters";
  return (
    <span
      className={className ? `avatar ${className}` : "avatar"}
      data-art={character ? "character" : "face"}
      style={{ ...style, "--avatar-from": a.from, "--avatar-to": a.to } as CSSProperties}
      aria-hidden
    >
      <svg viewBox="0 0 100 100" fill="none" strokeLinecap="round" strokeLinejoin="round">
        <Art art={a.art} />
      </svg>
    </span>
  );
}

const INK = "#1d1d24";

/** A fuzzy blob outline: alternating radii around a centre. */
function spiky(cx: number, cy: number, r: number, depth: number, points: number) {
  const pts: string[] = [];
  for (let i = 0; i < points * 2; i++) {
    const angle = (Math.PI * i) / points - Math.PI / 2;
    const radius = i % 2 ? r - depth : r;
    pts.push(`${(cx + Math.cos(angle) * radius).toFixed(1)} ${(cy + Math.sin(angle) * radius).toFixed(1)}`);
  }
  return `M${pts.join("L")}Z`;
}
const MONSTER_FUR = spiky(50, 60, 38, 5, 26);

function Art({ art }: { art: AvatarArt }) {
  const eyes = (
    <>
      <circle cx="31" cy="44" r="6" fill="#fff" />
      <circle cx="69" cy="44" r="6" fill="#fff" />
    </>
  );
  const line = { stroke: "#fff", strokeWidth: 5 };
  switch (art) {
    // --- Classics: white faces on colour, like a streaming service's default icons.
    case "smile":
      return (
        <>
          {eyes}
          <path d="M27 63q23 13 46 0" {...line} />
        </>
      );
    case "grin":
      return (
        <>
          {eyes}
          <path d="M29 58h42q-3 20-21 20t-21-20z" fill="#fff" />
        </>
      );
    case "wink":
      return (
        <>
          <circle cx="31" cy="44" r="6" fill="#fff" />
          <path d="M62 45q7-6 14 0" {...line} />
          <path d="M27 63q23 13 46 0" {...line} />
        </>
      );
    case "calm":
      return (
        <>
          <path d="M24 44q7 6 14 0M62 44q7 6 14 0" {...line} />
          <path d="M36 65q14 8 28 0" {...line} />
        </>
      );
    case "wow":
      return (
        <>
          {eyes}
          <ellipse cx="50" cy="67" rx="7" ry="8.5" fill="#fff" />
        </>
      );
    case "cool":
      return (
        <>
          <path d="M18 41h64" {...line} strokeWidth={4} />
          <rect x="21" y="38" width="24" height="13" rx="6" fill={INK} />
          <rect x="55" y="38" width="24" height="13" rx="6" fill={INK} />
          <path d="M34 66q16 9 32-4" {...line} />
        </>
      );

    // --- Characters
    case "cat":
      return (
        <>
          <path d="M22 58 26 20l22 20zM78 58 74 20 52 40z" fill="#3b3b47" />
          <path d="M29 42l2-13 10 10zM71 42l-2-13-10 10z" fill="#ff9fb2" />
          <ellipse cx="50" cy="64" rx="31" ry="27" fill="#3b3b47" />
          <ellipse cx="38" cy="59" rx="6" ry="7" fill="#ffd23f" />
          <ellipse cx="62" cy="59" rx="6" ry="7" fill="#ffd23f" />
          <ellipse cx="38" cy="59" rx="2" ry="6" fill={INK} />
          <ellipse cx="62" cy="59" rx="2" ry="6" fill={INK} />
          <path d="M46 70h8l-4 4z" fill="#ff9fb2" />
          <path d="M50 74q-3 5-8 3M50 74q3 5 8 3" stroke="#d8d8e0" strokeWidth={2} />
          <path d="M14 66l18 2M14 74l18-2M86 66l-18 2M86 74l-18-2" stroke="#d8d8e0" strokeWidth={1.5} />
        </>
      );
    case "bear":
      return (
        <>
          <circle cx="26" cy="38" r="11" fill="#8a5a3b" />
          <circle cx="74" cy="38" r="11" fill="#8a5a3b" />
          <circle cx="26" cy="38" r="5.5" fill="#c48a62" />
          <circle cx="74" cy="38" r="5.5" fill="#c48a62" />
          <circle cx="50" cy="62" r="30" fill="#8a5a3b" />
          <ellipse cx="50" cy="73" rx="14" ry="11" fill="#e3b48a" />
          <circle cx="39" cy="56" r="3.5" fill={INK} />
          <circle cx="61" cy="56" r="3.5" fill={INK} />
          <ellipse cx="50" cy="67.5" rx="5.5" ry="4" fill={INK} />
          <path d="M50 71v4M44.5 76q5.5 4 11 0" stroke={INK} strokeWidth={2} />
        </>
      );
    case "robot":
      return (
        <>
          <path d="M50 20v10" stroke="#cfd6e4" strokeWidth={3} />
          <circle cx="50" cy="18" r="4.5" fill="#ff5a6a" />
          <rect x="16" y="46" width="8" height="16" rx="3" fill="#aab3c5" />
          <rect x="76" y="46" width="8" height="16" rx="3" fill="#aab3c5" />
          <path d="M22 100q0-20 28-20t28 20z" fill="#cfd6e4" />
          <rect x="42" y="72" width="16" height="10" fill="#aab3c5" />
          <rect x="23" y="29" width="54" height="46" rx="13" fill="#e4e9f2" />
          <rect x="30" y="39" width="40" height="19" rx="9.5" fill="#1b2233" />
          <circle cx="41" cy="48.5" r="4.5" fill="#56f0ff" />
          <circle cx="59" cy="48.5" r="4.5" fill="#56f0ff" />
          <rect x="39" y="64" width="22" height="4" rx="2" fill="#8a94a8" />
        </>
      );
    case "alien":
      return (
        <>
          <path d="M50 20c20 0 31 14 31 31 0 19-17 38-31 38S19 70 19 51c0-17 11-31 31-31z" fill="#7ee07a" />
          <ellipse cx="37" cy="54" rx="10" ry="6.5" fill={INK} transform="rotate(28 37 54)" />
          <ellipse cx="63" cy="54" rx="10" ry="6.5" fill={INK} transform="rotate(-28 63 54)" />
          <circle cx="34" cy="51" r="2" fill="#fff" />
          <circle cx="60" cy="51" r="2" fill="#fff" />
          <path d="M45 74q5 3 10 0" stroke="#2d6b2a" strokeWidth={2.5} />
        </>
      );
    case "ghost":
      return (
        <>
          <path d="M25 94V52c0-15 11-27 25-27s25 12 25 27v42l-8.3-6-8.3 6-8.4-6-8.3 6-8.4-6z" fill="#f4f4fa" />
          <ellipse cx="42" cy="52" rx="4.5" ry="6.5" fill={INK} />
          <ellipse cx="58" cy="52" rx="4.5" ry="6.5" fill={INK} />
          <ellipse cx="50" cy="67" rx="4.5" ry="5.5" fill={INK} />
          <circle cx="34" cy="62" r="3.5" fill="#ffb3c7" opacity={0.8} />
          <circle cx="66" cy="62" r="3.5" fill="#ffb3c7" opacity={0.8} />
        </>
      );
    case "monster":
      return (
        <>
          <path d={MONSTER_FUR} fill="#4fb4e8" />
          <circle cx="37" cy="52" r="9" fill="#fff" />
          <circle cx="63" cy="52" r="9" fill="#fff" />
          <circle cx="39" cy="54" r="4.5" fill={INK} />
          <circle cx="61" cy="54" r="4.5" fill={INK} />
          <path d="M33 68q17 16 34 0z" fill={INK} />
          <path d="M38 68.5l3 5 3-5zM56 68.5l3 5 3-5z" fill="#fff" />
        </>
      );
    case "fox":
      return (
        <>
          <path d="M18 26l20 18h24l20-18-4 34q-10 26-28 30-18-4-28-30z" fill="#f07a2a" />
          <path d="M24 33l12 12-9 6zM76 33L64 45l9 6z" fill="#6b3418" />
          <path d="M23 60q12 2 21 8 2 12 6 22-19-6-27-30zM77 60q-12 2-21 8-2 12-6 22 19-6 27-30z" fill="#fff3e6" />
          <circle cx="39" cy="57" r="3.5" fill={INK} />
          <circle cx="61" cy="57" r="3.5" fill={INK} />
          <ellipse cx="50" cy="83" rx="4.5" ry="3.5" fill={INK} />
        </>
      );
    case "frog":
      return (
        <>
          <circle cx="32" cy="44" r="13" fill="#5ec45a" />
          <circle cx="68" cy="44" r="13" fill="#5ec45a" />
          <ellipse cx="50" cy="67" rx="36" ry="25" fill="#5ec45a" />
          <circle cx="32" cy="43" r="8" fill="#fff" />
          <circle cx="68" cy="43" r="8" fill="#fff" />
          <circle cx="33" cy="44" r="4" fill={INK} />
          <circle cx="67" cy="44" r="4" fill={INK} />
          <path d="M30 68q20 15 40 0" stroke="#2c6b2a" strokeWidth={3} />
          <circle cx="25" cy="72" r="4" fill="#ff9aa8" opacity={0.7} />
          <circle cx="75" cy="72" r="4" fill="#ff9aa8" opacity={0.7} />
        </>
      );
    case "panda":
      return (
        <>
          <circle cx="27" cy="37" r="11" fill={INK} />
          <circle cx="73" cy="37" r="11" fill={INK} />
          <circle cx="50" cy="61" r="30" fill="#f7f7f2" />
          <ellipse cx="38" cy="58" rx="7.5" ry="10" fill={INK} transform="rotate(-28 38 58)" />
          <ellipse cx="62" cy="58" rx="7.5" ry="10" fill={INK} transform="rotate(28 62 58)" />
          <circle cx="39" cy="57" r="2.8" fill="#fff" />
          <circle cx="61" cy="57" r="2.8" fill="#fff" />
          <ellipse cx="50" cy="70" rx="5" ry="3.5" fill={INK} />
          <path d="M50 73v3M45 77q5 3.5 10 0" stroke={INK} strokeWidth={2} />
        </>
      );
    case "owl":
      return (
        <>
          <path d="M22 42l5-22 14 14zM78 42l-5-22-14 14z" fill="#8b5e3c" />
          <ellipse cx="50" cy="64" rx="31" ry="33" fill="#8b5e3c" />
          <ellipse cx="50" cy="88" rx="17" ry="13" fill="#c79a6b" />
          <circle cx="37" cy="52" r="12.5" fill="#f3e3c3" />
          <circle cx="63" cy="52" r="12.5" fill="#f3e3c3" />
          <circle cx="37" cy="53" r="6" fill={INK} />
          <circle cx="63" cy="53" r="6" fill={INK} />
          <circle cx="39" cy="51" r="1.8" fill="#fff" />
          <circle cx="65" cy="51" r="1.8" fill="#fff" />
          <path d="M45 63h10l-5 9z" fill="#f2a516" />
        </>
      );
  }
}
