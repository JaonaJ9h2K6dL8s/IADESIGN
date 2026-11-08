@echo off
set BG_WORKFLOW_URL=http://127.0.0.1:4181
set BG_WORKFLOW_API=http://127.0.0.1:4181
..\node-v22.23.4-win-x64\node.exe tests\background-removal-real-photo-workflow.playwright.mjs
