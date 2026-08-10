# CAN FD 进阶：FDCAN 控制器从协议到寄存器的一篇讲透

> 一句话：**CAN FD（CAN with Flexible Data-rate）是把经典 CAN 的「8 字节、1 Mbps 天花板」撬开的两件套**——数据场长度从 8 字节放宽到 **64 字节**（协议叫 FD），并允许数据场用**更高波特率**（灵活数据速率，也就是 FD 里的那个 F）。但这两个"开闸"不是免费午餐：CRC 换成了更长更严的 CRC17/CRC21 并覆盖填充位、DLC 变成 9~15 的非整字节编码、数据相位采样率拉高后对时序余量、同步和发送延时补偿（TDC）都提出了新要求。本文以 **STM32 FDCAN（H7 系、G0/G4 等）** 为主讲协议与 HAL，寄存器名以 HAL 为准，并会对照经典 CAN 说明"哪里不一样、为什么不一样"。

> 前提：经典 CAN 的通信机制、仲裁、错误帧、位定时基础见 [stm32-can.md](stm32-can.md)，本文默认你已经会用它，只讲 FD 增量，不重复老知识。

## 一、通信机制：一根线上混跑两种格式

CAN FD 的通信机制和经典 CAN **完全同构**：多主、广播、差分电平、ID 越小优先级越高的仲裁，全部不变。帧间的仲裁仍然在**标称（仲裁）速率**上进行。增量只有三点：

1. **新增一种帧格式（FD 帧）**，数据场更大、速率更快；
2. **FD 帧和经典帧可以在同一条总线上混跑**——靠帧里的 FDF 位区分，经典 CAN 控制器不认识 FD 帧，会报格式错误；所以**只有整条总线的节点都支持 FD 才真正能用上**，混跑时非 FD 节点会把 FD 帧当错误帧冲掉（见下节 FDF 位）；
3. **引入比特率切换（BRS）**，同一帧内数据场用高速率、其余仍走标称速率——这是 FD 能显著提高有效带宽但又能向后兼容仲裁的关键。

> 仲裁为什么必须留在标称速率？因为**仲裁是逐位竞争的**：两个节点在仲裁场同时发位，谁在某一时刻读到自己发的显性位被总线上的隐性位盖掉（对方 ID 更小），立刻退出。这件事要求所有节点用**同一个采样点、同样的位时序**在同一时刻"看"同一根线。仲裁场一旦提速，各节点的相位关系就散了，仲裁就不可靠。所以 FD 的设计是把**速度变化的位置**严格限定在仲裁结束之后。

## 二、数据帧与帧格式：FD 帧长什么样

FD 帧有**标准帧（11 位 ID）和扩展帧（29 位 ID）**两种，和经典 CAN 一样。关键区别在控制场：经典 CAN 的 RTR/IDE/r0/DLC 那一小段，FD 帧里换成了 `FDF + res + BRS + ESI + DLC`，DLC 从 4 位变成"编码"4 位，后面紧跟一个 `stuff count` 段，最后是更长的 CRC。

### 2.1 FD 标准帧逐字段拆解

```
    标称速率（仲裁速率）                    数据速率（ESI → CRC分隔位采样点）         标称速率
  SOF  ID(11) RTR IDE FDF res BRS ESI  DLC    Data(0~64B)  FSB  SC(3) 奇偶   CRC(17/21)  CRC分隔   ACK  EOF
 ┌───┐┌──────┐┌─┐┌─┐┌─┐┌───┐┌─┐┌─┐┌────┐┌──────────────┐┌───────┐┌──────────────┐┌──────┐┌───┐┌────┐
 │ 0 ││  ID  ││R││I││F││res││B││E││ DLC││  Data...      ││FSB+SC+P││CRC(含固定填充)││  1   ││ 1 ││ 7个│
 └───┘└──────┘└─┘└─┘└─┘└───┘└─┘└─┘└────┘└──────────────┘└───────┘└──────────────┘└──────┘└───┘└────┘
  1bit  11bit   1   1   1   1    1   1   4bit      0~64B        5bit        17/21bit     1bit   1+1  7bit
```

| 字段 | 长度 | 说明 |
| ---- | ---- | ---- |
| **SOF** | 1 位 | 起始位，显性 0，和经典 CAN 完全一样（所有同步的锚点） |
| **ID** | 11 / 29 位 | 标识符，越小优先级越高，仲裁依据 |
| **RTR** | 1 位 | FD 帧里**恒为显性 0**。FD 规范删掉了远程帧，此位改称 **RRS（Remote Request Substitution）**，固定显性 |
| **IDE** | 1 位 | 0 = 标准帧，1 = 扩展帧，与经典 CAN 相同 |
| **FDF** | 1 位 | FD 格式位：**隐性 1 = 这是 FD 帧**；显性 0 = 经典帧。**经典 CAN 控制器不识别这个隐性位，会把 FD 帧判为格式错误/位填充错误并发错误帧** |
| **res** | 1 位 | 保留位，**恒为显性 0** |
| **BRS** | 1 位 | 比特率切换：**1 = 数据场切换到数据速率**；0 = 整帧都走标称速率 |
| **ESI** | 1 位 | 错误状态指示：**0 = 发送方处于错误主动，1 = 错误被动**。接收方借此提前知道"这帧的来源节点状态不佳"，可作降级处理 |
| **DLC** | 4 位 | 长度编码，见 2.3 查表，不再是简单的 0~8 |
| **Data** | 0~64 字节 | 载荷 |
| **FSB + SC + P** | 5 位 | 固定填充位(1) + 填充位计数(3 位格雷码) + 奇偶位(1)，见 2.4 |
| **CRC** | 17 / 21 位 | 见 2.4，覆盖到填充计数段结束（含动态填充位），CRC 场内每 4 位插固定填充位 |
| **CRC 分隔位** | 1 位 | 隐性 1，数据相位在**它的采样点**结束、切回标称速率 |
| **ACK** | 2 位 | 同经典 CAN |
| **EOF** | 7 位 | 7 个隐性位 |

### 2.2 扩展 FD 帧：没有 RTR，但有 SRR

扩展帧的控制场开头和经典 CAN 一样：`ID(29) + SRR + IDE`，其中 **SRR 位恒为隐性 1**。因为 FD 帧没有远程帧，RTR 位被**整个省略**（扩展帧里直接是 SRR→IDE），后续字段（FDF → res → BRS → ESI → DLC）与标准帧一致。识别要点：扩展 FD 帧里**看不到 RTR 字段**，这是和经典扩展帧最直观的差异。

### 2.3 DLC：为什么 9~15 不是 9~15

经典 CAN 的 DLC 是"4 位二进制 = 字节数"，0~8 直接对应。FD 为了塞进 64 字节，DLC 只有 4 位（最大 15），于是定义了一张**查表**，只有 8 个有效档位：

| DLC | 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10 | 11 | 12 | 13 | 14 | 15 |
| --- | - | - | - | - | - | - | - | - | - | -- | -- | -- | -- | -- | -- | -- |
| 字节数 | 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | **12** | **16** | **20** | **24** | **32** | **48** | **64** |

也就是说 **DLC=9~15 对应的字节数分别是 12/16/20/24/32/48/64**。这是新手填 HAL 最常踩的坑：想发 64 字节，`DataLength` 填 64 是不行的，要填 `FDCAN_DLC_BYTES_64`。HAL 在 `fdcan_hal.h` 里把这张表做成了枚举：

```c
FDCAN_DLC_BYTES_0  ... FDCAN_DLC_BYTES_8,   /* 0~8 */
FDCAN_DLC_BYTES_12, FDCAN_DLC_BYTES_16,     /* 9~15 → 12/16/20/24/32/48/64 */
FDCAN_DLC_BYTES_20, FDCAN_DLC_BYTES_24,
FDCAN_DLC_BYTES_32, FDCAN_DLC_BYTES_48,
FDCAN_DLC_BYTES_64
```

> 工程提醒：**很多节点"只按 DLC 值"判断长度**，个别实现甚至只认 0~8。用 FD 时若和对端是第三方协议，务必确认对方支持 DLC≥9 的映射，否则会出现"我发了 12 字节，对方只读了 9 字节"的错位。

### 2.4 位填充与填充计数：FD 的 CRC 把填充位也盖进去了

FD 的动态填充规则和经典 CAN **一样**：从 SOF 到数据场结束，连续 5 个相同位就插入 1 个反相位（**动态填充**）。但数据场结束后，FD 多了一段"填充计数"，而且后面整个 CRC 的防错能力都变了：

1. **数据场结束后先插 1 位固定填充位（FSB）**：值为前一位的反相，保证进入填充计数段时一定有电平跳变；
2. **接着是 3 位 SC（Stuff Count）**：值是 SOF 到数据场结束插入的动态填充个数 **mod 8**，用**格雷码**编码；
3. **再跟 1 位奇偶位（P）**：对 3 位 SC 做**偶校验**（SC 中 1 的个数为偶数则 P=0）；
4. **CRC 场（17/21 位）内部每 4 位插一个固定填充位**，用于数据相位下保持时钟沿，这些固定填充位不参与 CRC 计算。

关键在**覆盖范围**：FD 的 **CRC 是从 SOF 一直算到填充计数段结束的**，**动态填充位全部算在 CRC 里**。于是接收方收到的 SC 一旦对不上、或某处填充位被破坏，CRC 就过不去——**填充位错误第一次能被 CRC 抓住**。

> 经典 CAN 有个理论盲区：**CRC 不覆盖填充位**，理论上存在"填充位错误恰好把 CRC 也绕过去"的极小概率漏检。FD 把 CRC 直接算到填充位头上，这个盲区被堵上了——这是 FD 敢提高速率和长度的底气之一。

### 2.5 CRC：17 位还是 21 位，看数据有多长

FD 用**两套 CRC 多项式**：

| 数据长度 | CRC 长度 | 备注 |
| -------- | -------- | ---- |
| ≤ 16 字节 | **CRC-17** | 覆盖 SOF 到填充计数段结束（含动态填充位） |
| 17~64 字节 | **CRC-21** | 同上 |

CRC-17/CRC-21 都是**多重进位多项式**（Hamming distance 高），加上"覆盖填充位"，漏检率比经典 15 位 CRC 低几个数量级。

### 2.6 帧格式对比速查

| | 经典 CAN 标准帧 | CAN FD 标准帧 | CAN FD 扩展帧 |
| --- | --- | --- | --- |
| ID | 11 位 | 11 位 | 29 位 |
| RTR | 有（区分数据/远程） | **恒 0，无远程帧** | 无（SRR→IDE） |
| FDF | 无 | 1（隐性） | 1（隐性） |
| BRS / ESI | 无 | 有 | 有 |
| DLC | 0~8 | 0~8 / 12~64 | 0~8 / 12~64 |
| 数据 | 0~8 B | 0~64 B | 0~64 B |
| 填充计数 | 无 | FSB+SC(3)+奇偶(1) | FSB+SC(3)+奇偶(1) |
| CRC | 15 位，不覆盖填充 | **17/21 位，覆盖填充**，场内每 4 位插固定填充 | 同左 |
| 最高速率 | ≤ 1 Mbps | 数据相位 ≤ 8 Mbps（典型 2~5） | 同左 |

## 三、比特率切换（BRS）与位定时：一帧两个速度

### 3.1 换挡点：哪里快、哪里慢、在哪切

FD 帧的速率切换完全由 **BRS 位**决定，只有**一处换挡**：

```
 标称速率 ──→ 数据速率 ────────────→ 标称速率
 SOF..BRS  BRS+ESI..CRC分隔位前   CRC分隔位..EOF
（仲裁、控制场）  （ESI 起到 CRC 前）   （分隔位、ACK、EOF）
```

| 位置 | 速率 | 说明 |
| ---- | ---- | ---- |
| SOF ~ BRS 位 | 标称 | 仲裁在这里完成，必须慢 |
| **BRS 位采样点** | 切到**数据** | 发送方与接收方都在 **BRS 位的采样点**切到数据采样率（即从 ESI 位开始走数据速率） |
| CRC 分隔位（前） | **数据** | 数据段一直持续到 CRC 分隔位的采样点 |
| CRC 分隔位采样点 | 切回**标称** | 在 CRC 分隔位的采样点切回 |
| ACK / EOF | 标称 | ACK 是所有节点都要应答的公共区域，必须统一慢速率 |

> 关键：**切换点之后，采样点百分比、甚至位时序参数都变了**。FDCAN 的标称相位和数据相位是**两套独立的 TQ 配置**（见第四节配置），接收方在数据相位用数据相位的 BS1/BS2 采样。

### 3.2 双速率位定时：两套 TQ，分开配

每一位仍然切成 TQ（见经典篇第四节），但 FDCAN 有**两个独立的波特率发生器**：

```text
标称波特率 = FDCAN_CLK / (标称Prescaler+1) / (1 + 标称BS1 + 标称BS2)
数据波特率 = FDCAN_CLK / (数据Prescaler+1) / (1 + 数据BS1 + 数据BS2)
```

两套参数完全独立，互不影响。**这也是 FD 节点必须和总线其余节点对齐两套参数的原因**——你标称配对了、数据配错了，仲裁没问题但数据场照样采错。

### 3.3 数据相位同步与 TDC：高速下的两个新问题

#### 数据相位也有自己的重同步

数据相位**确实做重同步**，但用的是**独立的 DSJW（数据相位同步跳转宽度）**。ISO 11898-1:2015 把标称相位和数据相位当成两套独立时钟，重同步规则各自生效——HAL 里 `DataSyncJumpWidth` 单独配置，注释明说就是用来"拉长/缩短一个数据位以执行重同步"。接收方在数据相位里仍靠**位的下降沿**做同步调整，DSJW 决定数据相位里一位能"掰"多少。

这和很多人记忆的"数据相位不做重同步"恰恰相反。但要理解 FD 为什么敢这么干：数据相位里**没有仲裁**，只有单个发送方在说话，接收方只要跟上发送方的时钟即可，不需要"多个节点同时在同一位上竞争"，所以重同步的负担比仲裁相位小得多。

工程推论：**FD 节点的晶振精度要求仍比经典 CAN 高**——数据相位每比特 TQ 数少（典型 4~10 个 TQ），时钟漂移的容忍窗口更窄；DSJW 要配得合理，太大容易误同步。

#### 发送延时补偿（TDC）：发送方自己的采样陷阱

有个经典 CAN 不存在的坑：**发送方在数据相位回读自己发的位时，信号经过收发器 TX→总线→RX 的环路延时**（t 环路 = 收发器 + 线缆 + 比较器），导致发送方读到的自己的位比真实到达总线的时刻**晚了环路延时**。数据相位速率高、每比特 TQ 少，这段固定延时折算成"几个 TQ 的偏移"就越致命——发送方可能在"自读自检"（位错误检测）上误判。

**TDC（Transmitter Delay Compensation，发送延时补偿）就是专门解决这个的**：

1. 发送 SOF 时测一次实际环路延时（收到自己的 SOF 隐性→显性沿的延时），记作实测值 t；
2. 定义**次级采样点 SSP = t + TDCO（TDC 偏移，以 mtq 计）**；
3. 数据相位发送期间，发送方**不在固定采样点判断位错误，而是在 SSP 判断**；SSP 必须落在 **TDCF（TDC 窗口）** 内才生效。

HAL 里对应 `HAL_FDCAN_ConfigTxDelayCompensation(hfdcan, TdcFilter, TdcOffset)`（第一个参数是 TDC 窗口，第二个才是偏移），以及 `HAL_FDCAN_EnableTxDelayCompensation` / `HAL_FDCAN_DisableTxDelayCompensation`；实测延时值经 `HAL_FDCAN_GetProtocolStatus` 读回（协议状态里有 TDCV 字段）。

**阈值是工程经验，不是 ISO 硬性数值**。ISO 的实际判据是"数据位时间 vs 发送器环路延时"：当数据位时间 ≤ 1 µs（即数据速率 ≥ 1 Mbps）就需要 TDC；Linux m_can 驱动按数据速率 **> 2.5 Mbps** 才启用 TDC。工程上建议：**数据速率 2 Mbps 起就开 TDC，5 Mbps 基本必须**——高了不开，大概率是"自己发的位自己读错"的典型故障（发送频繁报位错误、但示波器上波形明明是好的）。

## 四、错误检测：五层防护之上多了一层

经典 CAN 的五层检测（位填充、CRC、位错误、应答、格式）FD **全部保留**，且关键防护做了升级：

| 检测层 | 经典 CAN | CAN FD | 变化 |
| ------ | -------- | ------ | ---- |
| 位填充错误 | 连续 6 个相同位 | 同左，但**填充位参与 CRC 校验**，检测更严 | ⬆️ |
| CRC | 15 位，不覆盖填充 | **17/21 位，覆盖动态填充位**，场内固定填充 | ⬆️ |
| 位错误 | 发送方对比发送/监听 | 同左；**数据相位靠 TDC + SSP 判断** | ⬆️ 要求高 |
| 应答错误 | ACK 槽收不到显性 | 同左 | = |
| 格式错误 | 固定位不符 | 同左，固定位还多了一个 **res 必须为 0** | = |

错误状态机（错误主动/错误被动/Bus-Off）和经典 CAN **完全一致**，靠 TEC/REC 计数，见经典篇第六节。FD 的额外福利是 **ESI 位**：发送方在错误被动时置 ESI=1，接收方在帧头就能看到"这个来源处于错误被动"，可以做降级处理——比如对它来的数据标记"可靠性降级"。

## 五、Bus-Off 恢复：协议慢恢复为主，且要软件配合

Bus-Off 的判定标准和经典 CAN 相同：**TEC ≥ 256 进入 Bus-Off**。恢复机制和 bxCAN 有一个关键差别，必须分清控制器：

| 控制器 | Bus-Off 恢复方式 |
| ------ | ---------------- |
| **bxCAN（F1/F4）** | `AutoBusOffManagement` 勾选 = **硬件自动恢复**（检测到总线空闲就自行完成整段恢复），不勾 = 协议慢恢复（数满 128 次 11 隐性位） |
| **FDCAN（H7/G0/G4 等）** | **只有协议慢恢复，且需要软件配合**：进 Bus-Off 后硬件自动置 `CCCR.INIT`；**软件必须清 INIT 位**才启动恢复等待（连续观测 128 次 × 11 个隐性位，ST 实现按 129 次计）。该等待**不能被置/清 INIT 缩短**，恢复时长由协议固定 |

> 一句话：**FDCAN 没有 bxCAN 那样的"ABOM 一键快恢复"**。想"快"只能靠软件：检测到 Bus-Off 后，要么清 INIT 让硬件按协议等满 128/129 个隐性位（慢恢复、对总线友好，安全关键场景首选），要么干脆 `HAL_FDCAN_Start` 重新初始化来快速重入（相当于跳过等待，调试/工业现场可用，但总线还在抖动时可能刚恢复又被踢下去）。选择逻辑和经典篇第六节一致。

**检测 Bus-Off 的两条路**：

```c
/* 1. 中断通知：错误状态变化时查询 Bus-Off 标志 */
void HAL_FDCAN_ErrorStatusCallback(FDCAN_HandleTypeDef *hfdcan) {
    /* 在回调里用 HAL_FDCAN_GetError 看 HAL_FDCAN_ERROR_BUS_OFF，
       或直接读协议状态寄存器确认 */
}

/* 2. 主动查询协议状态寄存器 */
FDCAN_ProtocolStatusTypeDef ps;
HAL_FDCAN_GetProtocolStatus(hfdcan, &ps);
if (ps.BusOff == 1) { /* 处于 Bus-Off：清 INIT 前先想好恢复策略 */ }
```

## 六、配置说明：CubeMX + HAL

FDCAN 的配置比 bxCAN 多出**一整组数据相位参数**、**滤波器数量翻倍**、**中断线变成两条**，值得单独讲。

### 6.1 CubeMX 页面

FDCAN 的配置页把位时序拆成两大块：**Nominal（标称）** 和 **Data（数据）**：

| 参数 | 说明 | 典型值 |
| ---- | ---- | ------ |
| **Nominal Prescaler** | 标称波特率预分频 | 按标称波特率算 |
| **Nominal Time Quanta in Bit Segment 1/2** | 标称 BS1/BS2 | 采样点 ~80% |
| **Nominal ReSynchronization Jump Width** | 标称 SJW | 1~4 |
| **Data Prescaler** | 数据波特率预分频 | 按数据波特率算 |
| **Data Time Quanta in Bit Segment 1/2** | 数据 BS1/BS2 | 采样点 ~75% |
| **Data ReSynchronization Jump Width** | 数据 SJW | 按需（数据相位**也有重同步**，DSJW 独立配置，见 3.3） |
| **Frame Format** | `Classic CAN / FD without BRS / FD with BRS` | `FD with BRS` |
| **Std Filters Nbr / Ext Filters Nbr** | 标准帧滤波器数 / 扩展帧滤波器数 | 按需（见 6.3） |
| **Rx FIFO0/1 Elements Nbr** | 接收 FIFO 元素数 | 默认即可 |
| **Tx Events Nbr** | 发送事件 FIFO 深度 | 默认即可 |
| **Tx Fifo/Queue Mode** | 发送 FIFO / 队列模式 | FIFO |
| **Auto Bus-Off Management** | **FDCAN 无此项**：Bus-Off 需软件清 INIT 配合（见第五节） | — |
| **TDC** | 发送延时补偿开关（`EnableTxDelayCompensation`） | **数据速率 ≥ 2 Mbps 必开** |

CubeMX 页面下方同样实时显示 **Nominal BiT Rate / Data BiT Rate / Nominal Sample Point / Data Sample Point**。

**一个能跑通的配置实例**（H743，FDCAN 时钟 = PCLK1 = 100 MHz）：
```text
标称：Prescaler=5 → TQ = 5 / 100M = 50ns，1bit = 20 TQ → 1 Mbps
      采样点 = (1 + 15) / 20 = 80%（BS1=15，BS2=4）
数据：Prescaler=1 → TQ = 10ns，1bit = 10 TQ → 10 Mbps
      采样点 = (1 + 7) / 10 = 80%（BS1=7，BS2=2）   ← 10 Mbps 需要 TDC
```
实际工程中 10 Mbps 对线缆/收发器要求高，**常用的稳配置是 1 Mbps / 5 Mbps 或 500k / 2 Mbps 组合**，5 Mbps 配 TDC。

### 6.2 初始化与启动（HAL）

```c
FDCAN_HandleTypeDef hfdcan1;

hfdcan1.Instance = FDCAN1;
hfdcan1.Init.ClockDivider          = FDCAN_CLOCK_DIV1;
hfdcan1.Init.FrameFormat           = FDCAN_FRAME_FD_BRS;      /* FD + 比特率切换 */
hfdcan1.Init.Mode                  = FDCAN_MODE_NORMAL;
hfdcan1.Init.AutoRetransmission    = ENABLE;
hfdcan1.Init.TransmitPause         = DISABLE;
hfdcan1.Init.ProtocolException     = DISABLE;

/* 标称相位（仲裁） */
hfdcan1.Init.NominalPrescaler      = 5;
hfdcan1.Init.NominalSyncJumpWidth  = FDCAN_SJW_4TQ;
hfdcan1.Init.NominalTimeSeg1       = FDCAN_BS1_15TQ;
hfdcan1.Init.NominalTimeSeg2       = FDCAN_BS2_4TQ;

/* 数据相位 */
hfdcan1.Init.DataPrescaler         = 1;
hfdcan1.Init.DataSyncJumpWidth     = FDCAN_DATA_SJW_1TQ;
hfdcan1.Init.DataTimeSeg1          = FDCAN_DATA_BS1_7TQ;
hfdcan1.Init.DataTimeSeg2          = FDCAN_DATA_BS2_2TQ;

hfdcan1.Init.StdFiltersNbr         = 1;
hfdcan1.Init.ExtFiltersNbr         = 0;
hfdcan1.Init.TxFifoQueueMode       = FDCAN_TX_FIFO_OPERATION;
hfdcan1.Init.TxEventsNbr           = 2;
hfdcan1.Init.RxFifo0ElmtsNbr       = 3;
hfdcan1.Init.RxFifo0ElmtSize       = FDCAN_DATA_BYTES_8;
hfdcan1.Init.RxFifo1ElmtsNbr       = 3;
hfdcan1.Init.RxFifo1ElmtSize       = FDCAN_DATA_BYTES_8;
HAL_FDCAN_Init(&hfdcan1);

/* 中断线分配（Init 结构里没有 MaxInterruptLines 字段，用这个函数配） */
HAL_FDCAN_ConfigInterruptLines(&hfdcan1, 0, FDCAN_IT_RX_FIFO0_NEW_MESSAGE); /* 例：FIFO0 事件挂到中断线 0 */

/* 数据速率 ≥ 2 Mbps：开 TDC */
HAL_FDCAN_ConfigTxDelayCompensation(&hfdcan1, tdcFilter, tdcOffset); /* tdcFilter=TDCF窗口，tdcOffset=TDCO */
HAL_FDCAN_EnableTxDelayCompensation(&hfdcan1);
```

**启动顺序（FDCAN 比 bxCAN 严格）**：`HAL_FDCAN_Init` → 配置滤波器/中断线/通知/延时补偿 → **`HAL_FDCAN_Start`** → **`HAL_FDCAN_ActivateNotification`**。注意：**先 Start 再激活通知**——顺序反了接收中断可能不触发（或中断在启动完成前就进来了），这是 FDCAN 新手的头号坑。想发 64 字节的帧，`RxFifo0ElmtSize` 也要配成 `FDCAN_DATA_BYTES_64`，否则 HAL 校验会失败。

> TDC 自动模式：`HAL_FDCAN_EnableTxDelayCompensation` 会把硬件置成自动测量环路延时，实测值（TDCV）经 `HAL_FDCAN_GetProtocolStatus` 读回。想验证延时是否符合预期，读这个值对照即可。

### 6.3 滤波器：标准帧/扩展帧分开配

FDCAN 的滤波器比 bxCAN 多且灵活：**标准帧滤波器（STD Filter Elements）** 和 **扩展帧滤波器（EXT Filter Elements）** 分开计数、分开配置，总数由芯片决定（H7 通常 128 个标准 + 64 个扩展）。每个滤波器有三种**类型**和三种**行为**：

```c
FDCAN_FilterTypeDef f;
f.IdType       = FDCAN_STANDARD_ID;        /* 标准帧 */
f.FilterIndex  = 0;                        /* 第 0 个标准帧滤波器 */
f.FilterType   = FDCAN_FILTER_RANGE;       /* 类型：范围 / 双ID / 掩码 */
f.FilterConfig = FDCAN_ACCEPT_IN_RX_FIFO0; /* 行为：接收进 FIFO0 / FIFO1 / 拒收 */
f.FilterID1    = 0x100;                    /* 范围起点 */
f.FilterID2    = 0x10F;                    /* 范围终点 */
HAL_FDCAN_ConfigFilter(&hfdcan1, &f);
```

| FilterType | 含义 |
| ---------- | ---- |
| `FDCAN_FILTER_RANGE` | FilterID1 ≤ ID ≤ FilterID2 都收（一段连续 ID） |
| `FDCAN_FILTER_DUAL` | 只收 FilterID1 或 FilterID2 两个 ID |
| `FDCAN_FILTER_MASK` | 掩码模式，FilterID1=ID，FilterID2=掩码（1 必须匹配） |

| FilterConfig | 行为 |
| ------------ | ---- |
| `FDCAN_ACCEPT_IN_RX_FIFO0` | 匹配进 FIFO0 |
| `FDCAN_ACCEPT_IN_RX_FIFO1` | 匹配进 FIFO1 |
| `FDCAN_REJECT` | 直接拒收（黑名单） |

### 6.4 发送 / 接收的中断与回调

#### 中断线与回调名

每个 FDCAN 有**两条中断线 IT0 / IT1**（NVIC 里勾 `FDCAN1_IT0` / `FDCAN1_IT1`），可用**滤波器和事件**把不同来源的中断分开挂到不同线上。HAL 用 `HAL_FDCAN_ActivateNotification` 统一使能，回调名与 bxCAN 不同：

| 事件 | 回调 |
| ---- | ---- |
| FIFO0 收到新报文 | `HAL_FDCAN_RxFifo0Callback` |
| FIFO1 收到新报文 | `HAL_FDCAN_RxFifo1Callback` |
| 发送 FIFO/队列中一帧完成 | `HAL_FDCAN_TxBufferCompleteCallback` |
| 发送事件 FIFO 写入 | `HAL_FDCAN_TxEventFifoCallback` |
| 错误状态变化（含 Bus-Off） | `HAL_FDCAN_ErrorStatusCallback` |

> 注意：**FDCAN 没有 bxCAN 那种 `TxMailbox0CompleteCallback` 邮箱回调，也没有独立的 `BusOffCallback`**。Bus-Off 状态通过 `HAL_FDCAN_ErrorStatusCallback` + 错误标志 `HAL_FDCAN_ERROR_BUS_OFF` 上报；发送完成按 Tx FIFO/队列元素粒度走 `HAL_FDCAN_TxBufferCompleteCallback`。

#### 接收中断流程

FDCAN 的接收走 **RX FIFO0/1**（每 FIFO 可配 1~32 个元素，元素大小也可配），中断回调里同样只做"取出 + 搬运 + 置标志"：

```c
void HAL_FDCAN_RxFifo0Callback(FDCAN_HandleTypeDef *hfdcan, uint32_t RxFifo0ItPends) {
    static FDCAN_RxHeaderTypeDef rxHeader;
    static uint8_t rxData[64];
    if (HAL_FDCAN_GetRxMessage(hfdcan, FDCAN_RX_FIFO0, &rxHeader, rxData) == HAL_OK) {
        /* 取走成功：搬进应用队列 / 置标志。不要在中断里做重活 */
    }
}
```

关键区别：**经典 CAN 的 FIFO 每 FIFO 只有 3 个邮箱；FDCAN 的 RX FIFO 深度可配（1~32 个元素）**，还能配大元素承载 64 字节帧。但中断里取慢了照样溢出（`HAL_FDCAN_ERROR_FIFO0_OVF`），黄金法则不变。

#### 发送中断流程

FDCAN 的发送机制比 bxCAN 丰富：**Tx FIFO / Tx Queue / 专用发送邮箱**三种模式（`TxFifoQueueMode` 选择 FIFO 或 Queue）。中断模式下 `HAL_FDCAN_AddMessageToTxFifoQ` 填入后立即返回，完成回调里收尾：

```c
FDCAN_TxHeaderTypeDef txHeader;
txHeader.Identifier   = 0x123;
txHeader.IdType       = FDCAN_STANDARD_ID;
txHeader.TxFrameType  = FDCAN_DATA_FRAME;
txHeader.DataLength   = FDCAN_DLC_BYTES_64;   /* 64 字节：用枚举，不是 64 */
txHeader.FDFormat     = FDCAN_FD_CAN;          /* FD 帧 */
txHeader.BitRateSwitch = FDCAN_BRS_ON;         /* 数据场走数据速率 */
txHeader.ErrorStateIndicator = FDCAN_ESI_ACTIVE;
txHeader.TxEventFifoControl = FDCAN_NO_TX_EVENTS;

uint8_t txData[64] = {0};
HAL_FDCAN_AddMessageToTxFifoQ(&hfdcan1, &txHeader, txData); /* 入队即返回，不阻塞 */

/* 发送完成回调：一帧从 Tx FIFO/队列发出 */
void HAL_FDCAN_TxBufferCompleteCallback(FDCAN_HandleTypeDef *hfdcan, uint32_t BufferIndexes) {
    /* 释放报文资源 / 记录已发送 */
}
```

> 与经典篇一样的告诫：不要在发送完成回调里再 `HAL_FDCAN_AddMessageToTxFifoQ` 发下一帧，避免 HAL 内部重入问题；高频周期发送仍建议"主循环填队列 + 回调收尾"的套路。

## 七、避坑备忘（FD 专属）

- **DLC 不是字节数**：64 字节填 `FDCAN_DLC_BYTES_64`，不是 64；接收侧解析也用枚举/查表，别拿 DLC 值直接当长度。
- **两套位时序都要对**：FDCAN 标称/数据是独立配置。只调标称、数据没调，仲裁正常但数据场全错。对端节点必须两套参数一致。
- **FDCAN 没有 ABOM**：Bus-Off 恢复靠硬件协议等待，但**必须软件清 INIT 才启动**；没有 bxCAN 那种"检测到空闲就自动恢复"的开关。别按 bxCAN 的习惯找 "Auto Bus-Off" 配置项。
- **数据相位有独立的 DSJW**：数据相位也做重同步，用 `DataSyncJumpWidth` 单独配，不是"数据相位不做重同步"。
- **数据速率 ≥ 2 Mbps 必开 TDC**（工程经验，非 ISO 硬性值）：用 `HAL_FDCAN_EnableTxDelayCompensation`，否则"自己发的位自己读错"——发送频繁报位错误但示波器波形正常，先怀疑 TDC。
- **先 Start 再 ActivateNotification**：顺序反了接收中断不触发，这是 FDCAN 启动的头号坑。
- **接收 64 字节帧要把 RxFifo0ElmtSize 配成 `FDCAN_DATA_BYTES_64`**，否则 HAL 初始化/接收校验不过。
- **混跑注意非 FD 节点**：总线上只要有一个经典 CAN 节点，FD 帧就会被它当错误帧冲掉。上 FD 前先确认整条总线的节点能力。
- **扩展 FD 帧没有 RTR**：别按经典扩展帧的字段顺序想当然地找 RTR 位。
- **发送事件的坑**：要拿发送时间戳（Tx Event），`TxEventFifoControl` 得配 `FDCAN_STORE_TX_EVENTS` 且 `TxEventsNbr` > 0，否则事件 FIFO 是空的。

## 参考

- 经典 CAN 基础：见 [stm32-can.md](stm32-can.md)（通信机制、仲裁、五层错误检测、位定时、bxCAN 中断）
- 协议规范：ISO 11898-1:2015（CAN FD 基础）、ISO 11898-1:2024（含 CAN FD Light 等更新）、Bosch CAN FD 规范
- 控制器手册：对应 STM32 参考手册的 FDCAN 章节（如 RM0433 的 FDCAN）、ST 应用笔记 AN5348（FDCAN 使用与调试）
- HAL 头文件：`fdcan_hal.h`（Init/Filter/Notification/TDC 的所有枚举与函数原型）
