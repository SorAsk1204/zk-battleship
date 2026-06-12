/** Lobby 占位页(M3 落地真实大厅)。当前作用:token 体系的活验证 —— 三字体 + 七色色块。 */
export default function Lobby() {
  return (
    <section className="space-y-6">
      <h1 className="font-display text-3xl font-bold text-phosphor">LOBBY</h1>
      <p className="text-foam">
        正文用 Inter(font-sans)。布阵 / 对战 / 结算三幕在 M3 落地,本页是视觉
        token 的占位验证。
      </p>
      <p className="font-mono text-sm text-mist">
        // IBM Plex Mono: coord B-7 · salt 0x1f2e · proof pending…
      </p>
      <div className="border border-grid bg-console p-4">
        <p className="mb-3 font-medium text-foam">七色 token(全站唯一调色板):</p>
        <div className="flex gap-2">
          <div className="h-10 w-10 border border-grid bg-abyss" title="abyss #081019" />
          <div className="h-10 w-10 border border-grid bg-console" title="console #0D1B26" />
          <div className="h-10 w-10 bg-grid" title="grid #1E3A4A" />
          <div className="h-10 w-10 bg-phosphor" title="phosphor #35E0C8" />
          <div className="h-10 w-10 bg-flare" title="flare #FF7A45" />
          <div className="h-10 w-10 bg-foam" title="foam #C8D8DC" />
          <div className="h-10 w-10 bg-mist" title="mist #5A7484" />
        </div>
      </div>
    </section>
  );
}
