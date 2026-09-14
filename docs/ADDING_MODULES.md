# Adding another MCP module

The hub reserves one top-level path per module. Artifact owns `/artifact`, Questionnaire owns `/questionnaire`, and a future module named `example` should own `/example` with its Streamable HTTP endpoint at `/example/mcp`.

1. Create `src/<module>/mcp.js` with a factory returning a fresh `McpServer` per request.
2. Put domain/storage logic under `src/<module>/`; do not couple it to Artifact storage.
3. Declare the MCP access policy explicitly. Mount `sharedSecretAuth(config.secretFile)` before `/<module>/mcp` unless the module is intentionally public, as Questionnaire is.
4. For authenticated modules, reuse the common secret; do not create per-module or per-user credentials unless the security model is intentionally changed. For public management modules, document that every tool—including reads and deletion—is callable by anyone who can reach the endpoint.
5. Keep public resources below the module namespace and explicitly document which routes are public.
6. Add protocol-level tests using `StreamableHTTPClientTransport`.
7. Add the module name to `/healthz` only after its dependency checks pass, and update the watchdog to require it.

Caddy proxies the whole `mcp.aravindmj.in` host to this hub, so adding a module does not require another ingress rule.
