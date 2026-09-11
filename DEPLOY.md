# 部署到 Render

本项目必须部署为 Web Service，不能部署成纯静态网站。Docker 会在 Linux 环境中编译 PentaZen，然后启动 Node.js 后端。

## 一、上传到 GitHub

建议创建私有仓库，避免在未确认授权范围前公开 PentaZen 源码。

在项目根目录执行：

```bash
git init
git add .
git commit -m "Prepare Gomoku website for deployment"
git branch -M main
git remote add origin 你的GitHub仓库地址
git push -u origin main
```

项目中的旧 macOS AI 文件 `PentaZen/PentaZen` 已被 `.gitignore` 排除。Render 会使用 `PentaZen/src` 中的源码编译 Linux 版本。

## 二、创建 Render 服务

1. 登录 <https://dashboard.render.com> 并连接 GitHub。
2. 选择 **New > Blueprint**。
3. 选择刚上传的仓库。
4. Render 会读取根目录的 `render.yaml`，创建名为 `gomoku-web` 的 Docker Web Service。
5. 确认使用 Free 方案，然后开始部署。
6. 构建日志依次出现 CMake 编译、`PentaZen 已连接` 后，即可打开 Render 提供的 `onrender.com` 地址。

如果不使用 Blueprint，也可以选择 **New > Web Service**，连接仓库并将 Runtime 设为 Docker；健康检查路径填写 `/health`。

## 三、更新网站

修改代码并验证后执行：

```bash
git add .
git commit -m "Update Gomoku website"
git push
```

Render 会在每次推送到默认分支后自动重新部署。

## 四、免费服务注意事项

- 长时间无人访问时，免费服务会休眠，第一次打开需要等待服务唤醒。
- 服务休眠、重启或重新部署时，内存中的棋局和比分会清空。
- 当前版本共用一个 PentaZen 进程，适合先让少量用户试玩；公开给大量用户前应增加 AI 队列或进程池。
