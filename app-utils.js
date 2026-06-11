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

const GROUP_LABELS = {
  "Возвраты": "Возвраты",
  "Вознаграждение Ozon": "Вознаграждение Ozon",
  "Продажи": "Продажи",
  "Продвижение и реклама": "Продвижение и реклама",
  "Услуги агентов": "Услуги агентов",
  "Услуги доставки": "Услуги доставки"
};

function getGroupLabel(group) {
  return GROUP_LABELS[group] || `Начисления — ${group}`;
}

function getSalesValue(byGroup) {
  return Number(byGroup && byGroup["Продажи"] ? byGroup["Продажи"] : 0);
}

function normalizeArticle(value) {
  return String(value || "").trim();
}

function normalizeEmail(value) {
  return String(value || "").trim().toLowerCase();
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

function formatNumber(value) {
  return numberFormatter.format(value);
}

function formatInteger(value) {
  return integerFormatter.format(value);
}

function formatPercent(value) {
  return percentFormatter.format(value);
}

function formatOptionalNumber(value) {
  return Number.isFinite(value) ? formatNumber(value) : "—";
}

function formatInputValue(value) {
  return Number.isFinite(value) ? formatNumber(value) : "";
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

function setSignUpStatus(message, isError = false) {
  if (!elements.signUpStatus) return;
  elements.signUpStatus.textContent = message;
  elements.signUpStatus.classList.toggle("error", isError);
}

function updateDownloadAvailability() {
  if (!elements.downloadReport) return;
  elements.downloadReport.disabled = !(state.lastRows && state.lastRows.length > 0);
}

function getStoredAuthToken() {
  return state.authToken || localStorage.getItem(STORAGE_KEYS.authToken) || "";
}

function storeAuthSession(email, token) {
  const normalizedEmail = normalizeEmail(email);
  state.user = normalizedEmail ? { email: normalizedEmail } : null;
  state.authToken = token || "";
  if (normalizedEmail) {
    localStorage.setItem(STORAGE_KEYS.authEmail, normalizedEmail);
  }
  if (token) {
    localStorage.setItem(STORAGE_KEYS.authToken, token);
  }
}

function clearAuthSession() {
  state.user = null;
  state.authToken = "";
  localStorage.removeItem(STORAGE_KEYS.authEmail);
  localStorage.removeItem(STORAGE_KEYS.authToken);
}

function restoreAuthSession() {
  const email = normalizeEmail(localStorage.getItem(STORAGE_KEYS.authEmail));
  const token = localStorage.getItem(STORAGE_KEYS.authToken) || "";
  if (!email || !token) {
    clearAuthSession();
    return false;
  }
  state.user = { email };
  state.authToken = token;
  return true;
}

function getUserStorageKey(prefix) {
  const email = state.user && state.user.email ? normalizeEmail(state.user.email) : "";
  if (!email) return `${prefix}_guest`;
  return `${prefix}_${encodeURIComponent(email)}`;
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
  const message = error && error.message ? String(error.message) : "";
  if (!message) return "Не удалось выполнить вход. Попробуйте ещё раз.";
  if (message.toLowerCase().includes("invalid")) {
    return "Некорректные данные входа. Попробуйте ещё раз.";
  }
  return `Не удалось выполнить вход. (${message})`;
}

async function apiRequest(path, { method = "GET", body } = {}) {
  const token = getStoredAuthToken();
  if (!token) {
    throw new Error("Нужно войти в аккаунт.");
  }
  const headers = { Authorization: `Bearer ${token}` };
  if (body !== undefined) {
    headers["Content-Type"] = "application/json";
  }
  const response = await fetch(`${FUNCTIONS_BASE_URL}${path}`, {
    method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined
  });
  const data = await response.json();
  if (!response.ok || !data || !data.ok) {
    const errorMessage = data && data.error ? data.error : "Ошибка сервера.";
    throw new Error(errorMessage);
  }
  return data;
}
