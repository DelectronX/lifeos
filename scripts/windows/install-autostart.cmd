@echo off
rem Optional: start the LifeOS agent server when you sign in to Windows.
rem Creates a shortcut in your Startup folder. Delete it (Win+R, shell:startup) to undo.
setlocal
set "TARGET=%~dp0lifeos-agent-start.cmd"
set "LINK=%APPDATA%\Microsoft\Windows\Start Menu\Programs\Startup\LifeOS agent.lnk"
powershell -NoProfile -Command "$s=(New-Object -ComObject WScript.Shell).CreateShortcut('%LINK%'); $s.TargetPath='%TARGET%'; $s.WindowStyle=7; $s.Save()"
echo Added: %LINK%
endlocal
