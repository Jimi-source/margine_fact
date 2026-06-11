function getSebesMap() {
  const map = new Map();
  (state.sebes || []).forEach((item) => {
    const article = normalizeArticle(item && item.article);
    if (!article) return;
    const rawCost = item && item.cost;
    if (rawCost === "" || rawCost === null || rawCost === undefined) return;
    const cost = parseNumber(rawCost);
    if (!Number.isFinite(cost)) return;
    map.set(article, cost);
  });
  return map;
}

function getMissingSebesArticles() {
  const sebesMap = getSebesMap();
  const articles = new Set();
  (state.orders || []).forEach((row) => {
    const article = normalizeArticle(row && row["Артикул"]);
    if (article) articles.add(article);
  });
  (state.accruals || []).forEach((row) => {
    const article = normalizeArticle(row && row["Артикул"]);
    if (article) articles.add(article);
  });
  const missing = Array.from(articles).filter((article) => !sebesMap.has(article));
  return missing.sort();
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

function addSebesRow() {
  if (!state.user) return;
  const items = getSebesFromUI();
  items.push({ article: "", cost: "" });
  state.sebes = items;
  renderSebesTable(items);
  markSebesDirty();
}

async function saveUserSebes() {
  if (!state.user) {
    setSebesStatus("Нужно войти в аккаунт.", true);
    return;
  }
  const items = getSebesFromUI();
  try {
    await apiRequest("/sebes", { method: "POST", body: { items } });
    state.sebes = items;
    state.sebesDirty = false;
    updateSebesActions();
    setSebesStatus("Сохранено.");
  } catch (error) {
    setSebesStatus("Не удалось сохранить себестоимость.", true);
  }
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
  try {
    const data = await apiRequest("/sebes");
    const items = Array.isArray(data.items) ? data.items : [];
    state.sebes = items.length > 0 ? items : [];
    state.sebesDirty = false;
    renderSebesTable(state.sebes);
    updateSebesActions();
    setSebesStatus(items.length > 0 ? "Данные загружены." : "Нет сохранённых данных.");
  } catch (error) {
    state.sebes = [];
    state.sebesDirty = false;
    renderSebesTable(state.sebes);
    updateSebesActions();
    setSebesStatus("Не удалось загрузить себестоимость.", true);
  }
}
