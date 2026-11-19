@echo off
rem Stops the LifeOS local agent server (graceful shutdown, PID fallback).
node "%~dp0..\..\agent\dist\lifeos-agent.mjs" stop
