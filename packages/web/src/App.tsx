import { lazy, Suspense } from 'react';
import { Link, Route, Routes } from 'react-router-dom';
import Layout from './components/Layout.tsx';
import Game from './pages/Game.tsx';
import Lobby from './pages/Lobby.tsx';
import NewGame from './pages/NewGame.tsx';

// dev-only 证明管线验收页(Task 3.2)。懒加载 + import.meta.env.DEV 守卫:
// production 构建下 import.meta.env.DEV 折叠为 false,整个分支被 Rollup 死代码消除,
// DevProve 及其动态 import('snarkjs') 不进生产 bundle(3.1 浏览器安全纪律)。
const DevProve = import.meta.env.DEV ? lazy(() => import('./pages/DevProve.tsx')) : null;

function NotFound() {
  return (
    <section className="space-y-4">
      <h1 className="font-display text-3xl font-bold text-flare">404</h1>
      <p className="text-mist">
        航向丢失。
        <Link to="/" className="text-phosphor underline">
          返回 Lobby
        </Link>
      </p>
    </section>
  );
}

export default function App() {
  return (
    <Routes>
      <Route element={<Layout />}>
        <Route path="/" element={<Lobby />} />
        {/* /game/new(创建对局,布阵幕 create)须在 /game/:id 之前;v6 静态段本就优先于动态段,顺序仅为清晰 */}
        <Route path="/game/new" element={<NewGame />} />
        <Route path="/game/:id" element={<Game />} />
        {DevProve && (
          <Route
            path="/dev/prove"
            element={
              <Suspense fallback={<p className="text-mist">加载 dev 工具…</p>}>
                <DevProve />
              </Suspense>
            }
          />
        )}
        <Route path="*" element={<NotFound />} />
      </Route>
    </Routes>
  );
}
