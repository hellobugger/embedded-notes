# VSCode + PlatformIO 使用技巧

> 配合[开发环境搭建](../environment/develop-environment.md)使用。这里讲 ESP32 日常开发用得溜的操作。

## 日常快捷键

| 按键         | 作用                |
| ------------ | ------------------- |
| Ctrl+Alt+B   | 构建（Build）       |
| Ctrl+Alt+U   | 上传（Upload）      |
| Ctrl+Alt+S   | 串口监视器（Serial Monitor） |

## 实用技巧

- **状态栏蚂蚁图标一键操作**：Build / Upload / Serial Monitor 都在那，不用记命令。
- **PIO 终端直接敲 pio 命令**：PlatformIO 自带终端，`pio run`、`pio device monitor` 和图形按钮等价，做脚本/批处理时好用。
- **串口监视器乱码**：`platformio.ini` 的 `monitor_speed` 和代码里 `Serial.begin()` 波特率不一致就乱码，两处改成一样（如 115200）。
- **多环境（env）**：一个工程配多个 `[env:xxx]`（不同板子 / 不同 framework），构建时选对应 env，一套代码多板适配。
- **加库用 lib_deps**：`lib_deps = adafruit/Adafruit SSD1306`，保存后自动下载，比手动拷库进 `lib/` 干净、也好更新。
- **烧录失败逐个查**：COM 口选错 / USB 线只供电无数据 / 波特率太高，按顺序排查（详见搭建文档避坑）。
- **没梯子**：首次下载慢就关自动更新 + 换国内镜像源（详见搭建文档警告）。
