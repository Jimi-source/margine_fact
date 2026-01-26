import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.5/firebase-app.js";
import {
  getAuth,
  GoogleAuthProvider,
  onAuthStateChanged,
  signInWithPopup,
  signOut
} from "https://www.gstatic.com/firebasejs/10.12.5/firebase-auth.js";
import {
  doc,
  getDoc,
  getFirestore,
  setDoc
} from "https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js";

window.__APP_READY = false;

const firebaseConfig = {
  apiKey: "AIzaSyCAlv2Wqzyy89Hp5sOYUBpuTNieqMIjF74",
  authDomain: "marginefact.firebaseapp.com",
  projectId: "marginefact",
  storageBucket: "marginefact.firebasestorage.app",
  messagingSenderId: "295108927428",
  appId: "1:295108927428:web:1cc3b31ad0a58132d7ce91"
};

const firebaseApp = initializeApp(firebaseConfig);
const auth = getAuth(firebaseApp);
const db = getFirestore(firebaseApp);

const XLSXLib = window.XLSX;

const SEBES = [];

const REALIZ_TYPES = [
  "Баллы за скидки",
  "Возврат вознаграждения",
  "Вознаграждение за продажу",
  "Выручка",
  "Потеря по вине Ozon в логистике",
  "Потеря по вине Ozon на складе",
  "Программы партнёров"
];

const OTHER_SERVICES_EXCLUDED = new Set([
  "Продвижение в поиске",
  "Трафареты",
  "Продвижение с оплатой за заказ"
]);

const state = {
  startDate: null,
  endDate: null,
  accruals: null,
  orders: null,
  pvp: null,
  stencils: null,
  sebes: [],
  earliestAccrualDate: null,
  user: null,
  sebesDirty: false,
  otherServicesTypes: [],
  otherServicesTypesSelected: new Set(),
  lastSummary: null,
  lastCalcRange: null,
  cashflow: {
    year: new Date().getFullYear(),
    granularity: "week",
    periods: [],
    selectedKey: "",
    entries: {}
  }
};

const elements = {
  startDate: document.getElementById("startDate"),
  endDate: document.getElementById("endDate"),
  accrualsFile: document.getElementById("accrualsFile"),
  ordersFile: document.getElementById("ordersFile"),
  pvpFile: document.getElementById("pvpFile"),
  stencilsFile: document.getElementById("stencilsFile"),
  calcButton: document.getElementById("calcButton"),
  dateHint: document.getElementById("dateHint"),
  uploadStatus: document.getElementById("uploadStatus"),
  resultSummary: document.getElementById("resultSummary"),
  resultBody: document.getElementById("resultBody"),
  missingCostBlock: document.getElementById("missingCostBlock"),
  appContent: document.getElementById("appContent"),
  authGate: document.getElementById("authGate"),
  authState: document.getElementById("authState"),
  authStatus: document.getElementById("authStatus"),
  signInButton: document.getElementById("signInButton"),
  signOutButton: document.getElementById("signOutButton"),
  tabButtons: Array.from(document.querySelectorAll(".tab-button")),
  tabPanels: Array.from(document.querySelectorAll(".tab-panel")),
  sebesBody: document.getElementById("sebesBody"),
  sebesStatus: document.getElementById("sebesStatus"),
  addSebesRow: document.getElementById("addSebesRow"),
  saveSebes: document.getElementById("saveSebes"),
  sebesFile: document.getElementById("sebesFile"),
  downloadSebesTemplate: document.getElementById("downloadSebesTemplate"),
  otherServicesFilter: document.getElementById("otherServicesFilter"),
  cashflowYear: document.getElementById("cashflowYear"),
  cashflowGranularity: document.getElementById("cashflowGranularity"),
  cashflowPeriod: document.getElementById("cashflowPeriod"),
  cashflowOpenPeriod: document.getElementById("cashflowOpenPeriod"),
  cashflowSavePeriod: document.getElementById("cashflowSavePeriod"),
  cashflowStatus: document.getElementById("cashflowStatus"),
  cashflowBody: document.getElementById("cashflowBody")
};

const numberFormatter = new Intl.NumberFormat("ru-RU", {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2
});
const integerFormatter = new Intl.NumberFormat("ru-RU", {
  maximumFractionDigits: 0
});
const percentFormatter = new Intl.NumberFormat("ru-RU", {
  style: "percent",
  minimumFractionDigits: 2,
  maximumFractionDigits: 2
});

function normalizeHeader(value) {
  return String(value || "")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

function normalizeKey(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/[^a-z0-9а-яё]/gi, "");
}

function setStatus(message, isError = false) {
  if (!elements.uploadStatus) return;
  elements.uploadStatus.textContent = message;
  elements.uploadStatus.classList.toggle("error", isError);
}

function setSebesStatus(message, isError = false) {
  if (!elements.sebesStatus) return;
  elements.sebesStatus.textContent = message;
  elements.sebesStatus.classList.toggle("error", isError);
}

function setCashflowStatus(message, isError = false) {
  if (!elements.cashflowStatus) return;
  elements.cashflowStatus.textContent = message;
  elements.cashflowStatus.classList.toggle("error", isError);
}

function setAuthStatus(message, isError = false) {
  if (!elements.authStatus) return;
  elements.authStatus.textContent = message;
  elements.authStatus.classList.toggle("error", isError);
}

function setMissingCostBlock(articles) {
  if (!elements.missingCostBlock) return;
  if (!articles || articles.length === 0) {
    elements.missingCostBlock.classList.add("hidden");
    elements.missingCostBlock.textContent = "";
    return;
  }
  elements.missingCostBlock.classList.remove("hidden");
  elements.missingCostBlock.textContent =
    `Не хватает себестоимости для: ${articles.join(", ")}.`;
}

function mapAuthError(error) {
  const code = error && error.code ? String(error.code) : "";
  if (code === "auth/unauthorized-domain") {
    return "Домен не разрешён в Firebase Auth (Authorized domains).";
  }
  if (code === "auth/operation-not-allowed") {
    return "В Firebase Auth не включён провайдер Google.";
  }
  if (code === "auth/invalid-credential") {
    return "Некорректные данные входа. Попробуйте ещё раз.";
  }
  return `Не удалось выполнить вход. (${code || "unknown-error"})`;
}

function setActiveTab(tabName) {
  elements.tabButtons.forEach((button) => {
    button.classList.toggle("active", button.dataset.tab === tabName);
  });
  elements.tabPanels.forEach((panel) => {
    const isActive = panel.dataset.panel === tabName;
    panel.classList.toggle("hidden", !isActive);
  });
}

function updateSebesActions() {
  const canEdit = Boolean(state.user);
  if (elements.addSebesRow) {
    elements.addSebesRow.disabled = !canEdit;
  }
  if (elements.saveSebes) {
    elements.saveSebes.disabled = !canEdit || !state.sebesDirty;
  }
  if (elements.sebesFile) {
    elements.sebesFile.disabled = !canEdit;
  }
  if (elements.downloadSebesTemplate) {
    elements.downloadSebesTemplate.disabled = !canEdit;
  }
}

function updateCashflowActions() {
  if (!elements.cashflowSavePeriod) return;
  const hasSelection = Boolean(state.cashflow.selectedKey);
  const hasSummary = Boolean(state.lastSummary && state.lastCalcRange);
  const sameRange =
    hasSummary &&
    state.cashflow.selectedKey.includes(
      `${toISODate(state.lastCalcRange.start)}|${toISODate(state.lastCalcRange.end)}`
    );
  elements.cashflowSavePeriod.disabled =
    !state.user || !hasSelection || !hasSummary || !sameRange;
}

function findHeaderRow(rows, requiredHeaders) {
  const required = requiredHeaders.map(normalizeHeader);
  for (let i = 0; i < rows.length; i += 1) {
    const row = rows[i];
    if (!row || row.length === 0) continue;
    const normalized = row.map(normalizeHeader);
    const matches = required.every((header) => normalized.includes(header));
    if (matches) {
      return i;
    }
  }
  return -1;
}

function scoreHeaderRow(row, schema) {
  if (!row || row.length === 0) return { score: 0, matched: 0, missing: 0 };
  const normalized = row.map(normalizeKey);
  let matched = 0;
  let requiredMissing = 0;
  schema.forEach((item) => {
    const found = item.keys.some((key) =>
      normalized.some((cell) => cell.includes(key))
    );
    if (found) {
      matched += 1;
    } else if (item.required) {
      requiredMissing += 1;
    }
  });
  return { score: matched, matched, missing: requiredMissing };
}

function pickBestHeaderRow(rows, schema, startIndex = 0) {
  let best = { idx: -1, score: 0, missing: Infinity };
  for (let i = startIndex; i < rows.length; i += 1) {
    const { score, missing } = scoreHeaderRow(rows[i], schema);
    if (score > best.score || (score === best.score && missing < best.missing)) {
      best = { idx: i, score, missing };
    }
  }
  return best;
}

function extractRowsBySchemaFromSheet(sheet, schema, startIndex) {
  const rows = XLSXLib.utils.sheet_to_json(sheet, {
    header: 1,
    defval: ""
  });
  const best = pickBestHeaderRow(rows, schema, startIndex);
  if (best.idx === -1 || best.missing > 0) {
    return { data: null, headerIndex: -1, score: best.score, missing: best.missing };
  }
  const headerRow = rows[best.idx].map((value) => String(value || "").trim());
  const normalized = headerRow.map(normalizeKey);
  const columnMap = new Map();
  schema.forEach((item) => {
    const idx = normalized.findIndex((cell) =>
      item.keys.some((key) => cell.includes(key))
    );
    if (idx >= 0) {
      columnMap.set(idx, item.name);
    }
  });
  const data = [];
  for (let i = best.idx + 1; i < rows.length; i += 1) {
    const row = rows[i];
    if (!row || isRowEmpty(row)) continue;
    const rowObject = {};
    columnMap.forEach((name, idx) => {
      rowObject[name] = row[idx];
    });
    data.push(rowObject);
  }
  return { data, headerIndex: best.idx, score: best.score, missing: 0 };
}

function extractRowsBySchema(workbook, schema, startIndex) {
  let bestResult = null;
  let bestSheet = null;
  workbook.SheetNames.forEach((sheetName) => {
    const sheet = workbook.Sheets[sheetName];
    const result = extractRowsBySchemaFromSheet(sheet, schema, startIndex);
    if (result.data && (!bestResult || result.score > bestResult.score)) {
      bestResult = result;
      bestSheet = sheetName;
    }
  });
  if (!bestResult || !bestResult.data) {
    throw new Error(
      `Не удалось найти строку заголовков (${schema
        .map((item) => item.name)
        .join(", ")}).`
    );
  }
  return bestResult.data;
}

function normalizeSchema(schema) {
  return schema.map((item) => ({
    name: item.name,
    required: Boolean(item.required),
    keys: item.keys.concat([normalizeKey(item.name)])
  }));
}

function extractRowsByPositionsFromSheet(sheet, schema, fallback, minStartRow) {
  const rows = XLSXLib.utils.sheet_to_json(sheet, {
    header: 1,
    defval: ""
  });
  const baseStart = fallback.startRow || 0;
  let startRow = Math.max(minStartRow || 0, baseStart);
  const headerScore = scoreHeaderRow(rows[startRow], schema);
  const requiredCount = schema.filter((item) => item.required).length;
  if (headerScore.matched >= requiredCount) {
    startRow += 1;
  }
  const data = [];
  for (let i = startRow; i < rows.length; i += 1) {
    const row = rows[i];
    if (!row || isRowEmpty(row)) continue;
    const rowObject = {};
    Object.entries(fallback.positions).forEach(([name, idx]) => {
      rowObject[name] = row[idx];
    });
    data.push(rowObject);
  }
  return data;
}

function extractRowsBySchemaOrPositions(workbook, schema, fallback, startIndex, minStartRow) {
  try {
    return extractRowsBySchema(workbook, schema, startIndex);
  } catch (error) {
    if (!fallback) throw error;
  }
  let bestData = null;
  let bestSheet = null;
  workbook.SheetNames.forEach((sheetName) => {
    const sheet = workbook.Sheets[sheetName];
    const data = extractRowsByPositionsFromSheet(sheet, schema, fallback, minStartRow);
    if (data.length > 0 && (!bestData || data.length > bestData.length)) {
      bestData = data;
      bestSheet = sheetName;
    }
  });
  if (!bestData) {
    throw new Error(
      `Не удалось найти строку заголовков (${schema
        .map((item) => item.name)
        .join(", ")}).`
    );
  }
  return bestData;
}

function isRowEmpty(row) {
  return row.every((cell) => cell === "" || cell === null || cell === undefined);
}

function parseNumber(value) {
  if (typeof value === "number") return value;
  if (value === null || value === undefined) return 0;
  const cleaned = String(value).replace(/\s/g, "").replace(",", ".");
  const parsed = Number(cleaned);
  return Number.isFinite(parsed) ? parsed : 0;
}

function parseOptionalNumber(value) {
  if (value === null || value === undefined) return null;
  const text = String(value).trim();
  if (text === "") return null;
  const cleaned = text.replace(/\s/g, "").replace(",", ".");
  const parsed = Number(cleaned);
  return Number.isFinite(parsed) ? parsed : null;
}

function parseDateValue(value) {
  if (!value) return null;
  if (value instanceof Date && !Number.isNaN(value.valueOf())) {
    return new Date(value.getFullYear(), value.getMonth(), value.getDate());
  }
  if (typeof value === "number") {
    const parsed = XLSXLib.SSF.parse_date_code(value);
    if (!parsed) return null;
    return new Date(parsed.y, parsed.m - 1, parsed.d);
  }
  if (typeof value === "string") {
    const trimmed = value.trim();
    const ruMatch = /^(\d{1,2})[./](\d{1,2})[./](\d{4})$/.exec(trimmed);
    if (ruMatch) {
      return new Date(
        Number(ruMatch[3]),
        Number(ruMatch[2]) - 1,
        Number(ruMatch[1])
      );
    }
    const isoMatch = /^(\d{4})-(\d{2})-(\d{2})$/.exec(trimmed);
    if (isoMatch) {
      return new Date(
        Number(isoMatch[1]),
        Number(isoMatch[2]) - 1,
        Number(isoMatch[3])
      );
    }
    const parsed = new Date(trimmed);
    return Number.isNaN(parsed.valueOf()) ? null : parsed;
  }
  return null;
}

function formatDate(value) {
  if (!value) return "—";
  return value.toLocaleDateString("ru-RU");
}

function inRange(date, start, end) {
  if (!date || !start || !end) return false;
  const time = new Date(
    date.getFullYear(),
    date.getMonth(),
    date.getDate()
  ).getTime();
  const startTime = new Date(
    start.getFullYear(),
    start.getMonth(),
    start.getDate()
  ).getTime();
  const endTime = new Date(
    end.getFullYear(),
    end.getMonth(),
    end.getDate()
  ).getTime();
  return time >= startTime && time <= endTime;
}

async function readWorkbook(file) {
  const buffer = await file.arrayBuffer();
  return XLSXLib.read(buffer, { type: "array", cellDates: true });
}

function detectHeader(headers, predicate) {
  for (const header of headers) {
    if (predicate(normalizeKey(header))) {
      return header;
    }
  }
  return null;
}

function detectExpenseHeader(headers) {
  return (
    detectHeader(headers, (key) => key.includes("расход")) ||
    detectHeader(
      headers,
      (key) => key.includes("стоимость") && !key.includes("продажи")
    ) ||
    detectHeader(headers, (key) => key.includes("сумма"))
  );
}

function dateKey(date) {
  if (!date) return "";
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function toISODate(date) {
  if (!date) return "";
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function addDays(date, days) {
  const next = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  next.setDate(next.getDate() + days);
  return next;
}

function startOfMonth(year, monthIndex) {
  return new Date(year, monthIndex, 1);
}

function endOfMonth(year, monthIndex) {
  return new Date(year, monthIndex + 1, 0);
}

function startOfQuarter(year, quarterIndex) {
  return new Date(year, quarterIndex * 3, 1);
}

function endOfQuarter(year, quarterIndex) {
  return new Date(year, quarterIndex * 3 + 3, 0);
}

function isoWeekYear(date) {
  const day = date.getDay() === 0 ? 7 : date.getDay();
  const thursday = addDays(date, 4 - day);
  return thursday.getFullYear();
}

function startOfIsoWeekYear(year) {
  const jan4 = new Date(year, 0, 4);
  const day = jan4.getDay() === 0 ? 7 : jan4.getDay();
  return addDays(jan4, 1 - day);
}

function getRowValue(row, headerOptions) {
  for (const header of headerOptions) {
    if (row[header] !== undefined) return row[header];
  }
  return undefined;
}

function buildPvpSumByOrderArticle(rows) {
  if (!rows || rows.length === 0) {
    return { sumByKey: new Map(), warning: "" };
  }
  const headers = Object.keys(rows[0] || {});
  const orderHeader =
    detectHeader(headers, (key) => key.includes("номерзаказ")) ||
    "Номер заказа";
  const articleHeader =
    detectHeader(headers, (key) => key.includes("артикул")) || "Артикул";
  const expenseHeader =
    detectExpenseHeader(headers) ||
    (headers.includes("Расход") ? "Расход" : null);
  if (!orderHeader || !articleHeader || !expenseHeader) {
    return {
      sumByKey: new Map(),
      warning: "Не удалось определить колонки для ПВП (номер заказа/артикул/расход)."
    };
  }
  const sumByKey = new Map();
  for (const row of rows) {
    const order = row[orderHeader];
    const article = row[articleHeader];
    if (!order || !article) continue;
    const key = `${order}__${article}`;
    const amount = parseNumber(row[expenseHeader]);
    sumByKey.set(key, (sumByKey.get(key) || 0) + amount);
  }
  return { sumByKey, warning: "" };
}

function buildStencilSumByDateName(rows) {
  if (!rows || rows.length === 0) {
    return { sumByKey: new Map(), warning: "" };
  }
  const headers = Object.keys(rows[0] || {});
  const dateHeader = detectHeader(headers, (key) => key.includes("дата")) || "Дата";
  const nameHeader =
    detectHeader(headers, (key) => key.includes("названиетовар")) ||
    "Название товара";
  const expenseHeader =
    detectExpenseHeader(headers) ||
    (headers.includes("Расход") ? "Расход" : null);
  if (!dateHeader || !nameHeader || !expenseHeader) {
    return {
      sumByKey: new Map(),
      warning:
        "Не удалось определить колонки для Трафаретов (дата/название товара/расход)."
    };
  }
  const sumByKey = new Map();
  for (const row of rows) {
    const dateValue = parseDateValue(row[dateHeader]);
    const name = row[nameHeader];
    if (!dateValue || !name) continue;
    const key = `${dateKey(dateValue)}__${String(name).trim()}`;
    const amount = parseNumber(row[expenseHeader]);
    sumByKey.set(key, (sumByKey.get(key) || 0) + amount);
  }
  return { sumByKey, warning: "" };
}

function extractRows(workbook, requiredHeaders) {
  const sheetName = workbook.SheetNames[0];
  const sheet = workbook.Sheets[sheetName];
  const rows = XLSXLib.utils.sheet_to_json(sheet, {
    header: 1,
    defval: ""
  });
  const headerIndex = findHeaderRow(rows, requiredHeaders);
  if (headerIndex === -1) {
    throw new Error(
      `Не удалось найти строку заголовков (${requiredHeaders.join(", ")}).`
    );
  }
  const headers = rows[headerIndex].map((value) =>
    String(value || "").trim()
  );
  const data = [];
  for (let i = headerIndex + 1; i < rows.length; i += 1) {
    const row = rows[i];
    if (!row || isRowEmpty(row)) continue;
    const rowObject = {};
    headers.forEach((header, index) => {
      rowObject[header] = row[index];
    });
    data.push(rowObject);
  }
  return data;
}

function updateStatus() {
  const parts = [];
  if (state.accruals) {
    parts.push(`Начисления: ${state.accruals.length} строк`);
  }
  if (state.orders) {
    parts.push(`Заказы: ${state.orders.length} строк`);
  }
  if (state.pvp) {
    parts.push(`ПВП: ${state.pvp.length} строк`);
  }
  if (state.stencils) {
    parts.push(`Трафареты: ${state.stencils.length} строк`);
  }
  if (state.earliestAccrualDate) {
    parts.push(
      `Самая ранняя дата в Начислениях (X): ${formatDate(
        state.earliestAccrualDate
      )}`
    );
  }
  setStatus(parts.length > 0 ? parts.join(" • ") : "Файлы еще не загружены.");
  updateCalcAvailability();
}

function updateDateHint() {
  if (state.earliestAccrualDate && state.endDate) {
    elements.dateHint.textContent = `Запросите отчеты Заказы/ПВП/Трафареты за период ${formatDate(
      state.earliestAccrualDate
    )} – ${formatDate(state.endDate)}.`;
    return;
  }
  elements.dateHint.textContent = "";
}

function updateCalcAvailability() {
  if (!elements.calcButton) return;
  const ready =
    !!state.startDate &&
    !!state.endDate &&
    !!state.accruals &&
    !!state.orders;
  elements.calcButton.disabled = !ready;
}

function validateElements() {
  const missing = [];
  if (!elements.startDate) missing.push("startDate");
  if (!elements.endDate) missing.push("endDate");
  if (!elements.accrualsFile) missing.push("accrualsFile");
  if (!elements.ordersFile) missing.push("ordersFile");
  if (!elements.pvpFile) missing.push("pvpFile");
  if (!elements.stencilsFile) missing.push("stencilsFile");
  if (!elements.calcButton) missing.push("calcButton");
  if (!elements.uploadStatus) missing.push("uploadStatus");
  if (!elements.missingCostBlock) missing.push("missingCostBlock");
  if (!elements.appContent) missing.push("appContent");
  if (!elements.authGate) missing.push("authGate");
  if (!elements.authState) missing.push("authState");
  if (!elements.authStatus) missing.push("authStatus");
  if (!elements.signInButton) missing.push("signInButton");
  if (!elements.signOutButton) missing.push("signOutButton");
  if (!elements.sebesBody) missing.push("sebesBody");
  if (!elements.sebesStatus) missing.push("sebesStatus");
  if (!elements.addSebesRow) missing.push("addSebesRow");
  if (!elements.saveSebes) missing.push("saveSebes");
  if (!elements.sebesFile) missing.push("sebesFile");
  if (!elements.downloadSebesTemplate) missing.push("downloadSebesTemplate");
  if (!elements.otherServicesFilter) missing.push("otherServicesFilter");
  if (!elements.cashflowYear) missing.push("cashflowYear");
  if (!elements.cashflowGranularity) missing.push("cashflowGranularity");
  if (!elements.cashflowPeriod) missing.push("cashflowPeriod");
  if (!elements.cashflowOpenPeriod) missing.push("cashflowOpenPeriod");
  if (!elements.cashflowSavePeriod) missing.push("cashflowSavePeriod");
  if (!elements.cashflowStatus) missing.push("cashflowStatus");
  if (!elements.cashflowBody) missing.push("cashflowBody");
  if (missing.length > 0) {
    setStatus("Ошибка: не найдены элементы (" + missing.join(", ") + ").", true);
    setAuthStatus("Ошибка интерфейса. Перезагрузите страницу.", true);
    return false;
  }
  return true;
}

function formatNumber(value) {
  return numberFormatter.format(value);
}

function formatInteger(value) {
  return integerFormatter.format(value);
}

function formatPercent(value) {
  return percentFormatter.format(value);
}

function createSebesRow(item, index) {
  const row = document.createElement("tr");
  const disabled = state.user ? "" : "disabled";
  row.innerHTML = `
    <td><input type="text" data-field="article" data-index="${index}" value="${item.article || ""}" ${disabled}></td>
    <td><input type="text" data-field="cost" data-index="${index}" value="${item.cost ?? ""}" ${disabled}></td>
    <td><button type="button" class="ghost-button" data-remove="${index}" ${disabled}>Удалить</button></td>
  `;
  return row;
}

function renderSebesTable(items) {
  if (!elements.sebesBody) return;
  elements.sebesBody.innerHTML = "";
  items.forEach((item, index) => {
    elements.sebesBody.appendChild(createSebesRow(item, index));
  });
  elements.sebesBody.querySelectorAll("input").forEach((input) => {
    input.addEventListener("input", onSebesInputChange);
  });
  elements.sebesBody.querySelectorAll("[data-remove]").forEach((button) => {
    button.addEventListener("click", onSebesRemoveRow);
  });
}

function getSebesFromUI() {
  if (!elements.sebesBody) return [];
  const rows = Array.from(elements.sebesBody.querySelectorAll("tr"));
  return rows
    .map((row) => {
      const articleInput = row.querySelector('input[data-field="article"]');
      const costInput = row.querySelector('input[data-field="cost"]');
      const article = articleInput ? articleInput.value.trim() : "";
      const cost = costInput ? parseOptionalNumber(costInput.value) : null;
      return { article, cost };
    })
    .filter((item) => item.article !== "");
}

function markSebesDirty() {
  state.sebesDirty = true;
  updateSebesActions();
}

function getAccrualTypeOptions() {
  if (!state.accruals) return [];
  const types = new Set();
  for (const row of state.accruals) {
    const type = row["Тип начисления"];
    if (type) {
      types.add(String(type).trim());
    }
  }
  return Array.from(types).filter(Boolean).sort();
}

function renderOtherServicesFilter() {
  if (!elements.otherServicesFilter) return;
  if (!state.accruals) {
    elements.otherServicesFilter.textContent =
      'Загрузите отчет "Начисления", чтобы увидеть список типов.';
    return;
  }
  if (state.otherServicesTypes.length === 0) {
    elements.otherServicesFilter.textContent =
      "Нет строк без артикула для расчета прочих услуг.";
    return;
  }
  elements.otherServicesFilter.innerHTML = "";
  state.otherServicesTypes.forEach((type) => {
    const id = `other-type-${normalizeKey(type)}`;
    const label = document.createElement("label");
    label.innerHTML = `
      <input type="checkbox" data-other-type="${type}" id="${id}">
      <span>${type}</span>
    `;
    const checkbox = label.querySelector("input");
    checkbox.checked = state.otherServicesTypesSelected.has(type);
    checkbox.addEventListener("change", () => {
      if (checkbox.checked) {
        state.otherServicesTypesSelected.add(type);
      } else {
        state.otherServicesTypesSelected.delete(type);
      }
      setSebesStatus("");
    });
    elements.otherServicesFilter.appendChild(label);
  });
}

function updateOtherServicesTypes() {
  const availableTypes = getAccrualTypeOptions();
  const nextSelected = new Set();
  availableTypes.forEach((type) => {
    if (state.otherServicesTypesSelected.has(type)) {
      nextSelected.add(type);
    } else if (!OTHER_SERVICES_EXCLUDED.has(type)) {
      nextSelected.add(type);
    }
  });
  state.otherServicesTypes = availableTypes;
  state.otherServicesTypesSelected = nextSelected;
  renderOtherServicesFilter();
}

function buildCashflowPeriods(year, granularity) {
  const periods = [];
  if (granularity === "day") {
    let current = new Date(year, 0, 1);
    const end = new Date(year, 11, 31);
    while (current <= end) {
      const start = current;
      const finish = current;
      const key = `${granularity}|${toISODate(start)}|${toISODate(finish)}`;
      periods.push({
        key,
        label: formatDate(start),
        start,
        end: finish
      });
      current = addDays(current, 1);
    }
    return periods;
  }
  if (granularity === "week") {
    let current = startOfIsoWeekYear(year);
    let weekIndex = 1;
    while (isoWeekYear(current) === year) {
      const start = current;
      const finish = addDays(start, 6);
      const key = `${granularity}|${toISODate(start)}|${toISODate(finish)}`;
      periods.push({
        key,
        label: `Неделя ${weekIndex} (${formatDate(start)} – ${formatDate(finish)})`,
        start,
        end: finish
      });
      current = addDays(current, 7);
      weekIndex += 1;
    }
    return periods;
  }
  if (granularity === "month") {
    for (let i = 0; i < 12; i += 1) {
      const start = startOfMonth(year, i);
      const finish = endOfMonth(year, i);
      const key = `${granularity}|${toISODate(start)}|${toISODate(finish)}`;
      periods.push({
        key,
        label: `${start.toLocaleDateString("ru-RU", {
          month: "long",
          year: "numeric"
        })}`,
        start,
        end: finish
      });
    }
    return periods;
  }
  if (granularity === "quarter") {
    for (let q = 0; q < 4; q += 1) {
      const start = startOfQuarter(year, q);
      const finish = endOfQuarter(year, q);
      const key = `${granularity}|${toISODate(start)}|${toISODate(finish)}`;
      periods.push({
        key,
        label: `${q + 1} квартал (${formatDate(start)} – ${formatDate(finish)})`,
        start,
        end: finish
      });
    }
    return periods;
  }
  const start = new Date(year, 0, 1);
  const finish = new Date(year, 11, 31);
  const key = `${granularity}|${toISODate(start)}|${toISODate(finish)}`;
  periods.push({ key, label: `${year}`, start, end: finish });
  return periods;
}

function renderCashflowPeriods() {
  if (!elements.cashflowPeriod) return;
  elements.cashflowPeriod.innerHTML = "";
  state.cashflow.periods.forEach((period) => {
    const option = document.createElement("option");
    option.value = period.key;
    option.textContent = period.label;
    elements.cashflowPeriod.appendChild(option);
  });
  if (!state.cashflow.selectedKey && state.cashflow.periods.length > 0) {
    state.cashflow.selectedKey = state.cashflow.periods[0].key;
  }
  elements.cashflowPeriod.value = state.cashflow.selectedKey;
  updateCashflowActions();
}

function renderCashflowTable() {
  if (!elements.cashflowBody) return;
  if (state.cashflow.periods.length === 0) {
    elements.cashflowBody.innerHTML = `
      <tr>
        <td colspan="2" class="muted">Нет данных для отображения.</td>
      </tr>
    `;
    return;
  }
  elements.cashflowBody.innerHTML = state.cashflow.periods
    .map((period) => {
      const entry = state.cashflow.entries[period.key];
      const margin = entry ? formatPercent(entry.marginBeforeTax) : "—";
      return `
        <tr>
          <td>${period.label}</td>
          <td>${margin}</td>
        </tr>
      `;
    })
    .join("");
}

function refreshCashflowView() {
  state.cashflow.periods = buildCashflowPeriods(
    state.cashflow.year,
    state.cashflow.granularity
  );
  if (
    !state.cashflow.periods.some((period) => period.key === state.cashflow.selectedKey)
  ) {
    state.cashflow.selectedKey = state.cashflow.periods[0]
      ? state.cashflow.periods[0].key
      : "";
  }
  renderCashflowPeriods();
  renderCashflowTable();
}

function updateCashflowSelection() {
  const key = elements.cashflowPeriod.value;
  state.cashflow.selectedKey = key;
  updateCashflowActions();
}

function openCashflowPeriod() {
  const period = state.cashflow.periods.find(
    (item) => item.key === state.cashflow.selectedKey
  );
  if (!period) {
    setCashflowStatus("Выберите период.", true);
    return;
  }
  elements.startDate.value = toISODate(period.start);
  elements.endDate.value = toISODate(period.end);
  onDateChange();
  setActiveTab("calc");
  setCashflowStatus(`Открыт период: ${period.label}.`);
}

async function loadCashflow(year) {
  if (!state.user) {
    state.cashflow.entries = {};
    renderCashflowTable();
    updateCashflowActions();
    return;
  }
  try {
    const ref = doc(db, "users", state.user.uid, "cashflow", String(year));
    const snapshot = await getDoc(ref);
    state.cashflow.entries = snapshot.exists() ? snapshot.data().entries || {} : {};
    renderCashflowTable();
    updateCashflowActions();
  } catch (error) {
    setCashflowStatus("Не удалось загрузить кэшфлоу.", true);
  }
}

async function saveCashflowPeriod() {
  if (!state.user) {
    setCashflowStatus("Нужно войти в аккаунт.", true);
    return;
  }
  const period = state.cashflow.periods.find(
    (item) => item.key === state.cashflow.selectedKey
  );
  if (!period) {
    setCashflowStatus("Выберите период.", true);
    return;
  }
  if (!state.lastSummary || !state.lastCalcRange) {
    setCashflowStatus("Сначала выполните расчет.", true);
    return;
  }
  const sameRange =
    toISODate(state.lastCalcRange.start) === toISODate(period.start) &&
    toISODate(state.lastCalcRange.end) === toISODate(period.end);
  if (!sameRange) {
    setCashflowStatus("Расчет выполнен для другого периода.", true);
    return;
  }
  state.cashflow.entries[period.key] = {
    marginBeforeTax: state.lastSummary.marginBeforeTax,
    updatedAt: new Date().toISOString()
  };
  try {
    const ref = doc(db, "users", state.user.uid, "cashflow", String(state.cashflow.year));
    await setDoc(ref, { entries: state.cashflow.entries }, { merge: true });
    renderCashflowTable();
    setCashflowStatus("Маржа сохранена.");
  } catch (error) {
    setCashflowStatus("Не удалось сохранить маржу.", true);
  }
  updateCashflowActions();
}

function buildSebesTemplateWorkbook() {
  const rows = [["Артикул", "Себестоимость"]];
  const sheet = XLSXLib.utils.aoa_to_sheet(rows);
  const workbook = XLSXLib.utils.book_new();
  XLSXLib.utils.book_append_sheet(workbook, sheet, "Себестоимость");
  return workbook;
}

function downloadSebesTemplate() {
  if (!XLSXLib) {
    setSebesStatus("Ошибка: библиотека XLSX не загрузилась.", true);
    return;
  }
  const workbook = buildSebesTemplateWorkbook();
  XLSXLib.writeFile(workbook, "sebes_template.xlsx");
  setSebesStatus("Шаблон скачан.");
}

function detectSebesHeader(row) {
  if (!row || row.length === 0) return null;
  const normalized = row.map(normalizeKey);
  const articleIndex = normalized.findIndex(
    (key) => key.includes("артикул") || key === "sku"
  );
  const costIndex = normalized.findIndex(
    (key) =>
      key.includes("себестоим") || key.includes("стоимость") || key.includes("cost")
  );
  if (articleIndex === -1 || costIndex === -1) return null;
  return { articleIndex, costIndex };
}

function extractSebesItemsFromWorkbook(workbook) {
  let bestItems = null;
  workbook.SheetNames.forEach((sheetName) => {
    const sheet = workbook.Sheets[sheetName];
    const rows = XLSXLib.utils.sheet_to_json(sheet, { header: 1, defval: "" });
    for (let i = 0; i < rows.length; i += 1) {
      const header = detectSebesHeader(rows[i]);
      if (!header) continue;
      const itemsMap = new Map();
      for (let j = i + 1; j < rows.length; j += 1) {
        const row = rows[j];
        if (!row || isRowEmpty(row)) continue;
        const article = String(row[header.articleIndex] || "").trim();
        if (!article) continue;
        const cost = parseOptionalNumber(row[header.costIndex]);
        itemsMap.set(article, cost);
      }
      const items = Array.from(itemsMap.entries()).map(([article, cost]) => ({
        article,
        cost
      }));
      if (!bestItems || items.length > bestItems.length) {
        bestItems = items;
      }
      break;
    }
  });
  if (!bestItems) {
    throw new Error("Не удалось найти заголовки Артикул и Себестоимость.");
  }
  return bestItems;
}

async function onSebesFileChange(event) {
  const file = event.target.files[0];
  if (!file) return;
  if (!state.user) {
    setSebesStatus("Нужно войти в аккаунт.", true);
    event.target.value = "";
    return;
  }
  try {
    const workbook = await readWorkbook(file);
    const items = extractSebesItemsFromWorkbook(workbook);
    state.sebes = items;
    renderSebesTable(items);
    markSebesDirty();
    setSebesStatus(
      `Загружено строк: ${items.length}. Проверьте и нажмите "Сохранить".`
    );
  } catch (error) {
    const message = error && error.message ? error.message : "Неизвестная ошибка";
    setSebesStatus(`Ошибка шаблона: ${message}`, true);
  } finally {
    event.target.value = "";
  }
}

function onSebesInputChange() {
  state.sebes = getSebesFromUI();
  markSebesDirty();
}

function onSebesRemoveRow(event) {
  const index = Number(event.currentTarget.dataset.remove || -1);
  if (Number.isNaN(index) || index < 0) return;
  const items = getSebesFromUI();
  items.splice(index, 1);
  state.sebes = items;
  renderSebesTable(items);
  markSebesDirty();
}

function calculate() {
  if (!state.startDate || !state.endDate || !state.accruals || !state.orders) {
    return;
  }
  if (state.startDate > state.endDate) {
    setStatus("Ошибка: дата начала больше даты окончания.", true);
    return;
  }

  const sebesMap = new Map(state.sebes.map((item) => [item.article, item.cost]));
  const missingCosts = new Set();

  const accrualsByArticle = new Map();
  const adsByArticle = new Map();
  const otherServicesTypeSet = new Set(state.otherServicesTypesSelected);
  const realizTypeSet = new Set(REALIZ_TYPES);

  let otherServicesTotal = 0;
  let realizTotal = 0;

  const pvpData = buildPvpSumByOrderArticle(state.pvp);
  const stencilData = buildStencilSumByDateName(state.stencils);
  const warnings = [pvpData.warning, stencilData.warning].filter(Boolean);
  if (warnings.length > 0) {
    setStatus(warnings.join(" "), true);
  }

  const orderStatusByOrder = new Map();
  const orderStatusByShipment = new Map();
  const orderCountByOrderArticle = new Map();
  const orderPromotionByShipmentArticle = new Map();
  const orderPromotionByOrderArticle = new Map();
  const ordersByArticle = new Map();

  for (const row of state.orders) {
    const orderNumber = row["Номер заказа"];
    const shipmentNumber = row["Номер отправления"];
    const article = row["Артикул"];
    const status = row["Статус"];
    const deliveryDateValue = getRowValue(row, [
      "Delivery date",
      "Дата доставки"
    ]);
    const deliveryDate = parseDateValue(deliveryDateValue);
    const qty = parseNumber(row["Количество"]);

    if (orderNumber && !orderStatusByOrder.has(orderNumber)) {
      orderStatusByOrder.set(orderNumber, status);
    }
    if (shipmentNumber && !orderStatusByShipment.has(shipmentNumber)) {
      orderStatusByShipment.set(shipmentNumber, status);
    }
    if (orderNumber && article) {
      const key = `${orderNumber}__${article}`;
      orderCountByOrderArticle.set(
        key,
        (orderCountByOrderArticle.get(key) || 0) + 1
      );
    }

    if (String(status || "").toLowerCase() === "доставлен") {
      if (inRange(deliveryDate, state.startDate, state.endDate) && article) {
        ordersByArticle.set(article, (ordersByArticle.get(article) || 0) + qty);
      }
    }
  }

  for (const row of state.orders) {
    const orderNumber = row["Номер заказа"];
    const shipmentNumber = row["Номер отправления"];
    const article = row["Артикул"];
    if (!orderNumber || !article) continue;
    const key = `${orderNumber}__${article}`;
    const totalPromotion = pvpData.sumByKey.get(key) || 0;
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
  for (const row of state.accruals) {
    const article = row["Артикул"];
    if (!article) continue;
    const dateValue = parseDateValue(
      row["Дата принятия заказа в обработку или оказания услуги"]
    );
    const key = `${article}__${dateKey(dateValue)}`;
    accrualCountByArticleDate.set(
      key,
      (accrualCountByArticleDate.get(key) || 0) + 1
    );
  }

  for (const row of state.accruals) {
    const orderOrShipmentId = row["ID начисления"];
    const articleRaw = row["Артикул"];
    const article =
      articleRaw === "" || articleRaw === null || articleRaw === undefined
        ? ""
        : String(articleRaw).trim();
    const type = row["Тип начисления"];
    const amount = parseNumber(row["Сумма итого, руб."]);

    const statusByOrder = String(orderStatusByOrder.get(orderOrShipmentId) || "");
    const statusByShipment = String(
      orderStatusByShipment.get(orderOrShipmentId) || ""
    );
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
    const dateValue = parseDateValue(
      row["Дата принятия заказа в обработку или оказания услуги"]
    );
    const name = row["Название товара"];
    const stencilKey = `${dateKey(dateValue)}__${String(name || "").trim()}`;
    const stencilSum = stencilData.sumByKey.get(stencilKey) || 0;
    const countKey = `${article}__${dateKey(dateValue)}`;
    const count = accrualCountByArticleDate.get(countKey) || 0;
    const stencilValue = count > 0 ? stencilSum / count : 0;
    const ads = pvpValue + stencilValue;

    if (statusScore === 1 && article) {
      accrualsByArticle.set(
        article,
        (accrualsByArticle.get(article) || 0) + amount
      );
      adsByArticle.set(article, (adsByArticle.get(article) || 0) + ads);
    }

    if (!article && otherServicesTypeSet.has(type)) {
      otherServicesTotal += amount;
    }

    if (realizTypeSet.has(type)) {
      realizTotal += amount;
    }
  }

  const articles = Array.from(
    new Set([
      ...ordersByArticle.keys(),
      ...accrualsByArticle.keys(),
      ...sebesMap.keys()
    ])
  ).sort();
  const articleCount = articles.length || 1;
  const otherPerArticle = otherServicesTotal / articleCount;

  const rows = articles.map((article) => {
    const hasCost = sebesMap.has(article) && Number.isFinite(sebesMap.get(article));
    const cost = hasCost ? sebesMap.get(article) : 0;
    if (!hasCost) {
      missingCosts.add(article);
    }
    const qty = ordersByArticle.get(article) || 0;
    const costSum = cost * qty;
    const accrual = accrualsByArticle.get(article) || 0;
    const ads = adsByArticle.get(article) || 0;
    const revenue = accrual - ads + otherPerArticle;
    const margin = revenue > 0 ? (revenue - costSum) / revenue : 0;
    return {
      article,
      cost,
      qty,
      costSum,
      otherPerArticle,
      accrual,
      ads,
      revenue,
      margin
    };
  });

  const totalCost = rows.reduce((sum, row) => sum + row.costSum, 0);
  const totalAccrual = rows.reduce((sum, row) => sum + row.accrual, 0);
  const totalAds = rows.reduce((sum, row) => sum + row.ads, 0);
  const revenueBeforeTax = totalAccrual + otherServicesTotal - totalAds;

  const tax9 = realizTotal * 0.09;
  const netWithTax9 = totalAccrual - tax9 + otherServicesTotal - totalAds;

  const tax5 = realizTotal * 0.05;
  const netWithTax5 = totalAccrual - tax5 + otherServicesTotal - totalAds;

  const marginBeforeTax =
    revenueBeforeTax > 0 ? (revenueBeforeTax - totalCost) / revenueBeforeTax : 0;
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
    marginAfterTax5
  };

  state.lastSummary = summary;
  state.lastCalcRange = { start: state.startDate, end: state.endDate };

  renderSummary(summary);

  renderTable(rows);
  updateCashflowActions();
  if (missingCosts.size > 0) {
    setMissingCostBlock(Array.from(missingCosts));
    setStatus("Расчет выполнен с предупреждениями.");
  } else {
    setMissingCostBlock([]);
    setStatus("Расчет выполнен.");
  }
}

function renderSummary(values) {
  elements.resultSummary.innerHTML = `
    <div class="row">
      <strong>Маржа до налогов</strong>
      <div>Выручка: ${formatNumber(values.revenueBeforeTax)}</div>
      <div>Себес: ${formatNumber(values.totalCost)}</div>
      <div>Прочие: ${formatNumber(values.otherServicesTotal)}</div>
      <div>Маржа: ${formatPercent(values.marginBeforeTax)}</div>
    </div>
    <div class="row">
      <strong>Сумма реализации с баллами (9%)</strong>
      <div>Реализация: ${formatNumber(values.realizTotal)}</div>
      <div>Налог 9%: ${formatNumber(values.tax9)}</div>
      <div>Чистая: ${formatNumber(values.netWithTax9)}</div>
      <div>Маржа: ${formatPercent(values.marginAfterTax9)}</div>
    </div>
    <div class="row">
      <strong>УСН15 (5%)</strong>
      <div>Реализация: ${formatNumber(values.realizTotal)}</div>
      <div>Налог 5%: ${formatNumber(values.tax5)}</div>
      <div>Чистая: ${formatNumber(values.netWithTax5)}</div>
      <div>Маржа: ${formatPercent(values.marginAfterTax5)}</div>
    </div>
  `;
}

function renderTable(rows) {
  elements.resultBody.innerHTML = rows
    .map(
      (row) => `
      <tr>
        <td>${row.article}</td>
        <td>${formatNumber(row.cost)}</td>
        <td>${formatInteger(row.qty)}</td>
        <td>${formatNumber(row.costSum)}</td>
        <td>${formatNumber(row.otherPerArticle)}</td>
        <td>${formatNumber(row.accrual)}</td>
        <td>${formatNumber(row.ads)}</td>
        <td>${formatNumber(row.revenue)}</td>
        <td>${formatPercent(row.margin)}</td>
      </tr>
    `
    )
    .join("");
}

function onDateChange() {
  const start = parseDateValue(elements.startDate.value);
  const end = parseDateValue(elements.endDate.value);
  state.startDate = start;
  state.endDate = end;
  updateDateHint();
  updateCalcAvailability();
  updateStatus();
}

function onFileChange(type, schema, fallback) {
  return async (event) => {
    const file = event.target.files[0];
    if (!file) return;
    try {
      const workbook = await readWorkbook(file);
      const headerStartIndex = type === "accruals" ? 1 : 0;
      const minStartRow = type === "accruals" ? 1 : 0;
      const data = extractRowsBySchemaOrPositions(
        workbook,
        normalizeSchema(schema),
        fallback,
        headerStartIndex,
        minStartRow
      );
      state[type] = data;
      if (type === "accruals") {
        const dates = data
          .map((row) =>
            parseDateValue(
              row["Дата принятия заказа в обработку или оказания услуги"]
            )
          )
          .filter(Boolean)
          .sort((a, b) => a - b);
        state.earliestAccrualDate = dates.length > 0 ? dates[0] : null;
        updateDateHint();
        updateOtherServicesTypes();
      }
      updateStatus();
    } catch (error) {
      setStatus(`Ошибка: ${error.message}`, true);
    }
  };
}

function onCalculateClick() {
  const missing = [];
  if (!state.startDate) missing.push("начало периода");
  if (!state.endDate) missing.push("конец периода");
  if (!state.accruals) missing.push("отчет Начисления");
  if (!state.orders) missing.push("отчет Заказы");
  if (missing.length > 0) {
    setStatus(`Не хватает данных: ${missing.join(", ")}.`, true);
    return;
  }
  if (!XLSXLib) {
    setStatus("Ошибка: библиотека XLSX не загрузилась.", true);
    setAuthStatus("Ошибка: библиотека XLSX не загрузилась.", true);
    return;
  }
  setStatus("Запускаю расчет…");
  try {
    calculate();
  } catch (error) {
    const message = error && error.message ? error.message : "Неизвестная ошибка";
    setStatus(`Ошибка расчета: ${message}`, true);
  }
}

function updateAuthUI(user) {
  if (elements.appContent) {
    elements.appContent.classList.toggle("hidden", !user);
    elements.appContent.style.display = user ? "block" : "none";
  }
  if (elements.authGate) {
    elements.authGate.classList.toggle("hidden", Boolean(user));
    elements.authGate.style.display = user ? "none" : "flex";
  }
  if (user) {
    window.focus();
  }
  if (elements.authState) {
    elements.authState.textContent = user ? user.email || "Вход выполнен" : "Гость";
  }
  if (elements.signInButton) {
    elements.signInButton.disabled = Boolean(user);
  }
  if (elements.signOutButton) {
    elements.signOutButton.disabled = !user;
  }
  updateSebesActions();
  updateCashflowActions();
}

async function loadUserSebes(user) {
  if (!user) {
    state.sebes = [];
    state.sebesDirty = false;
    renderSebesTable(state.sebes);
    updateSebesActions();
    setSebesStatus("Войдите, чтобы редактировать себестоимость.");
    return;
  }
  const ref = doc(db, "users", user.uid, "settings", "sebes");
  const snapshot = await getDoc(ref);
  const items = snapshot.exists() ? snapshot.data().items || [] : [];
  state.sebes = items.length > 0 ? items : [];
  state.sebesDirty = false;
  renderSebesTable(state.sebes);
  updateSebesActions();
  setSebesStatus(items.length > 0 ? "Данные загружены." : "Нет сохранённых данных.");
}

async function saveUserSebes() {
  if (!state.user) {
    setSebesStatus("Нужно войти в аккаунт.", true);
    return;
  }
  const items = getSebesFromUI();
  const ref = doc(db, "users", state.user.uid, "settings", "sebes");
  await setDoc(ref, { items, updatedAt: new Date().toISOString() });
  state.sebes = items;
  state.sebesDirty = false;
  updateSebesActions();
  setSebesStatus("Сохранено.");
}

function addSebesRow() {
  if (!state.user) return;
  const items = getSebesFromUI();
  items.push({ article: "", cost: "" });
  state.sebes = items;
  renderSebesTable(items);
  markSebesDirty();
}

async function init() {
  state.sebes = [];
  if (!validateElements()) {
    return;
  }

  if (!XLSXLib) {
    setStatus("Ошибка: библиотека XLSX не загрузилась.", true);
    return;
  }

  updateCalcAvailability();
  elements.startDate.addEventListener("change", onDateChange);
  elements.endDate.addEventListener("change", onDateChange);
  elements.calcButton.addEventListener("click", onCalculateClick);
  if (elements.addSebesRow) {
    elements.addSebesRow.addEventListener("click", addSebesRow);
  }
  if (elements.saveSebes) {
    elements.saveSebes.addEventListener("click", saveUserSebes);
  }
  if (elements.downloadSebesTemplate) {
    elements.downloadSebesTemplate.addEventListener("click", downloadSebesTemplate);
  }
  if (elements.sebesFile) {
    elements.sebesFile.addEventListener("change", onSebesFileChange);
  }
  if (elements.tabButtons.length > 0) {
    elements.tabButtons.forEach((button) => {
      button.addEventListener("click", () => setActiveTab(button.dataset.tab));
    });
    setActiveTab("calc");
  }

  if (elements.cashflowYear) {
    const currentYear = new Date().getFullYear();
    for (let year = currentYear - 3; year <= currentYear + 1; year += 1) {
      const option = document.createElement("option");
      option.value = String(year);
      option.textContent = String(year);
      if (year === state.cashflow.year) {
        option.selected = true;
      }
      elements.cashflowYear.appendChild(option);
    }
    elements.cashflowYear.addEventListener("change", async () => {
      state.cashflow.year = Number(elements.cashflowYear.value);
      refreshCashflowView();
      await loadCashflow(state.cashflow.year);
    });
  }
  if (elements.cashflowGranularity) {
    elements.cashflowGranularity.value = state.cashflow.granularity;
    elements.cashflowGranularity.addEventListener("change", () => {
      state.cashflow.granularity = elements.cashflowGranularity.value;
      refreshCashflowView();
    });
  }
  if (elements.cashflowPeriod) {
    elements.cashflowPeriod.addEventListener("change", updateCashflowSelection);
  }
  if (elements.cashflowOpenPeriod) {
    elements.cashflowOpenPeriod.addEventListener("click", openCashflowPeriod);
  }
  if (elements.cashflowSavePeriod) {
    elements.cashflowSavePeriod.addEventListener("click", saveCashflowPeriod);
  }

  renderSebesTable(state.sebes);
  updateSebesActions();
  refreshCashflowView();
  updateCashflowActions();

  const accrualsFallback = {
    startRow: 1,
    positions: {
      "ID начисления": 0,
      "Дата начисления": 1,
      "Группа услуг": 2,
      "Тип начисления": 3,
      "Артикул": 4,
      "SKU": 5,
      "Название товара": 6,
      "Количество": 7,
      "Цена продавца": 8,
      "Дата принятия заказа в обработку или оказания услуги": 9,
      "Платформа продажи": 10,
      "Схема работы": 11,
      "Вознаграждение Ozon, %": 12,
      "Индекс локализации, %": 13,
      "Среднее время доставки, часы": 14,
      "Сумма итого, руб.": 15
    }
  };
  const ordersFallback = {
    startRow: 1,
    positions: {
      "Номер заказа": 0,
      "Номер отправления": 1,
      "Статус": 4,
      "Дата доставки": 5,
      "Артикул": 11,
      "Количество": 16
    }
  };
  const pvpFallback = {
    startRow: 1,
    positions: {
      "Номер заказа": 2,
      "Артикул": 5,
      "Расход": 13
    }
  };
  const stencilsFallback = {
    startRow: 1,
    positions: {
      "Дата": 0,
      "Название товара": 2,
      "Расход": 9
    }
  };

  const attachFileHandler = (input, handler) => {
    input.addEventListener("change", handler);
    input.onchange = handler;
  };

  attachFileHandler(
    elements.accrualsFile,
    onFileChange("accruals", [
      { name: "ID начисления", keys: ["idначисления"], required: true },
      { name: "Дата начисления", keys: ["датаначисления"], required: true },
      {
        name: "Дата принятия заказа в обработку или оказания услуги",
        keys: ["датапринятиязаказавобработку", "датапринятиязаказа", "датапринятия"],
        required: true
      },
      { name: "Артикул", keys: ["артикул"], required: true },
      { name: "Тип начисления", keys: ["типначисления"], required: true },
      { name: "Название товара", keys: ["названиетовара", "наименованиетовара"], required: false },
      { name: "Сумма итого, руб.", keys: ["суммаитого", "суммаитогоруб"], required: true }
    ], accrualsFallback)
  );
  attachFileHandler(
    elements.ordersFile,
    onFileChange("orders", [
      { name: "Номер заказа", keys: ["номерзаказа"], required: true },
      { name: "Номер отправления", keys: ["номеротправления"], required: true },
      { name: "Статус", keys: ["статус"], required: true },
      { name: "Дата доставки", keys: ["датадоставки"], required: false },
      { name: "Delivery date", keys: ["deliverydate"], required: false },
      { name: "Артикул", keys: ["артикул"], required: true },
      { name: "Количество", keys: ["количество"], required: true }
    ], ordersFallback)
  );
  attachFileHandler(
    elements.pvpFile,
    onFileChange("pvp", [
      { name: "Номер заказа", keys: ["номерзаказа"], required: true },
      { name: "Артикул", keys: ["артикул"], required: true },
      { name: "Расход", keys: ["расход", "стоимость", "сумма"], required: true }
    ], pvpFallback)
  );
  attachFileHandler(
    elements.stencilsFile,
    onFileChange("stencils", [
      { name: "Дата", keys: ["дата"], required: true },
      { name: "Название товара", keys: ["названиетовара", "наименованиетовара"], required: true },
      { name: "Расход", keys: ["расход", "стоимость", "сумма"], required: true }
    ], stencilsFallback)
  );

  if (elements.signInButton) {
    elements.signInButton.addEventListener("click", async () => {
      const provider = new GoogleAuthProvider();
      try {
        setAuthStatus("Открываю окно входа…");
        const result = await signInWithPopup(auth, provider);
        state.user = result.user || null;
        updateAuthUI(state.user);
        await loadUserSebes(state.user);
        renderSebesTable(state.sebes);
        updateSebesActions();
        await loadCashflow(state.cashflow.year);
        renderCashflowTable();
        updateCashflowActions();
        setAuthStatus("");
      } catch (error) {
        const code = error && error.code ? String(error.code) : "";
        if (code === "auth/popup-blocked") {
          setAuthStatus("Разрешите всплывающие окна для входа.", true);
          return;
        }
        if (code === "auth/popup-closed-by-user") {
          setAuthStatus("Вход отменён пользователем.", true);
          return;
        }
        setAuthStatus(mapAuthError(error), true);
      }
    });
  }
  if (elements.signOutButton) {
    elements.signOutButton.addEventListener("click", async () => {
      try {
        await signOut(auth);
      } catch (error) {
        setSebesStatus("Ошибка выхода. Попробуйте снова.", true);
      }
    });
  }

  onAuthStateChanged(auth, async (user) => {
    state.user = user || null;
    updateAuthUI(state.user);
    if (state.user) {
      setAuthStatus("");
    }
    await loadUserSebes(state.user);
    renderSebesTable(state.sebes);
    updateSebesActions();
    await loadCashflow(state.cashflow.year);
    renderCashflowTable();
    updateCashflowActions();
  });

  setAuthStatus("Готово к входу.");
  window.__APP_READY = true;

}

try {
  init();
} catch (error) {
  setAuthStatus("Ошибка инициализации приложения.", true);
}
