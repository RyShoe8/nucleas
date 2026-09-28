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

Only `/health` and `/v1/execute` need to be public. `/v1/execute` requires the dedicated bearer token.

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

Check that the health response lists the `inference` feature:

```json
{"ok":true,"busy":false,"features":["inference"]}
```

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
