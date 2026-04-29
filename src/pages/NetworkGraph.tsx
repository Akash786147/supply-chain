import { useEffect, useRef, useState } from "react";
import { useParams, Link } from "react-router-dom";
import { fetchDependencyTree } from "../api";
import type { DepNode } from "../types";

interface GraphNode {
  id: string;
  name: string;
  version: string;
  x: number;
  y: number;
  vx: number;
  vy: number;
  riskScore: number;
  riskLevel: string;
  isAnomaly: boolean;
  anomalyScore: number;
  blastRadius: number;
  depth: number;
  children: string[];
}

interface GraphLink {
  source: string;
  target: string;
}

function flattenToGraph(node: DepNode, depth = 0, nodesMap: Map<string, GraphNode> = new Map(), links: GraphLink[] = []): { nodes: GraphNode[]; links: GraphLink[] } {
  const id = `${node.name}@${node.version}`;
  if (!nodesMap.has(id)) {
    nodesMap.set(id, {
      id,
      name: node.name,
      version: node.version,
      x: Math.random() * 800 + 100,
      y: Math.random() * 600 + 100,
      vx: 0,
      vy: 0,
      riskScore: node.riskScore || 0,
      riskLevel: node.riskLevel || "low",
      isAnomaly: node.isAnomaly || false,
      anomalyScore: node.anomalyScore || 0,
      blastRadius: node.blastRadius || 0,
      depth,
      children: [],
    });
  }

  for (const child of node.children || []) {
    const childId = `${child.name}@${child.version}`;
    links.push({ source: id, target: childId });
    nodesMap.get(id)!.children.push(childId);
    flattenToGraph(child, depth + 1, nodesMap, links);
  }

  return { nodes: Array.from(nodesMap.values()), links };
}

const getNodeColor = (node: GraphNode) => {
  if (node.isAnomaly) return "#ef4444";
  if (node.riskScore > 60) return "#ef4444";
  if (node.riskScore > 40) return "#f97316";
  if (node.riskScore > 20) return "#eab308";
  return "#22c55e";
};

const getNodeRadius = (node: GraphNode) => {
  return Math.max(4, Math.min(18, 5 + (node.blastRadius || 0) * 0.8 + (node.depth === 0 ? 8 : 0)));
};

export default function NetworkGraph() {
  const { id } = useParams<{ id: string }>();
  const projectId = Number(id);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [tree, setTree] = useState<DepNode | null>(null);
  const [hoveredNode, setHoveredNode] = useState<GraphNode | null>(null);
  const [tooltipPos, setTooltipPos] = useState({ x: 0, y: 0 });
  const graphRef = useRef<{ nodes: GraphNode[]; links: GraphLink[] } | null>(null);
  const animRef = useRef<number>(0);
  const transformRef = useRef({ x: 0, y: 0, scale: 1 });
  const dragRef = useRef<{ dragging: boolean; lastX: number; lastY: number }>({ dragging: false, lastX: 0, lastY: 0 });
  const iterationRef = useRef<number>(0);
  const shouldRedrawRef = useRef<boolean>(true);

  useEffect(() => {
    fetchDependencyTree(projectId).then(setTree);
  }, [projectId]);

  // Force simulation + continuous redraw
  useEffect(() => {
    if (!tree || !canvasRef.current || !containerRef.current) return;

    const canvas = canvasRef.current;
    const container = containerRef.current;
    const ctx = canvas.getContext("2d")!;
    
    // Set canvas size to match container
    const updateCanvasSize = () => {
      const rect = container.getBoundingClientRect();
      canvas.width = rect.width;
      canvas.height = rect.height;
    };
    updateCanvasSize();

    const { nodes, links } = flattenToGraph(tree);
    graphRef.current = { nodes, links };

    // Center the root
    const root = nodes[0];
    if (root) {
      root.x = canvas.width / 2;
      root.y = canvas.height / 2;
    }

    // Build adjacency map
    const linkMap = new Map<string, Set<string>>();
    links.forEach((l) => {
      if (!linkMap.has(l.source)) linkMap.set(l.source, new Set());
      if (!linkMap.has(l.target)) linkMap.set(l.target, new Set());
      linkMap.get(l.source)!.add(l.target);
      linkMap.get(l.target)!.add(l.source);
    });

    const maxIterations = 300;

    const draw = () => {
      const t = transformRef.current;
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.save();
      ctx.translate(t.x, t.y);
      ctx.scale(t.scale, t.scale);

      // Draw edges
      ctx.strokeStyle = "rgba(148, 163, 184, 0.6)";
      ctx.lineWidth = 0.5;
      links.forEach((l) => {
        const a = nodes.find((n) => n.id === l.source);
        const b = nodes.find((n) => n.id === l.target);
        if (!a || !b) return;
        ctx.beginPath();
        ctx.moveTo(a.x, a.y);
        ctx.lineTo(b.x, b.y);
        ctx.stroke();
      });

      // Draw nodes
      nodes.forEach((n) => {
        const r = getNodeRadius(n);
        const color = getNodeColor(n);

        // Glow for anomalies
        if (n.isAnomaly) {
          ctx.beginPath();
          const gradient = ctx.createRadialGradient(n.x, n.y, r, n.x, n.y, r * 3);
          gradient.addColorStop(0, "rgba(239, 68, 68, 0.3)");
          gradient.addColorStop(1, "rgba(239, 68, 68, 0)");
          ctx.arc(n.x, n.y, r * 3, 0, Math.PI * 2);
          ctx.fillStyle = gradient;
          ctx.fill();
        }

        ctx.beginPath();
        ctx.arc(n.x, n.y, r, 0, Math.PI * 2);
        ctx.fillStyle = color;
        ctx.fill();
        ctx.strokeStyle = n.isAnomaly ? "#ef4444" : "rgba(0,0,0,0.15)";
        ctx.lineWidth = n.isAnomaly ? 2 : 0.5;
        ctx.stroke();

        // Label for important nodes
        if (n.depth <= 1 || n.isAnomaly || r > 8) {
          ctx.fillStyle = "#475569";
          ctx.font = `${Math.max(9, 11 - n.depth)}px Inter, sans-serif`;
          ctx.textAlign = "center";
          ctx.fillText(n.name, n.x, n.y + r + 12);
        }
      });

      ctx.restore();
    };

    const simulate = () => {
      if (iterationRef.current < maxIterations) {
        const iteration = iterationRef.current;
        const alpha = Math.max(0.001, 1 - iteration / maxIterations);

        // Repulsion force
        for (let i = 0; i < nodes.length; i++) {
          for (let j = i + 1; j < nodes.length; j++) {
            const dx = nodes[j].x - nodes[i].x;
            const dy = nodes[j].y - nodes[i].y;
            const dist = Math.sqrt(dx * dx + dy * dy) || 1;
            const force = (150 * alpha) / dist;
            const fx = (dx / dist) * force;
            const fy = (dy / dist) * force;
            nodes[i].vx -= fx;
            nodes[i].vy -= fy;
            nodes[j].vx += fx;
            nodes[j].vy += fy;
          }
        }

        // Attraction along links
        links.forEach((l) => {
          const a = nodes.find((n) => n.id === l.source);
          const b = nodes.find((n) => n.id === l.target);
          if (!a || !b) return;
          const dx = b.x - a.x;
          const dy = b.y - a.y;
          const dist = Math.sqrt(dx * dx + dy * dy) || 1;
          const force = (dist - 80) * 0.005 * alpha;
          const fx = (dx / dist) * force;
          const fy = (dy / dist) * force;
          a.vx += fx;
          a.vy += fy;
          b.vx -= fx;
          b.vy -= fy;
        });

        // Center gravity
        nodes.forEach((n) => {
          n.vx += (canvas.width / 2 - n.x) * 0.0005 * alpha;
          n.vy += (canvas.height / 2 - n.y) * 0.0005 * alpha;
        });

        // Apply velocities with damping
        nodes.forEach((n) => {
          n.vx *= 0.9;
          n.vy *= 0.9;
          n.x += n.vx;
          n.y += n.vy;
        });

        iterationRef.current++;
        shouldRedrawRef.current = true;
      }

      if (shouldRedrawRef.current) {
        draw();
        shouldRedrawRef.current = false;
      }

      animRef.current = requestAnimationFrame(simulate);
    };

    simulate();

    const handleResize = () => {
      updateCanvasSize();
      shouldRedrawRef.current = true;
    };

    window.addEventListener("resize", handleResize);

    return () => {
      window.removeEventListener("resize", handleResize);
      cancelAnimationFrame(animRef.current);
    };
  }, [tree]);

  // Mouse events for pan/zoom/hover
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const handleWheel = (e: WheelEvent) => {
      e.preventDefault();
      const scaleChange = e.deltaY > 0 ? 0.9 : 1.1;
      transformRef.current.scale *= scaleChange;
      transformRef.current.scale = Math.max(0.1, Math.min(5, transformRef.current.scale));
      shouldRedrawRef.current = true;
    };

    const handleMouseDown = (e: MouseEvent) => {
      dragRef.current = { dragging: true, lastX: e.clientX, lastY: e.clientY };
    };

    const handleMouseMove = (e: MouseEvent) => {
      if (dragRef.current.dragging) {
        transformRef.current.x += e.clientX - dragRef.current.lastX;
        transformRef.current.y += e.clientY - dragRef.current.lastY;
        dragRef.current.lastX = e.clientX;
        dragRef.current.lastY = e.clientY;
        shouldRedrawRef.current = true;
      }

      // Hover detection
      if (graphRef.current) {
        const rect = canvas.getBoundingClientRect();
        const t = transformRef.current;
        const mx = (e.clientX - rect.left - t.x) / t.scale;
        const my = (e.clientY - rect.top - t.y) / t.scale;

        let found: GraphNode | null = null;
        for (const n of graphRef.current.nodes) {
          const r = getNodeRadius(n);
          const dx = mx - n.x;
          const dy = my - n.y;
          if (dx * dx + dy * dy < r * r * 4) {
            found = n;
            break;
          }
        }
        setHoveredNode(found);
        if (found) {
          setTooltipPos({ x: e.clientX - rect.left + 15, y: e.clientY - rect.top - 10 });
        }
      }
    };

    const handleMouseUp = () => {
      dragRef.current.dragging = false;
    };

    canvas.addEventListener("wheel", handleWheel, { passive: false });
    canvas.addEventListener("mousedown", handleMouseDown);
    canvas.addEventListener("mousemove", handleMouseMove);
    canvas.addEventListener("mouseup", handleMouseUp);
    canvas.addEventListener("mouseleave", handleMouseUp);

    return () => {
      canvas.removeEventListener("wheel", handleWheel);
      canvas.removeEventListener("mousedown", handleMouseDown);
      canvas.removeEventListener("mousemove", handleMouseMove);
      canvas.removeEventListener("mouseup", handleMouseUp);
      canvas.removeEventListener("mouseleave", handleMouseUp);
    };
  }, [tree]);

  if (!tree) return <div className="page"><div className="loading-spinner" />Loading network graph...</div>;

  return (
    <div className="page" style={{ maxWidth: "100%" }}>
      <div className="breadcrumb">
        <Link to="/">Projects</Link> / <Link to={`/project/${projectId}`}>{tree.name}</Link> / <span>Network Graph</span>
      </div>

      <div className="page-header">
        <h1>🕸️ Dependency Network DAG</h1>
        <div style={{ display: "flex", gap: 8 }}>
          <Link to={`/project/${projectId}/ml`} className="btn">ML Analysis</Link>
          <Link to={`/project/${projectId}/tree`} className="btn">Tree View</Link>
        </div>
      </div>

      <div className="graph-legend">
        <span><span className="legend-dot" style={{ background: "#22c55e" }} /> Low Risk</span>
        <span><span className="legend-dot" style={{ background: "#eab308" }} /> Medium Risk</span>
        <span><span className="legend-dot" style={{ background: "#f97316" }} /> High Risk</span>
        <span><span className="legend-dot" style={{ background: "#ef4444" }} /> Critical / Anomaly</span>
        <span className="muted" style={{ marginLeft: 12 }}>Scroll to zoom · Drag to pan</span>
      </div>

      <div className="graph-container" ref={containerRef}>
        <canvas
          ref={canvasRef}
          className="graph-canvas"
        />
        {hoveredNode && (
          <div className="graph-tooltip" style={{ left: tooltipPos.x, top: tooltipPos.y }}>
            <div className="tooltip-name">{hoveredNode.name}</div>
            <div className="tooltip-version">v{hoveredNode.version}</div>
            <div className="tooltip-meta">
              <span>Risk: <b style={{ color: getNodeColor(hoveredNode) }}>{hoveredNode.riskScore}</b></span>
              <span>Depth: {hoveredNode.depth}</span>
              <span>Blast Radius: {hoveredNode.blastRadius}</span>
            </div>
            {hoveredNode.isAnomaly && (
              <div className="tooltip-anomaly">⚠ ML Anomaly (score: {(hoveredNode.anomalyScore * 100).toFixed(1)}%)</div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
