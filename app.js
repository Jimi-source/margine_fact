import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.5/firebase-app.js";
import {
  getAuth,
  GoogleAuthProvider,
  onAuthStateChanged,
  createUserWithEmailAndPassword,
  sendPasswordResetEmail,
  signInWithEmailAndPassword,
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
function reportInitError(message) {
  const el = document.getElementById("authStatus");
  if (!el) return;
  el.textContent = message;
  el.classList.add("error");
}
window.addEventListener("error", (event) => {
  window.__APP_READY = true;
  const message = event && event.message ? event.message : "Ошибка скрипта.";
  reportInitError(message);
});
window.addEventListener("unhandledrejection", (event) => {
  window.__APP_READY = true;
  const reason = event && event.reason ? String(event.reason) : "Ошибка промиса.";
  reportInitError(reason);
});

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
if (XLSXLib && window.cptable && typeof XLSXLib.set_cptable === "function") {
  XLSXLib.set_cptable(window.cptable);
}

const FUNCTIONS_BASE_URL = "https://us-central1-marginefact.cloudfunctions.net";

const SEBES = [];

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
  userCredits: null,
  userRole: null,
  showOtherServices: false,
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
    entries: {},
    saveTimer: null,
    taxRate: 6
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
  creditsPanelValue: document.getElementById("creditsPanelValue"),
  authStatus: document.getElementById("authStatus"),
  signInButton: document.getElementById("signInButton"),
  emailAuth: document.getElementById("emailAuth"),
  passwordAuth: document.getElementById("passwordAuth"),
  emailSignIn: document.getElementById("emailSignIn"),
  emailSignUp: document.getElementById("emailSignUp"),
  emailReset: document.getElementById("emailReset"),
  signUpModal: document.getElementById("signUpModal"),
  signUpClose: document.getElementById("signUpClose"),
  signUpEmail: document.getElementById("signUpEmail"),
  signUpPassword: document.getElementById("signUpPassword"),
  signUpPasswordRepeat: document.getElementById("signUpPasswordRepeat"),
  signUpSubmit: document.getElementById("signUpSubmit"),
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
  buyCreditsStatus: document.getElementById("buyCreditsStatus"),
  buyCreditsButtons: Array.from(document.querySelectorAll(".buy-credits-button")),
  cashflowYear: document.getElementById("cashflowYear"),
  cashflowGranularity: document.getElementById("cashflowGranularity"),
  cashflowTaxRate: document.getElementById("cashflowTaxRate"),
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

function setBuyCreditsStatus(message, isError = false) {
  if (!elements.buyCreditsStatus) return;
  elements.buyCreditsStatus.textContent = message;
  elements.buyCreditsStatus.classList.toggle("error", isError);
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
  let hasChanges = false;
  if (sameRange && state.lastSummary) {
    const entry = getCashflowEntry(state.cashflow.selectedKey);
    const existingMargin = Number.isFinite(entry.marginBeforeTax)
      ? entry.marginBeforeTax
      : null;
    hasChanges =
      existingMargin === null ||
      Math.abs(existingMargin - state.lastSummary.marginBeforeTax) > 0.0000001;
  }
  elements.cashflowSavePeriod.disabled =
    !state.user || !hasSelection || !hasSummary || !sameRange || !hasChanges;
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

function pickBestHeaderRow(rows, schema) {
  let best = { idx: -1, score: 0, missing: Infinity };
  for (let i = 0; i < rows.length; i += 1) {
    const { score, missing } = scoreHeaderRow(rows[i], schema);
    if (score > best.score || (score === best.score && missing < best.missing)) {
      best = { idx: i, score, missing };
    }
  }
  return best;
}

function findColumnIndexByKeys(normalizedHeaders, keys) {
  for (const key of keys) {
    const idx = normalizedHeaders.findIndex((cell) => cell.includes(key));
    if (idx >= 0) return idx;
  }
  return -1;
}

function extractRowsBySchemaFromSheet(sheet, schema) {
  const rows = XLSXLib.utils.sheet_to_json(sheet, {
    header: 1,
    defval: ""
  });
  const best = pickBestHeaderRow(rows, schema);
  if (best.idx === -1 || best.missing > 0) {
    return { data: null, headerIndex: -1, score: best.score, missing: best.missing };
  }
  const headerRow = rows[best.idx].map((value) => String(value || "").trim());
  const normalized = headerRow.map(normalizeKey);
  const columnMap = new Map();
  schema.forEach((item) => {
    const idx = findColumnIndexByKeys(normalized, item.keys);
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

function extractRowsBySchema(workbook, schema) {
  let bestResult = null;
  let bestSheet = null;
  workbook.SheetNames.forEach((sheetName) => {
    const sheet = workbook.Sheets[sheetName];
    const result = extractRowsBySchemaFromSheet(sheet, schema);
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

function extractRowsByPositionsFromSheet(sheet, schema, fallback) {
  const rows = XLSXLib.utils.sheet_to_json(sheet, {
    header: 1,
    defval: ""
  });
  let startRow = fallback.startRow || 1;
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

function extractRowsBySchemaOrPositions(workbook, schema, fallback) {
  try {
    return extractRowsBySchema(workbook, schema);
  } catch (error) {
    if (!fallback) throw error;
  }
  let bestData = null;
  let bestSheet = null;
  workbook.SheetNames.forEach((sheetName) => {
    const sheet = workbook.Sheets[sheetName];
    const data = extractRowsByPositionsFromSheet(sheet, schema, fallback);
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

function addDays(date, days) {
  const next = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  next.setDate(next.getDate() + days);
  return next;
}

function getWeekBounds(date) {
  const day = date.getDay();
  const diffToMonday = (day + 6) % 7;
  const start = addDays(date, -diffToMonday);
  const end = addDays(start, 6);
  return { start, end };
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
  const name = String(file && file.name ? file.name : "").toLowerCase();
  if (name.endsWith(".csv")) {
    const text = await file.text();
    const commaCount = (text.match(/,/g) || []).length;
    const semicolonCount = (text.match(/;/g) || []).length;
    const delimiter = semicolonCount > commaCount ? ";" : ",";
    return XLSXLib.read(text, {
      type: "string",
      FS: delimiter,
      raw: true,
      cellDates: true
    });
  }
  const buffer = await file.arrayBuffer();
  return XLSXLib.read(buffer, { type: "array", cellDates: true });
}

function removeFirstRowFromWorkbook(workbook) {
  if (!workbook || !workbook.SheetNames) return workbook;
  const nextWorkbook = XLSXLib.utils.book_new();
  workbook.SheetNames.forEach((sheetName) => {
    const sheet = workbook.Sheets[sheetName];
    if (!sheet) return;
    const ref = sheet["!ref"];
    if (!ref) return;
    const range = XLSXLib.utils.decode_range(ref);
    const removeRow = range.s.r;
    const nextSheet = {};
    Object.keys(sheet).forEach((key) => {
      if (key[0] === "!") return;
      const cell = XLSXLib.utils.decode_cell(key);
      if (cell.r === removeRow) return;
      const target = { c: cell.c, r: cell.r > removeRow ? cell.r - 1 : cell.r };
      const targetKey = XLSXLib.utils.encode_cell(target);
      nextSheet[targetKey] = sheet[key];
    });
    const nextRange = {
      s: { c: range.s.c, r: range.s.r },
      e: { c: range.e.c, r: Math.max(range.s.r, range.e.r - 1) }
    };
    nextSheet["!ref"] = XLSXLib.utils.encode_range(nextRange);
    if (sheet["!cols"]) nextSheet["!cols"] = sheet["!cols"];
    if (sheet["!rows"]) nextSheet["!rows"] = sheet["!rows"];
    if (sheet["!merges"]) {
      const merges = [];
      sheet["!merges"].forEach((merge) => {
        if (merge.s.r <= removeRow && merge.e.r >= removeRow) {
          return;
        }
        if (merge.s.r > removeRow) {
          merges.push({
            s: { c: merge.s.c, r: merge.s.r - 1 },
            e: { c: merge.e.c, r: merge.e.r - 1 }
          });
          return;
        }
        merges.push(merge);
      });
      if (merges.length > 0) nextSheet["!merges"] = merges;
    }
    XLSXLib.utils.book_append_sheet(nextWorkbook, nextSheet, sheetName);
  });
  return nextWorkbook;
}

function toISODate(date) {
  if (!date) return "";
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
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
  if (!elements.creditsPanelValue) missing.push("creditsPanelValue");
  if (!elements.authStatus) missing.push("authStatus");
  if (!elements.signInButton) missing.push("signInButton");
  if (!elements.emailAuth) missing.push("emailAuth");
  if (!elements.passwordAuth) missing.push("passwordAuth");
  if (!elements.emailSignIn) missing.push("emailSignIn");
  if (!elements.emailSignUp) missing.push("emailSignUp");
  if (!elements.emailReset) missing.push("emailReset");
  if (!elements.signUpModal) missing.push("signUpModal");
  if (!elements.signUpClose) missing.push("signUpClose");
  if (!elements.signUpEmail) missing.push("signUpEmail");
  if (!elements.signUpPassword) missing.push("signUpPassword");
  if (!elements.signUpPasswordRepeat) missing.push("signUpPasswordRepeat");
  if (!elements.signUpSubmit) missing.push("signUpSubmit");
  if (!elements.signOutButton) missing.push("signOutButton");
  if (!elements.sebesBody) missing.push("sebesBody");
  if (!elements.sebesStatus) missing.push("sebesStatus");
  if (!elements.addSebesRow) missing.push("addSebesRow");
  if (!elements.saveSebes) missing.push("saveSebes");
  if (!elements.sebesFile) missing.push("sebesFile");
  if (!elements.downloadSebesTemplate) missing.push("downloadSebesTemplate");
  if (!elements.otherServicesFilter) missing.push("otherServicesFilter");
  if (!elements.buyCreditsStatus) missing.push("buyCreditsStatus");
  if (!elements.cashflowYear) missing.push("cashflowYear");
  if (!elements.cashflowGranularity) missing.push("cashflowGranularity");
  if (!elements.cashflowTaxRate) missing.push("cashflowTaxRate");
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
    <td><input type="text" data-field="article" value="${item.article || ""}" ${disabled}></td>
    <td><input type="number" step="0.01" data-field="cost" value="${item.cost ?? ""}" ${disabled}></td>
    <td><button type="button" data-remove="${index}" ${disabled}>Удалить</button></td>
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
  const wrapper = elements.otherServicesFilter.closest(".other-services-filter");
  if (wrapper) {
    wrapper.classList.toggle("hidden", !state.showOtherServices);
  }
  if (!state.showOtherServices) {
    return;
  }
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
  const availableTypes = getAccrualTypeOptions().filter(
    (type) => !OTHER_SERVICES_EXCLUDED.has(type)
  );
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

function getCashflowEntry(key) {
  if (!key) return {};
  return state.cashflow.entries[key] || {};
}

function setCashflowEntry(key, updates) {
  if (!key) return;
  state.cashflow.entries[key] = {
    ...getCashflowEntry(key),
    ...updates,
    updatedAt: new Date().toISOString()
  };
}

function formatOptionalNumber(value) {
  return Number.isFinite(value) ? formatNumber(value) : "—";
}

function formatInputValue(value) {
  return Number.isFinite(value) ? formatNumber(value) : "";
}

async function persistCashflowEntries() {
  if (!state.user) return;
  const ref = doc(db, "users", state.user.uid, "cashflow", String(state.cashflow.year));
  await setDoc(ref, { entries: state.cashflow.entries }, { merge: true });
}

function scheduleCashflowSave(message) {
  if (!state.user) return;
  if (state.cashflow.saveTimer) {
    clearTimeout(state.cashflow.saveTimer);
  }
  state.cashflow.saveTimer = setTimeout(async () => {
    try {
      await persistCashflowEntries();
      if (message) {
        setCashflowStatus(message);
      }
    } catch (error) {
      setCashflowStatus("Не удалось сохранить кэшфлоу.", true);
    }
  }, 600);
}

function onCashflowEntryChange(event) {
  const target = event.target;
  if (!target || !target.dataset.cashflowField) return;
  const key = target.dataset.cashflowKey;
  const field = target.dataset.cashflowField;
  const value = parseOptionalNumber(target.value);
  setCashflowEntry(key, { [field]: value });
  renderCashflowTable();
  scheduleCashflowSave("Кэшфлоу сохранен.");
}

function onCashflowInputFocus(event) {
  const target = event.target;
  if (!target || !target.dataset.cashflowField) return;
  const key = target.dataset.cashflowKey;
  const field = target.dataset.cashflowField;
  const entry = getCashflowEntry(key);
  const rawValue = entry[field];
  if (Number.isFinite(rawValue)) {
    target.value = String(rawValue);
  } else {
    target.value = "";
  }
}

function onCashflowInputBlur(event) {
  const target = event.target;
  if (!target || !target.dataset.cashflowField) return;
  const value = parseOptionalNumber(target.value);
  target.value = formatInputValue(value);
}

function onCashflowPeriodClick(event) {
  const target = event.target;
  const key = target && target.dataset ? target.dataset.cashflowOpen : "";
  if (!key) return;
  state.cashflow.selectedKey = key;
  if (elements.cashflowPeriod) {
    elements.cashflowPeriod.value = key;
  }
  updateCashflowActions();
  openCashflowPeriod();
}

function renderCashflowTable() {
  if (!elements.cashflowBody) return;
  if (state.cashflow.periods.length === 0) {
    elements.cashflowBody.innerHTML = `
      <tr>
        <td colspan="12">Нет данных для отображения.</td>
      </tr>
    `;
    return;
  }
  const today = new Date();
  const currentWeek = getWeekBounds(today);
  let cumulativeProcurement = 0;
  let cumulativeTaxes = 0;
  let cumulativeMargin = 0;
  elements.cashflowBody.innerHTML = state.cashflow.periods
    .map((period) => {
      const entry = getCashflowEntry(period.key);
      const payoutDate = addDays(period.end, 24);
      const isPayoutWeek = inRange(payoutDate, currentWeek.start, currentWeek.end);
      const margin = Number.isFinite(entry.marginBeforeTax)
        ? formatPercent(entry.marginBeforeTax)
        : "—";
      const accruals = Number.isFinite(entry.accrualsManual) ? entry.accrualsManual : null;
      const marginForCalc = Number.isFinite(entry.marginBeforeTax)
        ? Math.round(entry.marginBeforeTax * 10000) / 10000
        : null;
      const procurementCalc =
        accruals !== null && marginForCalc !== null
          ? accruals * (1 - marginForCalc)
          : null;
      const taxRate = Number(state.cashflow.taxRate || 0) / 100;
      const taxesCalc = accruals !== null ? accruals * taxRate : null;
      const procurementActual = Number.isFinite(entry.procurementActual)
        ? entry.procurementActual
        : null;
      const taxesActual = Number.isFinite(entry.taxesActual) ? entry.taxesActual : null;
      const marginTotal =
        accruals !== null && procurementCalc !== null && taxesCalc !== null
          ? accruals - procurementCalc - taxesCalc
          : null;
      if (Number.isFinite(procurementCalc)) {
        cumulativeProcurement += procurementCalc;
      }
      if (Number.isFinite(procurementActual)) {
        cumulativeProcurement -= procurementActual;
      }
      if (Number.isFinite(taxesCalc)) {
        cumulativeTaxes += taxesCalc;
      }
      if (Number.isFinite(taxesActual)) {
        cumulativeTaxes -= taxesActual;
      }
      if (Number.isFinite(marginTotal)) {
        cumulativeMargin += marginTotal;
      }
      return `
        <tr class="${isPayoutWeek ? "cashflow-current" : ""}">
          <td>
            <button
              type="button"
              class="cashflow-period-link"
              data-cashflow-open="${period.key}"
            >
              ${period.label}
            </button>
          </td>
          <td>${formatDate(payoutDate)}</td>
          <td>${margin}</td>
          <td>
            <input
              class="cashflow-input"
              type="text"
              inputmode="decimal"
              data-cashflow-key="${period.key}"
              data-cashflow-field="accrualsManual"
              value="${formatInputValue(entry.accrualsManual)}"
              placeholder="0"
            />
          </td>
          <td>${formatOptionalNumber(procurementCalc)}</td>
          <td>${formatOptionalNumber(taxesCalc)}</td>
          <td>
            <input
              class="cashflow-input"
              type="text"
              inputmode="decimal"
              data-cashflow-key="${period.key}"
              data-cashflow-field="procurementActual"
              value="${formatInputValue(entry.procurementActual)}"
              placeholder="0"
            />
          </td>
          <td>
            <input
              class="cashflow-input"
              type="text"
              inputmode="decimal"
              data-cashflow-key="${period.key}"
              data-cashflow-field="taxesActual"
              value="${formatInputValue(entry.taxesActual)}"
              placeholder="0"
            />
          </td>
          <td>${formatOptionalNumber(cumulativeProcurement)}</td>
          <td>${formatOptionalNumber(cumulativeTaxes)}</td>
          <td>${formatOptionalNumber(marginTotal)}</td>
          <td>${formatOptionalNumber(cumulativeMargin)}</td>
        </tr>
      `;
    })
    .join("");
}

async function calculateRemote() {
  const token = await state.user.getIdToken();
  const payload = {
    startDate: toISODate(state.startDate),
    endDate: toISODate(state.endDate),
    accruals: state.accruals,
    orders: state.orders,
    pvp: state.pvp || [],
    stencils: state.stencils || [],
    sebes: state.sebes || [],
    otherServicesTypesSelected: Array.from(state.otherServicesTypesSelected)
  };
  const response = await fetch(`${FUNCTIONS_BASE_URL}/generateReport`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`
    },
    body: JSON.stringify(payload)
  });
  const data = await response.json();
  if (!response.ok || !data || !data.ok) {
    const errorMessage = data && data.error ? data.error : "Ошибка сервера.";
    setStatus(errorMessage, true);
    return;
  }
  state.showOtherServices = true;
  renderOtherServicesFilter();
  if (data.creditsLeft !== undefined) {
    state.userCredits = Number(data.creditsLeft);
    updateAuthUI(state.user);
  }
  const summary = data.summary;
  const rows = data.rows || [];
  const missingCosts = data.missingCosts || [];
  state.lastSummary = summary;
  state.lastCalcRange = { start: state.startDate, end: state.endDate };
  renderSummary(summary);
  renderTable(rows);
  setMissingCostBlock(missingCosts);
  setStatus("Расчет выполнен.");
  updateCashflowActions();
  const matchedPeriod = state.cashflow.periods.find(
    (period) =>
      toISODate(period.start) === toISODate(state.lastCalcRange.start) &&
      toISODate(period.end) === toISODate(state.lastCalcRange.end)
  );
  if (matchedPeriod) {
    state.cashflow.selectedKey = matchedPeriod.key;
    setCashflowEntry(matchedPeriod.key, {
      marginBeforeTax: summary.marginBeforeTax,
      summary
    });
    renderCashflowTable();
    updateCashflowActions();
    if (state.user) {
      scheduleCashflowSave();
    }
  }
}

async function initUserRemote() {
  if (!state.user) return null;
  const token = await state.user.getIdToken();
  const response = await fetch(`${FUNCTIONS_BASE_URL}/initUser`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`
    },
    body: JSON.stringify({})
  });
  const data = await response.json();
  if (!response.ok || !data || !data.ok) {
    const errorMessage = data && data.error ? data.error : "Ошибка сервера.";
    throw new Error(errorMessage);
  }
  return { credits: data.credits, role: data.role };
}

async function createPaymentRemote(packId) {
  if (!state.user) {
    setBuyCreditsStatus("Нужно войти в аккаунт.", true);
    return;
  }
  setBuyCreditsStatus("Перенаправляю на оплату…");
  const token = await state.user.getIdToken();
  const response = await fetch(`${FUNCTIONS_BASE_URL}/createPayment`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`
    },
    body: JSON.stringify({ packId })
  });
  const data = await response.json();
  if (!response.ok || !data || !data.ok) {
    const errorMessage = data && data.error ? data.error : "Ошибка оплаты.";
    setBuyCreditsStatus(errorMessage, true);
    return;
  }
  const url = data.confirmationUrl;
  if (url) {
    window.open(url, "_blank", "noopener,noreferrer");
  } else {
    setBuyCreditsStatus("Не удалось получить ссылку оплаты.", true);
  }
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
  const entry = getCashflowEntry(period.key);
  if (entry && entry.summary) {
    state.lastSummary = entry.summary;
    state.lastCalcRange = { start: period.start, end: period.end };
    renderSummary(entry.summary);
    setCashflowStatus(`Открыт период: ${period.label}. Показан последний расчет.`);
  } else {
    setCashflowStatus(`Открыт период: ${period.label}.`);
  }
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
  setCashflowEntry(period.key, {
    marginBeforeTax: state.lastSummary.marginBeforeTax
  });
  try {
    await persistCashflowEntries();
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

function renderSummary(values) {
  elements.resultSummary.innerHTML = `
    <div class="row">
      <strong>Маржа до налогов</strong>
      <div>Выручка: ${formatNumber(values.revenueBeforeTax)}</div>
      <div>Себес: ${formatNumber(values.totalCost)}</div>
      <div>Прочие: ${formatNumber(values.otherServicesTotal)}</div>
      <div>Маржа: ${formatPercent(values.marginBeforeTax)}</div>
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
        <td>${formatNumber(row.ads)}</td>
        <td>${formatNumber(row.accrual)}</td>
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

function getUploadUI(input) {
  const wrapper = input?.closest?.(".upload-dropzone");
  if (!wrapper) return null;
  return {
    wrapper,
    info: wrapper.querySelector(".upload-file-info"),
    name: wrapper.querySelector(".file-name"),
    remove: wrapper.querySelector(".upload-remove")
  };
}

function setUploadUI(input, file) {
  const ui = getUploadUI(input);
  if (!ui) return;
  if (file) {
    ui.wrapper.classList.add("has-file");
    if (ui.info) ui.info.classList.remove("hidden");
    if (ui.name) ui.name.textContent = file.name;
  } else {
    ui.wrapper.classList.remove("has-file");
    if (ui.info) ui.info.classList.add("hidden");
    if (ui.name) ui.name.textContent = "Файл не выбран";
  }
}

function clearFileState(type) {
  state[type] = null;
  if (type === "accruals") {
    state.earliestAccrualDate = null;
    state.otherServicesTypes = [];
    state.otherServicesTypesSelected = new Set();
    state.showOtherServices = false;
    updateOtherServicesTypes();
    renderOtherServicesFilter();
    updateDateHint();
  }
  updateCalcAvailability();
  updateStatus();
}

function onFileChange(type, schema, fallback) {
  return async (event) => {
    const file = event.target.files[0];
    if (!file) return;
    try {
      let workbook = await readWorkbook(file);
      if (type === "accruals") {
        workbook = removeFirstRowFromWorkbook(workbook);
      }
      const data = extractRowsBySchemaOrPositions(
        workbook,
        normalizeSchema(schema),
        fallback
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
      if (type === "accruals") {
        state.showOtherServices = false;
        renderOtherServicesFilter();
      }
      setUploadUI(event.target, file);
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
  if (!state.user) {
    setStatus("Нужно войти в аккаунт.", true);
    return;
  }
  setStatus("Отправляю расчет…");
  calculateRemote().catch((error) => {
    const message = error && error.message ? error.message : "Неизвестная ошибка";
    setStatus(`Ошибка расчета: ${message}`, true);
  });
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
  if (elements.creditsPanelValue) {
    const value =
      user && Number.isFinite(state.userCredits) ? formatInteger(state.userCredits) : "—";
    elements.creditsPanelValue.textContent = value;
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

function updateOwnerUI() {
  const isOwner = state.userRole === "owner";
  elements.tabButtons.forEach((button) => {
    if (button.dataset.tab === "cashflow") {
      button.classList.toggle("hidden", !isOwner);
    }
  });
  elements.tabPanels.forEach((panel) => {
    if (panel.dataset.panel === "cashflow") {
      if (!isOwner) {
        panel.classList.add("hidden");
      }
    }
  });
  if (elements.cashflowSavePeriod) {
    elements.cashflowSavePeriod.classList.toggle("hidden", !isOwner);
  }
  if (!isOwner) {
    setActiveTab("calc");
  }
}

function openSignUpModal() {
  if (!elements.signUpModal) return;
  elements.signUpModal.classList.remove("hidden");
  elements.signUpModal.setAttribute("aria-hidden", "false");
}

function closeSignUpModal() {
  if (!elements.signUpModal) return;
  elements.signUpModal.classList.add("hidden");
  elements.signUpModal.setAttribute("aria-hidden", "true");
  if (elements.signUpEmail) elements.signUpEmail.value = "";
  if (elements.signUpPassword) elements.signUpPassword.value = "";
  if (elements.signUpPasswordRepeat) elements.signUpPasswordRepeat.value = "";
}

async function loadUserCredits(user) {
  if (!user) {
    state.userCredits = null;
    state.userRole = null;
    updateAuthUI(null);
    return;
  }
  try {
    const result = await initUserRemote();
    const credits = result ? Number(result.credits || 0) : 0;
    state.userCredits = Number.isFinite(credits) ? credits : 0;
    state.userRole = result && result.role ? String(result.role) : null;
  } catch (error) {
    const ref = doc(db, "users", user.uid);
    const snapshot = await getDoc(ref);
    const data = snapshot.exists() ? snapshot.data() || {} : {};
    const credits = Number(data.credits || 0);
    state.userCredits = Number.isFinite(credits) ? credits : 0;
    state.userRole = data.role ? String(data.role) : null;
  }
  updateOwnerUI();
  updateAuthUI(user);
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
    window.__APP_READY = true;
    return;
  }

  updateCalcAvailability();
  elements.startDate.addEventListener("change", onDateChange);
  elements.endDate.addEventListener("change", onDateChange);
  elements.calcButton.addEventListener("click", onCalculateClick);
  if (elements.buyCreditsButtons.length > 0) {
    elements.buyCreditsButtons.forEach((button) => {
      button.addEventListener("click", () => {
        const packId = Number(button.dataset.pack || 0);
        if (!packId) {
          setBuyCreditsStatus("Некорректный пакет.", true);
          return;
        }
        createPaymentRemote(packId).catch((error) => {
          const message =
            error && error.message ? error.message : "Ошибка оплаты.";
          setBuyCreditsStatus(message, true);
        });
      });
    });
  }
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
  if (elements.cashflowTaxRate) {
    elements.cashflowTaxRate.value = String(state.cashflow.taxRate);
    elements.cashflowTaxRate.addEventListener("change", () => {
      const value = parseNumber(elements.cashflowTaxRate.value);
      state.cashflow.taxRate = Number.isFinite(value) ? value : 0;
      renderCashflowTable();
    });
  }
  if (elements.cashflowSavePeriod) {
    elements.cashflowSavePeriod.addEventListener("click", saveCashflowPeriod);
  }
  if (elements.cashflowBody) {
    elements.cashflowBody.addEventListener("change", onCashflowEntryChange);
    elements.cashflowBody.addEventListener("focusin", onCashflowInputFocus);
    elements.cashflowBody.addEventListener("focusout", onCashflowInputBlur);
    elements.cashflowBody.addEventListener("click", onCashflowPeriodClick);
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
      "Сумма итого, руб.": 15,
      "Статус": 18
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
      "Количество": 16,
      "Продвижение": 38
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

  const setupDatePicker = (input) => {
    if (!input) return;
    const showPicker = () => {
      if (typeof input.showPicker === "function") {
        input.showPicker();
      }
    };
    input.addEventListener("click", showPicker);
    input.addEventListener("pointerdown", showPicker);
  };

  const setupDropzone = (input) => {
    if (!input) return;
    const wrapper = input.closest(".upload-dropzone");
    if (!wrapper) return;

    const highlight = (event) => {
      event.preventDefault();
      wrapper.classList.add("is-dragover");
    };
    const unhighlight = (event) => {
      event.preventDefault();
      wrapper.classList.remove("is-dragover");
    };
    const handleDrop = (event) => {
      event.preventDefault();
      wrapper.classList.remove("is-dragover");
      const files = event.dataTransfer?.files;
      if (!files || files.length === 0) return;
      const dataTransfer = new DataTransfer();
      Array.from(files).forEach((file) => dataTransfer.items.add(file));
      input.files = dataTransfer.files;
      input.dispatchEvent(new Event("change", { bubbles: true }));
    };

    wrapper.addEventListener("dragenter", highlight);
    wrapper.addEventListener("dragover", highlight);
    wrapper.addEventListener("dragleave", unhighlight);
    wrapper.addEventListener("drop", handleDrop);
  };

  const setupUploadUI = (input, type) => {
    if (!input) return;
    const ui = getUploadUI(input);
    if (!ui || !ui.remove) return;
    ui.remove.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      input.value = "";
      setUploadUI(input, null);
      clearFileState(type);
    });
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
      { name: "Сумма итого, руб.", keys: ["суммаитого", "суммаитогоруб"], required: true },
      { name: "Реклама", keys: ["реклама"], required: false },
      { name: "Статус", keys: ["статус"], required: false }
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
      { name: "Количество", keys: ["количество"], required: true },
      { name: "Продвижение", keys: ["продвижение", "promotion"], required: false }
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

  setupDatePicker(elements.startDate);
  setupDatePicker(elements.endDate);
  setupDropzone(elements.accrualsFile);
  setupDropzone(elements.ordersFile);
  setupDropzone(elements.pvpFile);
  setupDropzone(elements.stencilsFile);
  setupUploadUI(elements.accrualsFile, "accruals");
  setupUploadUI(elements.ordersFile, "orders");
  setupUploadUI(elements.pvpFile, "pvp");
  setupUploadUI(elements.stencilsFile, "stencils");

  if (elements.signInButton) {
    elements.signInButton.addEventListener("click", async () => {
      const provider = new GoogleAuthProvider();
      try {
        setAuthStatus("Открываю окно входа…");
        const result = await signInWithPopup(auth, provider);
        state.user = result.user || null;
        updateAuthUI(state.user);
        await loadUserSebes(state.user);
        await loadUserCredits(state.user);
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
  if (elements.emailSignIn) {
    elements.emailSignIn.addEventListener("click", async () => {
      const email = elements.emailAuth ? elements.emailAuth.value.trim() : "";
      const password = elements.passwordAuth ? elements.passwordAuth.value : "";
      if (!email || !password) {
        setAuthStatus("Введите email и пароль.", true);
        return;
      }
      try {
        setAuthStatus("Выполняю вход…");
        await signInWithEmailAndPassword(auth, email, password);
        setAuthStatus("");
      } catch (error) {
        setAuthStatus(mapAuthError(error), true);
      }
    });
  }
  if (elements.emailSignUp) {
    elements.emailSignUp.addEventListener("click", async () => {
      openSignUpModal();
    });
  }
  if (elements.signUpClose) {
    elements.signUpClose.addEventListener("click", closeSignUpModal);
  }
  if (elements.signUpModal) {
    elements.signUpModal.addEventListener("click", (event) => {
      const target = event.target;
      if (target && target.dataset && target.dataset.modalClose) {
        closeSignUpModal();
      }
    });
  }
  if (elements.signUpSubmit) {
    elements.signUpSubmit.addEventListener("click", async () => {
      const email = elements.signUpEmail ? elements.signUpEmail.value.trim() : "";
      const password = elements.signUpPassword ? elements.signUpPassword.value : "";
      const repeat = elements.signUpPasswordRepeat
        ? elements.signUpPasswordRepeat.value
        : "";
      if (!email || !password || !repeat) {
        setAuthStatus("Введите email и дважды пароль.", true);
        return;
      }
      if (password.length < 6) {
        setAuthStatus("Пароль должен быть не короче 6 символов.", true);
        return;
      }
      if (password !== repeat) {
        setAuthStatus("Пароли не совпадают.", true);
        return;
      }
      try {
        setAuthStatus("Создаю аккаунт…");
        await createUserWithEmailAndPassword(auth, email, password);
        setAuthStatus("");
        closeSignUpModal();
      } catch (error) {
        setAuthStatus(mapAuthError(error), true);
      }
    });
  }
  if (elements.emailReset) {
    elements.emailReset.addEventListener("click", async () => {
      const email = elements.emailAuth ? elements.emailAuth.value.trim() : "";
      if (!email) {
        setAuthStatus("Введите email для восстановления.", true);
        return;
      }
      try {
        setAuthStatus("Отправляю письмо для восстановления…");
        await sendPasswordResetEmail(auth, email);
        setAuthStatus("Письмо для восстановления отправлено.");
      } catch (error) {
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
    await loadUserCredits(state.user);
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
  window.__APP_READY = true;
}
