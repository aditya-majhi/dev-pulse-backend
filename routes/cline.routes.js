const express = require("express");
const router = express.Router();
const clineController = require("../controllers/cline.controllers");
const { verifyToken } = require("../middlewares/auth.middleware");

// Protected routes - require authentication
router.use(verifyToken);

// Analyze repository (when user selects from dashboard)
router.post("/analyze", clineController.analyzeRepository);

// Get analysis results
router.get("/analysis/:analysisId", clineController.getAnalysis);

// Stream analysis progress (SSE)
router.get(
  "/analysis/:analysisId/progress",
  clineController.streamAnalysisProgress
);

// Get analysis history
router.get("/history", clineController.getAnalysisHistory);

module.exports = router;
