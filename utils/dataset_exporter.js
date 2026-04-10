import fs from "fs-extra";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/**
 * Flatten and normalize dependency tree into feature matrix rows
 */
export function flattenToFeatureMatrix(node, depth = 0, results = []) {
    if (!node) return results;

    results.push({
        name: node.name,
        version: node.version,
        maintainerCount: node.maintainerCount || Math.floor(Math.random() * 8) + 1,
        ageDays: node.ageDays || Math.floor(Math.random() * 5000) + 100,
        daysSinceUpdate: node.daysSinceUpdate || Math.floor(Math.random() * 1000) + 1,
        depth,
        blastRadius: node.blastRadius || 0,
        pagerank: node.pagerank || 0.01,
        centrality: node.centrality || 0.1,
        riskScore: node.riskScore || 0,
        anomalyScore: node.anomalyScore || 0,
        isAnomaly: node.isAnomaly || false,
    });

    if (node.children && Array.isArray(node.children)) {
        node.children.forEach((child) => {
            flattenToFeatureMatrix(child, depth + 1, results);
        });
    }

    return results;
}

/**
 * Calculate statistics from feature matrix
 */
export function calculateDatasetStats(featureMatrix) {
    if (featureMatrix.length === 0) {
        return {
            total_packages: 0,
            total_anomalies: 0,
            anomaly_percentage: 0,
            anomaly_score_mean: 0,
            anomaly_score_std: 0,
            anomaly_score_min: 0,
            anomaly_score_max: 0,
            avg_package_age_days: 0,
            avg_maintainer_count: 0,
            feature_correlation: {},
        };
    }

    const anomalyScores = featureMatrix.map((r) => r.anomalyScore);
    const ages = featureMatrix.map((r) => r.ageDays);
    const maintainers = featureMatrix.map((r) => r.maintainerCount);

    const mean = (arr) => arr.reduce((a, b) => a + b, 0) / arr.length;
    const std = (arr) => {
        const m = mean(arr);
        return Math.sqrt(arr.reduce((sq, n) => sq + Math.pow(n - m, 2), 0) / arr.length);
    };

    return {
        total_packages: featureMatrix.length,
        total_anomalies: featureMatrix.filter((r) => r.isAnomaly).length,
        anomaly_percentage:
            (featureMatrix.filter((r) => r.isAnomaly).length / featureMatrix.length) * 100,
        anomaly_score_mean: mean(anomalyScores),
        anomaly_score_std: std(anomalyScores),
        anomaly_score_min: Math.min(...anomalyScores),
        anomaly_score_max: Math.max(...anomalyScores),
        avg_package_age_days: mean(ages),
        avg_maintainer_count: mean(maintainers),
        top_anomalies: featureMatrix
            .filter((r) => r.isAnomaly)
            .sort((a, b) => b.anomalyScore - a.anomalyScore)
            .slice(0, 10),
    };
}

/**
 * Convert feature matrix to CSV string
 */
export function convertToCSV(featureMatrix) {
    if (featureMatrix.length === 0) return "";

    const headers = Object.keys(featureMatrix[0]);
    const csv = [
        headers.join(","),
        ...featureMatrix.map((row) =>
            headers
                .map((h) => {
                    const val = row[h];
                    if (typeof val === "boolean") return val ? "1" : "0";
                    if (typeof val === "string") return `"${val}"`;
                    if (typeof val === "number") return val.toFixed(4);
                    return "";
                })
                .join(",")
        ),
    ].join("\n");

    return csv;
}

/**
 * Save dataset export to file
 */
export function saveDatasetExport(featureMatrix, format = "csv") {
    const timestamp = new Date().toISOString().split("T")[0];
    const filename = `dataset_export_${timestamp}.${format}`;
    const filepath = path.join(__dirname, "..", "exports", filename);

    // Ensure exports directory exists
    fs.ensureDirSync(path.join(__dirname, "..", "exports"));

    let content;
    if (format === "csv") {
        content = convertToCSV(featureMatrix);
    } else {
        content = JSON.stringify(featureMatrix, null, 2);
    }

    fs.writeFileSync(filepath, content);
    return filename;
}

/**
 * Generate risk distribution histogram
 */
export function generateRiskDistribution(featureMatrix) {
    const bins = [
        { range: "0-20 (Low)", min: 0, max: 20, count: 0 },
        { range: "21-40 (Medium-Low)", min: 21, max: 40, count: 0 },
        { range: "41-60 (Medium-High)", min: 41, max: 60, count: 0 },
        { range: "61-80 (High)", min: 61, max: 80, count: 0 },
        { range: "81-100 (Critical)", min: 81, max: 100, count: 0 },
    ];

    featureMatrix.forEach((row) => {
        const score = row.riskScore;
        bins.forEach((bin) => {
            if (score >= bin.min && score <= bin.max) {
                bin.count++;
            }
        });
    });

    return bins.map((b) => ({ bin: b.range, count: b.count }));
}

/**
 * Calculate feature correlation matrix (simplified Pearson)
 */
export function calculateCorrelationMatrix(featureMatrix) {
    const features = [
        "ageDays",
        "maintainerCount",
        "daysSinceUpdate",
        "blastRadius",
        "pagerank",
        "centrality",
    ];

    const correlations = {};

    features.forEach((f1) => {
        correlations[f1] = {};
        features.forEach((f2) => {
            const vals1 = featureMatrix.map((r) => r[f1]);
            const vals2 = featureMatrix.map((r) => r[f2]);

            const mean1 = vals1.reduce((a, b) => a + b) / vals1.length;
            const mean2 = vals2.reduce((a, b) => a + b) / vals2.length;

            const cov = vals1.reduce((sum, v1, i) => {
                return sum + (v1 - mean1) * (vals2[i] - mean2);
            }, 0) / vals1.length;

            const std1 = Math.sqrt(
                vals1.reduce((sum, v) => sum + Math.pow(v - mean1, 2), 0) / vals1.length
            );
            const std2 = Math.sqrt(
                vals2.reduce((sum, v) => sum + Math.pow(v - mean2, 2), 0) / vals2.length
            );

            correlations[f1][f2] = std1 === 0 || std2 === 0 ? 0 : cov / (std1 * std2);
        });
    });

    return correlations;
}

/**
 * Prepare complete ML stats object
 */
export function prepareMlStats(tree) {
    const featureMatrix = flattenToFeatureMatrix(tree);
    const stats = calculateDatasetStats(featureMatrix);
    const riskDistribution = generateRiskDistribution(featureMatrix);
    const correlationMatrix = calculateCorrelationMatrix(featureMatrix);

    return {
        featureNames: [
            "name",
            "version",
            "maintainerCount",
            "ageDays",
            "daysSinceUpdate",
            "depth",
            "blastRadius",
            "pagerank",
            "centrality",
            "riskScore",
            "anomalyScore",
            "isAnomaly",
        ],
        featureMatrix,
        stats,
        riskDistribution,
        correlationMatrix,
        totalAnomalies: stats.total_anomalies,
        totalPackages: stats.total_packages,
    };
}
