const express = require("express");
const router = express.Router();
const clineController = require("../controllers/cline.controllers");
const { verifyToken } = require("../middlewares/auth.middleware");

// Protected routes - require authentication
router.use(verifyToken);

// Start analysis
router.post("/analyze", clineController.analyzeRepository);

// Get full analysis results
router.get("/analysis/:analysisId", clineController.getAnalysis);

// Get progress (polling - simple JSON response)
router.get(
  "/analysis/:analysisId/progress",
  clineController.getAnalysisProgress
);

// Stream progress in real-time (SSE - Server-Sent Events)
router.get(
  "/analysis/:analysisId/stream",
  clineController.streamAnalysisProgress
);

// Get analysis history
router.get("/history", clineController.getAnalysisHistory);

//AI fix
router.post("/ai-fix", verifyToken, clineController.triggerAIFix);

module.exports = router;
