# Keil5 + CubeMX 使用技巧

> 配合[开发环境搭建](develop-environment.md)使用。这里只讲用得溜的技巧，安装/建工程见搭建文档。

## 日常快捷键

| 按键   | 作用           |
| ------ | -------------- |
| F7     | 编译（Build）  |
| F8     | 下载（Load）   |
| F5     | 进入调试       |
| F10/F11| 单步跳过 / 单步进入 |
| F12    | 跳到定义处（右键也有 Go to Definition） |

## 实用技巧

- **双击编译报错直接跳行**：Build 窗口里的 error/warning，双击就跳到对应代码行，不用自己找。
- **逻辑分析仪看时序**：调试态 `View → Analysis Windows → Logic Analyzer`，右上角 Setup 加信号（如 `PORTA->ODR`），没有示波器也能看 GPIO/外设波形查时序问题。
- **Watch 窗口看变量**：调试态 `View → Watch Window`，右键变量 Add to Watch；外设寄存器在 `View → Registers Window` 直接看每一位。
- **代码模板**：`Edit → Configuration → Editor → Code Templates`，自定义 `for`、`HAL_xxx` 补全，重复代码少打一半。
- **生成 HEX 文件**：`Options for Target → Output` 勾 **Create HEX File**，生成的 `.hex` 可用串口/其他工具烧（配合下文 C51 节）。
- **中文注释乱码**：CubeMX 生成的是 UTF-8，Keil 里 `Edit → Configuration → Editor → Encoding` 选 **UTF-8**（详见搭建文档避坑）。

## CubeMX 侧

- **复用旧工程配置**：新项目想沿用之前的引脚/时钟，`File → Load Project` 打开旧 `.ioc` 另存再改，省去重新配一遍。
- **改了配置忘生成**：改完 `.ioc` 一定要点 **GENERATE CODE**，不然 Keil 那边不会生效。
- **Ctrl+F 搜索**：配置界面引脚/外设多时，`Ctrl+F` 直接搜引脚名或外设名，别翻树。
