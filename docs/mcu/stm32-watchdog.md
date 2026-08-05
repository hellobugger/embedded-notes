# 独立看门狗 IWDG 与窗口看门狗 WWDG

> 一句话：**IWDG 管「程序还活着吗」**，超时没喂就复位；**WWDG 管「程序是不是按规矩跑」**，喂早了、喂晚了都会复位，还带一个提前中断。同一颗 STM32 上两个看门狗都有，分工不同。

## 一、两者对比

| 对比项 | IWDG 独立看门狗 | WWDG 窗口看门狗 |
| ------ | --------------- | --------------- |
| 时钟来源 | **LSI** ~32 kHz，独立于系统时钟 | **PCLK1**（APB1），来自系统时钟 |
| 计数器 | 12 位减计数（0~4095） | 7 位减计数（0~127） |
| 喂狗窗口 | **无**，超时前任意时刻喂 | **有**，必须落在窗口区间内 |
| 喂太早 | 无影响 | **复位** |
| 喂太晚（超时） | 复位 | 复位 |
| 提前中断 | **无** | **有**，EWI 提前唤醒中断 |
| 典型超时范围 | 0.1 ms ~ 32 s（可调范围大） | 1~100 ms 级（很短） |
| 系统时钟挂了 | 照样计数，能复位 | 跟着停，**不复位** |
| 低功耗停止/待机 | 继续计数（若已使能） | 停止 |
| 作用 | 防「死机」的硬复位兜底 | 防「程序路径/时序错乱」 |

共同点：看门狗一旦开启，**除了复位系统无法关闭**（寄存器有写保护）。喂狗都发生在主循环里，喂狗本身也必须是「程序正常」的一部分。

## 二、WWDG 的「窗口」到底是什么

IWDG 的计数器一路往下减，复位前喂上就行。WWDG 的计数器也有下限，但多了一个**上限（窗口）**：

```
计数值   0x7F(127)         窗口上限(设0x50)        0x40(64)      0x00
  ▲          │                  │                     │             │
  └──── 喂太早→复位  └────── 窗口内可喂 ──────┘  喂太晚→复位      │
                                              (0x40 触发 EWI 中断)
```

- 计数器从初值（如 0x7F）往下减，**窗口上限**写进 `CFR` 寄存器；
- 计数值 **大于窗口上限** 时喂狗 → 复位（程序跑太快/路径不对）；
- 计数值 **在窗口上限 ~ 0x40 之间** 喂狗 → 正常；
- 计数值 **小于 0x40** → 马上要复位了（这时喂也来不及），复位前会触发 **EWI 中断**，这是最后一次抢救机会。

所以 WWDG 校验的不只是「程序活着」，而是「程序执行速度正常、走到了该喂狗的位置」。

## 三、什么时候用哪个

**选 IWDG（默认、裸机最常见）**
- 只要防止死循环、HardFault、跑飞导致的死机，短超时兜底复位
- 超时范围宽（秒级），主循环里随便找地方喂，不挑时序

**选 WWDG（时序敏感 / 安全关键场景）**
- 希望「一段代码必须在规定时间内执行完」，比如电机控制、通信协议主循环
- 用 EWI 中断在复位前保存参数、记录现场、关闭外设
- 高可靠性系统会把两个都开：**WWDG 快速查时序异常（短超时 + 中断），IWDG 兜底**（即便系统时钟挂了也能复位）

!!! tip "实际工程里的取舍"
    裸机一个 IWDG 就能覆盖绝大多数防死机需求。WWDG 的窗口设太紧，正常运行时序一波动就误复位，调起来很烦——**窗口要留余量**，别卡着理论最小值。

## 四、CubeMX 配置方式

### IWDG

`System Core → IWDG`，勾选 **Activated**，只调两个参数：

| 参数 | 取值 | 说明 |
| ---- | ---- | ---- |
| IWDG prescaler | 4 / 8 / 16 / 32 / 64 / 128 / 256 | LSI 32 kHz 的分频系数 |
| IWDG reload value | 0~4095 | 计数初值，超时前喂狗 |

设完下方会实时显示算好的 **Timeout（ms）**，不用自己算。比如 Prescaler=64、Reload=625 → 超时 1250 ms。`.ioc` 里对应两行：

```ini
Iwdg.Prescaler = IWDG_PRESCALER_64
Iwdg.Reload = 625
```

!!! note "注意"
    F1/F4 的 IWDG 时钟固定接 LSI，CubeMX 里**不可选**，只能调预分频和重装载值。LSI 有温漂，CubeMX 按标称 32 kHz 算超时，实际有 ±10% 误差。（较新的 G0/G4/L4 等系列 IWDG 还多了窗口寄存器，F1/F4 没有。）

### WWDG

`System Core → WWDG`，勾选 **Activated**，参数三个：

| 参数 | 取值 | 说明 |
| ---- | ---- | ---- |
| WWDG prescaler | 1 / 2 / 4 / 8 | 对应 WDGTB |
| WWDG window value | 0x40~0x7F | 窗口上限，**必须小于 Counter** |
| WWDG free-running downcounter | 勾选 | 启用 7 位减计数器 |

CubeMX 会校验窗口约束 `0x40 ≤ Window < Counter`，填不合法直接报红。设 Window=0x50、Counter=0x7F 就是上文图解那种形态。下方的 **Timeout（ms）** 随 **PCLK1 频率** 实时计算——改 RCC 页面的 APB1 预分频，这里超时跟着变。

EWI 提前中断在 **NVIC Settings** 标签页勾选 `WWDG` 对应中断（F1 叫 WWDG global interrupt，F4 叫 WWDG interrupt），勾上后生成代码才带 `HAL_WWDG_EarlyWakeupCallback` 回调。

### 生成后的注意事项

- 生成的初始化代码在 `MX_IWDG_Init()` / `MX_WWDG_Init()`，喂狗代码要写在 `/* USER CODE BEGIN ... */` 保护区里，重新生成不会被覆盖。
- **CubeMX 不提供「调试时冻结看门狗」的开关**（DBGMCU 寄存器不暴露），需手动写。放在 `MX_*_Init` 之前，断点暂停时狗就不再咬人：

```c
/* F1：DBGMCU_CR 的位 8、位 9 */
DBGMCU->CR |= (uint32_t)DBGMCU_CR_DBG_IWDG_STOP
           |  (uint32_t)DBGMCU_CR_DBG_WWDG_STOP;

/* F4：DBGMCU_APB1_FZ 的位 8、位 11 */
DBGMCU->APB1FZ |= DBGMCU_APB1_FZ_DBG_IWDG_STOP
              |   DBGMCU_APB1_FZ_DBG_WWDG_STOP;
```

## 五、代码（HAL）

CubeMX 勾选外设后会自动生成初始化，用法都是「初始化 + 主循环喂狗」：

```c
/* ===== IWDG：初始化 + 喂狗 ===== */
IWDG_HandleTypeDef hiwdg;
hiwdg.Instance       = IWDG;
hiwdg.Prescaler      = IWDG_PRESCALER_64;   /* LSI 32kHz ÷64 → 2ms 一个计数 */
hiwdg.Reload         = 625;                 /* 625 × 2ms ≈ 1.25s 超时 */
HAL_IWDG_Init(&hiwdg);

/* 主循环任意位置喂狗 */
HAL_IWDG_Refresh(&hiwdg);   /* 内部其实是向 IWDG_KR 写 0xAAAA */
```

```c
/* ===== WWDG：初始化 + 喂狗 ===== */
WWDG_HandleTypeDef hwwdg;
hwwdg.Instance   = WWDG;
hwwdg.Prescaler  = WWDG_PRESCALER_8;   /* 分频越小，喂狗越赶 */
hwwdg.Window     = 0x50;               /* 窗口上限：计数值>0x50 喂 → 复位 */
hwwdg.Counter    = 0x7F;               /* 初值，同时启动计数 */
HAL_WWDG_Init(&hwwdg);

/* 必须在窗口内喂，喂狗时机要精确落在 0x50~0x40 之间 */
HAL_WWDG_Refresh(&hwwdg);
```

```c
/* ===== WWDG 提前中断（可选）：复位前最后一次机会 ===== */
void WWDG_IRQHandler(void) {
    HAL_WWDG_IRQHandler(&hwwdg);
}

void HAL_WWDG_EarlyWakeupCallback(WWDG_HandleTypeDef *hwwdg) {
    /* 保存关键参数 / 记录错误现场 / 关掉会留隐患的外设 */
    HAL_WWDG_Refresh(hwwdg);   /* 在中断里救一次，撑到主循环处理完 */
}
```

超时换算（WWDG 源自 PCLK1，系统时钟变了它也跟着变）：

```text
IWDG 超时 ≈ (1 / LSI) × 预分频 × 重装载值
           e.g. 32kHz、÷64、Reload=625 → 约 1.25s

WWDG 超时 ≈ 4096 × 2^WDGTB × (T[5:0]+1) / PCLK1
           e.g. PCLK1=36MHz、WDGTB=8 → 约 14.5ms（到 0x40 的时间）
```

!!! note "精确值以 CubeMX 为准"
    LSI 是 RC 振荡器，有温漂（±10% 量级），IWDG 超时只能当近似值；WWDG 超时则完全由 PCLK1 决定，改系统时钟后务必重新核对。具体参数 CubeMX 时钟配置页会直接算好，不用手算。

## 六、避坑备忘

- **别把 WWDG 当 IWDG 用**：在循环开头喂狗最容易「喂太早」误复位，WWDG 的喂狗点要放在「该段代码完成」之后。
- **断点停住会咬人**：调试时断点一停，狗还在数数。在 `DBGMCU` 里把 IWDG/WWDG 配置为调试暂停时冻结（CubeMX 默认会生成）。
- **IWDG 关不掉**：使能后只能靠复位关闭。想临时禁用调试，用上面的 DBGMCU 冻结而不是「关狗」。
- **上 RTOS 时喂狗位置**：放空闲任务或单独的监控任务，别放某个可能被高优先级任务饿死的低优先级任务里，否则主逻辑卡死时狗还在被喂。
- **低功耗唤醒**：IWDG 在停止/待机模式下继续计数，唤醒后可能立刻复位——长休眠前先算好剩余时间。

## 参考

- LSI/LSE 时钟源说明见 [stm32-clock-tree.md](stm32-clock-tree.md)
- 看门狗配置相关的复位/电源问题见 [stm32-notes.md](stm32-notes.md)
- 寄存器级细节：对应参考手册 RCC / IWDG / WWDG 章节
