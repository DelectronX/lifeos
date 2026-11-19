@echo off
rem Starts the LifeOS local agent server (MCP + REST + app bridge) in the background.
rem Listens on 127.0.0.1 only. Log: %LOCALAPPDATA%\LifeOS\agent.log
rem Extra arguments are passed through, e.g.  lifeos-agent-start.cmd --permission read
setlocal
set "ROOT=%~dp0..\.."
set "AGENT=%ROOT%\agent\dist\lifeos-agent.mjs"
where node >nul 2>nul || (echo Node.js was not found on PATH. Install it from https://nodejs.org & exit /b 1)
if not exist "%AGENT%" (
  echo Building the agent server...
  pushd "%ROOT%" && call npm run agent:build && popd
)
node "%AGENT%" start %*
if errorlevel 1 exit /b 1
echo.
echo Access token (paste it into LifeOS ^> Settings ^> Agents):
node "%AGENT%" token
endlocal
