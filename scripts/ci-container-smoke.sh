#!/usr/bin/env bash
set -euo pipefail

NETWORK="pixelkiez-ci-${GITHUB_RUN_ID:-local}-$$"
API_NAME="pixelkiez-api-ci-${GITHUB_RUN_ID:-local}-$$"
WEB_NAME="pixelkiez-web-ci-${GITHUB_RUN_ID:-local}-$$"
WEB_PORT="18080"

cleanup() {
  docker rm -f "$WEB_NAME" "$API_NAME" >/dev/null 2>&1 || true
  docker network rm "$NETWORK" >/dev/null 2>&1 || true
}
trap cleanup EXIT

# `set -e` verschluckt die Ursache: schlaegt eine nackte grep-Zeile fehl,
# endet das Skript ohne eine einzige Zeile Ausgabe — genau so sah der
# fehlgeschlagene CI-Lauf aus, "exit code 1" und sonst nichts. Jede
# Zusicherung bekommt deshalb einen Namen und meldet sich selbst.
zusichern() {
  local name="$1"; shift
  if "$@"; then
    echo "  ok    ${name}"
  else
    echo "  FEHLT ${name}" >&2
    return 1
  fi
}

# Der Rumpf wird ueber eine Funktion geprueft, damit auch Pipelines
# (head | grep) unter zusichern laufen koennen.
rumpf_beginnt_mit_doctype() {
  head -c 200 "$1" | grep -qiE '^[[:space:]]*<!doctype html>'
}

docker network create "$NETWORK" >/dev/null

docker run -d --name "$API_NAME" --network "$NETWORK" \
  -e PORT=3000 \
  -e MAIL_DRYRUN=1 \
  -e ALLOWED_ORIGIN=https://pixelkiez.de \
  pixelkiez-api-ci >/dev/null

docker run -d --name "$WEB_NAME" --network "$NETWORK" \
  -p "127.0.0.1:${WEB_PORT}:80" \
  -e API_UPSTREAM="${API_NAME}:3000" \
  pixelkiez-web-ci >/dev/null

wait_http() {
  local url="$1"
  for _ in $(seq 1 60); do
    if curl --fail --silent --show-error "$url" >/dev/null 2>&1; then
      return 0
    fi
    sleep 0.25
  done
  echo "Timed out waiting for $url" >&2
  docker logs "$WEB_NAME" >&2 || true
  docker logs "$API_NAME" >&2 || true
  return 1
}

wait_http "http://127.0.0.1:${WEB_PORT}/"
wait_http "http://127.0.0.1:${WEB_PORT}/api/health"

headers="$(mktemp)"
body="$(mktemp)"
trap 'rm -f "$headers" "$body"; cleanup' EXIT

curl --fail --silent --show-error -D "$headers" -o "$body" \
  "http://127.0.0.1:${WEB_PORT}/"

echo "Kopfzeilen:"
zusichern 'X-Content-Type-Options: nosniff'                grep -qi '^X-Content-Type-Options: nosniff' "$headers"
zusichern 'X-Frame-Options: SAMEORIGIN'                    grep -qi '^X-Frame-Options: SAMEORIGIN' "$headers"
zusichern 'Referrer-Policy: strict-origin-when-cross-origin' grep -qi '^Referrer-Policy: strict-origin-when-cross-origin' "$headers"
zusichern 'Cache-Control: public, max-age=300'             grep -qi '^Cache-Control: public, max-age=300' "$headers"
zusichern 'Content-Type: text/html'                        grep -qi '^Content-Type: *text/html' "$headers"

# Die Antwort muss HTML sein und die Startseite dieses Projekts — nicht
# irgendein Rumpf mit Status 200.
#
# Bis hierher stand an dieser Stelle `grep -q '<!doctype html'`:
# kleingeschrieben und gross-/kleinschreibungsempfindlich. Der Build liefert
# `<!DOCTYPE html>`, weil html-minifier-terser mit caseSensitive laeuft und
# die Schreibweise der Quelle uebernimmt. Das Tor schlug deshalb bei jedem
# Lauf an, gleichgueltig ob die Auslieferung in Ordnung war.
echo "Rumpf:"
zusichern 'beginnt mit einem DOCTYPE (Schreibweise egal)'  rumpf_beginnt_mit_doctype "$body"
zusichern '<html lang="de">'                               grep -q '<html lang="de"' "$body"
zusichern '<title>Pixelkiez …'                             grep -q '<title>Pixelkiez' "$body"
zusichern 'canonical auf https://pixelkiez.de/'            grep -q 'rel="canonical" href="https://pixelkiez.de/"' "$body"
zusichern 'Einstieg in den Wissensbereich'                 grep -q 'href="/wissen/"' "$body"

health="$(curl --fail --silent --show-error "http://127.0.0.1:${WEB_PORT}/api/health")"
node -e '
const h = JSON.parse(process.argv[1]);
if (h.ok !== true) throw new Error("health not ok");
if (h.versandbereit !== false) throw new Error("CI dry-run must not claim delivery readiness");
' "$health"

post='{"name":"CI Test","kontakt":"ci@example.com","ausgangspunkt":"Website ist veraltet","anliegen":"Container integration smoke","quelle":"/ci","consent":true}'
response="$(curl --fail --silent --show-error \
  -H 'Content-Type: application/json' \
  -H 'X-Forwarded-For: 198.51.100.99' \
  --data "$post" \
  "http://127.0.0.1:${WEB_PORT}/api/kontakt")"
node -e '
const r = JSON.parse(process.argv[1]);
if (r.ok !== true) throw new Error("contact smoke was not accepted");
if (!/nicht versendet/i.test(r.hinweis || "")) throw new Error("dry-run must explicitly state non-delivery");
' "$response"

echo "Container integration smoke passed"
