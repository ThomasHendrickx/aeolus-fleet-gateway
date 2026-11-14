# Self-host the gateway and app

On your own [fleet](https://aeolus-fleet.dev/docs/words/#fleet), chats, Slack and [Bridge](https://aeolus-fleet.dev/docs/words/#bridge) all reach it through the [gateway](https://aeolus-fleet.dev/docs/words/#gateway). This page runs the gateway beside your fleet server, on a database of its own, and connects it to the fleet: its settings, its address, connecting it from the console, then people's sign-in and the optional Slack and push keys. It also says plainly what you cannot run yourself yet.

It starts where [Self-host](https://aeolus-fleet.dev/docs/self-host/) ends: a fleet server and a console running, and you signed in as [`argo`](https://aeolus-fleet.dev/docs/words/#argo).

## What you run

The gateway is one more process on your server, with its own Postgres database. It reaches the fleet only through the same API every ship uses, as the ships it crews, and it serves its own web pages, Bridge among them, at its own address.

```mermaid
flowchart LR
    subgraph yours["Your server"]
        proxy["TLS proxy"]
        core["Fleet server<br/>@aeolus-fleet/core<br/>port 4000"]
        console["Console<br/>port 3000"]
        gateway["Gateway<br/>@aeolus-fleet/gateway<br/>port 4300<br/>with its pages and Bridge"]
        coredb[("The fleet's<br/>database")]
        gwdb[("The gateway's<br/>database")]
    end
    subgraph outside["Outside your server"]
        chats["Chats and MCP clients<br/>Claude, ChatGPT, Copilot"]
        slack["Slack"]
        browser["People's browsers"]
        push["Browsers' push services"]
        signin["The account sign-in service<br/>hosted only"]
        app["The Aeolus app<br/>hosted only"]
    end
    core --> coredb
    gateway --> gwdb
    gateway -->|ship API| core
    console -.->|Settings connects| gateway
    proxy --> core
    proxy --> console
    proxy --> gateway
    chats --> proxy
    slack -->|events and buttons| proxy
    browser --> proxy
    gateway -->|wakes| push
    gateway -.->|people sign in| signin
```

| Part | What it does |
| --- | --- |
| **Gateway** (`@aeolus-fleet/gateway`) | Lets chats, Slack and outside MCP servers and clients reach your fleet as ships, and serves Bridge. It decides no reach of its own: the fleet answers what each of its ships may do. |
| **The gateway's database** | Postgres 16 or newer, a database of its own beside the fleet's. It keeps the [crew tokens](https://aeolus-fleet.dev/docs/words/#crew-token) of the ships the gateway crews, outside credentials, Slack's tokens and each person's settings. |
| **The account sign-in service** | Where people sign in with their [account](https://aeolus-fleet.dev/docs/words/#account), to Bridge, from a chat and to link Slack. It is not open source: you cannot run it yourself. |
| **The Aeolus app** | The app for a phone and a desktop window. It is not open source either: you cannot run it yourself. |

## What works on your own fleet today

Be clear about this before you start. Everything a person does through the gateway starts with signing in to their account, and the service where they sign in runs only for the hosted fleet. A self-hosted fleet has no sign-in for people yet: [gateway issue #355](https://github.com/ThomasHendrickx/aeolus-fleet-gateway/issues/355) tracks it. On your own server:

| | On your own fleet |
| --- | --- |
| **The gateway runs and is connected to your fleet** | Yes, with this page. |
| **Bridge's pages are reachable** at the gateway's address | Yes, but nobody can sign in to them without the account sign-in service. |
| **A chat or MCP client signs in** | No: without the account sign-in service, nobody signs in, so no client connects. |
| **Slack** | No: connecting a workspace and linking a Slack account both need a signed-in account. |
| **Web push** | Only once people can sign in to Bridge, where they turn it on. |
| **Email wakes** | No: the gateway sends them through the account sign-in service. |
| **The Aeolus app** | No: it is not open source. |

What works without sign-in: the gateway starts, migrates its database and is connected to your fleet from the console. The steps below set every part you can set now, so its settings are in place.

## What you need

- **A self-hosted fleet**, running as [Self-host](https://aeolus-fleet.dev/docs/self-host/) sets it up, with a fleet server at 0.38.5 or later.
- **Node 26** on the server.
- **An empty Postgres database** for the gateway, on the fleet's Postgres server or another, reached with a direct or session connection.
- **An https address of its own** for the gateway, such as `gateway.example.com`, once anyone or anything beyond the server reaches it. Chats and Slack need it.

## 1. Create its database

Give the gateway an empty database and a user of its own that owns it, as for every other part. [Run the server](https://aeolus-fleet.dev/docs/run-the-server/) shows how, with the privileges each part needs and why a transaction pooler breaks the gateway: it holds Postgres locks for as long as a connection lives.

## 2. Install the gateway

```sh
npm install @aeolus-fleet/gateway
```

## 3. Set the gateway's environment

The gateway reads its settings from the environment at startup, and refuses to start, naming every setting that is missing or wrong. Three are required:

```sh
export DATABASE_URL=postgresql://user:password@localhost:5432/aeolus_gateway
export FLEET_URL=https://fleet.example.com           # the fleet's PUBLIC_URL
export GATEWAY_SECRET='<at least 32 characters>'
export GATEWAY_PUBLIC_URL=https://gateway.example.com
```

| Setting | What it is |
| --- | --- |
| `DATABASE_URL` | The gateway's own database, Postgres 16 or newer, with a direct connection. |
| `FLEET_URL` | The fleet's public address, the server's `PUBLIC_URL`. The gateway calls the fleet there, as the ships it crews. |
| `GATEWAY_SECRET` | At least 32 characters, such as `openssl rand -hex 32` prints. It keys the ship names outside clients see. Keep it for good: a new one renames every ship to them, and sign-ins in progress fail. It is in no database, so back it up with the gateway's settings. |
| `GATEWAY_PUBLIC_URL` | Where chats, MCP clients, Slack and browsers reach the gateway, at an origin of its own. Left out, it is `http://127.0.0.1:<PORT>`, which only fits on localhost. |

The gateway listens on `127.0.0.1:4300` unless you set `HOST` and `PORT`. Gateway 0.38.11 and older listen on 4200 by default, the trierarch plugin's port: give them `PORT=4300` so the two never clash.

Leave `INSTALLATION_TOKEN` unset. It is for a hosting service: unset, the gateway serves your fleet as soon as you connect it. Every other setting is in the [gateway README](https://github.com/ThomasHendrickx/aeolus-fleet-gateway#run).

## 4. Start it

```sh
npx aeolus-gateway start
```

At start, the gateway first asks the fleet server its version, and exits when the server is older than it needs, naming both versions. Then it applies its database migrations and serves. It runs until you stop it with `SIGINT` or `SIGTERM`. Until you connect it in step 6, its log says:

```
connected to no fleet: argo connects the gateway in the console
```

Check it with `GET /api/health`, which answers `{ "status": "ok" }` while its database answers, and `GET /api/version`, which answers the version it runs. Run it under a service manager like the other parts: [Run the server](https://aeolus-fleet.dev/docs/run-the-server/) says what that takes. Unlike squadrons and the trierarch plugin, the gateway may run more than one process on its database.

## 5. Reach it beyond localhost

Serve the gateway at an origin of its own, such as `https://gateway.example.com`, and set `GATEWAY_PUBLIC_URL` to it. Chats find how to sign in at that origin's root, so the gateway cannot sit below a path of another host. A Caddyfile beside the fleet's:

```
gateway.example.com {
	reverse_proxy 127.0.0.1:4300
}
```

As for the fleet server, set `HOST` only when the proxy runs on another machine or container, such as `HOST=0.0.0.0`; beside the proxy, the default keeps the gateway off the network.

## 6. Connect it to the fleet

The console connects the gateway, as it does squadrons and the trierarch plugin.

1. Start the console with `AEOLUS_GATEWAY_URL` set to the gateway's address, such as `http://127.0.0.1:4300`. Only the console's server calls it, never the browser, so a local address works.
2. In the console, open **Settings**. Under **Gateway**, choose **Connect gateway**.

The console commissions the gateway's ship, `gateway`, with the [scopes](https://aeolus-fleet.dev/docs/words/#scope) it needs to read the fleet and commission ships, and hands its secret to the gateway server to server. No one sees the secret. The gateway crews its ship and keeps only its crew token. **Gateway** then says **Connected as gateway**. If the gateway's ship lacks a scope the gateway asks for, Settings offers to grant it.

From now on, the gateway connects again with its kept crew token every time it starts, and its log says `connected as the gateway ship`.

```mermaid
sequenceDiagram
    actor You
    participant Console
    participant Gateway
    participant Fleet as Fleet server
    You->>Console: Settings, Gateway, Connect gateway
    Console->>Fleet: commission the ship gateway
    Fleet-->>Console: its secret
    Console->>Gateway: the secret, server to server
    Gateway->>Fleet: crew the ship gateway
    Fleet-->>Gateway: a crew token, kept in its database
    Console-->>You: Connected as gateway
```

Your gateway is now connected to your fleet, and its pages are reachable at `GATEWAY_PUBLIC_URL`.

## 7. People's sign-in

People sign in to Bridge, from a chat and to link Slack with their Aeolus account, through the account sign-in service. The gateway takes it with these settings:

| Settings | What they are |
| --- | --- |
| `PAGASAE_URL`, `PAGASAE_CLIENT_ID`, `PAGASAE_CLIENT_SECRET` | The account sign-in service, and the gateway's client there for chats and MCP clients, with the redirect address `<GATEWAY_PUBLIC_URL>/pagasae/callback`. All three or none. |
| `PAGASAE_APP_CLIENT_ID`, `PAGASAE_APP_CLIENT_SECRET` | The gateway's pages as an app at the account sign-in service, with the redirect address `<GATEWAY_PUBLIC_URL>/sign-in/done`. Both or neither, beside the three above. |

The account sign-in service is not open source, so on your own fleet you cannot run it or register a client with it, and you leave these settings unset. Then nobody signs in to the gateway: Bridge's pages ask for a sign-in they cannot get, and no chat or MCP client connects. Your console sign-in as argo is the console's own and does not sign you in to Bridge. [gateway issue #355](https://github.com/ThomasHendrickx/aeolus-fleet-gateway/issues/355) tracks sign-in for a self-hosted fleet.

## 8. Optional: Slack

Slack needs nothing in the environment: a person holding the `gateway:slack` scope connects a workspace from the gateway's Slack page, and the gateway makes its own Slack apps. Slack then calls the gateway at `GATEWAY_PUBLIC_URL`, so that address must be https and reachable from the internet:

| Slack calls | For |
| --- | --- |
| `/gw/slack/install` | Installing a bot in the workspace |
| `/gw/slack/events` | Messages and mentions to a bot |
| `/gw/slack/actions` | Button presses on a question |
| `/gw/slack/link` | A person linking their Slack account |

Connecting the workspace and linking an account both need a signed-in person, so on your own fleet Slack waits on the sign-in in step 7.

## 9. Optional: push keys

Web push wakes a person in their browser when something waits. It needs the gateway's push keys:

```sh
npx web-push generate-vapid-keys
```

| Setting | What it is |
| --- | --- |
| `WEB_PUSH_PUBLIC_KEY`, `WEB_PUSH_PRIVATE_KEY` | The keys the command prints. They sign each wake. |
| `WEB_PUSH_SUBJECT` | A `mailto:` or `https:` address a push service may contact about them. |

All three or none. Unset, Bridge's settings offer no web push. Like `GATEWAY_SECRET`, the keys are in no database: back them up with the gateway's settings, as [Run the server](https://aeolus-fleet.dev/docs/run-the-server/) says. A person turns web push on for their browser in Bridge, so on your own fleet it too waits on the sign-in in step 7.

## Keep it running

The gateway is one more part to upgrade and back up. [Run the server](https://aeolus-fleet.dev/docs/run-the-server/) covers it with the others: upgrade it after the fleet server, back up its database in the same set as every other, and keep `GATEWAY_SECRET` and the push keys with the settings.

## If something does not work

| What you see | What to do |
| --- | --- |
| The gateway will not start and names a setting | A required setting is missing or wrong. Set it as step 3 shows. |
| The gateway exits, naming its version and the fleet server's | The fleet server is older than the gateway needs. Upgrade the fleet server first. |
| The gateway and the trierarch plugin clash on port 4200 | Gateway 0.38.11 and older listen on 4200. Give the gateway `PORT=4300`. |
| Settings shows no Gateway | The console has no address for it. Start the console with `AEOLUS_GATEWAY_URL` set. |
| **Couldn’t connect the gateway** | Read the reason it gives. Check that the console's server reaches the gateway at `AEOLUS_GATEWAY_URL`, that its `/api/health` answers ok, and that `FLEET_URL` is the fleet's address. |
| The log says `connected to no fleet` | The gateway is not connected yet. Connect it from Settings, as step 6 shows. |
| Nobody can sign in to Bridge, and no chat connects | The account sign-in service is not set. On your own fleet it cannot be yet: see step 7 and [gateway issue #355](https://github.com/ThomasHendrickx/aeolus-fleet-gateway/issues/355). |
| `/api/health` answers 503 | The gateway does not reach its database. Check `DATABASE_URL` and the connection. |

## Next

- [Run the server](https://aeolus-fleet.dev/docs/run-the-server/): upgrade, back up and restore every part, the gateway among them.
- [Bridge and the app](https://aeolus-fleet.dev/docs/bridge-and-the-app/): what people do once they sign in.
