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
      scheduleCashflowSave("Кэшфлоу сохранен.");
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
  if (elements.downloadReport) {
    elements.downloadReport.addEventListener("click", downloadReportExcel);
    updateDownloadAvailability();
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
      if (typeof input.showPicker !== "function") return;
      try {
        input.showPicker();
      } catch (error) {
        // Safari throws if it doesn't consider this a user gesture.
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
    setUploadUI(input, null);
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
      { name: "Группа услуг", keys: ["группауслуг", "группа"], required: false },
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
        const data = await authRequest("/auth/login", { email, password });
        await handleAuthSuccess(email, data.token);
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
  setupPasswordToggles();
  if (elements.emailAuth) {
    elements.emailAuth.addEventListener("input", updateSignInButtonState);
  }
  if (elements.passwordAuth) {
    elements.passwordAuth.addEventListener("input", updateSignInButtonState);
  }
  updateSignInButtonState();
  if (elements.signUpPassword) {
    elements.signUpPassword.addEventListener("input", updateSignUpPasswordMatch);
  }
  if (elements.signUpPasswordRepeat) {
    elements.signUpPasswordRepeat.addEventListener("input", updateSignUpPasswordMatch);
  }
  if (elements.signUpSubmit) {
    elements.signUpSubmit.addEventListener("click", async () => {
      const email = elements.signUpEmail ? elements.signUpEmail.value.trim() : "";
      const password = elements.signUpPassword ? elements.signUpPassword.value : "";
      const repeat = elements.signUpPasswordRepeat
        ? elements.signUpPasswordRepeat.value
        : "";
      if (!email || !password || !repeat) {
        setSignUpStatus("Введите email и дважды пароль.", true);
        return;
      }
      if (password.length < 6) {
        setSignUpStatus("Пароль должен быть не короче 6 символов.", true);
        return;
      }
      if (password !== repeat) {
        setSignUpStatus("Пароли не совпадают.", true);
        return;
      }
      try {
        setSignUpStatus("Создаю аккаунт…");
        const data = await authRequest("/auth/register", { email, password });
        const token = data && data.token ? data.token : "";
        if (token) {
          await handleAuthSuccess(email, token);
        } else {
          const loginData = await authRequest("/auth/login", { email, password });
          await handleAuthSuccess(email, loginData.token);
        }
        closeSignUpModal();
      } catch (error) {
        setSignUpStatus(mapAuthError(error), true);
      }
    });
  }
  if (elements.emailReset) {
    elements.emailReset.addEventListener("click", async () => {
      await requestPasswordReset();
    });
  }
  if (elements.signOutButton) {
    elements.signOutButton.addEventListener("click", async () => {
      clearAuthSession();
      updateAuthUI(null);
      await loadUserSebes(null);
      await loadUserCredits(null);
      renderSebesTable(state.sebes);
      updateSebesActions();
      await loadCashflow(state.cashflow.year);
      renderCashflowTable();
      updateCashflowActions();
    });
  }

  const hasSession = restoreAuthSession();
  updateAuthUI(state.user);
  if (hasSession) {
    await loadUserSebes(state.user);
    await loadUserCredits(state.user);
    renderSebesTable(state.sebes);
    updateSebesActions();
    await loadCashflow(state.cashflow.year);
    renderCashflowTable();
    updateCashflowActions();
    setAuthStatus("");
  } else {
    setAuthStatus("Готово к входу.");
  }
  window.__APP_READY = true;
}

try {
  init();
} catch (error) {
  setAuthStatus("Ошибка инициализации приложения.", true);
  window.__APP_READY = true;
}
