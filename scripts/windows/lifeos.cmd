@echo off
rem CLI shim: lifeos status | lifeos ops | lifeos call dashboard_get ...
rem Add this folder to PATH to use it from anywhere.
node "%~dp0..\..\agent\dist\lifeos-agent.mjs" %*
