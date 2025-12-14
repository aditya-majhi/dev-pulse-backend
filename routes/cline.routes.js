const express = require("express");
const router = express.Router();
const clineController = require("../controllers/cline.controllers");
const { verifyToken } = require("../middlewares/auth.middleware");

router.use(verifyToken);

// Analysis endpoints
router.get("/all-analysis", clineController.getAllAnalyses);
router.post("/analyze", clineController.analyzeRepository);
router.get("/analysis/:analysisId", clineController.getAnalysis);
router.get(
  "/analysis/:analysisId/progress",
  clineController.getAnalysisProgress
);
router.get(
  "/analysis/:analysisId/stream",
  clineController.streamAnalysisProgress
);
router.get("/history", clineController.getAnalysisHistory);

// AI fix endpoints
router.post("/ai-fix", clineController.triggerAIFix);
router.post("/autonomous-fix", clineController.autonomousHighImpactFix);
router.get("/autonomous-fix/:jobId", clineController.getAutonomousFixStatus);

module.exports = router;
