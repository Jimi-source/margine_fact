require("dotenv").config();

const express = require("express");
const cors = require("cors");
const jwt = require("jsonwebtoken");
const bcrypt = require("bcryptjs");
const { Resend } = require("resend");
const { Pool } = require("pg");
const { randomUUID, createHash } = require("crypto");

const JWT_SECRET = process.env.JWT_SECRET;
if (!JWT_SECRET) {
  console.error("JWT_SECRET is missing in .env");
  process.exit(1);
}

const resend = new Resend(process.env.RESEND_API_KEY);
const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN || "";

const app = express();

app.use(
  cors({
    origin: "https://margine-fact.vercel.app",
    methods: ["GET", "POST", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization"]
  })
);

app.use(express.json({ limit: "200mb" }));

const pool = new Pool({
  host: process.env.DB_HOST,
  port: Number(process.env.DB_PORT || 5432),
  database: process.env.DB_NAME,
  user: process.env.DB_USER,
  password: process.env.DB_PASS
});

const CREDIT_PACKS = {
  1: { credits: 1, amount: 150 },
  3: { credits: 3, amount: 400 },
  5: { credits: 5, amount: 650 },
  10: { credits: 10, amount: 1250 }
};

const REALIZ_TYPES = new Set([
  "Баллы за скидки",
  "Возврат вознаграждения",
  "Вознаграждение за продажу",
  "Выручка",
  "Потеря по вине Ozon в логистике",
  "Потеря по вине Ozon на складе",
  "Программы партнёров"
]);

function normalizeEmail(value) {
  return String(value || "").trim().toLowerCase();
}

function getToken(req) {
  const header = req.headers.authorization || "";
  if (!header.startsWith("Bearer ")) return "";
  return header.slice("Bearer ".length).trim();
}

function requireUser(req) {
  const token = getToken(req);
  if (!token) throw new Error("Missing token");
  return jwt.verify(token, JWT_SECRET);
}

function getUserId(user) {
  return normalizeEmail(user.id || user.email);
}

function formatAmount(value) {
  return Number(value || 0).toFixed(2);
}

function getYooConfig() {
  const shopId = String(process.env.YK_SHOP_ID || "");
  const secretKey = String(process.env.YK_SECRET_KEY || "");
  const returnUrl = String(process.env.YK_RETURN_URL || "");
  const taxSystemCode = Number(process.env.YK_TAX_SYSTEM_CODE || 0);
  const vatCode = Number(process.env.YK_VAT_CODE || 0);
  if (!shopId || !secretKey || !returnUrl || !taxSystemCode || !vatCode) {
    throw new Error("YooKassa config is missing.");
  }
  return { shopId, secretKey, returnUrl, taxSystemCode, vatCode };
}

async function yooRequest(method, path, body) {
  const cfg = getYooConfig();
  const auth = Buffer.from(`${cfg.shopId}:${cfg.secretKey}`).toString("base64");
  const response = await fetch(`https://api.yookassa.ru/v3${path}`, {
    method,
    headers: {
      "Content-Type": "application/json",
      Authorization: `Basic ${auth}`,
      "Idempotence-Key": randomUUID()
    },
    body: body ? JSON.stringify(body) : undefined
  });
  const data = await response.json();
  if (!response.ok) {
    const details = data && data.description ? data.description : "YooKassa error.";
    const code = data && (data.type || data.code) ? data.type || data.code : response.status;
    throw new Error(`[${code}] ${details}`);
  }
  return data;
}

async function sendResetEmail(to, code) {
  const from = process.env.FROM_EMAIL || "onboarding@resend.dev";
  await resend.emails.send({
    from,
    to: [to],
    subject: "Код восстановления пароля",
    html: `<p>Ваш код: <strong>${code}</strong>. Он действует 15 минут.</p>`
  });
}

function checkTelegramAuth(data) {
  if (!TELEGRAM_BOT_TOKEN) {
    throw new Error("TELEGRAM_BOT_TOKEN is missing.");
  }
  const { hash, ...rest } = data;
  if (!hash) return false;

  const authData = Object.keys(rest)
    .sort()
    .map((key) => `${key}=${rest[key]}`)
    .join("\n");

  const secret = createHash("sha256").update(TELEGRAM_BOT_TOKEN).digest();
  const checkHash = createHash("sha256").update(authData).digest("hex");

  return checkHash === hash;
}

function parseNumber(value) {
  if (typeof value === "number") return value;
  if (value === null || value === undefined) return 0;
  const cleaned = String(value).replace(/\s/g, "").replace(",", ".");
  const parsed = Number(cleaned);
  return Number.isFinite(parsed) ? parsed : 0;
}

function parseDateValue(value) {
  if (!value) return null;
  if (value instanceof Date && !Number.isNaN(value.valueOf())) {
    return new Date(value.getFullYear(), value.getMonth(), value.getDate());
  }
  if (typeof value === "number") {
    const date = new Date((value - 25569) * 86400 * 1000);
    return new Date(date.getFullYear(), date.getMonth(), date.getDate());
  }
  if (typeof value === "string") {
    const trimmed = value.trim();
    const ruMatch = /^(\d{1,2})[./](\d{1,2})[./](\d{4})$/.exec(trimmed);
    if (ruMatch) {
      return new Date(Number(ruMatch[3]), Number(ruMatch[2]) - 1, Number(ruMatch[1]));
    }
    const isoMatch = /^(\d{4})-(\d{2})-(\d{2})$/.exec(trimmed);
    if (isoMatch) {
      return new Date(Number(isoMatch[1]), Number(isoMatch[2]) - 1, Number(isoMatch[3]));
    }
    const parsed = new Date(trimmed);
    return Number.isNaN(parsed.valueOf()) ? null : parsed;
  }
  return null;
}

function dateKey(date) {
  if (!date) return "";
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function inRange(date, start, end) {
  if (!date) return false;
  const time = new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
  const startTime = new Date(start.getFullYear(), start.getMonth(), start.getDate()).getTime();
  const endTime = new Date(end.getFullYear(), end.getMonth(), end.getDate()).getTime();
  return time >= startTime && time <= endTime;
}

function buildPvpSumByOrderArticle(rows) {
  const sumByKey = new Map();
  for (const row of rows || []) {
    const order = row["Номер заказа"];
    const article = row["Артикул"];
    if (!order || !article) continue;
    const key = `${order}__${article}`;
    const amount = parseNumber(row["Расход"]);
    sumByKey.set(key, (sumByKey.get(key) || 0) + amount);
  }
  return sumByKey;
}

function buildStencilSumByDateName(rows) {
  const sumByKey = new Map();
  for (const row of rows || []) {
    const rawDate = row["Дата"];
    const dateValue = parseDateValue(rawDate);
    const name = row["Название товара"];
    if (!dateValue || !name) continue;
    const key = `${dateKey(dateValue)}__${String(name).trim()}`;
    const amount = parseNumber(row["Расход"]);
    sumByKey.set(key, (sumByKey.get(key) || 0) + amount);
  }
  return sumByKey;
}

function calculateReport(payload) {
  const startDate = parseDateValue(payload.startDate);
  const endDate = parseDateValue(payload.endDate);
  if (!startDate || !endDate) {
    throw new Error("Некорректный период.");
  }

  const sebesMap = new Map((payload.sebes || []).map((item) => [item.article, item.cost]));
  const missingCosts = new Set();
  const accrualsByArticle = new Map();
  const accrualsByArticleGroup = new Map();
  const accrualGroupsSet = new Set();
  const adsByArticle = new Map();
  const cancelSumByArticle = new Map();
  const otherServicesTypeSet = new Set(payload.otherServicesTypesSelected || []);
  let otherServicesTotal = 0;
  let realizTotal = 0;

  const pvpSumByOrderArticle = buildPvpSumByOrderArticle(payload.pvp || []);
  const stencilSumByKey = buildStencilSumByDateName(payload.stencils || []);

  // Для реестра трафаретов
  const stencilAdsByArticle = new Map();
  const pvpAdsByArticle = new Map();
  // article__date → { count, skuName } — только для строк где есть трафарет
  const stencilOrderCountsInPeriod = new Map();

  const orderStatusByOrder = new Map();
  const orderStatusByShipment = new Map();
  const orderCountByOrderArticle = new Map();
  const orderPromotionByShipmentArticle = new Map();
  const orderPromotionByOrderArticle = new Map();
  const ordersByArticle = new Map();

  for (const row of payload.orders || []) {
    const orderNumber = row["Номер заказа"];
    const shipmentNumber = row["Номер отправления"];
    const article = row["Артикул"];
    const status = row["Статус"];
    const deliveryDateValue = row["Delivery date"] ?? row["Дата доставки"];
    const deliveryDate = parseDateValue(deliveryDateValue);
    const qty = parseNumber(row["Количество"]);

    if (orderNumber && !orderStatusByOrder.has(orderNumber)) {
      orderStatusByOrder.set(orderNumber, String(status || ""));
    }
    if (shipmentNumber && !orderStatusByShipment.has(shipmentNumber)) {
      orderStatusByShipment.set(shipmentNumber, String(status || ""));
    }
    if (orderNumber && article) {
      const key = `${orderNumber}__${article}`;
      orderCountByOrderArticle.set(key, (orderCountByOrderArticle.get(key) || 0) + 1);
    }
    if (String(status || "").toLowerCase() === "доставлен") {
      if (inRange(deliveryDate, startDate, endDate) && article) {
        ordersByArticle.set(article, (ordersByArticle.get(article) || 0) + qty);
      }
    }
  }

  for (const row of payload.orders || []) {
    const orderNumber = row["Номер заказа"];
    const shipmentNumber = row["Номер отправления"];
    const article = row["Артикул"];
    if (!orderNumber || !article) continue;
    const key = `${orderNumber}__${article}`;
    const totalPromotion = pvpSumByOrderArticle.get(key) || 0;
    const count = orderCountByOrderArticle.get(key) || 0;
    const promotionPerRow = count > 0 ? totalPromotion / count : 0;
    if (shipmentNumber) {
      const shipKey = `${shipmentNumber}__${article}`;
      orderPromotionByShipmentArticle.set(
        shipKey,
        (orderPromotionByShipmentArticle.get(shipKey) || 0) + promotionPerRow
      );
    }
    const orderKey = `${orderNumber}__${article}`;
    orderPromotionByOrderArticle.set(
      orderKey,
      (orderPromotionByOrderArticle.get(orderKey) || 0) + promotionPerRow
    );
  }

  const accrualCountByArticleDate = new Map();
  for (const row of payload.accruals || []) {
    const article = row["Артикул"];
    if (!article) continue;
    const dateValue = parseDateValue(row["Дата принятия заказа в обработку или оказания услуги"]);
    const key = `${article}__${dateKey(dateValue)}`;
    accrualCountByArticleDate.set(key, (accrualCountByArticleDate.get(key) || 0) + 1);
  }

  for (const row of payload.accruals || []) {
    const orderOrShipmentId = row["ID начисления"];
    const articleRaw = row["Артикул"];
    const article =
      articleRaw === "" || articleRaw === null || articleRaw === undefined
        ? ""
        : String(articleRaw).trim();
    const type = row["Тип начисления"];
    const amount = parseNumber(row["Сумма итого, руб."]);
    const statusByOrder = String(orderStatusByOrder.get(orderOrShipmentId) || "");
    const statusByShipment = String(orderStatusByShipment.get(orderOrShipmentId) || "");
    const statusScore =
      (statusByOrder === "Доставлен" ? 1 : 0) +
      (statusByShipment === "Доставлен" ? 1 : 0) +
      (statusByOrder === "Отменён" ? 1 : 0) +
      (statusByShipment === "Отменён" ? 1 : 0);

    let promotionByShipment = 0;
    let promotionByOrder = 0;
    if (statusScore === 1 && type === "Выручка" && article) {
      const shipKey = `${orderOrShipmentId}__${article}`;
      const orderKey = `${orderOrShipmentId}__${article}`;
      promotionByShipment = orderPromotionByShipmentArticle.get(shipKey) || 0;
      promotionByOrder = orderPromotionByOrderArticle.get(orderKey) || 0;
    }

    const pvpValue = promotionByShipment + promotionByOrder;
    const accrualDateValue = parseDateValue(row["Дата принятия заказа в обработку или оказания услуги"]);
    const name = row["Название товара"];
    const stencilKey = `${dateKey(accrualDateValue)}__${String(name || "").trim()}`;
    const stencilSum = stencilSumByKey.get(stencilKey) || 0;
    const countKey = `${article}__${dateKey(accrualDateValue)}`;
    const count = accrualCountByArticleDate.get(countKey) || 0;
    const stencilValue = count > 0 ? stencilSum / count : 0;
    const adsValue = pvpValue + stencilValue;

    if (statusScore === 1 && article) {
      accrualsByArticle.set(article, (accrualsByArticle.get(article) || 0) + amount);
      const groupRaw = row["Группа услуг"];
      const groupName = String(groupRaw || "").trim() || "Без группы";
      accrualGroupsSet.add(groupName);
      const byGroup = accrualsByArticleGroup.get(article) || new Map();
      byGroup.set(groupName, (byGroup.get(groupName) || 0) + amount);
      accrualsByArticleGroup.set(article, byGroup);
    }

    if (statusScore === 1 && article) {
      adsByArticle.set(article, (adsByArticle.get(article) || 0) + adsValue);
      stencilAdsByArticle.set(article, (stencilAdsByArticle.get(article) || 0) + stencilValue);
      pvpAdsByArticle.set(article, (pvpAdsByArticle.get(article) || 0) + pvpValue);
    }

    // DEBUG: log rows with stencil match
    if (stencilSum > 0 && article) {
      console.log(`[STENCIL_DEBUG] article=${article} statusScore=${statusScore} stencilSum=${stencilSum.toFixed(2)} count=${count} stencilValue=${stencilValue.toFixed(2)} date=${dateKey(accrualDateValue)} orderId=${orderOrShipmentId}`);
    }

    // Накапливаем кол-во строк начислений по (article, date) для строк с трафаретом
    if (article && stencilSum > 0) {
      const skuName = String(name || "").trim();
      const periodKey = `${article}__${dateKey(accrualDateValue)}`;
      const existing = stencilOrderCountsInPeriod.get(periodKey) || { count: 0, skuName };
      stencilOrderCountsInPeriod.set(periodKey, { count: existing.count + 1, skuName });
    }

    const isCancelled = statusByOrder === "Отменён" || statusByShipment === "Отменён";
    if (isCancelled && article) {
      cancelSumByArticle.set(article, (cancelSumByArticle.get(article) || 0) + amount);
    }

    if (!article && otherServicesTypeSet.has(type)) {
      otherServicesTotal += amount;
    }

    if (REALIZ_TYPES.has(type)) {
      realizTotal += amount;
    }
  }

  const articles = Array.from(
    new Set([...ordersByArticle.keys(), ...accrualsByArticle.keys(), ...sebesMap.keys()])
  ).sort();

  const articleCount = articles.length || 1;
  const otherPerArticle = otherServicesTotal / articleCount;
  const accrualGroups = Array.from(accrualGroupsSet).sort();

  const rows = articles.map((article) => {
    const hasCost = sebesMap.has(article) && Number.isFinite(sebesMap.get(article));
    const cost = hasCost ? sebesMap.get(article) : 0;
    if (!hasCost) missingCosts.add(article);

    const qty = ordersByArticle.get(article) || 0;
    const costSum = cost * qty;
    const accrual = accrualsByArticle.get(article) || 0;
    const ads = adsByArticle.get(article) || 0;
    const revenue = accrual - ads + otherPerArticle;
    const margin = revenue > 0 ? (revenue - costSum) / revenue : 0;
    const cancelSum = cancelSumByArticle.get(article) || 0;
    const revenueWithoutCancel = revenue - cancelSum;
    const marginWithoutCancel = revenueWithoutCancel > 0 ? (revenueWithoutCancel - costSum) / revenueWithoutCancel : 0;

    const accrualByGroup = {};
    const groupMap = accrualsByArticleGroup.get(article) || new Map();
    accrualGroups.forEach((group) => {
      accrualByGroup[group] = groupMap.get(group) || 0;
    });

    return {
      article,
      cost,
      qty,
      costSum,
      otherPerArticle,
      accrualByGroup,
      accrual,
      ads,
      revenue,
      margin,
      cancelSum,
      marginWithoutCancel
    };
  });

  const totalCost = rows.reduce((sum, row) => sum + row.costSum, 0);
  const totalAccrual = rows.reduce((sum, row) => sum + row.accrual, 0);
  const totalAds = rows.reduce((sum, row) => sum + row.ads, 0);
  const totalCancelSum = rows.reduce((sum, row) => sum + row.cancelSum, 0);
  const totalQty = rows.reduce((sum, row) => sum + row.qty, 0);
  const totalByGroup = {};
  accrualGroups.forEach((group) => {
    totalByGroup[group] = rows.reduce((sum, row) => sum + (row.accrualByGroup[group] || 0), 0);
  });
  const revenueBeforeTax = totalAccrual + otherServicesTotal - totalAds;

  const tax9 = realizTotal * 0.09;
  const netWithTax9 = totalAccrual - tax9 + otherServicesTotal - totalAds;

  const tax5 = realizTotal * 0.05;
  const netWithTax5 = totalAccrual - tax5 + otherServicesTotal - totalAds;

  const marginBeforeTax =
    revenueBeforeTax > 0 ? (revenueBeforeTax - totalCost) / revenueBeforeTax : 0;
  const revenueWithoutCancel = revenueBeforeTax - totalCancelSum;
  const summaryMarginWithoutCancel =
    revenueWithoutCancel > 0 ? (revenueWithoutCancel - totalCost) / revenueWithoutCancel : 0;
  const marginAfterTax9 =
    revenueBeforeTax > 0 ? (netWithTax9 - totalCost) / revenueBeforeTax : 0;
  const marginAfterTax5 =
    revenueBeforeTax > 0 ? (netWithTax5 - totalCost) / revenueBeforeTax : 0;

  const summary = {
    realizTotal,
    totalCost,
    otherServicesTotal,
    totalAccrual,
    totalAds,
    revenueBeforeTax,
    marginBeforeTax,
    tax9,
    netWithTax9,
    marginAfterTax9,
    tax5,
    netWithTax5,
    marginAfterTax5,
    totalCancelSum,
    summaryMarginWithoutCancel,
    totalQty,
    totalByGroup
  };

  // Данные для реестра трафаретов
  const stencilData = {
    spendByKey: Object.fromEntries(stencilSumByKey),
    orderCountsInPeriod: Object.fromEntries(
      Array.from(stencilOrderCountsInPeriod.entries()).map(([k, v]) => [k, v])
    ),
    adsByArticle: Object.fromEntries(
      Array.from(stencilAdsByArticle.entries()).map(([a, s]) => [
        a,
        { stencil: s, pvp: pvpAdsByArticle.get(a) || 0 }
      ])
    )
  };

  return {
    summary,
    rows,
    missingCosts: Array.from(missingCosts),
    accrualGroups,
    stencilData
  };
}

app.get("/health", (_req, res) => {
  res.json({ ok: true });
});

app.post("/auth/register", async (req, res) => {
  const email = normalizeEmail(req.body && req.body.email);
  const password = String(req.body && req.body.password ? req.body.password : "");
  if (!email || !password) {
    return res.status(400).json({ ok: false, error: "Email и пароль обязательны." });
  }
  if (password.length < 6) {
    return res.status(400).json({ ok: false, error: "Пароль должен быть не короче 6 символов." });
  }

  const client = await pool.connect();
  try {
    const existing = await client.query("select id from users where id=$1", [email]);
    if (existing.rows.length > 0) {
      return res.status(400).json({ ok: false, error: "Аккаунт уже существует." });
    }
    const hash = await bcrypt.hash(password, 10);
    await client.query(
      "insert into users(id,email,role,credits,password_hash) values($1,$2,$3,$4,$5)",
      [email, email, "user", 1, hash]
    );
    const token = jwt.sign({ id: email, email }, JWT_SECRET, { expiresIn: "30d" });
    res.json({ ok: true, token, credits: 1, role: "user", email });
  } catch (e) {
    res.status(400).json({ ok: false, error: e.message });
  } finally {
    client.release();
  }
});

app.post("/auth/telegram", async (req, res) => {
  try {
    if (!checkTelegramAuth(req.body || {})) {
      return res.status(401).json({ ok: false, error: "Telegram auth failed." });
    }
    const username = req.body && req.body.username ? String(req.body.username) : "";
    const tgId = req.body && req.body.id ? String(req.body.id) : "";
    const email = username ? `@${username}` : `tg_${tgId}`;
    const { rows } = await pool.query("select credits, role from users where id=$1", [email]);
    if (!rows.length) {
      await pool.query(
        "insert into users(id,email,role,credits) values($1,$2,$3,$4)",
        [email, email, "user", 1]
      );
    }
    const token = jwt.sign({ id: email, email }, JWT_SECRET, { expiresIn: "30d" });
    res.json({ ok: true, token, email });
  } catch (e) {
    res.status(400).json({ ok: false, error: e.message });
  }
});

app.post("/auth/reset", async (req, res) => {
  const email = normalizeEmail(req.body && req.body.email);
  if (!email) return res.status(400).json({ ok: false, error: "Email обязателен." });

  const code = String(Math.floor(100000 + Math.random() * 900000));
  const expiresAt = new Date(Date.now() + 3 * 60 * 60 * 1000);

  const client = await pool.connect();
  try {
    await client.query(
      "insert into password_resets(email,code,expires_at) values($1,$2,$3) on conflict (email) do update set code=excluded.code, expires_at=excluded.expires_at",
      [email, code, expiresAt]
    );
  } finally {
    client.release();
  }

  await sendResetEmail(email, code);

  res.json({ ok: true });
});

app.post("/auth/reset/confirm", async (req, res) => {
  const email = normalizeEmail(req.body && req.body.email);
  const code = String(req.body && req.body.code ? req.body.code : "").trim();
  const password = String(req.body && req.body.password ? req.body.password : "");
  if (!email || !code || !password) {
    return res.status(400).json({ ok: false, error: "Email, код и пароль обязательны." });
  }
  if (password.length < 6) {
    return res.status(400).json({ ok: false, error: "Пароль должен быть не короче 6 символов." });
  }

  const client = await pool.connect();
  try {
    const { rows } = await client.query(
      "select code, expires_at from password_resets where email=$1",
      [email]
    );
    if (!rows.length) return res.status(400).json({ ok: false, error: "Код не найден." });

    const row = rows[0];
    if (row.code !== code) return res.status(400).json({ ok: false, error: "Неверный код." });
    if (new Date(row.expires_at).getTime() < Date.now()) {
      return res.status(400).json({ ok: false, error: "Код истёк." });
    }

    const hash = await bcrypt.hash(password, 10);
    await client.query("update users set password_hash=$1 where id=$2", [hash, email]);
    await client.query("delete from password_resets where email=$1", [email]);

    res.json({ ok: true });
  } finally {
    client.release();
  }
});

app.post("/auth/login", async (req, res) => {
  const email = normalizeEmail(req.body && req.body.email);
  const password = String(req.body && req.body.password ? req.body.password : "");
  if (!email || !password) {
    return res.status(400).json({ ok: false, error: "Email и пароль обязательны." });
  }

  const client = await pool.connect();
  try {
    const { rows } = await client.query(
      "select id,email,role,credits,password_hash from users where id=$1",
      [email]
    );
    if (!rows.length) {
      return res.status(400).json({ ok: false, error: "Пользователь не найден." });
    }
    const user = rows[0];
    if (!user.password_hash) {
      return res.status(400).json({ ok: false, error: "У аккаунта не задан пароль." });
    }
    const ok = await bcrypt.compare(password, user.password_hash);
    if (!ok) {
      return res.status(400).json({ ok: false, error: "Неверный пароль." });
    }
    const token = jwt.sign({ id: user.id, email: user.email || email }, JWT_SECRET, {
      expiresIn: "30d"
    });
    res.json({
      ok: true,
      token,
      credits: Number(user.credits || 0),
      role: String(user.role || ""),
      email: user.email || email
    });
  } catch (e) {
    res.status(400).json({ ok: false, error: e.message });
  } finally {
    client.release();
  }
});

app.post("/initUser", async (req, res) => {
  try {
    const user = requireUser(req);
    const userId = getUserId(user);
    const userEmail = normalizeEmail(user.email || userId);
    const { rows } = await pool.query("select credits, role from users where id=$1", [
      userId
    ]);
    if (!rows.length) {
      await pool.query(
        "insert into users(id,email,role,credits) values($1,$2,$3,$4)",
        [userId, userEmail, "user", 1]
      );
      return res.json({ ok: true, credits: 1, role: "user" });
    }
    res.json({
      ok: true,
      credits: Number(rows[0].credits || 0),
      role: String(rows[0].role || "")
    });
  } catch (e) {
    res.status(401).json({ ok: false, error: e.message });
  }
});

app.get("/sebes", async (req, res) => {
  try {
    const user = requireUser(req);
    const userId = getUserId(user);
    const { rows } = await pool.query("select items from user_sebes where user_id=$1", [
      userId
    ]);
    res.json({ ok: true, items: rows.length ? rows[0].items || [] : [] });
  } catch (e) {
    res.status(400).json({ ok: false, error: e.message });
  }
});

app.post("/sebes", async (req, res) => {
  try {
    const user = requireUser(req);
    const userId = getUserId(user);
    const items = Array.isArray(req.body && req.body.items) ? req.body.items : [];
    await pool.query(
      "insert into user_sebes(user_id,items,updated_at) values($1,$2,now()) on conflict (user_id) do update set items=excluded.items, updated_at=now()",
      [userId, JSON.stringify(items)]
    );
    res.json({ ok: true });
  } catch (e) {
    res.status(400).json({ ok: false, error: e.message });
  }
});

app.get("/cashflow", async (req, res) => {
  try {
    const user = requireUser(req);
    const userId = getUserId(user);
    const year = Number(req.query.year);
    if (!Number.isFinite(year)) {
      return res.status(400).json({ ok: false, error: "Year is required." });
    }
    const { rows } = await pool.query(
      "select entries, tax_rate from cashflow where user_id=$1 and year=$2",
      [userId, year]
    );
    if (!rows.length) {
      return res.json({ ok: true, entries: {}, taxRate: 6 });
    }
    res.json({
      ok: true,
      entries: rows[0].entries || {},
      taxRate: Number(rows[0].tax_rate ?? 6)
    });
  } catch (e) {
    res.status(400).json({ ok: false, error: e.message });
  }
});

app.post("/cashflow", async (req, res) => {
  try {
    const user = requireUser(req);
    const userId = getUserId(user);
    const year = Number(req.body && req.body.year);
    if (!Number.isFinite(year)) {
      return res.status(400).json({ ok: false, error: "Year is required." });
    }
    const entries = req.body && typeof req.body.entries === "object" ? req.body.entries : {};
    const taxRate = Number(req.body && req.body.taxRate);
    await pool.query(
      "insert into cashflow(user_id,year,entries,tax_rate,updated_at) values($1,$2,$3,$4,now()) on conflict (user_id,year) do update set entries=excluded.entries, tax_rate=excluded.tax_rate, updated_at=now()",
      [userId, year, JSON.stringify(entries), Number.isFinite(taxRate) ? taxRate : null]
    );
    res.json({ ok: true });
  } catch (e) {
    res.status(400).json({ ok: false, error: e.message });
  }
});

app.post("/createPayment", async (req, res) => {
  try {
    const user = requireUser(req);
    const userId = getUserId(user);
    const email = normalizeEmail(user.email || userId);
    const packId = Number(req.body && req.body.packId);
    const pack = CREDIT_PACKS[packId];
    if (!pack) {
      return res.status(400).json({ ok: false, error: "Unknown pack." });
    }
    if (!email) {
      return res.status(400).json({ ok: false, error: "Email is required." });
    }
    const cfg = getYooConfig();
    const payment = await yooRequest("POST", "/payments", {
      amount: { value: formatAmount(pack.amount), currency: "RUB" },
      payment_method_data: { type: "bank_card" },
      capture: true,
      confirmation: { type: "redirect", return_url: cfg.returnUrl },
      description: `Пакет токенов: ${pack.credits}`,
      metadata: {
        uid: userId,
        credits: String(pack.credits)
      },
      receipt: {
        customer: { email },
        items: [
          {
            description: `Пакет токенов: ${pack.credits}`,
            quantity: 1,
            amount: { value: formatAmount(pack.amount), currency: "RUB" },
            vat_code: cfg.vatCode,
            payment_mode: "full_payment",
            payment_subject: "service"
          }
        ],
        tax_system_code: cfg.taxSystemCode
      }
    });
    res.json({
      ok: true,
      confirmationUrl: payment.confirmation && payment.confirmation.confirmation_url
    });
  } catch (e) {
    res.status(400).json({ ok: false, error: e.message });
  }
});

app.post("/paymentWebhook", async (req, res) => {
  try {
    const event = req.body;
    const paymentId = event && event.object ? event.object.id : null;
    if (!paymentId) {
      return res.status(400).send("Missing payment id.");
    }
    const payment = await yooRequest("GET", `/payments/${paymentId}`);
    if (!payment || payment.status !== "succeeded") {
      return res.status(200).send("Ignored.");
    }

    const metadata = payment.metadata || {};
    const uid = normalizeEmail(metadata.uid || "");
    const credits = Number(metadata.credits || 0);
    if (!uid || !credits) {
      return res.status(400).send("Missing metadata.");
    }

    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const existing = await client.query("select status from payments where id=$1", [paymentId]);
      if (existing.rows.length && existing.rows[0].status === "succeeded") {
        await client.query("ROLLBACK");
        return res.status(200).send("OK");
      }
      await client.query(
        "insert into payments(id,user_id,credits,amount,currency,status,created_at) values($1,$2,$3,$4,$5,$6,$7) on conflict (id) do update set status=excluded.status",
        [
          paymentId,
          uid,
          credits,
          payment.amount?.value || null,
          payment.amount?.currency || "RUB",
          payment.status,
          payment.created_at ? new Date(payment.created_at) : new Date()
        ]
      );
      await client.query("update users set credits = credits + $1 where id=$2", [credits, uid]);
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }

    res.status(200).send("OK");
  } catch (e) {
    console.error("paymentWebhook error:", e);
    res.status(400).send("Webhook error.");
  }
});

app.post("/generateReport", async (req, res) => {
  const client = await pool.connect();
  try {
    const user = requireUser(req);
    await client.query("BEGIN");
    const { rows } = await client.query(
      "select credits, role from users where id=$1 for update",
      [getUserId(user)]
    );
    if (!rows.length) throw new Error("User not found");

    const credits = Number(rows[0].credits || 0);
    const role = String(rows[0].role || "");
    if (role !== "owner" && credits <= 0) {
      await client.query("ROLLBACK");
      return res.status(402).json({ ok: false, error: "Недостаточно токенов." });
    }

    let result = calculateReport(req.body || {});
    let creditsLeft = credits;
    if (role !== "owner") {
      creditsLeft = creditsLeft - 1;
      await client.query("update users set credits=$1 where id=$2", [
        creditsLeft,
        getUserId(user)
      ]);
    }

    await client.query("COMMIT");

    // Обновляем реестр трафаретов и пересчитываем прошлые периоды (вне транзакции)
    const updatedCashflowEntries = {};
    let spendRegistry = {};
    let orderRegistry = {};
    try {
      const userId = getUserId(user);
      const { stencilData } = result;

      // 1. Upsert stencil_spend_registry
      for (const [key, spend] of Object.entries(stencilData.spendByKey || {})) {
        const sepIdx = key.indexOf("__");
        if (sepIdx < 0) continue;
        const dateStr = key.slice(0, sepIdx);
        const skuName = key.slice(sepIdx + 2);
        await pool.query(
          `INSERT INTO stencil_spend_registry(user_id, date, sku_name, total_spend)
           VALUES($1, $2, $3, $4)
           ON CONFLICT (user_id, date, sku_name) DO UPDATE SET total_spend = EXCLUDED.total_spend`,
          [userId, dateStr, skuName, spend]
        );
      }

      // 2. Upsert stencil_order_registry (SET, не INCREMENT — идемпотентно по расчётному периоду)
      const periodStart = req.body.startDate;
      const periodEnd = req.body.endDate;
      for (const [periodKey, { count, skuName }] of Object.entries(stencilData.orderCountsInPeriod || {})) {
        const sepIdx = periodKey.indexOf("__");
        if (sepIdx < 0) continue;
        const article = periodKey.slice(0, sepIdx);
        const dateStr = periodKey.slice(sepIdx + 2);
        await pool.query(
          `INSERT INTO stencil_order_registry(user_id, period_start, period_end, date, article, sku_name, total_count)
           VALUES($1, $2, $3, $4, $5, $6, $7)
           ON CONFLICT (user_id, period_start, period_end, date, article) DO UPDATE
             SET total_count = EXCLUDED.total_count,
                 sku_name = EXCLUDED.sku_name`,
          [userId, periodStart, periodEnd, dateStr, article, skuName, count]
        );
      }

      // 3. Загружаем актуальный реестр для пересчёта (SUM по всем расчётным периодам)
      const { rows: spendRows } = await pool.query(
        `SELECT date, sku_name, total_spend FROM stencil_spend_registry WHERE user_id=$1`,
        [userId]
      );
      const { rows: orderRows } = await pool.query(
        `SELECT date, article, SUM(total_count)::int as total_count
         FROM stencil_order_registry WHERE user_id=$1
         GROUP BY date, article`,
        [userId]
      );
      for (const r of spendRows) {
        spendRegistry[`${r.date.toISOString().slice(0,10)}__${r.sku_name}`] = Number(r.total_spend);
      }
      for (const r of orderRows) {
        orderRegistry[`${r.article}__${r.date.toISOString().slice(0,10)}`] = Number(r.total_count);
      }

      // 4. Загружаем все cashflow-периоды пользователя и пересчитываем затронутые
      const currentYear = new Date().getFullYear();
      for (const year of [currentYear - 1, currentYear]) {
        const { rows: cfRows } = await pool.query(
          `SELECT entries, tax_rate FROM cashflow WHERE user_id=$1 AND year=$2`,
          [userId, year]
        );
        if (!cfRows.length) continue;

        const entries = cfRows[0].entries || {};
        let changed = false;

        for (const [key, entry] of Object.entries(entries)) {
          if (entry.locked) continue;
          if (!entry.stencilOrderCountsInPeriod) continue;
          const updated = recalcEntryStencil(entry, spendRegistry, orderRegistry);
          if (updated) {
            entries[key] = updated;
            updatedCashflowEntries[key] = updated;
            changed = true;
          }
        }

        if (changed) {
          await pool.query(
            `UPDATE cashflow SET entries=$1, updated_at=now() WHERE user_id=$2 AND year=$3`,
            [JSON.stringify(entries), userId, year]
          );
        }
      }
    } catch (stencilErr) {
      console.error("Stencil registry error (non-fatal):", stencilErr.message);
    }

    // Пересчитываем текущий период по реестру (чтобы скорректировать хвосты старых дат)
    try {
      const { stencilData } = result;
      if (stencilData && Object.keys(stencilData.orderCountsInPeriod || {}).length > 0) {
        const stencilOnly = {};
        const pvpOnly = {};
        for (const [a, v] of Object.entries(stencilData.adsByArticle || {})) {
          stencilOnly[a] = typeof v === "object" ? (v.stencil || 0) : (v || 0);
          pvpOnly[a] = typeof v === "object" ? (v.pvp || 0) : 0;
        }
        const currentEntry = {
          stencilOrderCountsInPeriod: stencilData.orderCountsInPeriod,
          stencilAdsByArticle: stencilOnly,
          pvpAdsByArticle: pvpOnly,
          summary: result.summary
        };
        console.log(`[RECALC_DEBUG] stencilOnly=${JSON.stringify(stencilOnly)}`);
        console.log(`[RECALC_DEBUG] orderCountsInPeriod keys=${Object.keys(stencilData.orderCountsInPeriod || {}).length}`);
        console.log(`[RECALC_DEBUG] spendRegistry size=${Object.keys(spendRegistry).length}, orderRegistry size=${Object.keys(orderRegistry).length}`);
        // Пример первого ключа из orderCountsInPeriod чтобы проверить формат
        const firstOCKey = Object.keys(stencilData.orderCountsInPeriod || {})[0];
        if (firstOCKey) {
          const sepIdx2 = firstOCKey.indexOf("__");
          const art2 = firstOCKey.slice(0, sepIdx2);
          const dt2 = firstOCKey.slice(sepIdx2 + 2);
          const { count: cnt2, skuName: sku2 } = stencilData.orderCountsInPeriod[firstOCKey];
          const spk2 = `${dt2}__${sku2}`;
          const ork2 = `${art2}__${dt2}`;
          console.log(`[RECALC_DEBUG] sample key=${firstOCKey} spendKey=${spk2} spendVal=${spendRegistry[spk2]} orderKey=${ork2} orderVal=${orderRegistry[ork2]} count=${cnt2}`);
        }
        const recalcedCurrent = recalcEntryStencil(currentEntry, spendRegistry, orderRegistry);
        if (recalcedCurrent) {
          // Обновляем summary и stencilData.adsByArticle корректированными значениями
          const correctedAdsByArticle = {};
          for (const [a, stencil] of Object.entries(recalcedCurrent.stencilAdsByArticle || {})) {
            correctedAdsByArticle[a] = { stencil, pvp: pvpOnly[a] || 0 };
          }
          result = {
            ...result,
            summary: recalcedCurrent.summary,
            stencilData: { ...stencilData, adsByArticle: correctedAdsByArticle }
          };
        }
      }
    } catch (recalcErr) {
      console.error("Current period recalc error (non-fatal):", recalcErr.message);
    }

    res.json({ ok: true, creditsLeft, ...result, updatedCashflowEntries });
  } catch (e) {
    await client.query("ROLLBACK");
    res.status(400).json({ ok: false, error: e.message });
  } finally {
    client.release();
  }
});

// Пересчитывает трафаретную часть одного cashflow-entry используя актуальный реестр
function recalcEntryStencil(entry, spendRegistry, orderRegistry) {
  const counts = entry.stencilOrderCountsInPeriod;
  // Нормализуем: исторически могло сохраниться как {stencil: X, pvp: Y}, берём только stencil
  const rawOld = entry.stencilAdsByArticle || {};
  const oldStencilByArticle = {};
  for (const [a, v] of Object.entries(rawOld)) {
    oldStencilByArticle[a] = typeof v === "object" && v !== null ? (v.stencil || 0) : (Number(v) || 0);
  }
  if (!counts || Object.keys(counts).length === 0) return null;

  const newStencilByArticle = {};
  for (const [periodKey, { count: periodCount, skuName }] of Object.entries(counts)) {
    const [article, dateStr] = periodKey.split("__");
    const spendKey = `${dateStr}__${skuName}`;
    const totalSpend = spendRegistry[spendKey] || 0;
    const totalOrders = orderRegistry[`${article}__${dateStr}`] || periodCount;
    const newStencilPerRow = totalOrders > 0 ? totalSpend / totalOrders : 0;
    const newStencilForPeriod = periodCount * newStencilPerRow;
    newStencilByArticle[article] = (newStencilByArticle[article] || 0) + newStencilForPeriod;
  }

  // Считаем дельту от стенсил-части
  let deltaStencil = 0;
  const allArticles = new Set([
    ...Object.keys(oldStencilByArticle),
    ...Object.keys(newStencilByArticle)
  ]);
  for (const article of allArticles) {
    deltaStencil += (newStencilByArticle[article] || 0) - (oldStencilByArticle[article] || 0);
  }

  if (Math.abs(deltaStencil) < 0.01) return null; // изменение незначительное

  const summary = entry.summary;
  if (!summary) return null;

  // Вычисляем pvp-составляющую из сохранённого pvpAdsByArticle, затем перестраиваем totalAds абсолютно
  const pvpByArticle = entry.pvpAdsByArticle || {};
  const totalPvp = Object.values(pvpByArticle).reduce((s, v) => s + (Number(v) || 0), 0);
  const oldTotalStencil = Object.values(oldStencilByArticle).reduce((s, v) => s + v, 0);
  const newTotalStencil = Object.values(newStencilByArticle).reduce((s, v) => s + v, 0);

  // Если pvpAdsByArticle не сохранён — откатываемся к дельта-методу
  const newTotalAds = Object.keys(pvpByArticle).length > 0
    ? totalPvp + newTotalStencil
    : (summary.totalAds || 0) - oldTotalStencil + newTotalStencil;
  const newRevenueBeforeTax = (summary.totalAccrual || 0) + (summary.otherServicesTotal || 0) - newTotalAds;
  const newMarginBeforeTax = newRevenueBeforeTax > 0
    ? (newRevenueBeforeTax - (summary.totalCost || 0)) / newRevenueBeforeTax
    : 0;
  const newRevenueWithoutCancel = newRevenueBeforeTax - (summary.totalCancelSum || 0);
  const newSummaryMarginWithoutCancel = newRevenueWithoutCancel > 0
    ? (newRevenueWithoutCancel - (summary.totalCost || 0)) / newRevenueWithoutCancel
    : 0;

  return {
    ...entry,
    marginBeforeTax: newMarginBeforeTax,
    stencilAdsByArticle: newStencilByArticle,
    summary: {
      ...summary,
      totalAds: newTotalAds,
      revenueBeforeTax: newRevenueBeforeTax,
      marginBeforeTax: newMarginBeforeTax,
      summaryMarginWithoutCancel: newSummaryMarginWithoutCancel
    }
  };
}

async function initDb() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS stencil_spend_registry (
      user_id TEXT NOT NULL,
      date DATE NOT NULL,
      sku_name TEXT NOT NULL,
      total_spend NUMERIC NOT NULL DEFAULT 0,
      PRIMARY KEY (user_id, date, sku_name)
    )
  `);
  // Мигрируем: если старая таблица без period_start — пересоздаём
  const { rows: cols } = await pool.query(`
    SELECT column_name FROM information_schema.columns
    WHERE table_name='stencil_order_registry' AND column_name='period_start'
  `);
  if (cols.length === 0) {
    await pool.query(`DROP TABLE IF EXISTS stencil_order_registry`);
  }
  await pool.query(`
    CREATE TABLE IF NOT EXISTS stencil_order_registry (
      user_id TEXT NOT NULL,
      period_start DATE NOT NULL,
      period_end DATE NOT NULL,
      date DATE NOT NULL,
      article TEXT NOT NULL,
      sku_name TEXT NOT NULL,
      total_count INT NOT NULL DEFAULT 0,
      PRIMARY KEY (user_id, period_start, period_end, date, article)
    )
  `);
}

initDb().catch((e) => console.error("initDb error:", e));

app.listen(3001, () => {
  console.log("API started on port 3001");
});
