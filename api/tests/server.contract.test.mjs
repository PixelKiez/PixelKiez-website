import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { spawn, spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import net from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

let child;
let baseUrl;
/* Im Trockenlauf schreibt der Dienst den fertigen Mailtext in eine Datei im
   Temp-Verzeichnis (MAIL_DRYRUN_DATEI), nie ins Protokoll. Nur so laesst sich
   zeigen, dass das angefragte Paket wirklich in der Mail landet und nicht
   bloss im Formular stand. Das Protokoll (stdout/stderr) wird mitgeschnitten,
   um zu belegen, dass es keine Formularinhalte enthaelt. */
let tempVerzeichnis;
let mailDatei;
let protokoll = '';
const mailtext = () => { try { return readFileSync(mailDatei, 'utf8'); } catch { return ''; } };
const mailLeeren = () => rmSync(mailDatei, { force: true });
// Railway-Variablen der eigenen Shell duerfen die Produktivsperre nicht ausloesen.
const testUmgebung = () => Object.fromEntries(Object.entries(process.env).filter(([k]) => !k.startsWith('RAILWAY_')));

async function freePort() {
  return await new Promise((resolve, reject) => {
    const s = net.createServer();
    s.unref();
    s.on('error', reject);
    s.listen(0, '127.0.0.1', () => {
      const { port } = s.address();
      s.close(() => resolve(port));
    });
  });
}

async function waitForHealth(url) {
  const deadline = Date.now() + 8000;
  let last;
  while (Date.now() < deadline) {
    try {
      const r = await fetch(url + '/api/health');
      if (r.ok) return;
      last = new Error('health HTTP ' + r.status);
    } catch (e) {
      last = e;
    }
    await new Promise((r) => setTimeout(r, 100));
  }
  throw last || new Error('API did not become healthy');
}

before(async () => {
  tempVerzeichnis = mkdtempSync(join(tmpdir(), 'bds-mail-'));
  mailDatei = join(tempVerzeichnis, 'trockenlauf.txt');
  const port = await freePort();
  baseUrl = `http://127.0.0.1:${port}`;
  child = spawn(process.execPath, ['server.mjs'], {
    cwd: new URL('..', import.meta.url),
    env: {
      ...testUmgebung(),
      NODE_ENV: 'test',
      PORT: String(port),
      MAIL_DRYRUN: '1',
      MAIL_DRYRUN_DATEI: mailDatei,
      ALLOWED_ORIGIN: 'https://pixelkiez.de',
      SMTP_HOST: '',
      SMTP_USER: '',
      SMTP_PASS: '',
      RESEND_KEY: '',
      MAIL_TO: '',
      MAIL_FROM: '',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  child.stdout.on('data', (b) => { protokoll += b.toString(); });
  child.stderr.on('data', (b) => { protokoll += b.toString(); });
  await waitForHealth(baseUrl);
});

/* Wartet, bis der Mailtext in der Testdatei steht. */
async function warteAufAusgabe(muster, msMax = 3000) {
  const ende = Date.now() + msMax;
  while (Date.now() < ende) {
    if (muster.test(mailtext())) return true;
    await new Promise((r) => setTimeout(r, 50));
  }
  return false;
}

after(() => {
  if (child && !child.killed) child.kill('SIGTERM');
  if (tempVerzeichnis) rmSync(tempVerzeichnis, { recursive: true, force: true });
});

test('health is explicit about non-delivery mode and uses defensive headers', async () => {
  const r = await fetch(baseUrl + '/api/health');
  assert.equal(r.status, 200);
  assert.equal(r.headers.get('cache-control'), 'no-store');
  assert.equal(r.headers.get('x-content-type-options'), 'nosniff');
  const body = await r.json();
  assert.equal(body.ok, true);
  assert.equal(body.versandbereit, false);
});

test('CORS is allowlisted and not reflected for foreign origins', async () => {
  const allowed = await fetch(baseUrl + '/api/health', {
    headers: { Origin: 'https://pixelkiez.de' },
  });
  assert.equal(allowed.headers.get('access-control-allow-origin'), 'https://pixelkiez.de');

  const denied = await fetch(baseUrl + '/api/health', {
    headers: { Origin: 'https://attacker.example' },
  });
  assert.equal(denied.headers.get('access-control-allow-origin'), null);
});

test('unknown routes and wrong methods fail closed', async () => {
  const missing = await fetch(baseUrl + '/api/nope');
  assert.equal(missing.status, 404);

  const method = await fetch(baseUrl + '/api/kontakt');
  assert.equal(method.status, 405);
});

test('invalid JSON is rejected, a request without consent field is accepted', async () => {
  const broken = await fetch(baseUrl + '/api/kontakt', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Forwarded-For': '198.51.100.10' },
    body: '{broken',
  });
  assert.equal(broken.status, 400);

  // Das Formular hat keine Einwilligungs-Checkbox mehr; die Anfrage stuetzt
  // sich auf Art. 6 Abs. 1 Buchst. b/f DSGVO, nicht auf eine Einwilligung.
  const ohneConsent = await fetch(baseUrl + '/api/kontakt', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Forwarded-For': '198.51.100.11' },
    body: JSON.stringify({ name: 'Test', kontakt: 'test@example.com' }),
  });
  assert.equal(ohneConsent.status, 200);
});

test('honeypot returns generic success without processing', async () => {
  const r = await fetch(baseUrl + '/api/kontakt', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Forwarded-For': '198.51.100.12' },
    body: JSON.stringify({
      name: 'Bot',
      kontakt: 'bot@example.com',
      firma: 'spam',
      consent: true,
    }),
  });
  assert.equal(r.status, 200);
  assert.deepEqual(await r.json(), { ok: true });
});

test('oversized request body is rejected', async () => {
  const r = await fetch(baseUrl + '/api/kontakt', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Forwarded-For': '198.51.100.13' },
    body: JSON.stringify({ name: 'A', kontakt: 'a@example.com', consent: true, anliegen: 'x'.repeat(17000) }),
  });
  assert.equal(r.status, 413);
});

test('dry-run accepts a valid request but explicitly does not prove delivery', async () => {
  const r = await fetch(baseUrl + '/api/kontakt', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Forwarded-For': '198.51.100.14' },
    body: JSON.stringify({
      name: 'Max Mustermann',
      kontakt: 'max@example.com',
      ausgangspunkt: 'Website ist veraltet',
      anliegen: 'Bitte melden.',
      quelle: '/test',
      consent: true,
    }),
  });
  assert.equal(r.status, 200);
  const body = await r.json();
  assert.equal(body.ok, true);
  assert.match(body.hinweis, /nicht versendet/i);
});

test('the requested package and company reach the mail body', async () => {
  mailLeeren();
  const r = await fetch(baseUrl + '/api/kontakt', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Forwarded-For': '198.51.100.15' },
    body: JSON.stringify({
      name: 'Erika Beispiel',
      kontakt: 'erika@example.com',
      unternehmen: 'Beispiel GmbH',
      paket: 'Enterprise',
      consent: true,
    }),
  });
  assert.equal(r.status, 200);

  assert.ok(await warteAufAusgabe(/ANGEFRAGTES PAKET/), 'Mailtext erschien nicht im Trockenlauf');
  assert.match(mailtext(), /ANGEFRAGTES PAKET: Enterprise/);
  assert.match(mailtext(), /Unternehmen:\s+Beispiel GmbH/);
  // Das Paket steht vor dem Namen — wer die Mail oeffnet, sieht es zuerst.
  assert.ok(
    mailtext().indexOf('ANGEFRAGTES PAKET') < mailtext().indexOf('Name:'),
    'Paket steht nicht vor dem Namen',
  );
});

test('a company name is not the honeypot and must not drop the request', async () => {
  mailLeeren();
  const r = await fetch(baseUrl + '/api/kontakt', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Forwarded-For': '198.51.100.16' },
    body: JSON.stringify({
      name: 'Hans Firma',
      kontakt: 'hans@example.com',
      unternehmen: 'Echte Firma AG',
      consent: true,
    }),
  });
  assert.equal(r.status, 200);
  const body = await r.json();
  // Der Honigtopf antwortet mit blankem { ok: true } und verarbeitet nichts.
  // Eine echte Anfrage traegt den Trockenlauf-Hinweis und wird ausgegeben.
  assert.match(body.hinweis || '', /nicht versendet/i);
  assert.ok(await warteAufAusgabe(/Echte Firma AG/), 'Anfrage mit Unternehmen wurde verschluckt');
});

test('requests without a package keep the mail free of an empty package line', async () => {
  mailLeeren();
  const r = await fetch(baseUrl + '/api/kontakt', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Forwarded-For': '198.51.100.17' },
    body: JSON.stringify({ name: 'Ohne Paket', kontakt: 'ohne@example.com', consent: true }),
  });
  assert.equal(r.status, 200);
  assert.ok(await warteAufAusgabe(/Ohne Paket/), 'Mailtext erschien nicht im Trockenlauf');
  assert.doesNotMatch(mailtext(), /ANGEFRAGTES PAKET/);
  assert.doesNotMatch(mailtext(), /Unternehmen:/);
});

test('rate limit rejects the sixth request for one presented client IP', async () => {
  const ip = '198.51.100.20';
  for (let i = 0; i < 5; i++) {
    const r = await fetch(baseUrl + '/api/kontakt', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Forwarded-For': ip },
      body: JSON.stringify({ firma: 'honeypot', consent: true }),
    });
    assert.equal(r.status, 200);
  }
  const limited = await fetch(baseUrl + '/api/kontakt', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Forwarded-For': ip },
    body: JSON.stringify({ firma: 'honeypot', consent: true }),
  });
  assert.equal(limited.status, 429);
});

test('form contents never reach stdout or stderr', () => {
  // Alle bisherigen Anfragen stehen nur in der Testdatei, keine im Protokoll.
  for (const inhalt of ['Erika Beispiel', 'erika@example.com', 'Beispiel GmbH', 'Echte Firma AG', 'Ohne Paket', 'ohne@example.com']) {
    assert.ok(!protokoll.includes(inhalt), 'Formularinhalt im Protokoll: ' + inhalt);
  }
  assert.match(protokoll, /\[Trockenlauf\] Anfrage angenommen, nicht versendet/);
});

test('dry-run tools refuse to start in production', () => {
  const start = (extra) => spawnSync(process.execPath, ['server.mjs'], {
    cwd: new URL('..', import.meta.url),
    env: { ...testUmgebung(), PORT: '0', ...extra },
    encoding: 'utf8',
    timeout: 5000,
  });
  for (const extra of [
    { NODE_ENV: 'production', MAIL_DRYRUN: '1' },
    { RAILWAY_ENVIRONMENT_NAME: 'production', MAIL_DRYRUN_DATEI: join(tempVerzeichnis, 'darf-nicht.txt') },
  ]) {
    const r = start(extra);
    assert.equal(r.status, 1, 'Dienst startete trotz Sperre: ' + JSON.stringify(extra));
    assert.match(r.stderr, /Abbruch: MAIL_DRYRUN/);
  }
});
