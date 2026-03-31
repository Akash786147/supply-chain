import { BrowserRouter, Routes, Route, Link, useLocation } from "react-router-dom";
import Dashboard from "./pages/Dashboard";
import ProjectDetail from "./pages/ProjectDetail";
import DependencyTree from "./pages/DependencyTree";
import RiskAnalysis from "./pages/RiskAnalysis";
import "./App.css";

function Sidebar() {
  const location = useLocation();
  const isActive = (path: string) => location.pathname === path;
  return (
    <aside className="sidebar">
      <div className="sidebar-logo">
        <span className="logo-icon">◆</span>
        <span className="logo-text">DepGuard</span>
      </div>
      <nav className="sidebar-nav">
        <Link to="/" className={`nav-item ${isActive("/") ? "active" : ""}`}>
          <span className="nav-icon">⊞</span> Projects
        </Link>
      </nav>
      <div className="sidebar-footer">
        <span className="muted">Supply Chain CI/CD</span>
      </div>
    </aside>
  );
}

function App() {
  return (
    <BrowserRouter>
      <div className="app-layout">
        <Sidebar />
        <main className="main-content">
          <Routes>
            <Route path="/" element={<Dashboard />} />
            <Route path="/project/:id" element={<ProjectDetail />} />
            <Route path="/project/:id/tree" element={<DependencyTree />} />
            <Route path="/project/:id/risk" element={<RiskAnalysis />} />
          </Routes>
        </main>
      </div>
    </BrowserRouter>
  );
}

export default App;
