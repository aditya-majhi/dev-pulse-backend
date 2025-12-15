const axios = require("axios");
const jwt = require("jsonwebtoken");

const GITHUB_CLIENT_ID = process.env.GITHUB_CLIENT_ID;
const GITHUB_CLIENT_SECRET = process.env.GITHUB_CLIENT_SECRET;
// const FRONTEND_URL = process.env.FRONTEND_URL ||
const FRONTEND_URL = "http://localhost:5173";
const JWT_SECRET = process.env.JWT_SECRET;

const GITHUB_URL = "https://github.com";
const GITHUB_API_URL = "https://api.github.com";

exports.initiateGithubOAuth = (req, res) => {
  console.log("Initiating GitHub OAuth", GITHUB_CLIENT_ID);

  // Add 'repo' scope to access repositories
  const githubAuthUrl = `${GITHUB_URL}/login/oauth/authorize?client_id=${GITHUB_CLIENT_ID}&scope=read:user,repo`;
  res.redirect(githubAuthUrl);
};

exports.githubCallback = async (req, res) => {
  const { code } = req.query;

  console.log("GitHub callback received with code:", code);

  if (!code) {
    return res.redirect(`${FRONTEND_URL}/login?error=no_code`);
  }

  try {
    // Exchange code for tokens
    const tokenResponse = await axios.post(
      `${GITHUB_URL}/login/oauth/access_token`,
      {
        client_id: GITHUB_CLIENT_ID,
        client_secret: GITHUB_CLIENT_SECRET,
        code: code,
      },
      {
        headers: {
          Accept: "application/json",
        },
      }
    );

    console.log("Token response:", {
      hasAccessToken: !!tokenResponse.data.access_token,
      hasRefreshToken: !!tokenResponse.data.refresh_token,
      expiresIn: tokenResponse.data.expires_in,
    });

    const {
      access_token,
      refresh_token,
      expires_in,
      refresh_token_expires_in,
    } = tokenResponse.data;

    if (!access_token) {
      return res.redirect(`${FRONTEND_URL}/login?error=no_token`);
    }

    // Fetch user data from GitHub
    const userResponse = await axios.get(`${GITHUB_API_URL}/user`, {
      headers: {
        Authorization: `Bearer ${access_token}`,
      },
    });

    const userData = userResponse.data;

    // Calculate expiration timestamps
    const now = Date.now();
    const accessTokenExpiresAt = now + expires_in * 1000; // 8 hours from now
    const refreshTokenExpiresAt = now + refresh_token_expires_in * 1000; // 6 months from now

    // Create JWT token with user data, tokens, and expiration info
    const jwtToken = jwt.sign(
      {
        id: userData.id,
        username: userData.login,
        name: userData.name,
        avatar: userData.avatar_url,
        githubToken: access_token,
        refreshToken: refresh_token,
        tokenIssuedAt: now,
        accessTokenExpiresAt,
        refreshTokenExpiresAt,
      },
      JWT_SECRET,
      { expiresIn: "7d" } // JWT itself expires in 7 days
    );

    console.log("User authenticated:", userData.login);

    // Send JWT token to frontend
    res.redirect(`${FRONTEND_URL}/auth/success?token=${jwtToken}`);
  } catch (error) {
    console.error("GitHub OAuth Error:", error.response?.data || error.message);
    res.redirect(`${FRONTEND_URL}/login?error=oauth_failed`);
  }
};

// Refresh GitHub access token
exports.refreshGitHubToken = async (req, res) => {
  try {
    const token = req.headers.authorization?.replace("Bearer ", "");

    if (!token) {
      return res.status(401).json({ error: "No token provided" });
    }

    const decoded = jwt.verify(token, JWT_SECRET);

    // Check if refresh token is expired
    if (Date.now() > decoded.refreshTokenExpiresAt) {
      return res.status(401).json({
        error: "Refresh token expired. Please login again.",
        code: "REFRESH_TOKEN_EXPIRED",
        requiresReauth: true,
      });
    }

    console.log("🔄 Refreshing GitHub token for:", decoded.username);

    // Request new access token using refresh token
    const tokenResponse = await axios.post(
      `${GITHUB_URL}/login/oauth/access_token`,
      {
        client_id: GITHUB_CLIENT_ID,
        client_secret: GITHUB_CLIENT_SECRET,
        grant_type: "refresh_token",
        refresh_token: decoded.refreshToken,
      },
      {
        headers: {
          Accept: "application/json",
        },
      }
    );

    const {
      access_token,
      refresh_token,
      expires_in,
      refresh_token_expires_in,
    } = tokenResponse.data;

    if (!access_token) {
      return res.status(401).json({
        error: "Failed to refresh token",
        requiresReauth: true,
      });
    }

    // Calculate new expiration timestamps
    const now = Date.now();
    const accessTokenExpiresAt = now + expires_in * 1000;
    const refreshTokenExpiresAt = now + refresh_token_expires_in * 1000;

    // Create new JWT with refreshed tokens
    const newJwtToken = jwt.sign(
      {
        id: decoded.id,
        username: decoded.username,
        name: decoded.name,
        avatar: decoded.avatar,
        githubToken: access_token,
        refreshToken: refresh_token,
        tokenIssuedAt: now,
        accessTokenExpiresAt,
        refreshTokenExpiresAt,
      },
      JWT_SECRET,
      { expiresIn: "7d" }
    );

    console.log("Token refreshed successfully for:", decoded.username);

    res.json({
      success: true,
      token: newJwtToken,
      expiresIn: expires_in,
    });
  } catch (error) {
    console.error(
      "Token refresh error:",
      error.response?.data || error.message
    );

    if (error.name === "TokenExpiredError") {
      return res.status(401).json({
        error: "JWT expired. Please login again.",
        code: "JWT_EXPIRED",
        requiresReauth: true,
      });
    }

    res.status(500).json({
      error: "Failed to refresh token",
      details: error.message,
    });
  }
};

// Get current user
exports.getCurrentUser = async (req, res) => {
  try {
    const token = req.headers.authorization?.replace("Bearer ", "");

    if (!token) {
      return res.status(401).json({ error: "No token provided" });
    }

    const decoded = jwt.verify(token, JWT_SECRET);

    // Check if access token is about to expire (less than 30 minutes left)
    const timeUntilExpiry = decoded.accessTokenExpiresAt - Date.now();
    const shouldRefresh = timeUntilExpiry < 30 * 60 * 1000; // 30 minutes

    res.json({
      success: true,
      user: {
        id: decoded.id,
        username: decoded.username,
        name: decoded.name,
        avatar: decoded.avatar,
      },
      tokenInfo: {
        expiresAt: decoded.accessTokenExpiresAt,
        shouldRefresh,
        timeUntilExpiry: Math.floor(timeUntilExpiry / 1000), // in seconds
      },
    });
  } catch (error) {
    res.status(401).json({ error: "Invalid or expired token" });
  }
};

// Check token validity and expiration status
exports.checkTokenValidity = async (req, res) => {
  try {
    const token = req.headers.authorization?.replace("Bearer ", "");

    if (!token) {
      return res.status(401).json({
        valid: false,
        error: "No token provided",
      });
    }

    const decoded = jwt.verify(token, JWT_SECRET);

    const now = Date.now();
    const accessTokenExpired = now > decoded.accessTokenExpiresAt;
    const refreshTokenExpired = now > decoded.refreshTokenExpiresAt;
    const timeUntilAccessExpiry = decoded.accessTokenExpiresAt - now;
    const timeUntilRefreshExpiry = decoded.refreshTokenExpiresAt - now;

    res.json({
      valid: true,
      user: {
        id: decoded.id,
        username: decoded.username,
        name: decoded.name,
        avatar: decoded.avatar,
      },
      tokenStatus: {
        accessTokenExpired,
        refreshTokenExpired,
        accessTokenExpiresAt: new Date(
          decoded.accessTokenExpiresAt
        ).toISOString(),
        refreshTokenExpiresAt: new Date(
          decoded.refreshTokenExpiresAt
        ).toISOString(),
        timeUntilAccessExpiry: Math.floor(timeUntilAccessExpiry / 1000), // seconds
        timeUntilRefreshExpiry: Math.floor(timeUntilRefreshExpiry / 1000), // seconds
        shouldRefresh: timeUntilAccessExpiry < 30 * 60 * 1000, // Less than 30 min
      },
    });
  } catch (error) {
    if (error.name === "TokenExpiredError") {
      return res.status(401).json({
        valid: false,
        error: "JWT expired",
        code: "JWT_EXPIRED",
        requiresReauth: true,
      });
    }

    res.status(401).json({
      valid: false,
      error: "Invalid token",
    });
  }
};
