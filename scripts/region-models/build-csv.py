"""
Build per-region CSV files of all Bedrock models with vendor, model_id, status.
Reads the {region}.json and {region}-profiles.json dumps in this folder and emits {region}.csv.

Status values:
- ACTIVE          : foundation model status=ACTIVE
- LEGACY          : foundation model status=LEGACY
- INFERENCE_PROFILE: a us./eu./ap./global. inference profile (always ACTIVE)
"""

import csv
import json
from pathlib import Path

HERE = Path(__file__).parent

REGIONS = [
    "us-east-1",
    "us-west-2",
    "eu-west-1",
    "eu-central-1",
    "ap-south-1",
    "ap-southeast-1",
    "ap-southeast-2",
    "ap-northeast-1",
]


def build_csv(region: str) -> None:
    fm_path = HERE / f"{region}.json"
    ip_path = HERE / f"{region}-profiles.json"
    out = HERE / f"{region}.csv"

    if not fm_path.exists():
        print(f"[skip] {region}: no foundation models JSON")
        return

    rows: list[tuple[str, str, str]] = []

    fm = json.loads(fm_path.read_text(encoding="utf-8"))
    for m in fm.get("modelSummaries", []):
        vendor = m.get("providerName", "")
        model_id = m.get("modelId", "")
        lifecycle = m.get("modelLifecycle", {}).get("status", "UNKNOWN")
        rows.append((vendor, model_id, lifecycle))

    if ip_path.exists():
        ip = json.loads(ip_path.read_text(encoding="utf-8"))
        for p in ip.get("inferenceProfileSummaries", []):
            pid = p.get("inferenceProfileId", "")
            # vendor from second segment (e.g. us.anthropic.claude-... -> anthropic)
            parts = pid.split(".")
            vendor = parts[1].capitalize() if len(parts) >= 2 else ""
            status = p.get("status", "ACTIVE")
            rows.append((vendor, pid, f"INFERENCE_PROFILE/{status}"))

    rows.sort(key=lambda r: (r[0].lower(), r[1].lower()))

    with out.open("w", newline="", encoding="utf-8") as f:
        w = csv.writer(f)
        w.writerow(["vendor", "model_id", "status"])
        w.writerows(rows)

    print(f"[ok] {region}: {len(rows)} rows -> {out.name}")


def main() -> None:
    for region in REGIONS:
        build_csv(region)


if __name__ == "__main__":
    main()
