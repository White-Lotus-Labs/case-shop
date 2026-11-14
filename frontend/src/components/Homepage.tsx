import { Button, Glyph } from "@/ui/kit";
import { CASES } from "@/lib/cases";
import { fmt } from "@/lib/cases";
import { tierOf } from "@/lib/tiers";

export function Homepage({
  onExploreCases,
  onConnectWallet,
  account,
}: {
  onExploreCases: () => void;
  onConnectWallet: () => void;
  account: string | null;
}) {
  return (
    <div className="appear mx-auto flex w-full max-w-[960px] flex-col gap-8 pb-16 pt-2">
      {/* Hero Banner & Title */}
      <div className="material-regular relative overflow-hidden rounded-[28px] border border-purple-500/35 p-6 shadow-[0_30px_90px_rgba(0,0,0,0.8),0_0_40px_rgba(157,78,221,0.25)] sm:p-10">
        <div className="absolute -right-20 -top-20 size-80 rounded-full bg-purple-600/15 blur-3xl pointer-events-none" />
        <div className="absolute -left-20 -bottom-20 size-80 rounded-full bg-[#00EC97]/10 blur-3xl pointer-events-none" />

        <div className="relative z-10 flex flex-col items-center text-center">
          {/* Fujitora Artwork Banner */}
          <div className="relative mb-6">
            <div className="absolute -inset-1 rounded-2xl bg-gradient-to-r from-[#9d4edd] to-[#00EC97] opacity-60 blur-lg" />
            <img
              src="/fujitora-banner.png"
              alt="Admiral Fujitora"
              className="relative h-44 sm:h-52 w-auto rounded-2xl object-cover border border-purple-400/40 shadow-2xl"
            />
          </div>

          <div className="inline-flex items-center gap-2 rounded-full bg-purple-500/15 px-3 py-1 text-[12px] font-mono text-[#00EC97] border border-purple-500/30 mb-3">
            <img src="/near-badge.webp" alt="NEAR" className="size-4 object-contain" />
            <span>POWERED BY NEAR PROTOCOL · TESTNET</span>
          </div>

          <h1 className="font-display text-[32px] sm:text-[46px] font-black tracking-wider text-white drop-shadow-[0_0_30px_rgba(157,78,221,0.5)]">
            Fujitora Case Shop
          </h1>

          <p className="font-display text-[16px] sm:text-[20px] font-bold text-[#00EC97] mt-2 max-w-2xl">
            Discover the thrill of case opening, powered by NEAR Protocol.
          </p>

          <p className="t-body mt-5 max-w-2xl text-label-2 text-[15px] sm:text-[17px] leading-relaxed">
            Fujitora Case Shop is an interactive Web3 gaming experience where players can explore five unique cases, each featuring different prices, rewards, and winning probabilities.
          </p>

          <p className="t-body mt-3 max-w-2xl text-label-2 text-[15px] sm:text-[17px] leading-relaxed">
            Connect your NEAR Testnet wallet, choose your case, and uncover rewards through blockchain-powered openings. Every outcome is determined by smart contracts, bringing transparency and fairness to the experience.
          </p>

          <p className="t-body mt-3 max-w-2xl text-label-2 text-[15px] sm:text-[17px] leading-relaxed">
            Collect your rewards directly in your wallet, track your previous openings, and explore the global history of other players.
          </p>

          <div className="my-7 rounded-2xl bg-[#0a0d26]/80 px-6 py-4 border border-purple-500/30 max-w-xl">
            <p className="font-display text-[15px] sm:text-[17px] font-bold text-white tracking-wide">
              Five unique cases. Endless possibilities. One click away from your next reward.
            </p>
          </div>

          {/* Action CTAs */}
          <div className="flex flex-wrap items-center justify-center gap-4">
            <Button
              variant="filled"
              size="large"
              onClick={onExploreCases}
              className="gap-2 px-8 text-[16px]"
            >
              <Glyph name="gravity" className="size-5" />
              <span>Enter Case Shop</span>
            </Button>
            {!account && (
              <Button
                variant="tinted"
                size="large"
                onClick={onConnectWallet}
                className="gap-2 px-8 text-[16px]"
              >
                <img src="/near-badge.webp" alt="NEAR" className="size-5 object-contain" />
                <span>Connect NEAR Wallet</span>
              </Button>
            )}
          </div>
        </div>
      </div>

      {/* Five Unique Cases Showcase */}
      <div className="flex flex-col gap-4">
        <div className="flex items-center justify-between px-2">
          <h2 className="font-display text-[20px] font-bold text-white flex items-center gap-2">
            <span className="size-2 rounded-full bg-[#00EC97]" />
            Five Unique Cases
          </h2>
          <span className="text-[12px] font-mono text-label-3">
            VERIFIED SMART CONTRACTS
          </span>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3.5">
          {CASES.map((item) => {
            const t = tierOf(item.id);
            return (
              <div
                key={item.id}
                onClick={onExploreCases}
                className="material-regular group flex flex-col justify-between rounded-[20px] p-4 border border-purple-500/20 hover:border-purple-400/50 hover:shadow-[0_0_25px_rgba(157,78,221,0.3)] transition-all cursor-pointer"
              >
                <div>
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-[11px] font-serif font-bold text-[#c4b5fd] bg-purple-500/20 px-2 py-0.5 rounded">
                      {t.kanji}
                    </span>
                    <span className="text-[10px] font-mono text-purple-300">
                      NCS-0{t.number}
                    </span>
                  </div>
                  <h3 className="font-display text-[15px] font-bold text-white group-hover:text-[#00EC97] transition-colors">
                    {t.name}
                  </h3>
                  <p className="text-[12px] text-label-3 line-clamp-2 mt-1 leading-snug">
                    {t.description}
                  </p>
                </div>
                <div className="mt-4 pt-3 border-t border-purple-500/15 flex items-center justify-between">
                  <span className="text-[11px] text-label-3 font-mono">Price</span>
                  <span className="font-display text-[13px] font-bold text-white flex items-center gap-1">
                    <img src="/near-badge.webp" alt="NEAR" className="size-3.5 object-contain" />
                    {fmt(item.price).replace(" NEAR", "")} <span className="text-[#00EC97] text-[11px]">NEAR</span>
                  </span>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Feature Highlights Grid */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <div className="material-regular rounded-[20px] p-5 border border-purple-500/20">
          <div className="flex size-10 items-center justify-center rounded-xl bg-purple-500/15 text-purple-300 border border-purple-500/30 mb-3">
            <Glyph name="near" className="size-5" />
          </div>
          <h3 className="font-display text-[16px] font-bold text-white">NEAR Smart Contracts</h3>
          <p className="text-[13px] text-label-2 mt-1.5 leading-relaxed">
            Every case opening is executed through provably fair smart contracts deployed natively on NEAR Protocol Testnet.
          </p>
        </div>

        <div className="material-regular rounded-[20px] p-5 border border-purple-500/20">
          <div className="flex size-10 items-center justify-center rounded-xl bg-[#00EC97]/15 text-[#00EC97] border border-[#00EC97]/30 mb-3">
            <Glyph name="sparkle" className="size-5" />
          </div>
          <h3 className="font-display text-[16px] font-bold text-white">Direct Wallet Payouts</h3>
          <p className="text-[13px] text-label-2 mt-1.5 leading-relaxed">
            Winnings in NEAR and partner tokens (SHITZU, BLACKDRAGON, NEKO, RHEA) are deposited atomically into your wallet.
          </p>
        </div>

        <div className="material-regular rounded-[20px] p-5 border border-purple-500/20">
          <div className="flex size-10 items-center justify-center rounded-xl bg-amber-500/15 text-amber-300 border border-amber-500/30 mb-3">
            <Glyph name="dice" className="size-5" />
          </div>
          <h3 className="font-display text-[16px] font-bold text-white">Transparent History</h3>
          <p className="text-[13px] text-label-2 mt-1.5 leading-relaxed">
            Track all previous openings in your personal vault and watch global openings settle on the blockchain in real time.
          </p>
        </div>
      </div>
    </div>
  );
}
