/** Capture real page components with fixture API data and inert server actions. */
import { createRequire } from "node:module";
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { createServer } from "node:http";
import process from "node:process";
import { URL, URLSearchParams } from "node:url";
import { log } from "node:console";
import { tmpdir } from "node:os";
import { mkdtempSync } from "node:fs";
const tools = process.env.UI_CAPTURE_TOOLS;
const before = process.env.UI_CAPTURE_BEFORE;
if (!tools || !before)
  throw new Error(
    "Set UI_CAPTURE_TOOLS and UI_CAPTURE_BEFORE as the evidence README describes.",
  );
const { chromium } = createRequire(resolve(tools, "package.json"))(
  "playwright",
);
const root = process.cwd();
const out = root + "/test/evidence/ui-package/screenshots";
const tmp = mkdtempSync(resolve(tmpdir(), "gateway-ui-capture-"));
const require = createRequire(root + "/package.json");
const esbuild = require("esbuild");
const ts = require("typescript");
const postcss = require("postcss");
const tailwind = require("@tailwindcss/postcss");
const scenarios = [
  "address-bearer",
  "address-oauth",
  "address-person",
  "owner-tools",
  "a2a-agent",
  "a2a-client",
  "outside-parties-empty",
  "outside-party-tools",
  "tools-scopes-dialog",
  "outside-party-agent",
  "agent-needs-dialog",
  "outside-party-change",
  "parties",
  "slack",
  "slack-connected-empty",
  "slack-expose-error",
  "bridge-done-empty",
  "bridge-stay-aware-empty",
  "bridge-page-error",
  "bridge-question",
  "bridge-decision",
  "bridge-send",
  "bridge-error",
  "bridge-home-empty",
  "bridge-loading",
  "tools-loading",
  "signins-loading",
  "signins-error",
  "meeting",
  "scope-picker",
  "toast-tools",
  "toast-send",
  "toast-basket",
];
for (const [version, source] of [
  ["before", before],
  ["after", root],
]) {
  const scopeImport =
    version === "before"
      ? source + "/web/features/outside-party/tools-table/ui/scope-picker.tsx"
      : source + "/node_modules/@aeolus-fleet/ui/dist/index.js";
  const loadingImport =
    version === "before"
      ? `import {BridgeSkeleton} from '${source}/web/features/bridge/ui/bridge-skeleton.tsx';import {ToolsSkeleton} from '${source}/web/features/outside-party/tools-table/ui/tools-skeleton.tsx';`
      : `import {LoadingSkeleton} from '${source}/node_modules/@aeolus-fleet/ui/dist/index.js';const BridgeSkeleton=()=> <LoadingSkeleton variant="list" label="Loading Bridge"/>;const ToolsSkeleton=({party})=><LoadingSkeleton variant="table" rows={8} label={'Reading the tools '+party+' lists'}/>;`;
  const pageErrorImport =
    version === "before"
      ? `import {BridgeFailed} from '${source}/web/features/bridge/ui/bridge-failed.tsx';const PageError=()=> <BridgeFailed message="The gateway did not answer." onTryAgain={()=>{}}/>;`
      : `import {InlineError} from '${source}/node_modules/@aeolus-fleet/ui/dist/index.js';const PageError=()=> <InlineError title="Bridge could not be read" description="The gateway did not answer. Try again in a moment." onRetry={()=>{}} variant="page"/>;`;
  const toastImport =
    version === "before"
      ? `import {Toast} from '${source}/node_modules/@base-ui/react/toast/index.mjs';import {TableToasts} from '${source}/web/features/outside-party/tools-table/ui/table-toasts.tsx';import {SentToasts} from '${source}/web/features/bridge/ui/sent-toasts.tsx';import {BasketToasts} from '${source}/web/features/bridge/ui/basket-toast.tsx';function ToastTrigger({kind}){const manager=Toast.useToastManager();React.useEffect(()=>{manager.add({title:'Scopes saved',description:'The fleet keeps the new requirements.'});},[]);return kind==='tools'?<TableToasts/>:kind==='send'?<SentToasts/>:<BasketToasts/>;}const ToastExample=({kind})=><Toast.Provider><ToastTrigger kind={kind}/></Toast.Provider>;`
      : `import {showToast,Toaster} from '${source}/node_modules/@aeolus-fleet/ui/dist/index.js';function ToastExample(){React.useEffect(()=>{showToast({title:'Scopes saved',description:'The fleet keeps the new requirements.'});},[]);return <Toaster/>;}`;
  const entry = `import React from '${source}/node_modules/react/index.js';import {createRoot} from '${source}/node_modules/react-dom/client.js';
import {AddressStep} from '${source}/web/features/add-server/ui/address-step.tsx';
import {OwnerStep} from '${source}/web/features/add-server/ui/owner-step.tsx';
import {A2aAgentForm} from '${source}/web/features/add-a2a-agent/ui/a2a-agent-form.tsx';
import {A2aClientForm} from '${source}/web/features/add-a2a-client/ui/a2a-client-form.tsx';
import {OutsideParties} from '${source}/web/features/outside-parties/ui/outside-parties.tsx';
import {OutsideParty} from '${source}/web/features/outside-party/ui/outside-party.tsx';
import {ChangeParty} from '${source}/web/features/outside-party/ui/change-party.tsx';
import {Parties} from '${source}/web/features/parties/ui/parties.tsx';
import {ExposeShip} from '${source}/web/features/slack/ui/expose-ship.tsx';
import {DonePanel} from '${source}/web/features/bridge/state/done-panel.tsx';
import {StayAwarePanel} from '${source}/web/features/bridge/state/stay-aware-panel.tsx';
import {SendMessageProvider} from '${source}/web/features/bridge/state/send-message.tsx';
import {TRPCClientError} from '${source}/node_modules/@trpc/client/dist/index.mjs';
import {Slack} from '${source}/web/features/slack/ui/slack.tsx';
import {HomeLists} from '${source}/web/features/bridge/state/home-panel.tsx';
import {DecisionForm} from '${source}/web/features/bridge/ui/decision-form.tsx';
import {DeliveryCard} from '${source}/web/features/bridge/ui/delivery-card.tsx';
import {SendMessageForm} from '${source}/web/features/bridge/ui/send-message-form.tsx';
import {Notice} from '${source}/web/features/bridge/ui/notice.tsx';
import {EveryonesSignInsSkeleton,SignInsCard} from '${source}/web/features/outside-party/ui/everyones-sign-ins.tsx';
import {MeetingControls} from '${source}/web/features/meeting/state/meeting-controls.tsx';
import {Contributions} from '${source}/web/features/meeting/ui/contributions.tsx';
import {ScopePicker} from '${scopeImport}';
${loadingImport}\n${toastImport}\n${pageErrorImport}
const noop=()=>{};const action=async()=>({kind:'idle'});const listed=[{scope:'messages:send',description:'Send, answer and ask other ships'},{scope:'crm:read-leads',description:'Read leads in the CRM'}];const owners=[{shipId:'shp_01',name:'mathilde'}];const tool={name:'search_notes',description:'Searches your notes.',isReadOnly:true,isOn:true,isNew:false,scopes:[]};const party={name:'crm',kind:'mcpServer',state:'crewed',ownerName:'mathilde',ownerShipId:'shp_01',proxyShipName:'crm',proxyShipId:'shp_02',scopes:['messages:send','crm:read-leads'],url:'https://crm.example.com/mcp',credentialKind:'bearer',concurrencyLimit:4,isRepeatable:false};
const query=(value)=>({query:async()=>value});const api={outsideParties:{status:query({isOn:true})},parties:{get:query(party),list:query([]),ownerChoices:query(owners),scopeRequirements:query({version:1,party:[],tools:[]}),approving:query({isApproving:true}),listedScopes:query({scopes:listed}),tools:query({tools:[tool]}),cardAddresses:query({addresses:[]})},slack:{view:query({state:'notConnected',canChange:true})}};const page={api,fleetId:'example',scopes:['gateway:approve','fleet:manage','fleet:owner','scopes:grant','fleet:network','messages:send','crm:read-leads']};
const request={fleetId:'example',requestId:'req_01',subject:{kind:'server',url:'https://crm.example.com/mcp'},requesters:[],askedAt:'2026-11-15T08:00:00Z',expiresAt:'2026-11-20T08:00:00Z',state:'pending',decidedBy:null,decidedAt:null};
const question={id:'question',title:'Which release goes first?',context:'Both are ready.',options:[{key:1,label:'Gateway first',detail:'Use the shared parts.'},{key:2,label:'Console first',detail:'Walk the console.'}],pick:{option:1,why:'The gateway is ready.'}};const delivery={deliveryId:'dlv_01',from:'orchestrator-1',title:question.title,sentAt:'2026-11-15T08:00:00Z',payload:JSON.stringify(question),body:JSON.stringify(question),question,step:undefined,alert:undefined,meetingId:undefined,stale:null};
const name=new URLSearchParams(location.search).get('scenario');if(name.startsWith('address-')||name==='owner-tools')document.getElementById('root').style.maxWidth='40rem';let content;
switch(name){
case 'address-bearer':case 'address-oauth':case 'address-person':content=<AddressStep state={{fields:{url:'https://crm.example.com/mcp',credentialKind:name==='address-bearer'?'bearer':name==='address-oauth'?'clientCredentials':'personSignIn',signInClientSource:'fixed'}}} action={action} fleetId="example" redirectUri="https://gateway.example.com/done"/>;break;
case 'owner-tools':content=<OwnerStep state={{step:'owner',fields:{url:party.url,name:'crm'},tools:[tool,{...tool,name:'write_note',isReadOnly:false}],owners,requestId:'req'}} refused={{kind:'idle'}} action={action} onBack={noop} fleetId="example" canSwitchTools/>;break;
case 'a2a-agent':content=<A2aAgentForm fleetId="example" requestId="req" owners={{isOk:true,value:owners}} scopes={listed.map(x=>x.scope)} listed={listed}/>;break;
case 'a2a-client':content=<A2aClientForm fleetId="example" requestId="req" owners={{isOk:true,value:owners}} scopes={listed.map(x=>x.scope)}/>;break;
case 'outside-parties-empty':content=await OutsideParties({page,side:undefined});break;
case 'tools-scopes-dialog':case 'outside-party-tools':content=await OutsideParty({page,name:'crm',outcome:null});break;
case 'agent-needs-dialog':case 'outside-party-agent':api.parties.get=query({...party,kind:'a2aAgent',cardUrl:'https://agent.example.com/card'});content=await OutsideParty({page,name:'crm',outcome:null});break;
case 'outside-party-change':content=await ChangeParty({page,name:'crm'});break;
case 'parties':api.parties.list=query([party]);content=await Parties({page});break;
case 'slack-expose-error':api.slack.exposable={query:async()=>{throw new TRPCClientError('The gateway did not answer.')}};content=await ExposeShip({page});break;
case 'bridge-done-empty':content=<DonePanel fleetId="example" first={{items:[],nextCursor:null}} now="2026-11-15T08:00:00Z"/>;break;
case 'bridge-stay-aware-empty':content=<SendMessageProvider fleetId="example"><StayAwarePanel fleetId="example" stayAware={[]} now="2026-11-15T08:00:00Z"/></SendMessageProvider>;break;
case 'bridge-page-error':content=<PageError/>;break;
case 'slack-connected-empty':api.slack.view=query({state:'connected',canChange:true,workspace:{teamId:'T1',name:'Example'},connectedBy:'mathilde',connectedAt:'2026-11-15T08:00:00Z',tokenState:'fresh',gatewayBot:'installed',bots:[]});content=await Slack({page,install:undefined});break;
case 'slack':content=await Slack({page,install:undefined});break;
case 'bridge-decision':content=<DecisionForm request={request} heldScopes={page.scopes} owners={{isOk:true,value:owners}} onDecide={noop}/>;break;
case 'bridge-question':content=<DeliveryCard delivery={delivery} opened={{job:'decide',isAlert:false,wasNew:true}} timeZone="UTC" consoleUrl="https://fleet.example.com" basketHref="/bridge/basket" inBasket={null} finished={null} note="" onNoteChange={noop} onAnswer={noop} onPut={noop} onSend={noop} onRemove={noop} onDone={noop} onFinishStep={noop} onOpen={noop} onBack={noop}/>;break;
case 'bridge-send':content=<SendMessageForm sendTo={{kind:'read',value:{sentAs:'mathilde',ships:[]}}} to="orchestrator-1" message="Ready for the next release." phase={{kind:'writing'}} onPick={noop} onWrite={noop} onSend={noop} onClose={noop}/>;break;
case 'bridge-home-empty':content=<HomeLists fleetId="example" home={{waiting:{count:0,items:[]},stayAware:[],messages:[]}} now="2026-11-15T08:00:00Z" opening={{opened:undefined}}/>;break;
case 'bridge-error':content=<Notice message="The gateway did not answer. Try again." isFailure/>;break;
case 'bridge-loading':content=<BridgeSkeleton/>;break;
case 'tools-loading':content=<ToolsSkeleton party="crm"/>;break;
case 'signins-loading':content=<EveryonesSignInsSkeleton party="crm"/>;break;
case 'signins-error':content=<SignInsCard party="crm" now="2026-11-15T08:00:00Z" rows={[]} refusal="The gateway did not answer." hasMore={false} isLoadingMore={false} confirming={null} removing={null} outcome={{kind:'refused',message:'The sign-in could not be removed.'}} onRemove={noop} onConfirm={noop} onKeep={noop} onMore={noop}/>;break;
case 'meeting':content=<><MeetingControls fleetId="example" meetingId="meeting" controls={['contribute','release']}/><Contributions items={[]}/></>;break;
case 'scope-picker':content=<ScopePicker label="Scopes" listed={listed} picked={['messages:send']} onPick={noop}/>;break;
default:content=<ToastExample kind={name.replace('toast-','')}/>;
}
async function resolveAsync(element){if(Array.isArray(element))return await Promise.all(element.map(resolveAsync));if(!React.isValidElement(element))return element;if(typeof element.type==='function'&&element.type.constructor.name==='AsyncFunction')return resolveAsync(await element.type(element.props));if(element.props.children!==undefined)return React.cloneElement(element,{},await resolveAsync(element.props.children));return element;}
createRoot(document.getElementById('root')).render(await resolveAsync(content));window.fixtureReady=true;
`;
  const stubPlugin = {
    name: "server-boundaries",
    setup(build) {
      build.onResolve(
        { filter: /(?:actions|page-account|meeting-actions|bridge-actions)$/ },
        (args) => ({
          path: resolve(args.resolveDir, args.path + ".ts"),
          namespace: "boundary",
        }),
      );
      build.onLoad({ filter: /.*/, namespace: "boundary" }, (args) => {
        const code = readFileSync(args.path, "utf8");
        const ast = ts.createSourceFile(
          args.path,
          code,
          ts.ScriptTarget.Latest,
          true,
        );
        const names = [];
        for (const node of ast.statements) {
          if (
            node.modifiers?.some((x) => x.kind === ts.SyntaxKind.ExportKeyword)
          ) {
            if (node.name) names.push(node.name.text);
            if (ts.isVariableStatement(node))
              for (const declaration of node.declarationList.declarations)
                names.push(declaration.name.getText(ast));
          }
        }
        return {
          contents: names
            .filter(Boolean)
            .map((name) =>
              name === "inFleet"
                ? `export const inFleet=(path,fleet)=>path+(path.includes('?')?'&':'?')+'fleet='+fleet;`
                : `export const ${name}=async(...args)=>{window.lastAction={name:'${name}',fields:args[1] instanceof FormData?Object.fromEntries(args[1]):null};return {kind:'idle'};};`,
            )
            .join("\n"),
          loader: "js",
        };
      });
      build.onResolve({ filter: /^next\/navigation$/ }, () => ({
        path: "navigation",
        namespace: "stub",
      }));
      build.onResolve({ filter: /^node:crypto$/ }, () => ({
        path: "crypto",
        namespace: "stub",
      }));
      build.onLoad({ filter: /.*/, namespace: "stub" }, (args) => ({
        contents:
          args.path === "crypto"
            ? `export const randomUUID=()=>crypto.randomUUID();`
            : `export const useRouter=()=>({refresh(){},push(){},replace(){}});export const usePathname=()=>'/bridge';export const useSearchParams=()=>new URLSearchParams();export const redirect=()=>{};`,
        loader: "js",
      }));
    },
  };
  await esbuild.build({
    stdin: { contents: entry, loader: "tsx", resolveDir: source },
    plugins: [stubPlugin],
    bundle: true,
    format: "esm",
    outfile: tmp + "/" + version + ".js",
    jsx: "automatic",
    define: { "process.env.NODE_ENV": '"production"', "process.env": "{}" },
  });
  const css = await postcss([tailwind()]).process(
    readFileSync(source + "/web/app/globals.css", "utf8"),
    { from: source + "/web/app/globals.css" },
  );
  writeFileSync(
    tmp + "/" + version + ".css",
    css.css +
      `\n@font-face{font-family:Geist;src:url(/geist-variable.woff2);font-weight:100 900}@font-face{font-family:GeistMono;src:url(/geist-mono-variable.woff2);font-weight:100 900}:root{--font-geist-sans:Geist;--font-geist-mono:GeistMono}`,
  );
}
const server = createServer((req, res) => {
  const url = new URL(req.url, "http://localhost");
  if (url.pathname === "/") {
    res.setHeader("content-type", "text/html");
    const version = url.searchParams.get("version");
    const dark = url.searchParams.get("theme") === "dark";
    res.end(
      '<!doctype html><html class="' +
        (dark ? "dark" : "") +
        '"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/' +
        version +
        '.css"><body class="bg-background text-foreground p-4"><main id="root" class="grid gap-4" style="grid-template-columns:minmax(0,1fr);min-width:0"></main><script type="module" src="/' +
        version +
        '.js"></script>',
    );
  } else if (url.pathname.endsWith(".woff2")) {
    res.setHeader("content-type", "font/woff2");
    res.end(readFileSync(root + "/web/app/fonts" + url.pathname));
  } else {
    res.setHeader(
      "content-type",
      url.pathname.endsWith(".css") ? "text/css" : "text/javascript",
    );
    res.end(readFileSync(tmp + url.pathname));
  }
});
await new Promise((r) => server.listen(0, "127.0.0.1", r));
const browser = await chromium.launch();
const failures = [];
let captures = 0;
let checks = 0;
try {
  for (const version of process.env.UI_CAPTURE_VERSION
    ? [process.env.UI_CAPTURE_VERSION]
    : ["before", "after"])
    for (const theme of ["light", "dark"])
      for (const width of [375, 1440, 1920])
        for (const scenario of process.env.UI_CAPTURE_SCENARIO
          ? [process.env.UI_CAPTURE_SCENARIO]
          : scenarios) {
          const page = await browser.newPage({
            viewport: { width, height: 1000 },
            reducedMotion: "reduce",
          });
          const errors = [];
          page.on("pageerror", (e) => {
            errors.push(e.message);
            log("PAGE ERROR", scenario, e.message);
          });
          await page.goto(
            "http://127.0.0.1:" +
              server.address().port +
              "/?" +
              new URLSearchParams({ version, theme, scenario }),
          );
          try {
            await page.waitForFunction(
              () => globalThis.fixtureReady,
              {},
              { timeout: 3000 },
            );
            await page.evaluate(() => globalThis.document.fonts.ready);
            await page.waitForTimeout(150);
            if (scenario === "tools-scopes-dialog") {
              await page.getByTestId("tools-table-select").click();
              if (width < 640)
                await page.getByTestId("tools-table-sheet-open").click();
              await page
                .getByTestId("tools-table-set-scopes")
                .filter({ visible: true })
                .click();
              await page.getByTestId("tools-table-scopes-dialog").waitFor();
            }
            if (scenario === "agent-needs-dialog") {
              await page.getByTestId("agent-needs-change").click();
              await page.getByTestId("agent-needs-dialog").waitFor();
            }
            if (scenario === "scope-picker")
              await page.getByRole("combobox").click();
            if (scenario.startsWith("toast")) await page.waitForTimeout(200);
            if (
              await page.evaluate(
                () =>
                  globalThis.document.documentElement.scrollWidth >
                  globalThis.innerWidth,
              )
            ) {
              log(
                "OVERFLOW",
                await page.evaluate(() =>
                  Array.from(globalThis.document.querySelectorAll("*"))
                    .filter(
                      (e) =>
                        e.getBoundingClientRect().right > globalThis.innerWidth,
                    )
                    .map((e) => ({
                      tag: e.tagName,
                      class: e.className,
                      width: e.getBoundingClientRect().width,
                      overflow: globalThis.getComputedStyle(e).overflow,
                      position: globalThis.getComputedStyle(e).position,
                    }))
                    .slice(0, 40),
                ),
              );
              errors.push("horizontal overflow");
            }
            if (
              process.env.UI_INTERACTION_CHECK === "1" &&
              scenario === "outside-party-agent"
            ) {
              await page.getByRole("switch", { name: "Repeatable" }).click();
              await page.waitForFunction(
                () => globalThis.lastAction?.name === "markA2aAgent",
                {},
                { timeout: 1000 },
              );
              checks += 1;
              log("Repeatable switch submitted");
            }
            if (
              process.env.UI_INTERACTION_CHECK === "1" &&
              scenario === "a2a-agent"
            ) {
              await page.getByRole("checkbox").last().check();
              const selected = await page
                .locator("form")
                .evaluate((form) =>
                  new globalThis.FormData(form).get("scope:crm:read-leads"),
                );
              if (selected !== "on")
                throw new Error(
                  "The selected plugin scope must be submitted as on",
                );
              checks += 1;
              log("Selected plugin scope is submitted as on");
            }
            if (process.env.UI_INTERACTION_CHECK !== "1") {
              await page.screenshot({
                path:
                  out +
                  "/" +
                  version +
                  "-" +
                  scenario +
                  "-" +
                  width +
                  "-" +
                  theme +
                  ".png",
                fullPage: true,
                animations: "disabled",
              });
              captures += 1;
            }
          } catch (error) {
            errors.push(error.message);
          }
          if (errors.length) {
            failures.push({ version, theme, width, scenario, errors });
            log(JSON.stringify(failures));
            throw Error("Fixture failed: " + scenario);
          }
          await page.close();
        }
} finally {
  await browser.close();
  server.close();
}
writeFileSync(tmp + "/visual-failures.json", JSON.stringify(failures, null, 2));
log(JSON.stringify({ screenshots: captures, checks, failures }));
