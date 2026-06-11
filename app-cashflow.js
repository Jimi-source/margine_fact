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

async function persistCashflowEntries() {
  if (!state.user) return;
  await apiRequest("/cashflow", {
    method: "POST",
    body: {
      year: state.cashflow.year,
      entries: state.cashflow.entries,
      taxRate: state.cashflow.taxRate
    }
  });
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
    const data = await apiRequest(`/cashflow?year=${encodeURIComponent(year)}`);
    state.cashflow.entries = data.entries && typeof data.entries === "object" ? data.entries : {};
    if (Number.isFinite(data.taxRate)) {
      state.cashflow.taxRate = data.taxRate;
    }
    renderCashflowTable();
    updateCashflowActions();
    if (typeof renderMarginChart === "function") renderMarginChart();
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
