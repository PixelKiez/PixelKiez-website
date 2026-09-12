import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { spawn } from 'node:child_process';
import net from 'node:net';

let child;
let baseUrl;
/* Im Trockenlauf schreibt der Dienst den fertigen Mailtext nach stdout. Der
   Puffer macht ihn pruefbar: nur so laesst sich zeigen, dass das angefragte
   Paket wirklich in der Mail landet und nicht bloss im Formular stand. */
let ausgabe = '';

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
  const port = await freePort();
  baseUrl = `http://127.0.0.1:${port}`;
  child = spawn(process.execPath, ['server.mjs'], {
    cwd: new URL('..', import.meta.url),
    env: {
      ...process.env,
      PORT: String(port),
      MAIL_DRYRUN: '1',
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
  child.stdout.on('data', (b) => { ausgabe += b.toString(); });
  await waitForHealth(baseUrl);
});

/* Wartet, bis die Trockenlauf-Ausgabe im Puffer steht: der Dienst antwortet
   auf die Anfrage, bevor er schreibt. */
async function warteAufAusgabe(muster, msMax = 3000) {
  const ende = Date.now() + msMax;
  while (Date.now() < ende) {
    if (muster.test(ausgabe)) return true;
    await new Promise((r) => setTimeout(r, 50));
  }
  return false;
}

after(() => {
  if (child && !child.killed) child.kill('SIGTERM');
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

test('invalid JSON and missing consent are rejected', async () => {
  const broken = await fetch(baseUrl + '/api/kontakt', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Forwarded-For': '198.51.100.10' },
    body: '{broken',
  });
  assert.equal(broken.status, 400);

  const noConsent = await fetch(baseUrl + '/api/kontakt', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Forwarded-For': '198.51.100.11' },
    body: JSON.stringify({ name: 'Test', kontakt: 'test@example.com', consent: false }),
  });
  assert.equal(noConsent.status, 400);
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
  ausgabe = '';
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
  assert.match(ausgabe, /ANGEFRAGTES PAKET: Enterprise/);
  assert.match(ausgabe, /Unternehmen:\s+Beispiel GmbH/);
  // Das Paket steht vor dem Namen — wer die Mail oeffnet, sieht es zuerst.
  assert.ok(
    ausgabe.indexOf('ANGEFRAGTES PAKET') < ausgabe.indexOf('Name:'),
    'Paket steht nicht vor dem Namen',
  );
});

test('a company name is not the honeypot and must not drop the request', async () => {
  ausgabe = '';
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
  ausgabe = '';
  const r = await fetch(baseUrl + '/api/kontakt', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Forwarded-For': '198.51.100.17' },
    body: JSON.stringify({ name: 'Ohne Paket', kontakt: 'ohne@example.com', consent: true }),
  });
  assert.equal(r.status, 200);
  assert.ok(await warteAufAusgabe(/Ohne Paket/), 'Mailtext erschien nicht im Trockenlauf');
  assert.doesNotMatch(ausgabe, /ANGEFRAGTES PAKET/);
  assert.doesNotMatch(ausgabe, /Unternehmen:/);
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
