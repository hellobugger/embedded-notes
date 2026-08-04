# 队列与信号量

> FreeRTOS 任务间通信的选用与避坑。

## 怎么选

| 场景 | 用什么 |
|------|--------|
| 传数据（字节、结构体） | **队列** `xQueueSend` |
| 只做同步/通知，不带数据 | **二值信号量** / **任务通知** |
| 保护共享资源（如 SPI） | **互斥量** `xSemaphoreCreateMutex` |
| 计数（缓冲区空位等） | **计数信号量** |

## 队列使用要点

```c
QueueHandle_t q = xQueueCreate(16, sizeof(uint8_t));  // 16 个元素，每个 1 字节
xQueueSend(q, &byte, 0);                              // 阻塞时间 0 = 不等待
xQueueReceive(q, &byte, portMAX_DELAY);               // 永远等待
```

!!! danger "禁止在中断里做的事"
    不要在 ISR 中使用阻塞版本 `xQueueSend`，必须用带 `FromISR` 的版本：
    ```c
    BaseType_t xHigherPriorityTaskWoken = pdFALSE;
    xQueueSendFromISR(q, &byte, &xHigherPriorityTaskWoken);
    portYIELD_FROM_ISR(xHigherPriorityTaskWoken);
    ```

## 互斥量与优先级反转

- 互斥量带**优先级继承**，二值信号量没有
- 低优先级任务持锁、高优先级任务等待时，若用二值信号量会反转；互斥量会自动抬升持锁者优先级

## 信号量示例

```c
SemaphoreHandle_t sem = xSemaphoreCreateBinary();
xSemaphoreGive(sem);                 // 任务中释放
xSemaphoreTake(sem, portMAX_DELAY);  // 等它被释放
```

## 待补充

- [ ] 队列传结构体时的拷贝开销
- [ ] 互斥量与递归互斥量
- [ ] 任务通知替代信号量（更省 RAM）
