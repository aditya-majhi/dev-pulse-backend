const express = require("express");
const cors = require("cors");
const dotenv = require("dotenv");

dotenv.config();

const app = express();
const PORT = process.env.PORT || 5000;

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Routes

// Start server
app.listen(PORT, () => {
  console.log(`DevPilot HQ server running on port ${PORT}`);
});

module.exports = app;
