# Aeolus in ChatGPT's plugin directory

Design by designer-chatgpt, stage 1: purpose, lessons, questions. Source: aeolus-fleet#1214, with Thomas, 27 Oct: "For chatgpt i want to have an official plugin. Those work and install 100x better than plain mcp".

OpenAI's pages read on 27 Oct, all under developers.openai.com: [S] apps-sdk/deploy/submission, [B] plugins/build/plugins, [G] plugins/plugin-guidelines (also served at apps-sdk/app-submission-guidelines), [A] apps-sdk/build/auth. OpenAI has renamed "apps" to "plugins"; the directory is shared by ChatGPT and Codex.

## 1. Purpose

**What it is.** The gateway's connection, named "Aeolus", listed in ChatGPT's Plugins directory. It is a ZIP of two files, `plugin.json` and `mcp.json`, that points ChatGPT at `https://gateway.aeolus-fleet.dev/mcp`. It adds no new behaviour: the person reaches the fleet through the same endpoint, sign-in and tools as today.

**For whom.** A person in a fleet on the hosted Aeolus, working in ChatGPT: someone who is given the right to talk with the fleet and is not technical enough to paste a connector address.

**A good outcome.**
- The person finds Aeolus in the directory, adds it in one step, signs in as they sign in to Aeolus everywhere, and sees their inbox, who they may send to, and their meetings, with nothing else to set up.
- ChatGPT shows and allows exactly what core answers for that person's ship (policy stays in core), and no message is lost or answered before `send` answered OK.
- Each gateway release that changes a tool reaches the directory without a human step, or fails visibly.
- OpenAI's reviewers get in without help from us and approve on the first or second attempt.

**Not in this purpose.** A self-hosted gateway on its own address (the listing's server address is fixed, and changing it needs OpenAI support, [S]); a ChatGPT that is an outside party calling fleet ships as tools; the A2A adapter; Claude's directory.

## 2. Lessons to check against

| Lesson | Source | Bearing |
| --- | --- | --- |
| Sign-in is pagasae's mailed link only, or the company identity once a directory is connected. The gateway has no password, test account or bypass. | decision 0054; flows.md F5; gateway code `src/core/sign-in/start-sign-in.ts` | OpenAI refuses sign-in by magic link, email code or MFA for reviewers, and rejects plugins that need extra login steps ([S], [G]) |
| Policy stays in core: the gateway shows and allows exactly what core answers for the actor. A fleet's tool switches ("Every tool needs") are the gateway's, set per fleet. | gateway CLAUDE.md; decisions 0043, 0046, 0057; gateway commits `276aed2` (S3), `22e68cc` (S4) | The tool list a reviewer or the daily scan sees depends on the fleet and on the account; OpenAI holds new or changed tools until approved ([S]) |
| An outside client waits for approval up to 7 days, and outside parties are a switch per fleet, off by default. | decision 0056; flows.md F9 | A reviewer must not wait on an approval. Whether a signed-in person using ChatGPT as the account's client passes that wait is not proven here (see 3.2) |
| A colleague given the gateway right could not reach it in a new fleet, and only the installation admin can switch the gateway on per fleet. | aeolus-fleet#1233 (onboarding audit, 25 Oct) | The reviewer's demo fleet, and every customer's fleet, needs the gateway on before the plugin works |
| A chat has no process between turns, so a message waits until the person writes in the chat. The waker is stated on the lease. | interop.md, "Chat with the connector" row and 5.x; decision 0040 | The listing must not promise to wake the person |
| The chat holds no crew token; a person works their ship behind OAuth. | interop.md 0.8, step 5 of the flow; decision 0015 | The plugin needs no secret in the ZIP, which OpenAI also forbids ([S]) |
| Delivery promises: no message lost; answer to the outside only after `send` answered OK; send carries an idempotency key. | CLAUDE.md; `aeolus_send` (`person-tools.ts:85`) | OpenAI asks tools to be safe to retry or to say when a retry repeats effects ([G]) |
| 64 KB payloads. | CLAUDE.md; `router.ts:494` | OpenAI states no response limit; ours stands |
| Before 1.0.0, no compatibility layers or polish for zero customers. | decision 0013 | Skip translations, country lists, screenshots; the pages call them optional |
| One OAuth server for MCP and A2A: CIMD and pre-registered clients, RFC 9728, RFC 8707. | interop.md "Outside identity"; README ("There is no dynamic registration") | ChatGPT prefers CIMD; no DCR is needed if CIMD works (see 3.1) |

## 3. What the gateway already meets and what is missing

### 3.1 Already meets (gateway at `d2f489d`)

| Need | Source of the need | Where the gateway meets it |
| --- | --- | --- |
| One remote MCP server on a public HTTPS endpoint | [S] | `/mcp`, `mcp-endpoint.ts:170`; hostname `gateway.aeolus-fleet.dev` from `GATEWAY_PUBLIC_URL` |
| OAuth authorization code with PKCE `S256` | [A] | `read-authorization.ts:101`; metadata `oauth-routes.ts:286` |
| Protected resource metadata, and `WWW-Authenticate: Bearer resource_metadata=...` on a 401 | [A] | `oauth-routes.ts:276-277`; `mcp-endpoint.ts:163-173` |
| Authorization server metadata | [A] | `oauth-routes.ts:278-290`. `openid-configuration` is not served; [A] accepts either document |
| CIMD, which ChatGPT prefers | [A] | `client_id_metadata_document_supported: true` (`oauth-routes.ts:288`); `read-authorization.ts:39-80`. Not proven against ChatGPT's own client document (`https://chatgpt.com/oauth/client.json`): all its `redirect_uris` must pass `redirect-uri.ts` |
| `iss` on every authorization response (RFC 9207), which lets ChatGPT use its stable redirect | [A] | `issue-code.ts:43`; `oauth-routes.ts:139`, `:289` |
| `resource` audience binding | [A] | `read-authorization.ts:104`; `authenticate-access-token.ts:28` |
| Refresh tokens | [A] | 1 h access, 30 days refresh, rotated (`exchange-token.ts:9-11`) |
| Fixed, small tool set for an account | [G] ("each operation a separate tool") | 11 tools, no generic executor (`person-tools.ts:156`) |
| No secrets or hooks in the package | [S], [B] | Nothing to ship: no crew token, no client secret (CIMD client is public) |

### 3.2 Missing

| Missing | Source of the need | Who |
| --- | --- | --- |
| **Reviewer sign-in** without magic link, code or MFA; a demo fleet with the gateway on, a group giving the right, a person ship, sample data, kept available for later reviews. Today there is no such path. | [S], [G]; aeolus-fleet#1214; #1233 | Thomas decides (Q3); build follows |
| **Explicit `readOnlyHint`, `destructiveHint`, `openWorldHint` booleans on every tool.** None set today (`person-tools.ts`). | [G] | build |
| **Tool text that fits the rules:** a description per tool covering purpose, when to use, limits and side effects; responses without ids or timestamps beyond what is strictly required (the person tools return delivery and message ids that later calls need). | [G] | build, checked in stage 2 |
| **Per-tool `securitySchemes`** and a runtime `_meta["mcp/www_authenticate"]` (with `error` and `error_description`) when a call needs sign-in again. Neither exists anywhere in the repo. | [A] | build |
| **Domain proof:** the challenge token as plain text at `/.well-known/openai-apps-challenge` on the gateway's host. Today only the two OAuth well-known routes exist. | [S] | build; the token comes from Thomas's OpenAI portal |
| **Four pages:** website, support, privacy policy, terms of service, HTTPS, same publisher as the submission. The gateway serves none, and its pages are `noindex` (`web/app/layout.tsx:9-12`). | [S] | Thomas writes and owns them (Q6) |
| **Listing material:** display name and short description (30 characters each), long description, category, square logo of at least 48 px, brand colours. | [S] | Thomas approves the words; build holds them in the package |
| **Review material:** exactly 5 positive and 3 negative test cases, each positive run with the reviewer account first; a demo video reachable by reviewers; release notes; the commerce answer. | [S] | build produces the cases; Thomas approves the video |
| **The package itself:** `plugin.json` (with `$schema`, `name`, `version`, `description`, `extensions.com.openai`) and `mcp.json` with the server `type` `streamable-http`, and its source and build in this repository. | [S], [B] | build |
| **Verified server address for the OAuth fields:** `mcp.json` declares `auth.type: oauth` and `client.mode: cimd`; the portal has no editor for it, so a mistake costs a new upload. | [S] | build |
| **Enterprise workspaces:** whether a directory plugin needs workspace-admin approval is not stated on any page read; OIDC scopes and a UserInfo endpoint are needed only if a workspace should be able to restrict identity linking to its verified domain. | [A] | Thomas asks OpenAI support; not part of the first submission |

### 3.3 Only Thomas can do

- Verify an individual or business identity in the OpenAI platform organisation that submits, and choose the developer identity the directory shows (Q5). Other members need the `Apps Management Write` role from an organisation owner ([S]).
- Write the privacy policy and terms, and name the support contact (Q6).
- Enter reviewer credentials in the portal under Review details; they are never in the ZIP ([S]).
- Answer the policy attestations at submit, the commerce question, and the age statement ([G] asks for a service suitable for ages 13 to 17; Aeolus serves staff of organisations).
- Press Publish after approval, and appeal by replying to OpenAI's email.
- Ask OpenAI support about enterprise workspaces and about any server address change.
- Neither [S] nor [G] states a review turnaround, a ZIP size limit or the list of categories; Thomas finds out in the portal.

### 3.4 Updating after approval

OpenAI scans the hosted server daily. Existing tools keep their approved metadata while a change is held; a new tool stays unavailable until approved; package changes need a new ZIP and a new review ([S]). So every gateway release that adds or changes a person tool is a held update until OpenAI approves it. This is a fact to design for in stage 2, not a question.

### 3.5 Claude's directory, one line

Claude's connector directory is a separate submission for the same endpoint, with its own review; its pages ask for tool annotations, OAuth, a dedicated support channel and a fully populated test account, and were not read in full here (claude.com/docs/connectors/building/submission).

## 4. Questions for Thomas

**Q1. Who is the plugin for?** The gateway serves two kinds of caller: a person signing in with their account (11 fixed tools: inbox, open, answer, done, ships, send, meeting, mic, ask for an outside server), and an outside party, whose tool list is built from discovery per fleet (`<alias>__<capability>`, no annotations). OpenAI reviews and scans one fixed list, and holds changes to it.
1. The person with an account only. The listing describes working your own ship from ChatGPT. Outside parties still add the gateway by URL. Review sees the fixed list.
2. Both. The directory plugin also serves outside-party tools. Their list changes with each fleet and each approval, so OpenAI would hold or hide them again and again.

Pick 1: the purpose above, and a list OpenAI can approve once.

**Q2. Hosted only?** The listing's server address is fixed to `https://gateway.aeolus-fleet.dev/mcp`, and changing it needs OpenAI support.
1. Hosted Aeolus only. A self-hosted gateway keeps adding its address by URL, as today.
2. Also give self-hosters a way in. [S] describes none; it would mean a plugin per gateway address.

Pick 1: nothing else is possible without OpenAI.

**Q3. How does a reviewer sign in?** OpenAI needs a dedicated account that works at once, with no mailed link, code or MFA, and no extra sign-up step. Aeolus signs people in by pagasae's mailed link; decision 0054 says that once an organisation connects a directory, people sign in with that identity instead.
1. A demo organisation in pagasae connected to a sign-in provider with a password, which is the identity path decision 0054 already has. The reviewer's account sits in a demo fleet with the gateway on, sample data and one person ship. No new gateway behaviour.
2. A password sign-in for named reviewer accounts in pagasae. A new way in, in another repository, and a second door to guard.
3. Ask OpenAI to accept a mailed link read from a mailbox they can open. Their pages forbid it, so this is a request for an exception, and a refusal costs a review round.
4. A fixed bypass in the gateway for a reviewer. It breaks "policy stays in core" and adds a standing hole.

Pick 1: it uses a recorded decision, adds nothing to the gateway, and the demo fleet doubles as the data for the test cases and the video. Option 3 stays as the fallback if pagasae cannot connect such a provider.

**Q4. What does the package hold?** [S] allows `skills/` beside the connection, and a skill can tell ChatGPT how to use the Aeolus tools.
1. The connection only: `plugin.json` and `mcp.json`.
2. The connection plus one skill that explains the inbox, answering and "done".

Pick 1: the issue asks for the connection to be listed, the tool descriptions already carry the how, and a skill is one more thing for the review to read. A skill can follow as its own issue if the walk shows a need.

**Q5. Whose name is on the listing?** The directory shows a verified developer identity, and the four URLs must identify the same publisher ([S]).
1. Thomas as a verified individual.
2. A business, if a legal entity runs the hosted Aeolus: the name that the privacy policy and terms already carry.

Pick 2 if such an entity exists, because accounts and personal data are held in its name; otherwise 1.

**Q6. Where do the four pages live, and who writes them?** The gateway has none and every page is `noindex`. Website, support, privacy and terms are about the whole hosted service (accounts are pagasae's), not only the gateway.
1. On Aeolus's own public site, outside this repository, written by Thomas. The gateway serves only the domain proof.
2. On the gateway's host, as static pages in this repository. The text still comes from Thomas.

Pick 1: the text belongs to the service, and the gateway stays an MCP and OAuth endpoint. If no public site exists yet, say so and I will treat it as a build dependency in stage 2.

**Q7. Where does the package live?** The ZIP's server address and the tool list change together with the gateway.
1. In this repository: a folder with `plugin.json`, `mcp.json` and the logo, and an npm script that builds the ZIP, versioned with the gateway's release.
2. In its own repository.

Pick 1: CLAUDE.md names one package, and a tool change then lands with the new ZIP version in one pull request.
