function setActiveTab(tabName) {
  elements.tabButtons.forEach((button) => {
    button.classList.toggle("active", button.dataset.tab === tabName);
  });
  elements.tabPanels.forEach((panel) => {
    const isActive = panel.dataset.panel === tabName;
    panel.classList.toggle("hidden", !isActive);
  });
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
    elements.dateHint.textContent = `Запросите отчеты Заказы/Оплата за заказ/Оплата за клик за период ${formatDate(
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
  if (!elements.downloadReport) missing.push("downloadReport");
  if (!elements.appContent) missing.push("appContent");
  if (!elements.authGate) missing.push("authGate");
  if (!elements.authState) missing.push("authState");
  if (!elements.creditsPanelValue) missing.push("creditsPanelValue");
  if (!elements.authStatus) missing.push("authStatus");
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
  if (!elements.signUpStatus) missing.push("signUpStatus");
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

function getUploadUI(input) {
  const wrapper = input?.closest?.(".upload-dropzone");
  if (!wrapper) return null;
  return {
    wrapper,
    info: wrapper.querySelector(".upload-file-info"),
    name: wrapper.querySelector(".file-name"),
    remove: wrapper.querySelector(".upload-remove"),
    hint: wrapper.querySelector(".upload-hint")
  };
}

function setUploadUI(input, file) {
  const ui = getUploadUI(input);
  if (!ui) return;
  if (file) {
    ui.wrapper.classList.add("has-file");
    if (ui.info) ui.info.classList.remove("hidden");
    if (ui.name) ui.name.textContent = file.name;
    if (ui.hint) ui.hint.classList.add("hidden");
    if (ui.remove) ui.remove.classList.remove("hidden");
  } else {
    ui.wrapper.classList.remove("has-file");
    if (ui.info) ui.info.classList.add("hidden");
    if (ui.name) ui.name.textContent = "Файл не выбран";
    if (ui.hint) {
      ui.hint.textContent = "Загрузите или перетяните отчет в это поле";
      ui.hint.classList.remove("hidden");
    }
    if (ui.remove) ui.remove.classList.add("hidden");
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
      const workbook = await readWorkbook(file, { bookFiles: type === "accruals" });
      const normalizedSchema = normalizeSchema(schema);
      let data = null;
      if (type === "accruals") {
        const rowsFromXml = buildRowsFromWorkbookFiles(workbook);
        if (rowsFromXml && rowsFromXml.length > 0) {
          const firstCell = String(rowsFromXml[0]?.[0] || "").toLowerCase();
          const skipFirstRow = firstCell.includes("период");
          data = extractRowsBySchemaOrPositionsFromRows(
            rowsFromXml,
            normalizedSchema,
            fallback,
            { skipFirstRow }
          );
        }
      }
      if (!data) {
        const options = {
          skipFirstRow: type === "accruals",
          normalizeCell: type === "accruals" ? fixCyrillicMojibake : null
        };
        data = extractRowsBySchemaOrPositions(workbook, normalizedSchema, fallback, options);
      }
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
