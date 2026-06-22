@echo off
echo ========================================
echo 开始编译和安装 Maven 多模块项目
echo ========================================
echo.

cd /d "%~dp0"

echo 步骤 1: 清理之前的构建...
call mvn clean

echo.
echo 步骤 2: 编译并安装所有模块到本地仓库...
call mvn install -DskipTests

echo.
echo ========================================
echo 编译完成！
echo ========================================
echo.
echo 请在 IDEA 中执行以下操作：
echo 1. 打开右侧 Maven 面板
echo 2. 点击刷新按钮 (Reload All Maven Projects)
echo 3. 等待索引完成
echo.
pause
