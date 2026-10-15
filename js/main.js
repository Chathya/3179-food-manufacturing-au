// Embeds every Vega-Lite chart into its matching element.
// Each chart description is a separate, human-readable JSON file in /specs.

// Shared look: serif for axis and legend text, sans serif for titles.
const theme = {
  background: null,
  font: "Source Serif 4, Georgia, serif",
  view: { stroke: null },
  title: { font: "Archivo, Arial, sans-serif", fontSize: 15, fontWeight: 700, color: "#23201c", anchor: "start" },
  axis: {
    labelFont: "Source Serif 4, Georgia, serif",
    titleFont: "Source Serif 4, Georgia, serif",
    labelFontSize: 12, titleFontSize: 12,
    labelColor: "#57514a", titleColor: "#57514a",
    titleFontWeight: 400,
    domainColor: "#cfc8bc", tickColor: "#cfc8bc", gridColor: "#eee8de"
  },
  legend: {
    labelFont: "Source Serif 4, Georgia, serif", titleFont: "Archivo, Arial, sans-serif",
    labelFontSize: 12, titleFontSize: 12, labelColor: "#57514a", titleColor: "#23201c"
  },
  header: { labelFont: "Archivo, Arial, sans-serif", labelFontSize: 13, labelFontWeight: 600, labelColor: "#23201c" },
  text: { font: "Source Serif 4, Georgia, serif", fontSize: 12, color: "#57514a" }
};

const charts = {
  "chart-trend":       "specs/1_trend_overview_detail.vg.json",
  "chart-slope":       "specs/2_share_slope.vg.json",
  "chart-waffle":      "specs/3_category_waffle.vg.json",
  "chart-heatmap":     "specs/4_jobs_heatmap.vg.json",
  "chart-bump":        "specs/5_jobs_rank_bump.vg.json",
  "chart-dairy":       "specs/6_dairy_small_multiples.vg.json",
  "map-states":        "specs/7_states_choropleth.vg.json",
  "map-dairy":         "specs/8_dairy_regions_symbols.vg.json",
  "map-wine":          "specs/9_wine_regions_spikes.vg.json",
  "map-exports":       "specs/10_exports_flow_map.vg.json",
  "chart-consumption": "specs/11_consumption_dumbbell.vg.json"
};

const embedOptions = { actions: false, renderer: "svg", config: theme };

for (const [id, spec] of Object.entries(charts)) {
  vegaEmbed(`#${id}`, spec, embedOptions).catch(err => {
    document.getElementById(id).innerHTML =
      `<p class="source">This chart could not load: ${err.message}</p>`;
    console.error(id, err);
  });
}

// Key numbers in the header come from a small summary file, so the text
// always matches the data.
fetch("data/clean/key_numbers.json")
  .then(r => r.json())
  .then(k => {
    for (const [id, value] of Object.entries(k)) {
      const el = document.getElementById(id);
      if (el) el.textContent = value;
    }
  })
  .catch(() => {});

// Show / hide the numbers behind the waffle chart (a table built from the same CSV file)
async function buildWaffleTable(el) {
  const text = await (await fetch("data/clean/food_waffle.csv")).text();
  const [head, ...lines] = text.trim().split(/\r?\n/);
  const cols = head.split(",");
  const rows = lines.map(l => Object.fromEntries(l.split(",").map((v, i) => [cols[i], v])));
  const seen = new Map();
  rows.forEach(r => seen.set(r["Industry"], r));
  const body = [...seen.values()]
    .sort((a, b) => b["Share (per cent)"] - a["Share (per cent)"])
    .map(r => `<tr><td>${r["Industry"]}</td>
      <td class="num">${(+r["Value added (million dollars)"]).toLocaleString("en-AU", {maximumFractionDigits: 0})}</td>
      <td class="num">${(+r["Share (per cent)"]).toFixed(1)}</td></tr>`).join("");
  el.innerHTML = `<table><thead><tr><th>Food industry</th>
    <th class="num">Value added (million dollars)</th><th class="num">Share (per cent)</th></tr></thead>
    <tbody>${body}</tbody></table>`;
}

document.querySelectorAll(".toggle").forEach(button => {
  button.addEventListener("click", async () => {
    const target = document.getElementById(button.dataset.target);
    if (!target.innerHTML) await buildWaffleTable(target);
    target.hidden = !target.hidden;
    button.setAttribute("aria-expanded", String(!target.hidden));
    button.textContent = target.hidden ? "Show the numbers" : "Hide the numbers";
  });
});

// Fade sections in as they scroll into view (content stays visible if this script fails)
(function () {
  const items = document.querySelectorAll(".reveal");
  if (!("IntersectionObserver" in window)) {
    items.forEach(el => el.classList.add("is-visible"));
    return;
  }
  const observer = new IntersectionObserver(entries => {
    entries.forEach(entry => {
      if (entry.isIntersecting) {
        entry.target.classList.add("is-visible");
        observer.unobserve(entry.target);
      }
    });
  }, { threshold: 0.12, rootMargin: "0px 0px -40px 0px" });
  items.forEach(el => observer.observe(el));
})();
