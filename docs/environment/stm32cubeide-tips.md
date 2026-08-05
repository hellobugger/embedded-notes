# STM32CubeIDE 使用技巧

> 配合[开发环境搭建](develop-environment.md)使用。CubeIDE 是 Eclipse 内核，快捷键与 Eclipse 一致。

## 日常快捷键

| 按键           | 作用           |
| -------------- | -------------- |
| Ctrl+B         | 编译工程       |
| Ctrl+F11       | 运行（Run）    |
| F11            | 调试（Debug）  |
| Ctrl+Space     | 代码补全       |
| Ctrl+Shift+F   | 格式化代码     |
| Ctrl+Shift+R   | 打开资源（文件） |

## 实用技巧

- **Live Expressions 实时看变量**：调试态 `Window → Show View → Live Expressions`，加变量名，断点不打断也能实时刷新值，看循环计数/传感器数据很方便。
- **外设寄存器视图**：调试态 `Window → Show View → SFRs / Registers`，直接看外设寄存器每一位，比读代码快。
- **改完 .ioc 记得生成代码**：双击 `.ioc` 改完点右上 **GENERATE CODE**，再回代码看新生成的初始化。
- **Ctrl+Shift+F 随手格式化**：提交到 git 前格式化，代码差异更干净。
- **增量编译**：一般只重编改过的文件；但改了 `.ioc` 或头文件会全量重编，属正常，别慌。
- **内存占用大**：CubeIDE 吃内存，卡就 `Window → Preferences` 关掉不用的插件/启动项。
