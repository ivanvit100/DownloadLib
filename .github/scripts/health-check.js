'use strict';

const checks = require("./health-check.config.js");

// ─── Утилиты ────────────────────────────────────────────────────────────────

/**
 * Получает значение по dot-нотации: getByPath({ user: { id: 1 } }, "user.id") → 1
 */
function getByPath(obj, path) {
  return path.split(".").reduce((acc, key) => {
    if (acc === undefined || acc === null) return undefined;
    return acc[key];
  }, obj);
}

/**
 * Проверяет одно правило expectFields.
 * Возвращает null при успехе или строку с описанием ошибки.
 */
function checkRule(body, rule) {
  const { path, value, type, min, max, match, notEmpty } = rule;
  const val = getByPath(body, path);

  if (val === undefined) {
    return `поле «${path}» отсутствует в ответе`;
  }

  if (value !== undefined && val !== value) {
    return `«${path}»: ожидалось ${JSON.stringify(value)}, получено ${JSON.stringify(val)}`;
  }

  if (type !== undefined) {
    const actual = Array.isArray(val) ? "array" : typeof val;
    if (actual !== type) {
      return `«${path}»: ожидался тип «${type}», получен «${actual}»`;
    }
  }

  if (min !== undefined) {
    const num = Array.isArray(val) ? val.length : val;
    if (typeof num !== "number" || num < min) {
      return `«${path}»: ожидалось значение >= ${min}, получено ${num}`;
    }
  }

  if (max !== undefined) {
    const num = Array.isArray(val) ? val.length : val;
    if (typeof num !== "number" || num > max) {
      return `«${path}»: ожидалось значение <= ${max}, получено ${num}`;
    }
  }

  if (match !== undefined) {
    if (typeof val !== "string" || !new RegExp(match).test(val)) {
      return `«${path}»: значение ${JSON.stringify(val)} не совпадает с паттерном /${match}/`;
    }
  }

  if (notEmpty) {
    const empty =
      val === "" || val === null || (Array.isArray(val) && val.length === 0);
    if (empty) {
      return `«${path}»: значение пустое`;
    }
  }

  return null;
}

// ─── HTTP-запрос ────────────────────────────────────────────────────────────

async function runCheck(check) {
  const { id, url, method = "GET", headers = {}, body, expectFields = [] } = check;
  const errors = [];

  let status;
  let responseBody;

  try {
    const init = {
      method,
      headers,
      signal: AbortSignal.timeout(15_000), // 15 секунд таймаут
    };

    if (body !== undefined) {
      init.body = JSON.stringify(body);
      if (!headers["Content-Type"]) {
        init.headers = { ...headers, "Content-Type": "application/json" };
      }
    }

    const res = await fetch(url, init);
    status = res.status;

    if (status !== 200) {
      errors.push(`HTTP ${status} (ожидался 200)`);
    }

    const contentType = res.headers.get("content-type") || "";
    if (expectFields.length > 0) {
      if (contentType.includes("application/json")) {
        responseBody = await res.json();
        for (const rule of expectFields) {
          const err = checkRule(responseBody, rule);
          if (err) errors.push(err);
        }
      } else {
        errors.push(
          `ответ не JSON (Content-Type: ${contentType}), проверка полей невозможна`
        );
      }
    }
  } catch (err) {
    if (err.name === "TimeoutError") {
      errors.push("таймаут запроса (>15 сек)");
    } else {
      errors.push(`сетевая ошибка: ${err.message}`);
    }
  }

  return { id, url, errors };
}

// ─── Telegram ────────────────────────────────────────────────────────────────

async function sendTelegram(token, chatId, text) {
  const url = `https://api.telegram.org/bot${token}/sendMessage`;
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      chat_id: chatId,
      text,
      parse_mode: "HTML",
      disable_web_page_preview: true,
    }),
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Telegram API вернул ${res.status}: ${body}`);
  }
}

// ─── Точка входа ─────────────────────────────────────────────────────────────

async function main() {
  const TG_BOT_TOKEN = process.env.TG_BOT_TOKEN;
  const TG_USER_ID = process.env.TG_USER_ID;

  if (!TG_BOT_TOKEN || !TG_USER_ID) {
    console.error(
      "Ошибка: TG_BOT_TOKEN и TG_USER_ID должны быть заданы в секретах репозитория."
    );
    process.exit(1);
  }

  console.log(`Запуск ${checks.length} проверок...\n`);

  // Все запросы выполняются параллельно
  const results = await Promise.all(checks.map(runCheck));

  const failed = results.filter((r) => r.errors.length > 0);
  const passed = results.filter((r) => r.errors.length === 0);

  // Вывод в лог
  for (const r of passed) {
    console.log(`✅ [${r.id}] OK`);
  }
  for (const r of failed) {
    console.log(`❌ [${r.id}] FAILED`);
    for (const e of r.errors) {
      console.log(`   • ${e}`);
    }
  }

  console.log(`\nИтог: ${passed.length} прошли, ${failed.length} упали.`);

  // Отправка в Telegram при наличии ошибок
  if (failed.length > 0) {
    const now = new Date().toISOString().replace("T", " ").slice(0, 19);

    const lines = failed.map((r) => {
      const errList = r.errors.map((e) => `  • ${e}`).join("\n");
      return `🔴 <b>${r.id}</b>\n<code>${r.url}</code>\n${errList}`;
    });

    const message =
      `⚠️ <b>Health Check — ${failed.length} ошибк${failed.length === 1 ? "а" : "и"}</b>\n` +
      `<i>${now} UTC</i>\n\n` +
      lines.join("\n\n");

    try {
      await sendTelegram(TG_BOT_TOKEN, TG_USER_ID, message);
      console.log("Уведомление в Telegram отправлено.");
    } catch (err) {
      console.error(`Не удалось отправить Telegram-уведомление: ${err.message}`);
      process.exit(1);
    }

    process.exit(1); // Помечаем run как failed в GitHub Actions
  }
}

main().catch((err) => {
  console.error("Критическая ошибка:", err);
  process.exit(1);
});
