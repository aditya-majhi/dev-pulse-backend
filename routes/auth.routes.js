const express = require("express");
const router = express.Router();
const authController = require("../controllers/auth.controllers.js");

router.get("/github", authController.initiateGithubOAuth);
router.get("/github/callback", authController.githubCallback);

module.exports = router;
