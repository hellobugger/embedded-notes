# 裸机外设驱动

> 不依赖 HAL/LL，直接操作寄存器编写外设驱动的心得。先列骨架，逐步补充。

## GPIO 驱动骨架

```c
// 以 STM32 为例：开启时钟 -> 配置模式 -> 输出
void gpio_init(void) {
    RCC->AHB1ENR |= RCC_AHB1ENR_GPIOAEN;      // 使能 GPIOA 时钟
    GPIOA->MODER  &= ~GPIO_MODER_MODER5_Msk;   // 清配置位
    GPIOA->MODER  |= GPIO_MODER_MODER5_0;      // 输出模式
    GPIOA->ODR    |= GPIO_ODR_OD5;             // 默认输出高
}
```

!!! tip "原则"
    能用一个寄存器位解决的事，不要引一层 HAL。

## USART 发送轮询版

```c
void uart_send_byte(USART_TypeDef *uart, uint8_t b) {
    while (!(uart->ISR & USART_ISR_TXE));      // 等待发送缓冲空
    uart->TDR = b;
    while (!(uart->ISR & USART_ISR_TC));       // 等待发送完成
}
```

- 轮询版适合启动阶段打印日志
- 数据量大的场景应改为中断或 DMA

## I2C 常见坑

| 坑 | 说明 |
|----|------|
| 无 ACK | 地址写错，或从机未上电/未应答 |
| 总线锁死 | SDA/SCL 被从机拉低，需复位总线或重新上电 |
| 速率不符 | 标准 100k / 快速 400k 需与从机匹配 |

## 待补充

- [ ] SPI 半双工/全双工差异
- [ ] 中断服务里放什么、不放什么
- [ ] 定时器 PWM 输出相位对齐
