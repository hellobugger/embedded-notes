# STM32 FSMC：把外设当作内存来读写的并行总线

> 一句话：**FSMC（Flexible Static Memory Controller，可变静态存储控制器）是 STM32 片上的一台「并行总线小主机」**——它把一块 CPU 直接可寻址的地址空间（0x60000000 起）映射成一组片选（NE）+ 读写（NOE/NWE）+ 地址（FSMC_A）+ 数据（FSMC_D）信号，接上 SRAM、NOR Flash、NAND、甚至「长得像 SRAM 的屏」，然后 **CPU 的指针读写 = 外设的读写**，连配置好以后一句 `*(uint16_t*)0x60020000 = x` 就能完成一次外设访问。本文以 F1/F4 的 FSMC 为主，寄存器名与配置以 HAL 为准，并说明 F4/F1 的时序差异、H7 上的换代名字 FMC。

> 想先用再深挖？看 [第三、四节](#三-接一块并行-sram-从零配到读写) 的完整 SRAM 实例、[第六节](#六-nor-flash-完整示例-读-id-擦除-编程-回读) 的 NOR Flash 示例与 [第七节](#七-典型用法-接-lcd-屏-并口屏的核心套路) 的 LCD/FPGA 应用方案。

## 一、FSMC 是什么、为什么要有它

CPU 和外设打交道，本质都是「**地址 → 读写 → 数据**」三件事。FSMC 的作用是把这三件事**做成内存接口**：CPU 访问某个地址区间，FSMC 硬件自动把它翻译成并行的片选/读/写时序，**期间 CPU 完全不用管时序**，跟读写普通变量一模一样。这是它和 GPIO 模拟并口、以及 I2C/SPI 这类串行总线的根本区别。

| 方案 | 速度 | 接线 | CPU 负担 | 适合 |
| ---- | ---- | ---- | -------- | ---- |
| **FSMC 并口** | 最快（几 ns ~ 几十 ns 一个周期） | 十几根线 | **几乎为零**（指针访问即完成） | 大带宽、大吞吐：LCD 屏、外部 SRAM、FPGA/CPLD 寄存器 |
| **GPIO 模拟并口** | 慢（每条信号软件拉，几十条指令一个周期） | 同上 | 高（每条信号都占 CPU） | 早期简单屏、无 FSMC 的小芯片 |
| **SPI** | 中等 | 4 根线 | 低（但要字节协议开销） | 小屏、Flash、传感器 |
| **I2C** | 最慢 | 2 根线 | 低 | 小数据量、多从机 |

**为什么常用 LCD 接 FSMC 而不是 SPI**：一块 320×240、每像素 16 位色、要 60fps 刷的屏，每秒数据量 = 320×240×2×60 ≈ **9.2 MB/s**。SPI 顶多十几 MHz，一个像素就要 2 个字节挨个推；FSMC 并口一个写周期就出 2 字节，配上 DMA 几乎不占 CPU，带宽差一个量级。

## 二、FSMC 长什么样、地址是怎么分片的

FSMC 挂在 AHB 总线上，占用了 CPU 从 **0x60000000** 开始的一块地址空间。它把这块空间按「类型」切成 4 个大区（Bank），每个大区又按片选切成子区：

### 2.1 Bank 划分与片选（NE）

| 大区 | 类型 | 子区（片选） | 基址 | 容量 |
| ---- | ---- | ---- | ---- | ---- |
| **Bank 1** | **NOR / PSRAM / SRAM** | NE1 | **0x6000_0000** | 64 MB |
| | | NE2 | 0x6400_0000 | 64 MB |
| | | NE3 | 0x6800_0000 | 64 MB |
| | | NE4 | 0x6C00_0000 | 64 MB |
| **Bank 2** | NAND Flash | NCE2 | 0x7000_0000 | 64 MB |
| **Bank 3** | NAND Flash | NCE3 | 0x8000_0000 | 64 MB |
| **Bank 4** | PC Card | NCE4 | 0x9000_0000 | 64 MB |

每个片选**只占一个固定地址区间**。硬件上，NE1 引脚接谁，谁就在 0x6000_0000 这个区间里被寻址。所以「接哪根片选」决定了这块外设的地址起点，而**在一个片选区间内，最低位地址线就对应外设的寄存器/字节**（见 2.2）。

### 2.2 HADDR 与 FSMC_A 的对应（8 位 vs 16 位数据总线）

FSMC 外部地址线的编号 **不直接等于** CPU 的地址线编号，关键看数据总线宽度：

- **16 位数据总线**（最常用，SRAM、并口 LCD 基本都是）：CPU 的 `HADDR[1]` 接到外设的地址线 `A0`，`HADDR[2]`→`A1`…即 **`FSMC_A[i] = HADDR[i+1]`**。因为 16 位访问一次读 2 字节，字节地址总是偶对齐，最低位（HADDR[0]）自然没用了，被 FSMC 吃掉。
- **8 位数据总线**：`FSMC_A[i] = HADDR[i]`，直接一一对应。

**这带来一个常用的「地址步进」结论**：用 16 位总线的 SRAM，从地址 0 开始写数据，地址每 +2 才落到下一个 16 位单元；从地址 0 开始**递增访问偶数地址**（0, 2, 4...），得到的是**连续的 16 位单元**。反过来说，如果某个外设的「寄存器选择」需要一根地址线 A0 来区分命令/数据（见第七节 ILI9341 例子），那**在 16 位总线下访问寄存器地址必须 +2**，才能翻动这根 A0。

### 2.3 FSMC 信号（Bank1 NOR/PSRAM 控制器）

| 信号 | 方向 | 作用 |
| ---- | ---- | ---- |
| **NE1~NE4** | 出 | 片选（Chip Select），低有效，选中对应地址区间 |
| **NOE** | 出 | 读使能（Output Enable / RD），低有效，读时拉低 |
| **NWE** | 出 | 写使能（Write Enable），低有效，写时拉低 |
| **FSMC_A[25:0]** | 出 | 地址总线 |
| **FSMC_D[15:0]** | 双向 | 数据总线 |
| **NBL0/NBL1** | 出 | 字节使能（Byte Lane，16 位总线下可选高/低字节） |
| **NADV** | 出 | 地址锁存信号（分时复用模式用，异步 SRAM 一般不用） |
| **NWAIT** | 入 | 慢速外设插入等待（同步模式用） |

> **FSMC 全自动**：地址落在哪个片选区、什么时候拉 NE/NOE/NWE、周期多长，全由 FSMC 硬件按配置的时序寄存器自动产生——**CPU 不知道、也不需要知道**这些引脚的抖动，它只负责发一个「读/写这个地址」的总线事务。

## 三、时序：FSMC 的三个时间旋钮（读/写都靠它）

FSMC 的一个访问周期，被切成**地址建立（ADDSET）→ 数据阶段（DATAST）→ 地址保持（ADDHLD）** 三段。三段都按 **HCLK（AHB 时钟，F1 是 72MHz，F4 是 168MHz）** 的整数倍配置：

```
           |<-- ADDSET -->|<------ DATAST ------>|<- ADDHLD ->|
  地址线    ──────────────┐                        ┌──────────
                        └─── 地址有效 ────────────┘
  NE(片选)  ──────────────┐                        ┌──────────
                        └──── 有效 ───────────────┘
  NOE/NWE  ───────────────┐                        ┌──────────
                          └──── 读/写脉冲 ────────┘
  数据线    ──────────────────── 有效数据 ───────────────────
```

三段分别对应外设数据手册里的哪些参数，这是**整个 FSMC 配置唯一的难点**，也是新手最容易配错的地方：

| 段 | 决定什么 | 对应对端 SRAM 参数 |
| ---- | ---- | ---- |
| **ADDSET** | 地址先于读写脉冲建立的时间 | 地址建立时间 tAS（Address Setup） |
| **DATAST** | 读写脉冲的宽度（核心时间） | 写脉冲宽度 tWP / 读访问时间 tRC、tDOE |
| **ADDHLD** | 读写结束后地址保持的时间 | 地址保持时间 tAH / 数据保持时间 tDH |

**换算公式（记住这一个就够）**，单位是 HCLK 周期数：

```text
读周期   = (ADDSET + DATAST + ADDHLD) × HCLK   ≥ 对端 tRC（读循环时间）
写周期   = (ADDSET + DATAST + ADDHLD) × HCLK   ≥ 对端 tWC（写循环时间）
DATAST 尤其要保证：  DATAST × HCLK ≥ tWP（写脉冲）/ tAA + 内部建立余量（读访问）
```

> 注意：**F4 在 `FSMC_BCR1` 里把 ADDHLD 与 ADDSET 合并成一个 `ADDSET` 字段**（时序寄存器 `FSMC_BTR1` 用 ADDSET[3:0] 表示，省略了独立 ADDHLD），F4 的时序靠 `ADDSET + DATAST` 两个值。**F1 的 `FSMC_TCR1` 才有独立的 `ADDHLD`**。CubeMX 里的字段名（`Address setup time` / `Address hold time` / `Data setup time`）是通用的，它会按芯片自动映射，所以**手算公式以「你用的那个芯片的参考手册时序图」为准**——F1 查 RM0008、F4 查 RM0090，这点在 CubeMX 生成代码里一对照就清楚了。

### 3.1 一个完整的算例（F1 @72MHz 配 55ns SRAM）

假设接一片 IS62WV51216（55ns 的 16 位 SRAM），关键参数：tRC/tWC = 55ns、tWP = 45ns、地址建立 tAS ≥ 0、地址保持 tAH ≥ 0。F1 的 HCLK = 72MHz，一个 HCLK = **13.9ns**：

```text
ADDSET：对端 tAS≥0，给 1 个 HCLK 就够（13.9ns，留余量）→ ADDSET = 1
DATAST：要满足 tWP≥45ns 和 tRC≥55ns
        45ns ÷ 13.9ns = 3.24 → 向上取整 4 个 HCLK（55.6ns）→ DATAST = 4
ADDHLD：对端 tAH≥0，给 1 个 HCLK → ADDHLD = 1
总周期 = (1 + 4 + 1) × 13.9 = 83ns ≥ 55ns ✓
```

> 经验法则：**宁可多给、不要少给**。多一个 HCLK 只是慢几十 ns（对这个 SRAM 的带宽毫无影响），少一个 HCLK 直接读错数据、写不进去。先按对端数据手册算一遍，再适当**加 1~2 个 HCLK 做余量**，是调试 SRAM/LCD 时最快的稳法。LCD 这类外设对时序的敏感度通常比 SRAM 还低，**默认给的 ADDSET=15、DATAST=15 大多能点亮**，只是偏慢而已。

## 四、接一块并行 SRAM：从零配到读写

以 F4（HCLK=168MHz）+ IS62WV51216（512K×16 = 1MB SRAM）为例，挂在 **NE1**，地址从 0x60000000 开始。

### 4.1 CubeMX 配置

`FSMC → NOR/SRAM Memory 1` 勾选，关键参数：

| 参数 | 值 | 说明 |
| ---- | ---- | ---- |
| **Memory type** | SRAM | 最通用 |
| **Data bus width** | 16 bit | 本片是 16 位（8 位时注意 2.2 的地址映射） |
| **Write operation** | Enable | 要能写 |
| **Extended mode** | Disable | 不开的话读写共用一套时序 |
| **Address setup time** | 1 | HCLK 数（对端 tAS） |
| **Address hold time** | 1 | HCLK 数（对端 tAH，F1 才有独立项） |
| **Data setup time** | 4 | HCLK 数（对端 tWP/tRC） |
| **Read/write timing mode** | Mode A | 最标准的异步 SRAM 模式 |

> `Mode A` 对应 SRAM 最经典的读/写波形：读时 NOE 拉低、写时 NWE 拉低，地址和片选全程有效。其他模式（Mode B/C/D、分时复用、同步突发）各有适用场景，初学**只记 Mode A** 即可，绝大多数 SRAM/LCD 都吃这一套。

### 4.2 HAL 代码

```c
/* 片选结构体 */
SRAM_HandleTypeDef hsram;
FMC_NORSRAM_TimingTypeDef timing = {0};

/* 片选配置 */
hsram.Instance = FMC_NORSRAM_DEVICE;           /* F4 用 FMC 前缀；F1 是 FSMC_NORSRAM_DEVICE */
hsram.Extended = FMC_NORSRAM_EXTENDED_DEVICE;  /* 不开扩展模式就指向空结构体 */

hsram.Init.DataAddressMux = FMC_DATA_ADDRESS_MUX_DISABLE;  /* 地址/数据不分时复用 */
hsram.Init.MemoryType     = FMC_MEMORY_TYPE_SRAM;
hsram.Init.MemoryDataWidth = FMC_NORSRAM_MEM_BUS_WIDTH_16;
hsram.Init.BurstAccessMode = FMC_BURST_ACCESS_MODE_DISABLE;
hsram.Init.WaitSignalPolarity = FMC_WAIT_SIGNAL_POLARITY_LOW;
hsram.Init.WrapMode      = FMC_WRAP_MODE_DISABLE;
hsram.Init.WaitSignalActive = FMC_WAIT_TIMING_BEFORE_ACCESS;
hsram.Init.WriteOperation = FMC_WRITE_OPERATION_ENABLE;
hsram.Init.ReadWriteTiming = &timing;
hsram.Init.WriteTiming     = &timing;          /* 不开扩展模式，读写共用 timing */

/* 时序：ADDSET=1、ADDHLD=1、DATAST=4（F4 合并后是 ADDSET+ADDHLD 一起给） */
timing.AddressSetupTime = 1;                   /* 地址建立 + 地址保持合并字段（F4） */
timing.DataSetupTime    = 4;                   /* 数据阶段（读/写脉冲） */
/* F1 单独多了 AddressHoldTime 成员；H7 的 FMC 命名类似 F4 */

HAL_SRAM_Init(&hsram, &timing, NULL);
```

> 勾了 `Extended mode` 时，读用 `ReadWriteTiming`、写用 `WriteTiming` 两套独立时序，适合对端读写速度不对称的芯片（NOR Flash 读快写慢）。没把握就**别开**，读写共用一套最省事。

### 4.3 读写验证：先点亮再谈优化

```c
#define SRAM_BASE  0x60000000u                 /* NE1 片选基址 */

void sram_test(void)
{
    uint16_t *ram = (uint16_t *)SRAM_BASE;

    /* 写一个已知值，读回比对——最简单的自检 */
    ram[0]   = 0xA55A;                         /* 第一个 16 位单元（地址 0） */
    ram[100] = 0x1234;                         /* 第 100 个 16 位单元（地址 200） */

    if (ram[0] == 0xA55A && ram[100] == 0x1234) {
        /* 通：地址线/数据线/时序都基本对 */
    } else {
        /* 不通：多半是时序太紧或地址线/数据线接错 */
    }

    /* 回环测一遍全片：把所有单元填 0x0000 再写 0xFFFF，确认数据线都工作 */
    uint32_t i;
    for (i = 0; i < 0x20000; i++) ram[i] = 0x0000;
    for (i = 0; i < 0x20000; i++) if (ram[i] != 0x0000) break;   /* 没走到这就说明有单元写不进 */
    for (i = 0; i < 0x20000; i++) ram[i] = 0xFFFF;
    for (i = 0; i < 0x20000; i++) if (ram[i] != 0xFFFF) break;
}
```

**第一步一定要先做「写一个值读回来」**，通了再跑全片回环。全片回环测的是：**数据线有没有接错位**（用 0x5555/0xAAAA 交替写能查出 D0~D15 哪根短路/接反）、**地址线有没有接错位**（写 A、读 A+1 能查 HADDR 移位）。这步过了，硬件接线才算真正验证过。

## 五、读写在内存里长什么样：寄存器模型

FSMC 的 Bank1 支持 NOR Flash、PSRAM、SRAM、ROM 四种。对一个 NOR Flash，它的访问**可以映射成「寄存器模型」**——NOR 里有「命令/地址/数据」三类操作，FSMC 把不同的地址区间当不同的「寄存器」来写，这就是 NOR 编程/擦除的基础：

```c
#define NOR_BASE   0x60000000u                 /* NE1 */
#define NOR_CMD    0x60000000u                 /* 命令寄存器地址 */
#define NOR_ADDR   0x60000000u + 0x2           /* 地址寄存器（16 位总线，每步 +2） */
#define NOR_DATA   0x60000000u + 0x4           /* 数据寄存器 */

/* 写一个 NOR 命令序列（解锁→命令→地址→数据）本质就是连续几次指针写 */
*(volatile uint16_t *)NOR_CMD  = 0x00AA;       /* 解锁 1 */
*(volatile uint16_t *)NOR_CMD  = 0x0055;       /* 解锁 2 */
*(volatile uint16_t *)NOR_CMD  = 0x0090;       /* 读 ID 命令 */
```

**重点**：FSMC 对「地址空间」没有感情，它只负责「把地址翻译成管脚时序」。至于某个地址代表命令还是数据，**完全由外设自己定**——这就是为什么「把外设当内存」是一种万能思路：只要外设定义好「地址 → 功能」的映射，FSMC 就能驱动。NAND 也一样（它按「页 + 命令/地址/数据 分时复用」，见第八节）。

!!! warning "上面的宏只是「概念示意」，不是真实 NOR 的用法"
    真正的 NOR Flash 没有「寄存器地址」这个概念。读写数据时它就是**一块普通内存**（按 FSMC 基址直接指针读写），「命令/地址/数据寄存器」的区分是通过**往特定地址写特定命令序列**（JEDEC 解锁 + 命令码）实现的，完整的真实用法见 [第六节](#六-nor-flash-完整示例-读-id-擦除-编程-回读)。

## 六、NOR Flash 完整示例：读 ID、擦除、编程、回读

上一节的「寄存器模型」只是概念。真正的并行 NOR Flash（S29AL016D、S29GL128P、AM29 系等，几乎全是 **AMD/JEDEC 兼容**的一套命令）工作方式完全不同：

- **读数据 = 直接指针读**，NOR 就是一块普通只读内存；
- **写数据 ≠ 指针写**：编程/擦除要**先发一组「解锁 + 命令码」**，芯片进入内部操作（内部编程/擦除耗时几十 µs 到几百 ms），期间必须**轮询 DQ7/DQ6 等完成**，完事后自动回到读模式。

所以驱动 NOR 的核心就是三件事：**发对命令序列**、**等对完成状态**、**回读验证**。下面按这个顺序给完整代码。

### 6.1 FSMC 配置：NOR 用扩展模式，读写独立时序

NOR 读慢写快（命令写周期短），比 SRAM 更适合**扩展模式**（读/写两套时序）。以 F4 命名、挂 NE1 为例（F1 把 `FMC_` 换成 `FSMC_`）：

```c
static void FSMC_NOR_Init(void)
{
    SRAM_HandleTypeDef hsram;                       /* HAL 里 NOR/SRAM 共用这一个句柄类型 */
    FMC_NORSRAM_TimingTypeDef read_timing  = {0};
    FMC_NORSRAM_TimingTypeDef write_timing = {0};

    hsram.Instance   = FMC_NORSRAM_DEVICE;
    hsram.Extended   = FMC_NORSRAM_EXTENDED_DEVICE; /* 扩展模式：读写独立时序 */
    hsram.Init.DataAddressMux  = FMC_DATA_ADDRESS_MUX_DISABLE;
    hsram.Init.MemoryType      = FMC_MEMORY_TYPE_NOR;
    hsram.Init.MemoryDataWidth = FMC_NORSRAM_MEM_BUS_WIDTH_16;
    hsram.Init.BurstAccessMode = FMC_BURST_ACCESS_MODE_DISABLE;
    hsram.Init.WaitSignalPolarity = FMC_WAIT_SIGNAL_POLARITY_LOW;
    hsram.Init.WrapMode        = FMC_WRAP_MODE_DISABLE;
    hsram.Init.WaitSignalActive = FMC_WAIT_TIMING_BEFORE_ACCESS;
    hsram.Init.WriteOperation  = FMC_WRITE_OPERATION_ENABLE;

    /* 读时序：要盖住 NOR 的 tRC/tAA（90~110ns 常见）。
       F1 @72MHz，13.9ns/周期：ADDSET=2、DATAST=8 → (2+8)×13.9 ≈ 139ns ✓ */
    read_timing.AddressSetupTime = 2;
    read_timing.DataSetupTime    = 8;

    /* 写时序：命令写只需 tWP，够短 */
    write_timing.AddressSetupTime = 2;
    write_timing.DataSetupTime    = 4;

    HAL_SRAM_Init(&hsram, &read_timing, &write_timing);
    /* F4 @168MHz：同样 90ns NOR 要更多周期，5.95ns/周期 → 读 DATAST 取 14~16 */
}
```

时序还是那句老话：**先按慢的给、宁慢勿快**。NOR 读本身就不是高速外设，时序放宽没有代价。

### 6.2 地址与命令宏

16 位总线 + 16 位 NOR：**命令地址按数据手册的字节地址写（0x555 / 0x2AA），不要自己移位**——FSMC 在 16 位模式下已经把 HADDR 右移了一位（见 2.2），示例里写 0x555 会自动落到 NOR 的字地址 0x2AA，正好是 AMD/JEDEC 命令要的解锁地址。数据访问则用「字地址 ×2」的宏，方便按字编址。

```c
#define NOR_BASE       0x60000000u                       /* NE1 片选基址 */
#define NOR_CMD(off)   (*(volatile uint16_t *)(NOR_BASE + (off)))         /* 命令序列，off 为字节偏移 */
#define NOR_WORD(off)  (*(volatile uint16_t *)(NOR_BASE + ((off) << 1)))  /* 数据访问，off 为字地址 */

/* 命令码（AMD/JEDEC 兼容件通用） */
#define NOR_CMD_READ_ID      0x90
#define NOR_CMD_READ_RESET   0xF0
#define NOR_CMD_ERASE        0x80
#define NOR_CMD_SECTOR_ERASE 0x30
#define NOR_CMD_CHIP_ERASE   0x10
#define NOR_CMD_PROGRAM      0xA0

/* 两段式解锁（每个命令序列前的"敲门"） */
static void NOR_Unlock(void)
{
    NOR_CMD(0x555) = 0xAA;
    NOR_CMD(0x2AA) = 0x55;
}
```

!!! warning "0x555 是奇地址，为什么能跑"
    `*(uint16_t*)0x60000555` 是非对齐访问。**M3/M4（F1/F4）硬件支持非对齐 16 位访问**，所以示例能跑；FSMC 16 位模式下地址 bit0 本来就被忽略，改成偶地址 `0x554` 效果完全一样。**用 M0/M0+ 等不支持非对齐的核时，把命令地址全改成偶数**（0x554 / 0x2AA）。

### 6.3 完成检测：DQ7/DQ6 轮询

编程/擦除期间芯片内部忙，**读目标地址返回的是状态位，不是数据**。等完有两种办法，DQ6 翻转对编程和擦除通用：

```c
/* 等到目标地址读到两次 DQ6 相同 = 内部操作结束（加超时防死循环） */
static uint8_t NOR_WaitBusy(uint32_t word_addr)
{
    uint16_t a, b;
    uint32_t cnt = 0;
    do {
        a = NOR_WORD(word_addr);
        b = NOR_WORD(word_addr);
        if (++cnt > 0xFFFFFFu) return 1;   /* 超时：器件没响应，多半接线/时序问题 */
    } while ((a ^ b) & 0x0040u);           /* DQ6（bit6）两次不同 = 还在忙 */
    return 0;
}
```

### 6.4 读 ID：第一个必做的自检

读 ID 能一次性验证**接线、地址换算、时序**三件事——ID 读得对，后面的擦写才有意义：

```c
static void NOR_ReadID(uint16_t *manuf, uint16_t *dev)
{
    NOR_Unlock();
    NOR_CMD(0x555) = NOR_CMD_READ_ID;      /* 进入 ID 读模式 */
    *manuf = NOR_WORD(0x0000);             /* 字地址 0x0000 = 厂商码 */
    *dev   = NOR_WORD(0x0001);             /* 字地址 0x0001 = 设备码 */
    /* 退出 ID 模式，回读模式 */
    NOR_Unlock();
    NOR_CMD(0x555) = NOR_CMD_READ_RESET;
}

/* 用法：S29AL016D 应读到 manuf=0x0001（AMD/Spansion），dev=0x2249（查你芯片手册）
   读出的值不对 → 先别急着擦写，查接线（尤其 A0~A12、D0~D15）、再放宽读时序 */
```

### 6.5 擦除 + 编程 + 回读（完整流程）

```c
/* 擦除一个扇区：sector_addr 为字地址。S29AL016D 常规扇区 64K 字（128KB），boot 扇区小 */
static uint8_t NOR_SectorErase(uint32_t sector_addr)
{
    NOR_Unlock();
    NOR_CMD(0x555) = NOR_CMD_ERASE;        /* 进入擦除命令组 */
    NOR_Unlock();
    NOR_WORD(sector_addr) = NOR_CMD_SECTOR_ERASE;   /* 目标扇区写 0x30 */
    return NOR_WaitBusy(sector_addr);      /* 在扇区内轮询完成（典型几十 ms） */
}

/* 编程一个字：word_addr 为字地址。编程前该位置必须是 0xFFFF（已擦除） */
static uint8_t NOR_ProgramWord(uint32_t word_addr, uint16_t data)
{
    NOR_Unlock();
    NOR_CMD(0x555) = NOR_CMD_PROGRAM;      /* 编程命令 */
    NOR_WORD(word_addr) = data;            /* 这一个写周期把数据送进去，芯片开始内部编程 */
    return NOR_WaitBusy(word_addr);        /* 典型 ~7~10µs 一个字 */
}

/* 完整演示：读 ID → 擦除 → 编程 → 回读验证 */
void NOR_Demo(void)
{
    uint16_t manuf, dev;

    /* 1. 读 ID：地址/接线/时序验证（先做这一步！） */
    NOR_ReadID(&manuf, &dev);
    /* manuf=0x0001、dev=查手册 —— 对不上就停，别往下走 */

    /* 2. 擦除字地址 0x00000 起的扇区，并验证已擦成 0xFFFF */
    if (NOR_SectorErase(0x00000u)) { /* 擦除超时 */ }
    if (NOR_WORD(0x00000u) != 0xFFFFu || NOR_WORD(0x00001u) != 0xFFFFu) {
        /* 擦除失败：仍读不出 0xFFFF */
    }

    /* 3. 编程三个字，逐字回读验证 */
    if (NOR_ProgramWord(0x00000u, 0x1234)) { /* 编程超时 */ }
    if (NOR_ProgramWord(0x00001u, 0xA5A5)) { /* 编程超时 */ }
    if (NOR_ProgramWord(0x00002u, 0x5A5A)) { /* 编程超时 */ }

    if (NOR_WORD(0x00000u) != 0x1234u) { /* 回读不符：编程失败 */ }
    if (NOR_WORD(0x00001u) != 0xA5A5u) { /* 回读不符：编程失败 */ }
    if (NOR_WORD(0x00002u) != 0x5A5Au) { /* 回读不符：编程失败 */ }

    /* 到这里全过 = FSMC 时序、命令序列、完成检测三件事全对 */
}
```

### 6.6 NOR 擦写避坑备忘

- **写之前必须先擦除**：Flash 只能 1→0，往非 0xFFFF 的位置写数据 = 数据错。**同一地址不能连续编程两次**，除非重新擦除。
- **读 ID 是第一道关**：ID 读错，九成是接线/地址换算/时序问题，别急着怀疑芯片。ID 对了再擦写。
- **命令地址不要自己 ×2**：FSMC 16 位模式已把 HADDR 右移一位，直接按手册写 0x555/0x2AA（M0 系改偶数 0x554 更稳）。
- **编程/擦除期间别读该地址当数据**：读回来的是 DQ7/DQ6 状态位，必须等 `NOR_WaitBusy` 结束。
- **别从这片 NOR 里执行代码时擦它**：代码 XIP 运行时擦掉所在扇区 = 当场 HardFault。存数据用固定扇区，别和代码区重叠。
- **擦除很慢是正常的**：全片擦除动辄几秒，扇区擦除几十 ms，轮询期间 CPU 干别的活即可（但别同时给同一颗 NOR 发别的命令）。
- **芯片有写保护锁**：部分型号（S29GL 系等）上电后扇区锁定，要先按手册解锁，否则擦写"没反应"。
- **时序继续沿用「宁慢勿快」**：擦写失败先放宽读时序的 `DataSetupTime`，别一上来就怀疑芯片。


## 七、典型用法：接 LCD 屏（并口屏的核心套路）

并口 TFT LCD（ILI9341、ST7735 等）接 FSMC 是**最典型的应用**，也最能让新手感受到 FSMC 的价值。它的接线和时序跟 SRAM 几乎一样，唯一区别是**多了根「命令/数据选择」线**：

### 7.1 信号映射

并口屏的 `RS`（Register Select / DCX，选择命令还是数据）在 FSMC 接法里**接到一根地址线**（通常用 FSMC_A16），FSMC 把「命令地址」和「数据地址」做成两个相邻区间：

| 屏引脚 | 接到 | 说明 |
| ---- | ---- | ---- |
| **RS / DCX** | **FSMC_A16** | 区分命令（A16=0）与数据（A16=1） |
| **CS** | NE1 | 片选 |
| **WR** | NWE | 写使能 |
| **RD** | NOE | 读使能（读屏寄存器/显存用） |
| **DB[15:0]** | FSMC_D[15:0] | 16 位数据总线 |
| **RST** | GPIO | 复位（一般独立 GPIO 控制） |

### 7.2 关键：命令地址与数据地址的关系

用 16 位总线 + A16 做 RS，那么：

```text
命令地址 = 0x6000_0000 + (0 << 16) = 0x6000_0000     (A16=0 → 屏当它是命令)
数据地址 = 0x6000_0000 + (1 << 16) = 0x6001_0000     (A16=1 → 屏当它是数据)
```

> **为什么地址差 0x10000**：A16 在第 16 位，置 1 就是 +0x10000。而 16 位总线按 2.2 的规则，FSMC_A16 对应 **HADDR[17]**，所以**真正访问数据寄存器要 +0x20000**。以哪个为准，看你怎么定义宏——**经验上：直接按「FSMC_A 的编号」算**（A16 就 +0x10000）最不易错，因为底层 HADDR 的移位已经由 FSMC 处理，你对屏的编程模型只关心「地址线第几位翻了」。

```c
#define LCD_REG  *(volatile uint16_t *)0x60000000u    /* 命令 */
#define LCD_RAM  *(volatile uint16_t *)0x60010000u    /* 数据 */

/* 写一个命令，再写它的参数/数据 */
void LCD_WriteReg(uint8_t reg, uint16_t val) {
    LCD_REG = reg;      /* A16=0，屏认为来了条命令 */
    LCD_RAM = val;      /* A16=1，屏认为来了条数据 */
}
```

**写显存、刷屏就是不停地 `LCD_RAM = pixel`**，配一个 DMA 把显存数组整个搬过去，CPU 几乎不参与——这就是 FSMC 屏能 60fps 刷的底气。

### 7.3 刷屏数据量估算

```text
320×240 屏，16 位色，一帧 = 320×240×2 = 153,600 字节 ≈ 150KB
60fps → 每秒 9.2 MB
FSMC 一个写周期按 5 个 HCLK ≈ 30ns（F4 @168MHz）→ 约 33 MB/s
一条总线撑得住，CPU 还几乎不占——换成 SPI 早就卡成幻灯片
```

> **注意 8 位屏 / 16 位总线不匹配**：屏数据口是 8 位（DB[7:0]）而 FSMC 配 16 位时，要么把屏只接低 8 位（浪费一半带宽）、要么改 FSMC 为 8 位数据宽度（地址映射按 8 位走）。**别把 8 位屏直接挂 16 位总线**，否则每次访问 2 字节、屏只认低 8 位，地址对不齐、读到的数据错位。

## 八、NAND 与 NOR：FSMC 的另一半本事

Bank2/3/4 的 NAND/PC Card 控制器，和 Bank1 的 NOR/PSRAM 控制器**结构不同**：

| | Bank1（NOR/PSRAM/SRAM） | Bank2/3/4（NAND） |
| ---- | ---- | ---- |
| 地址线 | 连续地址映射（每个地址对应一个存储单元） | **分时复用**：地址总线在**不同阶段**轮流送「命令、地址、数据」 |
| 寻址方式 | 指针读写（地址=单元） | 要**往命令寄存器写命令、往地址寄存器写地址**，再读/写数据寄存器 |
| 时序 | 按对端手册设 ADDSET/DATAST | 有独立的 `FSMC_PCRx`、`FSMC_PMEMx`、`FSMC_PATTx` 寄存器 |

NAND 没有「地址即单元」的线性映射，因为它按**页**（如 2KB/页）和**块**（如 128 页/块）组织，读一页要「先发读命令 → 发页地址 → 读数据」，坏块还要跳过。**STM32 片上的 NAND 控制器只负责搬数据和产生时序，坏块管理、ECC、FTL（闪存转换层）都得自己在软件里写**，这也是为什么绝大多数项目里 NAND 都靠外部 Flash 芯片或干脆用 W25Q 这类 SPI NOR 的原因——**NOR 简单、NAND 麻烦**。FSMC 驱动 NAND 的实际场景远少于 SRAM/LCD。

## 九、FSMC 的「坑」与调试指南

### 9.1 时序太紧，读错写不进

**症状**：读到的值偶尔错、写 0xA5 读回 0xA0、屏花屏但不死机。**处理**：把 `DataSetupTime`（DATAST）往上加 2~4 个 HCLK 再试。**时序宁可慢不可快**，这是 FSMC 调试第一条。

### 9.2 地址线/数据线接错位

**症状**：写 A 读 A 对，写 A 读 A+1 才对的「错位」现象。**处理**：回想 2.2——**16 位总线下 FSMC_A0 接的是 HADDR[1]**。PCB 上如果按「A0 对 A0」直接接，就等于把地址错了一位。数据线同理，D0~D15 有一根接反/接错，全片数据都错。

### 9.3 片选没选对，读写死等

**症状**：HAL 初始化后一访问就 HardFault、或读到的全是 0xFF/0x00。**处理**：核对**外设接的是 NE1 还是 NE2/3/4**，基址要对应（见 2.1 表）。**基址写错一个片选区间，FSMC 照样产生时序，但片选信号根本没拉低那个外设**——它收到的是一堆没有 CS 的无效读写，结果要么全 0xFF、要么根本没反应。

### 9.4 时钟没开 / 复用没配

**症状**：FSMC 引脚无波形。**处理**：CubeMX 里 FSMC 相关的 GPIO 要配成 **AF12（F4 的 FSMC 复用功能）**、时钟要开 `__HAL_RCC_FSMC_CLK_ENABLE()`。漏配 GPIO 复用，FSMC 寄存器配置了也没用，引脚根本不工作。**排查顺序永远是：时钟 → GPIO 复用 → 片选/基址 → 时序**。

### 9.5 读屏的坑：读显存方向不对

**症状**：读屏寄存器正确、写显存花屏。**处理**：多数并口屏**写端口和读端口是同一个地址**，靠 RS+读写信号区分；但有的屏读时序对 READ 有独立要求（如需要 RD 拉低时间较长），把 `DataSetupTime` 调大往往能解决。**先只写不读**，把显示跑起来，再回头处理读。

## 十、FMC / FSM 系列怎么认：换代与选型

「FSMC」在不同系列上有不同名字和微调，容易记混：

| 系列 | 外设名 | 特点 |
| ---- | ---- | ---- |
| **F1**（103 高密度/互联型） | **FSMC** | 最经典，Bank1 的 4 个片选 + NAND/PC Card；时序有独立 ADDHLD |
| **F4 / F7** | **FSMC**（407 等有 FSMC；429/439 是 FMC） | 基本同 F1，Bank1 支持同步突发、时序字段合并（ADDSET 含 hold） |
| **F4（429/439）/ H7 / L4+** | **FMC**（Flexible Memory Controller） | **改名不换义**，多了 SDRAM（H7 有 SDRAM 控制器）、命名从 `FSMC_` 变 `FMC_` |
| **G0 / G4 / L4（部分）** | 无 FSMC / 有 FMC | 小封装芯片没有，选型前先查「是否集成 FSMC/FMC」 |

**选型要点**：
- **小封装、低成本芯片（F0/G0/G03xx、L0/L1 低配）大多没有 FSMC**，要并口屏得用 SPI 屏或 GPIO 模拟。
- 查手册看 **Bank1 是否支持同步突发**（F4 部分型号有），决定能不能跑 NAND、同步 PSRAM。
- 想挂 **SDRAM** 只有 **H7（FMC）** 这类带 SDRAM 控制器的型号能行，F1/F4 的 FSMC 不支持。

## 十一、避坑备忘（一页速查）

- **时序宁慢勿快**：DATAST 不足是读写错误第一原因，先加满再优化。
- **16 位总线地址要 +2 步进**：8 位屏/外设别混接 16 位总线，地址映射会错位（见 2.2）。
- **片选决定基址**：接 NE1 就在 0x60000000，接 NE4 就在 0x6C000000，别写错区间。
- **第一步先做「写值读回」自检**：通了再跑全片回环，别上来就调复杂外设。
- **GPIO 要配 AF 复用、时钟要开**：漏配复用，FSMC 引脚是死的。
- **F1/F4 时序字段名不同**：F1 有独立 ADDHLD，F4 合并进 ADDSET；以参考手册时序图和 CubeMX 为准。
- **别在中断里直接刷屏**：刷屏用 DMA 搬运，中断里只置标志（和 CAN/ADC 一样的原则）。
- **LCD 的 RS 接哪根地址线，命令/数据地址就怎么算**：见第七节，A16 接 RS 是最常见接法。

## 参考

- 基础时钟背景见 [stm32-clock-tree.md](stm32-clock-tree.md)（FSMC 挂在 AHB 总线上，时序按 HCLK 算）
- 相关外设与裸机寄存器风格见 [peripheral-drivers.md](peripheral-drivers.md)
- 寄存器级细节：对应型号参考手册 **FSMC / FMC 章节**（F1：RM0008；F4：RM0090）
- 官方应用笔记：AN2784（STM32F10x FSMC 接外部存储）
- ST 社区关于 ADDSET/DATAST 计算的讨论：[如何根据 SRAM 时序图计算 ADDSET 与 DATAST](https://community.st.com/t5/stm32-mcus-products/how-to-calculate-addset-and-datast-according-to-sram-timing-graph/m-p/58787#M2840)
- 理解 FSMC 的内存映射与地址分片：[Understanding STM32F4 FSMC](https://community.st.com/t5/stm32-mcus-products/understanding-stm32f4-fsmc/td-p/495685)
