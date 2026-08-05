# RT-Thread Studio 使用技巧

> 配合[开发环境搭建](develop-environment.md)使用。Studio 是 Eclipse 内核，快捷键与 Eclipse 一致。

## 日常快捷键

| 按键           | 作用           |
| -------------- | -------------- |
| Ctrl+B         | 编译           |
| F11            | 调试           |
| Ctrl+Space     | 代码补全       |
| Ctrl+Shift+F   | 格式化         |
| Ctrl+H         | 全局搜索       |

## 实用技巧

- **FinSH 控制台（RTOS 神器）**：启用 Shell/FinSH 组件后，连上控制台串口能输命令交互——动态建线程、看内存、调函数，调试 RTOS 比 IDE 断点还方便。默认组件一般已带，看 `RT-Thread Settings` 里 Shell 勾没勾。
- **RT-Thread Settings 勾完必须重编**：勾选/取消组件后点同步保存，**必须重新编译**才生效，别疑惑怎么没变化。
- **软件包下载**：`RT-Thread Settings` 里搜软件包（LVGL、网络、传感器驱动等），勾上后 Studio 自动下载源码进工程，比手动移植省心。
- **看日志**：底部终端视图选控制台串口（默认 UART1），`rt_kprintf` 的输出都在那。
- **RTOS 下 HardFault 先查栈**：任务栈开太小是常见原因，`rt_thread` 创建时栈大小翻倍试试（详见 mcu 调试笔记）。
- **Eclipse 通用快捷键**：`Ctrl+Shift+R` 打开资源、`Ctrl+H` 全局搜索，找文件/函数比点树快。
