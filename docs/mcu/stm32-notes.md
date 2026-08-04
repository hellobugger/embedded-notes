# STM32H7 调试笔记

> 记录实际项目中踩过的坑与经验，按主题归档。不定期补充。

## 时钟配置问题

使用 HSE + PLL 时，务必先使能电源接口时钟，否则会卡死在 `while(__HAL_RCC_GET_FLAG(...))`。

```c
// 正确顺序
__HAL_RCC_PWR_CLK_ENABLE();
HAL_PWR_EnableBkUpAccess();
```

!!! warning "注意"
    若使用了 RTOS，需将 HAL_Delay 替换为系统延时函数，避免死在中断里。

## 调试器连接失败

**现象**：Keil / ST-Link 提示 `Cannot connect to target`。

排查顺序：

1. 确认 SWD 四根线连接正确：`SWDIO`、`SWCLK`、`GND`、`VCC(3.3V)`
2. 若芯片之前烧写过保护，先**全片擦除**或解除读保护：
   - CubeProgrammer → `Option Bytes` → `Readout Protection Level: Disabled`
3. 复位引脚被外部电路拉死也会导致连不上，试着按住复位键后松手

```text
STM32CubeProgrammer -> 左侧 "Option Bytes" -> RDP 选择 Level 0 -> Apply
```

!!! tip "小技巧"
    连接失败时先断掉板子上其他占用 SWD 的外设（如逻辑分析仪），再试一次。

## 芯片莫名复位（HardFault）

**排查思路**：先确认是不是栈溢出。

```c
// 在 HardFault_Handler 中读取栈指针，判断是否指向异常地址
void HardFault_Handler(void) {
    __disable_irq();
    // 断点调试时查看 MSP / PSP 的值
    while (1);
}
```

- 若数组越界写入，通常在 `0x08000000` 附近跳飞
- FreeRTOS 下任务栈开太小是常见原因，把任务栈翻倍试试

## Flash 编程注意事项

| 要点 | 说明 |
|------|------|
| 擦除粒度 | 扇区擦除（H7 为 128KB 扇区） |
| 写前必须擦除 | Flash 只能 1→0，写 1 前需先擦 |
| 操作期间禁中断 | 写 Flash 时中断可能导致忙等待超时 |

## 待补充

- [ ] DMA + 中断优先级组合的坑
- [ ] 外部晶振起振失败的处理
