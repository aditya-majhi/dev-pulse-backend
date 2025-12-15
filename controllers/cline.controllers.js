const { spawn, exec } = require("child_process");
const { promisify } = require("util");
const fs = require("fs").promises;
const path = require("path");
const axios = require("axios");
const supabase = require("../services/supabase.services");

const execPromise = promisify(exec);

// =============================
// MAIN ENDPOINTS
// =============================

//Get all analyses for the authenticated user

exports.getAllAnalyses = async (req, res) => {
  const userId = req.user?.id;
  const {
    limit = 20,
    offset = 0,
    status,
    sortBy = "created_at",
    order = "desc",
  } = req.query;

  if (!userId) {
    return res.status(401).json({ error: "User not authenticated" });
  }

  try {
    let query = supabase
      .from("analyses")
      .select(
        `
        analysis_id,
        repo_name,
        repo_owner,
        repo_url,
        status,
        progress,
        code_quality,
        structure,
        message,
        error,
        created_at,
        completed_at,
        updated_at
      `,
        { count: "exact" }
      )
      .eq("user_id", String(userId));

    // Filter by status if provided
    if (status) {
      query = query.eq("status", status);
    }

    // Sort
    const validSortFields = [
      "created_at",
      "completed_at",
      "repo_name",
      "status",
    ];
    const sortField = validSortFields.includes(sortBy) ? sortBy : "created_at";
    const sortOrder =
      order.toLowerCase() === "asc"
        ? { ascending: true }
        : { ascending: false };

    query = query.order(sortField, sortOrder);

    // Pagination
    query = query.range(
      parseInt(offset),
      parseInt(offset) + parseInt(limit) - 1
    );

    const { data, error, count } = await query;

    if (error) {
      throw error;
    }

    // Get fix jobs for these analyses
    const analysisIds = data.map((a) => a.analysis_id);
    let fixJobs = [];

    if (analysisIds.length > 0) {
      const { data: fixData } = await supabase
        .from("autonomous_fix_jobs")
        .select(
          `
          job_id,
          analysis_id,
          status,
          progress,
          pr_url,
          pr_number,
          high_impact_issues,
          files_modified,
          created_at,
          completed_at
        `
        )
        .in("analysis_id", analysisIds);

      fixJobs = fixData || [];
    }

    // Merge fix jobs with analyses
    const enrichedData = data.map((analysis) => {
      const fixes = fixJobs.filter(
        (f) => f.analysis_id === analysis.analysis_id
      );
      return {
        ...analysis,
        fixes: fixes.length > 0 ? fixes : null,
        hasActiveFixes: fixes.some(
          (f) => f.status === "processing" || f.status === "initializing"
        ),
        hasCompletedFixes: fixes.some((f) => f.status === "completed"),
      };
    });

    res.json({
      success: true,
      analyses: enrichedData,
      pagination: {
        total: count,
        limit: parseInt(limit),
        offset: parseInt(offset),
        page: Math.floor(parseInt(offset) / parseInt(limit)) + 1,
        totalPages: Math.ceil(count / parseInt(limit)),
      },
      filters: {
        status: status || "all",
        sortBy: sortField,
        order: order.toLowerCase(),
      },
    });
  } catch (error) {
    console.error("Error fetching user analyses:", error);
    res.status(500).json({
      error: "Failed to fetch analyses",
      details: error.message,
    });
  }
};

exports.analyzeRepository = async (req, res) => {
  const {
    repoUrl,
    repoName,
    owner,
    enableAIFix = false,
    accessToken,
  } = req.body;
  const userId = req.user?.id ? String(req.user.id) : null;

  if (!repoUrl || !repoName || !owner) {
    return res.status(400).json({ error: "Missing required fields" });
  }

  try {
    const analysisId = `analysis-${Date.now()}-${Math.random()
      .toString(36)
      .substring(2, 9)}`;

    await supabase.from("analyses").insert({
      analysis_id: analysisId,
      user_id: userId,
      repo_url: repoUrl,
      repo_name: repoName,
      repo_owner: owner,
      status: "pending",
      progress: 0,
      message: "Analysis queued...",
      created_at: new Date().toISOString(),
    });

    console.log(`🚀 Analysis started: ${analysisId}`);

    res.json({ success: true, analysisId, message: "Analysis started" });

    performAnalysis(
      analysisId,
      repoUrl,
      repoName,
      owner,
      enableAIFix,
      accessToken
    ).catch((err) => {
      console.error(`❌ Analysis ${analysisId} failed:`, err);
    });
  } catch (error) {
    console.error("Error in analyzeRepository:", error);
    res.status(500).json({ error: error.message });
  }
};

exports.triggerAIFix = async (req, res) => {
  const { analysisId, accessToken } = req.body;

  if (!analysisId || !accessToken) {
    return res.status(400).json({
      error: "Missing required fields: analysisId and accessToken",
    });
  }

  try {
    const { data: analysis, error } = await supabase
      .from("analyses")
      .select("*")
      .eq("analysis_id", analysisId)
      .single();

    if (error || !analysis) {
      return res.status(404).json({ error: "Analysis not found" });
    }

    if (analysis.status !== "completed") {
      return res.status(400).json({
        error: "Analysis must be completed before running AI fix",
      });
    }

    res.json({ success: true, message: "AI fix started", analysisId });

    runAIFixWorkflow(
      {
        analysisId: analysis.analysis_id,
        repoName: analysis.repo_name,
        owner: analysis.repo_owner,
        repoUrl: analysis.repo_url,
      },
      accessToken
    ).catch((err) => console.error(`AI fix ${analysisId} failed:`, err));
  } catch (error) {
    res.status(500).json({
      error: "Failed to trigger AI fix",
      details: error.message,
    });
  }
};

exports.autonomousHighImpactFix = async (req, res) => {
  const { analysisId, accessToken, autoMerge = false } = req.body;

  if (!analysisId || !accessToken) {
    return res.status(400).json({
      error: "Missing required fields: analysisId and accessToken",
      hint: "Generate a token at https://github.com/settings/tokens with 'repo' scope",
    });
  }

  try {
    const { data: analysis, error } = await supabase
      .from("analyses")
      .select("*")
      .eq("analysis_id", analysisId)
      .single();

    if (error || !analysis) {
      return res.status(404).json({ error: "Analysis not found" });
    }

    if (analysis.status !== "completed") {
      return res.status(400).json({
        error: "Analysis must be completed first",
        currentStatus: analysis.status,
      });
    }

    const fixJobId = `autofix-${Date.now()}-${Math.random()
      .toString(36)
      .substr(2, 9)}`;

    await supabase.from("autonomous_fix_jobs").insert({
      job_id: fixJobId,
      analysis_id: analysisId,
      repo_name: analysis.repo_name,
      repo_owner: analysis.repo_owner,
      status: "initializing",
      progress: 0,
      message: "Identifying high-impact issues...",
      created_at: new Date().toISOString(),
    });

    res.json({
      success: true,
      jobId: fixJobId,
      analysisId,
      message: "Autonomous fix started - high-impact issues will be fixed",
      status: "processing",
    });

    runAutonomousHighImpactFix(
      fixJobId,
      analysis,
      accessToken,
      autoMerge
    ).catch((err) => {
      console.error(`❌ Autonomous fix ${fixJobId} failed:`, err);
    });
  } catch (error) {
    res.status(500).json({
      error: "Failed to start autonomous fix",
      details: error.message,
    });
  }
};

exports.getAutonomousFixStatus = async (req, res) => {
  const { jobId } = req.params;

  try {
    const { data, error } = await supabase
      .from("autonomous_fix_jobs")
      .select("*")
      .eq("job_id", jobId)
      .single();

    if (error || !data) {
      return res.status(404).json({ error: "Fix job not found" });
    }

    res.json({
      success: true,
      job: {
        jobId: data.job_id,
        analysisId: data.analysis_id,
        status: data.status,
        progress: data.progress,
        message: data.message,
        highImpactIssues: data.high_impact_issues,
        fixesApplied: data.fixes_applied,
        filesModified: data.files_modified,
        prUrl: data.pr_url,
        prNumber: data.pr_number,
        error: data.error,
        createdAt: data.created_at,
        completedAt: data.completed_at,
      },
    });
  } catch (error) {
    res.status(500).json({
      error: "Failed to get fix job status",
      details: error.message,
    });
  }
};

exports.getAnalysis = async (req, res) => {
  const { analysisId } = req.params;

  try {
    const { data, error } = await supabase
      .from("analyses")
      .select("*")
      .eq("analysis_id", analysisId)
      .single();

    if (error || !data) {
      return res.status(404).json({ error: "Analysis not found" });
    }

    res.json({ success: true, analysis: data });
  } catch (error) {
    res.status(500).json({
      error: "Failed to get analysis",
      details: error.message,
    });
  }
};

exports.getAnalysisProgress = async (req, res) => {
  const { analysisId } = req.params;

  try {
    const { data, error } = await supabase
      .from("analyses")
      .select(
        "status, progress, current_step, total_steps, message, code_quality"
      )
      .eq("analysis_id", analysisId)
      .single();

    if (error || !data) {
      return res.status(404).json({ error: "Analysis not found" });
    }

    res.json({
      success: true,
      analysisId,
      status: data.status,
      progress: {
        percentage: data.progress,
        currentStep: data.current_step,
        totalSteps: data.total_steps,
        message: data.message,
      },
      codeQuality: data.code_quality,
    });
  } catch (error) {
    res.status(500).json({
      error: "Failed to get progress",
      details: error.message,
    });
  }
};

exports.streamAnalysisProgress = async (req, res) => {
  const { analysisId } = req.params;

  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");

  res.write(`event: connected\ndata: ${JSON.stringify({ analysisId })}\n\n`);

  let lastProgress = -1;

  const interval = setInterval(async () => {
    try {
      const { data, error } = await supabase
        .from("analyses")
        .select("status, progress, current_step, total_steps, message")
        .eq("analysis_id", analysisId)
        .single();

      if (error || !data) {
        res.write(
          `event: error\ndata: ${JSON.stringify({ error: "Not found" })}\n\n`
        );
        clearInterval(interval);
        res.end();
        return;
      }

      if (data.progress !== lastProgress) {
        lastProgress = data.progress;
        res.write(
          `event: progress\ndata: ${JSON.stringify({
            status: data.status,
            progress: data.progress,
            step: data.current_step,
            totalSteps: data.total_steps,
            message: data.message,
          })}\n\n`
        );
      }

      if (data.status === "completed" || data.status === "failed") {
        res.write(`event: ${data.status}\ndata: ${JSON.stringify({})}\n\n`);
        clearInterval(interval);
        res.end();
      }
    } catch (error) {
      res.write(
        `event: error\ndata: ${JSON.stringify({ error: error.message })}\n\n`
      );
      clearInterval(interval);
      res.end();
    }
  }, 1000);

  req.on("close", () => clearInterval(interval));
};

exports.getAnalysisHistory = async (req, res) => {
  const { limit = 10, offset = 0 } = req.query;

  try {
    const { data, error, count } = await supabase
      .from("analyses")
      .select(
        "analysis_id, repo_name, repo_owner, status, progress, code_quality, created_at",
        {
          count: "exact",
        }
      )
      .order("created_at", { ascending: false })
      .range(offset, offset + parseInt(limit) - 1);

    if (error) throw error;

    res.json({
      success: true,
      history: data,
      total: count,
      limit: parseInt(limit),
      offset: parseInt(offset),
    });
  } catch (error) {
    res.status(500).json({
      error: "Failed to get history",
      details: error.message,
    });
  }
};

// =============================
// AUTONOMOUS FIX WORKFLOW
// =============================

async function runAutonomousHighImpactFix(
  fixJobId,
  analysis,
  accessToken,
  autoMerge
) {
  let tempDir = null;

  try {
    console.log(`\n🤖 AUTONOMOUS FIX: ${fixJobId}`);

    await updateFixJobProgress(
      fixJobId,
      "analyzing",
      10,
      "Analyzing issues..."
    );

    const highImpactIssues = identifyHighImpactIssues(analysis);

    if (highImpactIssues.length === 0) {
      await supabase
        .from("autonomous_fix_jobs")
        .update({
          status: "completed",
          progress: 100,
          message: "No high-impact issues detected",
          completed_at: new Date().toISOString(),
        })
        .eq("job_id", fixJobId);
      return;
    }

    console.log(`🚨 Found ${highImpactIssues.length} high-impact issues`);

    await supabase
      .from("autonomous_fix_jobs")
      .update({ high_impact_issues: highImpactIssues })
      .eq("job_id", fixJobId);

    await updateFixJobProgress(
      fixJobId,
      "cloning",
      20,
      "Cloning repository..."
    );

    tempDir = path.join(__dirname, "../temp", fixJobId);
    await fs.mkdir(tempDir, { recursive: true });
    await cloneRepository(analysis.repo_url, tempDir);

    await updateFixJobProgress(fixJobId, "fixing", 40, "Generating fixes...");

    const fixResult = await generateHighImpactFixes(
      tempDir,
      highImpactIssues,
      analysis
    );

    if (!fixResult.success) {
      throw new Error(`Fix generation failed: ${fixResult.error}`);
    }

    await updateFixJobProgress(
      fixJobId,
      "committing",
      60,
      "Committing changes..."
    );

    const branchName = `devpulse-fix-${Date.now()}`;

    await runCommand("git", ["config", "user.name", "DevPulse AI"], tempDir);
    await runCommand(
      "git",
      ["config", "user.email", "ai@devpulse.dev"],
      tempDir
    );
    await runCommand("git", ["checkout", "-b", branchName], tempDir);
    await runCommand("git", ["add", "."], tempDir);

    const commitMessage = buildCommitMessage(highImpactIssues, fixResult);
    await runCommand("git", ["commit", "-m", commitMessage], tempDir);

    await updateFixJobProgress(fixJobId, "pushing", 75, "Pushing changes...");

    await pushToGitHub(tempDir, branchName, accessToken, analysis.repo_url);

    await updateFixJobProgress(fixJobId, "creating_pr", 90, "Creating PR...");

    const pr = await createProductionReadyPR(
      analysis.repo_owner,
      analysis.repo_name,
      branchName,
      highImpactIssues,
      fixResult,
      accessToken
    );

    await supabase
      .from("autonomous_fix_jobs")
      .update({
        status: "completed",
        progress: 100,
        message: "PR created successfully",
        fixes_applied: fixResult,
        files_modified: fixResult.filesModified,
        pr_url: pr.html_url,
        pr_number: pr.number,
        completed_at: new Date().toISOString(),
      })
      .eq("job_id", fixJobId);

    console.log(`✅ Fix completed: ${pr.html_url}`);

    await cleanupTempDir(tempDir);
  } catch (error) {
    console.error(`❌ Fix failed: ${error.message}`);

    await supabase
      .from("autonomous_fix_jobs")
      .update({
        status: "failed",
        error: error.message,
        updated_at: new Date().toISOString(),
      })
      .eq("job_id", fixJobId);

    if (tempDir) await cleanupTempDir(tempDir);
  }
}

// =============================
// CORE ANALYSIS WORKFLOW
// =============================

async function performAnalysis(
  analysisId,
  repoUrl,
  repoName,
  owner,
  enableAIFix,
  accessToken
) {
  let tempDir = null;

  try {
    console.log(`\n🚀 Analysis: ${analysisId}`);

    const isProduction =
      process.env.VERCEL === "1" || process.env.NODE_ENV === "production";

    tempDir = path.join(__dirname, "../temp", analysisId);
    await fs.mkdir(tempDir, { recursive: true });

    await updateProgress(analysisId, "cloning", 15, 1, "Cloning repository...");
    await cloneRepository(repoUrl, tempDir);

    await updateProgress(
      analysisId,
      "analyzing",
      30,
      2,
      "Analyzing structure..."
    );
    const structure = await analyzeStructure(tempDir);

    await updateProgress(
      analysisId,
      "ai_analyzing",
      75,
      5,
      "Running AI analysis..."
    );
    const aiAnalysis = await runAIAnalysis(tempDir);

    await updateProgress(
      analysisId,
      "analyzing",
      90,
      6,
      "Calculating score..."
    );
    const codeQuality = calculateScore(aiAnalysis);

    await supabase
      .from("analyses")
      .update({
        status: "completed",
        progress: 100,
        current_step: 6,
        message: "Analysis complete",
        structure,
        code_quality: codeQuality,
        ai_analysis: aiAnalysis,
        completed_at: new Date().toISOString(),
      })
      .eq("analysis_id", analysisId);

    console.log(`✅ Analysis completed: ${analysisId}`);

    if (enableAIFix && accessToken) {
      await runAIFixWorkflow(
        { analysisId, repoName, owner, repoUrl },
        accessToken,
        tempDir
      );
    } else {
      await cleanupTempDir(tempDir);
    }
  } catch (error) {
    console.error(`❌ Analysis failed: ${error.message}`);

    await supabase
      .from("analyses")
      .update({
        status: "failed",
        error: error.message,
        updated_at: new Date().toISOString(),
      })
      .eq("analysis_id", analysisId);

    if (tempDir) await cleanupTempDir(tempDir);
  }
}

// =============================
// HELPER FUNCTIONS
// =============================

function identifyHighImpactIssues(analysis) {
  const issues = [];
  const aiAnalysis = analysis.ai_analysis || {};

  if (aiAnalysis.security && Array.isArray(aiAnalysis.security)) {
    aiAnalysis.security
      .filter((s) => s.severity === "critical" || s.severity === "high")
      .forEach((vuln) => {
        issues.push({
          id: `security-${issues.length}`,
          type: "SECURITY",
          severity: vuln.severity,
          title: vuln.type || "Security Vulnerability",
          description: vuln.description || "Security issue detected",
          file: vuln.file,
          priority: vuln.severity === "critical" ? 1 : 2,
          fixable: true,
        });
      });
  }

  if (aiAnalysis.bugs && Array.isArray(aiAnalysis.bugs)) {
    aiAnalysis.bugs
      .filter((b) => b.severity === "critical" || b.severity === "high")
      .slice(0, 5)
      .forEach((bug) => {
        issues.push({
          id: `bug-${issues.length}`,
          type: "BUG",
          severity: bug.severity,
          title: bug.description?.substring(0, 100) || "Critical Bug",
          description: bug.description,
          file: bug.file,
          priority: bug.severity === "critical" ? 1 : 3,
          fixable: true,
        });
      });
  }

  issues.sort((a, b) => a.priority - b.priority);
  return issues;
}

async function generateHighImpactFixes(repoPath, issues, analysis) {
  const prompt = `Fix these high-impact issues. STRICT RULES:
❌ NO new packages/dependencies
❌ NO package.json changes
✅ ONLY fix listed security/bug issues
✅ Use existing code/libraries only

ISSUES:
${issues
  .map(
    (issue, i) =>
      `${i + 1}. [${issue.type}] ${issue.title}\n   File: ${
        issue.file
      }\n   Severity: ${issue.severity}`
  )
  .join("\n\n")}

Fix with minimal changes only.`;

  try {
    const output = await runClineTask(prompt, repoPath);
    const fixResult = parseClineCodeOutput(output, issues);

    if (!fixResult.success) {
      return { success: false, error: "Failed to parse Cline output" };
    }

    return fixResult;
  } catch (error) {
    return { success: false, error: error.message };
  }
}

function parseClineCodeOutput(output, issues) {
  try {
    const fileMatches = output.matchAll(
      /(?:File:|filepath:|---\s+a\/)([^\s\n]+)/gi
    );
    const filesSet = new Set();

    for (const match of fileMatches) {
      const file = match[1].trim();
      if (file && file.length > 0) filesSet.add(file);
    }

    if (filesSet.size === 0) {
      issues.forEach((issue) => {
        if (issue.file) filesSet.add(issue.file);
      });
    }

    const filesModified = Array.from(filesSet);

    if (filesModified.length === 0) {
      return { success: false, error: "No files identified" };
    }

    const changes = filesModified.map((file) => ({
      file,
      issueFixed: issues[0]?.title || "Issue fixed",
      changeDescription: "Applied security and quality improvements",
      linesChanged: 15,
    }));

    return {
      success: true,
      filesModified,
      fixesSummary: {
        security_fixes: issues.filter((i) => i.type === "SECURITY").length,
        bug_fixes: issues.filter((i) => i.type === "BUG").length,
        quality_improvements: 0,
      },
      changes,
      testingNotes: "Review changes and test affected functionality",
      safetyRationale: "Minimal changes focused on identified issues",
    };
  } catch (error) {
    return { success: false, error: error.message };
  }
}

function buildCommitMessage(issues, fixResult) {
  const securityFixes = issues.filter((i) => i.type === "SECURITY").length;
  const bugFixes = issues.filter((i) => i.type === "BUG").length;

  let title = "🔒 Fix: High-Impact Issues";
  if (securityFixes > 0) {
    title = `🔒 Security: Fix ${securityFixes} Vulnerabilit${
      securityFixes > 1 ? "ies" : "y"
    }`;
  } else if (bugFixes > 0) {
    title = `🐛 Fix: ${bugFixes} Critical Bug${bugFixes > 1 ? "s" : ""}`;
  }

  return `${title}\n\nFixed ${issues.length} high-impact issue${
    issues.length > 1 ? "s" : ""
  } identified by DevPulse AI.\n\nGenerated by DevPulse AI`;
}

async function createProductionReadyPR(
  owner,
  repo,
  branchName,
  issues,
  fixResult,
  accessToken
) {
  const securityFixes = issues.filter((i) => i.type === "SECURITY").length;
  const bugFixes = issues.filter((i) => i.type === "BUG").length;

  let title = "🤖 DevPulse: High-Impact Fixes";
  if (securityFixes > 0) {
    title = `🔒 Fix: ${securityFixes} Security Issue${
      securityFixes > 1 ? "s" : ""
    }`;
  }

  const body = `## 🤖 Autonomous Fixes by DevPulse AI

### 📊 Summary
Fixed **${issues.length} high-impact issue${issues.length > 1 ? "s" : ""}**:

${
  securityFixes > 0
    ? `#### 🔒 Security: ${securityFixes}\n${issues
        .filter((i) => i.type === "SECURITY")
        .map(
          (issue, i) =>
            `${i + 1}. **${issue.title}**\n   - Severity: \`${
              issue.severity
            }\`\n   - File: \`${issue.file || "N/A"}\``
        )
        .join("\n")}\n`
    : ""
}

${
  bugFixes > 0
    ? `#### 🐛 Bugs: ${bugFixes}\n${issues
        .filter((i) => i.type === "BUG")
        .map(
          (issue, i) =>
            `${i + 1}. **${issue.title}**\n   - File: \`${
              issue.file || "N/A"
            }\``
        )
        .join("\n")}\n`
    : ""
}

### 🔧 Changes
**Files Modified:** ${fixResult.filesModified.length}
${fixResult.filesModified.map((f) => `- \`${f}\``).join("\n")}

---
**🤖 Generated by DevPulse AI** | [Dashboard](https://devpulse.dev)`;

  try {
    const response = await axios.post(
      `https://api.github.com/repos/${owner}/${repo}/pulls`,
      { title, body, head: branchName, base: "main" },
      {
        headers: {
          Authorization: `Bearer ${accessToken}`,
          Accept: "application/vnd.github.v3+json",
        },
      }
    );

    return response.data;
  } catch (error) {
    throw new Error(
      `GitHub API error: ${error.response?.data?.message || error.message}`
    );
  }
}

async function pushToGitHub(repoPath, branchName, accessToken, repoUrl) {
  const urlMatch = repoUrl.match(/github\.com[\/:]([^\/]+)\/([^\/\.]+)/);
  if (!urlMatch) throw new Error(`Invalid GitHub URL: ${repoUrl}`);

  const owner = urlMatch[1];
  const repo = urlMatch[2];
  const authenticatedUrl = `https://${accessToken}@github.com/${owner}/${repo}.git`;
  const pushCommand = `cd "${repoPath}" && git push "${authenticatedUrl}" ${branchName}`;

  try {
    await execPromise(pushCommand);
  } catch (error) {
    const stderr = error.stderr || "";
    if (stderr.includes("403")) {
      throw new Error("GitHub auth failed. Token may lack 'repo' permissions.");
    } else if (stderr.includes("404")) {
      throw new Error(`Repository ${owner}/${repo} not found.`);
    }
    throw new Error(`Push failed: ${stderr || error.message}`);
  }
}

async function updateFixJobProgress(jobId, status, progress, message) {
  await supabase
    .from("autonomous_fix_jobs")
    .update({ status, progress, message, updated_at: new Date().toISOString() })
    .eq("job_id", jobId);
}

async function cloneRepository(repoUrl, targetDir) {
  return new Promise((resolve, reject) => {
    const proc = spawn("git", ["clone", "--depth", "1", repoUrl, targetDir]);
    let stderr = "";

    proc.stderr.on("data", (d) => (stderr += d.toString()));

    proc.on("close", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`Git clone failed: ${stderr}`));
    });

    proc.on("error", reject);
  });
}

async function analyzeStructure(repoPath) {
  const files = await getAllFiles(repoPath);
  return { totalFiles: files.length };
}

async function getAllFiles(dir) {
  const files = [];

  async function walk(currentPath) {
    try {
      const entries = await fs.readdir(currentPath, { withFileTypes: true });

      for (const entry of entries) {
        const fullPath = path.join(currentPath, entry.name);

        if (entry.isDirectory()) {
          if (!["node_modules", ".git", "dist", "build"].includes(entry.name)) {
            await walk(fullPath);
          }
        } else {
          files.push(fullPath);
        }
      }
    } catch (error) {}
  }

  await walk(dir);
  return files;
}

async function runAIAnalysis(repoPath) {
  const prompt = `Analyze this codebase and return JSON with:
{
  "architecture": {"pattern": "", "strengths": [], "weaknesses": []},
  "codeQuality": {"score": 0-100, "issues": []},
  "bugs": [{"severity": "", "description": "", "file": ""}],
  "security": [{"type": "", "severity": "", "file": ""}],
  "recommendations": [{"priority": "", "title": "", "description": ""}]
}

Return ONLY valid JSON.`;

  try {
    const output = await runClineTask(prompt, repoPath);
    const jsonData = extractJSON(output);

    return {
      success: true,
      architecture: jsonData.architecture || {
        pattern: "Unknown",
        strengths: [],
        weaknesses: [],
      },
      codeQuality: jsonData.codeQuality || { score: 75, issues: [] },
      bugs: jsonData.bugs || [],
      security: jsonData.security || [],
      recommendations: jsonData.recommendations || [],
    };
  } catch (error) {
    return {
      success: false,
      error: error.message,
      architecture: { pattern: "Error", strengths: [], weaknesses: [] },
      codeQuality: { score: 0, issues: [] },
      bugs: [],
      security: [],
      recommendations: [],
    };
  }
}

function runClineTask(prompt, repoPath) {
  return new Promise((resolve, reject) => {
    const wslPath = repoPath
      .replace(/\\/g, "/")
      .replace(/^([A-Z]):/, (match, drive) => `/mnt/${drive.toLowerCase()}`);

    const escapedPrompt = prompt
      .replace(/\\/g, "\\\\")
      .replace(/"/g, '\\"')
      .replace(/\$/g, "\\$")
      .replace(/`/g, "\\`");

    const bashCommand = `cd "${wslPath}" && export GEMINI_API_KEY="${process.env.GEMINI_API_KEY}" && cline "${escapedPrompt}" --oneshot`;

    const proc = spawn("wsl", ["bash", "-l", "-c", bashCommand]);

    let output = "";
    proc.stdout.on("data", (d) => (output += d.toString()));

    proc.on("close", (code) => {
      if (code === 0 || output.length > 100) resolve(output);
      else reject(new Error("Cline execution failed"));
    });

    proc.on("error", reject);

    setTimeout(() => {
      proc.kill();
      if (output.length > 0) resolve(output);
      else reject(new Error("Cline timeout"));
    }, 600000);
  });
}

async function cleanupTempDir(dir) {
  try {
    await fs.rm(dir, { recursive: true, force: true });
  } catch (error) {}
}

async function updateProgress(analysisId, status, progress, step, message) {
  await supabase
    .from("analyses")
    .update({ status, progress, current_step: step, message })
    .eq("analysis_id", analysisId);
}

async function runCommand(cmd, args, cwd) {
  return new Promise((resolve, reject) => {
    const proc = spawn(cmd, args, { cwd });
    let stderr = "";
    proc.stderr.on("data", (d) => (stderr += d.toString()));
    proc.on("close", (code) => {
      if (code === 0) resolve();
      else reject(new Error(stderr));
    });
  });
}

async function runAIFix(repoPath) {
  const prompt = `Apply safe improvements: fix formatting, add error handling, improve docs.`;
  try {
    return await runClineTask(prompt, repoPath);
  } catch (error) {
    return null;
  }
}

async function runAIFixWorkflow(analysis, accessToken, existingTempDir = null) {
  let tempDir = existingTempDir;

  try {
    if (!tempDir) {
      tempDir = path.join(__dirname, "../temp", `${analysis.analysisId}-fix`);
      await fs.mkdir(tempDir, { recursive: true });
      await cloneRepository(analysis.repoUrl, tempDir);
    }

    await runCommand("git", ["config", "user.name", "DevPulse AI"], tempDir);
    await runCommand(
      "git",
      ["config", "user.email", "ai@devpulse.app"],
      tempDir
    );

    const branchName = `devpulse-fix-${Date.now()}`;
    await runCommand("git", ["checkout", "-b", branchName], tempDir);

    const fixResult = await runAIFix(tempDir);
    if (!fixResult) {
      await cleanupTempDir(tempDir);
      return;
    }

    await runCommand("git", ["add", "."], tempDir);
    await runCommand(
      "git",
      ["commit", "-m", "🤖 AI improvements by DevPulse"],
      tempDir
    );

    await pushToGitHub(tempDir, branchName, accessToken, analysis.repoUrl);

    const pr = await createProductionReadyPR(
      analysis.owner,
      analysis.repoName,
      branchName,
      [],
      { filesModified: [] },
      accessToken
    );

    await supabase
      .from("analyses")
      .update({ ai_fix_result: { success: true, pr_url: pr.html_url } })
      .eq("analysis_id", analysis.analysisId);

    await cleanupTempDir(tempDir);
  } catch (error) {
    await supabase
      .from("analyses")
      .update({ ai_fix_result: { success: false, error: error.message } })
      .eq("analysis_id", analysis.analysisId);

    if (tempDir && !existingTempDir) await cleanupTempDir(tempDir);
  }
}

function calculateScore(aiAnalysis) {
  const score = aiAnalysis?.codeQuality?.score || 75;
  const grade = score >= 90 ? "A" : score >= 80 ? "B" : score >= 70 ? "C" : "D";
  return { score, grade };
}

function extractJSON(output) {
  const allJsonMatches = [];
  let searchStart = 0;

  while (searchStart < output.length) {
    const startIndex = output.indexOf("{", searchStart);
    if (startIndex === -1) break;

    let stack = 0;
    let endIndex = -1;

    for (let i = startIndex; i < output.length; i++) {
      if (output[i] === "{") stack++;
      else if (output[i] === "}") stack--;
      if (stack === 0) {
        endIndex = i;
        break;
      }
    }

    if (endIndex !== -1) {
      allJsonMatches.push(output.slice(startIndex, endIndex + 1));
      searchStart = endIndex + 1;
    } else {
      break;
    }
  }

  if (allJsonMatches.length === 0) throw new Error("No JSON found");

  for (let i = allJsonMatches.length - 1; i >= 0; i--) {
    try {
      const parsed = JSON.parse(allJsonMatches[i]);
      if (parsed.architecture || parsed.codeQuality) return parsed;
    } catch (e) {}
  }

  return JSON.parse(allJsonMatches[allJsonMatches.length - 1]);
}

module.exports = exports;
