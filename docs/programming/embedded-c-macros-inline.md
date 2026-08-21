# 嵌入式 C 语言：宏、内联函数与代码编写注意事项

## 1. 核心原则

宏不是应该被完全禁止的功能，但应只用于预处理器真正擅长的事情。

推荐的选择顺序：

1. 表达行为时，优先使用普通函数或 `static inline` 函数。
2. 表达有类型的常量时，优先使用 `enum` 或 `static const`。
3. 条件编译、编译期开关、字符串化和记号拼接等场景使用宏。
4. 不要为了“可能更快”而使用函数式宏，先让编译器优化，再根据测量结果调整。

可以概括为：

> 配置和预处理使用宏，类型和行为使用 C 语言本身。

---

## 2. 适合使用宏的场景

### 2.1 条件编译

条件编译是宏不可替代的主要用途：

```c
#define FEATURE_CAN_ENABLED 1

#if FEATURE_CAN_ENABLED
void can_init(void);
#endif
```

典型场景包括：

- 根据芯片型号选择寄存器定义；
- 根据硬件版本选择引脚；
- 启用或关闭某个软件模块；
- 区分调试版和发布版；
- 封装不同编译器的属性。

```c
#if defined(__GNUC__)
#define APP_WEAK __attribute__((weak))
#elif defined(__CC_ARM)
#define APP_WEAK __weak
#else
#define APP_WEAK
#endif
```

配置宏最好只表达编译期差异。运行期间需要改变的状态应使用变量，而不是制造大量条件编译分支。

### 2.2 寄存器位和位掩码

```c
#define UART_CR1_UE  (1UL << 0)
#define UART_CR1_TE  (1UL << 3)
#define UART_CR1_RE  (1UL << 2)
```

使用时：

```c
uart->CR1 |= UART_CR1_UE | UART_CR1_TE | UART_CR1_RE;
```

这类对象式宏没有参数重复求值的问题，也符合芯片厂商头文件的常见表达方式。

位移时应注意：

```c
#define BIT_U32(n) (UINT32_C(1) << (n))
```

- 使用无符号常量；
- 位移量必须小于类型宽度；
- 不要对负数进行位移；
- 不要依赖有符号整数右移的实现相关行为。

### 2.3 预处理器专属能力

字符串化和记号拼接只能由宏完成：

```c
#define STRINGIFY_IMPL(x) #x
#define STRINGIFY(x)      STRINGIFY_IMPL(x)

#define JOIN_IMPL(a, b) a##b
#define JOIN(a, b)      JOIN_IMPL(a, b)
```

这类宏适合生成日志标签、声明或编译期名称，但不宜发展成复杂的“宏语言”。宏展开越复杂，调试和静态分析越困难。

---

## 3. 为什么严格项目限制函数式宏

函数式宏看起来像函数，实际上只是编译前的文本替换：

```c
#define SQUARE(x) ((x) * (x))
```

下面的调用会重复求值：

```c
uint32_t result = SQUARE(index++);
```

展开后近似为：

```c
uint32_t result = ((index++) * (index++));
```

这可能产生未定义行为。即使调用的是普通函数，也可能出现意外的多次硬件访问：

```c
#define MAX(a, b) ((a) > (b) ? (a) : (b))

uint16_t value = MAX(read_adc(), 100U);
```

根据第一次读取结果，`read_adc()` 可能执行一次或两次。如果参数涉及寄存器、FIFO、清除标志位或状态机，风险尤其大。

函数式宏的主要问题包括：

- 参数可能被求值多次；
- 没有参数和返回值类型检查；
- 容易出现运算符优先级错误；
- 可能隐藏 `return`、`goto` 等控制流；
- 宏名会污染包含它的所有源文件；
- 难以设置断点和观察调用关系；
- 增加静态分析、代码覆盖和安全审查成本。

因此，安全性要求较高的项目常把“禁止或限制函数式宏”作为统一规则。目的不是认为所有宏必然错误，而是减少需要逐个证明安全的特殊写法。

---

## 4. 必须使用函数式宏时的最低要求

### 4.1 给参数和完整表达式加括号

错误写法：

```c
#define MUL(a, b) a * b
```

`MUL(1U + 2U, 3U)` 会得到错误的运算顺序。

最低限度的写法：

```c
#define MUL(a, b) ((a) * (b))
```

括号只能解决优先级问题，不能解决重复求值和类型安全问题。

### 4.2 多语句宏使用 `do ... while (0)`

```c
#define DEVICE_RESET()     \
    do {                   \
        device_disable();  \
        device_clear();    \
    } while (0)
```

这样可使宏在 `if/else` 中表现得更像一条普通语句：

```c
if (need_reset) {
    DEVICE_RESET();
} else {
    device_start();
}
```

### 4.3 不向宏传递带副作用的表达式

避免：

```c
MAX(i++, limit);
SET_BIT(*ptr++, mask);
CLAMP(read_register(), low, high);
```

“调用者保证不传副作用参数”是一种脆弱约定。只要能用函数替代，就应使用函数。

### 4.4 不在宏中隐藏控制流

不推荐：

```c
#define CHECK_READY(x) \
    do {               \
        if (!(x)) {    \
            return;    \
        }               \
    } while (0)
```

调用位置看不出当前函数可能提前返回。更清晰的做法是直接写出判断，或返回状态值。

---

## 5. 什么时候使用内联函数

内联函数适合短小、调用频繁、需要类型检查的操作，特别适合替代函数式宏。

```c
static inline uint32_t max_u32(uint32_t a, uint32_t b)
{
    return (a > b) ? a : b;
}
```

它具有以下优点：

- 参数只求值一次；
- 编译器会检查参数和返回值类型；
- 遵守正常的作用域和语法规则；
- 可以设置断点，调试信息更清晰；
- 优化后通常与宏具有相同的运行效率。

### 5.1 简短的寄存器操作

```c
static inline void uart_enable(USART_TypeDef *uart)
{
    uart->CR1 |= USART_CR1_UE;
}

static inline bool uart_tx_ready(const USART_TypeDef *uart)
{
    return (uart->SR & USART_SR_TXE) != 0U;
}
```

这类操作短小、频繁，并且参数类型明确，很适合写成 `static inline`。

### 5.2 头文件中的小型公共操作

在 C 项目的头文件中，推荐使用：

```c
static inline void gpio_set(GPIO_TypeDef *gpio, uint32_t pin_mask)
{
    gpio->BSRR = pin_mask;
}
```

不要在没有明确链接规则的情况下，随意把单独的 `inline` 定义放进头文件。C 语言不同标准和编译器模式下的 `inline` 外部链接规则容易引起重复定义或缺少定义问题。`static inline` 通常最简单可靠。

### 5.3 不适合主动内联的情况

以下情况通常使用普通函数：

- 函数体较大；
- 包含大量分支和循环；
- 只在初始化阶段调用一次；
- 调用频率很低；
- 希望减少 Flash 占用；
- 需要稳定的独立函数入口；
- 需要获取函数地址或用作回调。

把大函数复制到多个调用点可能增加代码体积。对资源受限设备，过度内联不一定更好。

### 5.4 `inline` 不保证一定内联

`inline` 通常只是允许或建议编译器内联。最终是否内联由编译器根据优化等级、函数大小和调用环境决定。

即使没有写 `inline`，在开启 `-O2`、`-Os` 或 LTO 后，编译器也可能自动内联。反过来，即使写了 `inline`，编译器也可能保留普通函数调用。

除非通过性能测量确认必要，否则不要使用编译器专属的“强制内联”属性。

---

## 6. 宏、`enum`、`const` 和内联函数如何选择

| 需求 | 推荐方式 |
|---|---|
| 参与 `#if` 条件编译 | 宏 |
| 芯片寄存器位掩码 | 对象式宏或厂商定义 |
| 一组相关整型常量 | `enum` |
| 有明确类型的只读对象 | `static const` |
| 短小的计算或硬件操作 | `static inline` |
| 普通业务逻辑 | 普通函数 |
| 字符串化、记号拼接 | 函数式宏 |
| 运行期间可变化的配置 | 变量或配置结构体 |

示例：

```c
/* 必须参与条件编译 */
#define FEATURE_LOG_ENABLED 1

/* 整数常量 */
enum {
    UART_COUNT = 3,
    ADC_CHANNEL_COUNT = 16
};

/* 有明确类型的只读数据 */
static const uint32_t uart_timeout_ms = 1000U;

/* 表达行为 */
static inline bool timeout_expired(uint32_t now, uint32_t start,
                                   uint32_t timeout)
{
    return (uint32_t)(now - start) >= timeout;
}
```

注意：在 C 语言中，`const` 对象不一定是整数常量表达式，不能无条件用于 `case` 标签等场合。此时可使用 `enum`。

---

## 7. 嵌入式 C 代码常见注意事项

### 7.1 使用定宽整数类型

涉及协议、寄存器、存储格式和精确位宽时，使用 `<stdint.h>`：

```c
uint8_t command;
uint16_t adc_value;
uint32_t timestamp_ms;
```

不要假设 `int`、`long` 在所有平台上宽度相同。

### 7.2 明确整数的有符号性

```c
uint32_t mask = UINT32_C(1) << 15;
int32_t temperature = -20;
```

注意有符号数和无符号数混合运算。比较、移位和取反前，应确认整数提升后的实际类型。

```c
uint8_t value = 0x0FU;
uint8_t inverted = (uint8_t)(~value);
```

`value` 在执行 `~` 前通常会先提升为 `int`，因此窄类型赋值处最好进行明确转换。

### 7.3 正确理解 `volatile`

`volatile` 适合表示值可能在当前代码流程之外发生变化的对象，例如：

- 内存映射硬件寄存器；
- 被中断服务程序修改的变量；
- 某些 DMA 共享状态。

```c
static volatile bool transfer_done;
```

但 `volatile`：

- 不保证原子性；
- 不提供线程或中断同步；
- 不自动形成内存屏障；
- 不能修复竞态条件。

共享数据是否安全，还要结合数据宽度、CPU 原子操作能力、临界区和内存屏障进行判断。

### 7.4 区分“指针只读”和“数据只读”

```c
const uint8_t *p1;        /* 不能通过 p1 修改数据 */
uint8_t *const p2 = buf;  /* p2 不能指向其他地址 */
const uint8_t *const p3 = table;
```

函数不修改输入数据时，应使用 `const`：

```c
uint16_t crc16(const uint8_t *data, size_t length);
```

这既是约束，也是接口文档。

### 7.5 避免隐藏副作用

不推荐：

```c
buffer[index++] = read_byte();
```

当调试或错误处理较复杂时，可拆成语义明确的步骤：

```c
uint8_t value = read_byte();
buffer[index] = value;
index++;
```

不是所有表达式都必须拆开，但寄存器访问、状态变更和多个副作用不应挤在同一表达式中。

### 7.6 寄存器访问要考虑硬件语义

下面的读—改—写并不总是安全：

```c
peripheral->STATUS |= FLAG;
```

某些状态寄存器采用：

- 写 1 清零；
- 写 0 清零；
- 读后清零；
- 只允许特定位写入。

必须根据芯片参考手册操作，不能只根据 C 表达式推断硬件行为。GPIO 置位和复位优先使用芯片提供的原子置位/清零寄存器。

### 7.7 中断服务程序保持短小

中断中通常只做必要工作：

- 读取或清除中断源；
- 保存最少量数据；
- 设置事件标志；
- 唤醒后续处理。

避免在中断中执行长循环、阻塞等待、动态内存分配和耗时日志输出。

### 7.8 超时判断考虑计数器回绕

无符号计数器可以使用差值处理自然回绕：

```c
static inline bool timeout_expired(uint32_t now, uint32_t start,
                                   uint32_t timeout)
{
    return (uint32_t)(now - start) >= timeout;
}
```

这种方法允许计数器自然回绕，但系统必须在计数器再次完整回绕之前完成判断，且 `timeout` 必须能由该无符号类型表示。若项目希望采用更容易审查的保守约束，可以进一步规定最大超时时间不超过计数范围的一半。

不推荐直接比较未来时间点：

```c
if (now >= start + timeout) {
    /* 回绕附近可能判断错误 */
}
```

### 7.9 不随意使用动态内存

资源受限或实时性严格的系统通常优先使用：

- 静态分配；
- 固定长度缓冲区；
- 初始化阶段一次性分配；
- 尺寸明确的内存池。

动态内存并非绝对不能使用，但需要考虑碎片、分配失败、最长执行时间和生命周期管理。如果系统没有真实需求，就不要引入自定义内存管理器。

### 7.10 所有等待都应考虑超时

不推荐无限等待硬件：

```c
while ((uart->SR & UART_SR_TXE) == 0U) {
}
```

更可靠的接口应提供超时和错误结果：

```c
typedef enum {
    APP_OK = 0,
    APP_TIMEOUT,
    APP_INVALID_ARGUMENT,
    APP_HARDWARE_ERROR
} app_status_t;
```

超时长度应依据硬件时序和实际测量确定，而不是随意选择一个“足够大”的数值。

### 7.11 检查数组边界和长度单位

```c
void uart_write(const uint8_t *data, size_t length);
```

接口应明确长度单位是字节、元素、帧还是采样点。使用 `sizeof` 时要区分数组和指针：

```c
#define ARRAY_SIZE(array) (sizeof(array) / sizeof((array)[0]))
```

这个宏只适用于真正的数组，传入指针会得到错误结果。若编译器和规范允许，可以增加编译期检查；否则应通过接口设计避免在函数内部尝试计算调用者数组长度。

### 7.12 错误不能被静默忽略

```c
app_status_t status = flash_write(address, data, length);
if (status != APP_OK) {
    return status;
}
```

对于不可能恢复的内部条件，可在调试版本中使用断言；对于外部输入、硬件失败和通信错误，应提供正常的错误处理路径，不能只依赖 `assert`。

### 7.13 注释解释原因，而不是翻译代码

不好的注释：

```c
counter++; /* counter 加一 */
```

有价值的注释：

```c
/* 该状态寄存器写 1 清零，不能使用普通的读—改—写操作。 */
uart->STATUS = UART_STATUS_OVERRUN;
```

硬件限制、时序依据、单位、取值范围和设计折中都值得记录。

---

## 8. 头文件和模块边界

头文件中适合放置：

- 对外类型；
- 对外函数声明；
- 必要的配置和寄存器宏；
- 短小的 `static inline` 函数；
- 接口所需的常量。

不适合放置：

- 普通全局变量定义；
- 大段函数实现；
- 只被一个 `.c` 文件使用的内部宏；
- 与接口无关的私有结构体和内部状态。

模块内部对象和函数尽量使用 `static` 限制作用域：

```c
static uint8_t rx_buffer[128];

static void reset_rx_state(void)
{
    /* 仅供当前源文件使用 */
}
```

缩小作用域可以减少命名冲突，也能让编译器和审查者更准确地理解依赖关系。

---

## 9. 实用审查清单

提交代码前，可以快速检查以下问题：

### 宏

- 这个宏是否真的需要预处理器？
- 能否改为 `enum`、`static const` 或 `static inline`？
- 函数式宏是否会重复求值参数？
- 每个参数和完整表达式是否加了括号？
- 多语句宏是否使用 `do ... while (0)`？
- 宏是否隐藏了 `return`、`goto` 或硬件副作用？

### 内联函数

- 函数是否足够短小？
- 是否位于高频路径或用于替代函数式宏？
- 头文件中的定义是否使用了 `static inline`？
- 内联是否可能明显增加 Flash 占用？
- 是否只是凭感觉优化，而没有检查汇编、map 文件或测量数据？

### 通用代码

- 整数宽度和有符号性是否明确？
- 寄存器操作是否符合参考手册的读写语义？
- `volatile` 是否被误当成原子性或同步机制？
- 中断和主循环之间是否存在竞态？
- 数组长度、单位和边界是否明确？
- 所有阻塞等待是否有超时策略？
- 错误码是否被检查和传播？
- 注释是否说明了真正的硬件限制和设计原因？

---

## 10. 最终建议

在大多数嵌入式 C 项目中，可以采用以下简单规则：

```text
#if、编译配置、位掩码、字符串化、记号拼接  -> 宏
一组整型常量                              -> enum
有明确类型的只读数据                      -> static const
短小且频繁的操作                          -> static inline
其他行为                                  -> 普通函数
```

不要把“宏一定快”“内联一定快”当成事实。代码是否内联、运行时间和 Flash 占用最终都由编译器、优化选项和调用环境共同决定。对于性能关键代码，应查看编译结果并实际测量。

最重要的目标不是消灭某一种语法，而是让代码具备明确的类型、作用域、副作用和硬件行为，使它能够被可靠地阅读、测试和维护。
