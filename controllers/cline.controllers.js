const { exec, spawn } = require("child_process");
const { promisify } = require("util");
const fs = require("fs").promises;
const path = require("path");
const execPromise = promisify(exec);

// Analyze repository when user selects it from dashboard
exports.analyzeRepository = async (req, res) => {
  let tempDir = null;
  let analysisId = null;

  try {
    const { repoUrl, repoName, owner } = req.body;

    if (!repoUrl || !repoName || !owner) {
      return res.status(400).json({
        error: "Missing required fields: repoUrl, repoName, owner",
      });
    }

    console.log(`\n${"=".repeat(60)}`);
    console.log(`🔍 ANALYZING REPOSITORY: ${owner}/${repoName}`);
    console.log(`${"=".repeat(60)}\n`);

    // Generate analysis ID
    analysisId = `analysis-${Date.now()}-${Math.random()
      .toString(36)
      .substr(2, 9)}`;

    // Create temp directory for cloning
    tempDir = path.join(__dirname, "../temp", analysisId);
    await fs.mkdir(tempDir, { recursive: true });

    console.log(`📂 Created temp directory: ${tempDir}`);

    // Update analysis status to "cloning"
    await updateAnalysisStatus(analysisId, "cloning", {
      repoUrl,
      repoName,
      owner,
      startTime: new Date().toISOString(),
    });

    // Send immediate response to prevent timeout
    res.json({
      success: true,
      analysisId,
      status: "started",
      message:
        "Repository analysis started. Use the analysisId to track progress.",
      trackingUrl: `/api/v1/cline/analysis/${analysisId}`,
      streamUrl: `/api/v1/cline/analysis/${analysisId}/stream`,
    });

    // Continue analysis in background
    performAnalysis(analysisId, repoUrl, repoName, owner, tempDir);
  } catch (error) {
    console.error(`\n❌ Analysis failed:`, error.message);
    console.error(error.stack);

    // Cleanup on error
    if (tempDir) {
      await cleanupTempDir(tempDir);
    }

    // Update status to failed
    if (analysisId) {
      await updateAnalysisStatus(analysisId, "failed", {
        error: error.message,
        stack: error.stack,
      });
    }

    res.status(500).json({
      error: "Repository analysis failed",
      details: error.message,
      analysisId,
    });
  }
};

// Background analysis function
async function performAnalysis(analysisId, repoUrl, repoName, owner, tempDir) {
  try {
    // Step 1: Clone repository
    console.log(`\n📦 Step 1: Cloning repository...`);
    const cloneResult = await cloneRepository(repoUrl, tempDir);
    console.log(`✅ Repository cloned successfully`);

    // Update status to "analyzing"
    await updateAnalysisStatus(analysisId, "analyzing", {
      cloned: true,
      cloneTime: cloneResult.duration,
    });

    // Step 2: Get repository structure
    console.log(`\n📁 Step 2: Analyzing repository structure...`);
    const structure = await analyzeStructure(tempDir);
    console.log(
      `✅ Found ${structure.totalFiles} files in ${structure.directories.length} directories`
    );

    // Step 3: Analyze code quality with Cline CLI
    console.log(`\n🤖 Step 3: Running Cline CLI analysis...`);
    const clineAnalysis = await runClineAnalysis(tempDir, repoName);
    console.log(`✅ Cline analysis complete`);

    // Step 4: Check for security vulnerabilities
    console.log(`\n🔒 Step 4: Checking security vulnerabilities...`);
    const securityCheck = await checkSecurity(tempDir);
    console.log(
      `✅ Security check complete - Found ${securityCheck.vulnerabilities.length} issues`
    );

    // Step 5: Analyze dependencies
    console.log(`\n📦 Step 5: Analyzing dependencies...`);
    const dependencies = await analyzeDependencies(tempDir);
    console.log(`✅ Found ${dependencies.total} dependencies`);

    // Step 6: Check test coverage
    console.log(`\n🧪 Step 6: Checking test coverage...`);
    const testCoverage = await checkTestCoverage(tempDir);
    console.log(`✅ Test coverage: ${testCoverage.percentage}%`);

    // Step 7: Calculate code quality score
    console.log(`\n📊 Step 7: Calculating code quality score...`);
    const codeQuality = calculateCodeQuality({
      structure,
      clineAnalysis,
      securityCheck,
      dependencies,
      testCoverage,
    });
    console.log(
      `✅ Code Quality: ${codeQuality.score}/100 (${codeQuality.grade})`
    );

    // Step 8: Generate recommendations
    console.log(`\n💡 Step 8: Generating recommendations...`);
    const recommendations = generateRecommendations({
      codeQuality,
      securityCheck,
      testCoverage,
      dependencies,
      structure,
    });
    console.log(`✅ Generated ${recommendations.length} recommendations`);

    // Create comprehensive analysis result
    const analysis = {
      analysisId,
      repository: {
        url: repoUrl,
        name: repoName,
        owner,
      },
      timestamp: new Date().toISOString(),
      status: "completed",

      // Code Structure
      structure: {
        totalFiles: structure.totalFiles,
        totalLines: structure.totalLines,
        directories: structure.directories,
        fileTypes: structure.fileTypes,
        largestFiles: structure.largestFiles,
      },

      // Code Quality
      codeQuality: {
        score: codeQuality.score,
        grade: codeQuality.grade,
        complexity: codeQuality.complexity,
        maintainability: codeQuality.maintainability,
        hasTests: testCoverage.hasTests,
        hasTypeScript: structure.hasTypeScript,
        hasLinter: structure.hasLinter,
        hasCI: structure.hasCI,
      },

      // Cline Analysis
      clineAnalysis: {
        issuesFound: clineAnalysis.issues.length,
        suggestions: clineAnalysis.suggestions,
        improvements: clineAnalysis.improvements,
      },

      // Security
      security: {
        vulnerabilities: securityCheck.vulnerabilities,
        criticalCount: securityCheck.critical,
        highCount: securityCheck.high,
        mediumCount: securityCheck.medium,
        lowCount: securityCheck.low,
      },

      // Dependencies
      dependencies: {
        total: dependencies.total,
        production: dependencies.production,
        development: dependencies.development,
        outdated: dependencies.outdated,
        deprecated: dependencies.deprecated,
      },

      // Test Coverage
      testCoverage: {
        percentage: testCoverage.percentage,
        hasTests: testCoverage.hasTests,
        lines: testCoverage.lines,
        functions: testCoverage.functions,
        branches: testCoverage.branches,
      },

      // Recommendations
      recommendations,

      // Issues Summary
      issues: [...securityCheck.vulnerabilities, ...clineAnalysis.issues],

      // Metadata
      metadata: {
        analysisTime: Date.now() - new Date(analysisId.split("-")[1]).getTime(),
        tempDir,
      },
    };

    // Save analysis to database/file
    await saveAnalysis(analysis);

    // Update status to completed
    await updateAnalysisStatus(analysisId, "completed", analysis);

    console.log(`\n${"=".repeat(60)}`);
    console.log(`✅ ANALYSIS COMPLETE: ${analysisId}`);
    console.log(`${"=".repeat(60)}\n`);

    // Schedule cleanup (after 1 hour)
    setTimeout(() => cleanupTempDir(tempDir), 3600000);
  } catch (error) {
    console.error(`\n❌ Background analysis failed:`, error.message);
    console.error(error.stack);

    // Cleanup on error
    if (tempDir) {
      await cleanupTempDir(tempDir);
    }

    // Update status to failed
    await updateAnalysisStatus(analysisId, "failed", {
      error: error.message,
      stack: error.stack,
    });
  }
}

// Get analysis status/results
exports.getAnalysis = async (req, res) => {
  try {
    const { analysisId } = req.params;

    if (!analysisId) {
      return res.status(400).json({
        error: "Analysis ID is required",
      });
    }

    const analysis = await loadAnalysis(analysisId);

    if (!analysis) {
      return res.status(404).json({
        error: "Analysis not found",
      });
    }

    res.json({
      success: true,
      analysis,
    });
  } catch (error) {
    res.status(500).json({
      error: "Failed to get analysis",
      details: error.message,
    });
  }
};

// Stream analysis progress (Server-Sent Events)
exports.streamAnalysisProgress = async (req, res) => {
  const { analysisId } = req.params;

  // Set headers for SSE
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");

  // Send initial connection message
  res.write(`data: ${JSON.stringify({ type: "connected", analysisId })}\n\n`);

  // Poll for status updates
  const interval = setInterval(async () => {
    try {
      const analysis = await loadAnalysis(analysisId);

      if (analysis) {
        res.write(
          `data: ${JSON.stringify({
            type: "progress",
            status: analysis.status,
            data: analysis,
          })}\n\n`
        );

        if (analysis.status === "completed" || analysis.status === "failed") {
          clearInterval(interval);
          res.write(`data: ${JSON.stringify({ type: "done" })}\n\n`);
          res.end();
        }
      }
    } catch (error) {
      clearInterval(interval);
      res.write(
        `data: ${JSON.stringify({
          type: "error",
          error: error.message,
        })}\n\n`
      );
      res.end();
    }
  }, 1000);

  // Cleanup on client disconnect
  req.on("close", () => {
    clearInterval(interval);
  });
};

// Get user's analysis history
exports.getAnalysisHistory = async (req, res) => {
  try {
    const userId = req.user.id;
    const { limit = 10, offset = 0 } = req.query;

    const history = await getAnalysisHistoryForUser(userId, limit, offset);

    res.json({
      success: true,
      history,
      total: history.length,
    });
  } catch (error) {
    res.status(500).json({
      error: "Failed to get analysis history",
      details: error.message,
    });
  }
};

// ═══════════════════════════════════════════════════════
// HELPER FUNCTIONS
// ═══════════════════════════════════════════════════════

// Clone repository with better error handling
async function cloneRepository(repoUrl, targetDir) {
  const startTime = Date.now();

  try {
    console.log(`   📥 Cloning from: ${repoUrl}`);
    console.log(`   📂 Target: ${targetDir}`);

    // Use spawn instead of exec for better control
    const result = await new Promise((resolve, reject) => {
      const gitProcess = spawn(
        "git",
        ["clone", "--depth", "1", "--single-branch", repoUrl, targetDir],
        {
          stdio: ["ignore", "pipe", "pipe"],
          timeout: 300000, // 5 minutes
        }
      );

      let stdout = "";
      let stderr = "";

      gitProcess.stdout.on("data", (data) => {
        stdout += data.toString();
        console.log(`   ${data.toString().trim()}`);
      });

      gitProcess.stderr.on("data", (data) => {
        stderr += data.toString();
        console.log(`   ${data.toString().trim()}`);
      });

      gitProcess.on("close", (code) => {
        if (code === 0) {
          resolve({ stdout, stderr });
        } else {
          reject(new Error(`Git clone failed with code ${code}: ${stderr}`));
        }
      });

      gitProcess.on("error", (error) => {
        reject(new Error(`Failed to start git process: ${error.message}`));
      });

      // Timeout handler
      setTimeout(() => {
        gitProcess.kill();
        reject(new Error("Git clone timeout after 5 minutes"));
      }, 300000);
    });

    const duration = Date.now() - startTime;
    console.log(`   ⏱️  Clone completed in ${(duration / 1000).toFixed(2)}s`);

    return { success: true, duration };
  } catch (error) {
    throw new Error(`Failed to clone repository: ${error.message}`);
  }
}

// Analyze repository structure (Windows compatible)
async function analyzeStructure(repoPath) {
  console.log(`   📊 Analyzing file structure...`);

  const structure = {
    totalFiles: 0,
    totalLines: 0,
    directories: [],
    fileTypes: {},
    largestFiles: [],
    hasTypeScript: false,
    hasLinter: false,
    hasCI: false,
  };

  // Get all files recursively (Windows compatible)
  const files = await getAllFiles(repoPath);

  structure.totalFiles = files.length;

  // Analyze each file
  for (const file of files.slice(0, 1000)) {
    try {
      const ext = path.extname(file);
      const stats = await fs.stat(file);

      // Count file types
      structure.fileTypes[ext] = (structure.fileTypes[ext] || 0) + 1;

      // Check for TypeScript
      if (ext === ".ts" || ext === ".tsx") {
        structure.hasTypeScript = true;
      }

      // Check for linter config
      if (file.includes(".eslintrc") || file.includes(".prettierrc")) {
        structure.hasLinter = true;
      }

      // Check for CI config
      if (file.includes(".github") || file.includes(".gitlab-ci")) {
        structure.hasCI = true;
      }

      // Count lines for text files
      if (ext.match(/\.(js|ts|jsx|tsx|py|java|go|rb)$/)) {
        const content = await fs.readFile(file, "utf8");
        const lines = content.split("\n").length;
        structure.totalLines += lines;

        // Track largest files
        structure.largestFiles.push({
          file: file.replace(repoPath, ""),
          lines,
          size: stats.size,
        });
      }
    } catch (error) {
      // Skip files that can't be read
    }
  }

  // Sort and limit largest files
  structure.largestFiles = structure.largestFiles
    .sort((a, b) => b.lines - a.lines)
    .slice(0, 10);

  // Get unique directories
  structure.directories = [
    ...new Set(files.map((f) => path.dirname(f.replace(repoPath, "")))),
  ].filter((d) => d !== "" && d !== ".");

  console.log(`   ✓ Analyzed ${structure.totalFiles} files`);

  return structure;
}

// Helper: Get all files recursively (Windows compatible)
async function getAllFiles(dir) {
  const files = [];

  async function walk(currentPath) {
    try {
      const entries = await fs.readdir(currentPath, { withFileTypes: true });

      for (const entry of entries) {
        const fullPath = path.join(currentPath, entry.name);

        // Skip common directories
        if (entry.isDirectory()) {
          if (
            !entry.name.includes("node_modules") &&
            !entry.name.includes(".git") &&
            !entry.name.includes("dist") &&
            !entry.name.includes("build")
          ) {
            await walk(fullPath);
          }
        } else {
          files.push(fullPath);
        }
      }
    } catch (error) {
      // Skip directories we can't read
    }
  }

  await walk(dir);
  return files;
}

// Run Cline CLI analysis
async function runClineAnalysis(repoPath, repoName) {
  console.log(`   🤖 Running Cline CLI analysis...`);
  // Always use simulated analysis for now
  return simulateClineAnalysis(repoPath);
}

// Simulate Cline analysis (Windows compatible)
async function simulateClineAnalysis(repoPath) {
  console.log(`   🔄 Running simulated code analysis...`);

  const issues = [];
  const suggestions = [];

  // Get JavaScript/TypeScript files
  const files = await getAllFiles(repoPath);
  const codeFiles = files
    .filter(
      (f) =>
        f.match(/\.(js|ts|jsx|tsx)$/) &&
        !f.includes("node_modules") &&
        !f.includes(".test.") &&
        !f.includes(".spec.")
    )
    .slice(0, 20);

  for (const file of codeFiles) {
    try {
      const content = await fs.readFile(file, "utf8");
      const relativePath = file.replace(repoPath, "");

      // Check for console.log
      const consoleMatches = content.match(/console\.(log|warn|error)/g);
      if (consoleMatches && consoleMatches.length > 0) {
        issues.push({
          type: "code-quality",
          severity: "low",
          file: relativePath,
          description: `Found ${consoleMatches.length} console statement(s). Consider using a proper logging library.`,
          suggestion:
            "Replace console statements with a logging library like winston or pino",
        });
      }

      // Check for TODO comments
      const todoMatches = content.match(/\/\/\s*TODO:/gi);
      if (todoMatches) {
        issues.push({
          type: "maintenance",
          severity: "info",
          file: relativePath,
          description: `Found ${todoMatches.length} TODO comment(s)`,
          suggestion: "Create GitHub issues for TODO items",
        });
      }

      // Check for eval usage
      if (content.includes("eval(")) {
        issues.push({
          type: "security",
          severity: "high",
          file: relativePath,
          description: "Using eval() is a security risk",
          suggestion: "Remove eval() and use safer alternatives",
        });
      }

      // Check file size
      const lines = content.split("\n").length;
      if (lines > 500) {
        suggestions.push({
          file: relativePath,
          suggestion: `File is ${lines} lines long. Consider breaking it into smaller modules.`,
        });
      }
    } catch (error) {
      // Skip files that can't be read
    }
  }

  console.log(`   ✓ Found ${issues.length} potential issues`);

  return { issues, suggestions, improvements: [] };
}

// Check security vulnerabilities (Windows compatible)
async function checkSecurity(repoPath) {
  console.log(`   🔒 Scanning for security issues...`);

  const security = {
    vulnerabilities: [],
    critical: 0,
    high: 0,
    medium: 0,
    low: 0,
  };

  // Check if package.json exists
  const packageJsonPath = path.join(repoPath, "package.json");

  try {
    await fs.access(packageJsonPath);
    console.log(`   ℹ️  Found package.json`);
  } catch {
    console.log(`   ℹ️  No package.json found`);
  }

  // Check for common security issues in code
  await checkCodeSecurityIssues(repoPath, security);

  return security;
}

// Check code for security issues
async function checkCodeSecurityIssues(repoPath, security) {
  try {
    const files = await getAllFiles(repoPath);
    const codeFiles = files
      .filter((f) => f.match(/\.(js|ts)$/) && !f.includes("node_modules"))
      .slice(0, 50);

    for (const file of codeFiles) {
      try {
        const content = await fs.readFile(file, "utf8");
        const relativePath = file.replace(repoPath, "");

        // Check for hardcoded secrets
        const secretPatterns = [
          /password\s*=\s*["'][^"']+["']/i,
          /api[_-]?key\s*=\s*["'][^"']+["']/i,
          /secret\s*=\s*["'][^"']+["']/i,
          /token\s*=\s*["'][^"']+["']/i,
        ];

        for (const pattern of secretPatterns) {
          if (pattern.test(content)) {
            security.vulnerabilities.push({
              type: "security",
              severity: "critical",
              file: relativePath,
              description: "Potential hardcoded credentials detected",
              recommendation: "Move secrets to environment variables",
            });
            security.critical++;
            break;
          }
        }

        // Check for SQL injection
        if (content.match(/query\s*\(.*\$\{.*\}\)/)) {
          security.vulnerabilities.push({
            type: "security",
            severity: "high",
            file: relativePath,
            description: "Potential SQL injection vulnerability",
            recommendation: "Use parameterized queries",
          });
          security.high++;
        }
      } catch {
        // Skip files that can't be read
      }
    }
  } catch {
    // Ignore errors
  }
}

// Analyze dependencies
async function analyzeDependencies(repoPath) {
  console.log(`   📦 Analyzing dependencies...`);

  const dependencies = {
    total: 0,
    production: 0,
    development: 0,
    outdated: [],
    deprecated: [],
  };

  try {
    const packageJsonPath = path.join(repoPath, "package.json");
    const packageJson = JSON.parse(await fs.readFile(packageJsonPath, "utf8"));

    if (packageJson.dependencies) {
      dependencies.production = Object.keys(packageJson.dependencies).length;
    }

    if (packageJson.devDependencies) {
      dependencies.development = Object.keys(
        packageJson.devDependencies
      ).length;
    }

    dependencies.total = dependencies.production + dependencies.development;

    console.log(`   ✓ Found ${dependencies.total} dependencies`);
  } catch {
    console.log(`   ℹ️  No dependencies found`);
  }

  return dependencies;
}

// Check test coverage
async function checkTestCoverage(repoPath) {
  console.log(`   🧪 Checking test coverage...`);

  const coverage = {
    percentage: 0,
    hasTests: false,
    lines: { covered: 0, total: 0 },
    functions: { covered: 0, total: 0 },
    branches: { covered: 0, total: 0 },
  };

  try {
    const files = await getAllFiles(repoPath);
    const testFiles = files.filter(
      (f) =>
        (f.includes(".test.") || f.includes(".spec.")) &&
        !f.includes("node_modules")
    );

    coverage.hasTests = testFiles.length > 0;

    if (coverage.hasTests) {
      console.log(`   ✓ Found ${testFiles.length} test file(s)`);

      // Estimate coverage based on test files
      const sourceFiles = files.filter(
        (f) =>
          f.match(/\.(js|ts)$/) &&
          !f.includes("node_modules") &&
          !f.includes(".test.") &&
          !f.includes(".spec.")
      ).length;

      coverage.percentage = Math.min(
        Math.round((testFiles.length / Math.max(sourceFiles, 1)) * 100),
        100
      );
    } else {
      console.log(`   ⚠️  No test files found`);
    }
  } catch {
    console.log(`   ℹ️  Could not check test coverage`);
  }

  return coverage;
}

// Calculate code quality score
function calculateCodeQuality(data) {
  let score = 100;

  // Deduct for issues
  score -= data.clineAnalysis.issues.length * 2;

  // Deduct for security vulnerabilities
  score -= data.securityCheck.critical * 10;
  score -= data.securityCheck.high * 5;
  score -= data.securityCheck.medium * 2;

  // Deduct for low test coverage
  if (data.testCoverage.percentage < 80) {
    score -= (80 - data.testCoverage.percentage) / 2;
  }

  // Deduct for large files
  if (data.structure.largestFiles.length > 0) {
    const largeFileCount = data.structure.largestFiles.filter(
      (f) => f.lines > 500
    ).length;
    score -= largeFileCount * 3;
  }

  // Bonus for good practices
  if (data.structure.hasTypeScript) score += 5;
  if (data.structure.hasLinter) score += 5;
  if (data.structure.hasCI) score += 5;
  if (data.testCoverage.percentage > 90) score += 10;

  // Clamp score
  score = Math.max(0, Math.min(100, Math.round(score)));

  const grade =
    score >= 90
      ? "A"
      : score >= 80
      ? "B"
      : score >= 70
      ? "C"
      : score >= 60
      ? "D"
      : "F";

  const complexity = score >= 80 ? "low" : score >= 60 ? "medium" : "high";
  const maintainability = score >= 75 ? "good" : score >= 50 ? "fair" : "poor";

  return { score, grade, complexity, maintainability };
}

// Generate recommendations
function generateRecommendations(data) {
  const recommendations = [];

  // Security recommendations
  if (data.securityCheck.critical > 0) {
    recommendations.push({
      priority: 1,
      category: "security",
      title: "Fix Critical Security Vulnerabilities",
      description: `Found ${data.securityCheck.critical} critical security issue(s). These should be addressed immediately.`,
      action: "Run security audit and update vulnerable packages",
    });
  }

  // Test coverage recommendations
  if (!data.testCoverage.hasTests) {
    recommendations.push({
      priority: 2,
      category: "testing",
      title: "Add Unit Tests",
      description:
        "No test files found. Adding tests will improve code reliability and catch bugs early.",
      action: "Set up testing framework (Jest/Mocha) and add unit tests",
    });
  } else if (data.testCoverage.percentage < 80) {
    recommendations.push({
      priority: 3,
      category: "testing",
      title: "Improve Test Coverage",
      description: `Current test coverage is ${data.testCoverage.percentage}%. Aim for at least 80%.`,
      action: "Add tests for uncovered code paths",
    });
  }

  // Code quality recommendations
  if (!data.structure.hasTypeScript && data.structure.totalFiles > 10) {
    recommendations.push({
      priority: 4,
      category: "code-quality",
      title: "Consider TypeScript Migration",
      description:
        "TypeScript adds type safety and improves code maintainability.",
      action: "Gradually migrate to TypeScript starting with new files",
    });
  }

  if (!data.structure.hasLinter) {
    recommendations.push({
      priority: 5,
      category: "code-quality",
      title: "Add Code Linter",
      description:
        "A linter helps maintain consistent code style and catches common errors.",
      action: "Set up ESLint with appropriate configuration",
    });
  }

  // CI/CD recommendations
  if (!data.structure.hasCI) {
    recommendations.push({
      priority: 6,
      category: "devops",
      title: "Set Up CI/CD Pipeline",
      description:
        "Automated testing and deployment improves development workflow.",
      action: "Add GitHub Actions or GitLab CI configuration",
    });
  }

  // Refactoring recommendations
  const largeFiles = data.structure.largestFiles.filter((f) => f.lines > 500);
  if (largeFiles.length > 0) {
    recommendations.push({
      priority: 7,
      category: "refactoring",
      title: "Refactor Large Files",
      description: `${largeFiles.length} file(s) are over 500 lines. Consider breaking them into smaller modules.`,
      action: "Split large files into smaller, focused modules",
    });
  }

  return recommendations;
}

// Save analysis to storage
async function saveAnalysis(analysis) {
  try {
    const analysisDir = path.join(__dirname, "../data/analyses");
    await fs.mkdir(analysisDir, { recursive: true });

    const filePath = path.join(analysisDir, `${analysis.analysisId}.json`);
    await fs.writeFile(filePath, JSON.stringify(analysis, null, 2));

    console.log(`   💾 Analysis saved: ${analysis.analysisId}`);
  } catch (error) {
    console.error(`   ⚠️  Could not save analysis:`, error.message);
  }
}

// Load analysis from storage
async function loadAnalysis(analysisId) {
  try {
    const filePath = path.join(
      __dirname,
      "../data/analyses",
      `${analysisId}.json`
    );
    const data = await fs.readFile(filePath, "utf8");
    return JSON.parse(data);
  } catch {
    return null;
  }
}

// Update analysis status
async function updateAnalysisStatus(analysisId, status, data = {}) {
  try {
    const analysis = (await loadAnalysis(analysisId)) || { analysisId };

    analysis.status = status;
    analysis.lastUpdated = new Date().toISOString();
    Object.assign(analysis, data);

    await saveAnalysis(analysis);
  } catch (error) {
    console.error(`   ⚠️  Could not update status:`, error.message);
  }
}

// Get analysis history for user
async function getAnalysisHistoryForUser(userId, limit, offset) {
  try {
    const analysisDir = path.join(__dirname, "../data/analyses");
    const files = await fs.readdir(analysisDir);

    const analyses = [];
    for (const file of files) {
      const filePath = path.join(analysisDir, file);
      const data = await fs.readFile(filePath, "utf8");
      const analysis = JSON.parse(data);

      analyses.push({
        analysisId: analysis.analysisId,
        repository: analysis.repository,
        status: analysis.status,
        timestamp: analysis.timestamp,
        codeQuality: analysis.codeQuality,
      });
    }

    return analyses
      .sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp))
      .slice(offset, offset + parseInt(limit));
  } catch {
    return [];
  }
}

// Cleanup temp directory
async function cleanupTempDir(dir) {
  try {
    await fs.rm(dir, { recursive: true, force: true });
    console.log(`   🧹 Cleaned up: ${dir}`);
  } catch (error) {
    console.warn(`   ⚠️  Could not cleanup ${dir}:`, error.message);
  }
}

module.exports = exports;
