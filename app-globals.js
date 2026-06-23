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

const STORAGE_KEYS = {
  authToken: "mf_auth_token",
  authEmail: "mf_auth_email",
  sebes: "mf_sebes",
  cashflow: "mf_cashflow"
};

const XLSXLib = window.XLSX;
if (XLSXLib && window.cptable && typeof XLSXLib.set_cptable === "function") {
  XLSXLib.set_cptable(window.cptable);
}

const FUNCTIONS_BASE_URL = "https://6289319-cz09105.twc1.net";

const SEBES = [];

const OTHER_SERVICES_EXCLUDED = new Set([
  "Продвижение в поиске",
  "Трафареты",
  "Продвижение с оплатой за заказ",
  "Оплата за клик"
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
  authToken: "",
  userCredits: null,
  userRole: null,
  showOtherServices: false,
  sebesDirty: false,
  otherServicesTypes: [],
  otherServicesTypesSelected: new Set(),
  accrualGroups: [],
  lastSummary: null,
  lastCalcRange: null,
  lastRows: [],
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
  downloadReport: document.getElementById("downloadReport"),
  resultTable: document.getElementById("resultTable"),
  resultBody: document.getElementById("resultBody"),
  missingCostBlock: document.getElementById("missingCostBlock"),
  appContent: document.getElementById("appContent"),
  authGate: document.getElementById("authGate"),
  authState: document.getElementById("authState"),
  creditsPanelValue: document.getElementById("creditsPanelValue"),
  authStatus: document.getElementById("authStatus"),
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
  signUpStatus: document.getElementById("signUpStatus"),
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
