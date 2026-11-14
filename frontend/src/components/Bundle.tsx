import type { BundleAsset } from "@/lib/api";
import { formatAmount } from "@/lib/cases";

/** Only real, selected on-chain rewards are supplied here. */
export function BundleList({
  assets,
  dense = false,
}: {
  assets: BundleAsset[];
  dense?: boolean;
}) {
  return (
    <ul className={`flex flex-col ${dense ? "gap-1" : "gap-1.5"}`}>
      {assets.map((asset) => (
        <li
          key={asset.contractId ?? "native"}
          className={`tnum flex items-center gap-2 ${dense ? "t-caption" : "t-footnote"}`}
        >
          <span
            className="min-w-0 flex-1 truncate"
            title={asset.contractId ?? "Native Testnet NEAR"}
          >
            {formatAmount(asset.amount, asset.decimals)}{" "}
            <span className="text-label-2">{asset.symbol}</span>
          </span>
          <span className={asset.paid ? "text-success" : "text-label-2"}>
            {asset.paid ? "Received" : "Pending"}
          </span>
        </li>
      ))}
    </ul>
  );
}
