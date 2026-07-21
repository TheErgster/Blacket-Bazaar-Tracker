
let allHistory   = [];   // full array of { timestamp, prices } snapshots
let latestPrices = {};   // { "Blook Name": { lowestAsk, avgPrice, listingCount } }
let currentSort  = "name";
let currentQuery = "";
let activeChart  = null; // Chart.js instance — destroyed before re-creating

async function loadData() {
  try {
      const res = await fetch("./data/history.json");

    allHistory = await res.json();

    if (allHistory.length === 0) {
      document.getElementById("empty-msg").textContent =
        "No snapshots yet — the GitHub Action hasn't run.";
      document.getElementById("status").textContent = "No data";
      return;
    }

    // Most recent snapshot = last element in the array
    const latest = allHistory[allHistory.length - 1];
    latestPrices = latest.prices;

    const date = new Date(latest.timestamp);
    document.getElementById("status").textContent =
      `Updated ${date.toLocaleTimeString()} · ${allHistory.length} snapshots`;

    renderGrid();
  } catch (err) {
    document.getElementById("empty-msg").textContent =
      `Failed to load data: ${err.message}`;
    document.getElementById("status").textContent = "Error";
    console.error(err);
  }
}

function renderGrid() {
  const grid = document.getElementById("grid");

  // Build list of { name, ...price data } and apply search filter
  let items = Object.entries(latestPrices)
    .map(([name, data]) => ({ name, ...data }))
    .filter(item =>
      !currentQuery || item.name.toLowerCase().includes(currentQuery.toLowerCase())
    );

  // Sort
  switch (currentSort) {
    case "name":
      items.sort((a, b) => a.name.localeCompare(b.name));
      break;
    case "price-asc":
      items.sort((a, b) => a.lowestAsk - b.lowestAsk);
      break;
    case "price-desc":
      items.sort((a, b) => b.lowestAsk - a.lowestAsk);
      break;
    case "listings":
      items.sort((a, b) => b.listingCount - a.listingCount);
      break;
  }

  if (items.length === 0) {
    grid.innerHTML = `<div id="empty-msg">No blooks match "${currentQuery}"</div>`;
    return;
  }

  // Build card HTML for each item
  grid.innerHTML = items.map(item => `
    <div class="blook-card" data-name="${escapeAttr(item.name)}">
      <img
        class="blook-img"
        src="https://blacket.org/content/blooks/${encodeURIComponent(item.name)}.png"
        alt="${escapeAttr(item.name)}"
        onerror="this.src='https://blacket.org/content/blooks/Default.png'"
      />
      <div class="blook-name">${escapeHtml(item.name)}</div>
      <div class="blook-price">${formatTokens(item.lowestAsk)}</div>
      <div class="blook-count">${item.listingCount} listed</div>
    </div>
  `).join("");

  // Wire up click handlers on each card
  grid.querySelectorAll(".blook-card").forEach(card => {
    card.addEventListener("click", () => openModal(card.dataset.name));
  });
}

function openModal(blookName) {
  const data = latestPrices[blookName];
  if (!data) return;

  // Fill in header info
  document.getElementById("modal-title").textContent = blookName;
  document.getElementById("modal-img").src =
    `https://blacket.org/content/blooks/${encodeURIComponent(blookName)}.png`;
  document.getElementById("modal-img").onerror = function() {
    this.src = "https://blacket.org/content/blooks/Default.png";
  };
  document.getElementById("stat-low").textContent   = formatTokens(data.lowestAsk);
  document.getElementById("stat-avg").textContent   = formatTokens(data.avgPrice);
  document.getElementById("stat-count").textContent = data.listingCount;

  // Default to 7-day view
  document.querySelectorAll(".range-btn").forEach(b => b.classList.remove("active"));
  document.querySelector(".range-btn[data-hours='168']").classList.add("active");

  document.getElementById("modal-overlay").classList.add("open");
  renderChart(blookName, 168);
}

function renderChart(blookName, hours) {
  // Destroy any existing chart instance so Chart.js doesn't complain
  if (activeChart) {
    activeChart.destroy();
    activeChart = null;
  }

  // Filter snapshots to the chosen time range
  const cutoff = hours === 0 ? 0 : Date.now() - hours * 60 * 60 * 1000;
  const filtered = allHistory.filter(snap =>
    snap.timestamp >= cutoff && snap.prices[blookName]
  );

  const noDataEl = document.getElementById("modal-no-data");
  const chartContainer = document.getElementById("chart-container");

  if (filtered.length < 2) {
    noDataEl.style.display = "block";
    chartContainer.style.display = "none";
    return;
  }

  noDataEl.style.display = "none";
  chartContainer.style.display = "block";

  const labels     = filtered.map(s => new Date(s.timestamp).toLocaleString());
  const lowAsks    = filtered.map(s => s.prices[blookName].lowestAsk);
  const avgPrices  = filtered.map(s => s.prices[blookName].avgPrice);

  const ctx = document.getElementById("price-chart").getContext("2d");

  activeChart = new Chart(ctx, {
    type: "line",
    data: {
      labels,
      datasets: [
        {
          label: "Lowest Ask",
          data: lowAsks,
          borderColor: "#f5c842",
          backgroundColor: "rgba(245,200,66,0.08)",
          borderWidth: 2,
          pointRadius: filtered.length > 100 ? 0 : 3, // hide dots if too many points
          tension: 0.3,
          fill: true,
        },
        {
          label: "Avg Price",
          data: avgPrices,
          borderColor: "#7c8099",
          backgroundColor: "transparent",
          borderWidth: 1.5,
          borderDash: [4, 4],
          pointRadius: 0,
          tension: 0.3,
        }
      ]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      interaction: { mode: "index", intersect: false },
      plugins: {
        legend: {
          labels: { color: "#7c8099", font: { size: 11 } }
        },
        tooltip: {
          callbacks: {
            // Format tooltip values with token symbol
            label: ctx => ` ${ctx.dataset.label}: ${formatTokens(ctx.parsed.y)}`
          }
        }
      },
      scales: {
        x: {
          ticks: {
            color: "#7c8099",
            font: { size: 10 },
            maxTicksLimit: 8,     // don't cram 100 labels on the x-axis
            maxRotation: 0,
          },
          grid: { color: "#2e334d" }
        },
        y: {
          ticks: {
            color: "#7c8099",
            font: { size: 10 },
            callback: val => formatTokens(val),
          },
          grid: { color: "#2e334d" }
        }
      }
    }
  });
}

//Event Listeners
// Search input
document.getElementById("search").addEventListener("input", e => {
  currentQuery = e.target.value.trim();
  renderGrid();
});

// Sort buttons
document.querySelectorAll(".sort-btn").forEach(btn => {
  btn.addEventListener("click", () => {
    document.querySelectorAll(".sort-btn").forEach(b => b.classList.remove("active"));
    btn.classList.add("active");
    currentSort = btn.dataset.sort;
    renderGrid();
  });
});

// Close modal on overlay click or close button
document.getElementById("modal-overlay").addEventListener("click", e => {
  if (e.target === document.getElementById("modal-overlay")) closeModal();
});
document.getElementById("modal-close").addEventListener("click", closeModal);
document.addEventListener("keydown", e => { if (e.key === "Escape") closeModal(); });

function closeModal() {
  document.getElementById("modal-overlay").classList.remove("open");
  if (activeChart) { activeChart.destroy(); activeChart = null; }
}

// Time range buttons inside modal
document.querySelectorAll(".range-btn").forEach(btn => {
  btn.addEventListener("click", () => {
    document.querySelectorAll(".range-btn").forEach(b => b.classList.remove("active"));
    btn.classList.add("active");
    const name = document.getElementById("modal-title").textContent;
    renderChart(name, parseInt(btn.dataset.hours));
  });
});


// Format a token number nicely: 1234 → "1,234 "
function formatTokens(n) {
  return n.toLocaleString() + " ";
}

// Escape HTML to prevent XSS from blook names
function escapeHtml(str) {
  return str.replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;");
}
function escapeAttr(str) {
  return str.replace(/"/g, "&quot;");
}

loadData();