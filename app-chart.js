let marginChartInstance = null;
const chartVisibility = {};

const STATIC_DATASETS = [
  {
    key: "totalQty",
    label: "Кол-во доставлено",
    color: "rgba(148,163,184,0.7)",
    border: "rgb(100,116,139)",
    yAxis: "yQty",
    type: "bar",
    order: 3,
    unit: "шт"
  },
  {
    key: "totalCost",
    label: "Сумма себестоимости",
    color: "rgba(252,129,74,0.85)",
    border: "rgb(221,72,20)",
    yAxis: "yRub",
    type: "bar",
    order: 3,
    unit: "₽"
  },
  {
    key: "otherServicesTotal",
    label: "Прочие услуги",
    color: "rgba(167,139,250,0.85)",
    border: "rgb(124,58,237)",
    yAxis: "yRub",
    type: "bar",
    order: 3,
    unit: "₽"
  },
  {
    key: "totalAds",
    label: "Реклама",
    color: "rgba(251,191,36,0.85)",
    border: "rgb(217,119,6)",
    yAxis: "yRub",
    type: "bar",
    order: 3,
    unit: "₽"
  },
  {
    key: "totalAccrual",
    label: "Начисления",
    color: "rgba(99,179,237,0.7)",
    border: "rgb(49,130,206)",
    yAxis: "yRub",
    type: "bar",
    order: 3,
    unit: "₽"
  },
  {
    key: "revenueBeforeTax",
    label: "Выручка",
    color: "rgba(52,211,153,0.7)",
    border: "rgb(16,185,129)",
    yAxis: "yRub",
    type: "bar",
    order: 3,
    unit: "₽"
  },
  {
    key: "totalCancelSum",
    label: "Сумма отмен",
    color: "rgba(248,113,113,0.85)",
    border: "rgb(220,38,38)",
    yAxis: "yRub",
    type: "bar",
    order: 3,
    unit: "₽"
  },
  {
    key: "marginBeforeTax",
    label: "Маржа, %",
    color: "rgba(52,211,153,1)",
    border: "rgb(16,185,129)",
    yAxis: "yPct",
    type: "line",
    order: 1,
    unit: "%"
  },
  {
    key: "summaryMarginWithoutCancel",
    label: "Маржа без отмен, %",
    color: "rgba(34,211,238,1)",
    border: "rgb(6,182,212)",
    yAxis: "yPct",
    type: "line",
    order: 1,
    unit: "%"
  }
];

const GROUP_COLORS = [
  { color: "rgba(99,179,237,0.55)", border: "rgb(49,130,206)" },
  { color: "rgba(167,139,250,0.55)", border: "rgb(124,58,237)" },
  { color: "rgba(251,191,36,0.55)", border: "rgb(217,119,6)" },
  { color: "rgba(248,113,113,0.55)", border: "rgb(220,38,38)" },
  { color: "rgba(52,211,153,0.55)", border: "rgb(16,185,129)" },
  { color: "rgba(148,163,184,0.55)", border: "rgb(100,116,139)" }
];

// Цвета для % линий (более прозрачные/пунктирные)
const PCT_LINE_COLORS = [
  "rgb(147,197,253)",
  "rgb(196,181,253)",
  "rgb(253,230,138)",
  "rgb(252,165,165)",
  "rgb(110,231,183)",
  "rgb(203,213,225)",
  "rgb(249,168,212)",
  "rgb(167,243,208)"
];

function initChartYearSelect() {
  const select = document.getElementById("chartYear");
  if (!select) return;
  if (select.options.length > 0) return;
  const currentYear = new Date().getFullYear();
  for (let year = currentYear - 3; year <= currentYear + 1; year += 1) {
    const option = document.createElement("option");
    option.value = String(year);
    option.textContent = String(year);
    if (year === currentYear) option.selected = true;
    select.appendChild(option);
  }
}

function getKnownGroups(periods) {
  const groups = new Set();
  periods.forEach((period) => {
    const entry = getCashflowEntry(period.key);
    const summary = entry.summary || {};
    if (summary.totalByGroup) {
      Object.keys(summary.totalByGroup).forEach((g) => groups.add(g));
    }
  });
  return Array.from(groups).sort();
}

// Строит полный список датасетов: группы + статика + % от Продаж
function buildAllDatasets(knownGroups) {
  const groupDatasets = knownGroups.map((group, i) => {
    const c = GROUP_COLORS[i % GROUP_COLORS.length];
    return {
      key: `group__${group}`,
      groupName: group,
      label: getGroupLabel(group),
      color: c.color,
      border: c.border,
      yAxis: "yRub",
      type: "bar",
      order: 2,
      unit: "₽"
    };
  });

  // % от Продаж — для всех рублёвых датасетов (кроме qty и уже %-ных)
  const rubDatasets = [...groupDatasets, ...STATIC_DATASETS].filter(
    (ds) => ds.unit === "₽"
  );
  const pctFromSalesDatasets = rubDatasets.map((ds, i) => ({
    key: `pct_sales__${ds.key}`,
    sourceKey: ds.key,
    label: `${ds.label} % от Продаж`,
    color: "transparent",
    border: PCT_LINE_COLORS[i % PCT_LINE_COLORS.length],
    yAxis: "yPct",
    type: "line",
    order: 0,
    unit: "%",
    isPctFromSales: true
  }));

  return [...groupDatasets, ...STATIC_DATASETS, ...pctFromSalesDatasets];
}

function getChartData(allDatasets, periods) {
  const labels = [];
  const dataByKey = {};
  allDatasets.forEach((ds) => { dataByKey[ds.key] = []; });

  periods.forEach((period) => {
    const entry = getCashflowEntry(period.key);
    const summary = entry.summary || {};
    const hasMeta = Number.isFinite(summary.marginBeforeTax) || Number.isFinite(entry.marginBeforeTax);
    if (!hasMeta) return;

    labels.push(period.label);

    // Сначала считаем базовые значения
    const baseValues = {};
    allDatasets.forEach((ds) => {
      if (ds.isPctFromSales) return;
      let raw;
      if (ds.groupName !== undefined) {
        raw = summary.totalByGroup ? (summary.totalByGroup[ds.groupName] || 0) : null;
      } else {
        raw = summary[ds.key] !== undefined ? summary[ds.key] : entry[ds.key];
      }
      const val = Number.isFinite(raw) ? raw : null;
      // % метрики храним как доли (0..1), умножаем в x100 для отображения
      const scaled = val !== null && ds.unit === "%" ? Math.round(val * 10000) / 100 : val;
      baseValues[ds.key] = scaled !== null ? Math.round(scaled * 100) / 100 : null;
      dataByKey[ds.key].push(baseValues[ds.key]);
    });

    // Считаем % от Продаж
    const salesGroup = summary.totalByGroup ? (summary.totalByGroup["Продажи"] || 0) : 0;
    allDatasets.forEach((ds) => {
      if (!ds.isPctFromSales) return;
      const sourceVal = baseValues[ds.sourceKey];
      const pct = sourceVal !== null && salesGroup !== 0
        ? Math.round((sourceVal / salesGroup) * 10000) / 100
        : null;
      dataByKey[ds.key].push(pct);
    });
  });

  return { labels, dataByKey };
}

function renderChartLegend(allDatasets) {
  const container = document.getElementById("chartLegend");
  if (!container) return;

  allDatasets.forEach((ds) => {
    if (chartVisibility[ds.key] === undefined) {
      // По умолчанию % от Продаж скрыты
      chartVisibility[ds.key] = !ds.isPctFromSales;
    }
  });

  // Разбиваем легенду на две части
  const mainDatasets = allDatasets.filter((ds) => !ds.isPctFromSales);
  const pctDatasets = allDatasets.filter((ds) => ds.isPctFromSales);

  const makeBtn = (ds) => {
    const active = chartVisibility[ds.key];
    return `
      <button
        class="chart-legend-btn${active ? " active" : ""}"
        data-key="${ds.key}"
        style="--legend-color:${ds.border}"
      >
        <span class="chart-legend-dot${ds.isPctFromSales ? " dot-line" : ""}"></span>
        ${ds.label}
      </button>
    `;
  };

  container.innerHTML = `
    <div class="chart-legend-group">
      ${mainDatasets.map(makeBtn).join("")}
    </div>
    <div class="chart-legend-divider">% от Продаж</div>
    <div class="chart-legend-group">
      ${pctDatasets.map(makeBtn).join("")}
    </div>
  `;

  container.querySelectorAll(".chart-legend-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      const key = btn.dataset.key;
      chartVisibility[key] = !chartVisibility[key];
      btn.classList.toggle("active", chartVisibility[key]);
      if (marginChartInstance) {
        const idx = marginChartInstance.data.datasets.findIndex((d) => d._key === key);
        if (idx !== -1) {
          marginChartInstance.data.datasets[idx].hidden = !chartVisibility[key];
          marginChartInstance.update();
        }
      }
    });
  });
}

function renderMarginChart() {
  const canvas = document.getElementById("marginChart");
  const statusEl = document.getElementById("chartStatus");
  if (!canvas) return;

  const yearSelect = document.getElementById("chartYear");
  const granSelect = document.getElementById("chartGranularity");
  const year = yearSelect ? Number(yearSelect.value) : new Date().getFullYear();
  const granularity = granSelect ? granSelect.value : "week";
  const periods = buildCashflowPeriods(year, granularity);

  const knownGroups = getKnownGroups(periods);
  const allDatasets = buildAllDatasets(knownGroups);
  const { labels, dataByKey } = getChartData(allDatasets, periods);

  renderChartLegend(allDatasets);

  if (labels.length === 0) {
    if (statusEl) statusEl.textContent = "Нет данных. Сначала рассчитайте периоды во вкладке Cashflow.";
    if (marginChartInstance) {
      marginChartInstance.destroy();
      marginChartInstance = null;
    }
    return;
  }
  if (statusEl) statusEl.textContent = "";

  const datasets = allDatasets.map((ds) => ({
    _key: ds.key,
    _unit: ds.unit,
    _isPctFromSales: ds.isPctFromSales || false,
    label: ds.label,
    data: dataByKey[ds.key],
    backgroundColor: ds.color,
    borderColor: ds.border,
    borderWidth: ds.type === "line" ? (ds.isPctFromSales ? 1.5 : 2.5) : 1,
    borderDash: ds.isPctFromSales ? [4, 3] : [],
    borderRadius: ds.type === "bar" ? 4 : 0,
    pointRadius: ds.type === "line" ? (ds.isPctFromSales ? 2 : 4) : 0,
    pointHoverRadius: ds.type === "line" ? 5 : 0,
    fill: false,
    tension: 0.3,
    type: ds.type,
    yAxisID: ds.yAxis,
    order: ds.order,
    hidden: !chartVisibility[ds.key],
    spanGaps: true
  }));

  const tooltipLabel = (ctx) => {
    if (ctx.parsed.y === null) return null;
    const unit = ctx.dataset._unit;
    const val = ctx.parsed.y;
    if (unit === "%") return ` ${ctx.dataset.label}: ${val.toFixed(2)} %`;
    if (unit === "шт") return ` ${ctx.dataset.label}: ${Math.round(val).toLocaleString("ru-RU")} шт`;
    return ` ${ctx.dataset.label}: ${Number(val).toLocaleString("ru-RU")} ₽`;
  };

  if (marginChartInstance) {
    marginChartInstance.data.labels = labels;
    marginChartInstance.data.datasets = datasets;
    marginChartInstance.options.plugins.tooltip.callbacks.label = tooltipLabel;
    marginChartInstance.update();
    return;
  }

  marginChartInstance = new Chart(canvas, {
    type: "bar",
    data: { labels, datasets },
    options: {
      responsive: true,
      maintainAspectRatio: true,
      interaction: { mode: "index", intersect: false },
      plugins: {
        legend: { display: false },
        tooltip: {
          backgroundColor: "rgba(15,23,42,0.92)",
          titleColor: "#e2e8f0",
          bodyColor: "#cbd5e1",
          borderColor: "rgba(255,255,255,0.1)",
          borderWidth: 1,
          padding: 12,
          filter: (item) => !item.dataset.hidden,
          callbacks: { label: tooltipLabel }
        }
      },
      scales: {
        yRub: {
          type: "linear",
          position: "left",
          ticks: {
            callback: (v) => `${(v / 1000).toLocaleString("ru-RU")}k ₽`,
            color: "#94a3b8"
          },
          grid: { color: "rgba(148,163,184,0.12)" },
          border: { dash: [4, 4] }
        },
        yQty: {
          type: "linear",
          position: "left",
          display: "auto",
          ticks: {
            callback: (v) => `${Math.round(v).toLocaleString("ru-RU")} шт`,
            color: "#94a3b8"
          },
          grid: { display: false }
        },
        yPct: {
          type: "linear",
          position: "right",
          ticks: {
            callback: (v) => `${v} %`,
            color: "#34d399"
          },
          grid: { display: false },
          border: { dash: [4, 4] }
        },
        x: {
          ticks: {
            maxRotation: 45,
            font: { size: 11 },
            color: "#94a3b8"
          },
          grid: { display: false }
        }
      }
    }
  });
}

function setupChartTab() {
  initChartYearSelect();

  const yearSelect = document.getElementById("chartYear");
  const granSelect = document.getElementById("chartGranularity");
  if (yearSelect) yearSelect.addEventListener("change", renderMarginChart);
  if (granSelect) granSelect.addEventListener("change", renderMarginChart);
}
