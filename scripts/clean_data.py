"""
Turn the raw downloads in data/raw/ into the small tidy CSV files in data/clean/
that the Vega-Lite charts load.

Run from the repository root:
    python scripts/clean_data.py

Column names are written in plain English so tooltips never show
abbreviations or underscores.

Raw files expected in data/raw/:
    81550TSSDIVC.xlsx                   ABS Australian Industry 2024-25, manufacturing time series
    81550DO003_202425.xlsx              ABS Australian Industry 2024-25, manufacturing cube
    EQ06.xlsx                           ABS Labour Force, Australia, Detailed, table EQ06
    qgso_exports_anzsic_country.xlsx    QGSO exports by 4-digit industry and country (pivot table)
    abares_dairy_2024_25.xls            ABARES Agricultural Commodity Statistics 2024-25, dairy
    4316DO001_202324.xlsx               ABS Apparent Consumption of Selected Foodstuffs 2023-24
    dairy_regions_transcribed.csv       From Dairy Australia, Farm Business Production by Region 2025 (PDF)
    wine_regions_transcribed.csv        From Wine Australia, National Vintage Report 2026, table 5 (PDF)
"""

from collections import defaultdict
from pathlib import Path
import json
import re
import xml.etree.ElementTree as ET
import zipfile

import pandas as pd

ROOT = Path(__file__).resolve().parent.parent
RAW = ROOT / "data" / "raw"
CLEAN = ROOT / "data" / "clean"
GEO = ROOT / "data" / "geo"
CLEAN.mkdir(parents=True, exist_ok=True)

# ANZSIC food manufacturing groups -> the eight names used on the page.
# Oil and fat manufacturing (115) is small, so it joins "Other food products".
FOOD_GROUPS = {
    "111": "Meat products",
    "112": "Seafood",
    "113": "Dairy products",
    "114": "Fruit and vegetables",
    "115": "Other food products",
    "116": "Grain and cereal products",
    "117": "Bakery products",
    "118": "Sugar and confectionery",
    "119": "Other food products",
}

# Plain names for the manufacturing subdivisions on the slope chart
SUBDIVISION_NAMES = {
    "11": "Food products",
    "12": "Drinks and tobacco",
    "13": "Textiles, clothing and footwear",
    "14": "Wood products",
    "15": "Paper products",
    "16": "Printing",
    "17": "Petroleum and coal products",
    "18": "Chemicals",
    "19": "Plastic and rubber products",
    "20": "Glass, cement and bricks",
    "21": "Metals",
    "22": "Metal products",
    "23": "Transport equipment",
    "24": "Machinery and equipment",
    "25": "Furniture and other",
}

# Country names in the export data -> names on the page (and in country_centroids.csv)
COUNTRY_NAMES = {
    "United States of America": "United States",
    "Korea, Republic of (South)": "South Korea",
    "Hong Kong (SAR of China)": "Hong Kong",
    "Viet Nam": "Vietnam",
    "China (excludes SARs and Taiwan)": "China",
    "Taiwan": "Taiwan",
    "Turkiye": "Türkiye",
}


def financial_year(year_ending_june: int) -> str:
    """2025 -> '2024 to 2025'. Written out in full, with no dash, as on the page."""
    return f"{year_ending_june - 1} to {year_ending_june}"


def save(df: pd.DataFrame, name: str) -> None:
    path = CLEAN / name
    df.to_csv(path, index=False, float_format="%.2f")
    print(f"  wrote {path.relative_to(ROOT)}  ({len(df)} rows, {path.stat().st_size / 1024:.1f} KB)")


def update_key_numbers(new: dict) -> None:
    path = CLEAN / "key_numbers.json"
    current = json.loads(path.read_text()) if path.exists() else {}
    current.update(new)
    path.write_text(json.dumps(current, indent=2))


# ---------------------------------------------------------------------------
# 1. ABS Australian Industry: manufacturing time series by subdivision
# ---------------------------------------------------------------------------
def clean_manufacturing_time_series():
    path = RAW / "81550TSSDIVC.xlsx"
    print("Manufacturing time series")
    frames = []
    for sheet in ("Data1", "Data2"):
        raw = pd.read_excel(path, sheet_name=sheet, header=None)
        body = raw.iloc[10:].copy()  # rows 1-9 are ABS metadata
        body.columns = ["Date"] + list(raw.iloc[0, 1:])
        frames.append(body.melt(id_vars="Date", var_name="Description", value_name="Value"))
    ts = pd.concat(frames).dropna()
    ts["Value"] = pd.to_numeric(ts["Value"], errors="coerce")
    ts["Year ending June"] = pd.to_datetime(ts["Date"]).dt.year

    parts = ts["Description"].astype(str).str.split(";").apply(lambda p: [x.strip() for x in p if x.strip()])
    ts["Measure"] = parts.str[0]
    ts["Industry"] = parts.str[1]
    ts = ts[parts.str.len() == 2]  # drops off-June adjusted and state series
    ts = ts[ts["Measure"] == "Industry value added"]
    ts["Code"] = ts["Industry"].str.extract(r"^(\d\d) ")[0]

    total = ts[ts["Industry"] == "Manufacturing"].set_index("Year ending June")["Value"]
    food = ts[ts["Code"] == "11"].set_index("Year ending June")["Value"]

    rows = []
    for year in sorted(total.index):
        for name, value in [("Food product manufacturing", food[year]),
                            ("All other manufacturing", total[year] - food[year])]:
            rows.append({"Year": financial_year(year), "Year ending June": year, "Industry": name,
                         "Measure": "Industry value added (million dollars)", "Value": value})
    save(pd.DataFrame(rows), "manufacturing_trend.csv")

    first, last = total.index.min(), total.index.max()
    subs = ts.dropna(subset=["Code"])
    rows = []
    for year in (first, last):
        for _, r in subs[subs["Year ending June"] == year].iterrows():
            rows.append({"Industry": SUBDIVISION_NAMES[r["Code"]], "Year": financial_year(year),
                         "Share of manufacturing (per cent)": r["Value"] / total[year] * 100})
    save(pd.DataFrame(rows), "manufacturing_share.csv")

    growth_food = food[last] / food[first] * 100 - 100
    growth_other = (total[last] - food[last]) / (total[first] - food[first]) * 100 - 100
    print(f"  food value added {first}->{last}: +{growth_food:.0f}%, other manufacturing: +{growth_other:.0f}%")
    update_key_numbers({"stat-share": f"{food[last] / total[last] * 100:.0f}%"})


# ---------------------------------------------------------------------------
# 2. ABS Australian Industry cube: value added and workers by food group, 2024-25
# ---------------------------------------------------------------------------
def clean_food_groups_cube():
    path = RAW / "81550DO003_202425.xlsx"
    print("Manufacturing cube (food groups)")
    t = pd.read_excel(path, sheet_name="Table_1", header=None)
    # Columns: 1-3 employment, 4-6 wages, 7-9 sales, 10-12 value added (2022-23 to 2024-25)
    assert "value added" in str(t.iloc[4, 10]).lower() and str(t.iloc[5, 12]) == "2024-25"
    groups = t[t[0].astype(str).str.match(r"^11[1-9] ")].copy()
    groups["Code"] = groups[0].str[:3]
    groups["Industry"] = groups["Code"].map(FOOD_GROUPS)
    by_cat = groups.groupby("Industry").agg(value=(12, "sum"), workers=(3, "sum"))
    share = by_cat["value"] / by_cat["value"].sum() * 100

    squares = share.astype(int)  # largest remainder rounding -> exactly 100 squares
    for cat in (share - squares).sort_values(ascending=False).index[: 100 - squares.sum()]:
        squares[cat] += 1
    order = share.sort_values(ascending=False).index.tolist()
    order.remove("Other food products")
    order.append("Other food products")
    rows, n = [], 0
    for cat in order:
        for _ in range(int(squares[cat])):
            rows.append({"Square": n, "Industry": cat, "Share (per cent)": share[cat],
                         "Value added (million dollars)": by_cat.loc[cat, "value"],
                         "Workers": by_cat.loc[cat, "workers"]})
            n += 1
    save(pd.DataFrame(rows), "food_waffle.csv")
    print(by_cat.assign(share=share.round(1)).sort_values("value", ascending=False).to_string())

    food_workers = t[t[0].astype(str).str.startswith("11 Food")].iloc[0, 3]
    update_key_numbers({"stat-jobs": f"{int(food_workers):,}"})


# ---------------------------------------------------------------------------
# 3. ABS Labour Force Detailed, EQ06: workers by industry group and state
# ---------------------------------------------------------------------------
def clean_eq06():
    path = RAW / "EQ06.xlsx"
    print("Labour Force EQ06 (large file, takes a minute)")
    raw = pd.read_excel(path, sheet_name="Data 1", header=3, usecols=range(6))
    raw.columns = ["Date", "Sex", "State", "Industry group", "Full time", "Part time"]
    raw["Workers"] = raw["Full time"] + raw["Part time"]  # thousands
    raw["Code"] = raw["Industry group"].astype(str).str[:3]
    manu = raw[raw["Code"].str.match(r"^(1[1-9]|2[0-5])\d$")].copy()  # ANZSIC groups 111-259
    manu["Date"] = pd.to_datetime(manu["Date"])
    manu["Year"] = manu["Date"].dt.year
    q = manu.groupby(["Date", "Year", "State", "Code"], as_index=False)["Workers"].sum()  # sum over sex

    quarters = q.groupby("Year")["Date"].nunique()
    full_years = quarters[quarters == 4].index
    q = q[q["Year"].isin(full_years) & (q["Year"] >= 2006)]
    food = q[q["Code"].isin(FOOD_GROUPS)].assign(Industry=lambda d: d["Code"].map(FOOD_GROUPS))

    # National yearly averages by food industry
    nat = (food.groupby(["Date", "Year", "Industry"])["Workers"].sum()
           .groupby(["Year", "Industry"]).mean().reset_index())
    base = nat[nat["Year"] == 2006].set_index("Industry")["Workers"]
    nat["Change since 2006 (per cent)"] = (nat["Workers"] / nat["Industry"].map(base) - 1) * 100
    nat["Rank"] = nat.groupby("Year")["Workers"].rank(ascending=False, method="first").astype(int)
    save(nat.rename(columns={"Workers": "Workers (thousands)"}), "food_jobs_by_industry.csv")

    # States by year, for the map's year slider
    st_food = (food.groupby(["Date", "Year", "State", "Industry"])["Workers"].sum()
               .groupby(["Year", "State", "Industry"]).mean().reset_index())
    st_all = (food.groupby(["Date", "Year", "State"])["Workers"].sum()
              .groupby(["Year", "State"]).mean().reset_index().assign(Industry="All food industries"))
    st_manu = q.groupby(["Date", "Year", "State"])["Workers"].sum().groupby(["Year", "State"]).mean()
    states = pd.concat([st_all, st_food], ignore_index=True)
    states["Share of state factory jobs (per cent)"] = (
        states["Workers"].values / st_manu.loc[list(zip(states["Year"], states["State"]))].values * 100)
    states = states.rename(columns={"Workers": "Workers (thousands)"})
    save(states, "food_jobs_by_state.csv")

    # Fix the map's colour classes per industry across all years, and set the slider range
    tops = states.groupby("Industry")["Share of state factory jobs (per cent)"].max()
    nice = lambda v: int(-(-v // 5) * 5)  # round up to the next 5
    expr = " : ".join(f"industry == '{k}' ? [0, {nice(v)}]" for k, v in tops.items()) + " : [0, 50]"
    spec_path = ROOT / "specs" / "7_states_choropleth.vg.json"
    spec = json.loads(spec_path.read_text())
    year_param = next(p for p in spec["params"] if p["name"] == "year")
    year_param["bind"]["min"], year_param["bind"]["max"] = int(states["Year"].min()), int(states["Year"].max())
    year_param["value"] = int(states["Year"].max())
    for layer in spec["layer"]:
        scale = layer.get("encoding", {}).get("color", {}).get("scale")
        if scale and scale.get("type") == "quantize":
            scale["domain"] = {"expr": expr}
    spec_path.write_text(json.dumps(spec, indent=2, ensure_ascii=False))
    print("  map classes:", {k: nice(v) for k, v in tops.items()})
    print("  years:", int(states["Year"].min()), "to", int(states["Year"].max()))


# ---------------------------------------------------------------------------
# 4. QGSO exports by industry and country: read the pivot table's cache
# ---------------------------------------------------------------------------
def read_pivot_cache(path: Path, keep):
    """Yield (field values) for every record in the workbook's pivot cache that keep() accepts."""
    ns = "{http://schemas.openxmlformats.org/spreadsheetml/2006/main}"
    with zipfile.ZipFile(path) as z:
        definition = ET.fromstring(z.read("xl/pivotCache/pivotCacheDefinition1.xml"))
        shared = []
        for field in definition.iter(ns + "cacheField"):
            items = field.find(ns + "sharedItems")
            shared.append([i.get("v") for i in items] if items is not None and len(items) else None)
        with z.open("xl/pivotCache/pivotCacheRecords1.xml") as f:
            for _, el in ET.iterparse(f):
                if el.tag == ns + "r":
                    raw = [c.get("v") for c in el]
                    rec = [shared[i][int(v)] if shared[i] and el[i].tag == ns + "x" else v
                           for i, v in enumerate(raw)]
                    if keep(rec):
                        yield rec
                    el.clear()


def clean_exports():
    path = RAW / "qgso_exports_anzsic_country.xlsx"
    print("Exports (pivot cache)")
    # fields: year, state of origin, ANZSIC 2, 3, 4-digit, country, value, weight
    keep = lambda r: r[2].startswith("11 ") and r[1] != "Foreign, Re-exports"
    totals = defaultdict(float)
    by_year = defaultdict(float)
    for rec in read_pivot_cache(path, keep):
        by_year[rec[0]] += float(rec[6])
        if rec[0] == "2024–25":  # latest complete (non-preliminary) financial year
            group = FOOD_GROUPS[rec[3][:3]]
            totals[(group, rec[5])] += float(rec[6])
    df = pd.DataFrame([{"Industry": g, "Country": c, "Value": v} for (g, c), v in totals.items()])
    df["Country"] = df["Country"].replace(COUNTRY_NAMES)
    df = df[~df["Country"].isin(["No Country Details", "French Polynesia"])]  # not on the world map
    all_food = df.groupby("Country", as_index=False)["Value"].sum().assign(Industry="All food industries")
    df = pd.concat([all_food, df.groupby(["Industry", "Country"], as_index=False)["Value"].sum()])
    df["Exports (million dollars)"] = df["Value"] / 1e6
    df["Rank"] = df.groupby("Industry")["Value"].rank(ascending=False, method="first").astype(int)
    df = df[df["Rank"] <= 15].drop(columns="Value")

    pts = pd.read_csv(GEO / "country_centroids.csv")
    extra = pd.DataFrame([{"id": 702, "country": "Singapore", "lon": 103.8, "lat": 1.35},
                          {"id": 344, "country": "Hong Kong", "lon": 114.2, "lat": 22.3}])
    pts = pd.concat([pts, extra]).rename(columns={"id": "Country number", "lon": "Longitude", "lat": "Latitude"})
    df = df.merge(pts, left_on="Country", right_on="country", how="left").drop(columns="country")
    missing = df[df["Longitude"].isna()]["Country"].unique()
    if len(missing):
        print("  WARNING no map position for:", missing)
    df = df.dropna(subset=["Longitude"]).sort_values(["Industry", "Rank"])
    save(df, "food_exports.csv")

    years = {k: round(v / 1e9, 1) for k, v in sorted(by_year.items())}
    print("  food exports by year (billion dollars):", years)
    update_key_numbers({"stat-exports": f"${years['2024–25']:.1f} billion"})


# ---------------------------------------------------------------------------
# 5. ABARES dairy products manufactured each year
# ---------------------------------------------------------------------------
def clean_dairy_products():
    path = RAW / "abares_dairy_2024_25.xls"
    print("ABARES dairy products")
    t = pd.read_excel(path, sheet_name="Dairy1", header=None)
    head = t.iloc[:10].T
    head.columns = ["Table", "Activity", "Detail", "Commodity", "Reporter", "Location", "Measure", "Unit", "Frequency", "Notes"]
    wanted = {"Cheese": "Cheese", "Butter": "Butter", "Skim milk powder": "Skim milk powder",
              "Wholemilk powder": "Whole milk powder"}
    cols = head[(head["Activity"] == "Production") & head["Detail"].isna()
                & head["Commodity"].isin(wanted) & (head["Unit"] == "kt")].index
    years = t.iloc[11:, 0].astype(str)
    rows = []
    for c in cols:
        product = wanted[head.loc[c, "Commodity"]]
        for y, v in zip(years, t.iloc[11:, c]):
            v = pd.to_numeric(v, errors="coerce")
            if pd.notna(v) and re.match(r"\d{4}–\d{2}", y):
                rows.append({"Year": financial_year(int(y[:4]) + 1), "Year ending June": int(y[:4]) + 1, "Product": product,
                             "Production (thousand tonnes)": v})
    df = pd.DataFrame(rows)
    save(df, "dairy_products.csv")
    print(df.groupby("Product")["Year ending June"].agg(["min", "max"]).to_string())


# ---------------------------------------------------------------------------
# 6. ABS apparent consumption: grams per person per day, 2018-19 and 2023-24
# ---------------------------------------------------------------------------
CONSUMPTION_GROUPS = {  # ABS major food group -> plain label on the chart
    "Milk products and dishes": "Milk, cheese and yoghurt",
    "Vegetable products and dishes": "Vegetables",
    "Meat, poultry and game products and dishes": "Meat and chicken",
    "Fruit products and dishes": "Fruit",
    "Cereals and cereal products": "Bread, rice, pasta and flour",
    "Cereal based products and dishes": "Cakes, biscuits and pizza",
    "Savoury sauces and condiments": "Sauces and condiments",
    "Confectionery and cereal/nut/fruit/seed bars": "Lollies, chocolate and muesli bars",
    "Sugar products and dishes": "Sugar, honey and jam",
    "Fats and oils": "Butter, margarine and oils",
    "Egg products and dishes": "Eggs",
    "Dairy and meat substitutes": "Plant-based milk and meat",
    "Seed and nut products and dishes": "Nuts and seeds",
    "Snack foods": "Chips and savoury snacks",
    "Fish and seafood products and dishes": "Fish and seafood",
}


def clean_consumption():
    path = RAW / "4316DO001_202324.xlsx"
    print("Apparent consumption")
    t = pd.read_excel(path, sheet_name="Table 1.1", header=None)
    assert str(t.iloc[7, 9]).startswith("2018-19") and str(t.iloc[7, 14]).startswith("2023-24")
    major = t[(t[0] == "Major") & t[2].isin(CONSUMPTION_GROUPS)]
    rows = []
    for _, r in major.iterrows():
        for year, col in (("2018 to 2019", 9), ("2023 to 2024", 14)):
            rows.append({"Food group": CONSUMPTION_GROUPS[r[2]], "Food group (full name)": r[2],
                         "Year": year, "Grams per person per day": r[col]})
    df = pd.DataFrame(rows)
    big = df[df["Year"] == "2018 to 2019"].set_index("Food group")["Grams per person per day"] >= 100
    df["Panel"] = df["Food group"].map(lambda g: "Everyday staples (over 100 grams a day)" if big[g]
                                       else "Smaller items (under 100 grams a day)")
    save(df, "food_consumption.csv")


# ---------------------------------------------------------------------------
# 7. Tables transcribed from PDF reports, plus map positions
# ---------------------------------------------------------------------------
DAIRY_REGION_PLACES = {  # region: (longitude, latitude, label longitude, label latitude, label side)
    "Gippsland": (146.6, -38.3, 147.9, -39.2, "right"),
    "Western Victoria": (142.7, -38.1, 141.6, -39.0, "left"),
    "Murray": (145.4, -36.0, 146.6, -35.2, "right"),
    "Tasmania": (146.4, -41.4, 147.7, -42.2, "right"),
    "New South Wales": (150.6, -33.2, 151.7, -33.2, "right"),
    "South Australia": (139.0, -35.0, 137.9, -34.6, "left"),
    "Western Australia": (116.0, -33.2, 114.8, -31.4, "right"),
    "Subtropical": (152.4, -27.4, 153.4, -27.4, "right"),
}


def clean_dairy_regions():
    print("Dairy regions")
    df = pd.read_csv(RAW / "dairy_regions_transcribed.csv")
    for i, col in enumerate(["Longitude", "Latitude", "Label longitude", "Label latitude", "Label side"]):
        df[col] = df["Region"].map(lambda r: DAIRY_REGION_PLACES[r][i])
    df["Share of national milk (per cent)"] = df["Milk produced (million litres)"] / df["Milk produced (million litres)"].sum() * 100
    df["Change in milk since 2021 (per cent)"] = (df["Milk produced (million litres)"] / df["Milk produced 2021 (million litres)"] - 1) * 100
    df["Region (full name)"] = df["Region"].replace({"Subtropical": "Subtropical (south-east Queensland and northern New South Wales)"})
    save(df, "dairy_regions.csv")


def clean_wine_regions():
    print("Wine regions")
    save(pd.read_csv(RAW / "wine_regions_transcribed.csv"), "wine_regions.csv")


if __name__ == "__main__":
    clean_manufacturing_time_series()
    clean_food_groups_cube()
    clean_dairy_products()
    clean_consumption()
    clean_dairy_regions()
    clean_wine_regions()
    clean_exports()
    clean_eq06()
    total = sum(p.stat().st_size for p in CLEAN.glob("*")) / 1024
    print(f"Total clean data: {total:.0f} KB")