# VPS execution-worker deployment

This deployment runs the Nucleas repository execution worker on the Nucleas-operated VPS. It does not move model inference to the VPS. LiteLLM and vLLM remain remote.

The existing Playwright browser worker remains a separate service. Do not combine both workers in one container, share their secrets, or give either service access to the Docker socket or host filesystem.

## Responsibility split

### Nucleas VPS operator

Owns the execution-worker container, HTTPS endpoint, resource limits, updates, monitoring, and worker token.

### Model infrastructure operator

Owns LiteLLM, compatible model deployments, the `/v1/models` catalog, and the LiteLLM credential.

### Nucleas administrator

Owns the Vercel variables, GitHub App configuration, project-to-repository bindings, and explicit publish confirmations.

## First deployment

Run from the cloned Nucleas repository:

```bash
cd deploy/vps
cp execution-worker.env.example execution-worker.env
chmod 600 execution-worker.env
openssl rand -hex 32
```

Put the generated value in `NUCLEAS_EXECUTION_WORKER_TOKEN`. Add the LiteLLM endpoint and credential. Keep:

```env
NUCLEAS_AI_REMOTE_MODEL=Qwen/Qwen2.5-Coder-14B-Instruct-AWQ
```

Build and start:

```bash
docker compose -f execution-worker.compose.yml build --pull
docker compose -f execution-worker.compose.yml up -d
docker compose -f execution-worker.compose.yml ps
curl --fail http://127.0.0.1:8788/health
```

Expected health response:

```json
{"ok":true,"busy":false}
```

## HTTPS

The container listens only on VPS loopback. Publish it through the VPS's existing HTTPS reverse proxy.

For Caddy, copy the relevant block from `Caddyfile.example`, replace `worker.example.com`, reload Caddy, and verify:

```bash
curl --fail https://worker.example.com/health
```

Only `/health`, `/v1/execute`, and `/v1/property-crawls` need to be public. Both POST endpoints require the dedicated bearer token.

## Vercel handoff

Add these Production variables to the Nucleas Vercel project:

```env
NUCLEAS_EXECUTION_WORKER_URL=https://worker.example.com
NUCLEAS_EXECUTION_WORKER_TOKEN=<the same dedicated worker token>
```

Do not append `/v1/execute` to the URL. Redeploy Nucleas after saving the variables.

## Updating

```bash
git pull --ff-only origin main
cd deploy/vps
docker compose -f execution-worker.compose.yml build --pull
docker compose -f execution-worker.compose.yml up -d --remove-orphans
docker image prune -f
curl --fail http://127.0.0.1:8788/health
```

Changing models behind the LiteLLM alias does not require rebuilding or restarting this worker.

Check that the health response lists inference and property-crawl support:

```json
{"ok":true,"busy":false,"propertyCrawlBusy":false,"features":["inference","definition_of_done","property_crawl"]}
```

Company Overview crawls are asynchronous and accuracy-first. Nucleas starts the crawl, the VPS follows the complete public first-party site, and authenticated callbacks archive each page in Nucleas. A crawl may run for many minutes without holding open a Vercel request. Rebuilding or restarting the worker interrupts an active crawl; wait for `propertyCrawlBusy` to be false before updating the container.

After discovery, the worker uses its configured remote model to synthesize a grounded property description, primary keywords, demographic target, and up to ten likely direct competitors from representative first-party pages. If inference is unavailable, the crawl still completes with deterministic page metadata and explicitly marks audience/competitor gaps instead of inventing them.

When the existing Nucleas Playwright worker is configured in Vercel, its endpoint and credential are handed to the execution worker only for the active crawl. Thin or JavaScript-shell pages are rendered automatically and marked as rendered evidence in the report. No additional Playwright setting is required in `execution-worker.env`.

## Models

Nucleas's AI engine chooses the model for each build (the code pick at the plan's cost level) and sends its endpoint, credential and model id with the request. The worker uses them for that build only and never stores them. `NUCLEAS_AI_REMOTE_*` is the fallback for requests without an engine choice. A worker without the `inference` feature keeps building on its own model until it is updated.

## Capacity for a 4-core, 8 GB VPS

The execution worker is limited to 2 CPUs, 4 GB RAM, 128 processes, one active request, and 4 GB of disposable temporary storage. Leave the remaining capacity for the operating system, reverse proxy, and separate Playwright service.

Do not increase execution concurrency on this VPS. Move one worker to a separate host or upgrade the VPS before adding concurrent repository builds.

## Network and host requirements

- Allow inbound HTTPS only through the reverse proxy.
- Allow worker outbound traffic only to GitHub, LiteLLM, the AI providers enabled in Nucleas (for example api.openai.com, openrouter.ai, generativelanguage.googleapis.com, api.deepseek.com), and approved package registries.
- Block cloud metadata endpoints and private production networks.
- Do not mount the Docker socket, host directories, credentials, or `/proc`.
- Do not use host networking, privileged mode, or a shared PID namespace.
- Keep the Playwright worker in a different container with a different secret.
- Set log rotation and disk-usage alerts.

## Rollback

Build a previous Git revision and start the compose service again. The worker stores no durable repository state, so rollback does not require data migration.
