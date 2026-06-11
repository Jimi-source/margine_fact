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
  setSignUpStatus("");
}

function updateSignUpPasswordMatch() {
  const password = elements.signUpPassword ? elements.signUpPassword.value : "";
  const repeat = elements.signUpPasswordRepeat ? elements.signUpPasswordRepeat.value : "";
  if (!repeat) return;
  if (password !== repeat) {
    setSignUpStatus("Пароли не совпадают.", true);
    return;
  }
  if (elements.signUpStatus && elements.signUpStatus.textContent === "Пароли не совпадают.") {
    setSignUpStatus("");
  }
}

function setupPasswordToggles() {
  const toggles = Array.from(document.querySelectorAll("[data-toggle-password]"));
  toggles.forEach((toggle) => {
    const targetId = toggle.getAttribute("data-toggle-password");
    const input = targetId ? document.getElementById(targetId) : null;
    if (!input) return;
    toggle.addEventListener("click", () => {
      const isPassword = input.type === "password";
      input.type = isPassword ? "text" : "password";
      toggle.textContent = isPassword ? "Скрыть" : "Показать";
      toggle.setAttribute("aria-pressed", String(isPassword));
    });
  });
}

async function requestPasswordReset() {
  const email = elements.emailAuth ? elements.emailAuth.value.trim() : "";
  if (!email) {
    setAuthStatus("Введите email для восстановления.", true);
    return;
  }
  try {
    setAuthStatus("Создаю код восстановления…");
    await authRequest("/auth/reset", { email });
    const code = window.prompt(
      "Введите код восстановления (получите у администратора https://t.me/prudnikovegor):"
    );
    if (!code) {
      setAuthStatus("Восстановление отменено.", true);
      return;
    }
    const newPassword = window.prompt("Введите новый пароль (минимум 6 символов):");
    if (!newPassword || newPassword.length < 6) {
      setAuthStatus("Пароль должен быть не короче 6 символов.", true);
      return;
    }
    const repeat = window.prompt("Повторите новый пароль:");
    if (newPassword !== repeat) {
      setAuthStatus("Пароли не совпадают.", true);
      return;
    }
    await authRequest("/auth/reset/confirm", {
      email,
      code: String(code).trim(),
      password: newPassword
    });
    setAuthStatus("Пароль изменен. Теперь можно войти.");
  } catch (error) {
    setAuthStatus(mapAuthError(error), true);
  }
}

function updateSignInButtonState() {
  if (!elements.emailSignIn) return;
  const email = elements.emailAuth ? elements.emailAuth.value.trim() : "";
  const password = elements.passwordAuth ? elements.passwordAuth.value : "";
  const ready = Boolean(email && password);
  elements.emailSignIn.disabled = !ready;
  elements.emailSignIn.classList.toggle("auth-signin-active", ready);
}

async function authRequest(path, payload) {
  const response = await fetch(`${FUNCTIONS_BASE_URL}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload || {})
  });
  const data = await response.json();
  if (!response.ok || !data || !data.ok) {
    const errorMessage = data && data.error ? data.error : "Ошибка сервера.";
    throw new Error(errorMessage);
  }
  return data;
}

async function handleAuthSuccess(email, token) {
  storeAuthSession(email, token);
  updateAuthUI(state.user);
  await loadUserSebes(state.user);
  await loadUserCredits(state.user);
  renderSebesTable(state.sebes);
  updateSebesActions();
  await loadCashflow(state.cashflow.year);
  renderCashflowTable();
  updateCashflowActions();
  setAuthStatus("");
}

async function loadUserCredits(user) {
  if (!user) {
    state.userCredits = null;
    state.userRole = null;
    state.lastRows = [];
    updateDownloadAvailability();
    updateAuthUI(null);
    return;
  }
  try {
    const result = await initUserRemote();
    const credits = result ? Number(result.credits || 0) : 0;
    state.userCredits = Number.isFinite(credits) ? credits : 0;
    state.userRole = result && result.role ? String(result.role) : null;
  } catch (error) {
    state.userCredits = 0;
    state.userRole = null;
    setAuthStatus(mapAuthError(error), true);
  }
  updateOwnerUI();
  updateAuthUI(user);
  updateDownloadAvailability();
}
