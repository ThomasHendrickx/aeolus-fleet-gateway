# The person's inbox state on every tool answer, and a setup call per client

Design for gateway #256 (part 1) and #257 (part 2): purpose, lessons, and Thomas's answers to its questions (section 5).

Thomas, on Bridge, 5 Nov (option 3, both parts), verbatim: "For 1 -> I still want each call to have the answer for that specific call. This extra info is put in the response as part of metadata, as state of the users inbox.
For 2 -> Yes, it should also help the chat on how to actually make this more deterministic. Maybe an endpoint that can be called at initialization that requires the chat to say which one it is, and it then gets the instructions on how to setup the chat so it works optimally with the gateway."

## 1. Purpose

**What it is.** Two changes to the tools a signed-in person's chat is served (`src/adapters/http/person-tools.ts`):

1. Every tool answer keeps its own answer for that call unchanged, and also carries the state of the person's inbox: what waits on them now.
2. A call the chat makes when it starts, in which it says which client it is (claude.ai, Claude desktop, Claude mobile, Claude Code, ChatGPT, Copilot), and which answers the instructions for setting up that chat to work best with the gateway.

**For whom.** A person whose chat is their person ship through the Aeolus Gateway connector. A chat runs only when the person writes, so today it notices a new delivery only when the person asks for the inbox.

**A good outcome.**
- Whatever the person asks the chat to do with Aeolus, the chat learns from the same answer that something new waits, and says so, without the person asking.
- The chat checks the inbox at the start of a conversation in every supported client, as reliably as that client allows, because it was told how and the person set it up once.
- No answer of a call changes in meaning or shape for the model that reads it today, and reading the inbox state confirms no delivery.

**Not in this purpose.** Waking a person between turns (interop 5.x: nothing runs in a chat between turns; a waker is the person's app or a channel their owner configures); Bridge; the outside parties' MCP endpoint (`mcp-endpoint.ts`, `serverFor`); the A2A adapter.

## 2. What the gateway answers today (`main` at `46de2264`)

| Part | Today | Where |
| --- | --- | --- |
| Tools | 11 person tools, served by a fresh `McpServer` per request (stateless) | `person-tools.ts:239`, `mcp-endpoint.ts` |
| A tool's answer | One text content block holding the answer's JSON. No `structuredContent`, no `outputSchema` | `answered`, `person-tools.ts:220` |
| `_meta` on a result | Only on a refusal of a person whose sign-in ended: `mcp/www_authenticate`, which makes ChatGPT ask for sign-in again | `person-tools.ts:237` |
| Server instructions | None: the server is built with a name, a version and the tools capability only | `person-tools.ts:239` |
| Which client calls | Not read. The endpoint reads only the client's declared capabilities from each request's `_meta` envelope (for the Tasks extension) | `mcp-endpoint.ts:51-54` |
| What waits | `aeolus_inbox` asks core how many wait first, then receives past the ones the gateway holds; a look is a read while the gateway holds as many as wait (aeolus-fleet #1647). Opened ones come from the gateway's own store | `src/core/people/read-inbox.ts` |
| Guidance for the model | Tool descriptions, and the ChatGPT plugin's skill (`plugin/skills/aeolus/SKILL.md`), which reaches ChatGPT only | |

## 3. What MCP and the clients offer (read 5 Nov 2026)

| Fact | Source |
| --- | --- |
| A tool result has `content` (for the model), optional `structuredContent` (any JSON, SHOULD also be serialised as text in `content`) and `_meta`. The spec does not say `_meta` is for the model. | modelcontextprotocol.io/specification/2026-07-28/server/tools, /basic/index |
| A `_meta` key outside the protocol takes a reverse DNS prefix of its own (such as `dev.aeolus-fleet/inbox`); prefixes with `modelcontextprotocol` or `mcp` as second label are reserved. | 2026-07-28/basic/index |
| 2026-07-28 removes `initialize` and sessions (SEP-2575, SEP-2567). Every request carries `_meta` with the protocol version and client capabilities; `io.modelcontextprotocol/clientInfo` is optional (SHOULD be sent), self-reported, and implementations SHOULD NOT change behaviour on it. Servers keep no client identity across requests. | 2026-07-28/changelog, /basic/index |
| Server instructions now travel in `server/discover`'s result (`instructions`, "natural-language guidance for LLMs"); a client that sends `initialize` gets them there, as before. | 2026-07-28/server/discover, /basic/versioning |
| Claude Code loads server instructions at session start, cut at 4,096 characters. It speaks 2026-07-28 with servers that do. | code.claude.com/docs/en/mcp |
| claude.ai, Claude desktop and mobile: whether server instructions reach the model is not documented. A desktop issue (Feb 2026, closed Jun 2026) said they did not; seen only as a search snippet. | claudeissues.com, issue 23808 (snippet) |
| No Claude client documents passing a tool result's `_meta` to the model. The Messages API's MCP connector's `mcp_tool_result` has text content and `is_error` only. | claude.com/docs/connectors/building; platform.claude.com/docs/en/agents-and-tools/mcp-connector |
| ChatGPT: `_meta` "is delivered only to the component. Hidden from the model"; `structuredContent` and `content` reach the model. ChatGPT uses server instructions. | developers.openai.com/apps-sdk/reference, /build/mcp-server |
| Claude Code issues report that with both `content` and `structuredContent` it reads only `structuredContent`; Claude desktop reads both. Several are open. | claudeissues.com 15412, 45575, 54737, 86032 (snippets) |
| Claude clients support no resource subscriptions; Claude Code alone handles `list_changed` and an experimental channel that needs a flag. | claude.com/docs/connectors/building; code.claude.com/docs/en/mcp |
| Neither Anthropic nor OpenAI documents the `clientInfo.name` its clients send. | not documented |

So the only places every client's model is known to read are a tool's `content`, its description, and an answer the model asked for. Server instructions are documented for Claude Code and ChatGPT only.

## 4. Lessons to check against

| Lesson | Source | Bearing |
| --- | --- | --- |
| Each call keeps its own answer for that call. | Thomas's note | The inbox state travels beside the answer, never in it or instead of it |
| A chat has no process between turns: a delivery waits until the person writes. | interop.md, "Chat with the connector" row; SKILL.md | The state can only ride on calls the chat makes; it wakes nobody |
| The promise ends at the agent's confirmation; opening a delivery confirms it. | decision 0040; `aeolus_open` | Reading the state must confirm nothing: a count, or titles at most, never content |
| A look is a read while the gateway holds as many as wait; how many wait is one cheap core call. | aeolus-fleet #1647, `read-inbox.ts` | Counting on every call costs one core call; listing every item costs receives |
| Policy stays in core: the gateway shows exactly what core answers for the proxy ship. | CLAUDE.md | The state is core's count, not the gateway's guess |
| `clientInfo` is optional and self-reported, and SHOULD NOT change behaviour. | MCP 2026-07-28 | Thomas's form, the chat saying which it is, is the one that works in every client |
| `_meta` is hidden from ChatGPT's model and undocumented for Claude's. | section 3 | "Metadata" read as MCP `_meta` alone may reach no model |
| Claude Code may read only `structuredContent` when both are given. | section 3 | Adding `structuredContent` could hide today's answer from Claude Code |
| Claude Code reads 4,096 characters of instructions; tool results are capped (Claude Code 25,000 tokens, claude.ai about 150,000 characters). | code.claude.com/docs/en/mcp; claude.com/docs/connectors/building | Instructions short; state small |
| Before 1.0.0, no compatibility layers or polish for zero customers. | decision 0013 | No version branches per client beyond what the person needs to set up |

## 5. Decisions taken

Thomas, on Bridge, 5 Nov. Each answer is recorded here and not argued again.

| Question | Answer |
| --- | --- |
| Q1 The purpose | Section 1, as written. |
| Q2 Where the inbox state travels (#256) | A second text content block after the answer's own block. The answer's block stays the first block and unchanged; the second is headed as the person's inbox state. Not MCP `_meta`: no model is known to read it. |
| Q3 What the inbox state holds (#256) | Counts only: how many deliveries wait, and how many are opened and not dealt with. One core call per tool answer; the chat calls `aeolus_inbox` for the items. |
| Q4 The setup call (#257) | A tool the chat calls first in a conversation, with a required argument saying which client it is, answering that client's setup. The server instructions and the tool's description say to call it first. |
| Q5 What setup covers (#257) | Rules for the chat in this conversation, and one-time steps the chat walks the person through in their client so every new conversation checks the inbox. Thomas's note, verbatim: "Lets also see what we can cover using the current scripts and other techniques that are available in the different technologies. This is our way to use the understanding of that tool to give the most optimal way for the user to use that interface (claude, chatgpt, copilot, ... )" |

## 6. What each client's setup can use

Q5's note asks the setup answer to use what each client offers, not one text for all. The build checks each row in that client before its setup text is written; a row marked unverified is a place to look, not a fact.

| Client | What it offers for checking the inbox at the start | Source |
| --- | --- | --- |
| claude.ai, Claude desktop, Claude mobile | Profile preferences, read in every conversation; a project's instructions, read in the project's conversations. The connector is turned on per chat. | support.claude.com, custom connectors (connector); preferences and projects unverified |
| Claude Code | Server instructions, read at session start; hooks on session start and on each prompt, which the aeolus-fleet plugin's scripts already use for agent ships; a line in CLAUDE.md | code.claude.com/docs/en/mcp; plugin hooks unverified for a person's connector |
| ChatGPT | Server instructions; the ChatGPT plugin's skill (`plugin/skills/aeolus`); custom instructions and memory | developers.openai.com/apps-sdk; custom instructions unverified |
| Copilot | Its custom instructions file; whether it reads server instructions | unverified |

## 7. Done when

- #256: every person tool's answer keeps its own content block first and unchanged, and adds a second text block with how many deliveries wait and how many are opened and not dealt with; reading it confirms no delivery.
- #257: a setup tool takes a required client and answers that client's rules for the chat and its one-time setup steps, built from section 6 as checked; the server instructions and the tool's description say to call it first in a conversation.
