# Formular-Gegenstelle. Eigener Railway-Dienst, getrennt von der Website:
# faellt er aus, bleibt die Seite erreichbar und das Formular weicht auf den
# E-Mail-Pfad aus.
#
# Die Pfade sind bewusst vom Projektstamm aus geschrieben, nicht von api/.
# Railway laedt beim Deploy den Stamm hoch; mit RAILWAY_DOCKERFILE_PATH=
# api/Dockerfile wird zwar diese Datei gebaut, der Kontext bleibt aber der
# Stamm. Relative Pfade wuerden hier die falsche package.json erwischen.

# Abhaengigkeiten in einer eigenen Stufe, damit npm im Auslieferungsimage
# nicht gebraucht wird.
FROM node:22-alpine AS deps
RUN apk --no-cache upgrade
WORKDIR /app
COPY api/package.json api/package-lock.json ./
RUN npm ci --omit=dev

FROM node:22-alpine

# Zwei Aufraeumarbeiten, beide gemessen am 04.09.2026 mit Trivy 0.70.0:
#
# 1. Die Alpine-Pakete des Basisimages nachziehen — libcrypto3/libssl3 tragen
#    dort einen HIGH-Fund mit vorhandener Korrektur. Ohne Versionspinning,
#    damit ein Rebuild die naechste Korrektur mitnimmt.
#
# 2. Die mitgelieferte npm-Kommandozeile entfernen. Sie brachte 10 HIGH und
#    1 CRITICAL mit (u. a. tar CVE-2026-59873, brace-expansion CVE-2026-13149)
#    — allesamt in /usr/local/lib/node_modules/npm/node_modules/, keiner in
#    den Abhaengigkeiten dieses Dienstes. Der Dienst startet mit
#    `node server.mjs`; npm, npx, corepack und yarn werden zur Laufzeit nicht
#    gebraucht. Der verwundbare Code wird also entfernt, nicht stummgeschaltet.
#    Wer im Container etwas nachinstallieren will, baut das Image neu.
RUN apk --no-cache upgrade \
 && rm -rf /usr/local/lib/node_modules/npm \
           /usr/local/lib/node_modules/corepack \
           /usr/local/bin/npm /usr/local/bin/npx /usr/local/bin/corepack \
           /usr/local/bin/yarn /usr/local/bin/yarnpkg /opt/yarn-* \
 && node --version

WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY api/package.json ./package.json
COPY api/server.mjs ./

# Nicht als root laufen lassen.
USER node

EXPOSE 3000
CMD ["node", "server.mjs"]
