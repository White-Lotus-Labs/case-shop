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
    <ul className={`flex flex-col ${dense ? "gap-1.5" : "gap-2"}`}>
      {assets.map((asset) => (
        <li
          key={asset.contractId ?? "native"}
          className={`tnum flex items-center justify-between gap-2 rounded-lg bg-black/25 px-2.5 py-1.5 border border-purple-500/15 ${dense ? "text-[12px]" : "text-[13px]"}`}
        >
          <div className="flex items-center gap-2 min-w-0">
            {asset.symbol === "NEAR" ? (
              <img src="/near-badge.webp" alt="NEAR" className="size-5 shrink-0 object-contain" />
            ) : (
              <span className="flex size-5 shrink-0 items-center justify-center rounded-full bg-purple-500/20 text-purple-300 font-bold text-[10px] border border-purple-500/30">
                ◈
              </span>
            )}
            <span
              className="min-w-0 font-medium truncate"
              title={asset.contractId ?? "Native Testnet NEAR"}
            >
              {formatAmount(asset.amount, asset.decimals)}{" "}
              <span className="text-white font-semibold">{asset.symbol}</span>
            </span>
          </div>
          <span
            className={`shrink-0 text-[11px] font-semibold px-2 py-0.5 rounded-full ${
              asset.paid
                ? "bg-[#00EC97]/15 text-[#00EC97] border border-[#00EC97]/30"
                : "bg-purple-500/15 text-purple-300 border border-purple-500/30"
            }`}
          >
            {asset.paid ? "Transferred" : "Pending"}
          </span>
        </li>
      ))}
    </ul>
  );
}
