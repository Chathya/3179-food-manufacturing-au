// Embeds every Vega-Lite spec into its matching div.
// Each spec lives as its own readable JSON file in /specs (required by the brief).

const charts = {
  chart_sector_trend: "specs/sector_trend.vg.json",
  // chart_category_heatmap: "specs/category_heatmap.vg.json",
  // map_states: "specs/map_states.vg.json",
  // map_exports: "specs/map_exports.vg.json",
  // chart_consumption: "specs/consumption.vg.json",
};

const embedOptions = { actions: false, renderer: "svg" };

for (const [id, spec] of Object.entries(charts)) {
  vegaEmbed(`#${id}`, spec, embedOptions).catch(console.error);
}
