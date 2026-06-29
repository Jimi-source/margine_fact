let marginChartInstance = null;
const chartVisibility = {};

// Статические показатели (всегда есть в summary)
const STATIC_DATASETS = [
  {
    key: "totalQty",
    label: "Кол-во доставлено",
    color: "rgba(148,163,184,0.7)",
    border: "rgb(100,116,139)",
    yAxis: "yRub",
    type: "bar",
    order: 3
  },
  {
    key: "totalCost",
    label: "Сумма себестоимости",
    color: "rgba(252,129,74,0.85)",
    border: "rgb(221,72,20)",
    yAxis: "yRub",
    type: "bar",
    order: 3
  },
  {
    key: "otherServicesTotal",
    label: "Прочие услуги",
    color: "rgba(167,139,250,0.85)",
    border: "rgb(124,58,237)",
    yAxis: "yRub",
    type: "bar",
    order: 3
  },
  {
    key: "totalAds",
    label: "Реклама",
    color: "rgba(251,191,36,0.85)",
    border: "rgb(217,119,6)",
    yAxis: "yRub",
    type: "bar",
    order: 3
  },
  {
    key: "totalAccrual",
    label: "Начисления",
    color: "rgba(99,179,237,0.7)",
    border: "rgb(49,130,206)",
    yAxis: "yRub",
    type: "bar",
    order: 3
  },
  {
    key: "revenueBeforeTax",
    label: "Выручка",
    color: "rgba(52,211,153,0.7)",
    border: "rgb(16,185,129)",
    yAxis: "yRub",
    type: "bar",
    order: 3
  },
  {
    key: "totalCancelSum",
    label: "Сумма отмен",
    color: "rgba(248,113,113,0.85)",
    border: "rgb(220,38,38)",
    yAxis: "yRub",
    type: "bar",
    order: 3
  },
  {
    key: "marginBeforeTax",
    label: "Маржа, %",
    color: "rgba(52,211,153,1)",
    border: "rgb(16,185,129)",
    yAxis: "yPct",
    type: "line",
    order: 1,
    isPercent: true
  },
  {
    key: "summaryMarginWithoutCancel",
    label: "Маржа без отмен, %",
    color: "rgba(34,211,238,1)",
    border: "rgb(6,182,212)",
    yAxis: "yPct",
    type: "line",
    order: 1,
    isPercent: true
  }
];

// Цвета для динамических групп начислений
const GROUP_COLORS = [
  { color: "rgba(99,179,237,0.55)", border: "rgb(49,130,206)" },
  { color: "rgba(167,139,250,0.55)", border: "rgb(124,58,237)" },
  { color: "rgba(251,191,36,0.55)", border: "rgb(217,119,6)" },
  { color: "rgba(248,113,113,0.55)", border: "rgb(220,38,38)" },
  { color: "rgba(52,211,153,0.55)", border: "rgb(16,185,129)" },
  { color: "rgba(148,163,184,0.55)", border: "rgb(100,116,139)" }
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

// Собирает динамические группы (totalByGroup) из всех сохранённых периодов
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
      order: 2
    };
  });
  return [...groupDatasets, ...STATIC_DATASETS];
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
    allDatasets.forEach((ds) => {
      let raw;
      if (ds.groupName !== undefined) {
        raw = summary.totalByGroup ? (summary.totalByGroup[ds.groupName] || 0) : null;
      } else {
        raw = summary[ds.key] !== undefined ? summary[ds.key] : entry[ds.key];
      }
      const val = Number.isFinite(raw) ? raw : null;
      const scaled = val !== null && ds.isPercent ? Math.round(val * 10000) / 100 : val;
      dataByKey[ds.key].push(scaled !== null ? Math.round(scaled * 100) / 100 : null);
    });
  });

  return { labels, dataByKey };
}

function renderChartLegend(allDatasets) {
  const container = document.getElementById("chartLegend");
  if (!container) return;

  // Инициализируем видимость для новых ключей
  allDatasets.forEach((ds) => {
    if (chartVisibility[ds.key] === undefined) chartVisibility[ds.key] = true;
  });

  container.innerHTML = allDatasets.map((ds) => {
    const active = chartVisibility[ds.key];
    return `
      <button
        class="chart-legend-btn${active ? " active" : ""}"
        data-key="${ds.key}"
        style="--legend-color:${ds.border}"
      >
        <span class="chart-legend-dot"></span>
        ${ds.label}
      </button>
    `;
  }).join("");

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
    label: ds.label,
    data: dataByKey[ds.key],
    backgroundColor: ds.color,
    borderColor: ds.border,
    borderWidth: ds.type === "line" ? 2.5 : 1,
    borderRadius: ds.type === "bar" ? 4 : 0,
    pointRadius: ds.type === "line" ? 4 : 0,
    pointHoverRadius: ds.type === "line" ? 6 : 0,
    fill: false,
    tension: 0.3,
    type: ds.type,
    yAxisID: ds.yAxis,
    order: ds.order,
    hidden: !chartVisibility[ds.key],
    spanGaps: true
  }));

  if (marginChartInstance) {
    marginChartInstance.data.labels = labels;
    marginChartInstance.data.datasets = datasets;
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
          callbacks: {
            label: (ctx) => {
              if (ctx.parsed.y === null || ctx.dataset.hidden) return null;
              const ds = allDatasets[ctx.datasetIndex];
              const val = ctx.parsed.y;
              if (!ds) return null;
              return ds.isPercent
                ? ` ${ctx.dataset.label}: ${val.toFixed(2)} %`
                : ` ${ctx.dataset.label}: ${Number(val).toLocaleString("ru-RU")} ${ds.key === "totalQty" ? "шт" : "₽"}`;
            }
          }
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
