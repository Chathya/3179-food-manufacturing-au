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
    labelFontSize: 12.5, titleFontSize: 12.5,
    labelColor: "#4a443d", titleColor: "#4a443d",
    titleFontWeight: 400,
    domainColor: "#cfc8bc", tickColor: "#cfc8bc", gridColor: "#eee8de"
  },
  legend: {
    labelFont: "Newsreader, Georgia, serif", titleFont: "Bricolage Grotesque, Arial, sans-serif",
    labelFontSize: 12.5, titleFontSize: 12.5, labelColor: "#4a443d", titleColor: "#23201c"
  },
  header: { labelFont: "Bricolage Grotesque, Arial, sans-serif", labelFontSize: 13, labelFontWeight: 600, labelColor: "#23201c" },
  text: { font: "Newsreader, Georgia, serif", fontSize: 12.5, color: "#4a443d" }
};

const charts = {
  "chart-hook":        "specs/12_hook_pictogram.vg.json",
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
  "chart-consumption": "specs/11_consumption_diverging_bar.vg.json"
};

const embedOptions = { actions: false, renderer: "svg", config: theme };

// A few charts need a different arrangement on narrow screens.
async function loadSpec(id, url) {
  const spec = await (await fetch(url)).json();
  if (id === "chart-waffle") {
    const room = document.getElementById(id).clientWidth;
    spec.layer[0].encoding.color.legend.columns = window.innerWidth < 700 ? 1 : (room < 760 ? 2 : 4);
  }
  if (id === "chart-dairy") {
    // Two panels that exactly fill the column (the left panel also carries the vertical axis)
    const room = document.getElementById(id).clientWidth;
    if (window.innerWidth < 700) { spec.columns = 1; spec.spec.width = Math.max(200, room - 50); }
    else spec.spec.width = Math.floor((room - 78) / 2) - 5;
  }
  if (id === "map-exports") {
    // The world map is about twice as wide as it is tall, so match its height to the column width
    const room = document.getElementById(id).clientWidth;
    spec.height = Math.round(room * 0.5) + 10;
  }
  if (id === "chart-consumption") {
    // Plot width = column width minus the food group names
    const room = document.getElementById(id).clientWidth;
    spec.width = Math.max(180, room - (room < 520 ? 190 : 230));
  }
  return spec;
}

for (const [id, url] of Object.entries(charts)) {
  loadSpec(id, url).then(spec => vegaEmbed(`#${id}`, spec, embedOptions)).then(result => {
    if (id === "chart-trend") { animateTrendZoom(result.view); drawOnceOnView(id, drawTrendLines); }
    if (id === "chart-slope") setupSlope(result.view);
    if (id === "chart-hook") countHook(result.view);
    if (id === "map-exports") setupExpand(result.view, url);
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
// When a block drops back below the screen it resets, so the animation
// plays again every time the reader scrolls down to it.
// (Content stays visible if this script fails, because the hiding only
// applies when the "js" class is on the page.)
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
      } else if (entry.boundingClientRect.top > 0) {
        entry.target.classList.remove("is-visible");
      }
    });
  }, { threshold: 0.1, rootMargin: "0px 0px -60px 0px" });
  items.forEach(el => observer.observe(el));
})();

// Story navigation: underline the aisle that is on screen (links only scroll, they never swap content)
(function () {
  const links = [...document.querySelectorAll(".storynav a")];
  if (!links.length || !("IntersectionObserver" in window)) return;
  const byId = Object.fromEntries(links.map(a => [a.getAttribute("href").slice(1), a]));
  const seen = new Map();
  const obs = new IntersectionObserver(entries => {
    entries.forEach(e => seen.set(e.target.id, e.isIntersecting ? e.intersectionRatio : 0));
    const best = [...seen.entries()].sort((a, b) => b[1] - a[1])[0];
    links.forEach(a => a.classList.remove("is-active"));
    if (best && best[1] > 0) byId[best[0]].classList.add("is-active");
  }, { rootMargin: "-45% 0px -45% 0px", threshold: [0, 1] });
  Object.keys(byId).forEach(id => { const el = document.getElementById(id); if (el) obs.observe(el); });
})();


// ---------------------------------------------------------------
// Gentle chart motion. Each effect plays once when the chart first
// comes into view, or when the reader asks for it (a button).
// Nothing loops, and reduced-motion settings switch it all off.
// ---------------------------------------------------------------
const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
const easeInOut = t => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);

function drawOnceOnView(id, fn) {
  if (reduceMotion || !("IntersectionObserver" in window)) return;
  const el = document.getElementById(id);
  const obs = new IntersectionObserver(entries => {
    if (entries.some(e => e.isIntersecting)) { obs.disconnect(); fn(el); }
  }, { threshold: 0.4 });
  obs.observe(el);
}

// Trend chart: the lines draw from left to right, grey first then food.
function drawTrendLines(el) {
  const paths = [...el.querySelectorAll(".mark-line path")];
  paths.forEach((p, i) => {
    const len = p.getTotalLength();
    p.animate(
      [{ strokeDasharray: `${len} ${len}`, strokeDashoffset: len },
       { strokeDasharray: `${len} ${len}`, strokeDashoffset: 0 }],
      { duration: 1400, delay: i * 500, easing: "ease-in-out", fill: "backwards" }
    );
  });
}

// Slope chart: every right-hand point glides from its 2007 value to its 2025 value.
function animateSignal(view, name, from, to, ms) {
  const t0 = performance.now();
  const step = now => {
    const t = Math.min(1, (now - t0) / ms);
    view.signal(name, from + (to - from) * easeInOut(t)).run();
    if (t < 1) requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
}

function setupSlope(view) {
  const play = () => { view.signal("progress", 0).run(); animateSignal(view, "progress", 0, 1, 1600); };
  document.querySelectorAll('[data-replay="slope"]').forEach(b => b.addEventListener("click", () => {
    if (reduceMotion) return;
    play();
  }));
  if (reduceMotion) return;
  view.signal("progress", 0).run();
  drawOnceOnView("chart-slope", () => animateSignal(view, "progress", 0, 1, 1600));
}

// Hook pictogram: the coloured coins count up from 0 to 22 once, a few moments after the page opens.
function countHook(view) {
  if (reduceMotion) return;
  view.signal("n", 0).run();
  setTimeout(() => {
    const t0 = performance.now(), ms = 2400;
    const step = now => {
      const t = Math.min(1, (now - t0) / ms);
      view.signal("n", Math.round(22 * t)).run();
      if (t < 1) requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  }, 800);
}


// Expanded world map: the same spec in a full-screen panel, with room for more country labels.
function setupExpand(inlineView, url) {
  const btn = document.getElementById("expand-exports");
  if (!btn) return;
  btn.addEventListener("click", async () => {
    const overlay = document.createElement("div");
    overlay.className = "expand-overlay";
    overlay.setAttribute("role", "dialog");
    overlay.setAttribute("aria-label", "Expanded export map");
    overlay.innerHTML = '<div class="expand-panel"><button class="replay expand-close" type="button">Close</button><div id="map-exports-big" class="chart"></div></div>';
    document.body.appendChild(overlay);
    document.body.style.overflow = "hidden";
    const big = overlay.querySelector("#map-exports-big");
    const spec = await (await fetch(url)).json();
    const panelW = Math.min(window.innerWidth - 80, (window.innerHeight - 140) * 2 - 40);
    spec.width = Math.max(300, Math.round(panelW));
    spec.height = Math.round(spec.width * 0.5);
    spec.autosize = { type: "fit", contains: "padding" };
    spec.params.find(p => p.name === "labelRank").value = 6;
    spec.params.find(p => p.name === "industry").value = inlineView.signal("industry");
    const res = await vegaEmbed(big, spec, embedOptions);
    const close = () => { res.view.finalize(); overlay.remove(); document.body.style.overflow = ""; document.removeEventListener("keydown", onKey); btn.focus(); };
    const onKey = e => { if (e.key === "Escape") close(); };
    document.addEventListener("keydown", onKey);
    overlay.querySelector(".expand-close").addEventListener("click", close);
    overlay.addEventListener("click", e => { if (e.target === overlay) close(); });
  });
}