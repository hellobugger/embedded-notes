# STM32 ADC：从配置到 DMA 的一篇讲透

> 一句话：**ADC 把模拟电压变成数字**，要讲清楚的就三件事——**用哪种触发方式（谁来喊它开工）**、**采样时间设多长（它读得准不准）**、**结果怎么拿出来（轮询/中断/DMA，谁不挡 CPU 的活）**。本文以 F1/F4 的 12 位 ADC 为主，寄存器名与配置以 HAL 为准。

## 一、ADC 是什么、长什么样

ADC（Analog-to-Digital Converter，模数转换器）把引脚上的模拟电压量成一个数字。F1/F4 上是 **12 位逐次逼近型（SAR）ADC**，量程就是参考电压 `VREF+`（通常 3.3V）：

- 分辨率 12 位 → 数字输出范围 0~4095
- 输入范围 0 ~ `VREF+`，超范围靠钳位二极管保护，但测出来不准
- **1 LSB ≈ VREF+ / 4096**，3.3V 时约 **0.806 mV**——知道这个值才能评估「测 0.1% 的压差够不够用」

## 二、ADC 的时钟与转换时间（先看懂这个，后面才好选）

ADC 靠 APB2 时钟分频驱动，而且**对频率有硬上限**——不是 APB2 多少它就跑多少：

| 系列 | 最大 ADC 时钟 | 最小转换周期 | 12 位最短转换时间 |
| ---- | ------------ | ------------ | ----------------- |
| F1 | 14 MHz | 1.5+12.5 = 14 周期 | 1 µs |
| F4 | 36 MHz | 3+12 = 15 周期 | 0.42 µs |

`RCC_CFGR` 的 ADCPRE 是分频系数，F1 是 2/4/6/8 分频，F4 是 2/4/6/8 分频再乘一个 `RCC_PLLCFGR` 里的倍率，**总原则是「除以之后不能超过上表的 ADC 时钟上限」**。换算公式（这个要知道，别背 CubeMX 帮你算的数字）：

```text
采样时间： F1 每通道可设 1.5/7.5/13.5/28.5/41.5/55.5/71.5/239.5 周期；
           F4 则是 3/15/28/56/84/112/144/480 周期（两代数值体系不同）
转换时间： (采样时间 + 12.5[F1] / +12[F4]) / ADC时钟
e.g. F103 APB2=72MHz、÷4 → ADC时钟=18MHz？ 不行！超 14MHz 上限，得 ÷6 → 12MHz
     采样 71.5 周期 + 12.5 → 84 周期 ÷ 12MHz ≈ 7µs 一次转换
```

!!! warning "ADC 时钟超上限会怎样"
    结果直接变不准，而且不同批次表现还不一样。先查「APB2 ÷ 分频 ≤ 最大 ADC 时钟」这条再往下配，**这一步错，后面采样时间全白搭**。

## 三、采样时间：影响精度最直接的一根旋钮

### 为什么有「采样时间」这回事

SAR ADC 内部有个采样电容，转换前要**充电到跟输入电压相等**。源阻抗越高、信号内阻越大，电容充满越慢。采样时间不够 → 电容没充到位就开始转换 → **读数偏低**，这就是 ADC 经典的「测得不准」。

### 采样时间怎么选

- **低阻抗源**（运放输出、稳压源）→ 用短采样时间（F1 的 7.5/13.5，F4 的 15/28 周期），快就行
- **高阻抗源**（分压电阻网络、电位器、干电池电压）→ 必须长采样（F1 的 71.5/239.5，F4 的 144/480 周期），否则读数系统性偏低
- **看的是「这段时间够不够充」**：源阻抗 R 和采样电容 Cs 组成 RC，时间常数 τ = R·Cs（F1/F4 的 Cs 约 4~8 pF）。采样时间 ≥ 12·τ 才够准

!!! tip "工程判断法"
    手里没示波器算不清 RC？**同一通道分别设最短和最长的采样时间，读数差大于 1~2 LSB，就是采样时间太短**。差得多就加长，这是最快的标定办法。测高阻分压网络前，宁可先把采样时间拉到最大档。

## 四、触发方式：谁来喊 ADC 开工

ADC 不是自己一直转的，要有人触发。触发源 = **软件触发 + 硬件触发**两大家族：

| 触发方式 | 谁来喊 | 适用场景 | 关键点 |
| -------- | ------ | -------- | ------ |
| **软件触发** | 代码里调 `HAL_ADC_Start()` | 读一下点一下、按键后读 | 最简单，CPU 自己说了算 |
| **定时器触发（TRGO）** | TIM 的事件触发信号 | 固定采样率、与 PWM 同步、电机控制 | 采样频率由定时器精确决定，**CPU 只管收结果** |
| **外部引脚触发（EXTI）** | 引脚上的边沿 | 与外部事件同步 | 见参考手册 EXTI 触发源映射 |
| **注入通道的自动触发** | 前一次注入转换结束自动接下一次 | 需要精确时刻采样一组通道 | 注入通道细节较多，进阶再学 |

**为什么硬件触发重要**：软件触发每次都要 CPU 动手，「每隔多久采一次」由代码执行时间决定，一抖动采样间隔就不准。**固定采样率、波形采样、与 PWM 相位对齐的电流/电压采样，全用定时器触发**——定时器负责「精确到纳秒地喊」，ADC 负责「听到就采」，CPU 完全不参与时序。

CubeMX 里在 ADC 的 `ADC_Regular_ConversionMode` 区域选 `Trigger`，设 `External Trigger Conversion Source` 为某定时器的 `TRGO`（如 `TIM2_TRGO`），再在定时器里开 `Trigger Output (TRGO)`。对应 HAL 代码（**F1 与 F4 的触发源宏命名体系不同**）：

```c
/* F1：触发源直接写在 ExternalTrigConv，注意宏名里的 T2 指的是 TIM2 通道2事件 */
hadc1.Init.ExternalTrigConv = ADC_EXTERNALTRIGCONV_T2_TRGO;

/* F4：触发源要同时配 ExternalTrigConv 和 ExternalTrigConvEdge（F1 没有这个成员） */
hadc1.Init.ExternalTrigConv     = ADC_EXTERNALTRIGCONV_T2_TRGO;
hadc1.Init.ExternalTrigConvEdge = ADC_EXTERNALTRIGCONV_EDGE_RISING;

HAL_ADC_Start_DMA(&hadc1);   /* 定时器一触发，ADC 自己采、DMA 自己搬 */
```

!!! warning "F1 触发命名的坑"
    F1 触发源宏里的 `T2_TRGO` 实际映射到 TIM2 的**通道2输出比较事件**，不是 TRGO 本身，容易看错。**以 CubeMX 下拉框 + 参考手册 EXTI/触发映射表为准**，别只看宏名字面意思。

## 五、结果怎么拿出来：轮询 / 中断 / DMA

### 轮询——最简单，最挡路

```c
HAL_ADC_Start(&hadc1);
HAL_ADC_PollForConversion(&hadc1, 100);   /* 死等 EOC 置位，超时 100ms */
uint16_t v = HAL_ADC_GetValue(&hadc1);
```

适合「读一下点一下」、转换极快、对实时性无所谓的场景。**数据量上来了别用轮询**——转换期间 CPU 全程傻等。

### 中断——转换完成才打扰 CPU

```c
HAL_ADC_Start_IT(&hadc1);   /* 转换完自动进中断，不用死等 */

void ADC_IRQHandler(void) {
    HAL_ADC_IRQHandler(&hadc1);
}
void HAL_ADC_ConvCpltCallback(ADC_HandleTypeDef* hadc) {
    uint16_t v = HAL_ADC_GetValue(hadc);   /* 中断里读 */
    /* ...存进缓冲、置标志，别在中断里干重活 */
}
```

转换期间 CPU 干别的活，转换完一声中断来取。**适合单通道、采样率不高、每次结果都要处理**的场景。

### DMA——CPU 完全不沾手

```c
/* ADC DR 是 32 位寄存器，DMA 每次搬 32 位，缓冲必须用 uint32_t */
static uint32_t buf[100];
HAL_ADC_Start_DMA(&hadc1, buf, 100);   /* 采满 100 次自动搬完 */

void HAL_ADC_ConvCpltCallback(ADC_HandleTypeDef* hadc) {
    /* DMA 搬完 100 个结果，buf 里直接是连续数据，这里只管用 */
}
```

**DMA 干三件事**：转换完成自动把结果搬进内存、搬满 N 次才回调一次、转换期间 CPU 做别的。**多通道连续采样、高频采样、边采边算（FFT、平均值滤波）全用它**。

### 三选一怎么选

| 场景 | 用哪个 |
| ---- | ------ |
| 偶尔读一次（温度、按键 ADC 检测） | 轮询，代码最少 |
| 单通道定频采样，每次都要处理 | 中断 |
| 多通道轮转 / 高频连续采样 / 数据量大 | **DMA**，否则 CPU 被搬数据拖死 |

### DMA 的常见坑（重点）

- **转换完成回调 ≠ 传输完成**：`HAL_ADC_ConvCpltCallback` 是 DMA 传完才触发，多通道下代表「这一整轮通道都采完了」，别拿它当一个通道的结果。
- **多通道数据是「轮流打包」的**：开 3 个通道、采样 N 轮，`buf` 里顺序是 `ch0, ch1, ch2, ch0, ch1, ch2, ...`，**按 3 取模才能把每个通道拆出来**。
- **DMA 必须开循环（Circular）模式**：不循环，缓冲区满了 DMA 就停，ADC 继续转但结果没人搬了。
- **`HAL_ADC_Start_DMA` 有个老坑**：多通道要在**连续转换模式（Continuous）**下才会自动轮转全部通道，用定时器触发时注意别配成单次。
- **F4 读 DMA 半传（Half Transfer）**：缓冲大、处理耗时长的，用半传回调 `HAL_ADC_ConvHalfCpltCallback` 分段处理，别等全传完。

### DMA 完整示例（多通道 + 定时器触发 + 循环模式）

```c
/* ===== 配置（CubeMX）：ADC1 开 3 个通道，DMA 开 Circular，触发源选 TIM2 TRGO ===== */
ADC_ChannelConfTypeDef sConfig = {0};
sConfig.Channel      = ADC_CHANNEL_0;
sConfig.Rank         = ADC_REGULAR_RANK_1;
sConfig.SamplingTime = ADC_SAMPLETIME_71CYCLES_5;   /* 高阻源用长采样 */
HAL_ADC_ConfigChannel(&hadc1, &sConfig);            /* ch1/ch2 同理 Rank 2/3 */

/* F1/F4 的 ADC DR 是 32 位寄存器，DMA 每次搬 32 位 —— 缓冲必须用 uint32_t，
   用 uint16_t 数组会被 DMA 的 32 位写越界覆盖，这是高频踩的坑 */
static uint32_t adc_raw[48];   /* 3 通道 × 16 轮 */

HAL_ADC_Start_DMA(&hadc1, adc_raw, 48);

void HAL_ADC_ConvCpltCallback(ADC_HandleTypeDef* hadc) {
    /* 这一轮 48 个值搬完。DMA 按转换顺序打包：r0ch0,r0ch1,r0ch2,r1ch0,...，
       每个通道隔 3 个取一个 */
    uint32_t ch0_sum = 0;
    for (int i = 0; i < 16; i++) ch0_sum += adc_raw[i * 3];     /* 每隔 3 个是 ch0 */
    adc_value_ch0 = (uint16_t)(ch0_sum / 16);   /* 求平均滤噪，16 轮够压住大部分抖动 */
    /* ch1 用 i*3+1，ch2 用 i*3+2，同理 */
}
```

## 六、把数字换回电压（以及几个常用换算）

```c
/* 12 位 ADC：value / 4095 × VREF */
float voltage = (float)adc_value / 4095.0f * 3.3f;

/* 分压网络测锂电池：R1-R2 分压，采样点是中点的电压 */
/* 电池电压 = 采样电压 × (R1+R2)/R2，用浮点算完再回来转 */
```

### 基准电压不准怎么办：用内部基准源 VREFINT 校准

多数板子 `VREF+` 直接接 `VDDA`，而 `VDDA` 不会是干净的 3.3V——电源有容差、会温漂、电池还会放电。**这时按 3.3V 换算所有读数，就整体偏了**。芯片内部有一个稳定的基准源 **VREFINT**（F1/F4 约 1.2V），出厂时每颗都测过，并把「VREF+ = 3.3V 时读到的 VREFINT 值」烧进系统存储区：

- F1（F103 系）：`VREFINT_CAL` 在 `0x1FFFF7BA`
- F4（F407 系）：`VREFINT_CAL` 在 `0x1FFF7A2A`
- 其他系列以参考手册「系统存储区 / 出厂校准数据」表为准

ADC 是**比例式转换**，读数只跟「输入 / VREF+」的比例有关，所以测一次 VREFINT 就能反推真实的 VREF+：

```text
VREFINT_CAL   = 出厂时 VREF+ = 3.3V 下的 VREFINT 读数（定值，从 flash 读）
VREFINT_meas  = 现在实际采到的 VREFINT 读数

实际 VREF+  = 3.3V × VREFINT_CAL / VREFINT_meas
任意通道电压 = value / 满量程 × 实际VREF+
```

```c
/* 1. 初始化时把 VREFINT 配成一个通道（F4 用 ADC_CHANNEL_VREFINT）。
      内部通道必须用最长采样时间（F1 最长档 ≈17.1µs，正好够），否则读数不稳 */
sConfig.Channel      = ADC_CHANNEL_17;              /* F4: ADC_CHANNEL_VREFINT */
sConfig.SamplingTime = ADC_SAMPLETIME_239CYCLES_5;  /* 对应系列最长档 */
HAL_ADC_ConfigChannel(&hadc1, &sConfig);

/* 2. 采一次 VREFINT，反推实际基准电压 */
HAL_ADC_Start(&hadc1);
HAL_ADC_PollForConversion(&hadc1, 10);
uint32_t vrefint_meas = HAL_ADC_GetValue(&hadc1);
uint32_t vrefint_cal  = *(uint16_t*)0x1FFFF7BA;    /* 出厂标定值；F4 用 0x1FFF7A2A */

float vref_actual = 3.3f * vrefint_cal / vrefint_meas;   /* 实际 VREF+ */

/* 3. 之后所有通道都用它换算 */
float voltage = (float)adc_value / 4095.0f * vref_actual;
```

!!! tip "怎么用、什么时候用"
    - 只采一次不稳，采几轮平均再算；VREFINT 自身也有温漂，但比拿 3.3V 硬算准得多。
    - 适合「VREF+ 接 VDDA、精度要求一般但要求自校准」的场合：电池供电、电源不干净。
    - 若你的 VREF+ 接了**独立精密基准源**，这套反推就不需要了，直接按基准值算。
    - 顺手还能当「低压检测」用：算出的实际 VDDA 跌到阈值就知道该关机了。
    - CubeMX 在 ADC 通道列表里能看到这个内部通道（F1 叫 Vrefint，F4 勾选 Vrefint channel），勾上生成代码即可，不用飞线。

## 七、精度与避坑备忘

- **采样时间不够，读数偏低**：高阻源必用长采样时间，先测「最短档 vs 最长档」的差值判断。
- **参考电压不干净，全盘皆输**：`VREF+` 上要加去耦电容，稳压源别省——ADC 的精度上限就是参考电压的精度。如果 VREF+ 接的是 VDDA 且电源有容差，用 **VREFINT 内部基准源反推实际基准电压** 校准，见第六节。
- **引脚别悬空**：没用的模拟引脚悬空会读飘，接地或接固定电平，或者干脆配成数字。
- **别让 ADC 时钟超上限**：F1 超 14 MHz、F4 超 36 MHz，精度直接崩，详见第二节。
- **数字地和模拟地单点连接**：PCB 上 AGND/DGND 单点接，别让数字噪声灌进模拟参考。
- **校准**：F4 系在 `HAL_ADCEx_Calibration_Start()`（老版本叫 `HAL_ADCEx_Calibrate_Start`），F1 没有软件校准，靠硬件自校准。
- **多通道用 DMA**：数据量一上来轮询就是灾难，DMA + Circular + 连续模式是标准姿势。

## 参考

- 采样时间/触发源/寄存器细节：对应型号参考手册 **ADC 章节**（F1：RM0008；F4：RM0090）
- 触发源与定时器的映射关系：参考手册 ADC 章节 **Regular/Injected trigger table** + 定时器章节 TRGO
- 时钟分频相关背景：见 [stm32-clock-tree.md](stm32-clock-tree.md)
