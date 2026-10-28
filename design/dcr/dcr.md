# Dynamic client registration in the gateway

Design by designer-dcr, stage 1: purpose, lessons to check against, questions. No detailed decisions until the purpose is agreed. Source: aeolus-fleet#1328, release 0.34.0.

Sources read on 28 Oct: the MCP authorization spec, versions 2026-07-28 and 2025-11-25 ([M]); RFC 7591 ([R]) and RFC 7592; Google's pages: the Gemini app's custom apps (support.google.com/gemini/answer/17209137, [GA]), Gemini Enterprise's custom MCP server (support.google.com/g/answer/17106276 and docs.cloud.google.com/gemini/enterprise/docs/connectors/custom-mcp-server/set-up-custom-mcp-server, [GE]), and Gemini CLI's docs/tools/mcp-server.md ([GC]). Gateway code at `2a84a04`.

## 1. Purpose

Thomas's words in the issue:

> Gemini's "Connect to an MCP server" refuses the gateway: "This server doesn't support automatic registration. Enter your OAuth client ID and client secret to connect." The gateway supports client ID metadata documents (Claude, ChatGPT), not dynamic client registration (RFC 7591), which Gemini and many MCP clients expect.
>
> Thomas, 28 Oct: option 1 (add dynamic registration) over pre-registered clients, for 0.34.0. Use case: a Google Workspace organisation reaches Aeolus through Gemini.
>
> Registering grants nothing: the person still signs in and gets only what their account allows. Needs limits so the endpoint cannot be flooded.

**What it is.** The gateway's OAuth server gains a registration endpoint (RFC 7591), named in its metadata as `registration_endpoint`. An MCP client that knows only the gateway's URL registers itself there, gets a client id, and goes on to `/authorize` like any client.

**For whom.** A person whose MCP client registers itself and offers neither a client ID metadata document nor a place to paste a client id: Gemini first, then the other MCP clients that do the same.

**A good outcome.**
- The person pastes the gateway's URL into the client, signs in as they sign in to Aeolus everywhere, and sees what their account allows, with nothing else to set up.
- A registered client holds no right. The two tiles of decision 0056 stand as they are: "Sign in as yourself" gets the account's rights, "Ask for access for this client" waits for an approver.
- Nobody can flood the endpoint or fill the gateway's database with clients.
- Claude and ChatGPT keep using their client ID metadata documents, unchanged.

**Not in this purpose.** RFC 7592's read, update and delete of a registration; the A2A adapter; a console page for pre-registered clients (see Q1).

## 2. Lessons to check against

| Lesson | Source | Bearing |
| --- | --- | --- |
| The MCP spec makes DCR a MAY, and 2026-07-28 deprecates it: "Dynamic Client Registration is deprecated and retained for backwards compatibility. New implementations should use Client ID Metadata Documents instead." | [M] 2026-07-28, Overview and Client Registration | Thomas chose to add it anyway (issue, 28 Oct); not reopened. The gateway's own text says the opposite today: `register-client.ts:17` ("as MCP 2026-07-28 deprecates dynamic registration"), README line 83 ("There is no dynamic registration"), and interop.md's "Outside identity" row (CIMD and pre-registered clients). Each changes with the build |
| Clients that support every way SHOULD pick, in order: pre-registered, then a client ID metadata document when `client_id_metadata_document_supported`, then DCR when `registration_endpoint` is served, then asking the person. | [M], both versions | Claude and ChatGPT keep CIMD as long as the gateway keeps stating it. Adding the endpoint changes nothing for them |
| Open registration is how a client registers with no help: RFC 7591 lets an endpoint take requests with no initial access token, and such requests "MAY be rate-limited". The server MAY expire registrations after a time. | [R] sections 1.2, 3, 5 | An initial access token would need the person to fetch it first, which is what the issue removes. Limits and expiry are ours to set (Q2, Q3) |
| A registering client states its own name and logo; "a rogue client might use the name and logo of a legitimate client that it is trying to impersonate". | [R] section 5 | The pick page and the approver's request show `client_name`. A CIMD client's name is anchored to the document's host (`read-authorization.ts:80`); a registered client's is not (Q5) |
| Redirect URIs must be registered and checked. The gateway allows https, or http on loopback with any port when registered without one (RFC 8252). | [R] section 2; `redirect-uri.ts` | The same rules apply to a registered client. Gemini CLI listens on `http://localhost:<random-port>/oauth/callback` [GC] |
| `token_endpoint_auth_method` defaults to `client_secret_basic` when a client omits it. | [R] section 2 | A client that says nothing expects a secret. The gateway already takes `none`, `client_secret_basic` and `client_secret_post` at `/token` (Q6) |
| Registering grants nothing; only a signed-in account asks for a client, and a client asked for waits up to 7 days for an approver; outside parties are a switch per fleet, off by default. | decision 0056; issue | A registered client meets the same two tiles, the same wait and the same switch. The plugin's address (`/plugin/mcp`) keeps skipping the pick |
| Every table has `fleet_id`; every query is scoped by it. | gateway CLAUDE.md | A client registers before anyone signs in, so no fleet is known then. A pre-registered client has a fleet (`oauth_clients.fleet_id`); a CIMD client is not stored at all (Q4) |
| The gateway already rate-limits nothing on its OAuth routes; the only 429 handling is outbound (`deliver-pushes.ts:21`). | gateway code | The limits are new, and the gateway may run as more than one process (Q3) |
| Sign-in lasts 10 minutes; an access token 1 hour; a refresh token 30 days, rotated. | `start-sign-in.ts:8`, `exchange-token.ts:10-11` | The natural bounds for when an unused or abandoned client can go (Q3) |
| Before 1.0.0, no paid-product polish for zero customers. | decision 0013 | No RFC 7592 management, no registration admin page, unless a question shows a need |

**What Google's pages say about Gemini** (read 28 Oct). They do not all match the use case in the issue:

- The Gemini app ([GA]) registers itself: "If the server doesn't support Dynamic Client Registration, next to "Advanced features," click **Show more**, then enter your credentials." It is for "a personal Google Account. For now, this feature isn't available if you sign in with a work or school Google Account", and for people "18 or over and in the US". Its redirect URI, auth method and PKCE are not stated.
- Gemini Enterprise ([GE]), the product for a Workspace organisation, has "a team administrator" connect a custom MCP server with a `client_id` and `client_secret` registered by hand, redirect URL `https://vertexaisearch.cloud.google.com/oauth-redirect`, PKCE optional. Neither page mentions dynamic registration or client ID metadata documents.
- Gemini CLI ([GC]) does "dynamic client registration if supported", on a loopback redirect, and checks `iss` when the server states it.

So the screen in the issue matches the Gemini app's wording, while the Workspace use case points at Gemini Enterprise, whose pages describe only a client registered by hand. That is Q1.

## 3. Questions

**Q1. Which Gemini is the use case, and does DCR serve it?**
Context: the message in the issue is the Gemini app's, which uses DCR but refuses work and school accounts. A Workspace organisation reaches MCP servers through Gemini Enterprise, which documents only a hand-registered confidential client, set up by its administrator. The gateway already has pre-registered clients (`oauth.registerClient`, with a secret), reachable over tRPC only, with no console page.
- (a) DCR as decided, for the Gemini app, Gemini CLI and other clients that register themselves. A Workspace organisation in Gemini Enterprise is a separate issue (a pre-registered client it can set up), filed and not built here.
- (b) DCR, and in the same release a way for an approver to pre-register a client in the console, so Gemini Enterprise works too.
- (c) No DCR; only the console page of (b).
Pick: (a). Thomas decided DCR; it serves the Gemini app and every client that registers itself, and keeps this release thin. The Gemini Enterprise path is real but is other work. Thomas to confirm which screen showed the message.

**Q2. Open registration, or behind a token?**
Context: RFC 7591 allows both. A client that knows only the URL cannot fetch an initial access token.
- (a) Open: anyone may register; registering grants nothing (issue).
- (b) An initial access token an approver hands out.
Pick: (a). (b) is a pre-registered client by another name.

**Q3. Limits and lifetime.**
Context: open registration must not flood the endpoint or fill the database. A client registers on every connect in some clients, and many never finish signing in.
- (a) A rate limit per source address, a cap on the number of registered clients that have never been used, field limits (name length, at most 10 redirect URIs as today), and expiry: a client that issued no code within a short window after registration goes, and a client goes once no refresh token of it lives (30 days after its last use).
- (b) Rate limit per source address only; clients kept forever.
- (c) Expiry only.
Pick: (a). A per-address limit alone is beaten by many addresses; the cap bounds the database whatever the traffic; expiry keeps the table to clients people use. The numbers and where the counts live (one process or several) are stage 2.

**Q4. Which fleet does a registered client belong to?**
Context: "Every table has `fleet_id`." A client registers before any sign-in, and one person may sign in to several fleets with one client. CIMD clients are not stored, so the question never arose.
- (a) A registered client belongs to no fleet, as a CIMD client, in its own table without `fleet_id`; the fleet is named where it always is, by the sign-in's grant or the outside-party request. This is an exception to the rule, which only Thomas grants.
- (b) `fleet_id` empty until the first sign-in, then fixed; a second fleet registers again.
- (c) A registration address per fleet.
Pick: (a). The client is installation-wide by nature, holds no fleet's data and grants nothing; (b) breaks one person in two fleets; (c) breaks "paste the URL".

**Q5. What the pick page and the approver see for a registered client.**
Context: decision 0056's two tiles show the client's name. A registered client's name is whatever it stated, so "Claude" or "Aeolus" can be claimed by anyone ([R] section 5).
- (a) Both tiles as for any client; the name is shown as stated by the client, beside the host of its redirect URI, on the pick page and in the approver's request.
- (b) Only "Sign in as yourself" for a registered client; no outside-party request.
- (c) Shown as a CIMD client is today.
Pick: (a). The redirect host is the one fact the client cannot fake and still get the code. (b) takes away a path decision 0056 gives every client.

**Q6. Public clients only, or secrets too?**
Context: RFC 7591's default method is `client_secret_basic`. What the Gemini app sends is not stated. `/token` already takes all three methods.
- (a) Answer the method asked: `none` gives a public client, `client_secret_basic` or `client_secret_post` a secret, answered once and kept as its hash, as for pre-registered clients.
- (b) Public only: answer `none` whatever is asked.
Pick: (a). A client that asks for a secret may refuse an answer without one, and (b) would fail exactly the client this is for.

**Q7. RFC 7592 management.**
Context: optional (Experimental); MCP names only RFC 7591.
- (a) Not served: no `registration_access_token`, no read, update or delete. A client that changes registers again; expiry (Q3) removes the old one.
- (b) Served.
Pick: (a), decision 0013.
