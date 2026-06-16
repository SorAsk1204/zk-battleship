import { Link, Outlet } from 'react-router-dom';
import IdentityChip from './IdentityChip.tsx';

/** 全站外壳:header 标题 + 右侧 demo 账户切换器 + main 容器。直角为主,radius ≤4px(Design §7.2)。 */
export default function Layout() {
  return (
    <div className="flex min-h-screen flex-col">
      <header className="flex items-center justify-between border-b border-grid bg-console px-6 py-4">
        <Link
          to="/"
          className="font-display text-xl font-bold tracking-widest text-phosphor"
        >
          ZK BATTLESHIP
        </Link>
        {/* 本浏览器身份(地址 + 导入/重置);取代原 demo P0/P1 切换器。 */}
        <IdentityChip />
      </header>
      <main className="mx-auto w-full max-w-6xl flex-1 px-6 py-8">
        <Outlet />
      </main>
    </div>
  );
}
