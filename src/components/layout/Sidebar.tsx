import { Captions, FolderOpen, Settings } from "lucide-react";
import type { NavItem, ViewId } from "../../types/app";

const navItems: NavItem[] = [
  { id: "dashboard", label: "工作台", icon: FolderOpen },
  { id: "editor", label: "字幕编辑", icon: Captions },
  { id: "settings", label: "设置", icon: Settings },
];

interface SidebarProps {
  currentView: ViewId;
  onViewChange: (view: ViewId) => void;
}

export function Sidebar({ currentView, onViewChange }: SidebarProps) {
  return (
    <aside className="sidebar collapsed" aria-label="主导航">
      <div className="brand">
        <div className="brand-mark"><img alt="CaptionFlow" src="/captionflow-icon.png" /></div>
      </div>

      <nav className="nav-list">
        {navItems.map((item) => {
          const Icon = item.icon;
          const isActive = currentView === item.id;
          return (
            <button
              aria-current={isActive ? "page" : undefined}
              className={`nav-item ${isActive ? "active" : ""}`}
              key={item.id}
              onClick={() => onViewChange(item.id)}
              type="button"
            >
              <Icon aria-hidden="true" size={18} />
              <span>{item.label}</span>
            </button>
          );
        })}
      </nav>
    </aside>
  );
}
