const express = require("express");
const router = express.Router();
const githubController = require("../controllers/github.controllers");
const { verifyToken } = require("../middlewares/auth.middleware");

// All GitHub routes require authentication
router.use(verifyToken);

// Get all user repositories
router.get("/repos", githubController.getUserRepos);

// Get recently changed repositories with activity
router.get("/repos/recent", githubController.getRecentlyChanged);

// Get user's recent activity
router.get("/activity", githubController.getUserActivity);

// Search repositories
router.get("/repos/search", githubController.searchRepos);

// Get specific repository details
router.get("/repos/:owner/:repo", githubController.getRepoDetails);

module.exports = router;
