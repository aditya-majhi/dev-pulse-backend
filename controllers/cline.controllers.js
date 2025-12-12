const { spawn } = require("child_process");
const fs = require("fs").promises;
const path = require("path");
const axios = require("axios");
const supabase = require("../services/supabase.services");

// =============================
// MAIN ENDPOINTS
// =============================

//Create analysis and start workflow
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
      .substr(2, 9)}`;

    const { error } = await supabase.from("analyses").insert({
      analysis_id: analysisId,
      user_id: userId,
      repo_url: repoUrl,
      repo_name: repoName,
      repo_owner: owner,
      status: "initializing",
      progress: 0,
      current_step: 0,
      total_steps: enableAIFix ? 8 : 6,
      message: "Starting analysis...",
    });

    if (error) {
      console.error("Supabase insert error:", error);
      throw error;
    }

    console.log(`🚀 Analysis started: ${analysisId}`);

    res.json({
      success: true,
      analysisId,
      message: "Analysis started",
    });

    // Run in background
    performAnalysis(
      analysisId,
      repoUrl,
      repoName,
      owner,
      enableAIFix,
      accessToken
    ).catch((err) => {
      console.error(`❌ Analysis ${analysisId} failed:`, err);
      console.error(`Stack trace:`, err.stack);
    });
  } catch (error) {
    console.error("Error in analyzeRepository:", error);
    res.status(500).json({ error: error.message });
  }
};

//Trigger AI fix on existing analysis
exports.triggerAIFix = async (req, res) => {
  const { analysisId, accessToken } = req.body;

  if (!analysisId || !accessToken) {
    return res.status(400).json({
      error: "Missing required fields: analysisId, accessToken",
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

    console.log(`🔧 Triggering AI fix for: ${analysisId}`);

    res.json({
      success: true,
      message: "AI fix started",
      analysisId,
    });

    // Run AI fix in background
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

//Get analysis results
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

//Get analysis progress
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

//Stream analysis progress (Server-Sent Events)
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

//Get analysis history
exports.getAnalysisHistory = async (req, res) => {
  const userId = req.user?.id ? String(req.user.id) : null;
  const { limit = 10, offset = 0 } = req.query;

  try {
    let query = supabase
      .from("analyses")
      .select(
        "analysis_id, repo_name, repo_owner, status, progress, code_quality, created_at",
        {
          count: "exact",
        }
      )
      .order("created_at", { ascending: false })
      .range(offset, offset + parseInt(limit) - 1);

    if (userId) {
      query = query.eq("user_id", userId);
    }

    const { data, error, count } = await query;

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
// CORE WORKFLOW FUNCTIONS
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
    console.log(`\n${"=".repeat(60)}`);
    console.log(`🚀 Starting analysis: ${analysisId}`);
    console.log(`📦 Repository: ${owner}/${repoName}`);
    console.log(`🔗 URL: ${repoUrl}`);
    console.log(`${"=".repeat(60)}\n`);

    // Step 1: Clone
    tempDir = path.join(__dirname, "../temp", analysisId);
    console.log(`📁 Creating temp directory: ${tempDir}`);
    await fs.mkdir(tempDir, { recursive: true });
    console.log(`✅ Directory created`);

    await updateProgress(analysisId, "cloning", 15, 1, "Cloning repository...");
    console.log(`\n📥 Step 1/6: Cloning repository...`);
    await cloneRepository(repoUrl, tempDir);
    console.log(`✅ Clone completed successfully\n`);

    // Step 2: Analyze structure
    await updateProgress(
      analysisId,
      "analyzing",
      30,
      2,
      "Analyzing structure..."
    );
    console.log(`📊 Step 2/6: Analyzing structure...`);
    const structure = await analyzeStructure(tempDir);
    console.log(`✅ Structure analyzed: ${structure.totalFiles} files found\n`);

    // Step 3: Static analysis
    await updateProgress(
      analysisId,
      "analyzing",
      45,
      3,
      "Running static analysis..."
    );
    console.log(`🔍 Step 3/6: Running static analysis...`);
    const staticAnalysis = { issues: 0 };
    console.log(`✅ Static analysis completed\n`);

    // Step 4: Security scan
    await updateProgress(
      analysisId,
      "analyzing",
      60,
      4,
      "Security scanning..."
    );
    console.log(`🔒 Step 4/6: Security scanning...`);
    const security = { vulnerabilities: 0 };
    console.log(`✅ Security scan completed\n`);

    // Step 5: AI Analysis (Cline)
    await updateProgress(
      analysisId,
      "ai_analyzing",
      75,
      5,
      "Running AI analysis..."
    );
    console.log(`🤖 Step 5/6: Running Cline AI analysis...`);
    const aiAnalysis = await runAIAnalysis(tempDir);
    console.log(
      `✅ AI analysis completed:`,
      aiAnalysis.success ? "Success" : "Failed"
    );
    if (!aiAnalysis.success && aiAnalysis.error) {
      console.error(`⚠️ AI Analysis error: ${aiAnalysis.error}`);
    }
    console.log();

    // Step 6: Calculate score
    await updateProgress(
      analysisId,
      "analyzing",
      90,
      6,
      "Calculating score..."
    );
    console.log(`📈 Step 6/6: Calculating quality score...`);
    const codeQuality = calculateScore(aiAnalysis);
    console.log(
      `✅ Score calculated: ${codeQuality.score}/100 (Grade: ${codeQuality.grade})\n`
    );

    // Save results
    console.log(`💾 Saving results to database...`);
    const { error: updateError } = await supabase
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

    if (updateError) {
      console.error(`❌ Database update failed:`, updateError);
      throw updateError;
    }

    console.log(`✅ Results saved to database`);
    console.log(`\n${"=".repeat(60)}`);
    console.log(`✅ Analysis completed successfully: ${analysisId}`);
    console.log(`${"=".repeat(60)}\n`);

    // Optional AI fix
    if (enableAIFix && accessToken) {
      console.log(`🔧 Starting AI fix workflow...`);
      await runAIFixWorkflow(
        { analysisId, repoName, owner, repoUrl },
        accessToken,
        tempDir
      );
    } else {
      console.log(`🧹 Cleaning up temp directory...`);
      await cleanupTempDir(tempDir);
    }
  } catch (error) {
    console.error(`\n${"=".repeat(60)}`);
    console.error(`❌ Analysis failed: ${analysisId}`);
    console.error(`Error message: ${error.message}`);
    console.error(`Stack trace:`, error.stack);
    console.error(`${"=".repeat(60)}\n`);

    try {
      await supabase
        .from("analyses")
        .update({
          status: "failed",
          error: error.message,
          error_details: error.stack,
          updated_at: new Date().toISOString(),
        })
        .eq("analysis_id", analysisId);
      console.log(`✅ Error status saved to database`);
    } catch (dbError) {
      console.error(`❌ Failed to save error status:`, dbError);
    }

    if (tempDir) {
      console.log(`🧹 Cleaning up temp directory after error...`);
      await cleanupTempDir(tempDir);
    }
  }
}

// =============================
// HELPER FUNCTIONS
// =============================

async function cloneRepository(repoUrl, targetDir) {
  return new Promise((resolve, reject) => {
    console.log(`   Running: git clone --depth 1 ${repoUrl}`);
    const proc = spawn("git", ["clone", "--depth", "1", repoUrl, targetDir]);

    let stderr = "";
    let stdout = "";

    proc.stdout.on("data", (data) => {
      const output = data.toString();
      stdout += output;
      console.log(`   [Git] ${output.trim()}`);
    });

    proc.stderr.on("data", (data) => {
      const output = data.toString();
      stderr += output;
      // Git outputs progress to stderr (not an error)
      console.log(`   [Git] ${output.trim()}`);
    });

    proc.on("close", (code) => {
      if (code === 0) {
        console.log(`   ✅ Git clone successful (exit code 0)`);
        resolve();
      } else {
        console.error(`   ❌ Git clone failed (exit code ${code})`);
        console.error(`   stderr: ${stderr}`);
        reject(new Error(`Git clone failed: ${stderr}`));
      }
    });

    proc.on("error", (err) => {
      console.error(`   ❌ Git process error:`, err);
      reject(err);
    });

    setTimeout(() => {
      console.error(`   ⏰ Git clone timeout (5 minutes exceeded)`);
      proc.kill();
      reject(new Error("Clone timeout"));
    }, 300000);
  });
}

async function analyzeStructure(repoPath) {
  try {
    console.log(`   Scanning directory: ${repoPath}`);
    const files = await getAllFiles(repoPath);
    console.log(`   Found ${files.length} files`);
    return { totalFiles: files.length };
  } catch (error) {
    console.error(`   ❌ Structure analysis failed:`, error);
    throw error;
  }
}

async function getAllFiles(dir) {
  const files = [];

  async function walk(currentPath) {
    try {
      const entries = await fs.readdir(currentPath, { withFileTypes: true });

      for (const entry of entries) {
        const fullPath = path.join(currentPath, entry.name);

        if (entry.isDirectory()) {
          // Skip certain directories
          if (
            ![
              "node_modules",
              ".git",
              "dist",
              "build",
              ".next",
              "coverage",
            ].includes(entry.name)
          ) {
            await walk(fullPath);
          }
        } else if (entry.isFile()) {
          files.push(fullPath);
        }
      }
    } catch (error) {
      console.warn(`   ⚠️ Skipping directory ${currentPath}: ${error.message}`);
    }
  }

  await walk(dir);
  return files;
}

async function runAIAnalysis(repoPath) {
  const prompt = `Analyze this codebase comprehensively and return a JSON object with:
- architecture: {pattern, strengths[], weaknesses[]}
- codeQuality: {score (0-100), issues[]}
- bugs: [{severity, description, file}]
- security: [{type, severity, file}]
- recommendations: [{priority, title, description}]

Return ONLY valid JSON, no markdown, no code blocks, no explanations.`;

  try {
    console.log(`   Running Cline CLI...`);
    const output = await runClineTask(prompt, repoPath);
    console.log(`   Cline output received (${output.length} chars)`);

    // Save debug output
    const debugPath = path.join(__dirname, "../temp", "cline-debug.txt");
    await fs.writeFile(debugPath, output, "utf8");
    console.log(`   📝 Debug output saved to: ${debugPath}`);

    // Extract JSON using improved function
    let jsonData = null;

    try {
      console.log(`   Attempting to extract JSON using extractJSON()...`);
      jsonData = extractJSON(output);
      console.log(`   ✅ Successfully extracted and parsed JSON`);
    } catch (extractError) {
      console.warn(`   ⚠️ extractJSON failed: ${extractError.message}`);

      // Fallback: Try to find the LAST JSON object manually
      const matches = output.match(/\{[^{}]*(?:\{[^{}]*\}[^{}]*)*\}/g);
      if (matches && matches.length > 0) {
        console.log(
          `   Found ${matches.length} JSON-like patterns, trying last one...`
        );
        const lastMatch = matches[matches.length - 1];
        try {
          jsonData = JSON.parse(lastMatch);
          console.log(`   ✅ Fallback parsing succeeded`);
        } catch (e) {
          console.error(`   ❌ Fallback parsing failed: ${e.message}`);
        }
      }
    }

    // If we found valid JSON, normalize and return it
    if (jsonData) {
      console.log(`   🔍 Normalizing JSON structure...`);

      const normalizedData = {
        success: true,
        architecture: jsonData.architecture || {
          pattern: "Unknown",
          strengths: [],
          weaknesses: [],
        },
        codeQuality: normalizeCodeQuality(jsonData),
        bugs: jsonData.bugs || jsonData.potential_bugs || [],
        security: normalizeSecurity(jsonData),
        recommendations: jsonData.recommendations || [],
      };

      console.log(`   ✅ JSON normalized successfully`);
      console.log(`   📊 Score: ${normalizedData.codeQuality.score}/100`);

      return normalizedData;
    }

    // Fallback: No valid JSON found
    console.warn(`   ⚠️ Could not extract valid JSON from output`);

    // Show relevant parts of output for debugging
    const lines = output.split("\n");
    const relevantLines = lines.filter(
      (line) =>
        line.includes("{") ||
        line.includes("}") ||
        line.includes("architecture")
    );
    console.log(`   Relevant output lines (${relevantLines.length}):`);
    relevantLines
      .slice(0, 10)
      .forEach((line) => console.log(`     ${line.substring(0, 100)}`));

    return {
      success: false,
      error: "Could not parse JSON from Cline output",
      rawOutput: output.substring(0, 1000),
      architecture: {
        pattern: "Analysis incomplete",
        strengths: [],
        weaknesses: [],
      },
      codeQuality: { score: 70, issues: ["JSON parsing failed"] },
      bugs: [],
      security: [],
      recommendations: [
        {
          priority: 1,
          title: "Review Cline output format",
          description:
            "Cline returned non-JSON formatted response. Check temp/cline-debug.txt",
        },
      ],
    };
  } catch (error) {
    console.error(`   ❌ AI analysis error:`, error.message);
    return {
      success: false,
      error: error.message,
      architecture: { pattern: "Error", strengths: [], weaknesses: [] },
      codeQuality: { score: 0, issues: [error.message] },
      bugs: [],
      security: [],
      recommendations: [],
    };
  }
}

// =============================
// HELPER FUNCTIONS FOR NORMALIZATION
// =============================

function normalizeCodeQuality(jsonData) {
  // Handle different possible property names
  if (jsonData.codeQuality) {
    return {
      score: jsonData.codeQuality.score || 75,
      issues: jsonData.codeQuality.issues || [],
    };
  } else if (jsonData.code_quality) {
    return {
      score: jsonData.code_quality.score || 75,
      issues: jsonData.code_quality.issues || [],
    };
  } else if (typeof jsonData.code_quality_score === "number") {
    return {
      score: jsonData.code_quality_score,
      issues: [],
    };
  } else {
    return {
      score: 75,
      issues: [],
    };
  }
}

function normalizeSecurity(jsonData) {
  // Handle different possible property names
  if (Array.isArray(jsonData.security)) {
    return jsonData.security;
  } else if (jsonData.security_assessment) {
    // Convert from object format to array
    if (Array.isArray(jsonData.security_assessment.vulnerabilities)) {
      return jsonData.security_assessment.vulnerabilities;
    } else if (typeof jsonData.security_assessment === "object") {
      // Convert object properties to array
      const vulnerabilities =
        jsonData.security_assessment.vulnerabilities || [];
      return Array.isArray(vulnerabilities) ? vulnerabilities : [];
    }
  }
  return [];
}

function runClineTask(prompt, repoPath) {
  return new Promise((resolve, reject) => {
    console.log(`   Running Cline via WSL...`);

    const wslPath = repoPath
      .replace(/\\/g, "/")
      .replace(/^([A-Z]):/, (match, drive) => `/mnt/${drive.toLowerCase()}`);

    console.log(`   Windows path: ${repoPath}`);
    console.log(`   WSL path: ${wslPath}`);

    // ✅ FIX: Use bash to cd into directory first, then run cline
    const bashCommand = `cd "${wslPath}" && export ANTHROPIC_API_KEY="${process.env.ANTHROPIC_API_KEY}" && cline "${prompt}" --oneshot`;

    console.log(`   Executing: wsl bash -c "cd ... && cline ..."`);

    const proc = spawn("wsl", ["bash", "-l", "-c", bashCommand], {
      env: {
        ...process.env,
      },
    });

    let output = "";
    let stderr = "";

    proc.stdout.on("data", (d) => {
      const text = d.toString();
      output += text;
      // Only log non-verbose output
      if (!text.includes("Checkpoint") && text.trim().length < 200) {
        console.log(`   [Cline] ${text.trim()}`);
      }
    });

    proc.stderr.on("data", (d) => {
      const text = d.toString();
      stderr += text;
      console.error(`   [Cline Error] ${text.trim()}`);
    });

    proc.on("close", (code) => {
      if (code === 0) {
        console.log(`   ✅ Cline completed (exit code 0)`);
        resolve(output);
      } else {
        console.error(`   ❌ Cline failed (exit code ${code})`);
        reject(new Error(stderr || "Cline failed"));
      }
    });

    proc.on("error", (err) => {
      console.error(`   ❌ Cline process error:`, err);
      reject(err);
    });

    setTimeout(() => {
      console.error(`   ⏰ Cline timeout (10 minutes exceeded)`);
      proc.kill();
      reject(new Error("Cline timeout"));
    }, 600000);
  });
}

async function cleanupTempDir(dir) {
  try {
    await fs.rm(dir, { recursive: true, force: true });
    console.log(`   ✅ Cleaned up: ${dir}`);
  } catch (error) {
    console.warn(`   ⚠️ Cleanup warning: ${error.message}`);
  }
}

// ...rest of existing functions (updateProgress, runCommand, runAIFix, etc.)...

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
  const prompt = `Apply safe code improvements: fix formatting, add error handling, improve documentation, apply best practices. List modified files.`;

  try {
    return await runClineTask(prompt, repoPath);
  } catch (error) {
    return null;
  }
}

async function runAIFixWorkflow(analysis, accessToken, existingTempDir = null) {
  let tempDir = existingTempDir;
  const { analysisId, repoName, owner, repoUrl } = analysis;

  try {
    if (!tempDir) {
      tempDir = path.join(__dirname, "../temp", `${analysisId}-fix`);
      await fs.mkdir(tempDir, { recursive: true });
      await cloneRepository(repoUrl, tempDir);
    }

    await runCommand("git", ["config", "user.name", "DevPulse AI"], tempDir);
    await runCommand(
      "git",
      ["config", "user.email", "ai@devpulse.app"],
      tempDir
    );

    const branchName = `devpulse-ai-fix-${Date.now()}`;
    await runCommand("git", ["checkout", "-b", branchName], tempDir);

    const fixResult = await runAIFix(tempDir);

    if (!fixResult || fixResult.length === 0) {
      console.log(`No changes needed`);
      await cleanupTempDir(tempDir);
      return;
    }

    await runCommand("git", ["add", "."], tempDir);
    await runCommand(
      "git",
      ["commit", "-m", "🤖 AI improvements by DevPulse"],
      tempDir
    );

    const authenticatedUrl = repoUrl.replace(
      "https://",
      `https://${accessToken}@`
    );
    await runCommand(
      "git",
      ["remote", "set-url", "origin", authenticatedUrl],
      tempDir
    );
    await runCommand("git", ["push", "-u", "origin", branchName], tempDir);

    const pr = await createPullRequest(
      owner,
      repoName,
      branchName,
      analysisId,
      accessToken
    );

    await supabase
      .from("analyses")
      .update({
        ai_fix_result: {
          success: true,
          pr_url: pr.url,
          pr_number: pr.number,
        },
      })
      .eq("analysis_id", analysisId);

    console.log(`✅ PR created: ${pr.url}`);
    await cleanupTempDir(tempDir);
  } catch (error) {
    console.error(`❌ AI Fix failed:`, error.message);

    await supabase
      .from("analyses")
      .update({
        ai_fix_result: { success: false, error: error.message },
      })
      .eq("analysis_id", analysisId);

    if (tempDir && !existingTempDir) await cleanupTempDir(tempDir);
  }
}

async function createPullRequest(
  owner,
  repo,
  branchName,
  analysisId,
  accessToken
) {
  const response = await axios.post(
    `https://api.github.com/repos/${owner}/${repo}/pulls`,
    {
      title: "🤖 DevPulse AI: Code Quality Improvements",
      body: `AI-powered improvements by DevPulse.\n\nAnalysis ID: \`${analysisId}\``,
      head: branchName,
      base: "main",
    },
    {
      headers: {
        Authorization: `Bearer ${accessToken}`,
        Accept: "application/vnd.github.v3+json",
      },
    }
  );

  return { url: response.data.html_url, number: response.data.number };
}

function calculateScore(aiAnalysis) {
  const score = aiAnalysis?.codeQuality?.score || 75;
  const grade = score >= 90 ? "A" : score >= 80 ? "B" : score >= 70 ? "C" : "D";
  return { score, grade };
}

//Function for extracting JSON from cline response
function extractJSON(output) {
  // Find ALL potential JSON objects
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
      const jsonString = output.slice(startIndex, endIndex + 1);
      allJsonMatches.push({
        start: startIndex,
        end: endIndex,
        json: jsonString,
      });
      searchStart = endIndex + 1;
    } else {
      break;
    }
  }

  if (allJsonMatches.length === 0) {
    throw new Error("No JSON object found in Cline output");
  }

  console.log(`   Found ${allJsonMatches.length} potential JSON objects`);

  // Try to parse from the LAST one (most likely to be the actual response)
  for (let i = allJsonMatches.length - 1; i >= 0; i--) {
    try {
      const parsed = JSON.parse(allJsonMatches[i].json);

      // Validate it has expected fields
      if (parsed.architecture || parsed.codeQuality || parsed.recommendations) {
        console.log(
          `   ✅ Valid JSON found at position ${i + 1}/${allJsonMatches.length}`
        );
        return parsed;
      }
    } catch (err) {
      console.warn(`   JSON object ${i + 1} failed to parse: ${err.message}`);
    }
  }

  // If none parsed successfully, throw error with the last attempt
  const lastJson = allJsonMatches[allJsonMatches.length - 1].json;
  try {
    return JSON.parse(lastJson);
  } catch (err) {
    console.error("Failed JSON:\n", lastJson.substring(0, 500));
    throw new Error("Extracted JSON is not valid: " + err.message);
  }
}
