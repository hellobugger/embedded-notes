# STM32 USART / UART：从异步串口讲透每一种模式

> 一句话：**UART/USART 是一条按约定波特率传输字节的串行接口**。UART 只有异步收发；USART 在此基础上增加同步时钟，以及单线半双工、LIN、IrDA、Smartcard、RS-485 驱动使能等扩展能力。本文以 STM32 F1/F4 的 HAL 为主，具体功能以芯片数据手册、参考手册和 CubeMX 可选项为准。

## 一、USART、UART 和串口的关系

### 1.1 三个概念不要混

| 名称 | 本质 | 典型能力 | 常见用途 |
| --- | --- | --- | --- |
| **UART** | 通用异步收发器 | 异步 TX/RX，无时钟线 | 日志、GPS、蓝牙、模块通信 |
| **USART** | 通用同步/异步收发器 | UART + 同步时钟及扩展模式 | MCU 互连、LIN、Smartcard、IrDA |
| **串口** | 口语称呼 | 通常泛指 UART/USART | 调试、设备控制 |
| **TTL/CMOS UART** | 电平接口 | 3.3V/5V 单端逻辑 | MCU 与模块直连 |
| **RS-232** | 电气标准 | 正负电压、单端 | 老式 PC、仪器 |
| **RS-485** | 电气标准 | A/B 差分、多点总线 | 工业现场、Modbus RTU |

USART 的 TX/RX 是 3.3V CMOS 电平，**不能直接连接 RS-232 或 RS-485 总线**。RS-232 要加 MAX3232，RS-485 要加 MAX3485、SP3485 等收发器。UART 是数字协议/控制器，RS-232 和 RS-485 是电气层。

### 1.2 最基本的异步连接

```text
MCU A                              MCU B
+--------+                         +--------+
| TX ----|------------------------>| RX     |
| RX <---|-------------------------| TX     |
| GND ---|-------------------------| GND    |
+--------+                         +--------+
```

- TX 接对方 RX，RX 接对方 TX。
- GND 必须共地，否则没有共同的电平参考。
- 空闲状态通常为高电平，起始位为低电平。
- 只发日志时可以只接 TX 和 GND；只收数据时可以只接 RX 和 GND。

### 1.3 UART、SPI、I2C 的选择

| 维度 | UART/USART 异步 | SPI | I2C |
| --- | --- | --- | --- |
| 线数 | 2 根 TX/RX + GND | 通常 4 根 | 2 根 |
| 结构 | 点对点，无地址 | 主从，靠 CS | 主从，靠地址 |
| 时钟 | 无独立时钟，双方约定波特率 | 主机提供 SCK | 主机提供 SCL |
| 双工 | 全双工或半双工 | 全双工 | 半双工 |
| 速度 | 常见 9.6k~4Mbps | 可达几十 MHz | 常见 100k~1MHz |
| 适合 | 模块、调试、板间点对点 | Flash、LCD、ADC | 传感器、EEPROM、RTC |

## 二、异步 UART 的通信机制

### 2.1 一个字符由哪些位组成

UART 没有时钟线，接收方通过起始位找到一个字符的开始，然后按波特率在规定时间点采样：

```text
空闲   起始位       数据位（通常 8 位，低位先发）       校验位    停止位
高  ────┐       ┌── D0 ─ D1 ─ D2 ─ ... ─ D7 ───┐       ┌────── 高
        └───────┘                               └───────┘
           低              每位一个 bit time
```

一个典型的 `8N1` 字符包含：

1. **1 个起始位**：固定为 0，通知接收器开始接收。
2. **8 个数据位**：通常低位先发（LSB first）。
3. **无校验位**：`N` 表示 None。
4. **1 个停止位**：固定为 1，表示字符结束并回到空闲。

因此 8N1 不是每 8 个时钟传一个字节，而是每个字节至少占 **10 个 bit time**：1 起始 + 8 数据 + 1 停止。`115200 baud` 下，理论裸数据速率约为 `115200 / 10 = 11520 byte/s`。

### 2.2 波特率、采样和误差

双方必须配置相同的：

- **波特率**：如 9600、115200、1M。
- **数据位数**：7、8 或 9 位。
- **校验方式**：无、偶校验、奇校验。
- **停止位数**：0.5、1、1.5 或 2 位，具体受芯片限制。
- **数据位序**：通常 LSB first。

STM32 USART 通常使用过采样：

- **16 倍过采样**：抗时钟误差能力较好，常规默认。
- **8 倍过采样**：允许更高波特率，但采样窗口更窄，误差容忍度下降。

异步通信不是“只要波特率数字一样就行”。时钟误差会在一个字符内累计，波特率越高、数据帧越长、时钟误差越大，越容易在停止位采样时出错。常见晶振和短线通常能满足普通 UART，但高波特率、长线、强干扰环境应实测波形。

### 2.3 校验位模式

校验位是对数据位中逻辑 1 的数量做简单校验：

| 模式 | 规则 | 用途 |
| --- | --- | --- |
| None | 不发送校验位 | 默认，效率最高 |
| Even | 数据位 + 校验位中的 1 的总数为偶数 | 常用，能发现部分单比特错误 |
| Odd | 数据位 + 校验位中的 1 的总数为奇数 | 与特定设备匹配 |

校验位只能发现部分错误，不能替代 CRC。启用校验后，应用层看到的数据位宽会受影响：部分 STM32 USART 配置中，`8 data bits + parity` 实际由 9 位帧实现，接收数据寄存器的有效数据位也要按手册确认。

### 2.4 数据宽度和 9 位模式

- **8 位数据**：最常见，适合文本、二进制协议和 AT 指令。
- **7 位数据**：较少见，常与校验组合使用。
- **9 位数据**：可用于多机通信、地址标记，或者直接传输 9 位控制信息。

9 位模式不是“普通 8 位再加一位随便用”。发送和接收 API 的数据类型、DMA 宽度、校验位配置都可能需要调整。启用 9 位帧时，通常使用 `uint16_t` 缓冲区，并将 DMA 外设/内存宽度设为 Half Word；否则会发生数据截断或错位。

## 三、USART/UART 的工作模式

“模式”在 STM32 文档中可能指角色、线路形式或协议扩展。下面分开说明，避免把几个概念混为一谈。

### 3.1 异步全双工模式：普通 UART，默认首选

这是最常用的模式：TX 和 RX 两根独立数据线，双方没有时钟线，可以同时发送和接收。

- **连接**：TX、RX、GND。
- **特点**：全双工；收发互不阻塞；双方必须约定帧格式。
- **典型用途**：调试日志、GPS、蓝牙、串口屏、两块 MCU 点对点通信。
- **CubeMX**：`Asynchronous`。
- **HAL**：`HAL_UART_Transmit()`、`HAL_UART_Receive()`，或对应 `_IT`/`_DMA` 版本。

```c
UART_HandleTypeDef huart1;

huart1.Instance          = USART1;
huart1.Init.BaudRate     = 115200;
huart1.Init.WordLength   = UART_WORDLENGTH_8B;
huart1.Init.StopBits     = UART_STOPBITS_1;
huart1.Init.Parity       = UART_PARITY_NONE;
huart1.Init.Mode         = UART_MODE_TX_RX;
huart1.Init.HwFlowCtl    = UART_HWCONTROL_NONE;
huart1.Init.OverSampling  = UART_OVERSAMPLING_16;
HAL_UART_Init(&huart1);
```

### 3.2 仅发送模式

仅发送时只启用 TX，RX 可以不接或复用为普通 GPIO。

- **适合**：启动日志、调试打印、单向控制器、串口打印机。
- **优点**：节省一个引脚和接收中断。
- **注意**：没有接收路径，不能期待对方应答。

```c
uint8_t text[] = "boot ok\r\n";
HAL_UART_Transmit(&huart1, text, sizeof(text) - 1, 100);
```

### 3.3 仅接收模式

仅接收时只启用 RX，通常由外部设备主动发送数据。

- **适合**：GPS 接收、单向传感器、外部日志采集。
- **注意**：接收数据需要及时取走；没有环形缓冲时，连续数据很容易溢出。

### 3.4 USART 同步模式

同步模式在异步 UART 的基础上增加 CK 时钟线。发送方提供时钟，接收方按时钟边沿采样，不需要双方依靠各自的时钟估算 bit time。

- **线**：TX、RX、CK，通常仍需 GND。
- **角色**：通常由 USART 主设备输出 CK，从设备接收 CK。
- **特点**：时序更确定，适用于短距离同步串行设备。
- **限制**：不是 SPI 的替代品；具体 CPOL、CPHA、CK 输出能力要看芯片型号。
- **CubeMX**：选择 `Synchronous` 或启用同步时钟相关选项。

同步模式常见配置项：

| 参数 | 说明 |
| --- | --- |
| Clock polarity | CK 空闲电平，低或高 |
| Clock phase | 数据在第一个还是第二个边沿采样 |
| Last bit clock pulse | 最后一个数据位之后是否继续输出时钟 |
| Clock output | 是否由本机输出 CK |

同步 USART 的帧仍然包含数据位和停止控制，不能直接假设它与 SPI 帧完全相同。连接前必须对照两端手册确认时钟极性、边沿、帧格式和空闲状态。

### 3.5 单线半双工模式

单线半双工把 TX 和 RX 合并到一根数据线上，同一时刻只能有一个方向驱动。

- **接线**：一根数据线 + GND。
- **发送时**：本机驱动线路。
- **接收时**：本机释放 TX 驱动并切换为接收。
- **特点**：省一根线，但不能同时收发。
- **适合**：引脚紧张的板间通信、总线式简单协议。

```c
/* 发送阶段 */
HAL_HalfDuplex_EnableTransmitter(&huart1);
HAL_UART_Transmit(&huart1, tx, tx_len, 100);

/* 接收阶段：确保对端已释放总线后再切换 */
HAL_HalfDuplex_EnableReceiver(&huart1);
HAL_UART_Receive(&huart1, rx, rx_len, 100);
```

单线半双工必须处理好**方向切换和总线占用**：发送方还在驱动时，接收方不能同时驱动，否则会产生电气冲突。普通 UART 设备的 TX/RX 两线模式不能直接当单线设备使用，双方都要支持对应模式。

### 3.6 LIN 模式

LIN（Local Interconnect Network）是面向汽车车身电子的低成本单主多从总线。它使用 UART 类异步帧，但增加了同步间隔、同步字段和标识符校验。

典型 LIN 帧：

```text
Break | Sync(0x55) | Protected Identifier | Data(0~8 bytes) | Checksum
```

各字段作用：

- **Break**：主机拉出一个明显长于普通字符的低电平，通知所有节点新帧开始。
- **Sync**：固定 `0x55`，从机用它测量主机实际波特率。
- **PID**：6 位标识符 + 2 位奇偶校验，决定帧类型和目标数据。
- **Data**：0~8 字节，具体由 LIN 调度表决定。
- **Checksum**：经典校验或增强校验，用于发现传输错误。

USART 的 LIN 支持通常可以自动产生 Break、检测 Break，并帮助完成同步字段处理，但**不会替应用层实现完整 LIN 调度器**。主机仍要管理帧调度、PID、响应超时和数据解析。

- **适合**：汽车座椅、车窗、空调面板等低速控制网络。
- **优点**：线少、成本低、从机无需高精度晶振。
- **限制**：单主、低速、实时性和带宽有限。
- **硬件**：MCU USART 通常还需要 LIN 收发器，不能直接把总线线缆接到普通 TX/RX。

### 3.7 IrDA 模式

IrDA 是红外串行通信。USART 的 IrDA 模式会对 UART 数据进行红外脉冲编码/解码，并通过外部红外收发器连接光学链路。

- **发送**：UART 数据经 IrDA 编码后驱动红外 LED。
- **接收**：红外接收器输出脉冲，再由 USART 解码。
- **特点**：非接触、短距离、视距通信。
- **参数**：通常涉及低功耗模式、脉冲宽度和 IrDA 低速/高速设置。
- **注意**：IrDA 模式不是“把 TX 接到红外 LED”这么简单，需要匹配的红外收发器和光学结构。

### 3.8 Smartcard 模式

Smartcard 模式面向 ISO 7816 类智能卡。它在 UART 框架上增加了半双工数据线、特殊校验、保护时间和时钟输出等能力。

主要特点：

- 通常使用一根双向 I/O 数据线。
- USART 可输出卡片工作时钟 CK。
- 常使用**偶校验**，并有特定停止位规则。
- 支持保护时间（Guard Time），避免连续字符间隔不符合卡规范。
- 需要电源、复位、时钟和数据等配套电路。

Smartcard 模式适合真正的 ISO 7816 卡接口，不适合拿来代替普通 UART。卡座的电压、电流、上电顺序、ESD 和电平转换必须按卡规范设计；USART 只负责其中的串行控制器部分。

### 3.9 RS-485 / Driver Enable 模式

RS-485 不是 USART 协议，而是差分物理层。STM32 的 USART 可以配合 RS-485 收发器工作；部分型号支持硬件 DE（Driver Enable）引脚自动控制。

典型连接：

```text
MCU USART TX/RX <--> RS-485 收发器 DI/RO
MCU DE/RE       <--> RS-485 收发器 DE/RE
收发器 A/B      <--> 总线 A/B
```

- **发送前**：DE 拉高，使能发送器。
- **发送完成后**：必须等最后一个停止位真正发完，再释放 DE。
- **接收时**：DE 拉低，收发器进入接收状态。
- **总线**：通常半双工，多节点共享 A/B。

如果用 GPIO 软件控制 DE，应等待 `TC`（Transmission Complete），不能只等 `TXE`。`TXE` 只表示发送数据寄存器空了，最后一个字节可能还在移位寄存器中；此时提前拉低 DE 会截断最后几个 bit。

支持硬件 DE 的 USART 可以配置：

- DE 极性。
- DE assertion time：发送前提前多少时间使能。
- DE deassertion time：发送结束后延迟多少时间释放。

硬件 DE 能减少软件时序错误，但 RS-485 的终端电阻、偏置电阻、节点数量、线缆拓扑和协议仲裁仍需系统设计。Modbus RTU 只是 RS-485 上的一种应用协议，不是 RS-485 的同义词。

### 3.10 多处理器 / 地址标记模式

USART 的 9 位帧和空闲线检测可以组成简单的多机通信方案：

- 一个 9 位标志表示“这是地址帧”。
- 从机先接收地址，匹配自身地址的从机才接收后续数据。
- 其他从机忽略数据，降低 CPU 负担。

不同 STM32 系列对地址标记、唤醒和静默模式的寄存器支持不同。常见唤醒方式包括：

- **空闲线唤醒**：检测到总线空闲后唤醒。
- **地址标记唤醒**：只有带地址标记的帧唤醒目标从机。

这是一个硬件辅助的轻量多机机制，不等于完整总线协议；仍需要应用层定义地址、帧边界、超时、重试和错误恢复。

## 四、硬件流控：RTS/CTS

硬件流控使用额外的 RTS、CTS 信号控制发送速度：

- **RTS**：本机告诉对方“我是否准备好接收”。
- **CTS**：对方告诉本机“现在是否允许发送”。

开启硬件流控需要连接 TX、RX、RTS、CTS 和 GND，并且两端极性、有效电平一致。

```c
huart1.Init.HwFlowCtl = UART_HWCONTROL_RTS_CTS;
```

适合高波特率、接收端处理速度不稳定、数据不能丢失的场景。对于只有 TX/RX 两根线的模块，不能凭软件开启 RTS/CTS；没有实际连线时开启会导致发送端一直等待 CTS。

## 五、CubeMX 与 HAL 配置

### 5.1 常用初始化字段

```c
huart1.Instance          = USART1;
huart1.Init.BaudRate     = 115200;
huart1.Init.WordLength   = UART_WORDLENGTH_8B;
huart1.Init.StopBits     = UART_STOPBITS_1;
huart1.Init.Parity       = UART_PARITY_NONE;
huart1.Init.Mode         = UART_MODE_TX_RX;
huart1.Init.HwFlowCtl    = UART_HWCONTROL_NONE;
huart1.Init.OverSampling  = UART_OVERSAMPLING_16;
HAL_UART_Init(&huart1);
```

| 字段 | 作用 | 常见选择 |
| --- | --- | --- |
| `BaudRate` | 波特率 | 9600、115200 |
| `WordLength` | 帧宽，注意校验位影响 | 8B |
| `StopBits` | 停止位长度 | 1 |
| `Parity` | 奇偶校验 | None |
| `Mode` | TX、RX 或同时启用 | TX_RX |
| `HwFlowCtl` | RTS/CTS 硬件流控 | None |
| `OverSampling` | 8 倍或 16 倍采样 | 16 |
| `OneBitSampling` | 单点采样，部分型号支持 | Disable |
| `AdvancedInit` | TX/RX 极性、交换、过采样等扩展 | 默认 |

### 5.2 GPIO 配置

异步 USART GPIO 通常要求：

- TX：复用推挽输出或芯片规定的复用模式。
- RX：复用输入，必要时配置上拉/下拉。
- CK：同步模式下配置为复用输出/输入。
- DE：硬件 RS-485 模式下配置为对应复用功能。
- 选择正确的 Alternate Function。
- 开启对应 GPIO 和 USART 外设时钟。

GPIO 复用错、TX/RX 接反、没有共地，是比代码问题更常见的故障原因。

### 5.3 波特率计算的工程理解

异步波特率由 USART 外设时钟和波特率寄存器共同决定。不同 STM32 系列的 BRR 计算细节不同，不能把 F1 的公式直接套到 F4 或 H7。使用 CubeMX 时让它根据时钟树计算；裸机配置时必须按当前参考手册计算。

检查顺序：

1. 确认 USART 挂载的 APB 时钟。
2. 确认 APB 预分频器和定时器倍频规则不要被混淆。
3. 确认 `OverSampling` 是 8 还是 16。
4. 读取 BRR，反算实际波特率。
5. 用逻辑分析仪检查实际 bit time。

### 5.4 CubeMX 配置清单

以普通异步全双工 `115200 8N1` 为例，进入 `Connectivity -> USARTx` 后，按下面顺序检查：

1. **Mode** 选 `Asynchronous`，并启用 `TX/RX`。
2. **Baud Rate** 设为对端约定值，例如 `115200`。
3. **Word Length / Parity / Stop Bits** 与对端完全一致：常规设备使用 `8 Bits / None / 1`。
4. **Hardware Flow Control** 没有实际 RTS/CTS 连线时选 `Disable`。
5. 在 **GPIO Settings** 确认 TX、RX 分配到了实际接线的复用引脚；不同封装可用引脚不同。
6. 中断收发：在 **NVIC Settings** 开启对应 `USARTx global interrupt`。
7. DMA 收发：在 **DMA Settings** 添加 RX/TX 请求，通常选 `Normal`；连续接收按目标系列的 DMA 能力选择 Circular 或 Receive-to-Idle。
8. 回到 **Clock Configuration**，确认 APB 时钟没有超出该 USART 实例的上限；改时钟树后重新核对实际波特率。

不同工作模式是在这份基础配置上增减：

| 目标模式 | CubeMX/初始化额外项 | 引脚或外设要求 |
| --- | --- | --- |
| 仅发送 | 只启用 TX | TX + GND |
| 仅接收 | 只启用 RX | RX + GND |
| 同步 USART | `Synchronous`，设置 Clock polarity/phase | 额外 CK，且对端支持 |
| 单线半双工 | `Half Duplex` | 只使用 USART 的单线数据脚 |
| LIN | `LIN`，配置 Break detect length | LIN 收发器与 LIN 帧调度 |
| IrDA | `IrDA`，配置 Prescaler/低功耗选项 | 红外编码/接收硬件 |
| Smartcard | `Smartcard`，配置 Guard Time/NACK 等 | ISO 7816 卡接口电路 |
| RS-485 硬件 DE | `RS485`，配置 DE 极性及前后延时 | 支持 DE 的 USART 和 RS-485 收发器 |

!!! warning "不是每个 USART 实例都有全部模式"
    F1/F4 中，名称为 `UARTx` 的外设通常只提供异步能力；同步、LIN、Smartcard、IrDA 和硬件 DE 的支持也因具体芯片和实例而异。CubeMX 未显示某个模式，不能通过强行套用别的型号寄存器来开启；应以本芯片参考手册的 USART 功能表为准。

### 5.5 同步模式的配置与时序检查

同步 USART 的关键不是只多配一个 CK 引脚，而是两端必须对齐时钟行为：

1. 先确认哪一端输出 CK，另一端只能作为时钟接收方。
2. 对齐 CK 空闲电平（CPOL）和数据采样边沿（CPHA）。
3. 明确最后一位后是否仍要输出时钟脉冲；有些从设备依赖该脉冲完成最后一位采样。
4. 保持数据位、校验位、停止位配置一致。
5. 用示波器或逻辑分析仪确认数据在采样沿前已经稳定，而不是只看“有 CK 波形”。

同步 USART 的 CK 只在同步发送/接收相关时序中工作，不能把它当成独立的持续系统时钟输出。若目标是高速、无停止位、标准化的同步外设通信，应优先评估 SPI。

### 5.6 LIN 的最小主机发送流程

STM32 的 LIN 支持负责 UART 侧的 Break 检测或发送辅助，但完整帧仍由应用组织。主机最小流程是：

```text
发送 Break -> 发送 0x55 Sync -> 发送 PID -> 发送或等待 Data -> 校验 Checksum
```

实现时特别注意：

- Break 不是普通字符 `0x00`，它要求低电平持续时间超过常规字符帧；应使用 HAL/LL/寄存器提供的 Break 发送功能。
- `PID` 的两个校验位由 6 位 ID 计算而来；不能把裸 ID 直接当 PID 发送。
- Data 由主机发送还是从机响应，取决于该帧在调度表中的定义。
- Checksum 的经典/增强算法取决于 LIN 版本和帧定义；主从双方必须一致。
- LIN 标准速率较低，常见上限为 20 kbit/s；不要把它当作高速 UART 总线。

### 5.7 RS-485 的最小发送时序

软件控制 DE 时，推荐的发送顺序如下：

```c
static HAL_StatusTypeDef RS485_Transmit(UART_HandleTypeDef *huart,
                                        GPIO_TypeDef *de_port,
                                        uint16_t de_pin,
                                        const uint8_t *data,
                                        uint16_t size)
{
    HAL_GPIO_WritePin(de_port, de_pin, GPIO_PIN_SET);  /* 使能收发器发送 */

    HAL_StatusTypeDef status = HAL_UART_Transmit(huart, (uint8_t *)data,
                                                  size, 100);
    if (status == HAL_OK) {
        while (__HAL_UART_GET_FLAG(huart, UART_FLAG_TC) == RESET) {
        }
    }

    HAL_GPIO_WritePin(de_port, de_pin, GPIO_PIN_RESET); /* 释放总线，回到接收 */
    return status;
}
```

这里等的是 `TC`，不是 `TXE`。此函数是阻塞式示例，适合低频短帧；高频或 RTOS 场景使用 UART DMA/中断完成回调，再在确认 `TC` 后释放 DE。多节点 RS-485 还必须由上层协议规定谁可以说话；DE 只能解决收发器方向，不能解决总线冲突。

### 5.8 DMA + IDLE 的接收缓冲边界

`HAL_UARTEx_ReceiveToIdle_DMA()` 的回调给出本次收到的 `size`，但应用仍应决定如何保存这些字节：

- **固定长度协议**：累计到预期长度后处理。
- **有结束符的文本协议**：在数据中查找 `\r\n`、`\n` 等结束符。
- **带长度字段的二进制协议**：先收帧头，再按长度字段收完整帧。
- **Modbus RTU**：IDLE 可辅助判断帧间空闲，但 CRC 和协议规定的帧间时间仍是最终依据。

不要在回调中直接解析复杂协议或访问可能被另一任务同时修改的缓冲。推荐在回调中记录长度、切换/复制缓冲或投递队列，再交给主循环或 RTOS 任务解析。循环 DMA 下还要处理写指针回绕，不能只把每次回调都当作从 `rx_buf[0]` 开始的新消息。

## 六、三种收发方式：轮询、中断、DMA

### 6.1 轮询

```c
HAL_UART_Transmit(&huart1, tx, tx_len, 100);
HAL_UART_Receive(&huart1, rx, rx_len, 100);
```

优点是简单，适合启动阶段、自检和少量短数据。缺点是函数阻塞 CPU；接收等待期间，其他任务无法及时运行。生产代码不要随意使用 `HAL_MAX_DELAY`，否则断线或无数据时可能永久卡住。

### 6.2 中断

```c
HAL_UART_Receive_IT(&huart1, &rx_byte, 1);
HAL_UART_Transmit_IT(&huart1, tx, tx_len);

void HAL_UART_RxCpltCallback(UART_HandleTypeDef *huart) {
    if (huart->Instance == USART1) {
        /* 取走字节，放入环形缓冲，然后重新启动接收 */
        HAL_UART_Receive_IT(huart, &rx_byte, 1);
    }
}
```

中断适合中等速率、数据量不太大的持续通信。回调中应快速完成“取数据、入队、置标志”，不要打印日志、做复杂解析或调用长时间阻塞函数。

### 6.3 DMA

```c
HAL_UART_Transmit_DMA(&huart1, tx, tx_len);
HAL_UART_Receive_DMA(&huart1, rx, rx_len);

void HAL_UART_RxCpltCallback(UART_HandleTypeDef *huart) {
    /* DMA 接收完成，处理 rx 或通知任务 */
}
```

DMA 适合高速、连续、大块数据。DMA 缓冲区必须在传输完成前一直有效，不能把函数栈上的临时数组传给异步 DMA。发送 DMA 完成通常表示数据已经从内存搬到外设，但 RS-485 释放 DE 仍应确认 `TC`，因为最后一个 bit 可能还没出线。

### 6.4 接收不定长数据：空闲线检测

UART 协议经常是“长度未知、以一段时间没有新字节作为帧结束”。STM32 可利用 IDLE 标志：接收过数据后，线路在一个字符时间内没有新数据，就触发空闲检测。

较新的 HAL 提供：

```c
HAL_UARTEx_ReceiveToIdle_DMA(&huart1, rx_buf, sizeof(rx_buf));

void HAL_UARTEx_RxEventCallback(UART_HandleTypeDef *huart,
                                uint16_t size) {
    /* size 表示本次已经收到的长度 */
}
```

这种方式比“每收到 1 字节就进一次中断”更省 CPU，也比固定长度接收更适合 AT 指令、GPS 行、Modbus RTU 等不定长帧。IDLE 只是提示“暂时没有数据”，不是协议层完整性证明；仍要在应用层检查长度、CRC、结束符和超时。

## 七、状态标志与错误处理

常见状态：

| 标志 | 含义 | 处理重点 |
| --- | --- | --- |
| `TXE` | 发送数据寄存器为空 | 可以写入下一个数据 |
| `TC` | 整个帧已发送完成 | RS-485 释放 DE 必须等它 |
| `RXNE` | 收到一个数据 | 及时读取，防止溢出 |
| `IDLE` | 接收线空闲 | 可作为不定长帧边界提示 |
| `ORE` | 接收溢出 | 说明读取不及时，需清除并检查设计 |
| `FE` | 帧错误 | 波特率、停止位、线路干扰可能不匹配 |
| `NE` | 噪声错误 | 检查布线、采样和电平质量 |
| `PE` | 奇偶校验错误 | 两端校验配置不一致或数据受损 |
| 其他错误位 | 具体错误位以芯片参考手册为准 | 不要跨系列照抄寄存器名 |

不同系列的状态寄存器可能叫 `SR`、`ISR`，清除错误的读写顺序也可能不同。使用 HAL 时优先调用 HAL 提供的错误处理；使用寄存器时严格按当前芯片参考手册操作。

```c
void HAL_UART_ErrorCallback(UART_HandleTypeDef *huart) {
    uint32_t err = HAL_UART_GetError(huart);
    if (err & HAL_UART_ERROR_ORE) {
        /* 接收太慢：增大缓冲、降低中断负担或改 DMA */
    }
    if (err & HAL_UART_ERROR_FE) {
        /* 检查波特率、停止位、线路电平和干扰 */
    }
}
```

## 八、常见故障排查

1. **完全没有波形**：检查外设时钟、GPIO AF、USART 是否真正初始化和使能。
2. **波形正常但全是乱码**：检查波特率、时钟树、数据位、校验、停止位和电平标准。
3. **发送正常、接收异常**：优先查 TX/RX 是否交叉、RX GPIO 模式、接收中断/DMA 是否启动。
4. **只有第一帧正常**：检查是否只启动了一次中断接收；回调中要重新启动，DMA 要处理 Normal/循环模式边界。
5. **偶发丢字节**：检查 ORE、CPU 是否被阻塞、缓冲区是否太小，优先改为 DMA + 环形缓冲。
6. **RS-485 最后一个字节错误**：DE 在 `TXE` 时就释放了，改为等待 `TC`。
7. **LIN 不工作**：确认使用 LIN 收发器、Break 长度、PID 校验和主机调度表，不要只把普通 UART 波特率设好。
8. **开启 RTS/CTS 后不发送**：CTS 没接或有效电平配置反了。
9. **DMA 数据异常**：检查缓冲区生命周期、DMA 数据宽度、内存自增和缓存一致性（带 D-Cache 的 MCU 尤其要注意）。
10. **阻塞函数卡死**：不要在中断回调中调用长时间轮询函数；设置合理 timeout，不要滥用 `HAL_MAX_DELAY`。

## 九、如何选择模式

| 需求 | 推荐模式 |
| --- | --- |
| 调试日志、GPS、蓝牙模块 | 异步全双工或仅发送 |
| 两块 MCU 只剩一根数据线 | 单线半双工 |
| 汽车低成本车身网络 | LIN |
| 红外短距离通信 | IrDA |
| ISO 7816 智能卡 | Smartcard |
| 工业差分多点总线 | USART + RS-485 收发器 |
| 高速且接收长度不固定 | 异步 UART + DMA + IDLE |
| 时序由主机统一提供 | USART 同步模式 |
| 多 MCU 共用一条简单串口 | 9 位地址标记/唤醒模式 |

## 参考

- 相关外设与裸机寄存器风格见 [peripheral-drivers.md](peripheral-drivers.md)
- 总线选择可对照 [stm32-spi.md](stm32-spi.md) 和 [stm32-i2c.md](stm32-i2c.md)
- 具体寄存器、支持的模式和引脚复用以对应 STM32 型号参考手册、数据手册和 CubeMX 为准
