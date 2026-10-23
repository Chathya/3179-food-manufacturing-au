// Embeds every Vega-Lite chart into its matching element.
// Each chart description is a separate, human-readable JSON file in /specs.

// Shared look: serif for axis and legend text, sans serif for titles.
const theme = {
  background: null,
  font: "Newsreader, Georgia, serif",
  view: { stroke: null },
  title: { font: "Bricolage Grotesque, Arial, sans-serif", fontSize: 15, fontWeight: 700, color: "#23201c", anchor: "start" },
  axis: {
    labelFont: "Newsreader, Georgia, serif",
    titleFont: "Newsreader, Georgia, serif",
    labelFontSize: 12, titleFontSize: 12,
    labelColor: "#57514a", titleColor: "#57514a",
    titleFontWeight: 400,
    domainColor: "#cfc8bc", tickColor: "#cfc8bc", gridColor: "#eee8de"
  },
  legend: {
    labelFont: "Newsreader, Georgia, serif", titleFont: "Bricolage Grotesque, Arial, sans-serif",
    labelFontSize: 12, titleFontSize: 12, labelColor: "#57514a", titleColor: "#23201c"
  },
  header: { labelFont: "Bricolage Grotesque, Arial, sans-serif", labelFontSize: 13, labelFontWeight: 600, labelColor: "#23201c" },
  text: { font: "Newsreader, Georgia, serif", fontSize: 12, color: "#57514a" }
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

const embedOptions = { actions: false, renderer: "svg", config: theme }; //false to hide the 3 dots 

for (const [id, spec] of Object.entries(charts)) {
  vegaEmbed(`#${id}`, spec, embedOptions).then(result => {
    if (id === "chart-trend") animateTrendZoom(result.view);
  }).catch(err => {
    document.getElementById(id).innerHTML =
      `<p class="source">This chart could not load: ${err.message}</p>`;
    console.error(id, err);
  });
}

// Zoom on the trend chart (Munzner, chapter 11: constrained navigation).
// The three period buttons are preset views. Instead of jumping straight to
// the new view (a "jump cut"), the axis limits glide there over 0.8 seconds,
// so readers can follow how the lines stretch out (an animated transition).
const PERIODS = { all: [2007, 2025], early: [2007, 2016], recent: [2019, 2025] };

async function animateTrendZoom(view) {
  // Work out the index values from the same CSV the chart uses,
  // so each period's vertical scale fits its own lines.
  const text = await (await fetch("data/clean/manufacturing_trend.csv")).text();
  const [head, ...lines] = text.trim().split(/\r?\n/);
  const cols = head.split(",");
  const rows = lines.map(l => Object.fromEntries(l.split(",").map((v, i) => [cols[i], v])))
    .filter(r => r["Measure"] === "Industry value added (million dollars)");
  const first = {};
  rows.forEach(r => {
    const y = +r["Year ending June"];
    if (!first[r["Industry"]] || y < first[r["Industry"]].year) first[r["Industry"]] = { year: y, value: +r["Value"] };
  });
  const points = rows.map(r => ({ year: +r["Year ending June"], index: +r["Value"] / first[r["Industry"]].value * 100 }));

  function target(period) {
    const [from, to] = PERIODS[period];
    const shown = points.filter(p => p.year >= from && p.year <= to).map(p => p.index);
    const low = Math.min(100, ...shown), high = Math.max(...shown);
    const pad = (high - low) * 0.08;
    return [from, to, Math.floor((low - pad) / 10) * 10, Math.ceil((high + pad) / 10) * 10];
  }

  const keys = ["x0", "x1", "y0", "y1"];
  const setView = values => { keys.forEach((k, i) => view.signal(k, values[i])); view.run(); };
  setView(target(view.signal("period")));

  const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  let frame = null;
  view.addSignalListener("period", (name, period) => {
    const start = keys.map(k => view.signal(k));
    const end = target(period);
    if (frame) cancelAnimationFrame(frame);
    if (reduceMotion) { frame = requestAnimationFrame(() => setView(end)); return; }
    const t0 = performance.now(), duration = 800;
    const ease = t => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
    const step = now => {
      const t = Math.min(1, (now - t0) / duration);
      setView(start.map((s, i) => s + (end[i] - s) * ease(t)));
      if (t < 1) frame = requestAnimationFrame(step);
    };
    frame = requestAnimationFrame(step);
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

// Scroll animation. Each block rises into place when it enters the screen.
// It resets when it drops back below the screen, so it plays again
// every time the reader scrolls down to it.
(function () {
  const items = document.querySelectorAll(".reveal");
  if (!("IntersectionObserver" in window)) {
    items.forEach(el => el.classList.add("is-visible"));
    return;
  }
  const observer = new IntersectionObserver(entries => {
    entries.forEach(entry => {
      if (entry.isIntersecting) entry.target.classList.add("is-visible");
      else if (entry.boundingClientRect.top > 0) entry.target.classList.remove("is-visible");
    });
  }, { threshold: 0.1, rootMargin: "0px 0px -60px 0px" });
  items.forEach(el => observer.observe(el));
})();