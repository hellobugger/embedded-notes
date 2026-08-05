# ESP32-S3 反复复位（Wi-Fi 连接时）

> 现象：启动正常，但每次在 Wi-Fi 连接时刻复位、再启动，循环往复。最终定位为**硬件供电不足**，当前以软件降低发射功率缓解。

## 现象

设备上电后启动正常，但每次都在 **Wi-Fi 启动连接的时刻**复位，然后再次启动，循环往复。

复位日志（串口）：

```text
rst:0x3 (RTC_SW_SYS_RST), boot:0x2b (SPI_FAST_FLASH_BOOT)
Saved PC:0x40375797
```

日志最后停在 Wi-Fi 初始化流程：

```text
mode: sta → enable tsf → 收到 WIFI_EVENT_STA_START → esp_wifi_connect()
```

## 定位过程

| 步骤 | 证据 | 结论 |
|------|------|------|
| 复位原因 `rst:0x3` | 软件触发的系统复位，日志中**无** Guru Meditation / abort / backtrace / watchdog 信息 | 排除崩溃、看门狗 |
| Saved PC `0x40375797` | 在 `ESP32_DATA_ANALYZE.map` 中查到落在 `libesp_system.a(brownout.c.obj)` 的 IRAM 段（`0x40375744~0x4037579A`） | 复位发生时正执行**掉电检测（brownout）中断处理** |
| 复位时机 | 正好在 Wi-Fi 发射（峰值电流）时刻 | 与掉电吻合 |
| 掉电阈值 | `CONFIG_ESP_BROWNOUT_DET_LVL=7`（2.44V），已是最低、最宽松档 | 不是配置过严，是电压真的被拉到了 2.44V 以下 |
| 排除 OTA | 项目内 `esp_restart()` 仅出现在 OTA 成功/切分区路径，需先连上 MQTT/HTTP，复位发生时尚未连接 | 排除 OTA 代码触发 |
| 排除按键 | 长按 BOOT 键重启需人为触发 | 排除 |

## 结论

**硬件供电不足**：3.3V 电源无法支撑 Wi-Fi 发射瞬间的峰值电流，电压被拉到 2.44V 以下，触发掉电检测复位。Wi-Fi TX 是 ESP32-S3 瞬时电流最大的操作，正常供电下 VDD 应稳定在 3.0V 以上。

## 处理方案

### 软件缓解（已采用）

`app_wifi.c:239` 在 `esp_wifi_start()` 后加：

```c
esp_wifi_set_max_tx_power(40);   /* 10dBm，把 Wi-Fi 峰值电流降约一半 */
```

!!! note "已采用"
    当前即采用此软件方案。硬件已固定，无法改动，见下方根治项仅供后续新设计参考。

### 硬件根治（当前无法修改，留作新设计参考）

1. **去耦电容**：模块 3V3 引脚附近加 100~470µF 电解 + 0.1µF 陶瓷去耦电容
2. **LDO 瞬态**：检查 3.3V LDO 瞬态响应（AMS1117 类在突波时压降大），换瞬态好的 LDO 或加大输出电容
3. **电源走线**：电源线短粗，避免细跳线/劣质 USB 线；确认 CAN 收发器等外设不与模块同路抢电

### 临时诊断（不建议长期开）

`CONFIG_ESP_BROWNOUT_DET=n` 关闭掉电检测可验证掉电判断，但电压低于 2.44V 时可能损坏 flash，**仅用于实验**。

## 待补充

- [ ] 用示波器实测 Wi-Fi 发射瞬间的 VDD 跌落波形，量化压降幅度
