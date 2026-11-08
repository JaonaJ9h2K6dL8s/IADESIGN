@echo off
set API_PROXY_TARGET=http://127.0.0.1:4176
..\node-v22.23.4-win-x64\node.exe node_modules\vite\bin\vite.js --host 127.0.0.1 --port 5175 --strictPort
