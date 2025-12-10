const express = require("express");
const router = express.Router();
const authController = require("../controllers/auth.controllers.js");

//Oauth Routes
router.get("/github", authController.initiateGithubOAuth);
router.get("/github/callback", authController.githubCallback);

// Token management
router.post("/refresh", authController.refreshGitHubToken);
router.get("/validate", authController.checkTokenValidity);

// User routes
router.get("/user", authController.getCurrentUser);

module.exports = router;
