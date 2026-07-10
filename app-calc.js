async function calculateRemote() {
  const token = getStoredAuthToken();
  if (!token) {
    throw new Error("Нужно войти в аккаунт.");
  }
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
  state.accrualGroups = Array.isArray(data.accrualGroups) ? data.accrualGroups : [];
  state.lastSummary = summary;
  state.lastRows = rows;
  state.lastCalcRange = { start: state.startDate, end: state.endDate };
  renderSummary(summary);
  renderTable(rows);
  setMissingCostBlock(missingCosts);
  updateDownloadAvailability();
  setStatus("Расчет выполнен.");
  updateCashflowActions();
  const matchedPeriod = state.cashflow.periods.find(
    (period) =>
      toISODate(period.start) === toISODate(state.lastCalcRange.start) &&
      toISODate(period.end) === toISODate(state.lastCalcRange.end)
  );
  if (matchedPeriod) {
    state.cashflow.selectedKey = matchedPeriod.key;
    const stencilData = data.stencilData || {};
    // Разбиваем adsByArticle на stencil и pvp как plain-числа
    const stencilOnlyByArticle = {};
    const pvpOnlyByArticle = {};
    for (const [a, v] of Object.entries(stencilData.adsByArticle || {})) {
      stencilOnlyByArticle[a] = typeof v === "object" ? (v.stencil || 0) : (v || 0);
      pvpOnlyByArticle[a] = typeof v === "object" ? (v.pvp || 0) : 0;
    }
    setCashflowEntry(matchedPeriod.key, {
      marginBeforeTax: summary.marginBeforeTax,
      summary,
      stencilOrderCountsInPeriod: stencilData.orderCountsInPeriod || {},
      stencilAdsByArticle: stencilOnlyByArticle,
      pvpAdsByArticle: pvpOnlyByArticle
    });
  }

  // Применяем пересчитанные прошлые периоды (текущий пропускаем — у него только что сохранён свежий расчёт)
  const currentKey = matchedPeriod ? matchedPeriod.key : null;
  const updatedEntries = data.updatedCashflowEntries || {};
  for (const [key, entry] of Object.entries(updatedEntries)) {
    if (key === currentKey) continue;
    if (state.cashflow.entries[key]) {
      state.cashflow.entries[key] = {
        ...state.cashflow.entries[key],
        ...entry,
        updatedAt: new Date().toISOString()
      };
    }
  }

  if (matchedPeriod || Object.keys(updatedEntries).length > 0) {
    renderCashflowTable();
    updateCashflowActions();
    if (state.user) {
      scheduleCashflowSave();
    }
  }
}

async function initUserRemote() {
  if (!state.user) return null;
  const token = getStoredAuthToken();
  if (!token) return null;
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
  const token = getStoredAuthToken();
  if (!token) {
    setBuyCreditsStatus("Нужно войти в аккаунт.", true);
    return;
  }
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
    window.location.assign(url);
  } else {
    setBuyCreditsStatus("Не удалось получить ссылку оплаты.", true);
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
      <div>Сумма Отмен: ${formatNumber(values.totalCancelSum)}</div>
      <div>Маржа без отмен: ${formatPercent(values.summaryMarginWithoutCancel)}</div>
    </div>
  `;
}

function downloadReportExcel() {
  if (!XLSXLib) {
    setStatus("Ошибка: библиотека XLSX не загрузилась.", true);
    return;
  }
  if (!state.lastRows || state.lastRows.length === 0) {
    setStatus("Нет данных для выгрузки.", true);
    return;
  }
  const groups = Array.isArray(state.accrualGroups) ? state.accrualGroups : [];
  const otherGroups = groups.filter((group) => group !== "Продажи");
  const rows = state.lastRows.map((row) => {
    const accrualByGroup = row.accrualByGroup || {};
    const result = {
      "Артикул": row.article || "",
      "Себес": Number(row.cost || 0),
      "Кол-во доставлено": Number(row.qty || 0),
      "Продажи": Number(getSalesValue(accrualByGroup) || 0),
      "Сумма себестоимости": Number(row.costSum || 0),
      "Прочие услуги": Number(row.otherPerArticle || 0),
      "Реклама": Number(row.ads || 0),
      "Начисления": Number(row.accrual || 0),
      "Выручка": Number(row.revenue || 0),
      "Маржа": Number(row.margin || 0),
      "Сумма Отмен": Number(row.cancelSum || 0),
      "Маржа без отмен": Number(row.marginWithoutCancel || 0)
    };
    otherGroups.forEach((group) => {
      result[getGroupLabel(group)] = Number(accrualByGroup[group] || 0);
    });
    const ordered = { "Артикул": result["Артикул"] };
    ordered["Себес"] = result["Себес"];
    ordered["Кол-во доставлено"] = result["Кол-во доставлено"];
    ordered["Продажи"] = result["Продажи"];
    otherGroups.forEach((group) => {
      const label = getGroupLabel(group);
      ordered[label] = result[label];
    });
    ordered["Сумма себестоимости"] = result["Сумма себестоимости"];
    ordered["Прочие услуги"] = result["Прочие услуги"];
    ordered["Реклама"] = result["Реклама"];
    ordered["Начисления"] = result["Начисления"];
    ordered["Выручка"] = result["Выручка"];
    ordered["Маржа"] = result["Маржа"];
    ordered["Сумма Отмен"] = result["Сумма Отмен"];
    ordered["Маржа без отмен"] = result["Маржа без отмен"];
    return ordered;
  });

  const summaryRows = state.lastSummary
    ? [
        { "Показатель": "Выручка", "Значение": Number(state.lastSummary.revenueBeforeTax || 0) },
        { "Показатель": "Себес", "Значение": Number(state.lastSummary.totalCost || 0) },
        { "Показатель": "Прочие", "Значение": Number(state.lastSummary.otherServicesTotal || 0) },
        { "Показатель": "Маржа", "Значение": Number(state.lastSummary.marginBeforeTax || 0) },
        { "Показатель": "Сумма Отмен", "Значение": Number(state.lastSummary.totalCancelSum || 0) },
        { "Показатель": "Маржа без отмен", "Значение": Number(state.lastSummary.summaryMarginWithoutCancel || 0) }
      ]
    : [];

  const workbook = XLSXLib.utils.book_new();
  const sheetRows = XLSXLib.utils.json_to_sheet(rows);
  XLSXLib.utils.book_append_sheet(workbook, sheetRows, "Расчет");
  if (summaryRows.length > 0) {
    const sheetSummary = XLSXLib.utils.json_to_sheet(summaryRows);
    XLSXLib.utils.book_append_sheet(workbook, sheetSummary, "Сводка");
  }
  const filename = `margin-report-${toISODate(state.startDate)}-${toISODate(
    state.endDate
  )}.xlsx`;
  XLSXLib.writeFile(workbook, filename);
}

function renderTable(rows) {
  const groups = Array.isArray(state.accrualGroups) ? state.accrualGroups : [];
  const otherGroups = groups.filter((group) => group !== "Продажи");
  const head = elements.resultTable?.querySelector("thead");
  if (head) {
    const groupHeaders = otherGroups
      .map((group) => `<th>${getGroupLabel(group)}</th>`)
      .join("");
    head.innerHTML = `
      <tr>
        <th>Артикул</th>
        <th>Себес</th>
        <th>Кол-во доставлено</th>
        <th>Продажи</th>
        ${groupHeaders}
        <th>Сумма себестоимости</th>
        <th>Прочие услуги</th>
        <th>Реклама</th>
        <th>Начисления</th>
        <th>Выручка</th>
        <th>Маржа</th>
        <th>Сумма Отмен</th>
        <th>Маржа без отмен</th>
      </tr>
    `;
  }
  const columnCount = 12 + otherGroups.length;
  if (!rows || rows.length === 0) {
    elements.resultBody.innerHTML = `
      <tr>
        <td colspan="${columnCount}" class="muted">
          Нет данных для отображения.
        </td>
      </tr>
    `;
    return;
  }
  elements.resultBody.innerHTML = rows
    .map((row) => {
      const byGroup = row.accrualByGroup || {};
      const groupCells = otherGroups
        .map((group) => `<td>${formatNumber(byGroup[group] || 0)}</td>`)
        .join("");
      const salesValue = getSalesValue(byGroup);
      return `
        <tr>
          <td>${row.article}</td>
          <td>${formatNumber(row.cost)}</td>
          <td>${formatInteger(row.qty)}</td>
          <td>${formatNumber(salesValue)}</td>
          ${groupCells}
          <td>${formatNumber(row.costSum)}</td>
          <td>${formatNumber(row.otherPerArticle)}</td>
          <td>${formatNumber(row.ads)}</td>
          <td>${formatNumber(row.accrual)}</td>
          <td>${formatNumber(row.revenue)}</td>
          <td>${formatPercent(row.margin)}</td>
          <td>${formatNumber(row.cancelSum || 0)}</td>
          <td>${formatPercent(row.marginWithoutCancel || 0)}</td>
        </tr>
      `;
    })
    .join("");
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
  const missingSebes = getMissingSebesArticles();
  if (missingSebes.length > 0) {
    const preview = missingSebes.slice(0, 50).join(", ");
    const suffix = missingSebes.length > 50 ? " …" : "";
    setStatus(
      `Во вкладке "Себестоимость" не указаны данные для: ${preview}${suffix}. Расчет может быть неточным.`,
      true
    );
    const confirmText =
      "Во вкладке 'Себестоимость' нет данных по некоторым артикулам.\n" +
      `Артикулы: ${preview}${suffix}\n\n` +
      "Расчет может быть неточным. Продолжить расчет? (токен будет списан)";
    if (!window.confirm(confirmText)) {
      return;
    }
  }
  setStatus("Отправляю расчет…");
  calculateRemote().catch((error) => {
    const message = error && error.message ? error.message : "Неизвестная ошибка";
    setStatus(`Ошибка расчета: ${message}`, true);
  });
}
