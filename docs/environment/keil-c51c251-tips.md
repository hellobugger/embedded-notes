# Keil C51 / C251 使用技巧

> 配合[开发环境搭建](develop-environment.md)使用。C51/C251 和 MDK 共用同一个 uVision，快捷键一致（F7 编译、F8 下载等），这里只讲 C51/C251 特有的坑和技巧。

## 实用技巧

- **生成 HEX 烧录文件**：`Options for Target → Output` 勾 **Create HEX File**，STC-ISP 烧录要的就是这个 `.hex`。
- **Memory Model 选对**：`Options for Target → Target` 的 `Memory Model`：
  - 变量少用 `Small`（默认，省内存）
  - 变量多 / 有大数组选 `Compact` 或 `Large`，否则报 DATA 段溢出
  - 这是 8051 特有的坑：RAM 只有 128/256 字节，随便一个数组就撑爆
- **报 `data space insufficient`**：就是 RAM 不够。把大数组加 `code` 关键字（放到 Flash）或调大 Memory Model。
- **STC 冷启动下载**：用 **STC-ISP** 烧录时，选好 COM 口和芯片型号 → 点「下载」→ **再给板上电**（STC 必须在掉电后上电瞬间进下载模式），看到进度条才成功。
- **软仿真看时序**：`Options for Target → Debug` 选 `Use Simulator`，没开发板也能纯软件单步，看寄存器/波形。
- **程序超 64KB**：老 8051 用 `Code Banking`（`Options for Target → Target`），新 STC 基本用不上，了解即可。

## 避坑补充

- **选错编译器**：STC32 用 C51 编译必挂，STC8/16/32 走 C251，经典 8051 走 C51（详见搭建文档）。
- **License**：C51/C251/MDK 各注册一份，共用 CID，只注册一个换芯片类型就报错（详见搭建文档）。
