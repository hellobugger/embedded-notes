# 标准库 / LL / HAL 对比

> 选库 = 在开发效率、代码体积、可控性之间做取舍。本文按实际项目里的取舍点对比，不背官方文档。

## 一、一句话认识三个库

| 库         | 全称                                           | 抽象层次                       | 现状                        |
| ---------- | ---------------------------------------------- | ------------------------------ | --------------------------- |
| **标准库** | STM32 Standard Peripheral Library（StdPeriph） | 寄存器封装，函数 + 结构体传参  | **已停止维护**，仅 F0~F4 有 |
| **LL 库**  | Low Layer Library                              | 更贴近寄存器，一函数一寄存器位 | 随 Cube 固件包持续更新      |
| **HAL 库** | Hardware Abstraction Layer                     | 面向对象，句柄 + 状态机        | 官方主推，全系列支持        |

!!! tip "一条时间线"
    标准库时代 → CubeMX 出现后推 HAL → 再补 LL 用于性能敏感场景。现在新工程默认 HAL，需要抠性能就混用 LL，标准库基本只剩老项目在维护。

## 二、以「点亮 LED」看三个库的写法

同一件事：GPIO 输出翻转。差异全在代码风格上。

```c
// ① 标准库：结构体配置 + 初始化
GPIO_InitTypeDef GPIO_InitStruct = {0};
GPIO_InitStruct.Pin   = GPIO_PIN_5;
GPIO_InitStruct.Mode  = GPIO_MODE_OUTPUT_PP;
GPIO_InitStruct.Speed = GPIO_Speed_50MHz;
GPIO_Init(GPIOA, &GPIO_InitStruct);       // 标准库的初始化：GPIO_Init

GPIO_SetBits(GPIOA, GPIO_Pin_5);          // 标准库的置位函数
GPIO_ResetBits(GPIOA, GPIO_Pin_5);
```

```c
// ② LL 库：一个宏搞定，无结构体、无状态
LL_AHB1_GRP1_EnableClock(LL_AHB1_GRP1_PERIPH_GPIOA);
LL_GPIO_SetPinMode(GPIOA, LL_GPIO_PIN_5, LL_GPIO_MODE_OUTPUT);
LL_GPIO_SetPinSpeed(GPIOA, LL_GPIO_PIN_5, LL_GPIO_SPEED_FREQ_LOW);
LL_GPIO_TogglePin(GPIOA, LL_GPIO_PIN_5);
```

```c
// ③ HAL 库：句柄 + 统一的 Init/接口
GPIO_InitTypeDef GPIO_InitStruct = {0};
GPIO_InitStruct.Pin   = GPIO_PIN_5;
GPIO_InitStruct.Mode  = GPIO_MODE_OUTPUT_PP;
GPIO_InitStruct.Speed = GPIO_SPEED_FREQ_LOW;
HAL_GPIO_Init(GPIOA, &GPIO_InitStruct);

HAL_GPIO_TogglePin(GPIOA, GPIO_PIN_5);
```

!!! warning "常见误区"
    网上大量「标准库例程」其实是 HAL 抄的：`HAL_GPIO_Init` 这种带 `HAL_` 前缀的就是 HAL，标准库同名函数是 `GPIO_Init`。认前缀最省事。

## 三、核心差异逐项对比

| 维度      | 标准库                 | LL 库                         | HAL 库                                   |
| --------- | ---------------------- | ----------------------------- | ---------------------------------------- |
| 适用系列  | F0~F4（老固件包）      | 全系列（Cube 固件包内）       | 全系列                                   |
| 维护状态  | 已停止更新             | 持续更新                      | 持续更新，官方主推                       |
| 代码风格  | 结构体 + Init 函数     | 直接调宏/函数改寄存器         | 句柄结构体 + 状态机                      |
| 代码体积  | 中                     | **最小**                      | 最大                                     |
| 运行速度  | 中                     | **最快**                      | 最慢（有超时轮询和错误检查）             |
| 初始化    | `GPIO_Init()` 传结构体 | `LL_GPIO_SetPinMode()` 逐项设 | `HAL_GPIO_Init()` 传结构体               |
| 中断处理  | 自己进 ISR 读标志      | 自己进 ISR 读标志             | 框架调回调，还分轮询/IT/DMA 三种         |
| DMA       | 手动拼                 | 手动拼，可预置 DMA 结构       | `HAL_UART_Receive_DMA()` 一条搞定        |
| 超时保护  | 无                     | 无                            | 内置 `timeout`，死等会返回 `HAL_TIMEOUT` |
| RTOS 适配 | 无特殊                 | 无特殊                        | 需替换 `HAL_Delay`/时间基准              |
| 学习成本  | 低                     | 中（要懂寄存器）              | 低（但理解状态机要时间）                 |

## 四、按场景选库

**选 HAL（默认）**
- 用 CubeMX 生成工程，追求开发速度
- 外设多、要走中断/DMA，`HAL_UART_Receive_IT()` 这种现成接口最省事
- 项目代码量不在第一位，可读性优先

**选 LL（性能敏感 / 资源紧张）**
- 时钟配置、快速 GPIO 翻转、低开销轮询
- RAM/Flash 紧张，HAL 的句柄和状态机太占地方
- 驱动 IC 时序要求严格，不想被 HAL 的检查逻辑拖慢

**混用 HAL + LL（实际项目最常见）**
- 主逻辑用 HAL，某个外设（比如时序苛刻的 SPI/GPIO）单独用 LL
- 两者可共存，HAL 和 LL 用的是同一份寄存器定义，不冲突

**标准库**
- 不推荐新项目。老项目要维护就接着用，新项目别开了
- 想迁移，优先迁到 HAL（两者都是结构体 Init 风格，最像）

!!! tip "关于 CubeMX 生成的代码"
    CubeMX 工程属性里可切换「HAL / LL」生成模式，LL 模式下也会生成对应的初始化代码。不要手动改生成区，会被重新生成覆盖。

## 五、避坑备忘

- **HAL 时间基准**：裸机默认用 SysTick，上 RTOS 必须替换成 RTOS 延时（如 `osDelay`），否则 `HAL_Delay` 死等会卡死低优先级任务。
- **HAL 句柄全局变量**：中断回调里要用句柄，所以 `huart` 等一般声明为全局。多个外设中断共用回调时，用 `h->Instance` 区分。
- **LL 没有状态机**：它只改寄存器，不会帮你管理「上次发到哪了」，DMA + 中断组合要自己拼。
- **标准库头文件命名**：`stm32f1xx.h`，LL/HAL 统一叫 `stm32h7xx_hal.h` / `stm32h7xx_ll_xxx.h`，认头文件也能快速判断工程用的是哪个库。
