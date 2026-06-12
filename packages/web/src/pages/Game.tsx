import { useParams } from 'react-router-dom';

/** Game 占位页(M3 落地布阵/对战/结算三幕)。 */
export default function Game() {
  const { id } = useParams();
  return (
    <section className="space-y-4">
      <h1 className="font-display text-3xl font-bold text-phosphor">GAME</h1>
      <div className="border border-grid bg-console p-4">
        <p className="font-mono text-sm text-foam">
          game id: <span className="text-flare">{id}</span>
        </p>
        <p className="mt-2 text-sm text-mist">对战界面在 M3 落地。</p>
      </div>
    </section>
  );
}
