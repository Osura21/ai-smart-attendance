import { useState } from 'react';
import Scanner from './components/Scanner.jsx';
import AdminPanel from './components/AdminPanel.jsx';

export default function App() {
  const [view, setView] = useState(window.location.pathname.startsWith('/admin') ? 'admin' : 'scanner');

  function changeView(nextView) {
    setView(nextView);
    window.history.pushState(null, '', nextView === 'admin' ? '/admin' : '/');
  }

  return (
    <main className={view === 'admin' ? 'app-shell admin-shell' : 'container'}>
      {view === 'admin' ? (
        <AdminPanel onNavigateScanner={() => changeView('scanner')} />
      ) : (
        <Scanner onNavigateAdmin={() => changeView('admin')} />
      )}
    </main>
  );
}
