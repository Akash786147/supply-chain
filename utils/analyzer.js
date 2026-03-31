import fs from "fs-extra";
import path from "path";
import simpleGit from "simple-git";
import { exec } from "child_process";
import { promisify } from "util";

const execAsync = promisify(exec);

export async function cloneAndAnalyze(repoUrl, projectId) {
    const containerDir = path.resolve("container");
    const projectDir = path.join(containerDir, String(projectId));
    const dataDir = path.resolve("data");
    const outputFile = path.join(dataDir, `${projectId}.json`);

    // Ensure directories exist
    await fs.ensureDir(containerDir);
    await fs.ensureDir(dataDir);

    // Clean previous run if exists
    if (await fs.pathExists(projectDir)) {
        console.log(`Cleaning up previous build for project ${projectId}...`);
        await fs.remove(projectDir);
    }

    try {
        console.log(`Cloning ${repoUrl} into ${projectDir}...`);
        await simpleGit().clone(repoUrl, projectDir);

        console.log(`Installing dependencies for project ${projectId}...`);
        // This might take time and requires npm to be available
        await execAsync("npm install", { cwd: projectDir });

        console.log(`Analyzing dependencies for project ${projectId}...`);
        const { stdout } = await execAsync("npm list --all --json", { cwd: projectDir, maxBuffer: 1024 * 1024 * 10 }); // 10MB buffer

        const dependencyTree = JSON.parse(stdout);

        // Transform to frontend format (recursive)
        const transform = (node, key) => {
            const children = [];
            if (node.dependencies) {
                Object.entries(node.dependencies).forEach(([depName, depData]) => {
                    children.push(transform(depData, depName));
                });
            }

            // Random risk generation for demo purposes
            const riskScore = Math.floor(Math.random() * 100);
            let riskLevel = "low";
            if (riskScore > 75) riskLevel = "critical";
            else if (riskScore > 50) riskLevel = "high";
            else if (riskScore > 25) riskLevel = "medium";

            // Random signals
            const possibleSignals = ["outdated", "deprecated", "few-maintainers", "known-vulnerability"];
            const signals = [];
            if (riskScore > 25 && Math.random() > 0.7) {
                signals.push(possibleSignals[Math.floor(Math.random() * possibleSignals.length)]);
            }

            return {
                id: key || node.name,
                name: key || node.name,
                version: node.version,
                riskScore: riskScore,
                riskLevel: riskLevel,
                signals: signals,
                children: children
            };
        };

        const transformedTree = transform(dependencyTree, dependencyTree.name);

        await fs.writeJson(outputFile, transformedTree, { spaces: 2 });
        console.log(`Analysis complete. Results saved to ${outputFile}`);

        return transformedTree;
    } catch (error) {
        console.error(`Analysis failed for project ${projectId}:`, error);
        throw error;
    }
}

function enrichWithRiskAnalysis(tree) {
    // Traverse the tree and add mock risk scores/levels based on heuristics
    // Real implementation would query NVD or OSSF Scorecard

    const traverse = (node) => {
        if (!node) return;

        // Arbitrary risk calculation for demo purposes
        const riskScore = Math.floor(Math.random() * 100);
        let riskLevel = "low";
        if (riskScore > 75) riskLevel = "critical";
        else if (riskScore > 50) riskLevel = "high";
        else if (riskScore > 25) riskLevel = "medium";

        node.risk = {
            score: riskScore,
            level: riskLevel,
            // Add some "smells" from literature (e.g., empty description, scripts)
            smells: []
        };

        if (node.dependencies) {
            Object.values(node.dependencies).forEach(traverse);
        }
    };

    traverse(tree);
    return tree;
}
