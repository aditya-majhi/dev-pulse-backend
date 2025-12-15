const express = require("express");
const cors = require("cors");
const dotenv = require("dotenv");

dotenv.config();

//Routes imports
const authRoutes = require("./routes/auth.routes");
const githubRoutes = require("./routes/github.routes");
const clineRoutes = require("./routes/cline.routes");

const app = express();
const PORT = process.env.PORT || 5000;

// Middleware
app.use(
  cors({
    origin: true,
    credentials: true,
  })
);
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Routes
app.use("/api/v1/auth", authRoutes);
app.use("/api/v1/github", githubRoutes);
app.use("/api/v1/cline", clineRoutes);

// Start server
app.listen(PORT, () => {
  console.log(`DevPilot HQ server running on port ${PORT}`);
});

module.exports = app;
