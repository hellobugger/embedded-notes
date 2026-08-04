# STM32H7 调试笔记

## 时钟配置问题
使用 HSE + PLL 时，务必先使能电源接口时钟，否则会卡死在 `while(__HAL_RCC_GET_FLAG(...))`。

```c
// 正确顺序
__HAL_RCC_PWR_CLK_ENABLE();
HAL_PWR_EnableBkUpAccess();
```

!!! warning "注意"
    若使用了 RTOS，需将 HAL_Delay 替换为系统延时函数，避免死在中断里。
