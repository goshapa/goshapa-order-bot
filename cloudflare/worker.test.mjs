import {test} from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync} from 'node:fs';
import worker, {planUpdate} from './worker.mjs';

const user = {id: 123, first_name: '<Client>', username: 'test_client'};
const message = text => ({update_id: 1, message: {chat: {id: 123, type: 'private'}, from: user, text}});
const callback = data => ({update_id: 2, callback_query: {id: 'cb', from: user, data, message: {message_id: 100, chat: {id: 123, type: 'private'}}}});
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
test('navigation removes the card and photo; preview and admin notification are compact', () => {
  const p = planUpdate(callback('back:packages:bot'), {stage: 'view', service: 'bot', bundle: 'basic', ui_message_ids: [99, 100]}, environment);
  assert.deepEqual(p.effects.filter(e => e.method === 'deleteMessage').map(e => e.body.message_id), [99, 100]);
  assert.equal(p.effects[0].method, 'answerCallbackQuery');
  assert.equal(p.effects.at(-1).method, 'sendMessage');
  const preview = complete('bot');
  assert.equal(preview.effects.filter(e => e.method === 'sendMessage').length, 1);
  const confirmed = planUpdate(callback('preview:confirm'), preview.session, environment);
  assert.equal(confirmed.effects.filter(e => e.body.chat_id === environment.ADMIN_ID).length, 1);
  const longSession = {...preview.session, answers: Object.fromEntries(Object.keys(preview.session.answers).map(k => [k, '&'.repeat(500)]))};
  for (const update of [message('show preview'), callback('preview:confirm')]) {
    const plan = planUpdate(update, longSession, environment);
    for (const effect of plan.effects.filter(e => e.method === 'sendMessage')) {
      const parsed = effect.body.text.replace(/<[^>]*>/g, '').replace(/&amp;|&lt;|&gt;/g, '_');
      assert.ok(parsed.length <= 4096, `Message is too long: ${parsed.length}`);
    }
  }
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
test('D1 retains photo and message IDs; failed deletion does not block navigation', async () => {
  const DB = dbAdapter();
  const env = {...environment, DB, BOT_TOKEN: 'test', WEBHOOK_SECRET: 'test-secret'};
  const originalFetch = globalThis.fetch;
  let nextId = 200;
  let deleteCode = 400;
  const deleted = [];
  globalThis.fetch = async (url, options) => {
    if (url.endsWith('/deleteMessage')) {
      deleted.push(JSON.parse(options.body).message_id);
      return Response.json({ok: false, error_code: deleteCode, description: 'Test error'});
    }
    return Response.json({ok: true, result: {message_id: nextId++}});
  };
  const request = update => new Request('https://bot.example/telegram', {method:'POST', headers:{'X-Telegram-Bot-Api-Secret-Token':'test-secret'}, body:JSON.stringify(update)});
  try {
    assert.equal((await worker.fetch(request({...callback('package:bot:basic'), update_id: 30}), env)).status, 200);
    const state = JSON.parse(DB.sqlite.prepare('SELECT data FROM sessions WHERE chat_id=123').get().data);
    assert.equal(state.ui_message_ids.length, 2);
    const back = {...callback('back:packages:bot'), update_id:31};
    back.callback_query.message.message_id = state.ui_message_ids[1];
    deleted.length = 0;
    assert.equal((await worker.fetch(request(back), env)).status, 200);
    assert.deepEqual(deleted, state.ui_message_ids);
    assert.equal(JSON.parse(DB.sqlite.prepare('SELECT data FROM sessions WHERE chat_id=123').get().data).ui_message_ids.length, 1);
    deleteCode = 500;
    const retry = {...callback('back:main_menu'), update_id:32};
    assert.equal((await worker.fetch(request(retry), env)).status, 503);
    deleteCode = 400;
    assert.equal((await worker.fetch(request(retry), env)).status, 200);
  } finally {globalThis.fetch = originalFetch; DB.sqlite.close();}
});
