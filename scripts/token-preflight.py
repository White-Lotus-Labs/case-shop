#!/usr/bin/env python3
"""Validate token identities and optionally read live NEAR state. Never signs transactions."""
import argparse
import concurrent.futures
import json
from pathlib import Path
import subprocess
import sys

ROOT = Path(__file__).resolve().parents[1]
LEGACY = {"SHITZU", "RHEA", "AURORA"}
DERIVATIVES = {"WNEAR", "STNEAR", "LINEAR", "RNEAR"}


def validate(registry):
    if registry["network"] != "testnet" or registry["ownerId"] != "needmore_1_near.testnet":
        raise ValueError("Unexpected deployment network or inventory owner")
    included = [t for t in registry["tokens"] if t["selection"] == "included"]
    if len({t["asset"] for t in registry["tokens"]}) != len(registry["tokens"]):
        raise ValueError("Duplicate asset identity")
    if len({t["contractId"] for t in included}) != len(included):
        raise ValueError("Duplicate mock account")
    for t in registry["tokens"]:
        if t["selection"] == "excluded":
            if t["intendedCases"] or not t["reason"]:
                raise ValueError(f"Excluded asset has case allocation: {t['asset']}")
            continue
        asset = t["asset"]
        expected_id = (f"iroh-test-{asset.lower()}.testnet" if asset in LEGACY
                       else f"{asset.lower()}.{registry['parentId']}")
        if t["contractId"] != expected_id:
            raise ValueError(f"Unexpected mock account: {asset}")
        decimals = t["decimals"]
        if not isinstance(decimals, int) or isinstance(decimals, bool) or not 0 <= decimals <= 24:
            raise ValueError(f"Invalid precision: {asset}")
        if t["totalSupplyRaw"] != str(int(registry["fixedSupplyWhole"]) * 10 ** decimals):
            raise ValueError(f"Incorrect fixed supply: {asset}")
        if decimals != (6 if asset in LEGACY else t["canonical"]["decimals"]):
            raise ValueError(f"Canonical precision differs: {asset}")
        if t["unofficial"] is not True or t["hasMonetaryValue"] is not False:
            raise ValueError(f"Mock disclaimer missing: {asset}")
        if "No monetary value" not in t["disclaimer"]:
            raise ValueError(f"No-value disclosure missing: {asset}")
        if asset in DERIVATIVES and "No yield, backing, or redemption" not in t["disclaimer"]:
            raise ValueError(f"Derivative disclosure missing: {asset}")
        if not t["canonical"]["sources"] or not t["canonical"]["blockHeight"]:
            raise ValueError(f"Canonical identity lacks evidence: {asset}")
    return included



def main():
    parser = argparse.ArgumentParser(description="Validate the Testnet mock token registry offline.")
    parser.add_argument("--registry", type=Path, default=ROOT / "config/tokens.testnet.json")
    parser.add_argument("--validate-only", action="store_true")
    args = parser.parse_args()
    try:
        registry = json.loads(args.registry.read_text())
        included = validate(registry)
        print(json.dumps({"network": "testnet", "included": len(included), "readOnly": True}))
    except (KeyError, ValueError, OSError) as error:
        print(str(error), file=sys.stderr)
        raise SystemExit(1)

if __name__ == "__main__":
    main()
