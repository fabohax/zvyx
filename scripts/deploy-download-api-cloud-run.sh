#!/usr/bin/env bash
set -euo pipefail

PROJECT_ID="${GOOGLE_CLOUD_PROJECT:-${PROJECT_ID:-}}"
REGION="${REGION:-us-east1}"
SERVICE_NAME="${SERVICE_NAME:-z-download-api}"
REPOSITORY="${REPOSITORY:-z-download-api}"
MEMORY="${MEMORY:-1Gi}"
CPU="${CPU:-1}"
CONCURRENCY="${CONCURRENCY:-20}"
TIMEOUT="${TIMEOUT:-3600}"
MIN_INSTANCES="${MIN_INSTANCES:-1}"
MAX_INSTANCES="${MAX_INSTANCES:-10}"
ALLOW_UNAUTHENTICATED="${ALLOW_UNAUTHENTICATED:-true}"

if [[ -z "$PROJECT_ID" ]]; then
  echo "Set GOOGLE_CLOUD_PROJECT or PROJECT_ID before deploying." >&2
  exit 1
fi

TAG="$(git rev-parse --short HEAD 2>/dev/null || date +%Y%m%d%H%M%S)"
IMAGE="${REGION}-docker.pkg.dev/${PROJECT_ID}/${REPOSITORY}/${SERVICE_NAME}:${TAG}"

gcloud config set project "$PROJECT_ID" >/dev/null
gcloud services enable \
  artifactregistry.googleapis.com \
  cloudbuild.googleapis.com \
  run.googleapis.com \
  secretmanager.googleapis.com

if ! gcloud artifacts repositories describe "$REPOSITORY" --location "$REGION" >/dev/null 2>&1; then
  gcloud artifacts repositories create "$REPOSITORY" \
    --repository-format docker \
    --location "$REGION" \
    --description "Container images for the Z download API"
fi

gcloud builds submit --config cloudbuild.download-api.yaml --substitutions "_IMAGE=${IMAGE}" .

deploy_args=(
  run deploy "$SERVICE_NAME"
  --image "$IMAGE"
  --region "$REGION"
  --platform managed
  --memory "$MEMORY"
  --cpu "$CPU"
  --concurrency "$CONCURRENCY"
  --timeout "$TIMEOUT"
  --min-instances "$MIN_INSTANCES"
  --max-instances "$MAX_INSTANCES"
)

env_vars="DOWNLOAD_API_HOST=0.0.0.0,YT_DLP_BINARY_PATH=/usr/local/bin/yt-dlp"
if [[ -n "${DOWNLOAD_API_ALLOW_ORIGIN:-}" ]]; then
  env_vars="${env_vars},DOWNLOAD_API_ALLOW_ORIGIN=${DOWNLOAD_API_ALLOW_ORIGIN}"
fi
deploy_args+=(--set-env-vars "$env_vars")

if [[ "$ALLOW_UNAUTHENTICATED" == "true" ]]; then
  deploy_args+=(--allow-unauthenticated)
else
  deploy_args+=(--no-allow-unauthenticated)
fi

secret_bindings=()
if [[ -n "${DOWNLOAD_API_SHARED_SECRET_SECRET:-}" ]]; then
  secret_bindings+=("DOWNLOAD_API_SHARED_SECRET=${DOWNLOAD_API_SHARED_SECRET_SECRET}:latest")
fi
if [[ -n "${YT_DLP_COOKIES_BASE64_SECRET:-}" ]]; then
  secret_bindings+=("YT_DLP_COOKIES_BASE64=${YT_DLP_COOKIES_BASE64_SECRET}:latest")
fi

if (( ${#secret_bindings[@]} > 0 )); then
  IFS=,
  deploy_args+=(--update-secrets "${secret_bindings[*]}")
  unset IFS
fi

gcloud "${deploy_args[@]}"

service_url="$(gcloud run services describe "$SERVICE_NAME" --region "$REGION" --format 'value(status.url)')"
echo
echo "Download API deployed: ${service_url}"
echo "Set DOWNLOAD_API_BASE_URL=${service_url} on your Next.js/Vercel app."
