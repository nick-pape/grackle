@echo off
setlocal
REM Quickstart script for the Grackle orchestrator agent.
REM Usage: orchestrate.cmd [claude args...]
REM Example: orchestrate.cmd "burn down the items in the #282 UX epic, go one at a time"

if not defined GRACKLE_PORT set GRACKLE_PORT=7434
if not defined GRACKLE_MCP_PORT set GRACKLE_MCP_PORT=7435

REM Load API key from ~/.grackle/api-key if not already set
if "%GRACKLE_API_KEY%"=="" (
  if exist "%USERPROFILE%\.grackle\api-key" (
    set /p GRACKLE_API_KEY=<"%USERPROFILE%\.grackle\api-key"
  ) else (
    echo Warning: GRACKLE_API_KEY not set and %USERPROFILE%\.grackle\api-key not found.
    echo The grackle MCP server will not authenticate. Set GRACKLE_API_KEY or create the file.
  )
)

REM Check that the Grackle server is running
netstat -ano | findstr ":%GRACKLE_PORT%.*LISTENING" >nul 2>&1
if errorlevel 1 (
  echo Error: Grackle server not detected on port %GRACKLE_PORT%.
  echo Start it with: grackle serve
  exit /b 1
)

claude --agent orchestrate %*
