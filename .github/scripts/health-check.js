/* global process, require */
'use strict';

const checks = require('./health-check.config.js');

// ─── Утилиты ────────────────────────────────────────────────────────────────

function getByPath(obj, path) {
  return path.split(/[.[\]]+/).filter(Boolean).reduce((acc, key) => {
    if (acc === null || typeof acc === 'undefined') return void 0;
    return acc[key];
  }, obj);
}

function isEmpty(val) {
  return val === '' || val === null || (Array.isArray(val) && val.length === 0);
}

function checkRule(body, rule) {
  const { path, value, type, min, max, match, notEmpty } = rule;
  const val = getByPath(body, path);

  if (typeof val === 'undefined')
    return `поле «${path}» отсутствует в ответе`;

  if (typeof value !== 'undefined' && val !== value)
    return `«${path}»: ожидалось ${JSON.stringify(value)}, получено ${JSON.stringify(val)}`;

  if (typeof type !== 'undefined') {
    const actual = Array.isArray(val) ? 'array' : typeof val;
    if (actual !== type)
      return `«${path}»: ожидался тип «${type}», получен «${actual}»`;
  }

  if (typeof min !== 'undefined') {
    const num = Array.isArray(val) ? val.length : val;
    if (typeof num !== 'number' || num < min)
      return `«${path}»: ожидалось значение >= ${min}, получено ${num}`;
  }

  if (typeof max !== 'undefined') {
    const num = Array.isArray(val) ? val.length : val;
    if (typeof num !== 'number' || num > max)
      return `«${path}»: ожидалось значение <= ${max}, получено ${num}`;
  }

  if (typeof match !== 'undefined') {
    if (typeof val !== 'string' || !new RegExp(match).test(val))
      return `«${path}»: значение ${JSON.stringify(val)} не совпадает с паттерном /${match}/`;
  }

  if (notEmpty && isEmpty(val))
    return `«${path}»: значение пустое`;

  return null;
}

// ─── HTTP-запрос ────────────────────────────────────────────────────────────

async function runCheck(check) {
  const { id, url, method = 'GET', headers = {}, body, expectFields = [], expectContentType } = check;
  const errors = [];

  try {
    const init = {
      method,
      headers,
      signal: AbortSignal.timeout(15_000)
    };

    if (typeof body !== 'undefined') {
      init.body = JSON.stringify(body);
      if (!headers['Content-Type'])
        init.headers = { ...headers, 'Content-Type': 'application/json' };
    }

    const res = await fetch(url, init);
    const { status } = res;

    if (status !== 200) errors.push(`HTTP ${status} (ожидался 200)`);

    const contentType = res.headers.get('content-type') || '';

    if (typeof expectContentType !== 'undefined' && !contentType.startsWith(expectContentType))
      errors.push(`Content-Type: ожидался «${expectContentType}*», получен «${contentType}»`);

    const contentLength = Number(res.headers.get('content-length'));
    if (typeof expectContentType !== 'undefined' && contentLength === 0)
      errors.push('Content-Length равен 0 — тело ответа пустое');

    if (expectFields.length > 0) {
      if (contentType.includes('application/json')) {
        const responseBody = await res.json();
        for (const rule of expectFields) {
          const err = checkRule(responseBody, rule);
          if (err) errors.push(err);
        }
      } else
        errors.push(`ответ не JSON (Content-Type: ${contentType}), проверка полей невозможна`);
    }
  } catch (err) {
    errors.push(err.name === 'TimeoutError' ?
      'таймаут запроса (>15 сек)' :
      `сетевая ошибка: ${err.message}`);
  }

  return { id, url, errors };
}

// ─── Telegram ────────────────────────────────────────────────────────────────

async function sendTelegram(token, chatId, text) {
  const url = `https://api.telegram.org/bot${token}/sendMessage`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      'chat_id': chatId,
      text,
      'parse_mode': 'HTML',
      'disable_web_page_preview': true
    })
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Telegram API вернул ${res.status}: ${body}`);
  }
}

// ─── Точка входа ─────────────────────────────────────────────────────────────

async function main() {
  const tgBotToken = process.env.TG_BOT_TOKEN;
  const tgUserId = process.env.TG_USER_ID;

  if (!tgBotToken || !tgUserId) {
    console.error('Ошибка: TG_BOT_TOKEN и TG_USER_ID должны быть заданы в секретах репозитория.');
    process.exit(1);
  }

  console.log(`Запуск ${checks.length} проверок...\n`);

  const results = await Promise.all(checks.map(runCheck));
  const failed = results.filter((r) => r.errors.length > 0);
  const passed = results.filter((r) => r.errors.length === 0);

  for (const r of passed)
    console.log(`✅ [${r.id}] OK`);

  for (const r of failed) {
    console.log(`❌ [${r.id}] FAILED`);
    for (const e of r.errors)
      console.log(`   • ${e}`);
  }

  console.log(`\nИтог: ${passed.length} прошли, ${failed.length} упали.`);

  if (failed.length > 0) {
    const now = new Date().toISOString().replace('T', ' ').slice(0, 19);

    const lines = failed.map((r) => {
      const errList = r.errors.map((e) => `  • ${e}`).join('\n');
      return `🔴 <b>${r.id}</b>\n<code>${r.url}</code>\n${errList}`;
    });

    const message = `⚠️ <b>Health Check — ${failed.length} ошибк${failed.length === 1 ? 'а' : 'и'}</b>\n<i>${now} UTC</i>\n\n${lines.join('\n\n')}`;

    try {
      await sendTelegram(tgBotToken, tgUserId, message);
      console.log('Уведомление в Telegram отправлено.');
    } catch (err) {
      console.error(`Не удалось отправить Telegram-уведомление: ${err.message}`);
      process.exit(1);
    }

    process.exit(1);
  }
}

main().catch((err) => {
  console.error('Критическая ошибка:', err);
  process.exit(1);
});
