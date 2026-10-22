/* =========================================================================
   Pixelkiez — Fadenkreuz-Knopf: die vier Ecken
   Uebertragen aus CrosshairButton.tsx (Pixelkiez_Crosshair_Button_
   2026-10-21.zip). Die Komponente rendert vor dem Inhalt vier leere,
   aria-hidden Eck-Spans; genau die setzt dieses Skript in die vorhandenen
   Hauptknoepfe ein. Beschriftung, Ziel, Typ und Klickverhalten bleiben,
   wie sie sind — es kommt kein Text dazu. Gestaltet in crosshair-button.css.
   Doppelte Anfuehrungszeichen: siehe sstr-motion.js.
   ========================================================================= */
(function () {
  "use strict";
  var ecken = ["tl", "tr", "bl", "br"];
  // Hauptknoepfe im Inhalt und der schwebende Schnellkontakt
  var knoepfe = document.querySelectorAll(".btn.btn--primary:not(.btn--sm)");
  Array.prototype.forEach.call(knoepfe, function (knopf) {
    if (knopf.querySelector(".pxk-crosshair-button__corner")) return;
    for (var i = ecken.length - 1; i >= 0; i--) {
      var ecke = document.createElement("span");
      ecke.className = "pxk-crosshair-button__corner pxk-crosshair-button__corner--" + ecken[i];
      ecke.setAttribute("aria-hidden", "true");
      knopf.insertBefore(ecke, knopf.firstChild);
    }
  });

  /* Der schwebende Knopf steht ueber wechselnden Abschnitten; seine Kreuze
     liegen zur Haelfte ausserhalb. Ton nach der Flaeche unter seiner Mitte,
     dieselbe Regel wie fuer den Kopf (sstr-motion.js). */
  var sticky = document.querySelector(".btn.sticky-cta");
  if (!sticky) return;
  var flaechen = Array.prototype.slice.call(document.querySelectorAll("main > section, main > aside, .footer"));
  var istDunkel = function (el) {
    var m = getComputedStyle(el).backgroundColor.match(/\d+(\.\d+)?/g);
    if (!m || (m.length > 3 && +m[3] === 0)) return false;
    return (0.2126 * m[0] + 0.7152 * m[1] + 0.0722 * m[2]) < 110;
  };
  var dunkle = flaechen.filter(istDunkel);
  var ton = null, geplant = 0;
  var pruefen = function () {
    geplant = 0;
    var r = sticky.getBoundingClientRect(), y = r.top + r.height / 2, neu = "hell";
    for (var i = 0; i < dunkle.length; i++) {
      var q = dunkle[i].getBoundingClientRect();
      if (q.top <= y && q.bottom > y) { neu = "dunkel"; break; }
    }
    if (neu !== ton) { ton = neu; sticky.setAttribute("data-ton", neu); }
  };
  var planen = function () { if (!geplant) geplant = window.requestAnimationFrame(pruefen); };
  pruefen();
  window.addEventListener("scroll", planen, { passive: true });
  window.addEventListener("resize", function () { dunkle = flaechen.filter(istDunkel); planen(); });
})();
