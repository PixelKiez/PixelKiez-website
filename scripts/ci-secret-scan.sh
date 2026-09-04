#!/usr/bin/env bash
# Geheimnis-Suche ueber die vollstaendige committete Historie.
#
# Warum nicht die Action: gitleaks/gitleaks-action@v3 verlangt fuer Repos in
# einer Organisation einen Lizenzschluessel und bricht ohne ihn ab, bevor
# ueberhaupt gescannt wird ("missing gitleaks license"). Das Tor war damit
# dauerhaft rot, ohne je eine Zeile geprueft zu haben. Hier laeuft stattdessen
# das offizielle gitleaks-Containerabbild, auf einen unveraenderlichen Digest
# festgenagelt und ohne Lizenzpflicht.
#
# Warum der Umweg ueber ein Protokoll statt nur ueber den Rueckgabewert:
# gitleaks meldet "no leaks found" und beendet sich mit 0, auch wenn git ihm
# das Repository verweigert hat und null Commits gelesen wurden. Gemessen am
# 04.09.2026: "0 commits scanned" + "no leaks found" + Exit 0. Ein Tor, das auf
# diesem Weg gruen wird, hat nichts geprueft. Deshalb wird hier verlangt, dass
# git sich nicht beschwert hat und dass tatsaechlich Commits gelesen wurden.
#
# Aufrufe:
#   scripts/ci-secret-scan.sh [pfad]
#       Historie pruefen. Exit 0 = sauber, 1 = Fund, 2 = Lauf nicht belastbar.
#   scripts/ci-secret-scan.sh --kanarienvogel
#       Gegenprobe: legt in einem Wegwerf-Klon ein synthetisches Geheimnis an
#       und verlangt, dass der Scanner darauf rot wird. Der Klon liegt
#       ausserhalb des Arbeitsbaums und wird danach geloescht; die echte
#       Historie bekommt das Testgeheimnis nie zu sehen.
set -euo pipefail

# gitleaks v8.30.1, ueber den Digest festgenagelt.
GITLEAKS='ghcr.io/gitleaks/gitleaks@sha256:c00b6bd0aeb3071cbcb79009cb16a60dd9e0a7c60e2be9ab65d25e6bc8abbb7f'

ohne_farbe() { sed -E 's/\x1b\[[0-9;]*m//g'; }

# Ein Scanlauf gegen ein Repository.
#   0 = sauber, 1 = Fund, 2 = der Lauf taugt nicht als Beleg.
# Kein `set +e`/`set -e` im Rumpf: `set` wirkt shellweit und wuerde errexit
# beim Aufrufer wieder einschalten. Stattdessen `|| rc=$?`.
scanne() {
  local ziel="$1" protokoll rc gescannt

  if [[ "$(git -C "$ziel" rev-parse --is-shallow-repository)" != 'false' ]]; then
    echo "FEHLER: Historie ist abgeschnitten (shallow) — der Scan waere unvollstaendig." >&2
    return 2
  fi
  echo "Historie: $(git -C "$ziel" rev-list --all --count) Commits," \
       "davon $(git -C "$ziel" rev-list --all --merges --count) Zusammenfuehrungen"

  protokoll="$(mktemp)"
  rc=0
  docker run --rm --network none \
    -v "${ziel}:/repo:ro" \
    -e GIT_CONFIG_COUNT=1 \
    -e GIT_CONFIG_KEY_0=safe.directory \
    -e GIT_CONFIG_VALUE_0=/repo \
    "$GITLEAKS" git --redact --exit-code 1 --no-banner /repo \
    >"$protokoll" 2>&1 || rc=$?

  ohne_farbe <"$protokoll" | sed 's/^/  /'

  # git-Fehler tarnen sich als erfolgreicher Lauf. Sie sind ein Abbruch.
  if ohne_farbe <"$protokoll" | grep -qE 'ERR .*\[git\] fatal|ERR .*stderr is not empty'; then
    echo "FEHLER: git hat dem Scanner das Repository verweigert — der Lauf ist wertlos." >&2
    rm -f "$protokoll"
    return 2
  fi

  gescannt="$(ohne_farbe <"$protokoll" | sed -nE 's/.*[^0-9]([0-9]+) commits scanned.*/\1/p' | tail -1)"
  rm -f "$protokoll"
  if [[ -z "$gescannt" || "$gescannt" -eq 0 ]]; then
    echo "FEHLER: 0 Commits gelesen — das Tor haette ohne Pruefung gruen gemeldet." >&2
    return 2
  fi
  echo "Gelesen: ${gescannt} Commits"
  return "$rc"
}

if [[ "${1:-}" == '--kanarienvogel' ]]; then
  # Der Testschluessel wird bei jedem Lauf neu gewuerfelt. Stuende ein fester
  # Wert in dieser Datei, wuerde der Scanner sein eigenes Werkzeug melden.
  #
  # Bewusst kein AWS-Beispielschluessel: gitleaks laesst die dokumentierten
  # Beispielwerte durch. Gemessen am 04.09.2026 — AKIA + IOSFODNN7EXAMPLE
  # ergibt "no leaks found" und Exit 0. Ein Kanarienvogel, der nicht singen
  # kann, beweist nichts. Genommen wird deshalb ein zufaelliges Muster in der
  # Form eines GitHub-Zugriffstokens.
  #
  # `head -c` als letztes Glied wuerde die Pipe vorzeitig schliessen und unter
  # `set -o pipefail` mit 141 (SIGPIPE) abbrechen. `cut` liest zu Ende.
  TESTSCHLUESSEL="ghp_$(LC_ALL=C head -c 4096 /dev/urandom | LC_ALL=C tr -dc 'a-zA-Z0-9' | cut -c1-36)"

  klon="$(mktemp -d "${TMPDIR:-/tmp}/pxk-kanarienvogel.XXXXXX")"
  trap 'rm -rf "$klon"' EXIT
  quelle="$(git rev-parse --show-toplevel)"
  git -c advice.detachedHead=false clone --quiet "$quelle" "$klon/repo"
  cd "$klon/repo"
  printf 'token: %s\n' "$TESTSCHLUESSEL" > kanarienvogel.txt
  git add kanarienvogel.txt
  git -c user.name='Kanarienvogel' -c user.email='kanarienvogel@example.invalid' \
      commit --quiet -m 'Wegwerf-Fixture mit synthetischem Geheimnis'
  echo "Kanarienvogel: synthetisches Geheimnis committet in ${klon}/repo"

  rc=0
  scanne "$klon/repo" || rc=$?

  if [[ "$rc" -eq 0 ]]; then
    echo "FEHLER: Der Scanner hat das synthetische Geheimnis nicht gefunden — das Tor kann nicht rot werden." >&2
    exit 1
  fi
  if [[ "$rc" -ne 1 ]]; then
    echo "FEHLER: Der Kanarienvogel-Lauf brach ab (rc=${rc}) statt einen Fund zu melden." >&2
    exit 1
  fi
  echo "Kanarienvogel: Fund gemeldet, rc=${rc} — das Tor kann rot werden."

  cd "$quelle"
  rm -rf "$klon"
  trap - EXIT
  if [[ -e "$klon" ]]; then
    echo "FEHLER: Wegwerf-Klon ${klon} liegt noch da." >&2
    exit 1
  fi
  echo "Kanarienvogel: Wegwerf-Klon geloescht."

  # Gegenprobe, dass das Testgeheimnis die echte Historie nie erreicht hat.
  if git -C "$quelle" log --all -S "$TESTSCHLUESSEL" --oneline | grep -q .; then
    echo "FEHLER: Das Testgeheimnis steht in der Zielhistorie." >&2
    exit 1
  fi
  if git -C "$quelle" status --porcelain | grep -q 'kanarienvogel'; then
    echo "FEHLER: Eine Kanarienvogel-Datei liegt im Arbeitsbaum." >&2
    exit 1
  fi
  echo "Kanarienvogel: Zielhistorie und Arbeitsbaum unberuehrt."
  exit 0
fi

scanne "${1:-$(git rev-parse --show-toplevel)}"
