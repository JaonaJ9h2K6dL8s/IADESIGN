@echo off
set DESIGN_STUDIO_DATA=C:\Users\BRAVOC~1\AppData\Local\Temp\iadesign-bg-workflow-clean
set PORT=4181
..\node-v22.23.4-win-x64\node.exe node_modules\tsx\dist\cli.mjs electron\server.ts
