import { BrowserRouter, Routes, Route, Link, useLocation } from "react-router-dom";
import Dashboard from "./pages/Dashboard";
import ProjectDetail from "./pages/ProjectDetail";
import DependencyTree from "./pages/DependencyTree";
import RiskAnalysis from "./pages/RiskAnalysis";
import MLAnalysis from "./pages/MLAnalysis";
import NetworkGraph from "./pages/NetworkGraph";
import ScanHistory from "./pages/ScanHistory";
import DatasetBrowser from "./pages/DatasetBrowser";
import "./App.css";

function Sidebar() {
  const location = useLocation();
  const isActive = (path: string) => location.pathname === path;
  const isSection = (prefix: string) => location.pathname.startsWith(prefix);

  return (
    <aside className="sidebar">
      <div className="sidebar-logo">
        <span className="logo-icon">🛡️</span>
        <span className="logo-text">DepGuard<span className="logo-badge">AI</span></span>
      </div>
      <nav className="sidebar-nav">
        <Link to="/" className={`nav-item ${isActive("/") ? "active" : ""}`}>
          <span className="nav-icon">⊞</span> Projects
        </Link>
        {isSection("/project/") && (
          <div className="sidebar-section">
            <div className="sidebar-section-title">Current Project</div>
            <Link
              to={location.pathname.replace(/\/(tree|risk|ml|graph|history|dataset)$/, "")}
              className={`nav-item nav-sub ${location.pathname.match(/\/project\/\d+$/) ? "active" : ""}`}
            >
              <span className="nav-icon">▶</span> Pipelines
            </Link>
            <Link
              to={location.pathname.replace(/\/(tree|risk|ml|graph|history|dataset)$/, "") + "/tree"}
              className={`nav-item nav-sub ${location.pathname.endsWith("/tree") ? "active" : ""}`}
            >
              <span className="nav-icon">🌲</span> Dep Tree
            </Link>
            <Link
              to={location.pathname.replace(/\/(tree|risk|ml|graph|history|dataset)$/, "") + "/risk"}
              className={`nav-item nav-sub ${location.pathname.endsWith("/risk") ? "active" : ""}`}
            >
              <span className="nav-icon">⚠</span> Risk Signals
            </Link>
            <Link
              to={location.pathname.replace(/\/(tree|risk|ml|graph|history|dataset)$/, "") + "/ml"}
              className={`nav-item nav-sub ${location.pathname.endsWith("/ml") ? "active" : ""}`}
            >
              <span className="nav-icon">🧠</span> ML Analysis
            </Link>
            <Link
              to={location.pathname.replace(/\/(tree|risk|ml|graph|history|dataset)$/, "") + "/graph"}
              className={`nav-item nav-sub ${location.pathname.endsWith("/graph") ? "active" : ""}`}
            >
              <span className="nav-icon">🕸️</span> Network DAG
            </Link>
            <Link
              to={location.pathname.replace(/\/(tree|risk|ml|graph|history|dataset)$/, "") + "/history"}
              className={`nav-item nav-sub ${location.pathname.endsWith("/history") ? "active" : ""}`}
            >
              <span className="nav-icon">📊</span> Scan History
            </Link>
            <Link
              to={location.pathname.replace(/\/(tree|risk|ml|graph|history|dataset)$/, "") + "/dataset"}
              className={`nav-item nav-sub ${location.pathname.endsWith("/dataset") ? "active" : ""}`}
            >
              <span className="nav-icon">📋</span> Dataset
            </Link>
          </div>
        )}
      </nav>
      <div className="sidebar-footer">
        <span className="muted">Supply Chain CI/CD</span>
        <span className="sidebar-version">v2.0 — Isolation Forest</span>
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
            <Route path="/project/:id/ml" element={<MLAnalysis />} />
            <Route path="/project/:id/graph" element={<NetworkGraph />} />
            <Route path="/project/:id/history" element={<ScanHistory />} />
            <Route path="/project/:id/dataset" element={<DatasetBrowser />} />
          </Routes>
        </main>
      </div>
    </BrowserRouter>
  );
}

export default App;
