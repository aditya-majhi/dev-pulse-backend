🚀 DevPulse – Setup & Run Guide

This document explains how to start the backend and frontend locally.

📦 Prerequisites

Make sure you have the following installed:

Node.js (v18 or above)

npm (comes with Node.js)

Git

Cline CLI (required for autonomous analysis)

🔧 Backend Setup
1️⃣ Navigate to backend folder
cd backend

2️⃣ Install dependencies
npm install

3️⃣ Environment variables

Create a .env file in the backend root.

PORT=5000

# Supabase
SUPABASE_URL=your_supabase_url
SUPABASE_ANON_KEY=your_supabase_anon_key

# GitHub (Personal Access Token)
GITHUB_PAT=your_github_personal_access_token

# Cline / LLM
OPENROUTER_API_KEY=your_openrouter_api_key


⚠️ Note:
For hackathon purposes, GitHub PAT is used instead of OAuth for reliability.

4️⃣ Start the backend server
npm run dev


or

npm start


Backend will run at:

http://localhost:5000

🎨 Frontend Setup
1️⃣ Navigate to frontend folder
cd frontend

2️⃣ Install dependencies
npm install

3️⃣ Environment variables

Create a .env file in the frontend root.

VITE_BACKEND_URL=http://localhost:5000

4️⃣ Start frontend
npm run dev


Frontend will run at:

http://localhost:5173

🔄 Application Flow

User connects GitHub using PAT

Selects a repository

Starts analysis

Cline CLI performs autonomous analysis

Results are stored in Supabase

User can:

View past analyses

Raise a Pull Request automatically

🧠 Autonomous Analysis (Cline CLI)

Make sure Cline is installed and configured:

cline config set api-key YOUR_OPENROUTER_API_KEY


Verify:

cline config list


Cline is used to:

Analyze repository health

Suggest improvements

Generate autonomous fixes

Create Pull Requests

🛠 Common Issues
❌ ENOENT: no such file or directory, mkdir '/var/task/temp'

If running on serverless platforms (like Vercel), file system writes are restricted.
Solution: Run backend locally or on a VM-based platform.

❌ GitHub PR creation fails

Ensure:

PAT has repo permission

Repository access is granted

✅ Recommended for Hackathon

Backend: Local / VM deployment

Frontend: Vercel

GitHub Auth: PAT

AI Agent: Cline CLI

📌 Notes

This project demonstrates real autonomous AI coding agents

Built specifically to extend Cline CLI capabilities

Focused on improving developer productivity
