@echo off
set SCRIPT=%~dp0control_gui.py
where pythonw >nul 2>&1
if %errorlevel%==0 (
  start "Emoguessr Control" pythonw "%SCRIPT%"
) else (
  start "Emoguessr Control" py -3 "%SCRIPT%"
)
