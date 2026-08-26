@echo off
rem DeepSeek Harness Desktop - 双击启动
cd /d "%~dp0"
call npm start
if errorlevel 1 (
  echo.
  echo 启动失败，请查看 app.log / server.err.log
  pause
)
