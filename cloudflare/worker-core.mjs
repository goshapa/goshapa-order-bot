export const escapeHtml = value => String(value ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const button = (text, callback_data) => ({text, callback_data});
const kb = rows => ({inline_keyboard: rows});
const mainMenu = () => kb([[button('🌐 Заказать сайт', 'service:website')], [button('🤖 Заказать Telegram-бота', 'service:bot')]]);
const cancelMenu = () => kb([[button('❌ Отменить', 'survey:cancel')]]);
const previewMenu = () => kb([[button('✅ Готово', 'preview:confirm')], [button('✏️ Заполнить заново', 'preview:restart')], [button('❌ Отменить', 'preview:cancel')]]);
const welcome = '👋 Привет! Это бот <b>Goshapa</b> для приёма заказов на сайты и Telegram-ботов.\n\nЗдесь вы можете:\n• выбрать пакет разработки сайта или Telegram-бота;\n• посмотреть, что входит в каждый пакет;\n• оставить заявку в пару шагов.\n\nВыберите, что хотите заказать 👇';
const initial = () => ({stage: 'service'});
const question = (service, index) => {
  const q = SURVEY_QUESTIONS[service][index];
  return `<b>${q.question}</b>\n<i>${q.hint}</i>`;
};
function answerMessages(service, answers) {
  return SURVEY_QUESTIONS[service].map(q => `<b>${q.question}</b>\n${escapeHtml(answers[q.key] || '—')}`);
}
const validService = service => Object.hasOwn(PACKAGES, service || '');
const validBundle = (service, bundle) => validService(service) && Object.hasOwn(PACKAGES[service], bundle || '');

export function planUpdate(update, previous, env) {
  const callback = update.callback_query;
  const message = callback?.message || update.message;
  const user = callback?.from || message?.from;
  if (!message || !user || message.chat.type !== 'private') return null;
  const chatId = message.chat.id;
  let session = structuredClone(previous || initial());
  const effects = [];
  let order = null;
  const send = (text, reply_markup) => effects.push({method: 'sendMessage', body: {chat_id: chatId, text, parse_mode: 'HTML', ...(reply_markup ? {reply_markup} : {})}});
  const reset = (prefix = '') => { session = initial(); send(prefix + welcome, mainMenu()); };
  const showPreview = () => {
    send(`<b>Проверьте вашу заявку:</b>\nУслуга: ${SERVICE_LABELS[session.service]}\nПакет: ${BUNDLE_LABELS[session.bundle]}`);
    for (const text of answerMessages(session.service, session.answers)) send(text);
    send('Всё верно? Нажмите «Готово», чтобы отправить заявку.', previewMenu());
  };
  const packages = service => {
    session = {stage: 'package', service};
    const buttons = BUNDLE_ORDER.map(bundle => button(BUNDLE_LABELS[bundle], `package:${service}:${bundle}`));
    send(`${SERVICE_LABELS[service]}\n\nВыберите пакет:`, kb([buttons.slice(0, 2), buttons.slice(2), [button('⬅️ Назад', 'back:main_menu')]]));
  };
  if (callback) {
    effects.push({method: 'answerCallbackQuery', body: {callback_query_id: callback.id}});
    const data = callback.data || '';
    if (['back:main_menu', 'preview:cancel', 'survey:cancel'].includes(data)) reset(data.includes('cancel') ? '🗑 Черновик заявки удалён.\n\n' : '');
    else if (data.startsWith('service:') && validService(data.split(':')[1])) packages(data.split(':')[1]);
    else if (data.startsWith('back:packages:') && validService(data.split(':')[2])) packages(data.split(':')[2]);
    else if (data.startsWith('package:')) {
      const [, service, bundle] = data.split(':');
      if (!validBundle(service, bundle)) reset();
      else {
        session = {stage: 'view', service, bundle};
        const p = PACKAGES[service][bundle];
        effects.push({method: 'sendPhoto', body: {chat_id: chatId, photo: `https://raw.githubusercontent.com/goshapa/goshapa-order-bot/main/images/${bundle}.jpg`, caption: `<b>${p.title}</b>\n<i>${p.subtitle}</i>`, parse_mode: 'HTML'}});
        send(`<b>Что входит в пакет:</b>\n${p.features.map(f => '• ' + f).join('\n')}\n\n<b>Что получает клиент:</b> ${p.gets}`, kb([[button('✅ Заказать', `order:start:${service}:${bundle}`)], [button('⬅️ Назад', `back:packages:${service}`)]]));
      }
    } else if (data.startsWith('order:start:')) {
      const [, , service, bundle] = data.split(':');
      if (!validBundle(service, bundle)) reset();
      else { session = {stage: 'survey', service, bundle, answers: {}, index: 0}; send(question(service, 0), cancelMenu()); }
    } else if (data === 'preview:restart' && session.stage === 'preview') {
      session = {...session, stage: 'survey', answers: {}, index: 0}; send(question(session.service, 0), cancelMenu());
    } else if (data === 'preview:confirm' && session.stage === 'preview') {
      const number = `GS-C${update.update_id}`;
      const now = new Date().toISOString();
      order = {order_number: number, telegram_id: user.id, username: user.username || null, full_name: [user.first_name, user.last_name].filter(Boolean).join(' '), service: session.service, bundle: session.bundle, answers: JSON.stringify(session.answers), created_at: now, updated_at: now, source_update: update.update_id};
      const contact = kb([[{text: '💬 Написать клиенту', url: user.username ? `https://t.me/${user.username}` : `tg://user?id=${user.id}`}]]);
      const header = `🆕 <b>Новая заявка ${number}</b>\n\n👤 Клиент: ${escapeHtml(order.full_name)}\nUsername: ${user.username ? '@' + escapeHtml(user.username) : '—'}\nTelegram ID: <code>${user.id}</code>\nУслуга: ${SERVICE_LABELS[session.service]}\nПакет: ${BUNDLE_LABELS[session.bundle]}\nДата (UTC): ${now}\nСтатус: New`;
      effects.push({method: 'sendMessage', body: {chat_id: env.ADMIN_ID, text: header, parse_mode: 'HTML', reply_markup: contact}});
      for (const text of answerMessages(session.service, session.answers)) effects.push({method: 'sendMessage', body: {chat_id: env.ADMIN_ID, text: `<b>Заявка ${number}</b>\n${text}`, parse_mode: 'HTML'}});
      send(`✅ Заявка успешно отправлена! Программист Goshapa свяжется с вами в скором времени, чтобы обсудить дальнейшие детали проекта.\n\nНомер вашей заявки: <b>${number}</b>`, mainMenu());
      session = initial();
    } else send('Эта кнопка уже неактуальна. Начните с /start.', mainMenu());
  } else {
    const text = message.text?.trim();
    if (/^\/(start|cancel)(@\w+)?(?:\s|$)/.test(text || '')) reset(text.startsWith('/cancel') ? '❌ Текущее действие отменено.\n\n' : '');
    else if (session.stage === 'survey') {
      if (!text) send('Пожалуйста, ответьте текстовым сообщением.', cancelMenu());
      else if (text.length > 500) send('Пожалуйста, сократите ответ до 500 символов.', cancelMenu());
      else {
        session.answers[SURVEY_QUESTIONS[session.service][session.index].key] = text;
        session.index++;
        if (session.index < SURVEY_QUESTIONS[session.service].length) send(question(session.service, session.index), cancelMenu());
        else { session.stage = 'preview'; showPreview(); }
      }
    } else if (session.stage === 'preview') send('Подтвердите заявку или заполните её заново.', previewMenu());
    else reset();
  }
  return {chatId, session, effects, order};
}

async function deliver(row, env) {
  const effects = JSON.parse(row.effects);
  for (let i = row.cursor; i < effects.length; i++) {
    const effect = effects[i];
    const response = await fetch(`https://api.telegram.org/bot${env.BOT_TOKEN}/${effect.method}`, {method: 'POST', headers: {'content-type': 'application/json'}, body: JSON.stringify(effect.body), signal: AbortSignal.timeout(15000)});
    const result = await response.json();
    if (!result.ok && effect.method !== 'answerCallbackQuery') {
      // Never log Telegram request URLs (they contain the token) or client answers.
      console.error('Telegram delivery failed', effect.method, result.error_code);
      throw new Error('Telegram delivery failed');
    }
    await env.DB.prepare('UPDATE deliveries SET cursor = ? WHERE update_id = ?').bind(i + 1, row.update_id).run();
  }
}

export default {
  async fetch(request, env) {
    const path = new URL(request.url).pathname;
    if (request.method === 'GET' && path === '/') return new Response('Goshapa order bot');
    if (request.method === 'GET' && path === '/health') {
      if (!env.DB || !env.BOT_TOKEN || !env.WEBHOOK_SECRET || !env.ADMIN_ID) return new Response('Not configured', {status: 503});
      try { await env.DB.prepare('SELECT count(*) AS n FROM sessions').first(); return Response.json({ok: true}); }
      catch { return new Response('Database unavailable', {status: 503}); }
    }
    if (request.method !== 'POST' || path !== '/telegram') return new Response('Not found', {status: 404});
    if (!env.WEBHOOK_SECRET || request.headers.get('X-Telegram-Bot-Api-Secret-Token') !== env.WEBHOOK_SECRET) return new Response('Forbidden', {status: 403});
    if (Number(request.headers.get('content-length')) > 262144) return new Response('Too large', {status: 413});
    let update;
    try { const body = await request.text(); if (body.length > 262144) return new Response('Too large', {status: 413}); update = JSON.parse(body); }
    catch { return new Response('Invalid JSON', {status: 400}); }
    if (!Number.isSafeInteger(update?.update_id)) return new Response('Invalid update', {status: 400});
    const owner = crypto.randomUUID();
    const now = Date.now();
    try {
      const lock = await env.DB.prepare("INSERT INTO locks(name,owner,expires) VALUES('telegram',?,?) ON CONFLICT(name) DO UPDATE SET owner=excluded.owner,expires=excluded.expires WHERE locks.expires < ? RETURNING owner").bind(owner, now + 240000, now).first();
      if (!lock) return new Response('Busy', {status: 503});
      let row = await env.DB.prepare('SELECT * FROM deliveries WHERE update_id = ?').bind(update.update_id).first();
      if (!row) {
        const message = update.callback_query?.message || update.message;
        const stored = message ? await env.DB.prepare('SELECT data FROM sessions WHERE chat_id = ?').bind(message.chat.id).first() : null;
        const plan = planUpdate(update, stored ? JSON.parse(stored.data) : null, env);
        if (!plan) return new Response('OK');
        const timestamp = new Date().toISOString();
        const statements = [];
        if (plan.order) {
          const o = plan.order;
          statements.push(env.DB.prepare('INSERT INTO orders(order_number,telegram_id,username,full_name,service,bundle,answers,created_at,updated_at,source_update) VALUES(?,?,?,?,?,?,?,?,?,?)').bind(o.order_number,o.telegram_id,o.username,o.full_name,o.service,o.bundle,o.answers,o.created_at,o.updated_at,o.source_update));
        }
        statements.push(env.DB.prepare('INSERT INTO sessions(chat_id,data,updated_at) VALUES(?,?,?) ON CONFLICT(chat_id) DO UPDATE SET data=excluded.data,updated_at=excluded.updated_at').bind(plan.chatId, JSON.stringify(plan.session), timestamp));
        statements.push(env.DB.prepare('INSERT INTO deliveries(update_id,effects,created_at) VALUES(?,?,?)').bind(update.update_id, JSON.stringify(plan.effects), timestamp));
        await env.DB.batch(statements);
        row = {update_id: update.update_id, effects: JSON.stringify(plan.effects), cursor: 0};
      }
      await deliver(row, env);
      return new Response('OK');
    } catch {
      console.error('Webhook processing failed', update.update_id);
      return new Response('Retry later', {status: 503});
    } finally {
      if (env.DB) await env.DB.prepare("DELETE FROM locks WHERE name = 'telegram' AND owner = ?").bind(owner).run();
    }
  },
};
