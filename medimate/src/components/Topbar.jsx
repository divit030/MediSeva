export default function Topbar({ onLogout }) {
  const today = new Date().toLocaleDateString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
    year: "numeric",
  });

  return (
    <header className="topbar">
      <div className="topbar-date">
        <span className="status-dot" />
        <span>{today}</span>
      </div>

      <div className="topbar-actions">
        <button className="topbar-logout" type="button" onClick={onLogout}>
          Sign out
        </button>
      </div>
    </header>
  );
}
