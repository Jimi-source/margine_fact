let marginChartInstance = null;

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
  const values = [];
  periods.forEach((period) => {
    const entry = getCashflowEntry(period.key);
    if (!Number.isFinite(entry.marginBeforeTax)) return;
    labels.push(period.label);
    values.push(Math.round(entry.marginBeforeTax * 10000) / 100);
  });
  return { labels, values };
}

function renderMarginChart() {
  const canvas = document.getElementById("marginChart");
  const statusEl = document.getElementById("chartStatus");
  if (!canvas) return;

  const { labels, values } = getChartData();

  if (labels.length === 0) {
    if (statusEl) statusEl.textContent = "Нет данных. Сначала рассчитайте периоды во вкладке Cashflow.";
    if (marginChartInstance) {
      marginChartInstance.destroy();
      marginChartInstance = null;
    }
    return;
  }
  if (statusEl) statusEl.textContent = "";

  const colors = values.map((v) =>
    v >= 0 ? "rgba(34, 197, 94, 0.7)" : "rgba(239, 68, 68, 0.7)"
  );
  const borderColors = values.map((v) =>
    v >= 0 ? "rgb(22, 163, 74)" : "rgb(220, 38, 38)"
  );

  if (marginChartInstance) {
    marginChartInstance.data.labels = labels;
    marginChartInstance.data.datasets[0].data = values;
    marginChartInstance.data.datasets[0].backgroundColor = colors;
    marginChartInstance.data.datasets[0].borderColor = borderColors;
    marginChartInstance.update();
    return;
  }

  marginChartInstance = new Chart(canvas, {
    type: "bar",
    data: {
      labels,
      datasets: [
        {
          label: "Маржа до налогов, %",
          data: values,
          backgroundColor: colors,
          borderColor: borderColors,
          borderWidth: 1,
          borderRadius: 4
        }
      ]
    },
    options: {
      responsive: true,
      maintainAspectRatio: true,
      plugins: {
        legend: { display: false },
        tooltip: {
          callbacks: {
            label: (ctx) => ` ${ctx.parsed.y.toFixed(2)} %`
          }
        }
      },
      scales: {
        y: {
          ticks: {
            callback: (value) => `${value} %`
          },
          grid: { color: "rgba(0,0,0,0.06)" }
        },
        x: {
          ticks: {
            maxRotation: 45,
            font: { size: 11 }
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
