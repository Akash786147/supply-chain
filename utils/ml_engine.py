#!/usr/bin/env python3
"""
ML Anomaly Detection Engine for Supply Chain Analysis
Uses Isolation Forest to detect anomalous packages in the dependency graph.
Computes graph centrality metrics using NetworkX.

Input:  JSON dependency tree (with metadata) on stdin
Output: Enriched JSON with anomaly scores, centrality, and aggregate stats on stdout
"""

import sys
import json
import math
import numpy as np
from sklearn.ensemble import IsolationForest
from sklearn.preprocessing import StandardScaler
import networkx as nx

def flatten_tree(node, depth=0, parent=None, nodes=None, edges=None):
    """Flatten the dependency tree into nodes list and edges list."""
    if nodes is None:
        nodes = []
    if edges is None:
        edges = []
    
    node_id = f"{node.get('name', 'unknown')}@{node.get('version', '0.0.0')}"
    
    node_data = {
        "id": node_id,
        "name": node.get("name", "unknown"),
        "version": node.get("version", "0.0.0"),
        "depth": depth,
        "riskScore": node.get("riskScore", 0),
        "maintainerCount": node.get("maintainerCount", 1),
        "ageDays": node.get("ageDays", 365),
        "daysSinceUpdate": node.get("daysSinceUpdate", 30),
        "downloadCount": node.get("downloadCount", 1000),
        "signals": node.get("signals", []),
        "riskLevel": node.get("riskLevel", "low"),
    }
    nodes.append(node_data)
    
    if parent:
        edges.append({"source": parent, "target": node_id})
    
    for child in node.get("children", []):
        flatten_tree(child, depth + 1, node_id, nodes, edges)
    
    return nodes, edges


def compute_graph_metrics(nodes, edges):
    """Compute PageRank, eigenvector centrality, and blast radius using NetworkX."""
    G = nx.DiGraph()
    
    for node in nodes:
        G.add_node(node["id"])
    for edge in edges:
        G.add_edge(edge["source"], edge["target"])
    
    # PageRank
    try:
        pagerank = nx.pagerank(G, alpha=0.85)
    except:
        pagerank = {n["id"]: 1.0 / len(nodes) for n in nodes}
    
    # Degree centrality
    try:
        degree_cent = nx.degree_centrality(G)
    except:
        degree_cent = {n["id"]: 0 for n in nodes}
    
    # Blast radius (number of nodes reachable from this node in reverse direction)
    blast_radius = {}
    G_rev = G.reverse()
    for node in nodes:
        try:
            ancestors = nx.ancestors(G_rev, node["id"])
            blast_radius[node["id"]] = len(ancestors)
        except:
            blast_radius[node["id"]] = 0
    
    # Enrich nodes
    for node in nodes:
        nid = node["id"]
        node["pagerank"] = round(pagerank.get(nid, 0), 6)
        node["centrality"] = round(degree_cent.get(nid, 0), 6)
        node["blastRadius"] = blast_radius.get(nid, 0)
    
    return nodes


def run_isolation_forest(nodes):
    """Run Isolation Forest anomaly detection on package features."""
    if len(nodes) < 5:
        # Too few samples for meaningful ML
        for node in nodes:
            node["anomalyScore"] = 0.0
            node["isAnomaly"] = False
        return nodes
    
    # Extract feature matrix
    feature_names = ["maintainerCount", "ageDays", "daysSinceUpdate", "depth", 
                     "blastRadius", "pagerank", "centrality", "riskScore"]
    
    X = []
    for node in nodes:
        row = [
            node.get("maintainerCount", 1),
            node.get("ageDays", 365),
            node.get("daysSinceUpdate", 30),
            node.get("depth", 0),
            node.get("blastRadius", 0),
            node.get("pagerank", 0),
            node.get("centrality", 0),
            node.get("riskScore", 0),
        ]
        X.append(row)
    
    X = np.array(X, dtype=np.float64)
    
    # Handle NaN/Inf
    X = np.nan_to_num(X, nan=0.0, posinf=1e6, neginf=-1e6)
    
    # Scale features
    scaler = StandardScaler()
    X_scaled = scaler.fit_transform(X)
    
    # Isolation Forest
    contamination = min(0.1, max(0.01, 3.0 / len(nodes)))
    clf = IsolationForest(
        n_estimators=100,
        contamination=contamination,
        random_state=42
    )
    predictions = clf.fit_predict(X_scaled)
    scores = clf.decision_function(X_scaled)
    
    # Normalize anomaly scores to 0-1 range (higher = more anomalous)
    scores_normalized = 1 - (scores - scores.min()) / (scores.max() - scores.min() + 1e-8)
    
    for i, node in enumerate(nodes):
        node["anomalyScore"] = round(float(scores_normalized[i]), 4)
        node["isAnomaly"] = bool(predictions[i] == -1)
    
    # Compute correlation matrix
    correlation = np.corrcoef(X.T).tolist()
    # Replace NaN with 0
    correlation = [[0 if math.isnan(v) else round(v, 3) for v in row] for row in correlation]
    
    # Compute feature importances (approximate via variance-based scoring)
    importances = np.std(X_scaled, axis=0).tolist()
    total = sum(importances) + 1e-8
    importances = [round(v / total, 4) for v in importances]
    
    # Risk score distribution (histogram)
    risk_scores = [n["riskScore"] for n in nodes]
    hist_counts, hist_edges = np.histogram(risk_scores, bins=10, range=(0, 100))
    risk_distribution = [
        {"bin": f"{int(hist_edges[i])}-{int(hist_edges[i+1])}", "count": int(hist_counts[i])}
        for i in range(len(hist_counts))
    ]
    
    # Feature matrix for scatter plots
    feature_matrix = []
    for i, node in enumerate(nodes):
        feature_matrix.append({
            "name": node["name"],
            "version": node["version"],
            "maintainerCount": node.get("maintainerCount", 1),
            "ageDays": node.get("ageDays", 365),
            "daysSinceUpdate": node.get("daysSinceUpdate", 30),
            "depth": node.get("depth", 0),
            "blastRadius": node.get("blastRadius", 0),
            "pagerank": node.get("pagerank", 0),
            "centrality": node.get("centrality", 0),
            "riskScore": node.get("riskScore", 0),
            "anomalyScore": node.get("anomalyScore", 0),
            "isAnomaly": node.get("isAnomaly", False),
        })
    
    ml_stats = {
        "featureNames": feature_names,
        "featureMatrix": feature_matrix,
        "correlationMatrix": correlation,
        "featureImportances": dict(zip(feature_names, importances)),
        "riskDistribution": risk_distribution,
        "totalAnomalies": sum(1 for n in nodes if n.get("isAnomaly")),
        "totalPackages": len(nodes),
    }
    
    return nodes, ml_stats


def enrich_tree(original_tree, enriched_nodes_map):
    """Map enriched node data back onto the original tree structure."""
    node_id = f"{original_tree.get('name', 'unknown')}@{original_tree.get('version', '0.0.0')}"
    enriched = enriched_nodes_map.get(node_id, {})
    
    original_tree["anomalyScore"] = enriched.get("anomalyScore", 0)
    original_tree["isAnomaly"] = enriched.get("isAnomaly", False)
    original_tree["pagerank"] = enriched.get("pagerank", 0)
    original_tree["centrality"] = enriched.get("centrality", 0)
    original_tree["blastRadius"] = enriched.get("blastRadius", 0)
    
    for child in original_tree.get("children", []):
        enrich_tree(child, enriched_nodes_map)
    
    return original_tree


def main():
    try:
        input_data = json.loads(sys.stdin.read())
        tree = input_data.get("tree", input_data)
        
        # Flatten tree
        nodes, edges = flatten_tree(tree)
        
        # Compute graph metrics
        nodes = compute_graph_metrics(nodes, edges)
        
        # Run ML
        nodes, ml_stats = run_isolation_forest(nodes)
        
        # Create lookup map
        enriched_map = {n["id"]: n for n in nodes}
        
        # Enrich original tree
        enriched_tree = enrich_tree(tree, enriched_map)
        
        output = {
            "tree": enriched_tree,
            "mlStats": ml_stats,
            "edges": edges,
        }
        
        print(json.dumps(output))
        
    except Exception as e:
        # Output error as JSON so Node can parse it
        error_output = {
            "error": str(e),
            "tree": input_data.get("tree", input_data) if 'input_data' in dir() else {},
            "mlStats": {
                "featureNames": [],
                "featureMatrix": [],
                "correlationMatrix": [],
                "featureImportances": {},
                "riskDistribution": [],
                "totalAnomalies": 0,
                "totalPackages": 0,
            },
            "edges": [],
        }
        print(json.dumps(error_output))
        sys.exit(0)  # Exit 0 so Node doesn't throw


if __name__ == "__main__":
    main()
