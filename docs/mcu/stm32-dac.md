# STM32 DAC：从配置到 DMA 的一篇讲透

> 一句话：**DAC 把数字变回模拟电压**，方向和 ADC 正好相反。要讲清楚的三件事——**用什么触发方式（哪个节拍去更新输出）**、**时间和缓冲怎么选（输出跟不跟得上、够不够稳）**、**数据怎么送进去（寄存器直写 / 定时器+DMA 出波形）**。本文以 F1/F4 的 12 位 DAC 为主，寄存器与配置以 HAL 为准，和 [stm32-adc.md](stm32-adc.md) 对照着看更清楚。

## 一、DAC 是什么、长什么样

DAC（Digital-to-Analog Converter）把数字代码转成模拟电压。F1/F4 上是 **12 位 R-2R 电阻网络 DAC**，结构跟 ADC 的 SAR 逐次逼近相反，但"12 位、0~VREF+"的量程约定完全对称：

- 分辨率 12 位 → 数字输入范围 0~4095
- 输出范围 0 ~ `VREF+`（通常 3.3V）
- **1 LSB ≈ VREF+ / 4096 ≈ 0.806 mV**
- 两路独立通道：**PA4 = DAC_OUT1，PA5 = DAC_OUT2**

内部数据通路（每个通道）：

```text
DHR(数据保持寄存器) ─触发同步→ DOR(输出寄存器) ─→ R-2R 电阻网络 ─→ 输出缓冲(可选) ─→ PA4/PA5
```

你写的是 DHR，真正决定引脚电压的是 DOR——**把 DHR 搬到 DOR 的动作就是"触发"**，这正是第四节的主题。

!!! warning "F103 先对型号再开干"
    只有**高密度** F103（RC/RE/ZC/ZE 等）才有 DAC；RB 及以下的 medium/low 密度型号没有 DAC 外设，PA4/PA5 只是普通 IO。买板子、抄代码前先确认型号。

## 二、DAC 的时间观：更新率、建立时间、输出缓冲

**DAC 没有 ADC 那种"采样时间"旋钮**——那是 ADC 的概念（采样电容充电要多久）。DAC 的时间问题变成另一组等价指标，直接决定"输出准不准、能跑多快"：

1. **更新延迟**：触发后 DHR→DOR 同步，约 1 个 APB1 时钟。这是数据通路延迟，不是你该操心的事。
2. **建立时间 tSETTLING**：从触发到模拟输出稳定到 ±0.5 LSB 的时间。硬件定死，**只取决于是否开输出缓冲**。这是 DAC 里和"采样时间"最对应的概念。
3. **最大更新率**：1 / 建立时间 的量级。数据手册标称开缓冲约 **1 MSPS**，但那是"小步连续更新"的极限；整幅摆（0→4095 大跳变）要等满一个建立时间才稳。

| 项 | F1（F103） | F4（F407） |
| -- | ---------- | ---------- |
| 通道数 | 2（PA4/PA5） | 2（PA4/PA5） |
| 分辨率 | 12 位 | 12 位 |
| 建立时间（开缓冲，典型） | 4 µs | 6 µs |
| 建立时间（关缓冲） | 明显更长（手册未标定值） | 明显更长（手册未标定值） |
| 波形发生器（噪声/三角波） | 有 | **没有** |
| DAC DMA 请求映射 | DMA2_Ch3 / DMA2_Ch4 | DMA1_Stream5_Ch7 / DMA1_Stream6_Ch7 |
| 触发源 | TIM2/4/6/7 + EXTI9 | TIM2/4/5/6/7/8 + EXTI9 |

!!! warning "以数据手册 DAC 电特性表为准"
    上表建立时间取自数据手册典型值，不同批次/电压会浮动；做音频或精密输出时，按手册最坏值预留余量，别卡着典型值设计。

### 输出缓冲 on/off 怎么选（重点）

缓冲是 DAC 引脚上的一个运放，开关它等于选**两套完全不同的输出特性**：

| | 开缓冲（默认） | 关缓冲 |
| -- | ------------- | ------ |
| 输出阻抗 | 低，能直接驱动负载 | 高阻抗，必须接高阻负载或外接运放 |
| 建立时间 | 短（4/6 µs 级） | 明显长 |
| 输出范围 | **到不了 0 和 VREF+**，靠近 rails 会失真 | 更接近 rail-to-rail |
| 典型用途 | 直接出电压、常规信号 | 接外部精密运放、高精度场景 |

选型口诀：

- **引脚直接接负载/下一级电路 → 开缓冲**（最常用，CubeMX 默认勾上即可）
- **要轨到轨、或后级有精密运放 → 关缓冲**，让外接运放负责驱动和整形
- 关缓冲时引脚输出能力差，别想着还能喂多少电流——那是运放的活

### 怎么判断"更新太快，输出没建立完"

波形顶部变圆、幅度比预期小、方波变斜坡——就是触发频率超过了输出建立能力。定频波形**宁可选慢一档，也别让 DAC 追不上**；需要更高频率就换高速外置 DAC。

## 三、配置说明（CubeMX + HAL 最小步骤）

### CubeMX 侧

1. `DAC1` → 勾选 `OUT1`（要第二路再勾 `OUT2`）
2. `Output Buffer` 勾上（除非你确定要关缓冲）
3. `Trigger`：默认 `None`（软件触发，够用了）；要定时器节拍选某定时器的 `Trigger Out`；要外部同步选 `EXTI` 类触发
4. 勾 DAC 对应的 `DMA` 请求时：方向 `Memory-to-Peripheral`、模式 `Circular`、数据宽度**两格都选 Half Word（16 位）**、`Memory Increment` 开
5. PA4/PA5 会被自动配成模拟模式，不用手改

### HAL 最小输出一个电压

```c
MX_DAC1_Init();   /* CubeMX 生成：开了缓冲 + 软件触发 */
HAL_DAC_Start(&hdac1, DAC_CHANNEL_1);
HAL_DAC_SetValue(&hdac1, DAC_CHANNEL_1, DAC_ALIGN_12B_R, 2048);   /* 2048/4095×3.3 ≈ 1.65V */
```

要点：

- `HAL_DAC_SetValue` 的第三个参数是**数据对齐方式**：`DAC_ALIGN_12B_R`（12 位右对齐，最常用）/ `DAC_ALIGN_12B_L`（左对齐）/ `DAC_ALIGN_8B_R`（8 位）。选 8 位时分辨率就是 8 位，别混。
- **只有通道使能了，SetValue 才有效**——`HAL_DAC_Start` 必须在前面。
- 只改电压时重复调 `HAL_DAC_SetValue` 即可，不用每次都 Start/Stop。

## 四、触发方式：谁来决定 DAC 何时更新

DAC 不会自己"跑"，DHR→DOR 的同步由触发信号驱动。触发之后引脚电压才变，所以**触发频率就是输出更新频率**：

| 触发方式 | 谁来喊 | 适用场景 | 关键点 |
| -------- | ------ | -------- | ------ |
| **软件触发** | CPU 写 DHR + 软件触发位 | 偶尔改个电压、偏置、阈值 | 最简单；每次更新 CPU 都参与 |
| **定时器触发（TRGO）** | TIM 的 TRGO 事件 | 固定节拍波形、PWM 式输出、音频、斜坡 | 更新频率完全由定时器决定，CPU 只负责（或不用）供数 |
| **外部引脚触发（EXTI9）** | 引脚边沿 | 与外部事件同步的更新 | 少见，具体映射看参考手册 |
| **（F1 专属）波形发生器** | 内部 LFSR/累加器，靠触发节拍驱动 | 直接出噪声/三角波 | F4 没有，见第五节 |

**为什么定时器触发重要**：和 ADC 同理，软件触发每改一次 CPU 都要动手，更新间隔由代码执行时间决定，一抖动频率就不准。**定频波形、与 PWM/电机节拍同步的输出，全用定时器触发**——定时器负责精确喊节拍，DAC 听到就更新，CPU 完全不参与时序。

CubeMX 里 DAC 的 `Trigger` 下拉框选定时器的 `Trigger Out`，再在对应定时器里开 `Trigger Output (TRGO)`。HAL 侧（**F1 与 F4 的触发源宏不同**）：

```c
/* F1：支持 TIM2/4/6/7 */
hdac1.Init.Trigger = DAC_TRIGGER_T6_TRGO;

/* F4：支持 TIM2/4/5/6/7/8 */
hdac1.Init.Trigger = DAC_TRIGGER_T6_TRGO;

/* 两边都开输出缓冲 */
hdac1.Init.OutputBuffer = DAC_OUTPUTBUFFER_ENABLE;
HAL_DAC_Init(&hdac1);

/* 定时器跑起来，DAC 每个 TRGO 节拍更新一次 */
HAL_TIM_Base_Start(&htim6);
HAL_DAC_Start(&hdac1, DAC_CHANNEL_1);
```

!!! warning "两个经典"不输出"的坑"
    1. **选了定时器触发但定时器没跑 / 没开 TRGO**——DAC 一个节拍都等不到，输出停在初始值。检查顺序：定时器在跑 → TRGO 开了 → 触发源宏没选错。
    2. **F1 触发宏名与 ADC 不同，没有"T2 指通道"那种歧义**，但触发源的可选集合随型号变（低端 F1 只有 TIM6/7 等基础定时器能用），以 CubeMX 下拉框 + 参考手册触发映射表为准。

**三套组合怎么选：**

| 需求 | 组合 |
| ---- | ---- |
| 偶尔改电压 | 软件触发 + `HAL_DAC_SetValue` |
| 固定频率改值、量小 | 定时器触发 + 中断里填下一个值 |
| 连续波形 / 数据量大 | 定时器触发 + **DMA 循环**（见第六节） |

## 五、（F1 专属）波形发生器：噪声与三角波

F1 的 DAC 内置两个小发生器，输入到 DHR 之前自动叠加/累加，**CPU 一个值都不用喂**：

- **三角波**：每个触发节拍在 DHR 基础上自动加减 1 LSB，到设定幅度顶点折返。`WaveAmplitude`（MAMP）决定幅度 = 多少 LSB（如 `DAC_AMP_LSBSTEP12` = ±12 LSB）。频率 = 触发频率 ÷ 幅度。
- **噪声**：伪随机（LFSR）序列叠加在输出上，`LFSRUnmask` 选随机位数。用于抖动注入、抗噪声测试信号。

```c
/* F1 系才有：三角波，幅度 ±12 LSB，频率由触发节拍决定 */
hdac1.Init.WaveGeneration = DAC_WAVEGENERATION_TRIANGLE;
hdac1.Init.WaveAmplitude  = DAC_AMP_LSBSTEP12;
HAL_DAC_Init(&hdac1);
HAL_DAC_Start(&hdac1, DAC_CHANNEL_1);
```

!!! tip "F4 没有这功能"
    STM32F4 的 DAC **砍掉了波形发生器**（无 WAVE/LFSR 寄存器）。F4 要三角波/噪声，老老实实查表 + DMA，别在寄存器里找。

## 六、DMA：把波形表喂给 DAC

DMA 干两件事：**定时器每个节拍自动送一个值进 DHR**，**送完一圈循环再送**——于是整段波形循环播放，CPU 全程不参与。

### DMA 请求映射（先查这个）

| 系列 | DAC1 | DAC2 |
| ---- | ---- | ---- |
| F1 | **DMA2_Ch3** | **DMA2_Ch4** |
| F4 | **DMA1_Stream5_Ch7** | **DMA1_Stream6_Ch7** |

!!! warning "F1 的隐藏前提"
    F1 的 DAC DMA 挂在 **DMA2** 上，而 DMA2 只有**高密度** F103（RC/RE 等）才有，medium/low 密度只有 DMA1——DAC 只能轮询/中断，DMA 用不了。CubeMX 没帮你建 DMA 请求时，先查型号再怀疑配置。

### 完整示例：TIM6 触发 + DMA 循环出正弦波

```c
/* ===== 配置（CubeMX）：DAC1 Trigger = TIM6 TRGO；DMA = Memory→Peripheral、Circular、Half Word ===== */

/* 64 点正弦表，每点 0~4095。注意 HAL 接口是 uint32_t*，
   但 DMA 实际按 16 位半字搬进 DHR12R，所以值只落在低 16 位 */
static uint32_t dac_buf[64];
for (int i = 0; i < 64; i++) {
    dac_buf[i] = (uint32_t)(2048 + 2047 * arm_sin_f32(2 * 3.14159f * i / 64));
}
/* 没跑 DSP 库就换成 2048 + 2047 * sinf(...)，注意头文件 math.h */

HAL_DAC_Start_DMA(&hdac1, DAC_CHANNEL_1, dac_buf, 64, DAC_ALIGN_12B_R);
HAL_TIM_Base_Start(&htim6);   /* 定时器开闸，DAC 开始按节拍吐波形 */
```

```c
/* 循环模式下 DMA 每送完一圈调一次：换波形表、计数、翻转标志都在这做 */
void HAL_DAC_ConvCpltCallbackCh1(DAC_HandleTypeDef* hdac) {
    /* 换表：memcpy 新表进 dac_buf 即可，下一圈自动播新波形 */
}

/* 供数跟不上会走这个回调（underrun）——DAC 要一个值但 DMA 没及时送到 */
void HAL_DAC_DMAUnderrunCallbackCh1(DAC_HandleTypeDef* hdac) {
    /* 触发频率太高，或 DMA 没配循环模式导致跑完一圈就停 */
}
```

**输出频率怎么算**：`正弦频率 = TIM6 触发频率 / 64`（64 点一循环）。TIM6 在 F1 上直接挂 APB1，APB1 倍频开了就是 72MHz，预分频 `prescaler` 想压多少就压多少。

### DMA 的常见坑（重点）

- **DMA 必须开 Circular（循环）模式**：不循环，跑完一圈 DMA 停，DAC 干等、波形戛然而止。这是 DAC+DMA 最高频的 bug。
- **数据宽度选 Half Word（16 位）**：DHR12R 是 16 位寄存器。选错成 Byte 或 Word，波形直接错位/削顶。
- **`HAL_DAC_Start_DMA` 传的是 uint32_t\*，但内存实际按半字访问**：值放低 16 位；别用 ADC 那种"DMA 搬 32 位、缓冲用 uint32_t"的惯性，反过来。
- **先启 DMA 再启定时器**：顺序反了，第一个节拍可能抓到空缓冲，触发 underrun。
- **缓冲大、处理耗时**：用 `HAL_DAC_ConvHalfCpltCallbackCh1` 半传回调，DMA 送完前半段就提前准备好后半段，保证无缝。
- **underrun 不是小事**：回调里别只打 log 了事。DAC 跟不上节拍时输出保持旧值，波形出现毛刺——检查触发频率、DMA 循环、宽度三项。
- **双通道同时出波形**：F1 每通道各占一个 DMA 通道（Ch3/Ch4），F4 各占一个 Stream；配两路 DMA 请求即可，别指望一个 DMA 带两个通道。

## 七、把数字换成电压：量程、负载与精度避坑

```c
/* value / 4095 × VREF，和 ADC 对称 */
float v = (float)value / 4095.0f * 3.3f;
```

- **开缓冲时输出到不了 0 和 VREF+**：靠近 rails 有失真，标称 0~3.3V 实际两端各留约几十 mV。精度敏感的场合让输出工作在中间范围，或关缓冲外接运放。
- **关缓冲 = 高阻抗输出**：必须接高阻负载（>几十 kΩ）或外部运放；引脚上的寄生电容会让建立时间更长，波形更钝。
- **VREF+ 不干净全盘皆输**：和 ADC 对称，DAC 精度上限就是 VREF+ 的精度，去耦电容别省。对精度有要求时用独立精密基准源。
- **更新频率别超过建立能力**：整幅摆至少留一个建立时间；波形顶圆/幅小就是跟不上的信号，加 RC 滤波只能平滑，救不了"本来就没建立完"。
- **地线**：AGND/DGND 单点连接，别让数字噪声灌进模拟输出回路。
- **F103 高密度才有 DAC**：低密度型号没这个外设，换型号不如外挂一个 SPI DAC 实在。

## 参考

- DAC 结构与寄存器细节：对应型号参考手册 **DAC 章节**（F1：RM0008；F4：RM0090）
- 触发源与 DMA 请求映射：参考手册 DAC 章节触发表 + **DMA 请求映射表**
- 建立时间 / 更新率：对应数据手册 **DAC 电特性表**
- 时钟分频背景：见 [stm32-clock-tree.md](stm32-clock-tree.md)
- 与 ADC 对照：见 [stm32-adc.md](stm32-adc.md)
