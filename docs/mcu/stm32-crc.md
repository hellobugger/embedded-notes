# STM32 CRC 硬件校验：从多项式到 DMA/协议落地的一篇讲透

> 一句话：**CRC 不是加密，而是用一个约定好的多项式给数据做快速差错检测**。要把 STM32 CRC 用对，必须同时对齐五个参数——**宽度、生成多项式、初始值、输入反射、输出反射/异或值**；任何一个不一致，发送端和接收端算出的结果都会不同。本文以 F1/F4 经典 32 位 CRC 外设为主，补充 F0/G0/G4/L4/H7 等系列可编程 CRC 的差异。

## 一、CRC 是什么，能解决什么问题

CRC（Cyclic Redundancy Check，循环冗余校验）把一段数据除以约定的生成多项式，取余数作为校验值。发送端把数据和 CRC 一起发出，接收端重新计算并比较：

```text
原始数据 ─→ CRC 计算 ─→ 附加校验值 ─→ 传输/存储
             │                         │
             └────────接收端重新计算 ←─┘
                         ↓
                 一致：未发现差错
                 不一致：数据可能损坏
```

CRC 的优点：

- 硬件实现速度快，适合通信帧、Flash 镜像和大量数据；
- 对单比特错误、突发错误有很好的检测能力；
- 只需要少量存储，不需要保存整段数据。

CRC 的边界也必须明确：

- **CRC 不是加密**：攻击者可以修改数据并重新计算 CRC；
- **CRC 不是数字签名**：不能证明数据来自可信发送者；
- **CRC 不是绝对正确**：存在碰撞，某些错误模式可能无法检测；
- 安全场景应使用 MAC、数字签名或安全启动机制，CRC 只做传输/存储完整性检查。

## 二、先解决最容易错的五个参数

### 2.1 CRC 参数表

一个 CRC 算法不能只写“CRC32”。完整描述至少包括：

| 参数 | 含义 | 常见例子 |
| ---- | ---- | -------- |
| `Width` | CRC 寄存器宽度 | 8、16、32 位 |
| `Poly` | 生成多项式，最高次项通常省略 | CRC-32/IEEE：`0x04C11DB7` |
| `Init` | 初始寄存器值 | CRC-32/IEEE：`0xFFFFFFFF` |
| `RefIn` | 每个输入字节是否按位反射 | `true/false` |
| `RefOut` | 最终结果是否反射 | `true/false` |
| `XorOut` | 输出前异或常量 | CRC-32/IEEE：`0xFFFFFFFF` |
| `Check` | 用字符串 `123456789` 验证实现的标准结果 | CRC-32/IEEE：`0xCBF43926` |

注意：STM32 某些经典 CRC 外设固定使用：

- 宽度 32 位；
- 多项式 `0x04C11DB7`；
- 初始值 `0xFFFFFFFF`；
- 输入按 32 位字处理；
- 不直接提供任意 `RefIn/RefOut/XorOut` 配置。

因此“STM32 CRC32”和“PC 工具的 CRC-32/IEEE”**不一定能直接对上**。必须明确数据分组、字节序和反射规则。

### 2.2 多项式到底是什么

以 CRC-32 为例，完整多项式是：

```text
x^32 + x^26 + x^23 + x^22 + x^16 + x^12 + x^11
+ x^10 + x^8 + x^7 + x^5 + x^2 + x + 1
```

工程代码通常省略最高次 `x^32`，写成 `0x04C11DB7`。如果采用右移实现，常见的反射形式是 `0xEDB88320`，这两个数描述的是同一族 CRC 的不同计算方向，不能混用。

!!! warning "`0x04C11DB7` 和 `0xEDB88320` 不是随便替换的两个常量"
    前者常用于 MSB-first（左移）算法，后者常用于 LSB-first（右移）算法。选择一个多项式后，还要同时确定移位方向、输入反射和输出反射。

## 三、STM32 CRC 外设的内部结构

经典 CRC 外设可以抽象为：

```text
输入数据寄存器 DR ─→ 32 位移位寄存器/多项式除法器 ─→ CRC 结果寄存器
       ↑                                      │
       └────────────复位/重新装载初值───────────┘
```

常见寄存器：

| 寄存器 | 作用 |
| ------ | ---- |
| `CRC_CR` | 复位 CRC 计算状态；部分系列还配置输入/输出数据格式 |
| `CRC_DR` | 写入数据、读取当前 CRC 结果 |
| `CRC_IDR` | 某些系列提供的 8 位独立寄存器，不参与 CRC 计算 |
| `CRC_POL` | 可编程多项式，较新系列提供 |
| `CRC_INIT` | 可编程初始值，较新系列提供 |
| `CRC_CFG` | 宽度、输入/输出反射等配置，较新系列提供 |

写入 `DR` 会推进内部 CRC 状态；读取 `DR` 得到当前余数。写入前复位一次，才能从约定的 `Init` 开始一段新的消息。

## 四、F1/F4 经典外设与新系列外设的差异

| 特性 | F1/F4 经典 CRC | 较新可编程 CRC（以具体系列为准） |
| ---- | -------------- | ------------------------------- |
| 宽度 | 通常固定 32 位 | 可选 7/8/16/32 位中的一种或多种 |
| 多项式 | 通常固定 `0x04C11DB7` | 可配置 |
| 初始值 | 通常固定 `0xFFFFFFFF` | 可配置 |
| 输入反射 | 通常固定/受数据写入方式影响 | 可配置 |
| 输出反射 | 通常不直接配置 | 可配置 |
| 输入数据格式 | 以 32/16/8 位写入行为决定 | 常有独立输入反射/格式字段 |
| 典型用途 | Flash 镜像、硬件唯一 CRC32 | 兼容 CRC-8/16/自定义协议 |

这张表只能作为方向，最终以**具体型号参考手册和 HAL 头文件**为准。即使都叫 STM32，F4、G4、H7 的 `CRC_HandleTypeDef.Init` 成员也可能不同。

## 五、CubeMX 配置：按步骤检查

### 5.1 经典 F1/F4

1. 启用 `CRC` 外设；
2. 确认 RCC 中 CRC 时钟已打开；
3. 生成 `MX_CRC_Init()`；
4. 在应用层先调用 `HAL_CRC_Calculate()` 或 `HAL_CRC_Accumulate()`；
5. 对照 PC 端脚本确认输入分组和结果。

典型 F4 初始化：

```c
CRC_HandleTypeDef hcrc;

void MX_CRC_Init(void)
{
    hcrc.Instance = CRC;
    if (HAL_CRC_Init(&hcrc) != HAL_OK) {
        Error_Handler();
    }
}
```

### 5.2 可编程 CRC

较新 HAL 可能出现如下配置成员：

```c
hcrc.Init.DefaultPolynomialUse    = DEFAULT_POLYNOMIAL_ENABLE;
hcrc.Init.DefaultInitValueUse     = DEFAULT_INIT_VALUE_ENABLE;
hcrc.Init.InputDataInversionMode  = CRC_INPUTDATA_INVERSION_NONE;
hcrc.Init.OutputDataInversionMode = CRC_OUTPUTDATA_INVERSION_DISABLE;
hcrc.Init.InputDataFormat         = CRC_INPUTDATA_FORMAT_BYTES;
```

也可能支持直接填写 `GeneratingPolynomial`、`InitValue`、`CRCLength`。这些成员是否存在、取值宏叫什么，必须以当前系列的 HAL 头文件为准。配置的关键不是照抄字段名，而是把协议参数完整映射到硬件。

## 六、HAL 计算方式：一次计算与连续累加

### 6.1 一次计算整段数据

经典 HAL 的函数通常接收 `uint32_t *` 和 word 数量：

```c
uint32_t crc32_calculate(const uint32_t *data, uint32_t words)
{
    return HAL_CRC_Calculate(&hcrc, (uint32_t *)data, words);
}
```

使用时要注意：`words` 是 **32 位数据项数量**，不是字节数。若数据长度是 16 字节，传入的数量是 4；长度不是 4 的倍数时，不能直接把剩余字节当成不存在。

### 6.2 分段数据使用 `HAL_CRC_Accumulate`

通信数据可能分成多个缓冲区，或 DMA 分段接收。此时第一段用 `Calculate`，后续段用 `Accumulate`：

```c
uint32_t crc = HAL_CRC_Calculate(&hcrc, first_words, first_count);
crc = HAL_CRC_Accumulate(&hcrc, next_words, next_count);
```

`Accumulate` 的含义是继续使用当前硬件状态，不是从初始值重新开始。每一帧开始前必须重新复位，否则上一帧的余数会污染下一帧。

```c
__HAL_CRC_DR_RESET(&hcrc);  /* 新帧开始前清状态，宏名依系列可能不同 */
```

### 6.3 直接寄存器操作

在确认具体芯片寄存器定义后，可以用寄存器级代码理解硬件行为：

```c
__HAL_RCC_CRC_CLK_ENABLE();
CRC->CR = CRC_CR_RESET;

for (uint32_t i = 0; i < words; ++i) {
    CRC->DR = data[i];
}

uint32_t result = CRC->DR;
```

寄存器级代码适合启动文件、极简驱动或问题定位；正式项目仍建议把时钟、复位、参数和错误处理封装在一个模块中。

## 七、最容易翻车的核心：字节序与输入宽度

### 7.1 `uint8_t` 数据不能随便强转成 `uint32_t *`

经典 HAL 接口通常按 32 位 word 写入 CRC。下面的写法只有在缓冲区对齐、长度正确、协议明确按 MCU 小端打包时才可靠：

```c
/* 只有 data 已按 32 位小端 word 准备好时才这样做 */
uint32_t crc = HAL_CRC_Calculate(&hcrc,
                                 (uint32_t *)data,
                                 byte_len / 4U);
```

如果原始协议是字节流，应先明确四个字节如何组成一个 word：

```c
static uint32_t pack_le32(const uint8_t *p)
{
    return ((uint32_t)p[0])
         | ((uint32_t)p[1] << 8)
         | ((uint32_t)p[2] << 16)
         | ((uint32_t)p[3] << 24);
}
```

网络协议常按大端书写，Flash 镜像工具又可能按文件字节顺序计算；“内存地址递增顺序”和“CRC 算法看到的 bit 顺序”是两个不同问题，必须用测试向量固定下来。

### 7.2 不满一个 word 的尾部怎么处理

有三种常见策略，必须和对端一致：

1. **协议长度固定为 4 的倍数**：最简单，直接按 word 计算；
2. **尾部补 0**：把最后 1~3 个字节补零后计算，并把“补零规则”写进协议；
3. **按字节输入**：使用支持 `CRC_INPUTDATA_FORMAT_BYTES` 的可编程 CRC，或自己把字节逐个送入兼容算法。

不能把一段 10 字节数据直接传给 word 接口并把 `10` 当数量，这会访问越界并产生完全错误的结果。

## 八、和通信帧结合：一个可落地的例子

假设帧格式为：

```text
| SOF | TYPE | LEN | PAYLOAD ... | CRC32 |
```

推荐流程：

1. 接收 `SOF/TYPE/LEN`，先检查长度范围；
2. 按 `LEN` 接收 Payload，防止越界；
3. 对协议规定的字段计算 CRC，不要误把 CRC 字段自身算进去；
4. 从帧尾按协议字节序读出收到的 CRC；
5. 比较计算结果和接收结果；
6. CRC 不一致时丢弃整帧并计数，不要把部分 Payload 交给业务层。

```c
bool frame_check(const uint8_t *frame, size_t frame_len)
{
    if (frame == NULL || frame_len < FRAME_OVERHEAD) {
        return false;
    }

    uint32_t expected = read_le32(&frame[frame_len - 4U]);
    uint32_t actual = crc32_protocol(frame, frame_len - 4U);
    return actual == expected;
}
```

如果使用 DMA 接收，CRC 计算通常放在“半传/全传”后的完整帧处理阶段；不要在 DMA 还可能改写的缓冲区上同时计算，除非已经设计好双缓冲或所有权转移。

## 九、Flash 镜像校验与启动流程

CRC 很适合启动时检查固件或参数区是否被电源波动、擦写中断破坏：

```text
Bootloader
   ↓
读取镜像头：长度、版本、期望 CRC
   ↓
检查长度是否在 Flash 分区范围内
   ↓
分块读取镜像并计算 CRC
   ↓
与镜像头的期望值比较
   ├─一致：跳转应用
   └─不一致：停留升级模式/回滚/报警
```

注意事项：

- CRC 字段要从计算范围中排除，或按协议规定把它置零后计算；
- 长度字段必须先做边界检查，不能相信镜像自身提供的超大长度；
- Flash 读取地址按芯片要求对齐；
- 如果 Bootloader 和 PC 工具使用不同 CRC 参数，升级包永远无法通过；
- CRC 只能检测偶然损坏，不能防止恶意篡改。需要防篡改时，再使用签名或 MAC。

## 十、软件参考实现与硬件交叉验证

建议在 PC 端保留一个简单、可信、可读的参考实现，用固定向量验证 STM32 配置。以非反射、左移 CRC-32 为例：

```c
uint32_t crc32_msb(const uint8_t *data, size_t len)
{
    uint32_t crc = 0xFFFFFFFFU;
    for (size_t i = 0; i < len; ++i) {
        crc ^= (uint32_t)data[i] << 24;
        for (int bit = 0; bit < 8; ++bit) {
            crc = (crc & 0x80000000U)
                ? (crc << 1) ^ 0x04C11DB7U
                : (crc << 1);
        }
    }
    return crc ^ 0xFFFFFFFFU;
}
```

这段代码只是展示参数含义，**不代表一定与某个 STM32 CRC 外设直接匹配**。验证顺序建议是：

1. 用标准测试字符串 `123456789` 得到参考结果；
2. 在 MCU 上计算同一组字节；
3. 用逻辑分析仪/串口日志打印每个中间分块结果；
4. 对比字节打包、反射、初值和最终异或；
5. 再用真实通信帧和边界长度测试。

## 十一、DMA、RTOS 与性能考虑

- 经典 CRC 外设常支持 DMA 写入 `DR`，适合大块数据；DMA 数据宽度要和 CRC 输入格式一致。
- DMA 计算完成并不代表 CPU 可以立即修改同一缓冲区；先处理缓存一致性和缓冲区所有权。
- Cortex-M7/H7 开启 D-Cache 时，DMA 读内存前要清理 Cache，DMA 写内存后要失效 Cache，否则 CRC 看到的可能不是最新数据。
- CRC 外设内部状态是全局资源。多个任务交替处理不同帧时，必须加锁，或由单独任务串行处理；不能任务 A 计算一半被任务 B 复位。
- CRC 计算通常比软件逐字节实现快，但启动、拷贝和锁开销对很短的帧可能更大。

## 十二、常见坑汇总

- **只说“CRC32”不写参数**：没有 Poly/Init/RefIn/RefOut/XorOut，别人无法复现。
- **把输入数量当字节数**：经典 HAL 的数量通常是 32 位 word 数量。
- **直接把任意 `uint8_t *` 强转成 `uint32_t *`**：可能未对齐、越界、字节序错误。
- **新帧不复位 CRC**：上一帧余数会污染当前帧。
- **把 `0x04C11DB7` 与 `0xEDB88320` 混用**：移位方向和反射约定必须配套。
- **尾部不足 4 字节未定义**：固定长度、补零或按字节输入三选一并写进协议。
- **把 CRC 当安全认证**：攻击者可以重算 CRC，不能防篡改。
- **DMA/Cache 不一致**：H7/F7 等带 Cache 的内核要维护 Cache 一致性。
- **计算范围包含 CRC 字段**：除非协议明确采用特殊残值校验，否则会导致结果错误。

## 参考

- 对应型号参考手册 **CRC 章节**：寄存器、复位、输入格式和 DMA 请求
- 对应型号 HAL 头文件：`stm32xxxx_hal_crc.h`，确认是否支持可编程多项式/反射/宽度
- CRC 参数命名可参考 Koopman/RevEng 等公开 CRC 参数资料，并用项目固定测试向量验证
- DMA 与 Cache 背景：对应 Cortex-M7/H7 系列参考手册与 CMSIS Cache API
- 时钟树背景见 [stm32-clock-tree.md](stm32-clock-tree.md)
