# Beyonder BrowserAgent

Controlled, one-step browser capability for Beyonder. The BrowserAgent exposes structured web actions and compact observations without exposing a general-purpose browser, arbitrary JavaScript, shell, filesystem, clipboard, or host-computer control to the model.

## Architecture

`BrowserAgent` owns session lifecycle and executes exactly one `BrowserAction` per call. `BrowserSession` is the browser-driver boundary; `PlaywrightBrowserSession` is the real implementation. `BrowserPolicyEngine` authorizes navigation/form/click behavior before execution, and Playwright request routing applies navigation policy again to redirects and subresources. `BrowserTelemetrySink` receives redacted audit events. `createBrowserToolDefinitions` exposes explicit `@beyonder/tools` definitions so the runtime path is `ToolRegistry -> ToolPolicy -> ToolExecutor -> BrowserAgent` without a temporary adapter.

## Supported actions

- `open`, `navigate`
- `observe`, `extractText`, `find`
- `click`, `fill`
- `scroll`, `back`
- `current`, `waitFor`
- `screenshot`
- `close`

Targets are semantic (`role`/`name`, `label`, `text`, `placeholder`, `testId`). There is no model-provided JavaScript/evaluate action.

## Tool Runtime integration

The package exports one explicit tool per browser action:

- `browser.open`, `browser.navigate`
- `browser.observe`, `browser.extractText`, `browser.find`
- `browser.click`, `browser.fill`
- `browser.scroll`, `browser.back`
- `browser.current`, `browser.waitFor`
- `browser.screenshot`, `browser.close`

Read/navigation/observation tools are `LOW` risk with `READ` side effects and are compatible with the default Tool Runtime policy. `browser.fill` is `MEDIUM/WRITE`; `browser.click` is `MEDIUM/EXTERNAL_ACTION`, so the default policy blocks them unless a trusted runtime installs a stricter contextual authorization policy. Browser policy still inspects actions before page execution, so `file://`, internal networks, payments, purchases, account creation, executable downloads, verification bypass, and submit controls remain blocked at the browser layer as well.

## Default policy

- HTTP/HTTPS only.
- localhost, loopback, private/link-local networks and private DNS answers blocked by default.
- `allowDomains` and `denyDomains` supported; deny wins.
- navigation and simple form fill allowed.
- uploads/downloads disabled by default; executable downloads are always blocked.
- submit controls are disabled by default; when a trusted runtime enables `allowSubmit`, non-GET/HEAD submits and common mutating controls still require an injected explicit authorization verifier.
- payments, purchases, automatic account creation, CAPTCHA/2FA/KYC/verification bypass are prohibited even when an authorization id is supplied.
- URL credentials are rejected.

`allowInternalNetwork` exists only so deterministic local tests or a trusted runtime policy can opt in. It must not be exposed as a model-controlled switch.

## Observability

Observations contain bounded visible text, interactive-element metadata, forms, links, current URL/title, and recent page errors. Full HTML is never returned. Telemetry emits session, action, navigation, observation, blocked/error, and close events. Fill values, authorization ids, credential-shaped fields, sensitive URL parameters, cookies/tokens/passwords and authorization data are redacted or never emitted.

## Playwright provisioning

The package loads `playwright` dynamically so normal Beyonder installs and unit tests do not acquire a browser runtime implicitly. A deployment that enables the real BrowserAgent must provision Playwright/Chromium explicitly. CI does that only for the deterministic E2E test and read-only public smoke.

## Known v1 limitations

- No account/login automation, downloads/uploads, purchases/payments, CAPTCHA/2FA/KYC handling, arbitrary JavaScript, tabs/popups orchestration, or file chooser support.
- Side-effect classification is intentionally conservative and semantic; Tool Runtime should provide the authorization verifier and may add a stronger action-intent gate later.
- DNS policy rejects private answers before navigation and re-checks every requested URL, but it does not pin resolved IPs to eliminate every theoretical DNS-rebinding race.
- Screenshot output is bounded and returned as base64 for observability; persistent screenshot storage belongs outside this package.
