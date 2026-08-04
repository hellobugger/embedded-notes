# 嵌入式工作笔记

> 软件/硬件调试心得与工作备忘，欢迎交流。

---

<div class="grid cards" markdown>

-   :fontawesome-solid-microchip: **MCU 与驱动**

    ---

    - [STM32 踩坑记录](mcu/stm32-notes.md)
    - [裸机外设驱动](mcu/peripheral-drivers.md)

-   :fontawesome-solid-microchip: **RTOS**

    ---

    - [FreeRTOS 任务调度](rtos/freertos-scheduler.md)
    - [队列与信号量](rtos/queue-semaphore.md)

-   :fontawesome-solid-bolt: **硬件调试**

    ---

    - [示波器使用技巧](hardware/scope-tips.md)
    - [电源纹波测试](hardware/power-ripple.md)

</div>

---

## 如何使用

- 本地预览：`mkdocs serve`，浏览器打开 http://127.0.0.1:8000
- 插入图片：放入 `docs/images/`，文中用相对路径引用

```markdown
![总线时序图](../images/spi-timing.png)
```

- 每页右上角有 **编辑** 按钮，可直达 GitHub 源文件修改

## 最近更新

- 2026-08-04 站点上线，首批笔记入库

<!-- 备注：更新站点后，把最新日期补到上面 -->
