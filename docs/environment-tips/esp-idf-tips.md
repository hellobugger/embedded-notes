# VSCode + ESP-IDF 使用技巧

> 配合[开发环境搭建](../environment/develop-environment.md)使用。所有操作都在命令面板 `Ctrl+Shift+P` 里搜 `ESP-IDF:` 前缀。

## 常用命令

| 命令                            | 作用                    |
| ------------------------------- | ----------------------- |
| `ESP-IDF: Build Project`        | 编译                    |
| `ESP-IDF: Flash your project`   | 烧录                    |
| `ESP-IDF: Serial Monitor`       | 串口日志                |
| `ESP-IDF: SDK Configuration Editor` | 图形化配置（menuconfig） |
| `ESP-IDF: Doctor Command`       | 检查环境                |

## 实用技巧

- **增量编译只编 app**：改一个文件时构建目标选 **`app`**（或对应组件），比全量编译快一截。ESP-IDF 全量很慢、还会卡整台电脑（详见搭建文档警告）。
- **日志过滤**：Serial Monitor 里过滤日志级别（`ESP_LOGW`/`ESP_LOGE`），关掉 debug 级，刷屏时只看关键输出。
- **改 sdkconfig**：`SDK Configuration Editor` 改完保存会自动重编译，WiFi / Flash 分区 / 日志级别都在这。
- **换 IDF 版本**：装多个版本用 `ESP-IDF: Select Current ESP-IDF Version` 切换，不用重装。
- **监控和烧录冲突**：Serial Monitor 开着时烧录会失败，先停监控再 Flash。
- **idf.* 配置别乱改**：全英文设置，改路径类先读注释（详见搭建文档警告），改错很难查。
