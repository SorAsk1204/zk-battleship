import { Link, Outlet } from 'react-router-dom';
import AccountSwitcher from './AccountSwitcher.tsx';

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
        {/* demo 双账户切换;非 VITE_DEMO 构建该组件返回 null,不占位。 */}
        <AccountSwitcher />
      </header>
      <main className="mx-auto w-full max-w-6xl flex-1 px-6 py-8">
        <Outlet />
      </main>
    </div>
  );
}
