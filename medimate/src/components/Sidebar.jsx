import { NavLink } from "react-router-dom";
import {
  LayoutDashboard,
  FileText,
  Pill,
  CalendarDays,
  HeartPulse,
} from "lucide-react";

const links = [
  { to: "/", label: "Dashboard", icon: LayoutDashboard },
  { to: "/prescriptions", label: "Prescriptions", icon: FileText },
  { to: "/medicines", label: "My Medicines", icon: Pill },
  { to: "/schedule", label: "Schedule", icon: CalendarDays },
];

export default function Sidebar() {
  return (
    <aside className="sidebar">
      <div className="brand">
        <div className="brand-icon">
          <HeartPulse size={25} />
        </div>
        <div>
          <h2>MediSeva</h2>
          <span>Your health companion</span>
        </div>
      </div>

      <p className="nav-heading">WORKSPACE</p>

      <nav className="nav-links">
        {links.map(({ to, label, icon: Icon }) => (
          <NavLink
            key={to}
            to={to}
            end={to === "/"}
            className={({ isActive }) =>
              `nav-link ${isActive ? "active" : ""}`
            }
          >
            <Icon size={19} />
            <span>{label}</span>
          </NavLink>
        ))}
      </nav>

    </aside>
  );
}
