# STM32 SPI：从四根线讲透软件 SPI / 硬件 SPI / DMA / 各种模式

> 一句话：**SPI 是一条「主设备打拍子、从设备跟拍」的四线全双工总线**——主设备用时钟线（SCLK）打节拍，两根数据线（MOSI 出、MISO 进）每拍同时收一个比特、发一个比特，再用一根片选线（CS/NSS）点名「这一轮跟谁说话」。要讲清楚的其实是六件事——**这四根线凭什么能高速全双工**（通信机制与时序）、**同一个接口为什么有「软件」和「硬件」两种做法**（软 SPI vs 硬 SPI）、**硬件 SPI 的「模式」到底指什么**（主/从、CPOL/CPHA 四模式、全双工/半双工等一拆到底）、**硬件 SPI 怎么配**（配置说明）、**怎么把 CPU 从搬字节里解放出来**（DMA）、以及**工程上踩过的坑**（避坑备忘）。本文以 F1/F4 的 HAL 为例，寄存器名与配置以 HAL 为准。

## 一、通信机制：四根线怎么就把事办了

### 1.1 四根线的分工

SPI 通常用 **四根线**，各司其职：

| 信号 | 全称 | 方向 | 作用 |
| ---- | ---- | ---- | ---- |
| **SCLK** | Serial Clock | 主 → 从 | **时钟线**，主设备产生，给全总线打拍子 |
| **MOSI** | Master Out Slave In | 主 → 从 | 主出从入：主设备发数据给从设备 |
| **MISO** | Master In Slave Out | 从 → 主 | 主入从出：从设备发数据给主设备 |
| **CS/NSS** | Chip Select / Slave Select | 主 → 从 | **片选线，低有效**：拉低 = 点名这个从机上场 |

和 I2C 的「一根线分时收发、喊地址点名」不同，SPI 用一句话理解它的性格：

> **SPI 是「老师给一排学生单独上小课」——老师打拍子（SCLK），把要讲的话写在黑板（MOSI）上，学生把回答写在纸条（MISO）上递上来，每一拍两边同时进行；谁被点名（CS 拉低）谁才听课，没被点名的学生把嘴闭上（MISO 高阻）。**

三个关键特征：

- **全双工**：每来一个时钟沿，主设备**同时**发出去 1 bit、收进来 1 bit。所以「发一个字节」=「收一个字节」，读写天然配对。
- **无地址、无 ACK**：不像 I2C 那样先喊 7 位地址再听应答。SPI 靠 **CS 片选**定位从机，发出去的数据**从设备有没有收到没人管**——协议层没有应答机制，可靠与否全靠上层自己约定。
- **同步**：数据在时钟的边沿采样/变化，时钟由主设备独占产生，所以**速率可以很高**（F4 上可达十几 Mbps ~ 几十 Mbps），远超 I2C 的 1M。

### 1.2 为什么没有地址也能「点名」：片选机制

I2C 靠「地址广播」让从机应答，SPI 靠 **CS 引脚物理选中**：

- 一主一从：从机的 CS 直接接地（常选），省一根线。
- 一主多从：每个从机**单独一根 CS**，主设备同一时刻只拉低一个。
- 多个从机接**同一条 SCLK/MOSI/MISO 总线**（共总线），靠 CS 决定当前谁参与。

```
            ┌─────────┐
   SCLK ────┤         │
   MOSI ────┤  主 MCU  │
   MISO ────┤         │
            └────┬────┘
        CS1  ←───┘  CS2  ←───┘  CS3  ←───┘
                 │        │        │
            ┌─────────┐ ┌─────────┐ ┌─────────┐
            │ 从机 1   │ │ 从机 2   │ │ 从机 3   │  （共享 SCLK/MOSI/MISO）
            └─────────┘ └─────────┘ └─────────┘
```

!!! warning "没被选中的从机 MISO 必须是高阻"
    所有从机的 MISO 都接在主设备同一根线上，**只有 CS 被拉低的那个允许驱动 MISO**，其余必须把 MISO 置为**高阻（三态）**。如果某个从机不理会 CS 状态、MISO 一直强驱动，多从机时总线直接打架（数据全是乱的）。这也是「换一块从机模块总线就废」的常见原因——多半是那块的 MISO 输出行为不对。

### 1.3 速率与时钟

SPI 没有固定档位，**主设备 SCLK 想多快就多快**，唯一约束是「从机手册最高支持多少」和「线路/上拉能承受多快」。硬件 SPI 的波特率来自**外设时钟分频**：

```text
SCLK = PCLK / 预分频      // 预分频为 2、4、8、…、256（2 的幂）
```

- **F1**：SPI1 挂 **APB2**（最高 72MHz），SPI2/3 挂 **APB1**（最高 36MHz）。APB2 全速时 SPI1 最高 36Mbps（÷2）。
- **F4**：SPI1/4/5/6 挂 **APB2**（最高 84MHz），SPI2/3 挂 **APB1**（最高 42MHz）。APB2 全速时 SPI1 最高 42Mbps（÷2）。

工程上 **1M ~ 10Mbps** 是绝大多数 SPI Flash / ADC / 显示屏的常见区间，分频算出来落在 `PCLK/8 ~ PCLK/64` 附近。

### 1.4 与 I2C / UART 的对比：什么时候选谁

| 维度 | SPI | I2C | UART |
| ---- | ---- | ---- | ---- |
| 线数 | **4 根**（SCLK+MOSI+MISO+CS） | 2 根（SCL+SDA） | 2 根（TX+RX） |
| 结构 | **主从，一主多从**（靠 CS 片选） | 主从，可多从（靠地址） | **点对点**，无地址 |
| 速度 | **数十 Mbps**（最快） | 100k~1M | 通常 ≤ 几 Mbps |
| 全双工 | ✅（天然） | ❌ 半双工 | ✅ |
| 硬件握手 | ❌ 无 ACK | ✅ 有 ACK | ❌ 无 |
| 总线仲裁 | ❌ | ✅ 支持多主 | ❌ |
| 数据搬运 | 最省 CPU（配 DMA） | 省 CPU | 省 CPU |

**怎么选**：追求速度、要全双工、外设是「一块一片」的结构 → **SPI**（SPI Flash、高速 ADC、LCD/OLED、SD 卡、以太网 PHY）；接线紧张、多从机共总线、要 ACK 可靠性 → **I2C**（传感器、EEPROM、RTC）。**SPI 是「高速外设的默认总线」，I2C 是「低速传感器的默认总线」。**

## 二、软件 SPI vs 硬件 SPI：同一件事的两种做法

这是 SPI 专题最核心的辨析。**同一个外设，为什么有的工程师「用 GPIO 自己模拟」，有的用「芯片自带的 SPI 外设」？** 区别不是功能不同，而是**实现主体不同**——软件 SPI 用 CPU 逐位翻转 GPIO，硬件 SPI 用芯片内部的专用外设自动管理时序。

### 2.1 软件 SPI：用 GPIO 模拟时序

软件 SPI 是**不依赖芯片自带的 SPI 外设，直接用三个普通 GPIO（+ 一个片选）模拟出 SCLK/MOSI/MISO 的行为**。一个最简的核心逻辑：

```c
/* 软件 SPI 的核心：写 MOSI → 拉高 SCLK（打一拍）→ 读 MISO，如此循环 8 次 */
static void SPI_WriteByte(uint8_t byte) {
    for (int i = 0; i < 8; i++) {
        /* 1. 先放数据：MSB 先行，SCLK 还没拉高时 MOSI 就绪 */
        HAL_GPIO_WritePin(MOSI_GPIO_Port, MOSI_Pin,
                          (byte & 0x80) ? GPIO_PIN_SET : GPIO_PIN_RESET);
        byte <<= 1;

        /* 2. 拉高时钟：上升沿，从机此刻采样 MOSI */
        HAL_GPIO_WritePin(SCLK_GPIO_Port, SCLK_Pin, GPIO_PIN_SET);
        SPI_Delay();    /* 半个时钟周期（空循环延时） */

        /* 3. 拉低时钟：下降沿，主设备此刻采样 MISO */
        HAL_GPIO_WritePin(SCLK_GPIO_Port, SCLK_Pin, GPIO_PIN_RESET);
        SPI_Delay();
    }
}
```

它的**本质**是：把协议里的每一拍（一个 bit）都拆成「放数据 + 翻时钟 + 读数据 + 延时」的指令序列，由 **CPU 一条条执行**。速率由延时函数决定（通常空循环 delay loop），**不精确、但能跑**。上面这段实现的就是 **Mode 0**（空闲低、上升沿采样）——想换模式，改的是「空闲电平」和「采样沿」这两处代码逻辑。

### 2.2 硬件 SPI：专用外设接管

硬件 SPI 用的是芯片内部**专门的 SPI 外设**（F1 的 SPI1/2，F4 的 SPI1/2/3/4/5/6），它内置移位寄存器 + 状态机，自动完成「拉时钟、搬数据、管理 NSS」，CPU 只需要「把要发的字节写进数据寄存器，然后等标志/中断」，同时读走收到的字节。

```c
/* 硬件 SPI：CPU 只填缓冲和长度，外设自动做时序 */
HAL_SPI_Transmit(&hspi1, txData, len, HAL_MAX_DELAY);
HAL_SPI_Receive(&hspi1, rxData, len, HAL_MAX_DELAY);
```

它的**本质**是：**每个时钟沿「发 1 收 1」由硬件移位寄存器完成**，CPU 不参与逐位翻转，只关心「开始、完成、出错」。发送时 CPU 写一次数据寄存器，硬件就自动把整帧按配置的 CPOL/CPHA 送出去；接收时每收满一个字节硬件置标志，CPU 读走即可。

### 2.3 逐维度对比

| 对比维度 | 软件 SPI | 硬件 SPI |
| -------- | -------- | -------- |
| **实现主体** | CPU 逐位翻转 GPIO，靠空循环延时 | 芯片自带 SPI 外设（移位寄存器+状态机） |
| **引脚需求** | 任意 3 个 GPIO（+CS），无特殊要求 | 必须接在 SPI 专用 AF 引脚（如 F4 的 PA5/PA6/PA7） |
| **时序精度** | 取决于延时循环，**受中断/编译优化影响，有抖动** | 硬件时钟精确，**稳定** |
| **波特率** | 由延时决定，不精确（通常几十 kHz ~ 几 Mbps） | 精确可配（PCLK ÷ 2~256），**可上几十 Mbps** |
| **速率上限** | 受 GPIO 翻转速度 + 中断影响，很难上 10M | 可达 PCLK/2（F4 SPI1 最高约 42Mbps） |
| **CPU 占用** | **高**，每个位都要 CPU 忙等延时 | 低，字节级可交给中断/DMA（见第五节） |
| **全双工** | 可以，但收发时序要靠代码小心对齐 | **天然全双工**，硬件自动同拍收发 |
| **可靠性** | 无硬件错误检测，出错难定位 | 有硬件错误标志（溢出 OVR / 模式错误 MODF / CRC），HAL 能查错误码 |
| **对中断敏感** | **严重**，中断打断会破坏时序 | 弱，时序由硬件保证 |
| **可移植性** | 跨芯片强（任何 GPIO 都能模拟） | 强（HAL 封装统一，但引脚要换） |
| **代码量 / 依赖** | 自写 ~30 行，零依赖，可读性好 | 依赖 HAL 库，初始化结构体较多 |
| **调试难度** | 简单透明，波形看得懂；但慢 | 配置项多（模式/极性/相位/分频），配错难查 |

### 2.4 到底用哪个：一张决策表

| 场景 | 推荐 |
| ---- | ---- |
| SPI Flash / 高速 ADC / LCD / SD 卡，追求速度与稳定 | **硬件 SPI**（默认首选） |
| 新板子刚回来、先快速点亮一个模块验证硬件 | **软件 SPI**（几分钟就能跑，不依赖 CubeMX，方便排硬件） |
| 引脚被占用，只能用三个不支持的 GPIO 口 | **软件 SPI** |
| 跑 RTOS，数据量大，需要把 CPU 空出来 | **硬件 SPI + DMA** |
| 跨平台移植（代码要在多型号 MCU 复用） | **软件 SPI**（或封装好的一层抽象） |
| 接线紧张，且速度要求不高（几百 kHz 就够） | **软件 SPI**（省引脚，但慢） |

!!! tip "工程惯例：能用硬件就用硬件"
    硬件 SPI 的「配置复杂」只在**第一次配**时付出成本，配好后它比软件 SPI 快一两个数量级、还省 CPU。软件 SPI 适合**调试早期**和**引脚受限/跨平台**的场合，作为「兜底方案」存在。**全双工和高速是 SPI 的招牌，用软件 SPI 等于把这两张牌都丢了**——除非速度真的无所谓。

## 三、硬件 SPI 的各个模式：把「模式」这个词一拆到底

「SPI 模式」是新手最容易混的坑，因为**它在不同语境下指四件完全不同的东西**：芯片角色（主/从）、时钟格式（CPOL/CPHA 四模式）、数据格式（8/16 位、MSB/LSB）、传输方向（全双工/半双工/单工）。配错任何一个，通信就废。下面逐个拆开。

### 3.1 角色模式：主模式 vs 从模式

SPI 永远是**一主一从（或一主多从）**通信，MCU 通常当主，偶尔当从（比如被另一块 MCU 或上位机拉数据）。

| 角色 | 谁产生时钟 | 谁控制片选 | HAL 配置 | HAL 收发函数 |
| ---- | ---- | ---- | ---- | ---- |
| **主模式** | MCU 产生 SCLK | MCU 自己拉 CS | `SPI_MODE_MASTER` | `HAL_SPI_Transmit / Receive / TransmitReceive` |
| **从模式** | 外部主设备产生 SCLK | 外部主设备拉 CS | `SPI_MODE_SLAVE` | `HAL_SPI_SlaveTransmit / Receive / TransmitReceive` |

- 主模式：时钟分频由自己的 PCLK 决定；CS 多半用普通 GPIO 软件控制（见 3.6）。
- 从模式：**没有自己的时钟**，SCLK 完全由对方给；速度上限由从机自身决定，主设备跑太快会溢出。
- **主从必须一方当主、一方当从，且时钟极性/相位一致**（见 3.2），否则波形对不上，全是乱码。

### 3.2 时钟极性 CPOL 与时钟相位 CPHA：四种模式（0/1/2/3）

**「SPI 模式 0~3」就是 CPOL 和 CPHA 的组合**，这是 SPI 最常说的「模式」，也是**主从必须对齐**的关键参数。

- **CPOL（Clock Polarity，极性）**：决定 **SCLK 空闲时是高还是低**。
  - CPOL=0：空闲为**低**，脉冲是「低→高→低」。
  - CPOL=1：空闲为**高**，脉冲是「高→低→高」。
- **CPHA（Clock Phase，相位）**：决定**在哪个时钟沿采样数据**。
  - CPHA=0：**第一个边沿**采样（空闲跳变后的第一个沿）。
  - CPHA=1：**第二个边沿**采样。

四种组合（**主从必须取同一个编号**）：

| 模式 | CPOL | CPHA | 空闲电平 | 采样沿 | 变化沿 | 典型设备 |
| ---- | ---- | ---- | ---- | ---- | ---- | ---- |
| **Mode 0** | 0 | 0 | 低 | 第一个沿（**上升沿**） | 下降沿 | 绝大多数（W25Q 系列 SPI Flash 等） |
| **Mode 1** | 0 | 1 | 低 | 第二个沿（**下降沿**） | 上升沿 | 少数传感器 |
| **Mode 2** | 1 | 0 | 高 | 第一个沿（**下降沿**） | 上升沿 | 少数器件 |
| **Mode 3** | 1 | 1 | 高 | 第二个沿（**上升沿**） | 下降沿 | W25Q 系列（支持 0 和 3）、部分 ADC |

时序图（Mode 0 为例，注意「空闲低、上升沿采样」）：

```
Mode 0（CPOL=0, CPHA=0）：空闲低，第一个沿（上升沿）采样
SCLK   ─┐   ┌┐   ┌┐   ┌┐   ┌┐   ┌┐   ┌┐   ┌┐
        │   ││   ││   ││   ││   ││   ││   ││
        └───┘└───┘└───┘└───┘└───┘└───┘└───┘
MOSI   X D7  X D6  X D5  X D4  X D3  X D2  X D1  X D0
         ↑    ↑    ↑    ↑    ↑    ↑    ↑    ↑
        每个上升沿采样（数据在 SCLK 低电平期间变化，上升沿前已稳定）
```

Mode 1（CPOL=0, CPHA=1）：空闲低，**下降沿采样**，数据在上升沿就绪：

```
Mode 1（CPOL=0, CPHA=1）：空闲低，下降沿采样
SCLK  ────┐   ┌───┐   ┌───┐   ┌───┐   ┌────
          │   │   │   │   │   │   │   │
          └───┘   └───┘   └───┘   └───┘
          采样点：每个 ↓（下降沿）
```

Mode 2/3 只是把空闲电平翻到**高**，采样沿对应为第一个沿（下降沿）/第二个沿（上升沿），图把上面的低换成高即可。

**工程上怎么确定该用哪个模式**：

1. **查从机 datasheet** 的时序章节，通常会写「支持 SPI Mode 0/3」或给出 CPOL/CPHA 图。
2. **SPI Flash（W25Q 等）几乎都支持 Mode 0 和 Mode 3**——这两个模式采样沿都在时钟波形的「同一边」逻辑（空闲电平不同但采/发配合一致），很多器件两种都兼容。
3. 不确定时，**先用 Mode 0 试**，读回全 FF 或全 00 再试 Mode 3——两种最常见。
4. **主从必须一致**：主机 Mode 0、从机 Mode 3，数据全错且难查，这是 SPI 不工作的头号配置坑。

!!! tip "一句话记 CPOL/CPHA"
    **CPOL 决定「歇着的时候电平」**，**CPHA 决定「第几个沿下手采样」**。Mode 编号 = CPOL×2 + CPHA。Mode 0/3 覆盖了绝大多数 SPI Flash。

### 3.3 数据宽度模式：8 位帧 / 16 位帧

SPI 一次收发的基本单位叫**帧**，HAL 用 `DataSize` 配置：

- **8 位**（`SPI_DATASIZE_8BIT`）：绝大多数传感器/Flash/LCD，**默认**。
- **16 位**（`SPI_DATASIZE_16BIT`）：音频 DAC/ADC（I2S 常用）、部分高速器件按 16 位组织数据。

**注意**：帧宽必须与从机一致；同时**和 DMA 的 Data Width 是两回事**——DMA 搬运宽度（字节/半字/字）是「怎么搬」，SPI 帧宽是「一帧几个 bit」。8 位帧 + DMA 用字节（8 bit）搬运；16 位帧 + DMA 用半字（16 bit）搬运，DMA 配错宽度数据会错位。

### 3.4 字节序：MSB 先行 / LSB 先行

- **MSB 先行**（`SPI_FIRSTBIT_MSB`）：先发最高位。**绝大多数 SPI 器件**，默认。
- **LSB 先行**（`SPI_FIRSTBIT_LSB`）：先发最低位。少数器件（某些 ADC、74HC595 系列）要求。

**主从必须一致**，且软件 SPI 移植时最容易在这栽跟头——代码里 `byte & 0x80`（MSB）还是 `byte & 0x01`（LSB）写反，硬件连上就全是反的。

### 3.5 方向模式：CubeMX 的 8 个 Mode 选项，一拆到底

CubeMX 里 SPI 的 **Mode 下拉框**不是一件事，而是**两个开关的笛卡尔积**：

- **角色**：Master（主，自己产生时钟）/ Slave（从，被动跟拍）——见 3.1
- **数据方向**：Full-Duplex（全双工）/ Half-Duplex（半双工）/ Receive Only（仅收）/ Transmit Only（仅发）

**2 种角色 × 4 种方向 = 8 个选项**，就是你在下拉框里看到的全部：

| CubeMX 选项 | HAL `Mode` | HAL `Direction` | 寄存器位 | 本机（MCU）占用的引脚 | 典型用途 |
| ---- | ---- | ---- | ---- | ---- | ---- |
| **Full-Duplex Master** | `SPI_MODE_MASTER` | `SPI_DIRECTION_2LINES` | BIDIMODE=0, RXONLY=0 | SCK + MOSI(发) + MISO(收) | **默认首选**：Flash/ADC/LCD/SD |
| **Full-Duplex Slave** | `SPI_MODE_SLAVE` | `SPI_DIRECTION_2LINES` | BIDIMODE=0, RXONLY=0 | SCK(入) + MOSI(入) + MISO(出) | 被另一主设备当从机拉数据 |
| **Half-Duplex Master** | `SPI_MODE_MASTER` | `SPI_DIRECTION_1LINE` | BIDIMODE=1 | SCK + **MOSI 一根线双向** | 引脚紧张的两块 MCU 互连 |
| **Half-Duplex Slave** | `SPI_MODE_SLAVE` | `SPI_DIRECTION_1LINE` | BIDIMODE=1 | SCK(入) + **MISO 一根线双向** | 同上，从机一侧 |
| **Receive Only Master** | `SPI_MODE_MASTER` | `SPI_DIRECTION_2LINES_RXONLY` | BIDIMODE=0, RXONLY=1 | SCK + MISO(收)，**MOSI 被释放** | 纯读：FIFO、连续输出型 ADC、只读器件 |
| **Receive Only Slave** | `SPI_MODE_SLAVE` | `SPI_DIRECTION_2LINES_RXONLY` | BIDIMODE=0, RXONLY=1 | SCK(入) + MOSI(入)，**MISO 被释放** | 从机纯接收（少见） |
| **Transmit Only Master** | `SPI_MODE_MASTER` | `SPI_DIRECTION_2LINES` | BIDIMODE=0, RXONLY=0 | SCK + MOSI(发)，**MISO 被释放** | 纯写：74HC595、LED 灯带、DAC、发命令 |
| **Transmit Only Slave** | `SPI_MODE_SLAVE` | `SPI_DIRECTION_2LINES` | BIDIMODE=0, RXONLY=0 | SCK(入) + MISO(出)，**MOSI 被释放** | 从机纯发送（少见） |

!!! warning "「Transmit Only」在 F1/F4 上没有专门的寄存器位"
    F1/F4 的 SPI 只有一个「关发送」的开关 **RXONLY**（Receive Only），**没有 TXONLY 位**。所以 **Transmit Only 的寄存器配置和 Full-Duplex 完全一样**（BIDIMODE=0, RXONLY=0），区别只是 **CubeMX 不分配 MISO 引脚、代码里也不调用接收**。别指望在 `Direction` 里找到一个「仅发送」的常量——它不存在，`仅发送 = 全双工配置 + 不用接收`。

**先讲透三个寄存器位**，这 8 个模式在硬件上就是它们：

| 寄存器位 | 含义 | 取值 |
| ---- | ---- | ---- |
| **BIDIMODE**（双向模式） | 0 = 两线单向（MOSI/MISO 分开）；1 = **一线双向（半双工）** | 半双工模式的开关 |
| **RXONLY**（仅接收） | 1 = **关闭发送**，MOSI 释放，只从 MISO 收 | 「Receive Only」就是这个位 |
| **BIDIOE**（双向输出使能） | 半双工下：1 = 本机往 SD 线上发；0 = 本机从 SD 线上收 | 半双工里切换收发方向 |

下面逐个模式展开。

#### 3.5.1 Full-Duplex Master（全双工主模式）—— 默认首选

- **配置**：`Mode = SPI_MODE_MASTER`，`Direction = SPI_DIRECTION_2LINES`。
- **引脚**：SCK + MOSI(发) + MISO(收)，三根全用。
- **行为**：每来一个时钟，**同时**往 MOSI 发 1 bit、从 MISO 收 1 bit。写就是发，读就要发哑字节喂时钟。
- **HAL 函数**：`HAL_SPI_Transmit / Receive / TransmitReceive`（读用 `TransmitReceive`，见下）。
- **什么时候用**：**90% 的场景**。SPI Flash、高速 ADC、LCD/OLED、SD 卡、以太网 PHY……全双工是 SPI 的招牌，没特殊理由就用它。

全双工里「**读**」的固定套路（命令+数据一个事务串完）：

```c
/* 读 Flash：先发命令+地址，再发哑字节把数据带回来 */
uint8_t cmd[4] = {0x03, addr_hi, addr_mid, addr_lo};
HAL_SPI_Transmit(&hspi1, cmd, 4, HAL_MAX_DELAY);
uint8_t dummy = 0xFF, rx[16];
HAL_SPI_TransmitReceive(&hspi1, &dummy, rx, 16, HAL_MAX_DELAY);  /* 发哑字节，收真数据 */
```

!!! warning "全双工里「只发不收」会 OVR 溢出"
    全双工是**每拍必收**。如果你只调 `HAL_SPI_Transmit` 而不读接收缓冲，从机发回来的字节会在 RXNE 里堆积，触发 **OVR（溢出）错误**，重则把后续通信卡住。**想「纯发」请用 Transmit Only Master**（MISO 不接、无接收），或每次发完读走 RX 缓冲。

#### 3.5.2 Full-Duplex Slave（全双工从模式）

- **配置**：`Mode = SPI_MODE_SLAVE`，`Direction = SPI_DIRECTION_2LINES`。
- **引脚**：SCK(入) + MOSI(入) + MISO(出)。**没有自己的时钟**，SCLK 完全由外部主设备给。
- **行为**：主设备打拍子，从机在上升沿采 MOSI、在下降沿往 MISO 放数据——**同时收发**，只是节奏是别人的。
- **HAL 函数**：`HAL_SPI_SlaveTransmit / SlaveReceive / SlaveTransmitReceive`（注意函数名带 `Slave`，不是主模式的 `HAL_SPI_Transmit`）。
- **什么时候用**：你的 MCU 被另一块主设备（另一块 MCU、FPGA、上位机扩展卡）当作从机拉数据。比如板间通信、SPI 从机外设、模拟一个从设备给主设备测。

主从两端的典型配对：

| 主设备（Master） | 从设备（Slave） | 说明 |
| ---- | ---- | ---- |
| Full-Duplex Master | Full-Duplex Slave | 最常见配对，三线 SCK/MOSI/MISO + 一根 CS |
| Transmit Only Master | Receive Only Slave | 主只管发、从只管收（如主往从灌配置） |
| Receive Only Master | Transmit Only Slave | 从机被点读，主设备只收 |

#### 3.5.3 Half-Duplex Master（半双工主模式）

- **配置**：`Mode = SPI_MODE_MASTER`，`Direction = SPI_DIRECTION_1LINE`。
- **引脚**：SCK + **一根双向数据线（主设备侧是 MOSI 引脚）**。MOSI/MISO 不再各管各的，**这一根线分时收/发**。
- **行为**：同一根线上，先发一批（BIDIOE=1，本机驱动），再切到收（BIDIOE=0，等对端驱动）。**同一时刻只能有一个方向**，吞吐减半。
- **HAL 函数**：`HAL_SPI_Transmit` 后再 `HAL_SPI_Receive`，**HAL 会在切换时自动改 BIDIOE**，但方向翻转瞬间对端也要把线让出来：

```c
/* 半双工：同一根线上先发后收 */
uint8_t tx[4] = {0xAA, 0xBB, 0xCC, 0xDD};
uint8_t rx[4];
HAL_SPI_Transmit(&hspi1, tx, 4, HAL_MAX_DELAY);  /* 发阶段：SD 线为输出 */
SPI_TurnaroundDelay();                           /* 留出让线时间（turnaround） */
HAL_SPI_Receive(&hspi1, rx, 4, HAL_MAX_DELAY);   /* 收阶段：SD 线为输入 */
```

- **什么时候用**：**引脚紧张到只剩一根数据线**、且对端也支持半双工（另一块 STM32 或专门支持 1 线的器件）时才用。普通 4 线 SPI 从机（W25Q Flash 等）**不能**工作在半双工下。

!!! warning "半双工的三个前提，缺一不可"
    1. **对端也必须支持半双工**（BIDIMODE=1）——普通 SPI 从机（Flash、大多数传感器）不行；
    2. **方向切换要留时间**：发切收的瞬间，一端还拉着线、另一端就要读，中间不给 turnaround 时间数据必错；
    3. **半双工里数据线物理接法要拐弯**：主机的 MOSI 引脚要接到**从机的 MISO 引脚**（不是对端的 MOSI），因为从机侧的双向线是 MISO。接线表上对端那一格是「MISO」，别按全双工的直连思维接。

#### 3.5.4 Half-Duplex Slave（半双工从模式）

- **配置**：`Mode = SPI_MODE_SLAVE`，`Direction = SPI_DIRECTION_1LINE`。
- **引脚**：SCK(入) + **一根双向数据线（从机侧是 MISO 引脚）**。
- **行为**：和 3.5.3 完全同构，只是站在从机一侧——主设备先发，从机在接收阶段把线让出来；轮到从机发时（BIDIOE=1）才驱动 MISO。
- **什么时候用**：和 3.5.3 成对出现。两块 MCU 用 1 线互连时，**主侧选 Half-Duplex Master，从侧选 Half-Duplex Slave**，数据线接「主的 MOSI ↔ 从的 MISO」。

#### 3.5.5 Receive Only Master（仅接收主模式）—— 纯读最省事

- **配置**：`Mode = SPI_MODE_MASTER`，`Direction = SPI_DIRECTION_2LINES_RXONLY`（就是寄存器里 RXONLY=1）。
- **引脚**：SCK + MISO(收)。**MOSI 被释放**（可以做 GPIO 干别的），因为发送被硬件关了。
- **行为**：主设备照常产生时钟，**硬件自动发空数据**（0x00）喂从机，你只从 MISO 收——**不用像全双工那样手动发哑字节**，这是它最大的省事点。
- **HAL 函数**：`HAL_SPI_Receive`：

```c
/* 纯收：无需哑字节，硬件自动喂时钟 */
uint8_t rx[16];
HAL_SPI_Receive(&hspi1, rx, 16, HAL_MAX_DELAY);
```

- **什么时候用**：**从机只是「被点读」、永远不回写**的场景——FIFO 深度读取、连续输出型 ADC、只读状态寄存器、以及「读数据阶段」的 SPI Flash（发完命令地址后切 RXONLY 收）。**比全双工省一根引脚、少一份哑字节代码。**

#### 3.5.6 Receive Only Slave（仅接收从模式）

- **配置**：`Mode = SPI_MODE_SLAVE`，`Direction = SPI_DIRECTION_2LINES_RXONLY`。
- **引脚**：SCK(入) + MOSI(入)。**MISO 被释放**（从机不需要回数据）。
- **行为**：主设备发什么，从机收什么；**从机永远不驱动 MISO**。
- **什么时候用**：从机只当「接收终端」——比如一块 MCU 只负责接收主设备下发的配置/数据、不回任何东西（配合主机的 Transmit Only Master）。实际工程里**少见**，多数从机会被要求「应答」点什么。

#### 3.5.7 Transmit Only Master（仅发送主模式）—— 纯写最顺手

- **配置**：`Mode = SPI_MODE_MASTER`，`Direction = SPI_DIRECTION_2LINES`——**和全双工同一份寄存器配置**（F1/F4 没有 TXONLY 位，见本节开头的 warning）。
- **引脚**：SCK + MOSI(发)。**MISO 不分配/不接**（被释放）。
- **行为**：只往 MOSI 写，从不读。**因为 MISO 没接、没有接收路径，也就不存在全双工「只发不收」的 OVR 溢出坑**——这是它相对「全双工只调 Transmit」的最大好处。
- **HAL 函数**：`HAL_SPI_Transmit`：

```c
/* 纯发：MISO 不接，只写 MOSI */
uint8_t data[8] = {0x55, 0xAA, 0x01, 0x02, 0x03, 0x04, 0x05, 0x06};
HAL_SPI_Transmit(&hspi1, data, 8, HAL_MAX_DELAY);
```

- **什么时候用**：**所有「单向写」外设**——74HC595 移位寄存器、WS2812 等 LED 灯带（用 SPI 协议模拟时序）、SPI DAC 写数据、往 Flash 发写命令、只写不读的传感器配置。**这类场景别用全双工，直接选 Transmit Only 最干净。**

#### 3.5.8 Transmit Only Slave（仅发送从模式）

- **配置**：`Mode = SPI_MODE_SLAVE`，`Direction = SPI_DIRECTION_2LINES`（同样无 TXONLY 位，和全双工从模式同配置）。
- **引脚**：SCK(入) + MISO(出)。**MOSI 不接**（从机不需要接收）。
- **行为**：主设备一打时钟，从机就把数据往 MISO 甩，**从不接收任何东西**。
- **什么时候用**：从机是「纯数据源」——被主设备点读就吐数据（配合主机的 Receive Only Master），比如一个只管上报数据的从设备。实际工程里**少见**，多数从机至少要接命令。

### 3.6 NSS 管理：硬件片选 vs 软件片选

CS/NSS 引脚有两种管理方式，`NSS` 字段配置：

| 方式 | HAL 配置 | 说明 |
| ---- | ---- | ---- |
| **软件片选** | `SPI_NSS_SOFT` | NSS 引脚**不作为外设控制**，用普通 GPIO 手动拉 CS |
| **硬件片选** | `SPI_NSS_HARD` | 外设自动控制 NSS 引脚（主模式下每帧自动拉低/拉高） |

工程上 **90% 都用软件片选**，原因：

- 多从机时每从一根 CS，外设硬件只管理一根，**一主多从必须用软件片选**（每个从机一个 GPIO）。
- 软件片选灵活：什么时候拉低、拉高完全自己控制，能精确控制「片选边界」（比如 Flash 的整个命令事务期间 CS 保持低）。
- **硬件片选 + 主模式**有个经典的坑：**MODF（模式错误）**——主模式下 NSS 被拉低（干扰或硬件管理不当）会触发 MODF 错误，外设直接停摆，需要先清错误再复位外设才能恢复。

!!! warning "软件片选也要注意时序"
    软件片选不是「随便拉一下就行」：**拉低 CS 后要给一小段建立时间（delay）再发时钟**，帧结束先等发送完成（`HAL_SPI_GetState` 回到 READY）再拉高 CS。很多「偶发读错」就是 CS 拉得太紧，从机还没准备好时钟就来了。

### 3.7 帧格式模式（Motorola vs TI）与高级特性

- **Motorola 帧格式**：默认，就是上面讲的 CPOL/CPHA 四种模式。
- **TI 模式**（`SPI_TIMODE_ENABLE`）：德州仪器的同步帧格式，带帧同步信号，**一般用不到**，遇到了再查手册。
- **CRC 计算**（部分 F4）：`CRCCalculation` 使能后收发帧尾带 CRC 校验字节，用于高可靠性链路（如电力/军工），普通应用不开。
- **菊花链（Daisy Chain）**：多个从机的 SDO 依次串起来连成一条数据链，靠**命令里带从机地址**区分，片选共用一根。适合「多片同型号、追求少引脚」的场景，**读写时序和普通多从机完全不同**，用到再单独学。

## 四、硬件 SPI 配置说明：CubeMX + HAL

### 4.1 CubeMX 页面（F4 为例，F1 类似）

`Connectivity → SPI1`，关键参数：

| 参数 | 说明 | 典型值 |
| ---- | ---- | ------ |
| **Mode** | 角色 + 方向：Full-Duplex Master / Slave、Half-Duplex、Transmit Only 等 | **Full-Duplex Master**（默认首选） |
| **Data Size** | 帧宽：8 Bits / 16 Bits | **8 Bits**（绝大多数从机） |
| **Clock Polarity (CPOL)** | 空闲电平：Low / High | 见从机手册，不确定先 Low（Mode 0） |
| **Clock Phase (CPHA)** | 采样沿：1 Edge / 2 Edge | 见从机手册，不确定先 1 Edge（Mode 0） |
| **NSS** | 片选管理：Software / Hardware | **Software**（默认，多从机必须） |
| **Baud Rate Prescaler** | 波特率预分频：2/4/8/…/256 | 按目标速率算（见 4.3） |
| **First Bit** | 字节序：MSB / LSB First | **MSB First**（默认） |
| **TI Mode** | TI 帧格式开关 | **Disable** |

在 **GPIO Settings** 确认引脚复用为 SPI 的 AF（F4 的 SPI1 是 PA5=SCK、PA6=MISO、PA7=MOSI，AF5），**速率设 High**（外设时钟分频后够用即可）。

### 4.2 HAL 初始化结构体逐字段

```c
SPI_HandleTypeDef hspi1;

hspi1.Instance               = SPI1;
hspi1.Init.Mode              = SPI_MODE_MASTER;        /* 主模式 */
hspi1.Init.Direction         = SPI_DIRECTION_2LINES;   /* 全双工：MOSI+MISO */
hspi1.Init.DataSize          = SPI_DATASIZE_8BIT;      /* 8 位帧 */
hspi1.Init.CLKPolarity       = SPI_POLARITY_LOW;       /* CPOL=0：空闲低 */
hspi1.Init.CLKPhase          = SPI_PHASE_1EDGE;        /* CPHA=0：第一个沿采样 → 合起来就是 Mode 0 */
hspi1.Init.NSS               = SPI_NSS_SOFT;           /* 软件片选，CS 自己用 GPIO 拉 */
hspi1.Init.BaudRatePrescaler = SPI_BAUDRATEPRESCALER_16; /* 分频 16，见 4.3 计算 */
hspi1.Init.FirstBit          = SPI_FIRSTBIT_MSB;       /* MSB 先行 */
hspi1.Init.TIMode            = SPI_TIMODE_DISABLE;     /* 不用 TI 帧格式 */
hspi1.Init.CRCCalculation    = SPI_CRCCALCULATION_DISABLE;
hspi1.Init.CRCPolynomial     = 7;
HAL_SPI_Init(&hspi1);
```

**换模式怎么改**（对照第三节）：

- 改 Mode 1/2/3 → 同时改 `CLKPolarity` 和 `CLKPhase` 两个字段（**只改一个 = 配错**）。
- 改 16 位帧 → `DataSize = SPI_DATASIZE_16BIT`，DMA 搬运宽度同步改。
- 改从机 → `Mode = SPI_MODE_SLAVE`，并注意 `Direction` 按从机角色配。

### 4.3 波特率计算：分频怎么定

```text
SCLK 目标 = 外设时钟 PCLK ÷ 预分频
预分频只能是 2 的幂：2、4、8、16、32、64、128、256
```

以 F4 为例（APB2 = 84MHz，SPI1 挂 APB2）：

| 预分频 | 实际 SCLK | 典型用途 |
| ---- | ---- | ---- |
| ÷2 | 42 Mbps | 高速 ADC / 高速 SRAM 从机 |
| ÷8 | 10.5 Mbps | W25Q SPI Flash 常见（~10M） |
| ÷16 | 5.25 Mbps | 常规传感器 / LCD |
| ÷64 | 1.31 Mbps | 低速、长线、抗干扰场景 |
| ÷256 | 328 kbps | 极慢、兼容老器件 |

**选法**：`预分频 ≥ PCLK ÷ 从机最高速率`，选**能覆盖目标速率、又比从机上限略低**的那一档。**别盲目拉最高**——速率越高对布线、电平、从机能力越敏感，多数 SPI 设备跑 5~20M 已经很快了。

### 4.4 三套收发接口：轮询 / 中断 / DMA

HAL 的 SPI 收发函数分三档，和 I2C 同构（这也是第五节 DMA 的入口）：

| 方式 | 发送 | 接收 | 全双工 |
| ---- | ---- | ---- | ---- |
| **轮询** | `HAL_SPI_Transmit` | `HAL_SPI_Receive` | `HAL_SPI_TransmitReceive` |
| **中断** | `HAL_SPI_Transmit_IT` | `HAL_SPI_Receive_IT` | `HAL_SPI_TransmitReceive_IT` |
| **DMA** | `HAL_SPI_Transmit_DMA` | `HAL_SPI_Receive_DMA` | `HAL_SPI_TransmitReceive_DMA` |

**注意 SPI 特有的**：全双工时优先用 `TransmitReceive`（一次调用同发同收），别「先发后收」两次调用——两次调用之间从机可能已经把数据发出来了，会丢数据或错位。读 Flash 的「发命令→收数据」必须在一个事务里用 `TransmitReceive` 串好。

## 五、DMA：把搬字节的活交给硬件

### 5.1 为什么要 DMA

SPI 的 CPU 开销比 I2C 好，因为**数据寄存器一次放一个字节**、硬件自动走时钟，但**每个字节仍要 CPU 搬一次**（写 TDR / 读 RDR）。当数据量大（几 KB 的 Flash 页、整屏 LCD 刷新、SD 卡读写）或 CPU 还要忙别的（电机控制、RTOS 调度）时，这个「每字节搬一次」的开销就不可忽视了。

**DMA（Direct Memory Access）** 是一条独立的搬运通道：CPU 只需告诉它「从哪搬到哪、搬多少」，剩下每字节的搬运全由 DMA 控制器在后台完成，**搬完才通知 CPU**。

> 一句话：**轮询是 CPU 亲自搬货，中断是 CPU 被叫去搬货，DMA 是雇了个搬运工（DMA 控制器）自己搬，搬完才喊你收货。**

### 5.2 HAL 的 DMA 收发流程

发送 DMA（内存 → SPI 外设数据寄存器）：

```c
/* 告诉 DMA 把 txData 的 len 个字节搬到 SPI 发送寄存器，返回后 CPU 立刻干别的 */
HAL_SPI_Transmit_DMA(&hspi1, txData, len);

/* 搬完，回调里收尾 */
void HAL_SPI_TxCpltCallback(SPI_HandleTypeDef *hspi) {
    /* 数据已全部发出：可以释放缓冲、置标志、或发起下一段 */
}
```

接收 DMA（SPI 外设数据寄存器 → 内存）：

```c
HAL_SPI_Receive_DMA(&hspi1, rxData, len);
void HAL_SPI_RxCpltCallback(SPI_HandleTypeDef *hspi) {
    /* rxData 里已有 len 个字节，直接使用 */
}
```

**全双工 DMA**（同时收发，最省 CPU 也最容易配错，见 5.4）：

```c
/* 一个事务里同发同收：TX 缓冲发出 len 个字节，同时 RX 缓冲收进 len 个字节 */
HAL_SPI_TransmitReceive_DMA(&hspi1, txData, rxData, len);
void HAL_SPI_TxRxCpltCallback(SPI_HandleTypeDef *hspi) {
    /* txData 发完、rxData 收满，一次搞定 */
}
```

**地址自增**：DMA 搬的时候，源/目的内存地址自动 +1（DMA 配置里的 Memory Increment），CPU 不用管。**搬完触发完成中断 → 回调**，中间 CPU 完全不介入。

### 5.3 CubeMX 里怎么开 DMA

在 CubeMX 中 **SPIx 页面 → DMA Settings** 添加通道：

| 通道 | 方向 | 说明 |
| ---- | ---- | ---- |
| **DMA x（TX）** | Memory → Peripheral | 发送：内存 → SPI 数据寄存器 |
| **DMA y（RX）** | Peripheral → Memory | 接收：SPI 数据寄存器 → 内存 |

- 只发不收 → 只加 TX 通道；只收不发 → 只加 RX 通道；**全双工 → 两个都要加**。
- **Mode 选 Normal**（默认），**Memory Increment 开**，Data Width 与帧宽对齐：8 位帧用 Byte，16 位帧用 Half Word。
- 勾上 DMA 的 **NVIC 中断**，生成代码后 `_DMA` 系列函数才能用。
- 全双工时，TX/RX 两个通道在 CubeMX 里**成对出现**，别漏了 RX——漏配 RX，`TransmitReceive_DMA` 会一直卡住或只发不收。

### 5.4 全双工 DMA 的「哑字节」技巧（读 Flash 必看）

SPI 读操作要「发哑字节喂时钟」才能收到数据（见 3.5）。用 DMA 做这件事有两种做法：

**做法 A：显式哑数组（简单直观）**

```c
static uint8_t dummy[64];          /* 哑数据：内容无所谓，用来喂时钟 */
uint8_t rx[64];
HAL_SPI_TransmitReceive_DMA(&hspi1, dummy, rx, 64);   /* 边发哑字节边收真数据 */
```

**做法 B：只开 RX、不开 TX**（F4 上 `Direction = 2LINES_RXONLY` 时 SCLK 照常走，硬件自动发空数据收真数据）——省一个 DMA 通道，但要求从机在「纯接收方向」下也接受。Flash 读数据阶段常用此法。

### 5.5 DMA 的坑与边界

- **DMA 回调里不要再开 DMA**：回调里调用下一个 `_DMA` 函数在 HAL 某些时序下会重入异常。改在主循环/任务里发起下一段，回调只置标志。
- **DMA 目标缓冲要常驻**：DMA 是「异步搬」，传入的 `txData`/`rxData` 必须是生命周期覆盖整个传输的变量（`static` 或全局或 RTOS 队列缓冲），**不能是函数栈上的局部变量**——函数返回了 DMA 还在搬，读到的就是悬空内存。这是 DMA 调试最经典的崩溃原因。
- **每次传输结束要等完成回调再改缓冲**：发送完但回调没来，`txData` 不能急着改写。
- **发送完要等 SPI 空闲再拉高 CS**：DMA 回调只是「数据搬完」，**最后一个字节可能还在硬件移位寄存器里**。要先等 `HAL_SPI_GetState(&hspi1) == HAL_SPI_STATE_READY`（发送真正结束）再拉高 CS，否则最后几个 bit 被 CS 截断——Flash 读回的数据尾部错位，就是这种「CS 拉太早」的典型症状。
- **DMA 不是所有量都值得**：几十字节以下的小数据，轮询/中断可能更快（省去 DMA 的配置开销）；**大量数据（KB 级 Flash 页、LCD 帧缓冲、SD 扇区）才明显受益**。

三档对比：

| 方式 | CPU 占用 | 实时性 | 适合量级 | 适合场景 |
| ---- | -------- | ------ | -------- | -------- |
| 轮询 | 最高（全程忙等） | 最差（被占用期间干不了别的） | 小、低频 | 初始化自检 |
| 中断 | 中（每字节被打断一次） | 好 | 中 | 日常收发 |
| DMA | **最低**（搬完才打断） | 好 | **大、高频** | 大块数据、RTOS 场景 |

## 六、避坑备忘

- **主从 CPOL/CPHA 必须一致**：Mode 0 与 Mode 3 各据一方，数据全错。确定模式先查从机 datasheet，不确定先用 Mode 0 试，不行再试 Mode 3。
- **读数据要发哑字节**：SPI 全双工，从机发 1 字节、主机必须同步发 1 字节（时钟才走）。读操作记得 `TransmitReceive` 或发 `0xFF` 哑数据。
- **全双工优先用 TransmitReceive**：别「先发后收」两次调用，中间会丢数据错位。命令+数据在一个事务里串好。
- **全双工里别「只发不收」**：全双工每拍必收，不读 RX 缓冲会 OVR 溢出卡通信。纯写场景选 **Transmit Only Master**（MISO 不接，无接收路径）。
- **Transmit Only 没有 TXONLY 位**：F1/F4 上「仅发送」= 全双工寄存器配置 + 不分配 MISO，别想在 `Direction` 里找个「仅发送」常量（只有 RXONLY）。
- **半双工要求对端也支持**：普通 4 线 SPI 从机（W25Q Flash 等）不能跑 1 线半双工；半双工切换方向要留 turnaround 时间，数据线接「主的 MOSI ↔ 从的 MISO」。
- **没被选中的从机 MISO 要三态**：多从机共总线时，不响应的从机 MISO 必须高阻，否则总线打架。换模块不工作先怀疑这个。
- **DMA 缓冲要常驻**：局部变量被 DMA 异步搬运 = 悬空指针崩溃。用 static/全局/队列缓冲。
- **DMA 发完等 SPI 空闲再拉 CS**：回调 ≠ 硬件发完，`HAL_SPI_GetState` 回到 READY 再动 CS，否则尾部 bit 被截断。
- **软件片选要留建立时间**：CS 拉低后 delay 一下再发时钟；帧结束等发送完成再拉高。偶发读错先查片选时序。
- **16 位帧配 DMA 用半字搬运**：帧宽与 DMA Data Width 对齐，配错数据错位。
- **硬件片选 + 主模式小心 MODF**：NSS 意外被拉低会触发模式错误、外设停摆，先清错误再复位（`HAL_SPI_DeInit` + `HAL_SPI_Init`）。多从机必须软件片选。
- **别盲目拉最高波特率**：速率越高越挑布线和从机，多数器件 5~20M 已经很快。从机手册上限是硬约束，取略低一档更稳。
- **阻塞调用别进中断**：`HAL_SPI_Transmit` 在中断里用会死锁（内部等 SysTick/HAL_Delay）。中断里用 `_IT`/`_DMA` 版本，或只置标志。
- **DMA 回调里别再开 DMA**：重入异常，改在主循环发起下一段。

## 参考

- 相关外设与裸机寄存器风格见 [peripheral-drivers.md](peripheral-drivers.md)
- 与 I2C 的通信机制对比见 [stm32-i2c.md](stm32-i2c.md)
- 寄存器级细节：对应参考手册 SPI 章节；F4 见 RM0385/RM0402 的 SPI 章节
- 深入协议：NXP/各大厂 SPI Block Guide；各从机 datasheet 的 SPI 时序章节（定 CPOL/CPHA、最高速率、片选要求）
