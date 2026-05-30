import os
import json
import requests
import pandas as pd
from datetime import datetime, timezone

# ── ERP Configuration ─────────────────────────────────────────────────────────
# On GCP: set ERP_BASE_URL to the proxy URL (e.g. https://your-ngrok-url.ngrok.io/...)
# Locally: falls back to the direct ERP address
BASE_URL        = os.environ.get("ERP_BASE_URL", "http://190.92.175.131:8080/DigiBizzErpApi/api/UnknownCallerApi/GetPowerBiReports")
API_TOKEN       = os.environ.get("API_TOKEN",    "aaaqqqwww111")
COMPANY_YEAR_ID = os.environ.get("COMPANY_YEAR_ID", "83")
PROXY_KEY       = os.environ.get("PROXY_KEY", "")

ISSUE_PROCESSES = [
    "Cut to Pack Issue",
    "Cut to Stitching Issue",
    "Only Stitching Issue",
]
GRN_PROCESSES = [
    "Cut To Pack Dispatch",
    "Job Work Stitching GRN",
]

MERGE_KEYS          = ["SECTION", "DESIGN_NO", "SIZE", "LOT_NO"]
DEBIT_COMPANY_YEARS = ["83"]

CACHE_PATH = os.path.join(os.path.dirname(os.path.abspath(__file__)), "ppc-dashboard", "backend", "cache.json")

print("✅ Configuration loaded.")


# ── Step 1 — Fetch ERP Data ───────────────────────────────────────────────────
def fetch_erp_data(view_name: str, company_year_id: str) -> pd.DataFrame:
    headers = {
        "Report-Api-Token": API_TOKEN,
        "ViewName":         view_name,
        "CompanyYearId":    company_year_id,
        "Accept":           "application/json",
    }
    if PROXY_KEY:
        headers["x-proxy-key"] = PROXY_KEY
    try:
        resp = requests.get(BASE_URL, headers=headers, timeout=60)
        resp.raise_for_status()
        data = resp.json()
        if isinstance(data, list):
            return pd.DataFrame(data)
        elif isinstance(data, dict):
            records = (
                data.get("data")
                or data.get("Data")
                or data.get("records")
                or data.get("Records")
                or [data]
            )
            return pd.DataFrame(records)
        else:
            print(f"  ⚠️ Unexpected response type: {type(data)}")
            return pd.DataFrame()
    except requests.exceptions.HTTPError as e:
        print(f"  ✗ HTTP Error: {e}")
    except requests.exceptions.ConnectionError:
        print(f"  ✗ Connection Error: Could not reach the server.")
    except requests.exceptions.Timeout:
        print(f"  ✗ Request timed out.")
    except json.JSONDecodeError:
        print(f"  ✗ Invalid JSON in response.")
    return pd.DataFrame()


print("📡 Fetching Job Work Issue & GRN data...")
df = fetch_erp_data(
    view_name="View_Dboard_Trans_JOB_WORK_ISSUE_RECEIVE_For_Test_BI",
    company_year_id=COMPANY_YEAR_ID,
)

if df.empty:
    raise RuntimeError("❌ No data fetched — check API connection and credentials.")

df["PROCESS"] = df["PROCESS"].astype(str).str.strip()
print(f"✅ Fetched {len(df):,} records  |  {len(df.columns)} columns")


# ── Step 2 — Split into Issue & GRN ──────────────────────────────────────────
df_issue = df[df["PROCESS"].isin(ISSUE_PROCESSES)].copy()
df_grn   = df[df["PROCESS"].isin(GRN_PROCESSES)].copy()

print(f"📤 Issue records : {len(df_issue):,}")
print(f"📥 GRN records   : {len(df_grn):,}")

unclassified = df[~df["PROCESS"].isin(ISSUE_PROCESSES + GRN_PROCESSES)]["PROCESS"].unique()
if len(unclassified):
    print(f"\n⚠️  Unclassified PROCESS values:")
    for p in unclassified:
        print(f"   → '{p}'")


# ── Step 3 — Rename Columns & Parse Dates ────────────────────────────────────
df_issue = df_issue.rename(columns={"VOUCHER_DATE": "Issue_Date", "ISSUE_QTY": "Issue_QTY"})
df_grn   = df_grn.rename(columns={"VOUCHER_DATE": "GRN_DATE",   "ISSUE_QTY": "Receive_QTY"})

df_issue["Issue_Date"] = pd.to_datetime(df_issue["Issue_Date"], errors="coerce")
df_grn["GRN_DATE"]     = pd.to_datetime(df_grn["GRN_DATE"],     errors="coerce")

for col in MERGE_KEYS:
    df_issue[col] = df_issue[col].astype(str).str.strip()
    df_grn[col]   = df_grn[col].astype(str).str.strip()

print("✅ Columns renamed and dates parsed.")


# ── Step 4 — Aggregate by Merge Keys ─────────────────────────────────────────
issue_grp = df_issue.groupby(MERGE_KEYS, as_index=False).agg(
    ISSUE_PROCESS   = ("PROCESS",    "first"),
    PARTY_NAME      = ("PARTY_NAME", "first"),
    ISSUE_DATE      = ("Issue_Date", "min"),
    TOTAL_ISSUE_QTY = ("Issue_QTY",  "sum"),
    ALTER_QTY       = ("ALTER_QTY",  "sum"),
    RATE            = ("RATE",       "mean"),
    TOTAL_AMOUNT    = ("AMOUNT",     "sum"),
)

grn_grp = df_grn.groupby(MERGE_KEYS, as_index=False).agg(
    GRN_PROCESS   = ("PROCESS",     "first"),
    GRN_DATE      = ("GRN_DATE",    "max"),
    TOTAL_GRN_QTY = ("Receive_QTY", "sum"),
)

print(f"✅ Issue groups : {len(issue_grp):,}")
print(f"✅ GRN groups   : {len(grn_grp):,}")


# ── Step 5 — Merge & Compute Balance / Status ─────────────────────────────────
df_merged = pd.merge(issue_grp, grn_grp, on=MERGE_KEYS, how="left")
df_merged["TOTAL_GRN_QTY"] = df_merged["TOTAL_GRN_QTY"].fillna(0)

df_merged["BALANCE_QTY"] = (
    df_merged["TOTAL_ISSUE_QTY"] - df_merged["TOTAL_GRN_QTY"]
).clip(lower=0)

df_merged["STATUS"] = df_merged["BALANCE_QTY"].apply(
    lambda x: "Pending" if x > 0 else "Completed"
)

today = pd.Timestamp.today().normalize()
df_merged["DAYS_TAKEN"] = (
    df_merged["GRN_DATE"].fillna(today) - df_merged["ISSUE_DATE"]
).dt.days.clip(lower=0).fillna(0).astype(int)


def delay_bucket(days: int) -> str:
    if days <= 3:    return "0-3 Days"
    elif days <= 7:  return "4-7 Days"
    elif days <= 15: return "8-15 Days"
    else:            return "15+ Days"


df_merged["DELAY_BUCKET"] = df_merged["DAYS_TAKEN"].apply(delay_bucket)

df_merged = df_merged[[
    "LOT_NO", "DESIGN_NO", "SECTION", "SIZE",
    "PARTY_NAME",
    "ISSUE_PROCESS", "ISSUE_DATE",  "TOTAL_ISSUE_QTY", "ALTER_QTY", "RATE", "TOTAL_AMOUNT",
    "GRN_PROCESS",   "GRN_DATE",    "TOTAL_GRN_QTY",
    "BALANCE_QTY", "STATUS", "DAYS_TAKEN", "DELAY_BUCKET",
]]
df_merged = df_merged.sort_values("ISSUE_DATE").reset_index(drop=True)

print(f"✅ Merged records  : {len(df_merged):,}")
print(f"📋 Pending         : {(df_merged['STATUS'] == 'Pending').sum():,}")
print(f"📋 Completed       : {(df_merged['STATUS'] == 'Completed').sum():,}")


# ── Step 6 — Extract Vendor List ──────────────────────────────────────────────
vendor_list = sorted(
    df_issue["PARTY_NAME"]
    .astype(str).str.strip().str.upper()
    .replace("", pd.NA).dropna().unique().tolist()
)
print(f"✅ Total Vendors : {len(vendor_list)}")


# ── Step 7 — Fetch Debit Note Data ────────────────────────────────────────────
debit_frames = []
for cy in DEBIT_COMPANY_YEARS:
    print(f"📡 Fetching Debit Notes for CompanyYearId: {cy}...")
    frame = fetch_erp_data(
        view_name="View_Dboard_Trans_Debit_Note_Data_For_BI",
        company_year_id=cy,
    )
    if not frame.empty:
        frame["CompanyYearId"] = cy
        debit_frames.append(frame)
        print(f"   ✓ {len(frame):,} records")
    else:
        print(f"   ⚠️ No data returned for CompanyYearId {cy}")

if not debit_frames:
    raise RuntimeError("❌ No Debit Note data fetched — check API connection.")

df_debit_raw = pd.concat(debit_frames, ignore_index=True)
print(f"\n✅ Total Debit Note records : {len(df_debit_raw):,}")


# ── Step 8 — Clean & Filter Debit Notes ──────────────────────────────────────
df_debit = df_debit_raw.copy()

if "PAREY_NAME" in df_debit.columns and "PARTY_NAME" not in df_debit.columns:
    df_debit = df_debit.rename(columns={"PAREY_NAME": "PARTY_NAME"})

df_debit["PARTY_NAME"]  = df_debit["PARTY_NAME"].astype(str).str.strip().str.upper()
df_merged["PARTY_NAME"] = df_merged["PARTY_NAME"].astype(str).str.strip().str.upper()

cols_to_drop = [c for c in ["VOUCHER_NO", "BILL_NO", "DESIGN", "SIZE", "LOT_NO"] if c in df_debit.columns]
df_debit = df_debit.drop(columns=cols_to_drop)

rename_map = {}
if "VOUCHER_DATE" in df_debit.columns: rename_map["VOUCHER_DATE"] = "DEBIT_DATE"
if "QTY"          in df_debit.columns: rename_map["QTY"]          = "Debit_Qty"
if "RATE"         in df_debit.columns: rename_map["RATE"]         = "Debit_Rate_Per_Pcs"
if "NET_AMOUNT"   in df_debit.columns: rename_map["NET_AMOUNT"]   = "Debit_Note_Amount"
df_debit = df_debit.rename(columns=rename_map)

df_debit["DEBIT_DATE"] = pd.to_datetime(df_debit["DEBIT_DATE"], errors="coerce")
df_debit = df_debit[df_debit["PARTY_NAME"].isin(vendor_list)].copy()

all_debit_vendors = (
    df_debit_raw["PAREY_NAME"] if "PAREY_NAME" in df_debit_raw.columns
    else df_debit_raw["PARTY_NAME"]
).astype(str).str.strip().str.upper().unique()

unmatched = set(all_debit_vendors) - set(vendor_list)
if unmatched:
    print(f"⚠️  {len(unmatched)} vendor(s) in Debit Notes NOT found in Issue data.")

print(f"✅ Debit Note records after filtering : {len(df_debit):,}")


# ── Step 9 — Save cache.json for Node.js server ───────────────────────────────
df_merged["GRN_DATE"] = pd.to_datetime(df_merged["GRN_DATE"], errors="coerce")
df_final = df_merged.reset_index(drop=True)

cache = {
    "generated_at":   datetime.now(timezone.utc).isoformat(),
    "job_work_report": json.loads(df_final.to_json(orient="records", date_format="iso")),
    "debit_notes":     json.loads(df_debit.reset_index(drop=True).to_json(orient="records", date_format="iso")),
}

with open(CACHE_PATH, "w", encoding="utf-8") as f:
    json.dump(cache, f)

print(f"\n🎉 Done!")
print(f"   job_work_report : {len(df_final):,} records")
print(f"   debit_notes     : {len(df_debit):,} records")
print(f"   cache saved  → {CACHE_PATH}")
print(f"   generated at    : {cache['generated_at']}")
df.to_csv('job_work_issue_receive_raw.csv', index=False)