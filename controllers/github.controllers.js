const axios = require("axios");

const GITHUB_URL = "https://api.github.com";

// Get all user repositories
exports.getUserRepos = async (req, res) => {
  try {
    // githubToken is already in req from verifyToken middleware
    const { page = 1, per_page = 30, sort = "updated" } = req.query;

    console.log(`Fetching repos for: ${req.user.username}`);

    const response = await axios.get(
      `${GITHUB_URL}/user/repos?page=${page}&per_page=${per_page}&sort=${sort}`,
      {
        headers: {
          Authorization: `Bearer ${req.githubToken}`,
          Accept: "application/vnd.github.v3+json",
        },
      }
    );

    const repos = response.data.map((repo) => ({
      id: repo.id,
      name: repo.name,
      fullName: repo.full_name,
      description: repo.description,
      url: repo.html_url,
      cloneUrl: repo.clone_url,
      language: repo.language,
      stars: repo.stargazers_count,
      forks: repo.forks_count,
      openIssues: repo.open_issues_count,
      watchers: repo.watchers_count,
      size: repo.size,
      defaultBranch: repo.default_branch,
      private: repo.private,
      createdAt: repo.created_at,
      updatedAt: repo.updated_at,
      pushedAt: repo.pushed_at,
      owner: {
        login: repo.owner.login,
        avatar: repo.owner.avatar_url,
      },
    }));

    res.json({
      success: true,
      repos,
      total: repos.length,
      page: parseInt(page),
      per_page: parseInt(per_page),
    });
  } catch (error) {
    console.error("Error fetching repos:", error.message);
    res.status(500).json({
      error: "Failed to fetch repositories",
      details: error.response?.data?.message || error.message,
    });
  }
};

// Get recently changed repositories with activity details
exports.getRecentlyChanged = async (req, res) => {
  try {
    const { limit = 10 } = req.query;

    console.log(`🔄 Fetching recently changed repos for: ${req.user.username}`);

    // Get repos sorted by last push
    const reposResponse = await axios.get(
      `${GITHUB_URL}/user/repos?sort=pushed&per_page=${limit}`,
      {
        headers: {
          Authorization: `Bearer ${req.githubToken}`,
          Accept: "application/vnd.github.v3+json",
        },
      }
    );

    // Get recent activity for each repo
    const reposWithActivity = await Promise.all(
      reposResponse.data.map(async (repo) => {
        try {
          // Fetch recent commits
          const commitsResponse = await axios.get(
            `${GITHUB_URL}/repos/${repo.full_name}/commits?per_page=5`,
            {
              headers: {
                Authorization: `Bearer ${req.githubToken}`,
                Accept: "application/vnd.github.v3+json",
              },
            }
          );

          const recentCommits = commitsResponse.data.map((commit) => ({
            sha: commit.sha.substring(0, 7),
            message: commit.commit.message.split("\n")[0], // First line only
            author: commit.commit.author.name,
            date: commit.commit.author.date,
            url: commit.html_url,
          }));

          // Calculate days since last push
          const lastPushDate = new Date(repo.pushed_at);
          const now = new Date();
          const daysSinceLastPush = Math.floor(
            (now - lastPushDate) / (1000 * 60 * 60 * 24)
          );

          return {
            id: repo.id,
            name: repo.name,
            fullName: repo.full_name,
            description: repo.description,
            url: repo.html_url,
            language: repo.language,
            stars: repo.stargazers_count,
            forks: repo.forks_count,
            openIssues: repo.open_issues_count,
            private: repo.private,
            pushedAt: repo.pushed_at,
            updatedAt: repo.updated_at,
            daysSinceLastPush,
            recentCommits,
            owner: {
              login: repo.owner.login,
              avatar: repo.owner.avatar_url,
            },
          };
        } catch (error) {
          console.error(
            `Error fetching commits for ${repo.name}:`,
            error.message
          );
          // Return repo without commit details if commits fetch fails
          return {
            id: repo.id,
            name: repo.name,
            fullName: repo.full_name,
            description: repo.description,
            url: repo.html_url,
            language: repo.language,
            stars: repo.stargazers_count,
            forks: repo.forks_count,
            openIssues: repo.open_issues_count,
            private: repo.private,
            pushedAt: repo.pushed_at,
            updatedAt: repo.updated_at,
            recentCommits: [],
            owner: {
              login: repo.owner.login,
              avatar: repo.owner.avatar_url,
            },
          };
        }
      })
    );

    res.json({
      success: true,
      repos: reposWithActivity,
      total: reposWithActivity.length,
    });
  } catch (error) {
    console.error("Error fetching recently changed repos:", error.message);
    res.status(500).json({
      error: "Failed to fetch recently changed repositories",
      details: error.response?.data?.message || error.message,
    });
  }
};

// Get user's recent activity (events)
exports.getUserActivity = async (req, res) => {
  try {
    const { page = 1, per_page = 30 } = req.query;

    console.log(`📈 Fetching activity for: ${req.user.username}`);

    const response = await axios.get(
      `${GITHUB_URL}/users/${req.user.username}/events?page=${page}&per_page=${per_page}`,
      {
        headers: {
          Authorization: `Bearer ${req.githubToken}`,
          Accept: "application/vnd.github.v3+json",
        },
      }
    );

    const activities = response.data.map((event) => {
      let activityType = event.type;
      let description = "";
      let details = {};

      switch (event.type) {
        case "PushEvent":
          const commits = event.payload.commits?.length || 0;
          activityType = "Push";
          description = `Pushed ${commits} commit${commits > 1 ? "s" : ""} to ${
            event.repo.name
          }`;
          details = {
            commits:
              event.payload.commits?.map((c) => ({
                message: c.message,
                sha: c.sha.substring(0, 7),
              })) || [],
            ref: event.payload.ref,
          };
          break;

        case "CreateEvent":
          activityType = "Create";
          description = `Created ${event.payload.ref_type} ${
            event.payload.ref || ""
          } in ${event.repo.name}`;
          details = {
            refType: event.payload.ref_type,
            ref: event.payload.ref,
          };
          break;

        case "IssuesEvent":
          activityType = "Issue";
          description = `${event.payload.action} issue #${event.payload.issue?.number} in ${event.repo.name}`;
          details = {
            action: event.payload.action,
            issueNumber: event.payload.issue?.number,
            issueTitle: event.payload.issue?.title,
          };
          break;

        case "PullRequestEvent":
          activityType = "Pull Request";
          description = `${event.payload.action} PR #${event.payload.pull_request?.number} in ${event.repo.name}`;
          details = {
            action: event.payload.action,
            prNumber: event.payload.pull_request?.number,
            prTitle: event.payload.pull_request?.title,
          };
          break;

        case "WatchEvent":
          activityType = "Star";
          description = `Starred ${event.repo.name}`;
          break;

        case "ForkEvent":
          activityType = "Fork";
          description = `Forked ${event.repo.name}`;
          details = {
            forkee: event.payload.forkee?.full_name,
          };
          break;

        default:
          description = `${event.type} on ${event.repo.name}`;
      }

      return {
        id: event.id,
        type: activityType,
        description,
        details,
        repo: {
          name: event.repo.name,
          url: `https://github.com/${event.repo.name}`,
        },
        createdAt: event.created_at,
      };
    });

    res.json({
      success: true,
      activities,
      total: activities.length,
      page: parseInt(page),
      per_page: parseInt(per_page),
    });
  } catch (error) {
    console.error("Error fetching user activity:", error.message);
    res.status(500).json({
      error: "Failed to fetch user activity",
      details: error.response?.data?.message || error.message,
    });
  }
};

// Get single repository details
exports.getRepoDetails = async (req, res) => {
  try {
    const { owner, repo } = req.params;

    console.log(`🔍 Fetching details for: ${owner}/${repo}`);

    const headers = {
      Authorization: `Bearer ${req.githubToken}`,
      Accept: "application/vnd.github.v3+json",
    };

    const [repoData, issuesData, prsData, languagesData, contributorsData] =
      await Promise.all([
        axios.get(`${GITHUB_URL}/repos/${owner}/${repo}`, { headers }),
        axios.get(
          `${GITHUB_URL}/repos/${owner}/${repo}/issues?state=all&per_page=50`,
          { headers }
        ),
        axios.get(
          `${GITHUB_URL}/repos/${owner}/${repo}/pulls?state=all&per_page=50`,
          { headers }
        ),
        axios.get(`${GITHUB_URL}/repos/${owner}/${repo}/languages`, {
          headers,
        }),
        axios.get(
          `${GITHUB_URL}/repos/${owner}/${repo}/contributors?per_page=10`,
          { headers }
        ),
      ]);

    const repo_details = {
      id: repoData.data.id,
      name: repoData.data.name,
      fullName: repoData.data.full_name,
      description: repoData.data.description,
      url: repoData.data.html_url,
      cloneUrl: repoData.data.clone_url,
      stars: repoData.data.stargazers_count,
      forks: repoData.data.forks_count,
      watchers: repoData.data.watchers_count,
      openIssues: repoData.data.open_issues_count,
      language: repoData.data.language,
      languages: languagesData.data,
      defaultBranch: repoData.data.default_branch,
      private: repoData.data.private,
      createdAt: repoData.data.created_at,
      updatedAt: repoData.data.updated_at,
      pushedAt: repoData.data.pushed_at,
      size: repoData.data.size,
      license: repoData.data.license?.name,
      topics: repoData.data.topics,
      owner: {
        login: repoData.data.owner.login,
        avatar: repoData.data.owner.avatar_url,
      },
    };

    const issues = issuesData.data
      .filter((issue) => !issue.pull_request)
      .map((issue) => ({
        id: issue.id,
        number: issue.number,
        title: issue.title,
        state: issue.state,
        url: issue.html_url,
        createdAt: issue.created_at,
        updatedAt: issue.updated_at,
        labels: issue.labels.map((l) => l.name),
        user: issue.user.login,
      }));

    const pullRequests = prsData.data.map((pr) => ({
      id: pr.id,
      number: pr.number,
      title: pr.title,
      state: pr.state,
      url: pr.html_url,
      createdAt: pr.created_at,
      updatedAt: pr.updated_at,
      merged: pr.merged_at !== null,
      user: pr.user.login,
    }));

    const contributors = contributorsData.data.map((contributor) => ({
      login: contributor.login,
      avatar: contributor.avatar_url,
      contributions: contributor.contributions,
    }));

    res.json({
      success: true,
      repo: repo_details,
      issues,
      pullRequests,
      contributors,
      stats: {
        totalIssues: issues.length,
        openIssues: issues.filter((i) => i.state === "open").length,
        closedIssues: issues.filter((i) => i.state === "closed").length,
        totalPRs: pullRequests.length,
        openPRs: pullRequests.filter((pr) => pr.state === "open").length,
        mergedPRs: pullRequests.filter((pr) => pr.merged).length,
      },
    });
  } catch (error) {
    console.error("Error fetching repo details:", error.message);
    res.status(500).json({
      error: "Failed to fetch repository details",
      details: error.response?.data?.message || error.message,
    });
  }
};

// Search user's repositories
exports.searchRepos = async (req, res) => {
  try {
    const { query } = req.query;

    if (!query) {
      return res.status(400).json({ error: "Search query is required" });
    }

    const response = await axios.get(
      `${GITHUB_URL}/search/repositories?q=${query}+user:${req.user.username}`,
      {
        headers: {
          Authorization: `Bearer ${req.githubToken}`,
          Accept: "application/vnd.github.v3+json",
        },
      }
    );

    const repos = response.data.items.map((repo) => ({
      id: repo.id,
      name: repo.name,
      fullName: repo.full_name,
      description: repo.description,
      url: repo.html_url,
      language: repo.language,
      stars: repo.stargazers_count,
      forks: repo.forks_count,
    }));

    res.json({
      success: true,
      repos,
      total: repos.length,
    });
  } catch (error) {
    console.error("Error searching repos:", error.message);
    res.status(500).json({
      error: "Failed to search repositories",
      details: error.message,
    });
  }
};
