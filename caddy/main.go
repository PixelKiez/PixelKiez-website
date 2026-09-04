// Einstiegspunkt fuer den eigenen Caddy-Uebersetzungslauf (siehe Dockerfile,
// Stufe "caddybuild"). Inhaltlich identisch mit dem Einstiegspunkt des
// offiziellen Caddy-Images: derselbe Befehlssatz, dieselben Standardmodule,
// keine Erweiterung. Neu ist ausschliesslich, mit welcher Go-Toolchain und
// welchen Abhaengigkeitsstaenden uebersetzt wird.
package main

import (
	caddycmd "github.com/caddyserver/caddy/v2/cmd"

	// Die Standardmodule von Caddy — file_server, reverse_proxy, encode,
	// header, die Caddyfile-Adapter. Ohne diesen Import kennt das Binary
	// die Direktiven aus dem Caddyfile nicht.
	_ "github.com/caddyserver/caddy/v2/modules/standard"
)

func main() {
	caddycmd.Main()
}
