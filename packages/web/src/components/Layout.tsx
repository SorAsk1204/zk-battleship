import { Link, Outlet } from 'react-router-dom';

/** 全站外壳:header 标题 + main 容器。直角为主,radius ≤4px(Design §7.2)。 */
export default function Layout() {
  return (
    <div className="flex min-h-screen flex-col">
      <header className="border-b border-grid bg-console px-6 py-4">
        <Link
          to="/"
          className="font-display text-xl font-bold tracking-widest text-phosphor"
        >
          ZK BATTLESHIP
        </Link>
      </header>
      <main className="mx-auto w-full max-w-6xl flex-1 px-6 py-8">
        <Outlet />
      </main>
    </div>
  );
}
