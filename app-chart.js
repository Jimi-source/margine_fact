let marginChartInstance = null;

const CHART_DATASETS = [
  {
    key: "revenueBeforeTax",
    label: "Выручка",
    color: "rgba(99, 179, 237, 0.85)",
    border: "rgb(49, 130, 206)",
    yAxis: "yRub",
    type: "bar",
    order: 2
  },
  {
    key: "totalCost",
    label: "Себестоимость",
    color: "rgba(252, 129, 74, 0.85)",
    border: "rgb(221, 72, 20)",
    yAxis: "yRub",
    type: "bar",
    order: 2
  },
  {
    key: "otherServicesTotal",
    label: "Прочие услуги",
    color: "rgba(167, 139, 250, 0.85)",
    border: "rgb(124, 58, 237)",
    yAxis: "yRub",
    type: "bar",
    order: 2
  },
  {
    key: "totalAds",
    label: "Реклама",
    color: "rgba(251, 191, 36, 0.85)",
    border: "rgb(217, 119, 6)",
    yAxis: "yRub",
    type: "bar",
    order: 2
  },
  {
    key: "totalCancelSum",
    label: "Сумма отмен",
    color: "rgba(248, 113, 113, 0.85)",
    border: "rgb(220, 38, 38)",
    yAxis: "yRub",
    type: "bar",
    order: 2
  },
  {
    key: "marginBeforeTax",
    label: "Маржа, %",
    color: "rgba(52, 211, 153, 1)",
    border: "rgb(16, 185, 129)",
    yAxis: "yPct",
    type: "line",
    order: 1,
    isPercent: true
  },
  {
    key: "summaryMarginWithoutCancel",
    label: "Маржа без отмен, %",
    color: "rgba(34, 211, 238, 1)",
    border: "rgb(6, 182, 212)",
    yAxis: "yPct",
    type: "line",
    order: 1,
    isPercent: true
  }
];

const chartVisibility = {};
CHART_DATASETS.forEach((ds) => {
  chartVisibility[ds.key] = true;
});

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

function getChartData() {
  const yearSelect = document.getElementById("chartYear");
  const granSelect = document.getElementById("chartGranularity");
  const year = yearSelect ? Number(yearSelect.value) : new Date().getFullYear();
  const granularity = granSelect ? granSelect.value : "week";
  const periods = buildCashflowPeriods(year, granularity);

  const labels = [];
  const dataByKey = {};
  CHART_DATASETS.forEach((ds) => { dataByKey[ds.key] = []; });

  periods.forEach((period) => {
    const entry = getCashflowEntry(period.key);
    const summary = entry.summary || {};
    if (!Number.isFinite(summary.marginBeforeTax) && !Number.isFinite(entry.marginBeforeTax)) return;

    labels.push(period.label);
    CHART_DATASETS.forEach((ds) => {
      const raw = summary[ds.key] !== undefined ? summary[ds.key] : entry[ds.key];
      const val = Number.isFinite(raw) ? raw : null;
      const scaled = val !== null && ds.isPercent ? Math.round(val * 10000) / 100 : val;
      dataByKey[ds.key].push(scaled !== null ? Math.round(scaled * 100) / 100 : null);
    });
  });

  return { labels, dataByKey };
}

function renderChartLegend() {
  const container = document.getElementById("chartLegend");
  if (!container) return;
  container.innerHTML = CHART_DATASETS.map((ds) => {
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
        const idx = CHART_DATASETS.findIndex((d) => d.key === key);
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

  const { labels, dataByKey } = getChartData();

  if (labels.length === 0) {
    if (statusEl) statusEl.textContent = "Нет данных. Сначала рассчитайте периоды во вкладке Cashflow.";
    if (marginChartInstance) {
      marginChartInstance.destroy();
      marginChartInstance = null;
    }
    return;
  }
  if (statusEl) statusEl.textContent = "";

  const datasets = CHART_DATASETS.map((ds) => ({
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
      interaction: {
        mode: "index",
        intersect: false
      },
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
              if (ctx.parsed.y === null) return null;
              const ds = CHART_DATASETS[ctx.datasetIndex];
              const val = ctx.parsed.y;
              return ds.isPercent
                ? ` ${ctx.dataset.label}: ${val.toFixed(2)} %`
                : ` ${ctx.dataset.label}: ${val.toLocaleString("ru-RU")} ₽`;
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
  renderChartLegend();

  const yearSelect = document.getElementById("chartYear");
  const granSelect = document.getElementById("chartGranularity");
  if (yearSelect) yearSelect.addEventListener("change", renderMarginChart);
  if (granSelect) granSelect.addEventListener("change", renderMarginChart);
}
