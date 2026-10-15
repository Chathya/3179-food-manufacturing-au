# From Farm Gate to Shelf: Australia's Food Manufacturing

FIT3179 Data Visualisation 2. Chathya Attanayake, October 2026.

Live page: https://<your-github-username>.github.io/food-manufacturing-au/

## Charts (11 charts, 9 advanced idioms, 4 map idioms)

| # | Spec file | Idiom | Data |
|---|---|---|---|
| 1 | `1_trend_overview_detail.vg.json` | Line chart with period zoom buttons | ABS Australian Industry |
| 2 | `2_share_slope.vg.json` | Slope chart | ABS Australian Industry |
| 3 | `3_category_waffle.vg.json` | Waffle chart | ABS Australian Industry cube |
| 4 | `4_jobs_heatmap.vg.json` | Heatmap | ABS Labour Force EQ06 |
| 5 | `5_jobs_rank_bump.vg.json` | Bump chart (focus and context on hover) | ABS Labour Force EQ06 |
| 6 | `6_dairy_small_multiples.vg.json` | Small multiples | ABARES |
| 7 | `7_states_choropleth.vg.json` | Choropleth map with industry menu and year slider | ABS Labour Force EQ06 |
| 8 | `8_dairy_regions_symbols.vg.json` | Proportional symbol map | Dairy Australia |
| 9 | `9_wine_regions_spikes.vg.json` | Spike map (regional) | Wine Australia |
| 10 | `10_exports_flow_map.vg.json` | Flow map with filter (world, ocean, latitude and longitude lines) | QGSO exports |
| 11 | `11_consumption_dumbbell.vg.json` | Dumbbell chart | ABS Apparent Consumption |

## Updating the data

1. Put the raw downloads in `data/raw/`.
2. Run `python scripts/clean_data.py`. It writes small CSV files to `data/clean/`.
3. Test locally with `python -m http.server 8000` and open http://localhost:8000.

## Structure

| Folder | Contents |
|---|---|
| `index.html` | The single scrolling page |
| `specs/` | One readable Vega-Lite file per chart or map |
| `data/clean/` | Small tidy CSV files the charts load |
| `data/geo/` | Simplified map shapes (Australian states, world countries) |
| `data/raw/` | Original downloads (not loaded by the page) |
| `scripts/` | Data cleaning script |
| `sketch/` | Scanned A4 sketch (PDF) |
