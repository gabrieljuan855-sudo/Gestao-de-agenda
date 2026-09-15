var __defProp = Object.defineProperty;
var __name = (target, value) => __defProp(target, "name", { value, configurable: true });

// worker/index.js
var TOKENINFO_URL = "https://www.googleapis.com/oauth2/v3/tokeninfo";
var DEFAULT_MODEL = "gemini-2.0-flash";
function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8" }
  });
}
__name(json, "json");
async function verifyCaller(request, env) {
  const header = request.headers.get("Authorization") || "";
  const token = header.startsWith("Bearer ") ? header.slice(7).trim() : "";
  if (!token) return null;
  const res = await fetch(`${TOKENINFO_URL}?access_token=${encodeURIComponent(token)}`);
  if (!res.ok) return null;
  const info = await res.json();
  if (!info.email) return null;
  if (env.ALLOWED_EMAIL && info.email.toLowerCase() !== env.ALLOWED_EMAIL.toLowerCase()) return null;
  return info;
}
__name(verifyCaller, "verifyCaller");
function buildPrompt({ text, today, weekday, calendars }) {
  const lista = (calendars || []).map((c) => `- ${c.name}${c.id ? ` (id: ${c.id})` : ""}`).join("\n");
  return `Voc\xEA interpreta anota\xE7\xF5es r\xE1pidas de agenda escritas em portugu\xEAs do Brasil e devolve dados estruturados.

Hoje \xE9 ${weekday}, ${today}. Fuso: America/Sao_Paulo.

Agendas dispon\xEDveis:
${lista || "- (nenhuma informada)"}

Texto do usu\xE1rio:
"""
${text}
"""

Responda SOMENTE com JSON, sem coment\xE1rios, neste formato:
{
  "type": "event" | "task",
  "title": "t\xEDtulo limpo, sem a data e sem a hora",
  "date": "AAAA-MM-DD ou null",
  "time": "HH:MM em 24h, ou null se n\xE3o houver hora",
  "durationMinutes": n\xFAmero de minutos ou null,
  "calendarId": "id da agenda mais prov\xE1vel, ou null",
  "priority": "urgente" | "importante" | "pode_esperar"
}

Regras:
- "event" quando houver hora marcada; "task" quando for algo a fazer sem hora.
- Mantenha o t\xEDtulo como a pessoa escreveu, inclusive nomes pr\xF3prios e preposi\xE7\xF5es ("Reuni\xE3o de equipe" continua "Reuni\xE3o de equipe").
- Nunca deixe a data ou a hora dentro do t\xEDtulo.
- Horas em portugu\xEAs como "13h15", "14h", "8h30" equivalem a 13:15, 14:00 e 08:30.
- Um dia da semana sem data significa a pr\xF3xima ocorr\xEAncia a partir de hoje.
- S\xF3 sugira calendarId se o texto indicar claramente a qual agenda pertence; na d\xFAvida, null.
- Se n\xE3o houver dura\xE7\xE3o expl\xEDcita, devolva null em durationMinutes.`;
}
__name(buildPrompt, "buildPrompt");
async function callGemini(env, prompt) {
  const model = env.GEMINI_MODEL || DEFAULT_MODEL;
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${encodeURIComponent(env.GEMINI_API_KEY)}`;
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      contents: [{ role: "user", parts: [{ text: prompt }] }],
      generationConfig: { temperature: 0, responseMimeType: "application/json" }
    })
  });
  if (!res.ok) {
    const detail = await res.text();
    throw new Error(`Gemini respondeu ${res.status}: ${detail.slice(0, 300)}`);
  }
  const data = await res.json();
  const raw = data?.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!raw) throw new Error("Gemini n\xE3o devolveu conte\xFAdo.");
  try {
    return JSON.parse(raw);
  } catch {
    const match = raw.match(/\{[\s\S]*\}/);
    if (!match) throw new Error("Gemini n\xE3o devolveu JSON v\xE1lido.");
    return JSON.parse(match[0]);
  }
}
__name(callGemini, "callGemini");
var PRIORITIES = /* @__PURE__ */ new Set(["urgente", "importante", "pode_esperar"]);
function normalize(parsed) {
  const type = parsed?.type === "event" ? "event" : "task";
  const title = typeof parsed?.title === "string" ? parsed.title.trim().slice(0, 300) : "";
  const date = /^\d{4}-\d{2}-\d{2}$/.test(parsed?.date || "") ? parsed.date : null;
  const time = /^([01]\d|2[0-3]):[0-5]\d$/.test(parsed?.time || "") ? parsed.time : null;
  const minutes = Number(parsed?.durationMinutes);
  const durationMinutes = Number.isFinite(minutes) && minutes > 0 && minutes <= 12 * 60 ? Math.round(minutes) : null;
  return {
    type: time ? "event" : type,
    title,
    date,
    time,
    durationMinutes,
    calendarId: typeof parsed?.calendarId === "string" ? parsed.calendarId : null,
    priority: PRIORITIES.has(parsed?.priority) ? parsed.priority : "pode_esperar"
  };
}
__name(normalize, "normalize");
async function handleParse(request, env) {
  if (!env.GEMINI_API_KEY) {
    return json({ error: "GEMINI_API_KEY n\xE3o est\xE1 configurada neste Worker." }, 503);
  }
  const caller = await verifyCaller(request, env);
  if (!caller) return json({ error: "N\xE3o autorizado." }, 401);
  let body;
  try {
    body = await request.json();
  } catch {
    return json({ error: "Corpo inv\xE1lido." }, 400);
  }
  const text = typeof body?.text === "string" ? body.text.trim() : "";
  if (!text) return json({ error: "Envie o texto a interpretar." }, 400);
  if (text.length > 500) return json({ error: "Texto longo demais." }, 400);
  try {
    const parsed = await callGemini(
      env,
      buildPrompt({
        text,
        today: body.today,
        weekday: body.weekday,
        calendars: Array.isArray(body.calendars) ? body.calendars.slice(0, 20) : []
      })
    );
    return json(normalize(parsed));
  } catch (err) {
    return json({ error: err.message }, 502);
  }
}
__name(handleParse, "handleParse");
var worker_default = {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname === "/api/parse") {
      if (request.method !== "POST") return json({ error: "Use POST." }, 405);
      return handleParse(request, env);
    }
    return env.ASSETS.fetch(request);
  }
};

// ../../../root/.npm/_npx/32026684e21afda6/node_modules/wrangler/templates/middleware/middleware-ensure-req-body-drained.ts
var drainBody = /* @__PURE__ */ __name(async (request, env, _ctx, middlewareCtx) => {
  try {
    return await middlewareCtx.next(request, env);
  } finally {
    try {
      if (request.body !== null && !request.bodyUsed) {
        const reader = request.body.getReader();
        while (!(await reader.read()).done) {
        }
      }
    } catch (e) {
      console.error("Failed to drain the unused request body.", e);
    }
  }
}, "drainBody");
var middleware_ensure_req_body_drained_default = drainBody;

// ../../../root/.npm/_npx/32026684e21afda6/node_modules/wrangler/templates/middleware/middleware-miniflare3-json-error.ts
function reduceError(e) {
  return {
    name: e?.name,
    message: e?.message ?? String(e),
    stack: e?.stack,
    cause: e?.cause === void 0 ? void 0 : reduceError(e.cause)
  };
}
__name(reduceError, "reduceError");
var jsonError = /* @__PURE__ */ __name(async (request, env, _ctx, middlewareCtx) => {
  try {
    return await middlewareCtx.next(request, env);
  } catch (e) {
    const error = reduceError(e);
    const body = JSON.stringify(error);
    const headers = {
      "Content-Type": "application/json",
      "MF-Experimental-Error-Stack": "true"
    };
    const encoded = encodeURIComponent(body);
    if (encoded.length <= 8192) {
      headers["MF-Experimental-Error-Stack-Payload"] = encoded;
    }
    return new Response(body, { status: 500, headers });
  }
}, "jsonError");
var middleware_miniflare3_json_error_default = jsonError;

// .wrangler/tmp/bundle-LKecIJ/middleware-insertion-facade.js
var __INTERNAL_WRANGLER_MIDDLEWARE__ = [
  middleware_ensure_req_body_drained_default,
  middleware_miniflare3_json_error_default
];
var middleware_insertion_facade_default = worker_default;

// ../../../root/.npm/_npx/32026684e21afda6/node_modules/wrangler/templates/middleware/common.ts
var __facade_middleware__ = [];
function __facade_register__(...args) {
  __facade_middleware__.push(...args.flat());
}
__name(__facade_register__, "__facade_register__");
function __facade_invokeChain__(request, env, ctx, dispatch, middlewareChain) {
  const [head, ...tail] = middlewareChain;
  const middlewareCtx = {
    dispatch,
    next(newRequest, newEnv) {
      return __facade_invokeChain__(newRequest, newEnv, ctx, dispatch, tail);
    }
  };
  return head(request, env, ctx, middlewareCtx);
}
__name(__facade_invokeChain__, "__facade_invokeChain__");
function __facade_invoke__(request, env, ctx, dispatch, finalMiddleware) {
  return __facade_invokeChain__(request, env, ctx, dispatch, [
    ...__facade_middleware__,
    finalMiddleware
  ]);
}
__name(__facade_invoke__, "__facade_invoke__");

// .wrangler/tmp/bundle-LKecIJ/middleware-loader.entry.ts
var __Facade_ScheduledController__ = class ___Facade_ScheduledController__ {
  constructor(scheduledTime, cron, noRetry) {
    this.scheduledTime = scheduledTime;
    this.cron = cron;
    this.#noRetry = noRetry;
  }
  scheduledTime;
  cron;
  static {
    __name(this, "__Facade_ScheduledController__");
  }
  #noRetry;
  noRetry() {
    if (!(this instanceof ___Facade_ScheduledController__)) {
      throw new TypeError("Illegal invocation");
    }
    this.#noRetry();
  }
};
function wrapExportedHandler(worker) {
  if (__INTERNAL_WRANGLER_MIDDLEWARE__ === void 0 || __INTERNAL_WRANGLER_MIDDLEWARE__.length === 0) {
    return worker;
  }
  for (const middleware of __INTERNAL_WRANGLER_MIDDLEWARE__) {
    __facade_register__(middleware);
  }
  const fetchDispatcher = /* @__PURE__ */ __name(function(request, env, ctx) {
    if (worker.fetch === void 0) {
      throw new Error("Handler does not export a fetch() function.");
    }
    return worker.fetch(request, env, ctx);
  }, "fetchDispatcher");
  return {
    ...worker,
    fetch(request, env, ctx) {
      const dispatcher = /* @__PURE__ */ __name(function(type, init) {
        if (type === "scheduled" && worker.scheduled !== void 0) {
          const controller = new __Facade_ScheduledController__(
            Date.now(),
            init.cron ?? "",
            () => {
            }
          );
          return worker.scheduled(controller, env, ctx);
        }
      }, "dispatcher");
      return __facade_invoke__(request, env, ctx, dispatcher, fetchDispatcher);
    }
  };
}
__name(wrapExportedHandler, "wrapExportedHandler");
function wrapWorkerEntrypoint(klass) {
  if (__INTERNAL_WRANGLER_MIDDLEWARE__ === void 0 || __INTERNAL_WRANGLER_MIDDLEWARE__.length === 0) {
    return klass;
  }
  for (const middleware of __INTERNAL_WRANGLER_MIDDLEWARE__) {
    __facade_register__(middleware);
  }
  return class extends klass {
    #fetchDispatcher = /* @__PURE__ */ __name((request, env, ctx) => {
      this.env = env;
      this.ctx = ctx;
      if (super.fetch === void 0) {
        throw new Error("Entrypoint class does not define a fetch() function.");
      }
      return super.fetch(request);
    }, "#fetchDispatcher");
    #dispatcher = /* @__PURE__ */ __name((type, init) => {
      if (type === "scheduled" && super.scheduled !== void 0) {
        const controller = new __Facade_ScheduledController__(
          Date.now(),
          init.cron ?? "",
          () => {
          }
        );
        return super.scheduled(controller);
      }
    }, "#dispatcher");
    fetch(request) {
      return __facade_invoke__(
        request,
        this.env,
        this.ctx,
        this.#dispatcher,
        this.#fetchDispatcher
      );
    }
  };
}
__name(wrapWorkerEntrypoint, "wrapWorkerEntrypoint");
var WRAPPED_ENTRY;
if (typeof middleware_insertion_facade_default === "object") {
  WRAPPED_ENTRY = wrapExportedHandler(middleware_insertion_facade_default);
} else if (typeof middleware_insertion_facade_default === "function") {
  WRAPPED_ENTRY = wrapWorkerEntrypoint(middleware_insertion_facade_default);
}
var middleware_loader_entry_default = WRAPPED_ENTRY;
export {
  __INTERNAL_WRANGLER_MIDDLEWARE__,
  middleware_loader_entry_default as default
};
//# sourceMappingURL=index.js.map
