import express from "express";
import cors from "cors";

const app = express();
app.use(express.json());
app.use(cors());

// In-memory mock database
const connectedProjects = [
  { id: 1, name: "my-ecommerce-app", branch: "main", status: "success", lastRun: "10 mins ago" }
];

// Mock basic endpoint to get connected projects
app.get("/api/projects", (req, res) => {
  res.json(connectedProjects);
});

// Mock endpoint to connect a new GitHub project
app.post("/api/projects", (req, res) => {
  const { repoUrl } = req.body;
  const newProject = {
    id: connectedProjects.length + 1,
    name: repoUrl.split("/").pop() || "unknown-repo",
    branch: "main",
    status: "building...",
    lastRun: "just now"
  };
  connectedProjects.push(newProject);
  res.json(newProject);
});

// Endpoint to fetch mock dependency graph data
app.get("/api/projects/:id/dependencies", (req, res) => {
  // Mock data for dependency graph
  res.json({
    nodes: [
      { id: "root", label: "my-project", isRoot: true },
      { id: "react", label: "react ^18.2.0" },
      { id: "express", label: "express ^4.19" },
      { id: "vite", label: "vite ^5.0", type: "dev" },
      { id: "cors", label: "cors ^2.8" }
    ],
    edges: [
      { from: "root", to: "react" },
      { from: "root", to: "express" },
      { from: "root", to: "vite" },
      { from: "express", to: "cors" }
    ]
  });
});

// The GitHub webhook interceptor
app.post("/api/github-webhook", (req, res) => {
  const event = req.headers["x-github-event"];
  console.log(`[Webhook] Received event: ${event}`);
  
  // Here is where Vercel/Netlify triggers a build and sends a status back to Checks API
  if (event === "push") {
    console.log("[CI] Triggering new build pipeline...");
  }
  
  res.sendStatus(200);
});

const PORT = 3001;
app.listen(PORT, () => {
    console.log(`🚀 CI/CD Backend running on http://localhost:${PORT}`);
});
