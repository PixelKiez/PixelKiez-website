# Zweistufig: erst wird gebaut, dann ausgeliefert. Das Image enthaelt am Ende
# weder Node noch node_modules — nur das Ergebnis aus dist/ und Caddy.
#
# Wichtig: kein --omit=optional bei npm ci. esbuild bezieht seine
# Plattformbinaerdatei ueber optionalDependencies; ohne sie bricht der Build.

FROM node:22-alpine AS build
WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

COPY site/ ./site/
COPY scripts/ ./scripts/
RUN npm run build

# Der Build bricht bei jedem Einbettungsfehler selbst ab (siehe pruefe() in
# scripts/build.mjs). Hier nur noch die Gegenprobe, dass etwas entstanden ist.
RUN test -f dist/index.html && test -d dist/assets/fonts

# ---------------------------------------------------------------------------
# Caddy wird aus der offiziellen Quelle neu uebersetzt.
#
# Warum nicht einfach das fertige Laufzeitbinary nehmen: das offizielle
# caddy:2.11.4-alpine liefert ein Binary, das mit Go 1.26.3 und den
# Modulstaenden vom Release-Tag gebaut ist. Trivy meldet darin 15 HIGH und
# 1 CRITICAL (golang.org/x/crypto CVE-2026-56854). 2.11.4 ist die neueste
# Caddy-Freigabe (03.06.2026) — ein neueres offizielles Laufzeitimage, in dem
# diese Funde behoben waeren, gibt es nicht; der Tagwechsel 2-alpine ->
# 2.11.4-alpine trifft dasselbe Binary.
#
# Das offizielle Builder-Image derselben Version traegt dagegen eine aktuelle
# Go-Toolchain (Stand 03.09.2026: go1.26.8). Uebersetzt wird damit exakt
# dieselbe Quelle — Modulpfad github.com/caddyserver/caddy/v2, Tag v2.11.4,
# ueber die Go-Checksum-Datenbank geprueft —, nur mit aktuellem stdlib und mit
# den vier von Trivy benannten Modulen ausdruecklich angehoben. Keine
# Erweiterung, kein Plugin, kein fremdes Laufzeitimage.
#
# Die Toolchain des Builder-Images ist bewusst nicht per Digest festgenagelt:
# ein Rebuild soll kuenftige stdlib-Korrekturen mitnehmen. Festgenagelt ist,
# worauf es fuer die Reproduzierbarkeit ankommt — die Caddy-Version und die
# vier Modulstaende. Der Bauschritt gibt beides ins Protokoll aus.
FROM caddy:2.11.4-builder-alpine AS caddybuild
ENV CGO_ENABLED=0
WORKDIR /caddy
COPY caddy/main.go ./main.go
# Zwei Fallen liegen hier hintereinander, beide gemessen am 04.09.2026.
#
# Erstens die Reihenfolge: `go mod tidy` laeuft VOR den Anhebungen. Danach
# setzt es die vier Module auf das Minimum zurueck, das der Modulgraph
# verlangt, und nimmt die Anhebung stillschweigend wieder zurueck
# (CI-Lauf 33882838213: angefordert x/crypto v0.55.0, gebaut v0.53.0 — und
# mit ihm blieb CVE-2026-56854, CRITICAL, im Binary).
#
# Zweitens die Zerlegung in einzelne Aufrufe: `go get` zieht andere Module
# herunter, um die angeforderte Version aufzuloesen. Nacheinander ausgefuehrt
# hat `go get x/net@v0.56.0` — die von Trivy genannte Mindestfassung —
# x/crypto von v0.55.0 auf v0.54.0 gedrueckt, `go get x/text@v0.39.0` dann
# weiter auf v0.53.0 (CI-Lauf 33883177261). Deshalb ein einziger Aufruf mit
# allen vieren, und zwar auf dem Stand, den x/crypto v0.55.0 ohnehin
# mitbringt statt auf dem jeweiligen Minimum.
#
# Weil beide Ruecknahmen lautlos passieren, steht danach eine Gegenprobe:
# stimmt eine der vier Versionen nicht, bricht der Bauschritt ab, statt ein
# Binary auszuliefern, das anders zusammengesetzt ist als angegeben.
RUN go mod init pixelkiez/caddy \
 && go get github.com/caddyserver/caddy/v2@v2.11.4 \
 && go mod tidy \
 && go get golang.org/x/crypto@v0.55.0 golang.org/x/net@v0.57.0 \
           golang.org/x/text@v0.41.0 google.golang.org/grpc@v1.83.1 \
 && for paar in golang.org/x/crypto@v0.55.0 golang.org/x/net@v0.57.0 \
                golang.org/x/text@v0.41.0 google.golang.org/grpc@v1.83.1; do \
      modul="${paar%@*}"; soll="${paar#*@}"; ist="$(go list -m -f '{{.Version}}' "$modul")"; \
      if [ "$ist" != "$soll" ]; then \
        echo "Abbruch: ${modul} steht auf ${ist} statt ${soll}"; exit 1; \
      fi; \
      echo "geprueft: ${modul} ${ist}"; \
    done \
 && go build -trimpath -ldflags "-s -w" -o /out/caddy . \
 && go version \
 && go list -m github.com/caddyserver/caddy/v2 golang.org/x/crypto \
      golang.org/x/net golang.org/x/text google.golang.org/grpc

FROM caddy:2.11.4-alpine

# Die Alpine-Pakete des Basisimages nachziehen. c-ares, curl/libcurl und
# libcrypto3/libssl3 tragen dort sieben HIGH-Funde, fuer die es im
# Alpine-Zweig 3.23 bereits korrigierte Versionen gibt. Kein Pinning auf
# exakte Paketversionen: die naechste Korrektur soll ein Rebuild mitnehmen,
# nicht an einer veralteten Zeile scheitern.
RUN apk --no-cache upgrade

# Das neu uebersetzte Binary ersetzt das des Basisimages. Damit verliert es
# auch dessen Capability — cap_net_bind_service muss neu gesetzt werden,
# sonst kann der unprivilegierte Prozess Port 80 nicht binden. setcap liegt
# im Basisimage bereits vor (libcap-setcap).
COPY --from=caddybuild /out/caddy /usr/bin/caddy
RUN setcap cap_net_bind_service=+ep /usr/bin/caddy \
 && caddy version

COPY --from=build /app/dist /srv
COPY Caddyfile /etc/caddy/Caddyfile

# Das offizielle Caddy-Alpine-Image startet standardmaessig als root. Fuer
# statische Auslieferung und Reverse-Proxying braucht Pixelkiez keine Root-
# Identitaet. Die Capability oben erlaubt dem unprivilegierten Prozess den
# Port; /config/caddy und /data/caddy stellt das Basisimage beschreibbar
# bereit.
RUN addgroup -S caddy-runtime \
    && adduser -S -D -H -G caddy-runtime caddy-runtime
USER caddy-runtime

EXPOSE 80
CMD ["caddy", "run", "--config", "/etc/caddy/Caddyfile", "--adapter", "caddyfile"]
