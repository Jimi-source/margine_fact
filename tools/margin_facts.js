// Фактическая юнит-экономика по SKU из базы marginefact.
// Запускается НА СЕРВЕРЕ (нужен node_modules из /var/www/marginefact-api).
// Локально вызывать через tools/margin.sh — он сам скопирует и запустит.
//
// Аргументы:
//   --weeks N     сколько полных недель взять (по умолчанию 8)
//   --format f    table | json | md   (по умолчанию table)
//   --user email  (по умолчанию prudnikovegor@mail.ru)
//   --tax N       ставка налога долей (по умолчанию 0.02)
//   --min-qty N   порог надёжности выборки (по умолчанию 40)

const { Pool } = require("pg");
const fs = require("fs");

const arg = (name, def) => {
  const i = process.argv.indexOf("--" + name);
  return i > -1 && process.argv[i + 1] ? process.argv[i + 1] : def;
};
const WEEKS = Number(arg("weeks", 8));
const FORMAT = arg("format", "table");
const U = arg("user", "prudnikovegor@mail.ru");
const TAX = Number(arg("tax", 0)); // по умолчанию налог не применяется — инструмент отдаёт факт
const MINQ = Number(arg("min-qty", 40));
// Какую долю начислений считать достаточной, чтобы объявить неделю закрытой.
// 99.5 — консервативно (обычно 4 недели хвоста), 98.5 — на неделю раньше.
const COVERAGE = Number(arg("coverage", 99.5));
// --by-week: строка на (неделя, SKU) вместо суммы за период — видно динамику
const BY_WEEK = process.argv.includes("--by-week");
// --include-open: включить и незакрытые недели. Каждая неделя помечена тем,
// сколько недель хвоста по ней наблюдалось и какая доля начислений обычно
// успевает прийти за этот срок — решение, что считать закрытым, за аналитиком.
const INCLUDE_OPEN = process.argv.includes("--include-open");

const env = {};
for (const l of fs.readFileSync("/var/www/marginefact-api/.env", "utf8").split("\n")) {
  const i = l.indexOf("=");
  if (i > 0) env[l.slice(0, i).trim()] = l.slice(i + 1).trim();
}
const pool = new Pool({
  host: env.DB_HOST, port: env.DB_PORT, database: env.DB_NAME,
  user: env.DB_USER, password: env.DB_PASS
});

const g = (r, k) => Number((r.accrualByGroup || {})[k] || 0);
const stencilOf = (v) => (typeof v === "object" && v !== null ? Number(v.stencil || 0) : Number(v) || 0);
const DAY = 86400000;

(async () => {
  // 1. Замер хвоста: за сколько недель доезжают заказы
  const { rows: regRows } = await pool.query(
    `SELECT date, period_end, SUM(total_count)::int cnt FROM stencil_order_registry
     WHERE user_id=$1 GROUP BY date, period_end`, [U]
  );
  const lag = new Map();
  let totalOrders = 0;
  let lastCalcEnd = null; // последний РАССЧИТАННЫЙ период — им и закрываются недели
  for (const r of regRows) {
    const w = Math.max(0, Math.ceil((new Date(r.period_end) - new Date(r.date)) / DAY / 7));
    lag.set(w, (lag.get(w) || 0) + r.cnt);
    totalOrders += r.cnt;
    const pe = new Date(r.period_end);
    if (!lastCalcEnd || pe > lastCalcEnd) lastCalcEnd = pe;
  }
  let cum = 0, closedLagWeeks = 4;
  const lagTable = [];
  for (const w of [...lag.keys()].sort((a, b) => a - b)) {
    cum += lag.get(w);
    const share = (cum / totalOrders) * 100;
    lagTable.push({ недель: w, накоплено: Number(share.toFixed(2)) });
    if (share < COVERAGE) closedLagWeeks = w + 1;
  }
  const покрытие_факт = (lagTable.find((x) => x.недель === closedLagWeeks) || lagTable[lagTable.length - 1] || {}).накоплено;

  // 2. Отбор полных недель
  const cf = await pool.query("SELECT entries FROM cashflow WHERE user_id=$1 AND year=$2", [U, new Date().getFullYear()]);
  if (!cf.rows.length) throw new Error("нет данных cashflow за текущий год");
  const all = Object.entries(cf.rows[0].entries)
    .filter(([k, e]) => k.startsWith("week|") && (e.rows || []).length > 0)
    .sort((a, b) => a[0].localeCompare(b[0]));
  // Неделя закрыта, если ПОСЛЕ неё рассчитано достаточно периодов, чтобы хвост успел
  // зарегистрироваться. Считать от сегодняшней даты неверно: пока расчёт в приложении
  // не сделан, доехавшие заказы в базу не попали, сколько бы времени ни прошло.
  const closed = all.filter(([k]) => {
    const end = new Date(k.split("|")[2]);
    return lastCalcEnd && (lastCalcEnd - end) / DAY / 7 >= closedLagWeeks;
  });
  // Сколько недель хвоста наблюдалось по неделе и какая доля начислений обычно
  // успевает прийти за этот срок. Факт, а не вердикт: порог выбирает аналитик.
  const хвостПо = (key) => {
    const end = new Date(key.split("|")[2]);
    const t = lastCalcEnd ? Math.floor((lastCalcEnd - end) / DAY / 7) : 0;
    const row = lagTable.filter((x) => x.недель <= t).pop();
    return { хвост_недель: t, "доля_доехавших_%": row ? row.накоплено : 0, закрыта: t >= closedLagWeeks };
  };

  const used = (INCLUDE_OPEN ? all : closed).slice(-WEEKS);
  if (!used.length) throw new Error("нет недель с разбивкой по SKU");

  // 3. Агрегация по SKU
  const acc = new Map();
  const perWeek = [];
  const byWeek = []; // те же поля, но без складывания: строка на (неделя, SKU)
  for (const [key, e] of used) {
    const st = e.stencilAdsByArticle || {}, pv = e.pvpAdsByArticle || {};
    const период = key.replace("week|", "").replace("|", "..");
    const хв = хвостПо(key);
    const w = { период, ...хв, шт: 0, продажи: 0, начисления: 0, реклама: 0, себес: 0, прочие: Number((e.summary || {}).otherServicesTotal || 0) };
    for (const r of e.rows || []) {
      if (!r.article) continue;
      {
        const ads = stencilOf(st[r.article]) + Number(pv[r.article] || 0);
        const rev = Number(r.accrual || 0) - ads + Number(r.otherPerArticle || 0);
        byWeek.push({
          период,
          ...хв,
          артикул: r.article,
          шт: Number(r.qty || 0),
          продажи: g(r, "Продажи"),
          возвраты: g(r, "Возвраты"),
          вознаграждение_ozon: g(r, "Вознаграждение Ozon"),
          услуги_доставки: g(r, "Услуги доставки"),
          услуги_партнёров: g(r, "Услуги партнёров"),
          реклама_из_начислений: g(r, "Продвижение и реклама"),
          другие_услуги_и_штрафы: g(r, "Другие услуги и штрафы") + g(r, "Без группы"),
          начисления_итого: Number(r.accrual || 0),
          реклама_трафарет: stencilOf(st[r.article]),
          реклама_пвп: Number(pv[r.article] || 0),
          прочие_услуги_разнесённые: Number(r.otherPerArticle || 0),
          себестоимость: Number(r.costSum || 0),
          сумма_отмен: Number(r.cancelSum || 0),
          выручка: rev,
          маржа_доля: rev > 0 ? (rev - Number(r.costSum || 0)) / rev : null
        });
      }
      const a = acc.get(r.article) || { article: r.article, qty: 0, sales: 0, returns: 0, comm: 0, deliv: 0, partner: 0, adsAccr: 0, fines: 0, stencil: 0, pvp: 0, otherPer: 0, accrual: 0, cost: 0, cancel: 0 };
      a.qty += Number(r.qty || 0);
      a.sales += g(r, "Продажи");
      a.returns += g(r, "Возвраты");
      a.comm += g(r, "Вознаграждение Ozon");
      a.deliv += g(r, "Услуги доставки");
      a.partner += g(r, "Услуги партнёров");
      a.adsAccr += g(r, "Продвижение и реклама");
      a.fines += g(r, "Другие услуги и штрафы") + g(r, "Без группы");
      a.cancel += Number(r.cancelSum || 0);
      a.stencil += stencilOf(st[r.article]);
      a.pvp += Number(pv[r.article] || 0);
      a.otherPer += Number(r.otherPerArticle || 0);
      a.accrual += Number(r.accrual || 0);
      a.cost += Number(r.costSum || 0);
      acc.set(r.article, a);
      w.шт += Number(r.qty || 0);
      w.продажи += g(r, "Продажи");
      w.начисления += Number(r.accrual || 0);
      w.реклама += Number(r.ads || 0);
      w.себес += Number(r.costSum || 0);
    }
    perWeek.push(w);
  }

  // Только факт из базы: суммы за выбранные недели. Ничего производного и оценочного.
  const items = [...acc.values()].map((a) => {
    const ads = a.stencil + a.pvp;
    const revenue = a.accrual - ads + a.otherPer;
    return {
      артикул: a.article,
      шт: a.qty,
      выборка_мала: a.qty < MINQ,
      продажи: a.sales,
      возвраты: a.returns,
      вознаграждение_ozon: a.comm,
      услуги_доставки: a.deliv,
      услуги_партнёров: a.partner,
      реклама_из_начислений: a.adsAccr,
      другие_услуги_и_штрафы: a.fines,
      начисления_итого: a.accrual,
      реклама_трафарет: a.stencil,
      реклама_пвп: a.pvp,
      прочие_услуги_разнесённые: a.otherPer,
      себестоимость: a.cost,
      сумма_отмен: a.cancel,
      выручка: revenue,
      маржа_доля: revenue > 0 ? (revenue - a.cost) / revenue : null
    };
  });
  items.sort((x, y) => y.продажи - x.продажи);

  const totals = (() => {
    const s = [...acc.values()].reduce((o, a) => {
      o.qty += a.qty; o.sales += a.sales; o.accrual += a.accrual;
      o.ads += a.stencil + a.pvp; o.other += a.otherPer; o.cost += a.cost; return o;
    }, { qty: 0, sales: 0, accrual: 0, ads: 0, other: 0, cost: 0 });
    const rev = s.accrual - s.ads + s.other;
    return {
      шт: s.qty, продажи: s.sales, выручка: rev, себестоимость: s.cost,
      "маржа_до_налога_%": (((rev - s.cost) / rev) * 100),
      "маржа_итог_%": (((rev - s.cost - s.sales * TAX) / rev) * 100)
    };
  })();

  const meta = {
    выгружено: new Date().toISOString().slice(0, 16).replace("T", " "),
    пользователь: U,
    недель_взято: used.length,
    период: `${used[0][0].split("|")[1]} .. ${used[used.length - 1][0].split("|")[2]}`,
    последняя_полная_неделя: closed.length ? closed[closed.length - 1][0].replace("week|", "").replace("|", "..") : null,
    незакрытых_недель_исключено: all.length - closed.length,
    последний_рассчитанный_период: lastCalcEnd ? lastCalcEnd.toISOString().slice(0, 10) : null,
    порог_закрытости_недель: closedLagWeeks,
    "покрытие_при_пороге_%": покрытие_факт,
    хвост_доставки: lagTable,
    ставка_налога: TAX,
    порог_надёжности_шт: MINQ
  };

  const ПОЛЯ = {
    шт: "количество единиц в статусе Доставлен",
    продажи: "выручка от продаж по цене покупателя, положительная",
    возвраты: "возвраты покупателей, отрицательные",
    вознаграждение_ozon: "комиссия маркетплейса за продажу, отрицательная. Ступень от цены: до 100 ₽ — 14%, до 300 ₽ — 20%, выше — 49%, с 28.08.2026 — 55%",
    услуги_доставки: "логистика до покупателя, отрицательная. Затраты на несостоявшиеся доставки уже здесь",
    услуги_партнёров: "услуги сторонних партнёров Ozon, отрицательные",
    реклама_из_начислений: "реклама, попавшая в отчёт начислений Ozon, отрицательная. Уже входит в начисления_итого",
    другие_услуги_и_штрафы: "штрафы, подписки Ozon, прочие списания, отрицательные",
    начисления_итого: "сумма всех предыдущих статей — то, что Ozon начислил по артикулу. Сверено: сходится с суммой групп до копейки",
    реклама_трафарет: "расход на CPM-рекламу из рекламного отчёта, положительный. В начисления НЕ входит. Распределён между периодами пропорционально доставленным заказам",
    реклама_пвп: "расход на рекламу с оплатой за заказ из рекламного отчёта, положительный. В начисления НЕ входит",
    прочие_услуги_разнесённые: "часть услуг Ozon без привязки к артикулу, разнесённая на SKU пропорционально",
    себестоимость: "закупочная цена × количество, на момент расчёта недели",
    сумма_отмен: "начисления по отменённым заказам, отрицательные. В выручку и маржу НЕ входят: расходы на них уже внутри услуг_доставки, вычитать отдельно — посчитать дважды",
    выручка: "начисления_итого − реклама_трафарет − реклама_пвп + прочие_услуги_разнесённые",
    маржа_доля: "(выручка − себестоимость) / выручка. Доля единицы: 0.4035 = 40,35%. До налога",
    выборка_мала: `меньше ${MINQ} штук за период — ставки логистики и рекламы на единицу неустойчивы`
  };

  if (FORMAT === "json") {
    const out = { _поля: ПОЛЯ, meta, totals, perWeek };
    if (BY_WEEK) out.byWeek = byWeek; else out.items = items;
    console.log(JSON.stringify(out, null, 1));
    return pool.end();
  }

  const DATA_COLS = ["продажи", "возвраты", "вознаграждение_ozon", "услуги_доставки",
    "услуги_партнёров", "реклама_из_начислений", "другие_услуги_и_штрафы", "начисления_итого",
    "реклама_трафарет", "реклама_пвп", "прочие_услуги_разнесённые", "себестоимость",
    "сумма_отмен", "выручка", "маржа_доля"];
  const малые = new Set(items.filter((x) => x.выборка_мала).map((x) => x.артикул));

  const f = (v, d = 0) => (v === null || v === undefined ? "-" : Number(v).toFixed(d));
  if (FORMAT === "md") {
    console.log(`# Фактические данные по SKU — Ozon\n`);
    console.log(`Выгружено ${meta.выгружено}. Период: **${meta.период}** (${meta.недель_взято} полных недель).`);
    console.log(`Последняя полная неделя: **${meta.последняя_полная_неделя}**. Исключено незакрытых недель: ${meta.незакрытых_недель_исключено}.`);
    console.log(`Полной считается неделя, закончившаяся ≥${meta.порог_закрытости_недель} нед назад (по факту доставки: ${lagTable.map(x => `${x.недель} нед — ${x.накоплено}%`).join(", ")}).\n`);
    console.log(`Итого: ${f(totals.шт)} шт, продажи ${f(totals.продажи)} ₽, выручка ${f(totals.выручка)} ₽, себестоимость ${f(totals.себестоимость)} ₽, маржа ${f(totals["маржа_до_налога_%"], 1)}% (до налога).\n`);
    console.log(`## Что означает каждое поле\n`);
    for (const [k, v] of Object.entries(ПОЛЯ)) console.log(`- **${k}** — ${v}`);
    console.log(`\nВсе суммы в рублях, за весь период целиком (не на единицу). Расходные статьи отрицательные, как их отдаёт Ozon. Налог не применён.\n`);
    const cols = (BY_WEEK ? ["период", "артикул", "шт"] : ["артикул", "шт"]).concat(DATA_COLS);
    const src = BY_WEEK ? byWeek : items;
    console.log(BY_WEEK
      ? `## Данные по SKU в разрезе недель\n\nСтрока на каждую пару «неделя + SKU», суммы не складывались.\n`
      : `## Данные по SKU\n`);
    console.log(`| ${cols.join(" | ")} |`);
    console.log(`|${cols.map(() => "---").join("|")}|`);
    for (const i of src) {
      const cells = cols.map((c) => {
        if (c === "период") return i.период;
        if (c === "артикул") return i.артикул + (малые.has(i.артикул) ? " ⚠" : "");
        if (c === "шт") return i.шт;
        if (c === "маржа_доля") return i.маржа_доля === null ? "-" : i.маржа_доля.toFixed(4);
        return f(i[c]);
      });
      console.log(`| ${cells.join(" | ")} |`);
    }
    console.log(`\n⚠ — ${ПОЛЯ.выборка_мала}.`);
    return pool.end();
  }

  // table
  console.log(`Выгружено ${meta.выгружено} | период ${meta.период} | недель ${meta.недель_взято} | последняя полная ${meta.последняя_полная_неделя} | исключено незакрытых ${meta.незакрытых_недель_исключено}`);
  console.log(`Хвост доставки: ${lagTable.map(x => `${x.недель}н=${x.накоплено}%`).join(" ")} → порог ${meta.порог_закрытости_недель} нед (покрытие ${покрытие_факт}%)`);
  console.log(`Закрытость считается от последнего рассчитанного периода: ${meta.последний_рассчитанный_период}`);
  console.log(`ИТОГО: ${f(totals.шт)} шт | продажи ${f(totals.продажи)} | выручка ${f(totals.выручка)} | себестоимость ${f(totals.себестоимость)} | маржа ${f(totals["маржа_до_налога_%"], 1)}%\n`);
  const pad = (s, n) => String(s).padEnd(n);
  const lpad = (s, n) => String(s).padStart(n);
  console.log("Суммы в рублях за весь период. Расходные статьи отрицательные. Расшифровка полей: --format md\n");
  const head = BY_WEEK ? pad("период", 24) + pad("SKU", 22) : pad("SKU", 22);
  console.log(head + lpad("шт", 5) + lpad("продажи", 9) + lpad("возвр", 8) + lpad("комис", 9) +
    lpad("логист", 8) + lpad("партнёр", 8) + lpad("рекл_нач", 9) + lpad("штрафы", 8) + lpad("начисл", 9) +
    lpad("трафарет", 9) + lpad("ПВП", 8) + lpad("прочие", 8) + lpad("себес", 8) + lpad("отмены", 8) +
    lpad("выручка", 9) + lpad("маржа", 8));
  for (const i of (BY_WEEK ? byWeek : items)) {
    console.log((BY_WEEK ? pad(i.период, 24) : "") +
      pad(i.артикул + (малые.has(i.артикул) ? " ⚠" : ""), 22) + lpad(i.шт, 5) + lpad(f(i.продажи), 9) +
      lpad(f(i.возвраты), 8) + lpad(f(i.вознаграждение_ozon), 9) + lpad(f(i.услуги_доставки), 8) +
      lpad(f(i.услуги_партнёров), 8) + lpad(f(i.реклама_из_начислений), 9) + lpad(f(i.другие_услуги_и_штрафы), 8) +
      lpad(f(i.начисления_итого), 9) + lpad(f(i.реклама_трафарет), 9) + lpad(f(i.реклама_пвп), 8) +
      lpad(f(i.прочие_услуги_разнесённые), 8) + lpad(f(i.себестоимость), 8) + lpad(f(i.сумма_отмен), 8) +
      lpad(f(i.выручка), 9) + lpad(i.маржа_доля === null ? "-" : i.маржа_доля.toFixed(3), 8));
  }
  console.log(`\n⚠ — меньше ${MINQ} шт за период, для ставок не использовать.`);
  await pool.end();
})().catch((e) => { console.error("ОШИБКА:", e.message); pool.end(); process.exitCode = 1; });
