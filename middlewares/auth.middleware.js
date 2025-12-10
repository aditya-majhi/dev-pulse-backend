const jwt = require("jsonwebtoken");
const JWT_SECRET = process.env.JWT_SECRET;

//Middlewares to verify JWT token
exports.verifyToken = async (req, res, next) => {
  try {
    const token = req.headers.authorization?.replace("Bearer ", "");

    if (!token) {
      return res.status(401).json({
        error: "No token provided",
        code: "NO_TOKEN",
      });
    }

    // Verify JWT
    const decoded = jwt.verify(token, JWT_SECRET);

    // Check if access token is expired
    const isAccessTokenExpired = Date.now() > decoded.accessTokenExpiresAt;

    if (isAccessTokenExpired) {
      // Try to refresh automatically
      console.log("⚠️ Access token expired, attempting auto-refresh...");

      try {
        // Refresh token
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
          throw new Error("Failed to refresh token");
        }

        // Update decoded with new token
        const now = Date.now();
        decoded.githubToken = access_token;
        decoded.refreshToken = refresh_token;
        decoded.accessTokenExpiresAt = now + expires_in * 1000;
        decoded.refreshTokenExpiresAt = now + refresh_token_expires_in * 1000;

        // Send new token in response header for client to update
        res.setHeader(
          "X-New-Token",
          jwt.sign(decoded, JWT_SECRET, { expiresIn: "7d" })
        );

        console.log("✅ Auto-refreshed token for:", decoded.username);
      } catch (refreshError) {
        return res.status(401).json({
          error: "Token expired and refresh failed. Please login again.",
          code: "TOKEN_REFRESH_FAILED",
          requiresReauth: true,
        });
      }
    }

    // Token is valid, proceed
    req.user = decoded;
    req.githubToken = decoded.githubToken;
    next();
  } catch (error) {
    if (error.name === "JsonWebTokenError") {
      return res.status(401).json({
        error: "Invalid token",
        code: "INVALID_TOKEN",
      });
    }

    if (error.name === "TokenExpiredError") {
      return res.status(401).json({
        error: "JWT expired. Please login again.",
        code: "JWT_EXPIRED",
        requiresReauth: true,
      });
    }

    res.status(500).json({
      error: "Token verification failed",
      details: error.message,
    });
  }
};
