import {test} from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync} from 'node:fs';
import worker, {planUpdate} from './worker.mjs';

const user = {id: 123, first_name: '<Client>', username: 'test_client'};
const message = text => ({update_id: 1, message: {chat: {id: 123, type: 'private'}, from: user, text}});
const callback = data => ({update_id: 2, callback_query: {id: 'cb', from: user, data, message: {chat: {id: 123, type: 'private'}}}});
const environment = {ADMIN_ID: '999'};
function complete(service) {
  let p = planUpdate(message('/start'), null, environment);
  p = planUpdate(callback(`service:${service}`), p.session, environment);
  p = planUpdate(callback(`package:${service}:basic`), p.session, environment);
  assert.equal(p.effects.some(e => e.method === 'sendPhoto'), true);
  p = planUpdate(callback(`order:start:${service}:basic`), p.session, environment);
  for (let i = 0; i < (service === 'website' ? 3 : 5); i++) p = planUpdate(message('<idea> & detail'), p.session, environment);
  assert.equal(p.session.stage, 'preview');
  assert.ok(p.effects.some(e => e.body.text?.includes('&lt;idea&gt; &amp; detail')));
  return p;
}
test('both order flows preserve package, answers and admin contact', () => {
  for (const service of ['website', 'bot']) {
    const p = planUpdate(callback('preview:confirm'), complete(service).session, environment);
    assert.equal(p.order.service, service);
    assert.equal(p.order.bundle, 'basic');
    assert.equal(p.session.stage, 'service');
    assert.ok(p.effects.some(e => e.body.reply_markup?.inline_keyboard[0][0].url === 'https://t.me/test_client'));
    assert.ok(p.effects.some(e => e.body.text?.includes('&lt;Client&gt;')));
    assert.equal(planUpdate(callback('preview:confirm'), p.session, environment).order, null);
  }
});
test('restart, cancel, invalid button and long/non-text input', () => {
  const preview = complete('website').session;
  const restarted = planUpdate(callback('preview:restart'), preview, environment);
  assert.equal(restarted.session.index, 0);
  assert.deepEqual(restarted.session.answers, {});
  assert.equal(planUpdate(message('x'.repeat(501)), restarted.session, environment).session.index, 0);
  assert.equal(planUpdate(message(undefined), restarted.session, environment).session.index, 0);
  assert.equal(planUpdate(callback('survey:cancel'), restarted.session, environment).session.stage, 'service');
  assert.equal(planUpdate(callback('package:__proto__:bad'), preview, environment).session.stage, 'service');
});
function dbAdapter() {
  const sqlite = new DatabaseSync(':memory:');
  sqlite.exec(readFileSync(new URL('./schema.sql', import.meta.url), 'utf8'));
  const prepare = sql => {
    const statement = sqlite.prepare(sql);
    let args = [];
    return {bind(...values) {args = values; return this;}, async first() {return statement.get(...args) || null;}, async run() {return statement.run(...args);}};
  };
  return {sqlite, prepare, async batch(statements) {
    sqlite.exec('BEGIN');
    try {const results = []; for (const s of statements) results.push(await s.run()); sqlite.exec('COMMIT'); return results;}
    catch (error) {sqlite.exec('ROLLBACK'); throw error;}
  }};
}
test('webhook auth, transaction, restart, duplicate delivery and retry', async () => {
  const DB = dbAdapter();
  const env = {...environment, DB, BOT_TOKEN: 'test', WEBHOOK_SECRET: 'test-secret'};
  const originalFetch = globalThis.fetch;
  let failures = 0;
  globalThis.fetch = async () => {
    if (failures > 0) {failures--; throw new Error('Network failure');}
    return Response.json({ok: true, result: {message_id: 1}});
  };
  const request = (update, secret = 'test-secret') => new Request('https://bot.example/telegram', {method: 'POST', headers: {'X-Telegram-Bot-Api-Secret-Token': secret}, body: JSON.stringify(update)});
  try {
    assert.equal((await worker.fetch(request(message('/start'), 'wrong'), env)).status, 403);
    assert.equal(DB.sqlite.prepare('SELECT count(*) n FROM sessions').get().n, 0);
    let id = 10;
    for (const update of [message('/start'), callback('service:website'), callback('package:website:basic'), callback('order:start:website:basic'), message('Name'), message('Topic'), message('Idea')]) {
      update.update_id = id++;
      assert.equal((await worker.fetch(request(update), env)).status, 200);
    }
    const confirm = {...callback('preview:confirm'), update_id: id++};
    failures = 1;
    assert.equal((await worker.fetch(request(confirm), env)).status, 503);
    assert.equal(DB.sqlite.prepare('SELECT count(*) n FROM orders').get().n, 1);
    assert.equal((await worker.fetch(request(confirm), env)).status, 200);
    assert.equal((await worker.fetch(request(confirm), env)).status, 200);
    assert.equal(DB.sqlite.prepare('SELECT count(*) n FROM orders').get().n, 1);
    assert.equal((await worker.fetch(new Request('https://bot.example/health'), env)).status, 200);
    assert.equal(DB.sqlite.prepare('SELECT count(*) n FROM locks').get().n, 0);
  } finally {globalThis.fetch = originalFetch; DB.sqlite.close();}
});
