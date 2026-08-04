# FreeRTOS 任务调度

> 关于优先级、调度与常见误用的整理。

## 优先级分配经验

1. **中断优先级 ≠ 任务优先级**，两者独立配置
2. 高优先级任务不能长期霸占 CPU，否则低优先级任务饿死
3. 经验值：时间敏感任务（如采样）放高优先级，后台任务放低

```c
#define TASK_PRIO_SENSOR  (configMAX_PRIORITIES - 1)   // 高
#define TASK_PRIO_LED     (tskIDLE_PRIORITY + 1)       // 低
```

## 调度器工作原理

- 只支持**优先级抢占**（不轮转），同优先级任务需配合 `vTaskDelay` 主动让出
- `vTaskDelay(ms)` 会让出 CPU；忙等 `for` 循环不会
- 中断里调用 `portYIELD_FROM_ISR` 可唤醒等待的高优先级任务

```c
BaseType_t xHigherPriorityTaskWoken = pdFALSE;
xSemaphoreGiveFromISR(sem, &xHigherPriorityTaskWoken);
portYIELD_FROM_ISR(xHigherPriorityTaskWoken);
```

!!! warning "常见错误"
    在中断服务函数里调用 `vTaskDelay` / `osDelay` —— 会直接死机或行为未定义。

## 任务栈大小估算

- 默认栈以 **字** 为单位（4 字节），不是字节
- 打印日志（`printf`）任务栈建议 ≥ 256 字
- 遇到栈溢出：HardFault 或 `vApplicationStackOverflowHook` 触发，先把栈翻倍

## 待补充

- [ ] 空闲任务钩子用在哪
- [ ] 任务通知与队列的性能对比
- [ ] tick 频率与功耗的关系
