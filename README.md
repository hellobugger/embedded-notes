# 嵌入式工作笔记

软件/硬件调试心得与工作备忘，使用 [MkDocs](https://www.mkdocs.org/) + [Material for MkDocs](https://squidfunk.github.io/mkdocs-material/) 搭建，部署在 GitHub Pages。

- **站点地址**：https://hellobugger.github.io/embedded-notes/
- **源码仓库**：https://github.com/hellobugger/embedded-notes

---

## 目录结构

```
embedded-notes/
├── mkdocs.yml              # 站点配置（主题、导航、插件）
├── hooks.py                # 自动生成首页分类卡片 + 导航
├── requirements.txt        # Python 依赖（pip install -r）
├── .github/workflows/      # GitHub Actions 自动部署
├── overrides/
│   └── main.html           # 首页 Hero 横幅（顶部渐变区）
├── docs/                   # 你的笔记（Markdown）
│   ├── index.md            # 首页
│   ├── environment/        # 开发环境搭建
│   ├── environment-tips/   # 各开发环境使用技巧
│   ├── mcu/                # MCU 与驱动
│   ├── rtos/               # RTOS
│   ├── hardware/           # 硬件调试
│   ├── images/             # 图片
│   ├── stylesheets/extra.css   # 自定义样式（首页/齿轮/背景）
│   └── javascripts/extra.js    # 鼠标特效 + 背景图设置
└── site/                   # 构建产物（自动生成，勿改）
```

---

## 新电脑配置（一次性）

### 1. 安装环境

| 软件 | 下载/命令 | 注意 |
|------|-----------|------|
| Python 3 | https://www.python.org/downloads/ | 安装时勾选 **Add Python to PATH** |
| Git | https://git-scm.com/download/win | 一路默认 |

### 2. 安装 MkDocs 与依赖

PowerShell 中执行：

```powershell
pip install -r requirements.txt
```

### 3. 克隆仓库

```powershell
cd $HOME
git clone https://github.com/hellobugger/embedded-notes.git
cd embedded-notes
```

### 4. 本地预览验证

```powershell
mkdocs serve
```

浏览器打开 http://127.0.0.1:8000 ，首页正常即可。

---

## 日常使用

```powershell
cd $HOME\embedded-notes
mkdocs serve            # 本地预览（可选，Ctrl+C 停止）
# …修改 / 新增 docs/ 下的 .md 文件…
git add .
git commit -m "这次改了什么"
git push                # 推送后 GitHub Actions 自动部署，网页约 1 分钟后更新
```

发布后约 1 分钟，刷新 https://hellobugger.github.io/embedded-notes/ 即可看到更新（建议 **Ctrl+Shift+R** 强制刷新，防止缓存）。

!!! tip "自动部署"
    仓库已配置 GitHub Actions，推送 `main` 后自动构建部署到 `gh-pages`，**无需再手动执行 `mkdocs gh-deploy`**。若只想手动更新网页（改分支、调试部署流程），仍可用 `mkdocs gh-deploy --force`。

---

## 写笔记指引

- **新增一篇笔记**：在 `docs/` 下对应分类文件夹里新建 `.md` 文件，然后在 `mkdocs.yml` 的 `nav:` 里登记标题和路径。
- **插图片**：图片放 `docs/images/`，文中用相对路径引用：

  ```markdown
  ![说明文字](../images/你的图片.png)
  ```

- **GitHub 直接编辑**：站点每页右上角有「编辑」按钮，可跳转 GitHub 在线改（改完自动进 main 分支，需重新 `mkdocs gh-deploy`）。

---

## 鼠标特效与背景图

页面右下角有**齿轮**按钮，可随时设置：

- **鼠标特效**：⭐ 星尘 / 🫧 泡泡 / ❄️ 雪花 / 关闭 + 密度调节
- **背景图**：启用后可选预设图，或粘贴任意网图链接，可调明显度

设置保存在**浏览器本地**（localStorage），换电脑/换浏览器需重新设置一次。所有资源纯本地 + CSS/JS，无外部依赖。

---

## 多台电脑协作提醒

- 同一时间尽量**只在一台电脑上改**，避免提交冲突。
- 换电脑前先 `git pull` 拉到最新，改完再 `git add` / `commit` / `gh-deploy`。
- 若 push 报 `non-fast-forward`（有冲突），先 `git pull` 再试；还不行就把报错截图发出来求助。

---

## 常见问题

**Q: `mkdocs` 不是内部命令？**
A: Python 安装时没勾选 "Add Python to PATH"，重装 Python 并勾上，然后重开 PowerShell。

**Q: 推送/部署时要求登录？**
A: 第一次推送用 HTTPS 需要 GitHub 登录。选择 "Sign in with your browser" 登录即可；若弹窗输密码，密码处填 Personal Access Token（Settings → Developer settings → Personal access tokens → 勾选 `repo`）。

**Q: 页面没变化？**
A: 可能是缓存。按 **Ctrl+Shift+R** 强制刷新。
