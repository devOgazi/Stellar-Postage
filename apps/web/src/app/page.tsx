import Link from 'next/link';

export default function HomePage() {
  return (
    <div className="space-y-12 py-8">
      <div className="text-center max-w-2xl mx-auto space-y-4">
        <div className="inline-flex items-center space-x-2 px-3 py-1 rounded-full bg-blue-50 border border-blue-200 text-blue-700 text-xs font-semibold">
          <span>Stellar & Soroban Escrow</span>
          <span>•</span>
          <span>USDC Pay-to-Reach</span>
        </div>
        <h1 className="text-4xl md:text-5xl font-extrabold tracking-tight text-slate-900">
          Reach anyone sincere. <br />
          <span className="text-blue-600">Filter the noise with skin in the game.</span>
        </h1>
        <p className="text-lg text-slate-600">
          Senders stake USDC held by an escrow contract. When recipients reply within their chosen window, the stake is refunded. If ignored, the recipient keeps it. Spammers lose money.
        </p>
        <div className="flex flex-wrap justify-center gap-4 pt-4">
          <Link
            href="/compose"
            className="bg-blue-600 hover:bg-blue-700 text-white font-medium px-6 py-3 rounded-xl shadow-sm transition"
          >
            Send a Staked Message
          </Link>
          <Link
            href="/onboarding"
            className="bg-white hover:bg-slate-50 text-slate-800 border border-slate-300 font-medium px-6 py-3 rounded-xl shadow-sm transition"
          >
            Recipient Setup & Onboarding
          </Link>
        </div>
      </div>

      <div className="grid md:grid-cols-3 gap-6 pt-6">
        <div className="bg-white p-6 rounded-2xl border border-slate-200 shadow-sm space-y-3">
          <div className="w-10 h-10 rounded-xl bg-blue-100 flex items-center justify-center text-blue-600 font-bold">
            1
          </div>
          <h2 className="text-lg font-bold text-slate-900">Stake with USDC</h2>
          <p className="text-sm text-slate-600">
            Senders stake USDC into the Soroban escrow contract. No XLM needed with fee sponsorship and sponsored trustlines.
          </p>
        </div>

        <div className="bg-white p-6 rounded-2xl border border-slate-200 shadow-sm space-y-3">
          <div className="w-10 h-10 rounded-xl bg-indigo-100 flex items-center justify-center text-indigo-600 font-bold">
            2
          </div>
          <h2 className="text-lg font-bold text-slate-900">Deliver to Telegram & In-App</h2>
          <p className="text-sm text-slate-600">
            Messages land directly in Telegram or web inbox with sender info, stake badge, and instant Reply / Spam / Allowlist controls.
          </p>
        </div>

        <div className="bg-white p-6 rounded-2xl border border-slate-200 shadow-sm space-y-3">
          <div className="w-10 h-10 rounded-xl bg-emerald-100 flex items-center justify-center text-emerald-600 font-bold">
            3
          </div>
          <h2 className="text-lg font-bold text-slate-900">Automatic Settlement</h2>
          <p className="text-sm text-slate-600">
            Replies trigger oracle refund attestations. Expired unreplied messages get claimed by the recipient via automated sweeper keepers.
          </p>
        </div>
      </div>
    </div>
  );
}
