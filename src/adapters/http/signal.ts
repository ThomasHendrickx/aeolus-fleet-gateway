/**
 * The gateway's pages in direction B, Signal (design/gateway-pages), drawn
 * with the operator console's tokens: one large shape leads each page, a
 * ring for a state or a count. The tokens are the console's own
 * (aeolus-fleet packages/console/app/tokens.css), light by default and dark
 * where the browser asks for it, as the pages have no theme switch.
 */
import { escaped } from './html.js';

const LIGHT_TOKENS = `--background:oklch(0.99 0.002 247);--card:oklch(1 0 0);--muted:oklch(0.967 0.005 247);--secondary:oklch(0.955 0.007 247);--accent:oklch(0.95 0.009 247);
--foreground:oklch(0.22 0.02 257);--muted-foreground:oklch(0.5 0.02 257);--border:oklch(0.912 0.008 247);--input:oklch(0.885 0.01 247);--ring:oklch(0.56 0.12 257);
--primary:oklch(0.34 0.08 257);--primary-hover:oklch(0.29 0.075 257);--primary-foreground:oklch(0.985 0.003 247);--destructive:oklch(0.53 0.2 27);--destructive-foreground:oklch(0.99 0 0);
--tone-waiting-bg:oklch(0.965 0.045 85);--tone-waiting-fg:oklch(0.47 0.1 62);--tone-waiting-border:oklch(0.87 0.08 80);
--tone-active-bg:oklch(0.955 0.03 250);--tone-active-fg:oklch(0.45 0.14 257);--tone-active-border:oklch(0.86 0.06 252);
--tone-ok-bg:oklch(0.96 0.04 155);--tone-ok-fg:oklch(0.44 0.1 155);--tone-ok-border:oklch(0.86 0.07 155);
--tone-attention-bg:oklch(0.957 0.028 25);--tone-attention-fg:oklch(0.5 0.19 27);--tone-attention-border:oklch(0.86 0.07 25);
--tone-ended-bg:oklch(0.957 0.005 247);--tone-ended-fg:oklch(0.47 0.015 257);--tone-ended-border:oklch(0.87 0.01 247);
--shadow-sm:0 1px 2px oklch(0.2 0.02 257 / 0.06);`;

const DARK_TOKENS = `color-scheme:dark;--background:oklch(0.172 0.012 257);--card:oklch(0.2 0.013 257);--muted:oklch(0.228 0.012 257);--secondary:oklch(0.255 0.013 257);--accent:oklch(0.26 0.014 257);
--foreground:oklch(0.955 0.005 247);--muted-foreground:oklch(0.72 0.016 257);--border:oklch(0.29 0.014 257);--input:oklch(0.34 0.015 257);--ring:oklch(0.7 0.1 252);
--primary:oklch(0.86 0.055 250);--primary-hover:oklch(0.92 0.035 250);--primary-foreground:oklch(0.21 0.035 257);--destructive:oklch(0.56 0.19 25);--destructive-foreground:oklch(0.99 0 0);
--tone-waiting-bg:oklch(0.29 0.055 72);--tone-waiting-fg:oklch(0.87 0.11 82);--tone-waiting-border:oklch(0.41 0.075 72);
--tone-active-bg:oklch(0.29 0.06 257);--tone-active-fg:oklch(0.85 0.08 252);--tone-active-border:oklch(0.42 0.09 257);
--tone-ok-bg:oklch(0.29 0.05 155);--tone-ok-fg:oklch(0.86 0.1 155);--tone-ok-border:oklch(0.41 0.07 155);
--tone-attention-bg:oklch(0.3 0.07 25);--tone-attention-fg:oklch(0.84 0.09 25);--tone-attention-border:oklch(0.45 0.11 25);
--tone-ended-bg:oklch(0.255 0.01 257);--tone-ended-fg:oklch(0.78 0.015 257);--tone-ended-border:oklch(0.36 0.012 257);
--shadow-sm:0 1px 2px oklch(0 0 0 / 0.3);`;

const STYLE = `
:root { color-scheme: light; ${LIGHT_TOKENS} --font-sans: "Geist", ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif; --font-mono: "Geist Mono", ui-monospace, "SF Mono", Menlo, Consolas, monospace; --radius-sm: 6px; --radius-md: 8px; --radius-lg: 10px; }
@media (prefers-color-scheme: dark) { :root { ${DARK_TOKENS} } }
* { box-sizing: border-box; }
body { margin: 0; font: 14px/20px var(--font-sans); color: var(--foreground); background: var(--background); }
a { color: inherit; }
.top { display: flex; align-items: center; gap: 16px; height: 56px; padding: 0 16px; border-bottom: 1px solid var(--border); }
.mark { display: flex; align-items: center; gap: 8px; font-weight: 600; text-decoration: none; }
.tabs { display: flex; gap: 4px; }
.tab { display: flex; align-items: center; gap: 6px; height: 32px; padding: 0 10px; border-radius: var(--radius-sm); color: var(--muted-foreground); text-decoration: none; }
.tab[aria-current="page"] { color: var(--foreground); background: var(--secondary); }
main { max-width: 720px; margin: 0 auto; padding: 32px 16px; display: grid; gap: 24px; }
.lead { display: flex; align-items: center; gap: 20px; }
.lead h1 { margin: 0; font-size: 22px; line-height: 28px; font-weight: 600; }
.ring { flex: none; }
.card { display: grid; gap: 12px; padding: 16px; border: 1px solid var(--border); border-radius: var(--radius-lg); background: var(--card); box-shadow: var(--shadow-sm); }
.card h2 { margin: 0; font-size: 15px; line-height: 20px; font-weight: 600; }
.card p { margin: 0; }
.muted { color: var(--muted-foreground); }
.badge { display: inline-flex; align-items: center; gap: 4px; padding: 0 6px; height: 20px; border: 1px solid; border-radius: var(--radius-sm); font-size: 12px; font-weight: 500; }
.tone-waiting { color: var(--tone-waiting-fg); background: var(--tone-waiting-bg); border-color: var(--tone-waiting-border); }
.tone-active { color: var(--tone-active-fg); background: var(--tone-active-bg); border-color: var(--tone-active-border); }
.tone-ok { color: var(--tone-ok-fg); background: var(--tone-ok-bg); border-color: var(--tone-ok-border); }
.tone-attention { color: var(--tone-attention-fg); background: var(--tone-attention-bg); border-color: var(--tone-attention-border); }
.tone-ended { color: var(--tone-ended-fg); background: var(--tone-ended-bg); border-color: var(--tone-ended-border); }
.actions { display: flex; flex-wrap: wrap; gap: 8px; }
form { margin: 0; }
button, .button { display: inline-flex; align-items: center; justify-content: center; gap: 6px; height: 36px; padding: 0 14px; border: 1px solid var(--input); border-radius: var(--radius-md); font: inherit; font-weight: 500; color: var(--foreground); background: var(--card); text-decoration: none; cursor: pointer; }
button.primary, .button.primary { color: var(--primary-foreground); background: var(--primary); border-color: var(--primary); }
button.primary:hover, .button.primary:hover { background: var(--primary-hover); }
button.destructive { color: var(--destructive-foreground); background: var(--destructive); border-color: var(--destructive); }
button:focus-visible, .button:focus-visible, .tab:focus-visible { outline: 2px solid var(--ring); outline-offset: 2px; }
.alert { border-width: 1px; border-style: solid; }
.party-mark { display: inline-flex; align-items: center; justify-content: center; flex: none; width: 40px; height: 40px; border-radius: var(--radius-md); background: var(--secondary); border: 1px solid var(--border); font: 600 13px/1 var(--font-mono); }
.handshake { display: flex; align-items: center; justify-content: center; gap: 12px; }
.handshake figure { margin: 0; display: grid; justify-items: center; gap: 4px; font-size: 12px; }
.fleet-mark { display: inline-flex; }
.split { display: grid; gap: 24px; grid-template-columns: minmax(0, 1fr); }
@media (min-width: 900px) { main.wide { max-width: 1040px; } .split { grid-template-columns: minmax(0, 1fr) 280px; } }
.queue { display: grid; gap: 8px; align-content: start; }
.queue h2 { margin: 0; font-size: 12px; font-weight: 500; color: var(--muted-foreground); }
.item { display: flex; align-items: center; gap: 12px; padding: 10px 12px; border: 1px solid var(--border); border-radius: var(--radius-lg); background: var(--card); text-decoration: none; }
.item[aria-current="true"] { border-color: var(--primary); }
.item .text { display: grid; min-width: 0; flex: 1; } .item .text span { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.tag { display: inline-flex; align-items: center; gap: 4px; font-size: 12px; color: var(--muted-foreground); }
.mono { font-family: var(--font-mono); font-size: 12px; }
.field { display: grid; gap: 4px; } .field > span { font-size: 13px; font-weight: 500; }
input[type="text"], input[type="password"], input[type="number"], input[type="url"], select { height: 36px; padding: 0 10px; border: 1px solid var(--input); border-radius: var(--radius-md); background: var(--background); color: var(--foreground); font: inherit; }
.scope { display: flex; align-items: center; gap: 10px; padding: 8px 10px; border: 1px solid var(--border); border-radius: var(--radius-md); }
.scope .label { flex: 1; }
.scopes { display: grid; gap: 6px; }
fieldset { border: 0; margin: 0; padding: 0; display: grid; gap: 8px; }
legend { font-size: 13px; font-weight: 500; padding: 0; margin-bottom: 4px; }
main.centred { max-width: 440px; min-height: 100vh; align-content: center; justify-items: center; text-align: center; }
main.centred > * { width: 100%; } main.centred p, main.centred h1 { margin: 0; } main.centred { gap: 16px; }
main.centred > .mark, main.centred > .ring, main.centred > .badge { width: auto; }
.tiles { display: grid; gap: 12px; grid-template-columns: 1fr 1fr; }
@media (max-width: 480px) { .tiles { grid-template-columns: 1fr; } }
.tile { display: grid; gap: 4px; justify-items: center; align-content: center; height: auto; min-height: 112px; padding: 16px; border-radius: var(--radius-lg); text-align: center; }
.tile:hover { border-color: var(--primary); }
.going-on { display: inline-flex; align-items: center; gap: 6px; font-size: 12px; color: var(--muted-foreground); }
.going-on::before { content: ""; width: 8px; height: 8px; border-radius: 50%; background: var(--tone-ok-fg); }
.tab { white-space: nowrap; }
@media (max-width: 480px) { .top .label { display: none; } .top { gap: 8px; } }
.sign-out { margin-left: auto; } .sign-out button { height: 32px; border: 0; background: transparent; color: var(--muted-foreground); }
.answers { display: grid; gap: 8px; } .answers button { height: 44px; }
button.pick { outline: 2px dashed var(--ring); outline-offset: 2px; }
.payload { margin: 0; white-space: pre-wrap; overflow-wrap: anywhere; font: inherit; }
textarea { padding: 8px 10px; border: 1px solid var(--input); border-radius: var(--radius-md); background: var(--background); color: var(--foreground); font: inherit; resize: vertical; }
form > button.item { width: 100%; height: auto; justify-content: flex-start; text-align: left; font-weight: 400; }
.live-status { position: fixed; right: 16px; bottom: 16px; margin: 0; }
.party-cards { display: grid; gap: 12px; grid-template-columns: repeat(auto-fill, minmax(260px, 1fr)); }
.party-card { color: inherit; text-decoration: none; display: grid; grid-template-columns: auto minmax(0, 1fr); gap: 8px 12px; padding: 12px; border: 1px solid var(--border); border-radius: var(--radius-lg); background: var(--card); }
.party-card:hover { border-color: var(--ring, var(--primary)); }
.party-card .text { display: grid; min-width: 0; } .party-card .text > span { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.party-card .facts { grid-column: 1 / -1; display: flex; flex-wrap: wrap; align-items: center; gap: 8px; }
.tag.protocol { padding: 0 4px; border: 1px solid var(--border); border-radius: var(--radius-sm); font: 600 10px/16px var(--font-mono); color: var(--foreground); }
.back { display: inline-flex; align-items: center; gap: 6px; color: var(--primary); text-decoration: none; font-size: 14px; }
.party-head { display: grid; justify-items: center; gap: 8px; }
.party-head .facts { display: flex; flex-wrap: wrap; justify-content: center; gap: 8px; }
.fact-rows { margin: 0; padding: 0; border: 1px solid var(--border); border-radius: var(--radius-lg); background: var(--card); }
.fact-rows > div { display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: 8px; padding: 12px 16px; border-top: 1px solid var(--border); }
.fact-rows > div:first-child { border-top: 0; }
.fact-rows dt { display: inline-flex; align-items: center; gap: 8px; color: var(--muted-foreground); font-size: 13px; }
.fact-rows dd { margin: 0; display: flex; flex-wrap: wrap; justify-content: flex-end; gap: 4px; min-width: 0; overflow-wrap: anywhere; text-align: right; }
.fact-rows dd a { margin-left: 8px; color: var(--primary); font-size: 13px; font-weight: 500; text-decoration: none; }
.steps { margin: 0; padding: 0; list-style: none; display: grid; grid-template-columns: repeat(3, 1fr); gap: 8px; font-size: 12px; color: var(--muted-foreground); }
.steps li { padding-top: 8px; border-top: 4px solid var(--border); }
.steps li.done { border-top-color: var(--primary); color: var(--foreground); }
.tool-rows { margin: 0; padding: 0; list-style: none; display: grid; gap: 8px; width: 100%; text-align: left; }
.tool-rows li { display: grid; gap: 2px; padding: 8px 0; border-top: 1px solid var(--border); }
.consequences { margin: 0; padding: 0; list-style: none; display: grid; gap: 8px; }
.consequences li { display: flex; align-items: center; gap: 8px; }
.counts { display: flex; flex-wrap: wrap; gap: 4px; align-items: center; margin: 4px 0 0; }
@media (max-width: 640px) { .actions > * { flex: 1; } button, .button { height: 44px; width: 100%; } }
`;

/** A tone family of the console: every state shows in exactly one. */
export type Tone = 'waiting' | 'active' | 'ok' | 'attention' | 'ended';

/** An icon the pages draw, from the console's icon set (Lucide), as inline SVG paths. */
export type Icon = 'plug' | 'power' | 'powerOff' | 'alert' | 'signIn' | 'house' | 'hourglass' | 'check' | 'x' | 'ban' | 'lock' | 'server' | 'laptop' | 'arrowLeftRight' | 'users' | 'shieldX' | 'timerOff' | 'signOut' | 'archive' | 'arrowLeft' | 'ship' | 'shield';

const ICON_PATHS: Record<Icon, string> = {
  plug: '<path d="M12 22v-5"/><path d="M9 8V2"/><path d="M15 8V2"/><path d="M18 8v5a4 4 0 0 1-4 4h-4a4 4 0 0 1-4-4V8Z"/>',
  power: '<path d="M12 2v10"/><path d="M18.4 6.6a9 9 0 1 1-12.77.04"/>',
  powerOff: '<path d="M18.36 6.64A9 9 0 0 1 20.77 15"/><path d="M6.16 6.16a9 9 0 1 0 12.68 12.68"/><path d="M12 2v4"/><path d="m2 2 20 20"/>',
  alert: '<path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3"/><path d="M12 9v4"/><path d="M12 17h.01"/>',
  signIn: '<path d="M15 3h4a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-4"/><path d="m10 17 5-5-5-5"/><path d="M15 12H3"/>',
  house: '<path d="M15 21v-8a1 1 0 0 0-1-1h-4a1 1 0 0 0-1 1v8"/><path d="M3 10a2 2 0 0 1 .709-1.528l7-5.999a2 2 0 0 1 2.582 0l7 5.999A2 2 0 0 1 21 10v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>',
  hourglass: '<path d="M5 22h14"/><path d="M5 2h14"/><path d="M17 22v-4.172a2 2 0 0 0-.586-1.414L12 12l-4.414 4.414A2 2 0 0 0 7 17.828V22"/><path d="M7 2v4.172a2 2 0 0 0 .586 1.414L12 12l4.414-4.414A2 2 0 0 0 17 6.172V2"/>',
  check: '<path d="M20 6 9 17l-5-5"/>',
  x: '<path d="M18 6 6 18"/><path d="m6 6 12 12"/>',
  ban: '<circle cx="12" cy="12" r="10"/><path d="m4.9 4.9 14.2 14.2"/>',
  lock: '<rect width="18" height="11" x="3" y="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/>',
  server: '<rect width="20" height="8" x="2" y="2" rx="2" ry="2"/><rect width="20" height="8" x="2" y="14" rx="2" ry="2"/><path d="M6 6h.01"/><path d="M6 18h.01"/>',
  laptop: '<path d="M18 5a2 2 0 0 1 2 2v8.526a2 2 0 0 0 .212.897l1.068 2.127a1 1 0 0 1-.9 1.45H3.62a1 1 0 0 1-.9-1.45l1.068-2.127A2 2 0 0 0 4 15.526V7a2 2 0 0 1 2-2z"/><path d="M20.054 15.987H3.946"/>',
  arrowLeftRight: '<path d="M8 3 4 7l4 4"/><path d="M4 7h16"/><path d="m16 21 4-4-4-4"/><path d="M20 17H4"/>',
  signOut: '<path d="m16 17 5-5-5-5"/><path d="M21 12H9"/><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/>',
  shieldX: '<path d="M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1z"/><path d="m14.5 9.5-5 5"/><path d="m9.5 9.5 5 5"/>',
  timerOff: '<path d="M10 2h4"/><path d="M4.6 11a8 8 0 0 0 1.7 8.7 8 8 0 0 0 8.7 1.7"/><path d="M7.4 7.4a8 8 0 0 1 10.3 1 8 8 0 0 1 .9 10.2"/><path d="m2 2 20 20"/><path d="M12 12v-2"/>',
  archive: '<rect width="20" height="5" x="2" y="3" rx="1"/><path d="M4 8v11a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8"/><path d="M10 12h4"/>',
  arrowLeft: '<path d="m12 19-7-7 7-7"/><path d="M19 12H5"/>',
  ship: '<path d="M12 10.189V14"/><path d="M12 2v3"/><path d="M19 13V7a2 2 0 0 0-2-2H7a2 2 0 0 0-2 2v6"/><path d="M19.38 20A11.6 11.6 0 0 0 21 14l-8.188-3.639a2 2 0 0 0-1.624 0L3 14a11.6 11.6 0 0 0 2.81 7.76"/><path d="M2 21c.6.5 1.2 1 2.5 1 2.5 0 2.5-2 5-2 1.3 0 1.9.5 2.5 1s1.2 1 2.5 1c2.5 0 2.5-2 5-2 1.3 0 1.9.5 2.5 1"/>',
  shield: '<path d="M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1z"/>',
  users: '<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/>',
};

export function icon(name: Icon, size = 16): string {
  return `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICON_PATHS[name]}</svg>`;
}

/** A status as the console shows it: its tone, an icon and a label, never colour alone. */
export function statusBadge(status: { tone: Tone; icon: Icon; label: string }): string {
  return `<span class="badge tone-${status.tone}">${icon(status.icon, 12)}${escaped(status.label)}</span>`;
}

/** The app mark from aeolus-fleet brand/aeolus-mark.svg: the Ship glyph on a tile in --primary, its stroke in --primary-foreground. */
const MARK = `<svg width="24" height="24" viewBox="0 0 32 32" aria-hidden="true"><rect width="32" height="32" rx="7" fill="var(--primary)"/><g fill="none" stroke="var(--primary-foreground)" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" transform="translate(6 6) scale(0.8333)"><path d="M12 2v2"/><path d="M12 9.189V13"/><path d="M19 12V6a2 2 0 00-2-2H7a2 2 0 00-2 2v6"/><path d="M19.38 19A11.6 11.6 0 0021 13l-8.188-3.639a2 2 0 00-1.624 0L3 13.001a11.6 11.6 0 002.81 7.76"/><path d="M2 20c.6.5 1.2 1 2.5 1 2.5 0 2.5-2 5-2 1.3 0 1.9.5 2.5 1s1.2 1 2.5 1c2.5 0 2.5-2 5-2 1.3 0 1.9.5 2.5 1"/></g></svg>`;

const MARK_LARGE = MARK.replace('width="24" height="24"', 'width="40" height="40"');

const RING_SIZE = 96;
const RING_STROKE = 6;

/** The large shape that leads a page: a full ring in a tone, dashed for a state that ended, around an icon or a number. */
export function ring(shown: { tone: Tone; center: { icon: Icon } | { count: number } | { text: string; icon: Icon }; label: string; isDashed?: boolean; size?: number }): string {
  const size = shown.size ?? RING_SIZE;
  const radius = (size - RING_STROKE) / 2;
  const middle = size / 2;
  const dash = shown.isDashed === true ? ' stroke-dasharray="4 6"' : '';
  const iconSize = Math.round(size * 0.3);
  let center: string;
  if ('count' in shown.center) {
    center = `<text x="${middle}" y="${middle}" text-anchor="middle" dominant-baseline="central" font-size="28" font-weight="600" fill="currentColor">${shown.center.count}</text>`;
  } else if ('text' in shown.center) {
    // An icon above a short text, such as the time left; the page may update the text.
    center = `<foreignObject x="${middle - 14}" y="${middle - 34}" width="28" height="28"><div xmlns="http://www.w3.org/1999/xhtml" style="color:var(--tone-${shown.tone}-fg)">${icon(shown.center.icon, 24)}</div></foreignObject><text x="${middle}" y="${middle + 10}" text-anchor="middle" dominant-baseline="central" font-size="22" font-weight="600" fill="currentColor" data-time-left>${escaped(shown.center.text)}</text><text x="${middle}" y="${middle + 34}" text-anchor="middle" font-size="12" fill="var(--muted-foreground)">left</text>`;
  } else {
    center = `<foreignObject x="${middle - iconSize / 2}" y="${middle - iconSize / 2}" width="${iconSize}" height="${iconSize}"><div xmlns="http://www.w3.org/1999/xhtml" style="color:var(--tone-${shown.tone}-fg)">${icon(shown.center.icon, iconSize)}</div></foreignObject>`;
  }
  return `<svg class="ring" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}" role="img" aria-label="${escaped(shown.label)}"><circle cx="${middle}" cy="${middle}" r="${radius}" fill="none" stroke="var(--tone-${shown.tone}-fg)" stroke-width="${RING_STROKE}"${dash}/>${center}</svg>`;
}

/** An outside party's mark: the first two letters of its name on a tile, as the console's Avatar draws a ship. */
export function partyMark(name: string): string {
  return `<span class="party-mark" aria-hidden="true">${escaped(name.replaceAll(/[^\p{L}\p{N}]/gu, '').slice(0, 2).toUpperCase())}</span>`;
}

/** Who meets whom: the outside party's mark and the fleet's, side by side. */
export function handshake(party: { name: string; fleet?: string }): string {
  return `<div class="handshake"><figure>${partyMark(party.name)}<figcaption>${escaped(party.name)}</figcaption></figure><span class="muted">${icon('arrowLeftRight', 16)}</span><figure><span class="fleet-mark">${MARK_LARGE}</span><figcaption>${escaped(party.fleet ?? 'Fleet')}</figcaption></figure></div>`;
}

/** A tab of the pages' top bar. */
export type Tab = 'overview' | 'outsideParties';

const TABS: Record<Tab, { label: string; icon: Icon; href: string }> = {
  overview: { label: 'Overview', icon: 'house', href: '/overview' },
  outsideParties: { label: 'Outside parties', icon: 'plug', href: '/outside-parties' },
};

function topBar(current: Tab | undefined, isSignedIn: boolean): string {
  const tabs = Object.entries(TABS)
    .map(([tab, shown]) => `<a class="tab" href="${shown.href}" aria-label="${escaped(shown.label)}"${tab === current ? ' aria-current="page"' : ''}>${icon(shown.icon, 14)}<span class="label">${escaped(shown.label)}</span></a>`)
    .join('');
  // A person signed in to the pages signs out here; a console session signs out in the console.
  const signOut = isSignedIn ? `<form method="post" action="/sign-out" class="sign-out"><button aria-label="Sign out">${icon('signOut', 14)}<span class="label">Sign out</span></button></form>` : '';
  return `<header class="top"><a class="mark" href="/overview">${MARK}Aeolus</a><nav class="tabs">${tabs}</nav>${signOut}</header>`;
}

/** Where a signed-out caller signs in: the gateway's own sign-in through pagasae, or nowhere, on a gateway that signs no one in. */
export type SignInWay = 'pages' | 'none';

/** What a signed-out caller is shown: why, and the one way to sign in, coming back to the page they asked for. */
export function signInPrompt(shown: { message: string; way: SignInWay; returnTo: string }): string {
  if (shown.way === 'none') {
    return `<section class="card"><h2>This gateway signs no one in</h2><p class="muted">Its pages are for people signed in through pagasae, which its operator has not set.</p></section>`;
  }
  const link = `<a class="button" href="/sign-in?${new URLSearchParams({ return_to: shown.returnTo }).toString().replaceAll('&', '&amp;')}">${icon('signIn', 14)}Sign in</a>`;
  return `<section class="card"><h2>${escaped(shown.message)}</h2><div class="actions">${link}</div></section>`;
}

/**
 * What a live page runs: it opens /live for itself and swaps in each section
 * it is sent; when the socket drops it shows Reconnecting and opens again
 * with backoff, never for a refusal (4401 to 4404). Every minute it counts
 * each days left down from its expiry, with no call to the gateway.
 */
const LIVE_SCRIPT = `(function (query) {
  var DAY = 86400000, wait = 500, status = document.querySelector('[data-live-status]');
  function countDown() {
    document.querySelectorAll('[data-expires-at]').forEach(function (holder) {
      var badge = holder.querySelector('.badge'), label = badge && badge.lastChild;
      if (!label) return;
      var days = Math.ceil((Date.parse(holder.getAttribute('data-expires-at')) - Date.now()) / DAY);
      badge.className = 'badge ' + (days <= 0 ? 'tone-ended' : days <= 1 ? 'tone-attention' : 'tone-waiting');
      label.textContent = days <= 0 ? 'Expired' : days <= 1 ? 'Last day' : days + ' d left';
    });
  }
  function open() {
    var socket = new WebSocket((location.protocol === 'https:' ? 'wss://' : 'ws://') + location.host + '/live?' + query);
    socket.onopen = function () { wait = 500; status.hidden = true; };
    socket.onmessage = function (event) {
      var sections = JSON.parse(event.data).sections;
      Object.keys(sections).forEach(function (name) {
        var section = document.querySelector('[data-live="' + name + '"]');
        if (section) section.innerHTML = sections[name];
      });
      countDown();
    };
    socket.onclose = function (event) {
      if (event.code >= 4401 && event.code <= 4404) return;
      status.hidden = false;
      setTimeout(open, wait);
      wait = Math.min(wait * 2, 10000);
    };
  }
  open();
  setInterval(countDown, 60000);
})(document.currentScript.getAttribute('data-live-query'));`;

/**
 * A page a person meets on their way in, from an outside MCP client: the
 * mark and its name above one centred column, no tabs. Its own script, if
 * any, comes with its body.
 */
export function signInPage(page: { title: string; body: string }): string {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${escaped(page.title)}</title><style>${STYLE}</style></head><body><main class="centred"><div class="mark">${MARK}Aeolus</div>${page.body}</main></body></html>`;
}

/** A whole Signal page: the top bar with its tabs, then the page's own body; a live page names itself to the live channel. */
export function signalPage(page: { title: string; tab?: Tab; body: string; isWide?: boolean; live?: string; isSignedIn?: boolean }): string {
  const live =
    page.live === undefined
      ? ''
      : `<p data-live-status hidden class="live-status">${statusBadge({ tone: 'waiting', icon: 'hourglass', label: 'Reconnecting' })}</p><script data-live-query="${escaped(page.live)}">${LIVE_SCRIPT}</script>`;
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${escaped(page.title)}</title><style>${STYLE}</style></head><body>${topBar(page.tab, page.isSignedIn === true)}<main${page.isWide === true ? ' class="wide"' : ''}>${page.body}</main>${live}</body></html>`;
}
