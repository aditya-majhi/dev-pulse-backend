const axios = require("axios");

const GITHUB_CLIENT_ID = process.env.GITHUB_CLIENT_ID;
const GITHUB_CLIENT_SECRET = process.env.GITHUB_CLIENT_SECRET;
const FRONTEND_URL = process.env.FRONTEND_URL || "http://localhost:3000";

const GITHUB_URL = "https://github.com";

exports.initiateGithubOAuth = (req, res) => {
  console.log("inside controller", GITHUB_CLIENT_ID);

  const githubAuthUrl = `${GITHUB_URL}/login/oauth/authorize?client_id=${GITHUB_CLIENT_ID}&scope=user:email,read:user`;
  res.redirect(githubAuthUrl);
};

exports.githubCallback = async (req, res) => {
  const { code } = req.query;

  if (!code) {
    return res.redirect(`${FRONTEND_URL}/login?error=no_code`);
  }

  try {
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

    const accessToken = tokenResponse.data.access_token;

    if (!accessToken) {
      return res.redirect(`${FRONTEND_URL}/login?error=no_token`);
    }

    const userResponse = await axios.get("https://api.github.com/user", {
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
    });

    const userData = userResponse.data;

    let email = userData.email;
    if (!email) {
      const emailResponse = await axios.get(
        "https://api.github.com/user/emails",
        {
          headers: {
            Authorization: `Bearer ${accessToken}`,
          },
        }
      );
      const primaryEmail = emailResponse.data.find((e) => e.primary);
      email = primaryEmail ? primaryEmail.email : null;
    }

    const user = {
      id: userData.id,
      username: userData.login,
      email: email,
      name: userData.name,
      avatar: userData.avatar_url,
      githubToken: accessToken,
    };

    res.redirect(
      `${FRONTEND_URL}/auth/success?user=${encodeURIComponent(
        JSON.stringify(user)
      )}`
    );
  } catch (error) {
    console.error("GitHub OAuth Error:", error.response?.data || error.message);
    res.redirect(`${FRONTEND_URL}/login?error=oauth_failed`);
  }
};
