import { Link, Route, Routes } from 'react-router-dom';
import Layout from './components/Layout.tsx';
import Game from './pages/Game.tsx';
import Lobby from './pages/Lobby.tsx';

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
        <Route path="/game/:id" element={<Game />} />
        <Route path="*" element={<NotFound />} />
      </Route>
    </Routes>
  );
}
