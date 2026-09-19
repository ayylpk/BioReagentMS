# 解决 Maven 多模块依赖问题

## 问题描述
IDE 显示无法解析 common 和 pojo 模块中的类（如 JwtUtil、Result 等）。

## 原因
server 模块依赖 common 和 pojo 模块，但这些模块还没有被编译安装到本地 Maven 仓库。

## 解决方案

### 方法 1：使用批处理脚本（推荐）
1. 双击运行项目根目录下的 `build-install.bat` 文件
2. 等待编译完成
3. 在 IDEA 中刷新 Maven 项目

### 方法 2：手动执行 Maven 命令
在项目根目录打开终端，执行：
```bash
mvn clean install -DskipTests
```

### 方法 3：在 IDEA 中操作
1. 打开右侧 **Maven** 面板
2. 点击刷新按钮 🔄 **Reload All Maven Projects**
3. 等待 Maven 重新导入和索引完成

### 方法 4：清除缓存并重启
如果上述方法无效：
1. 菜单：**File → Invalidate Caches / Restart**
2. 选择 **Invalidate and Restart**
3. 等待 IDEA 重启并重新索引

## 验证是否成功
编译成功后，你应该能在本地 Maven 仓库中看到：
- `~/.m2/repository/com/sky/common/1.0-SNAPSHOT/`
- `~/.m2/repository/com/sky/pojo/1.0-SNAPSHOT/`
- `~/.m2/repository/com/sky/server/1.0-SNAPSHOT/`

## 项目模块依赖关系
```
server (主模块)
  ├── common (工具模块)
  └── pojo (数据对象模块)
```

## 保留的功能
目前项目只保留了登录功能：
- 员工登录：`POST /admin/employee/login`
- 员工退出：`POST /admin/employee/logout`
- 用户微信登录：`POST /user/user/login`
